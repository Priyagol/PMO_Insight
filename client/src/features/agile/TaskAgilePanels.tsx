import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState } from 'react';
import {
  BUG_SEVERITIES,
  BUG_SEVERITY_LABELS,
  LINK_LABELS,
  LINK_TYPES,
  STATUS_LABELS,
  type BugSeverity,
  type LinkType,
  type TaskDto,
  type UpdateTaskInput,
} from '@arihant/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useProjects } from '@/features/work/hooks';
import { useTaskDrawer } from '@/features/work/tasks/use-task-drawer';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import * as agileApi from '@/services/api/agile';
import {
  ComponentsPicker,
  EpicSelect,
  IssueTypeSelect,
  ReleaseSelect,
  SeverityBadge,
  SprintSelect,
  searchTasks,
  useAgileMutation,
} from './agile-ui';

type Save = (input: UpdateTaskInput) => void;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-2 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Type, points, epic, sprint, components, fix version and remaining estimate. */
export function AgileFields({
  task,
  components,
  editable,
  save,
}: {
  task: TaskDto;
  components: string[];
  editable: boolean;
  save: Save;
}) {
  const drawer = useTaskDrawer();
  const isSub = Boolean(task.parent);
  return (
    <>
      <Row label="Type">
        <IssueTypeSelect
          value={task.type}
          allowEpic={!isSub}
          disabled={!editable}
          onChange={(type) => save({ type })}
        />
      </Row>
      <Row label="Story points">
        <Input
          key={`sp-${task.storyPoints ?? ''}`}
          type="number"
          min={0}
          max={100}
          step={0.5}
          className="h-8 w-24"
          aria-label="Story points"
          disabled={!editable}
          defaultValue={task.storyPoints ?? ''}
          onBlur={(e) => {
            const v = e.target.value === '' ? null : Number(e.target.value);
            if (v !== (task.storyPoints ?? null)) save({ storyPoints: v });
          }}
        />
      </Row>
      {task.type !== 'epic' && !isSub ? (
        <>
          <Row label="Epic">
            <div className="flex items-center gap-1">
              <EpicSelect
                projectId={task.project.id}
                value={task.epic?.id ?? null}
                excludeId={task.id}
                disabled={!editable}
                onChange={(epicId) => save({ epicId })}
              />
              {task.epic ? (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => drawer.open(task.epic!.id)}
                >
                  Open
                </button>
              ) : null}
            </div>
          </Row>
          <Row label="Sprint">
            <SprintSelect
              projectId={task.project.id}
              value={task.sprint?.id ?? null}
              disabled={!editable || task.sprint?.status === 'completed'}
              onChange={(sprintId) => save({ sprintId })}
            />
          </Row>
        </>
      ) : null}
      <Row label="Components">
        <ComponentsPicker
          available={components}
          value={task.components}
          disabled={!editable}
          onChange={(c) => save({ components: c })}
        />
      </Row>
      <Row label="Fix version">
        <ReleaseSelect
          projectId={task.project.id}
          value={task.fixRelease?.id ?? null}
          disabled={!editable}
          onChange={(fixReleaseId) => save({ fixReleaseId })}
        />
      </Row>
      <Row label="Remaining">
        <div className="flex items-center gap-2">
          <Input
            key={`rem-${task.remainingHours ?? ''}-${task.remainingIsManual}`}
            type="number"
            min={0}
            step={0.5}
            className="h-8 w-24"
            aria-label="Remaining hours"
            disabled={!editable}
            defaultValue={task.remainingIsManual ? (task.remainingHours ?? '') : ''}
            placeholder={task.remainingHours != null ? String(task.remainingHours) : ''}
            onBlur={(e) => {
              const v = e.target.value === '' ? null : Number(e.target.value);
              if (v !== (task.remainingIsManual ? (task.remainingHours ?? null) : null))
                save({ remainingHours: v });
            }}
          />
          <span className="text-xs text-muted-foreground">
            {task.remainingIsManual
              ? 'h (set by hand; clear to calculate)'
              : 'h (estimate − logged)'}
          </span>
        </div>
      </Row>
    </>
  );
}

/** Acceptance criteria (stories and epics, or any task that has them). */
export function AcceptanceCriteria({
  task,
  editable,
  save,
}: {
  task: TaskDto;
  editable: boolean;
  save: Save;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (!(task.type === 'story' || task.type === 'epic' || task.acceptanceCriteria)) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Acceptance criteria
        </h3>
        {editable && draft === null ? (
          <Button size="sm" variant="ghost" onClick={() => setDraft(task.acceptanceCriteria ?? '')}>
            Edit
          </Button>
        ) : null}
      </div>
      {draft !== null ? (
        <div className="space-y-2">
          <Textarea
            rows={4}
            value={draft}
            aria-label="Acceptance criteria"
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => (save({ acceptanceCriteria: draft.trim() || null }), setDraft(null))}
            >
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm whitespace-pre-wrap text-muted-foreground">
          {task.acceptanceCriteria || 'None yet.'}
        </p>
      )}
    </section>
  );
}

