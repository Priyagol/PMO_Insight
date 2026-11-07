import { formatDistanceToNow } from 'date-fns';
import { CheckCircle2, Loader2, Scale, Settings2, Shuffle, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  DEFAULT_ASSIGNMENT_CONFIG,
  type AssignmentConfig,
  type AssignmentPlanDto,
} from '@arihant/shared';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { FormField } from '@/components/common/FormField';
import { PageHeader } from '@/components/common/PageHeader';
import { PriorityIndicator } from '@/components/common/PriorityIndicator';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { useProjects } from '@/features/work/hooks';
import { useCan } from '@/hooks/use-permission';
import { cn } from '@/lib/utils';
import * as t from '@/services/api/tracking';
import { useAssignmentConfig, usePlan, usePlans, useTrackMutation } from './hooks';

const ANY = '__any__';
const UNASSIGN = '__unassign__';
const ROLE_FILTERS = [
  { value: ANY, label: 'Anyone on the team' },
  { value: 'qa_tester', label: 'QA / Testers only' },
  { value: 'developer', label: 'Developers only' },
];
const KIND_LABEL: Record<AssignmentPlanDto['kind'], string> = {
  batch: 'Batch distribution',
  reassign: 'Reassignment',
  rebalance: 'Rebalance',
};
const STATUS_TONE: Record<AssignmentPlanDto['status'], string> = {
  draft: 'bg-info/10 text-info',
  approved: 'bg-warning/10 text-warning',
  executing: 'bg-warning/10 text-warning',
  executed: 'bg-success/10 text-success',
  rejected: 'bg-muted text-muted-foreground',
  expired: 'bg-muted text-muted-foreground',
};

function LoadBars({
  before,
  after,
  capacity,
}: {
  before: number;
  after: number;
  capacity: number;
}) {
  const scale = Math.max(capacity, after, before, 1) * 1.05;
  return (
    <div className="relative h-3 w-full overflow-hidden rounded bg-muted" aria-hidden>
      <div
        className="absolute inset-y-0 left-0 bg-primary/30"
        style={{ width: `${(after / scale) * 100}%` }}
      />
      <div
        className="absolute inset-y-0 left-0 bg-primary"
        style={{ width: `${(before / scale) * 100}%` }}
      />
      <div
        className="absolute inset-y-0 w-0.5 bg-foreground/50"
        style={{ left: `${(capacity / scale) * 100}%` }}
      />
    </div>
  );
}

