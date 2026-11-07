import {
  ArrowRightLeft,
  Bell,
  BellOff,
  Clock3,
  Copy,
  Link2,
  MoreHorizontal,
  Plus,
  Sparkles,
  Timer as TimerIcon,
  Trash2,
  X,
} from 'lucide-react';
import { IssueTypeIcon } from '@/features/agile/agile-ui';
import { toast } from 'sonner';
import { TaskDevelopment } from '@/features/integrations/GitIntegration';
import { WebLinksSection } from '@/features/integrations/WebLinks';
import { TaskWorkflowControl, TransitionHistory } from '@/features/workflows/TaskWorkflowControl';
import { TaskRestrictionControl } from '@/features/security/RestrictionControls';
import {
  AcceptanceCriteria,
  AgileFields,
  BugDetails,
  CloneTaskDialog,
  LinksSection,
  MoveTaskDialog,
} from '@/features/agile/TaskAgilePanels';
import { CustomFieldInputs, MilestoneSelect, RecurrenceEditor } from '@/features/planning/fields';
import { LogWorkDialog } from '@/features/tracking/LogWorkDialog';
import { SuggestAssigneeDialog } from '@/features/tracking/SuggestAssigneeDialog';
import { StartTimerDialog } from '@/features/tracking/Timer';
import { useCan } from '@/hooks/use-permission';
import { useState } from 'react';
import { Link } from 'react-router';
import { COMPLEXITY_LABELS, type TaskDto, type UpdateTaskInput } from '@arihant/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ErrorState } from '@/components/common/ErrorState';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import * as work from '@/services/api/work';
import { useAppSelector } from '@/store';
import { ActivityList } from '../collab/ActivityList';
import { AttachmentsPanel } from '../collab/AttachmentsPanel';
import { CommentsPanel } from '../collab/CommentsPanel';
import { relativeDue } from '../format';
import { useProject, useTask, useTaskActivity, useTasks, useWorkMutation } from '../hooks';
import { TaskFormDialog } from './TaskFormDialog';
import { AssigneeSelect, PrioritySelect } from './task-ui';
import { useTaskDrawer } from './use-task-drawer';

