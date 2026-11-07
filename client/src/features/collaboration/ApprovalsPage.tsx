import type { ColumnDef } from '@tanstack/react-table';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  type Circle,
  CircleDashed,
  Clock3,
  Plus,
  SkipForward,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  APPROVAL_ENTITY_LABELS,
  USER_APPROVAL_TYPES,
  APPROVER_TYPE_LABELS,
  approvalWorkflowSchema,
  type ApprovalDto,
  type ApprovalStageDef,
  type ApprovalStageStatus,
  type ApprovalStatus,
  type ApprovalWorkflowDto,
  type ApproverType,
  type UserRef,
} from '@arihant/shared';
import { DataTable } from '@/components/common/DataTable';
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
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { UserPicker } from '@/features/org/components/UserPicker';
import { useRoles } from '@/features/org/hooks';
import { useProjects } from '@/features/work/hooks';
import { useCan } from '@/hooks/use-permission';
import { cn } from '@/lib/utils';
import * as api from '@/services/api/collaboration';
import { useApproval, useApprovals, useCollabMutation, useWorkflows } from './hooks';

type UserApprovalType = (typeof USER_APPROVAL_TYPES)[number];
const inr = (n: number) =>
  n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

const STATUS: Record<ApprovalStatus, { label: string; icon: typeof Circle; color: string }> = {
  pending: { label: 'Pending', icon: Clock3, color: 'var(--status-warning)' },
  approved: { label: 'Approved', icon: CheckCircle2, color: 'var(--status-good)' },
  rejected: { label: 'Rejected', icon: XCircle, color: 'var(--status-critical)' },
  cancelled: { label: 'Withdrawn', icon: Ban, color: 'var(--muted-foreground)' },
};
export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  const s = STATUS[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <s.icon className="size-3.5" style={{ color: s.color }} aria-hidden />
      {s.label}
    </span>
  );
}

const STAGE: Record<ApprovalStageStatus, { label: string; icon: typeof Circle; color: string }> = {
  waiting: { label: 'Waiting', icon: CircleDashed, color: 'var(--muted-foreground)' },
  pending: { label: 'Awaiting decision', icon: Clock3, color: 'var(--status-warning)' },
  approved: { label: 'Approved', icon: CheckCircle2, color: 'var(--status-good)' },
  rejected: { label: 'Rejected', icon: XCircle, color: 'var(--status-critical)' },
  skipped: { label: 'Skipped', icon: SkipForward, color: 'var(--muted-foreground)' },
};

/* ============================ New request ============================ */

