import {
  Bookmark,
  CalendarDays,
  Filter,
  GanttChart,
  KanbanSquare,
  List,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  ISSUE_TYPES,
  ISSUE_TYPE_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_STATUSES,
  type IssueType,
  type Priority,
  type TaskListQuery,
  type TaskStatus,
} from '@arihant/shared';
import { SearchInput } from '@/components/common/SearchInput';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import * as searchApi from '@/services/api/search';
import * as work from '@/services/api/work';
import { useProject, useProjects, useSavedViews, useWorkMutation, workKeys } from '../hooks';
import { SaveViewDialog } from './SaveViewDialog';
import { TaskFormDialog } from './TaskFormDialog';
import { BoardView } from './views/BoardView';
import { CalendarView } from './views/CalendarView';
import { ListView } from './views/ListView';
import { TimelineView } from './views/TimelineView';

export type TaskView = 'board' | 'list' | 'calendar' | 'timeline';
const ALL = 'all';

const VIEWS: { id: TaskView; label: string; icon: typeof List }[] = [
  { id: 'board', label: 'Board', icon: KanbanSquare },
  { id: 'list', label: 'List', icon: List },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'timeline', label: 'Timeline', icon: GanttChart },
];

interface Filters {
  projectId: string;
  assigneeId: string;
  status: string;
  priority: string;
  /** Issue type, plus (in a project) "sprint" for the running sprint. */
  type?: string;
  sprint?: string;
  q: string;
  /** Board quick filters. */
  quick?: QuickFilter[];
  /** A query-language filter (from a saved filter or the search page). */
  aql?: string;
  aqlName?: string;
}

type QuickFilter = 'mine' | 'unassigned' | 'overdue' | 'recent';
const QUICK: { id: QuickFilter; label: string }[] = [
  { id: 'mine', label: 'Only my issues' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'recent', label: 'Recently updated' },
];

interface TaskWorkspaceProps {
  /** Locks the workspace to one project (project page). */
  projectId?: string;
  canCreate?: boolean;
  initialView?: TaskView;
  initialFilters?: Partial<Filters>;
  views?: TaskView[];
}

/**
 * One workspace, four views over the same task records. Filters and the chosen view
 * can be saved as personal views.
 */
