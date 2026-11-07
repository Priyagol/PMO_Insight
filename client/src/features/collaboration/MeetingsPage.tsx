import { format } from 'date-fns';
import {
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  ListPlus,
  MapPin,
  Plus,
  Presentation,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  MEETING_TYPES,
  MEETING_TYPE_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  type MeetingDto,
  type MeetingQuery,
  type MeetingType,
  type Priority,
  type UserRef,
} from '@arihant/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { FormField } from '@/components/common/FormField';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
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
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { MultiUserPicker } from '@/features/org/components/MultiUserPicker';
import { todayIso } from '@/features/work/format';
import { useProject, useProjects } from '@/features/work/hooks';
import { useCan } from '@/hooks/use-permission';
import * as api from '@/services/api/collaboration';
import { MinutesAiButton } from '@/features/intelligence/ai-actions';
import { useCollabMutation, useMeeting, useMeetings } from './hooks';

const NONE = '__none__';
const when = (m: Pick<MeetingDto, 'startAt' | 'endAt'>) =>
  `${format(new Date(m.startAt), 'EEE d MMM yyyy, HH:mm')}–${format(new Date(m.endAt), 'HH:mm')}`;
const lines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

function MeetingStatus({ m }: { m: MeetingDto }) {
  if (m.status === 'cancelled')
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium">
        <XCircle className="size-3.5" style={{ color: 'var(--status-critical)' }} aria-hidden />{' '}
        Cancelled
      </span>
    );
  if (m.minutesPublishedAt)
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium">
        <CheckCircle2 className="size-3.5" style={{ color: 'var(--status-good)' }} aria-hidden />{' '}
        Minutes published
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <CalendarClock className="size-3.5" aria-hidden /> Scheduled
    </span>
  );
}

/* ============================ Create ============================ */