const NONE = '__none__';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-2 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Search tasks of the same project to add as a dependency. */
function DependencyAdder({ task, onAdd }: { task: TaskDto; onAdd: (id: string) => void }) {
  const [q, setQ] = useState('');
  const debounced = useDebouncedValue(q, 250);
  const results = useTasks(
    { projectId: [task.project.id], q: debounced || undefined, limit: 8 },
    debounced.length > 0,
  );
  const options = (results.data?.items ?? []).filter(
    (t) => t.id !== task.id && !task.dependencies.some((d) => d.id === t.id),
  );
  return (
    <div className="relative">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search a task this depends on…"
        className="h-8"
        aria-label="Add dependency"
      />
      {debounced && options.length ? (
        <ul className="absolute z-20 mt-1 w-full rounded-lg border bg-popover p-1 shadow-md">
          {options.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onAdd(o.id);
                  setQ('');
                }}
              >
                <span className="font-mono text-xs text-muted-foreground">{o.key}</span> {o.title}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TaskDetail({ task }: { task: TaskDto }) {
  const drawer = useTaskDrawer();
  const meId = useAppSelector((s) => s.session.user?.id ?? '');
  const project = useProject(task.project.id);
  const subtasks = useTasks({ parentId: task.id, limit: 100, sort: 'rank' }, task.subtaskCount > 0);
  const activity = useTaskActivity(task.id);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [descDraft, setDescDraft] = useState<string | null>(null);
  const [newItem, setNewItem] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [logging, setLogging] = useState(false);
  const [timing, setTiming] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [moving, setMoving] = useState(false);
  const canCreate = useCan('task:create');
  const canLog = useCan('worklog:write');
  const canAssign = useCan('assignment:execute');
  const editable = task.can.update;
  const watching = task.watcherIds.includes(meId);

  const update = useWorkMutation((input: UpdateTaskInput) => work.updateTask(task.id, input));
  const save = (input: UpdateTaskInput) => update.mutate(input);
  const watch = useWorkMutation(() => work.watchTask(task.id, !watching), {
    success: watching ? 'Stopped watching' : 'Watching this task',
  });
  const remove = useWorkMutation(() => work.deleteTask(task.id), {
    success: `${task.key} deleted`,
  });
  const checklist = task.checklist;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Link
          to={`/projects/${task.project.id}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {task.project.key} · {task.project.name}
        </Link>
        <span className="inline-flex items-center gap-1 font-mono text-xs">
          / <IssueTypeIcon type={task.type} /> {task.key}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {canLog ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Log time"
                onClick={() => setLogging(true)}
              >
                <Clock3 />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Start timer on this task"
                onClick={() => setTiming(true)}
              >
                <TimerIcon />
              </Button>
            </>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={watching ? 'Stop watching' : 'Watch'}
            onClick={() => watch.mutate(undefined)}
          >
            {watching ? <BellOff /> : <Bell />}
          </Button>
          {task.can.delete || canCreate ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canCreate ? (
                  <DropdownMenuItem onSelect={() => setCloning(true)}>
                    <Copy /> Clone
                  </DropdownMenuItem>
                ) : null}
                {task.can.delete && !task.parent ? (
                  <DropdownMenuItem onSelect={() => setMoving(true)}>
                    <ArrowRightLeft /> Move to another project
                  </DropdownMenuItem>
                ) : null}
                {task.can.delete ? (
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                    <Trash2 /> Delete task
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Close"
            onClick={drawer.close}
          >
            <X />
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
        <div className="space-y-2">
          {task.parent ? (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => drawer.open(task.parent!.id)}
            >
              ↑ Subtask of {task.parent.key} {task.parent.title}
            </button>
          ) : null}
          <SheetTitle className="sr-only">{task.title}</SheetTitle>
          <SheetDescription className="sr-only">Task details for {task.key}</SheetDescription>
          <Input
            value={titleDraft}
            disabled={!editable}
            aria-label="Title"
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() =>
              titleDraft.trim().length >= 2 &&
              titleDraft !== task.title &&
              save({ title: titleDraft.trim() })
            }
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="h-auto border-transparent px-1 text-lg font-semibold shadow-none hover:border-input focus-visible:border-input"
          />
        </div>

        <TaskRestrictionControl
          task={task}
          members={project.data?.members ?? []}
          canEdit={editable && (Boolean(project.data?.can.update) || task.reporter?.id === meId)}
        />
        <div className="space-y-2.5">
          <Field label="Status">
            <TaskWorkflowControl
              task={task}
              editable={editable}
              onMove={(input) =>
                update.mutate(input, {
                  onSuccess: (t) => {
                    if (t.pendingTransition && t.status === task.status)
                      toast.info('Sent for approval. The task moves once it is approved.');
                  },
                })
              }
            />
          </Field>
          <AgileFields
            task={task}
            components={project.data?.components ?? []}
            editable={editable}
            save={save}
          />
          <Field label="Priority">
            <PrioritySelect
              value={task.priority}
              disabled={!editable}
              onChange={(priority) => save({ priority })}
            />
          </Field>
          <Field label="Assignee">
            <div className="flex items-center gap-1">
              <AssigneeSelect
                members={project.data?.members ?? []}
                value={task.assignee?.id ?? null}
                disabled={!editable || !project.data}
                onChange={(assigneeId) => save({ assigneeId })}
              />
              {canAssign && editable && task.status !== 'done' && task.status !== 'cancelled' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-violet"
                  onClick={() => setSuggesting(true)}
                >
                  <Sparkles /> Suggest
                </Button>
              ) : null}
            </div>
          </Field>
          <Field label="Start date">
            <Input
              type="date"
              className="h-8 w-40"
              disabled={!editable}
              value={task.startDate ?? ''}
              onChange={(e) => save({ startDate: e.target.value || null })}
            />
          </Field>
          <Field label="Due date">
            <div className="flex items-center gap-2">
              <Input
                type="date"
                className="h-8 w-40"
                disabled={!editable}
                value={task.dueDate ?? ''}
                onChange={(e) => save({ dueDate: e.target.value || null })}
              />
              {task.dueDate && task.status !== 'done' ? (
                <span
                  className={
                    task.overdue
                      ? 'text-xs font-medium text-destructive'
                      : 'text-xs text-muted-foreground'
                  }
                >
                  {relativeDue(task.dueDate)}
                </span>
              ) : null}
            </div>
          </Field>
          <Field label="Estimate">
            <Input
              type="number"
              min={0}
              step={0.5}
              className="h-8 w-28"
              disabled={!editable}
              defaultValue={task.estimatedHours ?? ''}
              aria-label="Estimated hours"
              onBlur={(e) => {
                const v = e.target.value === '' ? null : Number(e.target.value);
                if (v !== (task.estimatedHours ?? null)) save({ estimatedHours: v });
              }}
            />
            <span className="ml-2 text-xs text-muted-foreground">
              h estimated · {task.actualHours} h logged
            </span>
          </Field>
          <Field label="Complexity">
            <Select
              value={task.complexity ? String(task.complexity) : NONE}
              disabled={!editable}
              onValueChange={(v) => save({ complexity: v === NONE ? null : Number(v) })}
            >
              <SelectTrigger size="sm" className="w-40" aria-label="Complexity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not set</SelectItem>
                {[1, 2, 3, 4, 5].map((c) => (
                  <SelectItem key={c} value={String(c)}>
                    {c} · {COMPLEXITY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Tags">
            <div className="flex flex-wrap items-center gap-1">
              {task.tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs"
                >
                  {t}
                  {editable ? (
                    <button
                      type="button"
                      aria-label={`Remove tag ${t}`}
                      onClick={() => save({ tags: task.tags.filter((x) => x !== t) })}
                    >
                      <X className="size-3" />
                    </button>
                  ) : null}
                </span>
              ))}
              {editable ? (
                <Input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && tagDraft.trim()) {
                      save({ tags: [...task.tags, tagDraft.trim()] });
                      setTagDraft('');
                    }
                  }}
                  placeholder="Add tag + Enter"
                  className="h-7 w-32 text-xs"
                  aria-label="Add tag"
                />
              ) : null}
            </div>
          </Field>
          <Field label="Milestone">
            <MilestoneSelect
              projectId={task.project.id}
              value={task.milestone?.id ?? null}
              disabled={!editable}
              className="w-56"
              onChange={(milestoneId) => save({ milestoneId })}
            />
          </Field>
          {task.parent ? null : (
            <Field label="Repeat">
              <RecurrenceEditor
                key={JSON.stringify(task.recurrence)}
                value={task.recurrence}
                disabled={!editable}
                hasDueDate={Boolean(task.dueDate)}
                onChange={(recurrence) =>
                  task.dueDate || !recurrence ? save({ recurrence }) : undefined
                }
              />
              {task.recurrence ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Occurrence {task.recurrence.index}
                  {task.recurrence.nextTask ? (
                    <>
                      {' · next: '}
                      <button
                        type="button"
                        className="font-mono text-primary hover:underline"
                        onClick={() => drawer.open(task.recurrence!.nextTask!.id)}
                      >
                        {task.recurrence.nextTask.key}
                      </button>
                    </>
                  ) : null}
                </p>
              ) : null}
            </Field>
          )}
          {project.data?.customFields.length ? (
            <CustomFieldInputs
              key={task.id}
              layout="rows"
              commitOnBlur
              defs={project.data.customFields}
              values={task.customFields}
              disabled={!editable}
              onChange={(k, v) => save({ customFields: { [k]: v } })}
            />
          ) : null}
          <Field label="Reporter">
            <span className="text-sm">{task.reporter?.name ?? '—'}</span>
          </Field>
        </div>

        <BugDetails key={`bug-${task.updatedAt}`} task={task} editable={editable} save={save} />
        <AcceptanceCriteria task={task} editable={editable} save={save} />

        <Section
          title="Description"
          action={
            editable && descDraft === null ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDescDraft(task.description ?? '')}
              >
                Edit
              </Button>
            ) : null
          }
        >
          {descDraft !== null ? (
            <div className="space-y-2">
              <Textarea
                rows={6}
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                autoFocus
                aria-label="Description"
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setDescDraft(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    update.mutate(
                      { description: descDraft || null },
                      { onSuccess: () => setDescDraft(null) },
                    )
                  }
                >
                  Save
                </Button>
              </div>
            </div>
          ) : task.description ? (
            <p className="text-sm whitespace-pre-wrap">{task.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No description.</p>
          )}
        </Section>

        <Section
          title={`Checklist ${checklist.length ? `${checklist.filter((c) => c.done).length}/${checklist.length}` : ''}`}
        >
          <ul className="space-y-1.5">
            {checklist.map((item) => (
              <li key={item.id} className="group flex items-center gap-2 text-sm">
                <Checkbox
                  checked={item.done}
                  disabled={!editable}
                  aria-label={item.text}
                  onCheckedChange={(c) =>
                    save({
                      checklist: checklist.map((x) =>
                        x.id === item.id ? { ...x, done: Boolean(c) } : x,
                      ),
                    })
                  }
                />
                <span className={item.done ? 'text-muted-foreground line-through' : ''}>
                  {item.text}
                </span>
                {editable ? (
                  <button
                    type="button"
                    className="ml-auto opacity-0 group-hover:opacity-100"
                    aria-label={`Remove ${item.text}`}
                    onClick={() => save({ checklist: checklist.filter((x) => x.id !== item.id) })}
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {editable ? (
            <Input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newItem.trim()) {
                  save({ checklist: [...checklist, { text: newItem.trim(), done: false }] });
                  setNewItem('');
                }
              }}
              placeholder="Add an item and press Enter"
              className="h-8"
              aria-label="New checklist item"
            />
          ) : null}
        </Section>

        {!task.parent ? (
          <Section
            title={`Subtasks ${task.subtaskCount ? `${task.subtasksDone}/${task.subtaskCount}` : ''}`}
            action={
              project.data?.can.createTask ? (
                <Button size="sm" variant="ghost" onClick={() => setAddingSubtask(true)}>
                  <Plus /> Add
                </Button>
              ) : null
            }
          >
            {task.subtaskCount === 0 ? (
              <p className="text-sm text-muted-foreground">No subtasks.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {subtasks.data?.items.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
                      onClick={() => drawer.open(s.id)}
                    >
                      <span className="font-mono text-xs text-muted-foreground">{s.key}</span>
                      <span
                        className={`flex-1 truncate ${s.status === 'done' ? 'text-muted-foreground line-through' : ''}`}
                      >
                        {s.title}
                      </span>
                      <StatusBadge status={s.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ) : null}

        <Section title="Depends on">
          {task.dependencies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No dependencies.</p>
          ) : null}
          <ul className="space-y-1">
            {task.dependencies.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-sm">
                <Link2 className="size-3.5 text-muted-foreground" />
                <button
                  type="button"
                  className="truncate hover:underline"
                  onClick={() => drawer.open(d.id)}
                >
                  <span className="font-mono text-xs text-muted-foreground">{d.key}</span> {d.title}
                </button>
                <StatusBadge status={d.status} />
                {editable ? (
                  <button
                    type="button"
                    className="ml-auto"
                    aria-label={`Remove dependency ${d.key}`}
                    onClick={() =>
                      save({
                        dependencyIds: task.dependencies
                          .filter((x) => x.id !== d.id)
                          .map((x) => x.id),
                      })
                    }
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {task.dependencies.some((d) => d.status !== 'done') &&
          ['in_progress', 'in_review', 'testing'].includes(task.status) ? (
            <p className="text-xs text-warning">Work started while a dependency is still open.</p>
          ) : null}
          {editable ? (
            <DependencyAdder
              task={task}
              onAdd={(id) => save({ dependencyIds: [...task.dependencies.map((d) => d.id), id] })}
            />
          ) : null}
        </Section>
        <LinksSection task={task} editable={editable} />
        <WebLinksSection taskId={task.id} editable={editable} />
        <TaskDevelopment taskId={task.id} />
        <TransitionHistory taskId={task.id} labels={project.data?.workflow?.labels ?? {}} />

        <Tabs defaultValue="comments">
          <TabsList>
            <TabsTrigger value="comments">
              Comments {task.commentCount ? `(${task.commentCount})` : ''}
            </TabsTrigger>
            <TabsTrigger value="files">
              Files {task.attachmentCount ? `(${task.attachmentCount})` : ''}
            </TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
          <TabsContent value="comments" className="pt-3">
            <CommentsPanel
              taskId={task.id}
              members={project.data?.members ?? []}
              canComment={!project.data?.archived}
            />
          </TabsContent>
          <TabsContent value="files" className="pt-3">
            <AttachmentsPanel owner={{ type: 'task', id: task.id }} canUpload={editable} />
          </TabsContent>
          <TabsContent value="activity" className="pt-3">
            <ActivityList items={activity.data?.items} isLoading={activity.isLoading} />
          </TabsContent>
        </Tabs>
      </div>

      <LogWorkDialog
        open={logging}
        onOpenChange={setLogging}
        defaults={{ projectId: task.project.id, taskId: task.id }}
      />
      {timing ? (
        <StartTimerDialog
          onClose={() => setTiming(false)}
          defaults={{ projectId: task.project.id, taskId: task.id }}
        />
      ) : null}
      {cloning ? <CloneTaskDialog task={task} onClose={() => setCloning(false)} /> : null}
      {moving ? <MoveTaskDialog task={task} onClose={() => setMoving(false)} /> : null}
      {suggesting ? (
        <SuggestAssigneeDialog taskId={task.id} onClose={() => setSuggesting(false)} />
      ) : null}
      <TaskFormDialog
        open={addingSubtask}
        onOpenChange={setAddingSubtask}
        projectId={task.project.id}
        parent={{ id: task.id, key: task.key }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${task.key}?`}
        description={
          task.subtaskCount
            ? `Its ${task.subtaskCount} subtask(s) are deleted too.`
            : 'This cannot be undone from the app.'
        }
        confirmLabel="Delete task"
        destructive
        onConfirm={async () => {
          await remove.mutateAsync(undefined);
          drawer.close();
        }}
      />
    </div>
  );
}

/** Global host: renders the drawer for `?task=<id>` on any page. */
export function TaskDrawerHost() {
  const drawer = useTaskDrawer();
  const task = useTask(drawer.openTaskId);
  return (
    <Sheet open={Boolean(drawer.openTaskId)} onOpenChange={(o) => !o && drawer.close()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-xl [&>button.absolute]:hidden">
        {task.error ? (
          <div className="p-6">
            <SheetTitle className="sr-only">Task unavailable</SheetTitle>
            <ErrorState title="Task unavailable" error={task.error} />
          </div>
        ) : !task.data ? (
          <div className="space-y-4 p-6">
            <SheetTitle className="sr-only">Loading task</SheetTitle>
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : (
          // Keyed so local drafts reset when switching tasks or after the task changes.
          <TaskDetail key={`${task.data.id}:${task.data.updatedAt}`} task={task.data} />
        )}
      </SheetContent>
    </Sheet>
  );
}