/** Preview, adjust and approve a plan; shows results once the worker has executed it. */
export function PlanView({ planId, onClose }: { planId: string; onClose: () => void }) {
  const plan = usePlan(planId);
  const approve = useTrackMutation(() => t.approvePlan(planId), {
    success: 'Plan approved; assigning now',
  });
  const reject = useTrackMutation(() => t.rejectPlan(planId), { success: 'Plan discarded' });
  const modify = useTrackMutation(
    ({ taskId, toUserId }: { taskId: string; toUserId: string | null }) =>
      t.modifyPlan(planId, [{ taskId, toUserId }]),
  );

  if (plan.error) return <ErrorState error={plan.error} onRetry={() => void plan.refetch()} />;
  if (!plan.data) return <Skeleton className="h-96 w-full" />;
  const p = plan.data;
  const draft = p.status === 'draft';
  const active = p.proposals.filter((x) => x.toUser);
  const candidates = p.workload.map((w) => w.user);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">
              {KIND_LABEL[p.kind]}
              {p.project ? ` · ${p.project.key} ${p.project.name}` : ''}
            </h2>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                STATUS_TONE[p.status],
              )}
            >
              {p.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {active.length} assignment(s) proposed · {p.skipped.length} skipped ·{' '}
            {p.manualReview.length} for manual review
            {draft
              ? ` · preview expires ${formatDistanceToNow(new Date(p.expiresAt), { addSuffix: true })}`
              : ''}
          </p>
        </div>
        <div className="flex gap-2">
          {draft ? (
            <>
              <Button
                variant="outline"
                disabled={reject.isPending}
                onClick={() => reject.mutate(undefined)}
              >
                <XCircle /> Discard
              </Button>
              <Button
                disabled={!active.length || approve.isPending}
                onClick={() => approve.mutate(undefined)}
              >
                <CheckCircle2 /> Approve &amp; assign
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>

      {p.status === 'approved' || p.status === 'executing' ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Assigning in the background…
        </p>
      ) : null}
      {p.result ? (
        <div
          className={cn(
            'rounded-lg border p-3 text-sm',
            p.result.conflicts.length
              ? 'border-warning/40 bg-warning/5'
              : 'border-success/40 bg-success/5',
          )}
        >
          <strong>{p.result.assigned}</strong> task(s) assigned.
          {p.result.conflicts.length ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
              {p.result.conflicts.map((c) => (
                <li key={c.taskId}>
                  {c.key} {c.title}: {c.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {p.workload.length ? (
        <section className="rounded-xl border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Workload before → after (planning window)</h3>
          <ul className="space-y-2.5">
            {p.workload.map((w) => (
              <li
                key={w.user.id}
                className="grid grid-cols-[160px_1fr_180px] items-center gap-3 text-sm"
              >
                <span className="truncate">{w.user.name}</span>
                <LoadBars before={w.loadBefore} after={w.loadAfter} capacity={w.capacityHours} />
                <span
                  className={cn(
                    'text-right text-xs tabular',
                    w.overCapacity && 'font-medium text-destructive',
                  )}
                >
                  {w.loadBefore} → {w.loadAfter} / {w.capacityHours} h{' '}
                  {w.tasksAdded ? `(+${w.tasksAdded})` : ''}
                  {w.tasksRemoved ? ` (−${w.tasksRemoved})` : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Dark bar = current load, light bar = after this plan, line = capacity.
          </p>
        </section>
      ) : null}

      <section className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Task</th>
              <th className="px-3 py-2 text-right font-medium">Effort</th>
              {p.kind !== 'batch' ? (
                <th className="px-3 py-2 text-left font-medium">From</th>
              ) : null}
              <th className="px-3 py-2 text-left font-medium">Assign to</th>
              <th className="px-3 py-2 text-right font-medium">Score</th>
              <th className="px-3 py-2 text-left font-medium">Why</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {p.proposals.map((x) => (
              <tr key={x.taskId}>
                <td className="px-4 py-2">
                  <span className="mr-2 font-mono text-xs text-muted-foreground">{x.key}</span>
                  <PriorityIndicator priority={x.priority} showLabel={false} /> {x.title}
                </td>
                <td className="px-3 py-2 text-right tabular">{x.effortHours} h</td>
                {p.kind !== 'batch' ? (
                  <td className="px-3 py-2 text-xs">{x.fromUser?.name ?? '—'}</td>
                ) : null}
                <td className="px-3 py-2">
                  {draft ? (
                    <Select
                      value={x.toUser?.id ?? UNASSIGN}
                      onValueChange={(v) =>
                        modify.mutate({ taskId: x.taskId, toUserId: v === UNASSIGN ? null : v })
                      }
                    >
                      <SelectTrigger
                        size="sm"
                        className="w-44"
                        aria-label={`Assignee for ${x.key}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNASSIGN}>Leave unassigned</SelectItem>
                        {candidates.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    (x.toUser?.name ?? '—')
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular">{x.score ? x.score : '—'}</td>
                <td className="max-w-md px-3 py-2 text-xs text-muted-foreground">{x.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!p.proposals.length ? <EmptyState compact title="No assignments proposed" /> : null}
      </section>

      {p.skipped.length || p.manualReview.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {p.skipped.length ? (
            <section className="rounded-xl border bg-card p-4">
              <h3 className="mb-2 text-sm font-semibold">
                Could not be assigned ({p.skipped.length})
              </h3>
              <ul className="space-y-1 text-xs">
                {p.skipped.map((s) => (
                  <li key={s.taskId}>
                    <span className="font-mono">{s.key}</span> {s.title}:{' '}
                    <span className="text-muted-foreground">{s.reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {p.manualReview.length ? (
            <section className="rounded-xl border bg-card p-4">
              <h3 className="mb-2 text-sm font-semibold">
                Needs a manager's decision ({p.manualReview.length})
              </h3>
              <ul className="space-y-1 text-xs">
                {p.manualReview.map((s) => (
                  <li key={s.taskId}>
                    <span className="font-mono">{s.key}</span> {s.title}:{' '}
                    <span className="text-muted-foreground">{s.reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PreviewForm({
  kind,
  onPlan,
}: {
  kind: 'batch' | 'rebalance';
  onPlan: (id: string) => void;
}) {
  const projects = useProjects({ mine: 'true', limit: 100, sort: 'name' });
  const [projectId, setProjectId] = useState('');
  const [role, setRole] = useState(ANY);
  const preview = useTrackMutation(() => {
    const input = { projectId, ...(role === ANY ? {} : { roleKeys: [role] }) };
    return kind === 'batch' ? t.previewBatch(input) : t.previewRebalance(input);
  });
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
      <FormField label="Project" className="w-72">
        <Select value={projectId} onValueChange={setProjectId}>
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
      <FormField label="Candidates" className="w-56">
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLE_FILTERS.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <Button
        disabled={!projectId || preview.isPending}
        onClick={() => preview.mutate(undefined, { onSuccess: (p) => onPlan(p.id) })}
      >
        {kind === 'batch' ? (
          <>
            <Shuffle /> Preview distribution
          </>
        ) : (
          <>
            <Scale /> Check balance
          </>
        )}
      </Button>
      <p className="w-full text-xs text-muted-foreground">
        {kind === 'batch'
          ? 'Takes every unassigned open task in the project and proposes owners by workload, capacity, skills, priority and availability. Nothing changes until you approve.'
          : 'Finds people above the overload threshold and proposes moving their unstarted, non-critical tasks to people with spare capacity.'}
      </p>
    </div>
  );
}

function History({ onOpen }: { onOpen: (id: string) => void }) {
  const plans = usePlans();
  if (plans.isLoading) return <Skeleton className="h-40 w-full" />;
  if (!plans.data?.length)
    return (
      <div className="rounded-xl border bg-card">
        <EmptyState compact title="No plans yet" />
      </div>
    );
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {plans.data.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            onClick={() => onOpen(p.id)}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted/40"
          >
            <span className="w-40 font-medium">{KIND_LABEL[p.kind]}</span>
            <span className="flex-1 truncate text-muted-foreground">
              {p.project
                ? `${p.project.key} ${p.project.name}`
                : `${p.proposals[0]?.fromUser?.name ?? ''}'s work`}
            </span>
            <span className="text-xs tabular">
              {p.result
                ? `${p.result.assigned} assigned`
                : `${p.proposals.filter((x) => x.toUser).length} proposed`}
            </span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                STATUS_TONE[p.status],
              )}
            >
              {p.status}
            </span>
            <span className="w-28 text-right text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(p.createdAt), { addSuffix: true })}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const WEIGHT_LABELS: [keyof AssignmentConfig['weights'], string][] = [
  ['workload', 'Current workload'],
  ['capacity', 'Available capacity'],
  ['skill', 'Skill compatibility'],
  ['priority', 'Priority & complexity'],
  ['availability', 'Availability'],
];

function ConfigForm({ config }: { config: AssignmentConfig }) {
  const [draft, setDraft] = useState(config);
  const total = Math.round(Object.values(draft.weights).reduce((s, w) => s + w, 0) * 100);
  const save = useTrackMutation(() => t.saveAssignmentConfig(draft), {
    success: 'Assignment settings saved',
  });
  const setWeight = (k: keyof AssignmentConfig['weights'], pct: number) =>
    setDraft((d) => ({ ...d, weights: { ...d.weights, [k]: pct / 100 } }));
  return (
    <div className="space-y-5 rounded-xl border bg-card p-4">
      <section>
        <h3 className="mb-3 text-sm font-semibold">Scoring weights (must total 100%)</h3>
        <div className="grid gap-3 sm:grid-cols-5">
          {WEIGHT_LABELS.map(([k, label]) => (
            <FormField key={k} label={label}>
              <Input
                type="number"
                min={0}
                max={100}
                value={Math.round(draft.weights[k] * 100)}
                onChange={(e) => setWeight(k, Number(e.target.value))}
              />
            </FormField>
          ))}
        </div>
        <p
          className={cn(
            'mt-2 text-xs',
            total === 100 ? 'text-muted-foreground' : 'font-medium text-destructive',
          )}
        >
          Total: {total}%
        </p>
      </section>
      <section className="grid gap-3 sm:grid-cols-4">
        <FormField label="Planning window (working days)">
          <Input
            type="number"
            min={1}
            max={60}
            value={draft.horizonDays}
            onChange={(e) => setDraft({ ...draft, horizonDays: Number(e.target.value) })}
          />
        </FormField>
        <FormField label="Effort for unestimated tasks (h)">
          <Input
            type="number"
            min={0.25}
            step={0.25}
            value={draft.defaultEffortHours}
            onChange={(e) => setDraft({ ...draft, defaultEffortHours: Number(e.target.value) })}
          />
        </FormField>
        <FormField label="Overloaded above (%)">
          <Input
            type="number"
            min={50}
            max={300}
            value={Math.round(draft.rebalanceHigh * 100)}
            onChange={(e) => setDraft({ ...draft, rebalanceHigh: Number(e.target.value) / 100 })}
          />
        </FormField>
        <FormField label="Underused below (%)">
          <Input
            type="number"
            min={0}
            max={100}
            value={Math.round(draft.rebalanceLow * 100)}
            onChange={(e) => setDraft({ ...draft, rebalanceLow: Number(e.target.value) / 100 })}
          />
        </FormField>
      </section>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={draft.allowOverCapacity}
          onCheckedChange={(c) => setDraft({ ...draft, allowOverCapacity: Boolean(c) })}
        />
        Allow assigning beyond capacity (flagged instead of skipped)
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setDraft(DEFAULT_ASSIGNMENT_CONFIG)}>
          Reset to defaults
        </Button>
        <Button disabled={total !== 100 || save.isPending} onClick={() => save.mutate(undefined)}>
          <Settings2 /> Save settings
        </Button>
      </div>
    </div>
  );
}

export function SmartAssignmentPage() {
  const [params, setParams] = useSearchParams();
  const planId = params.get('plan');
  const canConfigure = useCan('assignment:configure', 'org');
  const config = useAssignmentConfig();
  const openPlan = (id: string | null) =>
    setParams((p) => {
      if (id) p.set('plan', id);
      else p.delete('plan');
      return p;
    });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Smart Assignment"
        description="Distribute work by workload, capacity, skills, priority and availability. Every plan is previewed and approved before anything changes."
      />
      {planId ? (
        <PlanView key={planId} planId={planId} onClose={() => openPlan(null)} />
      ) : (
        <Tabs defaultValue="batch">
          <TabsList>
            <TabsTrigger value="batch">Distribute</TabsTrigger>
            <TabsTrigger value="rebalance">Rebalance</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            {canConfigure ? <TabsTrigger value="settings">Settings</TabsTrigger> : null}
          </TabsList>
          <TabsContent value="batch" className="mt-4">
            <PreviewForm kind="batch" onPlan={openPlan} />
          </TabsContent>
          <TabsContent value="rebalance" className="mt-4">
            <PreviewForm kind="rebalance" onPlan={openPlan} />
          </TabsContent>
          <TabsContent value="history" className="mt-4">
            <History onOpen={openPlan} />
          </TabsContent>
          {canConfigure ? (
            <TabsContent value="settings" className="mt-4">
              {config.data ? (
                <ConfigForm key={JSON.stringify(config.data)} config={config.data} />
              ) : (
                <Skeleton className="h-48 w-full" />
              )}
            </TabsContent>
          ) : null}
        </Tabs>
      )}
    </div>
  );
}
