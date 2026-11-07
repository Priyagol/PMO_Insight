import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  ClipboardList,
  MessageSquareQuote,
  Pencil,
  Plus,
  Star,
  Trash2,
  Undo2,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  CHANGE_IMPACTS,
  CHANGE_REQUEST_STATUS_LABELS,
  FEEDBACK_CATEGORIES,
  PRIORITIES,
  PRIORITY_LABELS,
  STAKEHOLDER_TYPES,
  STAKEHOLDER_TYPE_LABELS,
  type ChangeRequestDto,
  type Priority,
  type StakeholderDto,
  type StakeholderType,
} from '@arihant/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { FormField } from '@/components/common/FormField';
import { PageHeader } from '@/components/common/PageHeader';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { formatDay, todayIso } from '@/features/work/format';
import { useProjects } from '@/features/work/hooks';
import { useCan } from '@/hooks/use-permission';
import * as api from '@/services/api/delivery';
import { useDeliveryMutation } from './hooks';
import { useAppSelector } from '@/store';

const NONE = '__none__';
const inr = (n: number) =>
  n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

function ProjectSelect({
  value,
  onChange,
  label = 'Project',
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  const projects = useProjects({ limit: 100, archived: 'false' });
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full" aria-label={label}>
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
  );
}

/* ============================ Stakeholders ============================ */