export function NewMeetingDialog({
  projectId,
  onClose,
}: {
  projectId?: string;
  onClose: () => void;
}) {
  const [project, setProject] = useState(projectId ?? '');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<MeetingType>('review');
  const [date, setDate] = useState(todayIso());
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('10:30');
  const [location, setLocation] = useState('');
  const [people, setPeople] = useState<UserRef[]>([]);
  const [agenda, setAgenda] = useState('');
  const projects = useProjects({ limit: 100, archived: 'false' }, !projectId);
  const toIso = (t: string) => new Date(`${date}T${t}`).toISOString();
  const save = useCollabMutation(
    () =>
      api.createMeeting({
        projectId: project,
        title: title.trim(),
        type,
        startAt: toIso(start),
        endAt: toIso(end),
        location: location.trim() || undefined,
        participantIds: people.map((p) => p.id),
        agenda: lines(agenda),
      }),
    { success: (m) => `"${m.title}" scheduled; ${m.participants.length} invited` },
  );
  const timeError = start && end && start >= end ? 'End must be after the start' : undefined;
  const valid = project && title.trim().length >= 2 && date && !timeError;
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Schedule a meeting</DialogTitle>
          <DialogDescription>
            Participants are notified. Times are in your local time zone.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-3">
          {!projectId ? (
            <FormField label="Project" required className="sm:col-span-3">
              <Select value={project} onValueChange={setProject}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.data?.items.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.key} · {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : null}
          <FormField label="Title" required className="sm:col-span-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
          </FormField>
          <FormField label="Type">
            <Select value={type} onValueChange={(v) => setType(v as MeetingType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEETING_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {MEETING_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Date" required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FormField>
          <FormField label="Start" required>
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </FormField>
          <FormField label="End" required error={timeError}>
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </FormField>
          <FormField label="Location or link" className="sm:col-span-3">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} />
          </FormField>
          <FormField
            label="Participants"
            className="sm:col-span-3"
            hint="You are included automatically."
          >
            <MultiUserPicker value={people} onChange={setPeople} />
          </FormField>
          <FormField label="Agenda" className="sm:col-span-3" hint="One item per line">
            <Textarea rows={3} value={agenda} onChange={(e) => setAgenda(e.target.value)} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!valid || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onClose })}
          >
            Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================ Minutes ============================ */

interface DraftItem {
  id?: string;
  text: string;
  assigneeId: string | null;
  dueDate: string;
  priority: Priority;
}

function MinutesEditor({ m }: { m: MeetingDto }) {
  const project = useProject(m.project.id);
  const canCreateTask = useCan('task:create');
  const [minutes, setMinutes] = useState(m.minutes ?? '');
  const [decisions, setDecisions] = useState(m.decisions.join('\n'));
  const [items, setItems] = useState<DraftItem[]>(
    m.actionItems.map((a) => ({
      id: a.id,
      text: a.text,
      assigneeId: a.assignee?.id ?? null,
      dueDate: a.dueDate ?? '',
      priority: a.priority,
    })),
  );
  const save = useCollabMutation(
    (publish: boolean) =>
      api.saveMinutes(m.id, {
        minutes,
        decisions: lines(decisions),
        actionItems: items
          .filter((i) => i.text.trim().length >= 2)
          .map((i) => ({
            ...(i.id ? { id: i.id } : {}),
            text: i.text.trim(),
            assigneeId: i.assigneeId,
            dueDate: i.dueDate || null,
            priority: i.priority,
          })),
        publish,
      }),
    {
      success: (r) =>
        r.minutesPublishedAt && !m.minutesPublishedAt
          ? 'Minutes published; participants notified'
          : 'Minutes saved',
    },
  );
  const convert = useCollabMutation((itemId: string) => api.convertActionItem(m.id, itemId), {
    success: 'Task created from action item',
  });
  const members = project.data?.members ?? [];
  const patch = (i: number, p: Partial<DraftItem>) =>
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const saved = new Map(m.actionItems.map((a) => [a.id, a]));

  return (
    <section className="space-y-3" aria-label="Minutes">
      <FormField label="Minutes">
        <Textarea
          rows={6}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          placeholder="What was discussed"
        />
      </FormField>
      <MinutesAiButton
        meetingId={m.id}
        text={minutes}
        onDraft={(r) => {
          setDecisions([...lines(decisions), ...r.proposal.decisions].join('\n'));
          setItems((xs) => [
            ...xs,
            ...r.proposal.actionItems.map((a) => ({
              text: a.text,
              assigneeId: a.ownerRef ? (r.owners[a.ownerRef]?.id ?? null) : null,
              dueDate: a.dueDate ?? '',
              priority: a.priority,
            })),
          ]);
          toast.success('AI draft added below. Review it, then save.');
        }}
      />
      <FormField label="Decisions" hint="One per line">
        <Textarea rows={3} value={decisions} onChange={(e) => setDecisions(e.target.value)} />
      </FormField>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Action items</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setItems((xs) => [
                ...xs,
                { text: '', assigneeId: null, dueDate: '', priority: 'medium' },
              ])
            }
          >
            <ListPlus /> Add item
          </Button>
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No action items.</p>
        ) : null}
        {items.map((it, i) => {
          const s = it.id ? saved.get(it.id) : undefined;
          return (
            <div key={it.id ?? `new-${i}`} className="space-y-2 rounded-lg border p-2">
              <Input
                aria-label={`Action item ${i + 1}`}
                placeholder="What needs to happen"
                value={it.text}
                onChange={(e) => patch(i, { text: e.target.value })}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={it.assigneeId ?? NONE}
                  onValueChange={(v) => patch(i, { assigneeId: v === NONE ? null : v })}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-44"
                    aria-label={`Action item ${i + 1} owner`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No owner</SelectItem>
                    {members.map((mm) => (
                      <SelectItem key={mm.user.id} value={mm.user.id}>
                        {mm.user.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="date"
                  className="h-8 w-40"
                  aria-label={`Action item ${i + 1} due date`}
                  value={it.dueDate}
                  onChange={(e) => patch(i, { dueDate: e.target.value })}
                />
                <Select
                  value={it.priority}
                  onValueChange={(v) => patch(i, { priority: v as Priority })}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-28"
                    aria-label={`Action item ${i + 1} priority`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {PRIORITY_LABELS[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {s?.task ? (
                  <Link
                    to={`?open=${m.id}&task=${s.task.id}`}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    {s.task.key} <StatusBadge status={s.task.status} />
                  </Link>
                ) : s && canCreateTask ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={convert.isPending}
                    onClick={() => convert.mutate(s.id)}
                  >
                    <Plus /> Create task
                  </Button>
                ) : null}
                {!s?.task ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto size-7"
                    aria-label={`Remove action item ${i + 1}`}
                    onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate(false)}>
          Save
        </Button>
        {!m.minutesPublishedAt ? (
          <Button disabled={save.isPending} onClick={() => save.mutate(true)}>
            Save &amp; publish
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/** Read-only minutes for participants who cannot edit. */
function MinutesView({ m }: { m: MeetingDto }) {
  if (!m.minutesPublishedAt)
    return <p className="text-sm text-muted-foreground">Minutes have not been published yet.</p>;
  return (
    <section className="space-y-3 text-sm" aria-label="Minutes">
      {m.minutes ? <p className="whitespace-pre-wrap">{m.minutes}</p> : null}
      {m.decisions.length ? (
        <div>
          <h4 className="font-medium">Decisions</h4>
          <ul className="list-disc pl-5">
            {m.decisions.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {m.actionItems.length ? (
        <div>
          <h4 className="font-medium">Action items</h4>
          <ul className="space-y-1">
            {m.actionItems.map((a) => (
              <li key={a.id}>
                {a.text}{' '}
                <span className="text-xs text-muted-foreground">
                  · {a.assignee?.name ?? 'No owner'}
                  {a.dueDate ? ` · due ${a.dueDate}` : ''}
                  {a.task ? ` · ${a.task.key}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function MeetingDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useMeeting(id);
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null);
  const cancel = useCollabMutation(() => api.updateMeeting(id, { status: 'cancelled' }), {
    success: 'Meeting cancelled; participants notified',
  });
  const remove = useCollabMutation(() => api.deleteMeeting(id), { success: 'Meeting deleted' });
  const m = q.data;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {q.error ? (
          <ErrorState error={q.error} />
        ) : !m ? (
          <Skeleton className="m-4 h-64" />
        ) : (
          <div className="space-y-5 p-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                <Link to={`/projects/${m.project.id}`} className="hover:underline">
                  {m.project.key} · {m.project.name}
                </Link>{' '}
                · {MEETING_TYPE_LABELS[m.type]}
              </p>
              <SheetTitle>{m.title}</SheetTitle>
              <SheetDescription>{when(m)}</SheetDescription>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <MeetingStatus m={m} />
                {m.location ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3.5" aria-hidden /> {m.location}
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3.5" aria-hidden />{' '}
                  {m.participants.map((p) => p.name).join(', ')}
                </span>
              </div>
            </div>
            {m.agenda.length ? (
              <section>
                <h4 className="mb-1 text-sm font-semibold">Agenda</h4>
                <ol className="list-decimal pl-5 text-sm">
                  {m.agenda.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ol>
              </section>
            ) : null}
            {m.can.edit && m.status !== 'cancelled' ? (
              <MinutesEditor key={m.minutesPublishedAt ?? 'draft'} m={m} />
            ) : (
              <MinutesView m={m} />
            )}
            {m.can.edit && m.status === 'scheduled' ? (
              <div className="flex gap-2 border-t pt-3">
                <Button variant="outline" size="sm" onClick={() => setConfirm('cancel')}>
                  Cancel meeting
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirm('delete')}>
                  <Trash2 /> Delete
                </Button>
              </div>
            ) : null}
          </div>
        )}
        <ConfirmDialog
          open={confirm !== null}
          onOpenChange={(o) => !o && setConfirm(null)}
          title={confirm === 'delete' ? 'Delete this meeting?' : 'Cancel this meeting?'}
          description={
            confirm === 'delete'
              ? 'It is removed from everyone’s list.'
              : 'Participants are notified. The meeting stays on record as cancelled.'
          }
          confirmLabel={confirm === 'delete' ? 'Delete' : 'Cancel meeting'}
          destructive
          onConfirm={async () => {
            if (confirm === 'delete') {
              await remove.mutateAsync(undefined);
              onClose();
            } else await cancel.mutateAsync(undefined);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

/* ============================ List ============================ */

export function MeetingList({
  projectId,
  onOpen,
}: {
  projectId?: string;
  onOpen: (id: string) => void;
}) {
  const [view, setView] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const [mine, setMine] = useState(false);
  const [now] = useState(() => new Date().toISOString());
  const q: Partial<MeetingQuery> = {
    limit: 50,
    projectId,
    mine: mine ? 'true' : undefined,
    ...(view === 'upcoming' ? { from: now, sort: 'startAt' } : view === 'past' ? { to: now } : {}),
  };
  const list = useMeetings(q);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Meeting filters">
        {(['upcoming', 'past', 'all'] as const).map((v) => (
          <Button
            key={v}
            size="sm"
            variant={view === v ? 'secondary' : 'ghost'}
            aria-pressed={view === v}
            onClick={() => setView(v)}
          >
            {v === 'upcoming' ? 'Upcoming' : v === 'past' ? 'Past' : 'All'}
          </Button>
        ))}
        <Button
          size="sm"
          variant={mine ? 'secondary' : 'ghost'}
          aria-pressed={mine}
          onClick={() => setMine((x) => !x)}
        >
          Only mine
        </Button>
      </div>
      {list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <Skeleton className="h-40" />
      ) : !list.data?.items.length ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            compact
            icon={Presentation}
            title={view === 'upcoming' ? 'No upcoming meetings' : 'No meetings'}
          />
        </div>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {list.data.items.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50"
                onClick={() => onOpen(m.id)}
              >
                <span className="w-44 shrink-0 text-xs text-muted-foreground tabular">
                  {when(m)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{m.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {projectId ? '' : `${m.project.key} · `}
                    {MEETING_TYPE_LABELS[m.type]} · {m.participants.length} participants
                    {m.actionItems.length ? ` · ${m.actionItems.length} action items` : ''}
                  </span>
                </span>
                <MeetingStatus m={m} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MeetingsHost({
  projectId,
  canSchedule,
}: {
  projectId?: string;
  canSchedule: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const openId = params.get('open');
  const [creating, setCreating] = useState(false);
  const setOpen = (id: string | null) =>
    setParams((p) => {
      if (id) p.set('open', id);
      else p.delete('open');
      return p;
    });
  return (
    <div className="space-y-3">
      {canSchedule ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreating(true)}>
            <CalendarPlus /> Schedule meeting
          </Button>
        </div>
      ) : null}
      <MeetingList projectId={projectId} onOpen={setOpen} />
      {openId ? <MeetingDetail id={openId} onClose={() => setOpen(null)} /> : null}
      {creating ? (
        <NewMeetingDialog projectId={projectId} onClose={() => setCreating(false)} />
      ) : null}
    </div>
  );
}

export function MeetingsPage() {
  const canWrite = useCan('meeting:write');
  return (
    <div className="space-y-5">
      <PageHeader
        title="Meetings"
        description="Agendas, minutes, decisions and action items that become tasks."
      />
      <MeetingsHost canSchedule={canWrite} />
    </div>
  );
}