/** Defect details for bugs. */
export function BugDetails({
  task,
  editable,
  save,
}: {
  task: TaskDto;
  editable: boolean;
  save: Save;
}) {
  const [editing, setEditing] = useState(false);
  const b = task.bug;
  const [form, setForm] = useState(() => ({
    severity: b?.severity ?? 'major',
    stepsToReproduce: b?.stepsToReproduce ?? '',
    expectedResult: b?.expectedResult ?? '',
    actualResult: b?.actualResult ?? '',
    environment: b?.environment ?? '',
    regression: b?.regression ?? false,
    foundInReleaseId: b?.foundInRelease?.id ?? null,
  }));
  if (task.type !== 'bug' || !b) return null;
  const text = (label: string, v?: string) =>
    v ? (
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm whitespace-pre-wrap">{v}</p>
      </div>
    ) : null;
  return (
    <section className="space-y-2 rounded-lg border p-3" aria-label="Bug details">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Bug details
        </h3>
        {editable && !editing ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={form.severity}
              onValueChange={(v) => setForm((f) => ({ ...f, severity: v as BugSeverity }))}
            >
              <SelectTrigger size="sm" className="w-36" aria-label="Severity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUG_SEVERITIES.map((x) => (
                  <SelectItem key={x} value={x}>
                    {BUG_SEVERITY_LABELS[x]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className="h-8 w-48"
              placeholder="Environment"
              aria-label="Environment"
              value={form.environment}
              onChange={(e) => setForm((f) => ({ ...f, environment: e.target.value }))}
            />
            <ReleaseSelect
              label="Found in"
              projectId={task.project.id}
              value={form.foundInReleaseId}
              onChange={(foundInReleaseId) => setForm((f) => ({ ...f, foundInReleaseId }))}
              className="w-40"
            />
          </div>
          <Textarea
            rows={3}
            placeholder="Steps to reproduce"
            aria-label="Steps to reproduce"
            value={form.stepsToReproduce}
            onChange={(e) => setForm((f) => ({ ...f, stepsToReproduce: e.target.value }))}
          />
          <Textarea
            rows={2}
            placeholder="Expected result"
            aria-label="Expected result"
            value={form.expectedResult}
            onChange={(e) => setForm((f) => ({ ...f, expectedResult: e.target.value }))}
          />
          <Textarea
            rows={2}
            placeholder="Actual result"
            aria-label="Actual result"
            value={form.actualResult}
            onChange={(e) => setForm((f) => ({ ...f, actualResult: e.target.value }))}
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.regression}
              onCheckedChange={(c) => setForm((f) => ({ ...f, regression: c === true }))}
            />
            Regression
          </label>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                save({
                  bug: {
                    severity: form.severity,
                    stepsToReproduce: form.stepsToReproduce.trim() || null,
                    expectedResult: form.expectedResult.trim() || null,
                    actualResult: form.actualResult.trim() || null,
                    environment: form.environment.trim() || null,
                    regression: form.regression,
                    foundInReleaseId: form.foundInReleaseId,
                  },
                });
                setEditing(false);
              }}
            >
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-3 text-sm">
            <SeverityBadge severity={b.severity} />
            {b.regression ? (
              <span className="text-xs font-medium text-destructive">Regression</span>
            ) : null}
            {b.environment ? (
              <span className="text-xs text-muted-foreground">Env: {b.environment}</span>
            ) : null}
            {b.foundInRelease ? (
              <span className="text-xs text-muted-foreground">
                Found in {b.foundInRelease.version}
              </span>
            ) : null}
          </p>
          {text('Steps to reproduce', b.stepsToReproduce)}
          {text('Expected', b.expectedResult)}
          {text('Actual', b.actualResult)}
        </div>
      )}
    </section>
  );
}