export function TaskWorkspace({
  projectId,
  canCreate = true,
  initialView = 'board',
  initialFilters = {},
  views,
}: TaskWorkspaceProps) {
  const [view, setView] = useState<TaskView>(initialView);
  const [filters, setFilters] = useState<Filters>({
    projectId: ALL,
    assigneeId: ALL,
    status: ALL,
    priority: ALL,
    type: ALL,
    sprint: ALL,
    q: '',
    quick: [],
    ...initialFilters,
  });
  const savedFilters = useQuery({ queryKey: ['filters'], queryFn: searchApi.fetchFilters });
  const [creating, setCreating] = useState<{ status?: TaskStatus; due?: string } | null>(null);
  const [savingView, setSavingView] = useState(false);
  const projects = useProjects({ limit: 100, sort: 'name' }, !projectId);
  const fixedProject = useProject(projectId);
  const saved = useSavedViews();
  const saveView = useWorkMutation(work.createSavedView, {
    success: (v) => `Saved view “${v.name}”`,
    invalidate: [workKeys.savedViews],
  });
  const deleteView = useWorkMutation(work.deleteSavedView, {
    success: 'Saved view deleted',
    invalidate: [workKeys.savedViews],
  });

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const query = useMemo<Partial<TaskListQuery>>(() => {
    const pid = projectId ?? (filters.projectId === ALL ? undefined : filters.projectId);
    const quick = new Set(filters.quick ?? []);
    const assignee = quick.has('mine')
      ? 'me'
      : quick.has('unassigned')
        ? 'none'
        : filters.assigneeId === ALL
          ? undefined
          : (filters.assigneeId as 'me' | 'none');
    return {
      projectId: pid ? [pid] : undefined,
      assigneeId: assignee,
      overdue: quick.has('overdue') ? ('true' as const) : undefined,
      updatedWithin: quick.has('recent') ? 7 : undefined,
      aql: filters.aql || undefined,
      // The board shows status as columns, so the status filter applies to the other views.
      status:
        view !== 'board' && filters.status !== ALL ? [filters.status as TaskStatus] : undefined,
      priority: filters.priority === ALL ? undefined : [filters.priority as Priority],
      type: !filters.type || filters.type === ALL ? undefined : [filters.type as IssueType],
      sprintId:
        filters.sprint === 'active' ? 'active' : filters.sprint === 'none' ? 'none' : undefined,
      q: filters.q || undefined,
      parentId: view === 'board' ? 'none' : undefined,
    };
  }, [filters, projectId, view]);

  const available = VIEWS.filter((v) => !views || views.includes(v.id));
  const viewIcon = (id: TaskView) => VIEWS.find((v) => v.id === id)!.icon;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Task views"
          className="inline-flex rounded-lg border bg-card p-0.5"
        >
          {available.map((v) => (
            <button
              key={v.id}
              role="tab"
              type="button"
              aria-selected={view === v.id}
              onClick={() => setView(v.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors',
                view === v.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <v.icon className="size-3.5" /> {v.label}
            </button>
          ))}
        </div>
        <SearchInput
          value={filters.q}
          onChange={(q) => set({ q })}
          placeholder="Search tasks…"
          className="sm:w-52"
        />
        {!projectId ? (
          <Select value={filters.projectId} onValueChange={(v) => set({ projectId: v })}>
            <SelectTrigger size="sm" className="w-48" aria-label="Filter by project">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All projects</SelectItem>
              {projects.data?.items.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.key} · {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Select value={filters.assigneeId} onValueChange={(v) => set({ assigneeId: v })}>
          <SelectTrigger size="sm" className="w-36" aria-label="Filter by assignee">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Anyone</SelectItem>
            <SelectItem value="me">Assigned to me</SelectItem>
            <SelectItem value="none">Unassigned</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.priority} onValueChange={(v) => set({ priority: v })}>
          <SelectTrigger size="sm" className="w-32" aria-label="Filter by priority">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any priority</SelectItem>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.type ?? ALL} onValueChange={(v) => set({ type: v })}>
          <SelectTrigger size="sm" className="w-32" aria-label="Filter by type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any type</SelectItem>
            {ISSUE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {ISSUE_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {projectId ? (
          <Select value={filters.sprint ?? ALL} onValueChange={(v) => set({ sprint: v })}>
            <SelectTrigger size="sm" className="w-36" aria-label="Filter by sprint">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All work</SelectItem>
              <SelectItem value="active">Running sprint</SelectItem>
              <SelectItem value="none">Backlog only</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
        {view !== 'board' ? (
          <Select value={filters.status} onValueChange={(v) => set({ status: v })}>
            <SelectTrigger size="sm" className="w-36" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any status</SelectItem>
              {TASK_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Bookmark /> Views
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Saved views
              </DropdownMenuLabel>
              {saved.data?.length ? (
                saved.data.map((v) => {
                  const Icon = viewIcon(v.view);
                  return (
                    <DropdownMenuItem
                      key={v.id}
                      onSelect={() => {
                        setView(v.view);
                        setFilters((f) => ({ ...f, ...(v.filters as Partial<Filters>) }));
                      }}
                    >
                      <Icon /> <span className="flex-1 truncate">{v.name}</span>
                      <button
                        type="button"
                        aria-label={`Delete view ${v.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteView.mutate(v.id);
                        }}
                        className="opacity-60 hover:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </DropdownMenuItem>
                  );
                })
              ) : (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">No saved views yet.</p>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  setSavingView(true);
                }}
              >
                <Plus /> Save current view…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {canCreate ? (
            <Button size="sm" onClick={() => setCreating({})}>
              <Plus /> New task
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick filters">
        {QUICK.map((qf) => {
          const on = filters.quick?.includes(qf.id) ?? false;
          return (
            <button
              key={qf.id}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setFilters((f) => {
                  const cur = new Set(f.quick ?? []);
                  if (on) cur.delete(qf.id);
                  else {
                    cur.add(qf.id);
                    // "Only my issues" and "Unassigned" exclude each other.
                    if (qf.id === 'mine') cur.delete('unassigned');
                    if (qf.id === 'unassigned') cur.delete('mine');
                  }
                  return { ...f, quick: [...cur] };
                })
              }
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                on ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted',
              )}
            >
              {qf.label}
            </button>
          );
        })}
        {filters.aql ? (
          <span className="inline-flex max-w-md items-center gap-1 rounded-full border border-primary bg-primary/10 px-2.5 py-0.5 text-xs text-primary">
            <Filter className="size-3" />
            <span className="truncate" title={filters.aql}>
              {filters.aqlName ?? filters.aql}
            </span>
            <button
              type="button"
              aria-label="Clear query filter"
              onClick={() => set({ aql: undefined, aqlName: undefined })}
            >
              <X className="size-3" />
            </button>
          </span>
        ) : savedFilters.data?.length ? (
          <Select
            value=""
            onValueChange={(id) => {
              const f = savedFilters.data?.find((x) => x.id === id);
              if (f) set({ aql: f.aql, aqlName: f.name });
            }}
          >
            <SelectTrigger
              size="sm"
              className="h-6 w-40 rounded-full text-xs"
              aria-label="Apply a saved filter"
            >
              <SelectValue placeholder="Saved filter…" />
            </SelectTrigger>
            <SelectContent>
              {savedFilters.data.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {view === 'board' ? (
        <BoardView
          query={query}
          wipLimits={projectId ? fixedProject.data?.wipLimits : undefined}
          workflow={projectId ? fixedProject.data?.workflow : undefined}
          onAdd={canCreate ? (status) => setCreating({ status }) : undefined}
        />
      ) : null}
      {view === 'list' ? <ListView query={query} showProject={!projectId} /> : null}
      {view === 'calendar' ? (
        <CalendarView
          query={query}
          onCreateOn={canCreate ? (due) => setCreating({ due }) : undefined}
        />
      ) : null}
      {view === 'timeline' ? <TimelineView query={query} /> : null}

      {savingView ? (
        <SaveViewDialog
          pending={saveView.isPending}
          onClose={() => setSavingView(false)}
          onSave={(name) => {
            const { projectId: pid, ...rest } = filters;
            saveView.mutate(
              {
                module: 'tasks',
                name,
                view,
                filters: { ...rest, ...(projectId ? {} : { projectId: pid }) },
              },
              { onSuccess: () => setSavingView(false) },
            );
          }}
        />
      ) : null}
      <TaskFormDialog
        open={creating !== null}
        onOpenChange={(o) => !o && setCreating(null)}
        projectId={projectId ?? (filters.projectId === ALL ? undefined : filters.projectId)}
        defaultStatus={creating?.status}
        defaultDueDate={creating?.due}
      />
    </div>
  );
}
