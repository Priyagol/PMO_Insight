import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  STATUS_LABELS,
  canTransition,
  type BoardColumnDto,
  type TaskDto,
  type ProjectDto,
  type TaskListQuery,
  type TaskStatus,
} from '@arihant/shared';
import { ErrorState } from '@/components/common/ErrorState';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import * as work from '@/services/api/work';
import { useBoard, workKeys } from '../../hooks';
import { TaskCardBody } from '../task-ui';
import { useTaskDrawer } from '../use-task-drawer';

type Columns = Record<string, TaskDto[]>;

const toColumns = (data: BoardColumnDto[]): Columns =>
  Object.fromEntries(data.map((c) => [c.status, c.tasks]));

function Card({ task, onOpen }: { task: TaskDto; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !task.can.update,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-label={`${task.key} ${task.title}`}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(task.id);
      }}
      className={cn(
        'rounded-lg border bg-card p-3 shadow-xs transition-shadow hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        task.can.update ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        isDragging && 'opacity-40',
        task.overdue && 'border-l-2 border-l-destructive',
      )}
    >
      <TaskCardBody task={task} />
    </div>
  );
}

function Column({
  status,
  label,
  tasks,
  total,
  limit,
  onOpen,
  onAdd,
}: {
  status: TaskStatus;
  /** Column name (a project's workflow may rename statuses). */
  label: string;
  tasks: TaskDto[];
  total: number;
  /** Work-in-progress limit for this column (project setting). */
  limit?: number;
  onOpen: (id: string) => void;
  onAdd?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section aria-label={label} className="flex w-72 shrink-0 flex-col rounded-xl bg-muted/50">
      <header className="flex items-center justify-between px-3 py-2.5">
        <h3 className="text-xs font-semibold tracking-wide uppercase">
          {label}{' '}
          <span
            className={cn(
              'ml-1 font-normal tabular',
              limit && total > limit ? 'font-semibold text-destructive' : 'text-muted-foreground',
            )}
            title={limit ? `Work-in-progress limit: ${limit}` : undefined}
          >
            {total}
            {limit ? ` / ${limit}` : ''}
          </span>
          {limit && total > limit ? (
            <span className="sr-only"> (over the limit of {limit})</span>
          ) : null}
        </h3>
        {onAdd ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={`Add task to ${label}`}
            onClick={onAdd}
          >
            <Plus className="size-3.5" />
          </Button>
        ) : null}
      </header>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            'flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2',
            isOver && 'rounded-lg bg-primary/5',
          )}
        >
          {tasks.map((t) => (
            <Card key={t.id} task={t} onOpen={onOpen} />
          ))}
          {total > tasks.length ? (
            <p className="px-1 text-center text-[11px] text-muted-foreground">
              Showing {tasks.length} of {total}. Use the list view to see all.
            </p>
          ) : null}
        </div>
      </SortableContext>
    </section>
  );
}