/** "relates to", "duplicates", "is a clone of" links, both directions. */
export function LinksSection({ task, editable }: { task: TaskDto; editable: boolean }) {
  const drawer = useTaskDrawer();
  const [type, setType] = useState<LinkType>('relates');
  const [q, setQ] = useState('');
  const debounced = useDebouncedValue(q, 250);
  const results = useQuery({
    queryKey: ['tasks', 'link-search', debounced],
    queryFn: () => searchTasks(undefined, debounced),
    enabled: debounced.length > 1,
  });
  const add = useAgileMutation(
    (otherId: string) => agileApi.addLink(task.id, { type, taskId: otherId }),
    { success: 'Linked' },
  );
  const remove = useAgileMutation(
    (l: { type: LinkType; id: string }) => agileApi.removeLink(task.id, l.type, l.id),
    {
      success: 'Link removed',
    },
  );
  const options = (results.data?.items ?? []).filter((t) => t.id !== task.id);
  return (
    <section className="space-y-2" aria-label="Linked tasks">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Linked tasks
      </h3>
      {task.links.length ? (
        <ul className="space-y-1">
          {task.links.map((l) => (
            <li
              key={`${l.direction}-${l.type}-${l.task.id}`}
              className="flex items-center gap-2 text-sm"
            >
              <span className="w-28 shrink-0 text-xs text-muted-foreground">{l.label}</span>
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left hover:underline"
                onClick={() => drawer.open(l.task.id)}
              >
                <span className="font-mono text-xs text-muted-foreground">{l.task.key}</span>{' '}
                {l.task.title}
              </button>
              <span className="text-xs text-muted-foreground">{STATUS_LABELS[l.task.status]}</span>
              {editable ? (
                <button
                  type="button"
                  aria-label={`Remove link to ${l.task.key}`}
                  onClick={() => remove.mutate({ type: l.type, id: l.task.id })}
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          No links. Blocking work is shown under Dependencies.
        </p>
      )}
      {editable ? (
        <div className="relative flex gap-2">
          <Select value={type} onValueChange={(v) => setType(v as LinkType)}>
            <SelectTrigger size="sm" className="w-36" aria-label="Link type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LINK_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {LINK_LABELS[t].outward}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="h-8"
            placeholder="Search by key or title…"
            aria-label="Link to task"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {debounced.length > 1 && options.length ? (
            <ul className="absolute top-9 right-0 z-20 w-[calc(100%-9.5rem)] rounded-lg border bg-popover p-1 shadow-md">
              {options.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={() => {
                      add.mutate(o.id);
                      setQ('');
                    }}
                  >
                    <span className="font-mono text-xs text-muted-foreground">{o.key}</span>{' '}
                    {o.title}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function CloneTaskDialog({ task, onClose }: { task: TaskDto; onClose: () => void }) {
  const drawer = useTaskDrawer();
  const [title, setTitle] = useState(task.title);
  const [withSubtasks, setWithSubtasks] = useState(true);
  const clone = useAgileMutation(
    () => agileApi.cloneTask(task.id, { title: title.trim(), includeSubtasks: withSubtasks }),
    {
      success: (t) => `${t.key} created as a clone of ${task.key}`,
    },
  );
  return (
    <Dialog open onOpenChange={(o) => !o && !clone.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Clone {task.key}</DialogTitle>
          <DialogDescription>
            The copy starts in To Do, outside any sprint, and is linked to the original.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={title}
            aria-label="Title of the copy"
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
          {task.subtaskCount ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={withSubtasks}
                onCheckedChange={(c) => setWithSubtasks(c === true)}
              />
              Also copy {task.subtaskCount} subtask(s)
            </label>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={clone.isPending}>
            Cancel
          </Button>
          <Button
            disabled={title.trim().length < 2 || clone.isPending}
            onClick={() =>
              clone.mutate(undefined, { onSuccess: (t) => (onClose(), drawer.open(t.id)) })
            }
          >
            Clone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MoveTaskDialog({ task, onClose }: { task: TaskDto; onClose: () => void }) {
  const projects = useProjects({ limit: 100, sort: 'name', archived: 'false' });
  const [target, setTarget] = useState('');
  const move = useAgileMutation(() => agileApi.moveTaskToProject(task.id, target), {
    success: (t) => `${task.key} is now ${t.key}`,
  });
  const options = (projects.data?.items ?? []).filter(
    (p) => p.id !== task.project.id && p.can.createTask,
  );
  return (
    <Dialog open onOpenChange={(o) => !o && !move.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move {task.key} to another project</DialogTitle>
          <DialogDescription>
            It gets a new key (the old one still finds it in search). Sprint, epic, milestone and
            fix version are cleared; subtasks move with it; the assignee is kept only if they are on
            the new project.
          </DialogDescription>
        </DialogHeader>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger className="w-full" aria-label="Target project">
            <SelectValue placeholder="Choose a project" />
          </SelectTrigger>
          <SelectContent>
            {options.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.key} · {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={move.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!target || move.isPending}
            onClick={() => move.mutate(undefined, { onSuccess: onClose })}
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