function StakeholderDialog({ s, onClose }: { s?: StakeholderDto; onClose: () => void }) {
  const projects = useProjects({ limit: 100, archived: 'false' });
  const [name, setName] = useState(s?.name ?? '');
  const [organisation, setOrganisation] = useState(s?.organisation ?? '');
  const [role, setRole] = useState(s?.role ?? '');
  const [type, setType] = useState<StakeholderType>(s?.type ?? 'client');
  const [email, setEmail] = useState(s?.email ?? '');
  const [phone, setPhone] = useState(s?.phone ?? '');
  const [influence, setInfluence] = useState(s?.influence ?? 'medium');
  const [interest, setInterest] = useState(s?.interest ?? 'medium');
  const [projectIds, setProjectIds] = useState<string[]>(s?.projects.map((p) => p.id) ?? []);
  const [notes, setNotes] = useState(s?.notes ?? '');
  const body = {
    name: name.trim(),
    organisation: organisation.trim() || undefined,
    role: role.trim() || undefined,
    type,
    email: email.trim() || undefined,
    phone: phone.trim() || undefined,
    influence,
    interest,
    projectIds,
    notes: notes.trim() || undefined,
  };
  const save = useDeliveryMutation(
    () =>
      s
        ? api.updateStakeholder(s.id, {
            ...body,
            organisation: body.organisation ?? null,
            role: body.role ?? null,
            email: body.email ?? null,
            phone: body.phone ?? null,
            notes: body.notes ?? null,
          })
        : api.createStakeholder(body),
    { success: s ? 'Stakeholder saved' : 'Stakeholder added' },
  );
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{s ? 'Edit stakeholder' : 'Add stakeholder'}</DialogTitle>
          <DialogDescription>
            Contact details are visible to people who can see the linked projects.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </FormField>
          <FormField label="Organisation">
            <Input
              value={organisation}
              onChange={(e) => setOrganisation(e.target.value)}
              maxLength={120}
            />
          </FormField>
          <FormField label="Role / title">
            <Input value={role} onChange={(e) => setRole(e.target.value)} maxLength={120} />
          </FormField>
          <FormField label="Type">
            <Select value={type} onValueChange={(v) => setType(v as StakeholderType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAKEHOLDER_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {STAKEHOLDER_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="E-mail">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={200}
            />
          </FormField>
          <FormField label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
          </FormField>
          <FormField label="Influence">
            <Select value={influence} onValueChange={(v) => setInfluence(v as typeof influence)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['low', 'medium', 'high'] as const).map((x) => (
                  <SelectItem key={x} value={x}>
                    {x}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Interest">
            <Select value={interest} onValueChange={(v) => setInterest(v as typeof interest)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['low', 'medium', 'high'] as const).map((x) => (
                  <SelectItem key={x} value={x}>
                    {x}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <fieldset className="space-y-1 sm:col-span-2">
            <legend className="text-sm font-medium">Projects</legend>
            <div className="flex max-h-32 flex-wrap gap-x-4 gap-y-1 overflow-y-auto">
              {projects.data?.items.map((p) => (
                <label key={p.id} className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={projectIds.includes(p.id)}
                    onCheckedChange={(c) =>
                      setProjectIds((ids) =>
                        c === true ? [...ids, p.id] : ids.filter((x) => x !== p.id),
                      )
                    }
                  />
                  {p.key} · {p.name}
                </label>
              ))}
            </div>
          </fieldset>
          <FormField label="Notes" className="sm:col-span-2">
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={5000}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            disabled={name.trim().length < 2 || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onClose })}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StakeholdersTab() {
  const canWrite = useCan('stakeholder:write');
  const list = useQuery({
    queryKey: ['stakeholders', 'list'],
    queryFn: () => api.fetchStakeholders({ limit: 100 }),
  });
  const [editing, setEditing] = useState<StakeholderDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<StakeholderDto | null>(null);
  const remove = useDeliveryMutation((id: string) => api.deleteStakeholder(id), {
    success: 'Stakeholder removed',
  });
  if (list.error) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  if (!list.data) return <Skeleton className="h-40" />;
  return (
    <div className="space-y-3">
      {canWrite ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus /> Add stakeholder
          </Button>
        </div>
      ) : null}
      {list.data.items.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={Users}
            title="No stakeholders yet"
            description="Record clients, vendors, regulators and internal sponsors and link them to projects."
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-left font-medium">Influence / interest</th>
                <th className="px-3 py-2 text-left font-medium">Projects</th>
                <th className="px-3 py-2 text-right font-medium">Open CRs</th>
                <th className="px-3 py-2 text-right font-medium">Avg rating</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((s) => (
                <tr key={s.id} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[s.role, s.organisation].filter(Boolean).join(', ')}
                      {s.email ? ` · ${s.email}` : ''}
                    </p>
                  </td>
                  <td className="px-3 py-2">{STAKEHOLDER_TYPE_LABELS[s.type]}</td>
                  <td className="px-3 py-2 text-xs">
                    {s.influence} / {s.interest}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {s.projects.map((p) => p.key).join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular">{s.openChangeRequests}</td>
                  <td className="px-3 py-2 text-right tabular">{s.averageRating ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {s.can.edit ? (
                      <span className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Edit ${s.name}`}
                          onClick={() => setEditing(s)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Remove ${s.name}`}
                          onClick={() => setDeleting(s)}
                        >
                          <Trash2 />
                        </Button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing ? (
        <StakeholderDialog
          s={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Remove ${deleting?.name ?? ''}?`}
        description="Change requests and feedback already recorded are kept."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (deleting) await remove.mutateAsync(deleting.id);
        }}
      />
    </div>
  );
}

/* ============================ Change requests ============================ */

function ChangeRequestDialog({ projectId, onClose }: { projectId?: string; onClose: () => void }) {
  const canSeeStakeholders = useCan('stakeholder:read');
  const [project, setProject] = useState(projectId ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [reason, setReason] = useState('');
  const [impacts, setImpacts] = useState<(typeof CHANGE_IMPACTS)[number][]>([]);
  const [priority, setPriority] = useState<Priority>('medium');
  const [hours, setHours] = useState('');
  const [cost, setCost] = useState('');
  const [days, setDays] = useState('');
  const [stakeholder, setStakeholder] = useState(NONE);
  const stakeholders = useQuery({
    queryKey: ['stakeholders', 'for', project],
    queryFn: () => api.fetchStakeholders({ projectId: project, limit: 100 }),
    enabled: Boolean(project) && canSeeStakeholders,
  });
  const num = (v: string) => (v === '' ? null : Number(v));
  const save = useDeliveryMutation(
    () =>
      api.createChangeRequest({
        projectId: project,
        stakeholderId: stakeholder === NONE ? null : stakeholder,
        title: title.trim(),
        description: description.trim() || undefined,
        reason: reason.trim() || undefined,
        impacts,
        priority,
        estimatedHours: num(hours),
        costImpact: num(cost),
        scheduleImpactDays: num(days),
      }),
    { success: (c) => `${c.key} saved as a draft` },
  );
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New change request</DialogTitle>
          <DialogDescription>
            Saved as a draft. Submitting it starts the change-request approval.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-3">
          {!projectId ? (
            <FormField label="Project" required className="sm:col-span-3">
              <ProjectSelect value={project} onChange={setProject} />
            </FormField>
          ) : null}
          <FormField label="Title" required className="sm:col-span-3">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
          </FormField>
          <FormField label="What should change" className="sm:col-span-3">
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </FormField>
          <FormField label="Why" className="sm:col-span-3">
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          {canSeeStakeholders ? (
            <FormField label="Requested by (stakeholder)" className="sm:col-span-2">
              <Select value={stakeholder} onValueChange={setStakeholder} disabled={!project}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Internal / not linked</SelectItem>
                  {stakeholders.data?.items.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                      {s.organisation ? ` (${s.organisation})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : null}
          <FormField label="Priority">
            <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
              <SelectTrigger className="w-full">
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
          </FormField>
          <fieldset className="flex flex-wrap gap-3 sm:col-span-3">
            <legend className="mb-1 text-sm font-medium">Impact on</legend>
            {CHANGE_IMPACTS.map((i) => (
              <label key={i} className="flex items-center gap-1.5 text-sm capitalize">
                <Checkbox
                  checked={impacts.includes(i)}
                  onCheckedChange={(c) =>
                    setImpacts((xs) => (c === true ? [...xs, i] : xs.filter((x) => x !== i)))
                  }
                />
                {i}
              </label>
            ))}
          </fieldset>
          <FormField label="Effort (h)">
            <Input type="number" min={0} value={hours} onChange={(e) => setHours(e.target.value)} />
          </FormField>
          <FormField label="Cost impact (₹)">
            <Input type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
          </FormField>
          <FormField label="Schedule impact (days)">
            <Input type="number" value={days} onChange={(e) => setDays(e.target.value)} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!project || title.trim().length < 3 || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onClose })}
          >
            Save draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CrActions({ cr }: { cr: ChangeRequestDto }) {
  const canCreateTask = useCan('task:create');
  const meId = useAppSelector((s) => s.session.user?.id);
  const submit = useDeliveryMutation(() => api.submitChangeRequest(cr.id), {
    success: `${cr.key} submitted for approval`,
  });
  const withdraw = useDeliveryMutation(() => api.withdrawChangeRequest(cr.id), {
    success: `${cr.key} withdrawn`,
  });
  const task = useDeliveryMutation(() => api.changeRequestTask(cr.id), {
    success: (r) => `Task ${r.implementationTask?.key} created`,
  });
  const done = useDeliveryMutation(() => api.changeRequestImplemented(cr.id), {
    success: `${cr.key} marked implemented`,
  });
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {cr.can.submit ? (
        <Button
          size="sm"
          variant="outline"
          disabled={submit.isPending}
          onClick={() => submit.mutate(undefined)}
        >
          <CheckCircle2 /> Submit
        </Button>
      ) : null}
      {(cr.status === 'draft' || cr.status === 'submitted') && cr.raisedBy?.id === meId ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={withdraw.isPending}
          onClick={() => withdraw.mutate(undefined)}
          aria-label={`Withdraw ${cr.key}`}
        >
          <Undo2 />
        </Button>
      ) : null}
      {cr.status === 'approved' && !cr.implementationTask && canCreateTask ? (
        <Button
          size="sm"
          variant="outline"
          disabled={task.isPending}
          onClick={() => task.mutate(undefined)}
        >
          <Plus /> Create task
        </Button>
      ) : null}
      {cr.status === 'approved' ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={done.isPending}
          onClick={() => done.mutate(undefined)}
        >
          Mark implemented
        </Button>
      ) : null}
    </span>
  );
}

export function ChangeRequestsHost({ projectId }: { projectId?: string }) {
  const [creating, setCreating] = useState(false);
  const query = { projectId, limit: 50 };
  const list = useQuery({
    queryKey: ['change-requests', 'list', query],
    queryFn: () => api.fetchChangeRequests(query),
  });
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus /> New change request
        </Button>
      </div>
      {list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <Skeleton className="h-40" />
      ) : !list.data?.items.length ? (
        <div className="rounded-xl border bg-card">
          <EmptyState icon={ClipboardList} title="No change requests" />
        </div>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {list.data.items.map((cr) => (
            <li key={cr.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  <span className="font-mono text-xs text-muted-foreground">{cr.key}</span>{' '}
                  {cr.title}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {projectId ? '' : `${cr.project.key} · `}
                  {CHANGE_REQUEST_STATUS_LABELS[cr.status]}
                  {cr.stakeholder ? ` · from ${cr.stakeholder.name}` : ''}
                  {cr.impacts.length ? ` · ${cr.impacts.join(', ')}` : ''}
                  {cr.costImpact != null ? ` · ${inr(cr.costImpact)}` : ''}
                  {cr.estimatedHours != null ? ` · ${cr.estimatedHours} h` : ''}
                </span>
                {cr.approval ? (
                  <Link
                    to={`/approvals?open=${cr.approval.id}`}
                    className="text-xs text-primary hover:underline"
                  >
                    {cr.approval.key} ({cr.approval.status})
                  </Link>
                ) : null}
                {cr.implementationTask ? (
                  <Link
                    to={`?task=${cr.implementationTask.id}`}
                    className="ml-2 text-xs text-primary hover:underline"
                  >
                    Task {cr.implementationTask.key}
                  </Link>
                ) : null}
              </span>
              <CrActions cr={cr} />
            </li>
          ))}
        </ul>
      )}
      {creating ? (
        <ChangeRequestDialog projectId={projectId} onClose={() => setCreating(false)} />
      ) : null}
    </div>
  );
}

/* ============================ Feedback ============================ */

function FeedbackTab() {
  const canWrite = useCan('stakeholder:write');
  const list = useQuery({
    queryKey: ['feedback', 'list'],
    queryFn: () => api.fetchFeedback({ limit: 50 }),
  });
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState('');
  const [stakeholder, setStakeholder] = useState('');
  const [rating, setRating] = useState(4);
  const [category, setCategory] = useState<(typeof FEEDBACK_CATEGORIES)[number]>('delivery');
  const [comment, setComment] = useState('');
  const [receivedOn, setReceivedOn] = useState(todayIso());
  const stakeholders = useQuery({
    queryKey: ['stakeholders', 'for', project],
    queryFn: () => api.fetchStakeholders({ projectId: project, limit: 100 }),
    enabled: Boolean(project),
  });
  const save = useDeliveryMutation(
    () =>
      api.recordFeedback({
        projectId: project,
        stakeholderId: stakeholder,
        rating,
        category,
        comment: comment.trim() || undefined,
        receivedOn,
      }),
    { success: 'Feedback recorded' },
  );
  return (
    <div className="space-y-3">
      {canWrite ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus /> Record feedback
          </Button>
        </div>
      ) : null}
      {list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <Skeleton className="h-40" />
      ) : list.data.items.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState icon={MessageSquareQuote} title="No feedback recorded" />
        </div>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {list.data.items.map((f) => (
            <li key={f.id} className="px-4 py-3 text-sm">
              <p className="flex items-center gap-2">
                <span
                  className="inline-flex items-center gap-0.5"
                  aria-label={`${f.rating} out of 5`}
                >
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star
                      key={i}
                      className="size-3.5"
                      style={{ color: i < f.rating ? 'var(--status-warning)' : 'var(--border)' }}
                      fill={i < f.rating ? 'currentColor' : 'none'}
                      aria-hidden
                    />
                  ))}
                </span>
                <span className="font-medium">{f.stakeholder.name}</span>
                <span className="text-xs text-muted-foreground">
                  {f.project.key} · {f.category} · {formatDay(f.receivedOn)}
                </span>
              </p>
              {f.comment ? <p className="mt-1 text-muted-foreground">{f.comment}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <Dialog open onOpenChange={(o) => !o && !save.isPending && setOpen(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Record stakeholder feedback</DialogTitle>
              <DialogDescription>
                For example, from a review meeting or a satisfaction survey.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <FormField label="Project" required>
                <ProjectSelect
                  value={project}
                  onChange={(v) => (setProject(v), setStakeholder(''))}
                />
              </FormField>
              <FormField label="Stakeholder" required>
                <Select value={stakeholder} onValueChange={setStakeholder} disabled={!project}>
                  <SelectTrigger className="w-full" aria-label="Stakeholder">
                    <SelectValue placeholder="Choose" />
                  </SelectTrigger>
                  <SelectContent>
                    {stakeholders.data?.items.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <div className="grid grid-cols-3 gap-3">
                <FormField label="Rating (1–5)">
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    value={rating}
                    onChange={(e) => setRating(Number(e.target.value))}
                  />
                </FormField>
                <FormField label="About">
                  <Select value={category} onValueChange={(v) => setCategory(v as typeof category)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FEEDBACK_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="Received">
                  <Input
                    type="date"
                    value={receivedOn}
                    onChange={(e) => setReceivedOn(e.target.value)}
                  />
                </FormField>
              </div>
              <FormField label="Comment">
                <Textarea
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={5000}
                />
              </FormField>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={save.isPending}>
                Cancel
              </Button>
              <Button
                disabled={!project || !stakeholder || rating < 1 || rating > 5 || save.isPending}
                onClick={() => save.mutate(undefined, { onSuccess: () => setOpen(false) })}
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

export function StakeholdersPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Stakeholders"
        description="Who has a stake in each project, what they asked to change, and what they think."
      />
      <Tabs defaultValue="stakeholders">
        <TabsList>
          <TabsTrigger value="stakeholders">Stakeholders</TabsTrigger>
          <TabsTrigger value="changes">Change requests</TabsTrigger>
          <TabsTrigger value="feedback">Feedback</TabsTrigger>
        </TabsList>
        <TabsContent value="stakeholders" className="mt-4">
          <StakeholdersTab />
        </TabsContent>
        <TabsContent value="changes" className="mt-4">
          <ChangeRequestsHost />
        </TabsContent>
        <TabsContent value="feedback" className="mt-4">
          <FeedbackTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