export function NewApprovalDialog({
  projectId,
  entityType: fixedType,
  onClose,
}: {
  projectId?: string;
  entityType?: UserApprovalType;
  onClose: () => void;
}) {
  const [project, setProject] = useState(projectId ?? '');
  const [type, setType] = useState<UserApprovalType>(fixedType ?? 'general');
  const [title, setTitle] = useState(
    fixedType === 'project_closure' ? 'Project closure sign-off' : '',
  );
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const projects = useProjects({ limit: 100, archived: 'false' }, !projectId);
  const save = useCollabMutation(
    () =>
      api.createApproval({
        entityType: type,
        projectId: project,
        title: title.trim(),
        description: description.trim() || undefined,
        amount: amount ? Number(amount) : null,
      }),
    { success: (a) => `${a.key} sent for approval` },
  );
  const valid = project && title.trim().length >= 3;
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {fixedType === 'project_closure' ? 'Request project closure' : 'New approval request'}
          </DialogTitle>
          <DialogDescription>
            {type === 'project_closure'
              ? 'When every stage approves, the project is marked completed automatically.'
              : 'Routed through the configured approval stages; you are notified of the decision.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {!projectId ? (
            <FormField label="Project" required className="sm:col-span-2">
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
          {!fixedType ? (
            <FormField label="Type" className="sm:col-span-2">
              <Select value={type} onValueChange={(v) => setType(v as UserApprovalType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {USER_APPROVAL_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {APPROVAL_ENTITY_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : null}
          <FormField
            label="Title"
            required
            className="sm:col-span-2"
            error={title && title.trim().length < 3 ? 'Enter a short title' : undefined}
          >
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
          </FormField>
          <FormField label="Details" className="sm:col-span-2">
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={5000}
            />
          </FormField>
          {type === 'general' ? (
            <FormField label="Amount (₹, optional)">
              <Input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </FormField>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!valid || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onClose })}
          >
            Submit for approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================ Detail ============================ */

function ApprovalDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const a = useApproval(id);
  const [comment, setComment] = useState('');
  const [delegateTo, setDelegateTo] = useState<UserRef | null>(null);
  const approve = useCollabMutation(() => api.approveApproval(id, comment.trim() || undefined), {
    success: (r) => `${r.key} approved${r.status === 'pending' ? ' (next stage notified)' : ''}`,
  });
  const reject = useCollabMutation(() => api.rejectApproval(id, comment.trim()), {
    success: (r) => `${r.key} rejected`,
  });
  const delegate = useCollabMutation(
    () => api.delegateApproval(id, delegateTo!.id, comment.trim() || undefined),
    { success: 'Delegated' },
  );
  const cancel = useCollabMutation(() => api.cancelApproval(id), { success: 'Request withdrawn' });
  const busy = approve.isPending || reject.isPending || delegate.isPending || cancel.isPending;
  const done = () => setComment('');

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {a.error ? (
          <ErrorState error={a.error} />
        ) : !a.data ? (
          <Skeleton className="m-4 h-64" />
        ) : (
          <div className="space-y-5 p-4">
            <div className="space-y-1">
              <p className="font-mono text-xs text-muted-foreground">
                {a.data.key} · {APPROVAL_ENTITY_LABELS[a.data.entityType]}
              </p>
              <SheetTitle>{a.data.title}</SheetTitle>
              <SheetDescription>
                <Link to={`/projects/${a.data.project.id}`} className="hover:underline">
                  {a.data.project.key} · {a.data.project.name}
                </Link>{' '}
                · requested by {a.data.requestedBy?.name ?? '—'}{' '}
                {formatDistanceToNow(new Date(a.data.createdAt), { addSuffix: true })}
              </SheetDescription>
              <div className="flex items-center gap-3 pt-1">
                <ApprovalStatusBadge status={a.data.status} />
                {a.data.amount != null ? (
                  <span className="text-sm font-medium tabular">{inr(a.data.amount)}</span>
                ) : null}
              </div>
            </div>
            {a.data.description ? (
              <p className="whitespace-pre-wrap text-sm">{a.data.description}</p>
            ) : null}

            <section aria-label="Stages">
              <h4 className="mb-2 text-sm font-semibold">Stages</h4>
              <ol className="space-y-3">
                {a.data.stages.map((s, i) => {
                  const st = STAGE[s.status];
                  return (
                    <li key={i} className="flex gap-3">
                      <st.icon
                        className="mt-0.5 size-4 shrink-0"
                        style={{ color: st.color }}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="font-medium">
                          {i + 1}. {s.name}{' '}
                          <span className="text-xs font-normal text-muted-foreground">
                            · {st.label}
                          </span>
                          {s.overdue ? (
                            <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium">
                              <AlertTriangle
                                className="size-3"
                                style={{ color: 'var(--status-critical)' }}
                                aria-hidden
                              />{' '}
                              Past deadline
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {s.decidedBy
                            ? `${s.decidedBy.name} · ${new Date(s.decidedAt!).toLocaleString('en-IN')}`
                            : s.approvers.length
                              ? `Approver${s.approvers.length > 1 ? 's' : ''}: ${s.approvers.map((u) => u.name).join(', ')}`
                              : (s.note ?? APPROVER_TYPE_LABELS[s.approverType])}
                          {s.status === 'pending' && s.dueAt
                            ? ` · due ${new Date(s.dueAt).toLocaleString('en-IN')}`
                            : ''}
                        </p>
                        {s.comment ? <p className="mt-0.5 text-xs">“{s.comment}”</p> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>

            {a.data.can.act ? (
              <section className="space-y-2 rounded-lg border p-3" aria-label="Your decision">
                <FormField label="Comment" hint="Required when rejecting">
                  <Textarea
                    rows={2}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    maxLength={2000}
                  />
                </FormField>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy}
                    onClick={() => approve.mutate(undefined, { onSuccess: done })}
                  >
                    <CheckCircle2 /> Approve
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busy || comment.trim().length < 3}
                    onClick={() => reject.mutate(undefined, { onSuccess: done })}
                  >
                    <XCircle /> Reject
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                  <span className="text-xs text-muted-foreground">Delegate to</span>
                  <div className="min-w-56 flex-1">
                    <UserPicker
                      value={delegateTo}
                      onChange={setDelegateTo}
                      placeholder="Choose a colleague"
                      excludeId={a.data.requestedBy?.id}
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !delegateTo}
                    onClick={() => delegate.mutate(undefined, { onSuccess: done })}
                  >
                    Delegate
                  </Button>
                </div>
              </section>
            ) : null}
            {a.data.can.cancel ? (
              <Button variant="outline" disabled={busy} onClick={() => cancel.mutate(undefined)}>
                Withdraw request
              </Button>
            ) : null}

            <section aria-label="History">
              <h4 className="mb-2 text-sm font-semibold">History</h4>
              <ol className="space-y-1 text-xs">
                {[...a.data.history].reverse().map((h, i) => (
                  <li key={i}>
                    <span className="text-muted-foreground">
                      {new Date(h.at).toLocaleString('en-IN')}
                    </span>{' '}
                    · {h.by?.name ?? 'System'} {h.action}
                    {h.comment ? (
                      <span className="text-muted-foreground"> — {h.comment}</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ============================ Workflows (admin) ============================ */

const UI_APPROVER_TYPES = (Object.keys(APPROVER_TYPE_LABELS) as ApproverType[]).filter(
  (t) => t !== 'users',
);

export function WorkflowEditor({ workflow }: { workflow: ApprovalWorkflowDto }) {
  const roles = useRoles();
  const [stages, setStages] = useState<ApprovalStageDef[]>(workflow.stages);
  const [error, setError] = useState<string | null>(null);
  const save = useCollabMutation(
    () =>
      api.saveWorkflow(workflow.entityType, {
        name: workflow.name,
        description: workflow.description,
        stages,
      }),
    { success: `${workflow.name} workflow saved` },
  );
  const patch = (i: number, p: Partial<ApprovalStageDef>) =>
    setStages((ss) => ss.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const submit = () => {
    const parsed = approvalWorkflowSchema.safeParse({ name: workflow.name, stages });
    if (!parsed.success) {
      setError(parsed.error.issues[0]!.message);
      return;
    }
    setError(null);
    save.mutate(undefined);
  };
  return (
    <section className="rounded-xl border bg-card p-4" aria-label={`${workflow.name} workflow`}>
      <h3 className="text-sm font-semibold">{workflow.name}</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        {APPROVAL_ENTITY_LABELS[workflow.entityType]} · changes apply to new requests only.
        Requesters never approve their own request; a stage with nobody eligible is skipped.
      </p>
      <ol className="space-y-2">
        {stages.map((s, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
            <span className="w-5 text-xs text-muted-foreground tabular">{i + 1}.</span>
            <Input
              className="h-8 w-44"
              aria-label={`Stage ${i + 1} name`}
              value={s.name}
              onChange={(e) => patch(i, { name: e.target.value })}
            />
            <Select
              value={s.approverType}
              onValueChange={(v) =>
                patch(i, { approverType: v as ApproverType, roleKey: undefined })
              }
            >
              <SelectTrigger size="sm" className="w-56" aria-label={`Stage ${i + 1} approver`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(s.approverType === 'users'
                  ? [...UI_APPROVER_TYPES, 'users' as const]
                  : UI_APPROVER_TYPES
                ).map((t) => (
                  <SelectItem key={t} value={t}>
                    {APPROVER_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {s.approverType === 'role' ? (
              <Select value={s.roleKey ?? ''} onValueChange={(v) => patch(i, { roleKey: v })}>
                <SelectTrigger size="sm" className="w-40" aria-label={`Stage ${i + 1} role`}>
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.data?.map((r) => (
                    <SelectItem key={r.id} value={r.key}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              Decide within
              <Input
                type="number"
                min={1}
                max={720}
                className="h-8 w-20"
                aria-label={`Stage ${i + 1} hours`}
                value={s.slaHours}
                onChange={(e) => patch(i, { slaHours: Number(e.target.value) })}
              />
              h
            </label>
            <label
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              title="Runs only when every earlier stage was skipped, for example when the requester is the approver"
            >
              <Checkbox
                checked={s.fallbackOnly ?? false}
                disabled={i === 0}
                onCheckedChange={(c) => patch(i, { fallbackOnly: c === true })}
              />
              Only as fallback
            </label>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto size-7"
              aria-label={`Remove stage ${i + 1}`}
              disabled={stages.length === 1}
              onClick={() => setStages((ss) => ss.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ol>
      {error ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={stages.length >= 5}
          onClick={() =>
            setStages((ss) => [
              ...ss,
              {
                name: 'New stage',
                approverType: 'project_manager',
                slaHours: 48,
                fallbackOnly: false,
              },
            ])
          }
        >
          <Plus /> Add stage
        </Button>
        <Button size="sm" className="ml-auto" disabled={save.isPending} onClick={submit}>
          Save workflow
        </Button>
      </div>
    </section>
  );
}

function WorkflowsTab() {
  const wf = useWorkflows();
  if (wf.error) return <ErrorState error={wf.error} onRetry={() => void wf.refetch()} />;
  if (!wf.data) return <Skeleton className="h-48" />;
  return (
    <div className="space-y-4">
      {wf.data.map((w) => (
        <WorkflowEditor key={w.id + w.updatedAt} workflow={w} />
      ))}
    </div>
  );
}

/* ============================ Page ============================ */

function ApprovalList({
  box,
  onOpen,
}: {
  box: 'inbox' | 'mine' | 'all';
  onOpen: (id: string) => void;
}) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>(box === 'inbox' ? 'pending' : 'any');
  const list = useApprovals({
    box,
    page,
    limit: 20,
    status: status === 'any' ? undefined : (status as ApprovalStatus),
  });
  const columns = useMemo<ColumnDef<ApprovalDto, unknown>[]>(
    () => [
      {
        header: 'Request',
        cell: ({ row: { original: a } }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">
              <span className="font-mono text-xs text-muted-foreground">{a.key}</span> {a.title}
            </p>
            <p className="text-xs text-muted-foreground">
              {APPROVAL_ENTITY_LABELS[a.entityType]} · {a.project.key}
              {a.amount != null ? ` · ${inr(a.amount)}` : ''}
            </p>
          </div>
        ),
      },
      {
        header: 'Status',
        cell: ({ row: { original: a } }) => <ApprovalStatusBadge status={a.status} />,
      },
      {
        header: 'Stage',
        cell: ({ row: { original: a } }) => {
          const s = a.stages[a.currentStage];
          return a.status === 'pending' && s ? (
            <span className={cn('text-xs', s.overdue && 'font-medium')}>
              {s.name}
              {s.overdue ? ' · past deadline' : ''}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          );
        },
      },
      { header: 'Requested by', cell: ({ row: { original: a } }) => a.requestedBy?.name ?? '—' },
      {
        header: 'Raised',
        cell: ({ row: { original: a } }) =>
          formatDistanceToNow(new Date(a.createdAt), { addSuffix: true }),
      },
    ],
    [],
  );
  return (
    <div className="space-y-3">
      <Select
        value={status}
        onValueChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
      >
        <SelectTrigger size="sm" className="w-40" aria-label="Filter by status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">All statuses</SelectItem>
          {(Object.keys(STATUS) as ApprovalStatus[]).map((s) => (
            <SelectItem key={s} value={s}>
              {STATUS[s].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <DataTable
        columns={columns}
        data={list.data?.items}
        meta={list.data?.meta}
        onPageChange={setPage}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        getRowId={(a) => a.id}
        onRowClick={(a) => onOpen(a.id)}
        empty={
          <EmptyState
            compact
            icon={CheckCircle2}
            title={box === 'inbox' ? 'Nothing waiting for you' : 'No requests'}
            description={
              box === 'inbox' ? 'Requests that need your decision appear here.' : undefined
            }
          />
        }
      />
    </div>
  );
}

export function ApprovalsPage() {
  const canAct = useCan('approval:act');
  const canSeeAll = useCan('approval:act', 'project');
  const isAdmin = useCan('settings:manage', 'org');
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
    <div className="space-y-5">
      <PageHeader
        title="Approvals"
        description="Multi-stage approvals with deadlines, delegation and a full history."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New request
          </Button>
        }
      />
      <Tabs defaultValue={canAct ? 'inbox' : 'mine'}>
        <TabsList>
          {canAct ? <TabsTrigger value="inbox">Waiting for me</TabsTrigger> : null}
          <TabsTrigger value="mine">My requests</TabsTrigger>
          {canSeeAll ? <TabsTrigger value="all">All</TabsTrigger> : null}
          {isAdmin ? <TabsTrigger value="workflows">Workflows</TabsTrigger> : null}
        </TabsList>
        {canAct ? (
          <TabsContent value="inbox" className="mt-4">
            <ApprovalList box="inbox" onOpen={setOpen} />
          </TabsContent>
        ) : null}
        <TabsContent value="mine" className="mt-4">
          <ApprovalList box="mine" onOpen={setOpen} />
        </TabsContent>
        {canSeeAll ? (
          <TabsContent value="all" className="mt-4">
            <ApprovalList box="all" onOpen={setOpen} />
          </TabsContent>
        ) : null}
        {isAdmin ? (
          <TabsContent value="workflows" className="mt-4">
            <WorkflowsTab />
          </TabsContent>
        ) : null}
      </Tabs>
      {openId ? <ApprovalDetail id={openId} onClose={() => setOpen(null)} /> : null}
      {creating ? <NewApprovalDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