export function BoardView({
  query,
  onAdd,
  wipLimits,
  workflow,
}: {
  query: Partial<TaskListQuery>;
  onAdd?: (status: TaskStatus) => void;
  wipLimits?: Partial<Record<TaskStatus, number>>;
  /** The project's workflow, when the board shows one project. */
  workflow?: ProjectDto['workflow'];
}) {
  const label = (s: TaskStatus) => workflow?.labels[s] ?? STATUS_LABELS[s];
  const board = useBoard(query);
  const qc = useQueryClient();
  const drawer = useTaskDrawer();
  /** Working copy while dragging; null otherwise (then the server data is rendered). */
  const [dragCols, setDragCols] = useState<Columns | null>(null);
  const [active, setActive] = useState<{ task: TaskDto; from: TaskStatus } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (board.error) return <ErrorState error={board.error} onRetry={() => void board.refetch()} />;
  if (!board.data) {
    return (
      <div className="flex gap-3 overflow-x-auto">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-96 w-72 shrink-0 rounded-xl" />
        ))}
      </div>
    );
  }

  const base = toColumns(board.data);
  const cols = dragCols ?? base;
  const totals = Object.fromEntries(board.data.map((c) => [c.status, c.total]));
  const container = (id: string): string | undefined =>
    id in cols ? id : Object.keys(cols).find((s) => cols[s]!.some((t) => t.id === id));

  const onDragStart = ({ active: a }: DragStartEvent) => {
    const from = container(String(a.id)) as TaskStatus;
    const task = base[from]!.find((t) => t.id === a.id)!;
    setActive({ task, from });
    setDragCols(structuredClone(base));
  };

  const onDragOver = ({ active: a, over }: DragOverEvent) => {
    if (!over || !dragCols) return;
    const from = container(String(a.id));
    const to = container(String(over.id));
    if (!from || !to || from === to) return;
    setDragCols((prev) => {
      if (!prev) return prev;
      const moving = prev[from]!.find((t) => t.id === a.id)!;
      const target = prev[to]!;
      const overIndex = target.findIndex((t) => t.id === over.id);
      const index = overIndex >= 0 ? overIndex : target.length;
      return {
        ...prev,
        [from]: prev[from]!.filter((t) => t.id !== a.id),
        [to]: [...target.slice(0, index), moving, ...target.slice(index)],
      };
    });
  };

  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    const start = active;
    setActive(null);
    if (!over || !dragCols || !start) return setDragCols(null);
    const to = container(String(over.id)) as TaskStatus | undefined;
    if (!to) return setDragCols(null);

    let column = dragCols[to]!;
    const oldIndex = column.findIndex((t) => t.id === a.id);
    const overIndex = column.findIndex((t) => t.id === over.id);
    if (oldIndex >= 0 && overIndex >= 0 && oldIndex !== overIndex)
      column = arrayMove(column, oldIndex, overIndex);
    const index = column.findIndex((t) => t.id === a.id);
    if (
      start.from === to &&
      JSON.stringify(column.map((t) => t.id)) === JSON.stringify(base[to]!.map((t) => t.id))
    ) {
      return setDragCols(null);
    }
    // Custom workflows are checked by the server (roles, conditions, approvals).
    if (start.from !== to && workflow && !workflow.id && !canTransition(start.from, to)) {
      toast.error(`A task cannot move from ${label(start.from)} to ${label(to)}`);
      return setDragCols(null);
    }

    // Optimistic: show the new order immediately, then persist; on failure refetch the truth.
    const next = {
      ...dragCols,
      [to]: column.map((t) => (t.id === a.id ? { ...t, status: to } : t)),
    };
    qc.setQueryData<BoardColumnDto[]>(workKeys.board(query), (old) =>
      old?.map((c) => ({
        ...c,
        tasks: next[c.status] ?? c.tasks,
        total:
          c.total +
          (c.status === to && start.from !== to ? 1 : 0) -
          (c.status === start.from && start.from !== to ? 1 : 0),
      })),
    );
    setDragCols(null);
    work
      .moveTask(String(a.id), {
        status: to,
        beforeId: column[index - 1]?.id ?? null,
        afterId: column[index + 1]?.id ?? null,
      })
      .then((moved) => {
        if (moved.pendingTransition && moved.status !== to)
          toast.info(`${moved.key} needs approval before it moves to ${label(to)}`);
        return qc.invalidateQueries({ queryKey: workKeys.tasks });
      })
      .catch((err: unknown) => {
        toast.error(errorMessage(err));
        void qc.invalidateQueries({ queryKey: workKeys.tasks });
      });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActive(null);
        setDragCols(null);
      }}
    >
      <div className="flex gap-3 overflow-x-auto pb-3">
        {board.data.map((c) => (
          <Column
            key={c.status}
            status={c.status}
            label={label(c.status)}
            tasks={cols[c.status] ?? []}
            total={totals[c.status] ?? 0}
            limit={wipLimits?.[c.status]}
            onOpen={drawer.open}
            onAdd={onAdd ? () => onAdd(c.status) : undefined}
          />
        ))}
      </div>
      <DragOverlay>
        {active ? (
          <div className="w-68 rotate-1 rounded-lg border bg-card p-3 shadow-lg">
            <TaskCardBody task={active.task} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
