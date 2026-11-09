import { CalendarOff, Shuffle, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { WorkloadRowDto } from '@arihant/shared';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDepartments } from '@/features/org/hooks';
import { formatDay } from '@/features/work/format';
import { useCan } from '@/hooks/use-permission';
import { cn } from '@/lib/utils';
import * as t from '@/services/api/tracking';
import { useAvailability, useTeamWorkload, useTrackMutation } from './hooks';
import { AvailabilityBadge } from './LeaveDialog';
import { PerformancePanel } from './PerformancePanel';
import { TeamsPanel } from './TeamsPanel';

const ALL = 'all';
const STATE: Record<WorkloadRowDto['state'], { label: string; tone: string; bar: string }> = {
  overloaded: {
    label: 'Overloaded',
    tone: 'bg-destructive/10 text-destructive',
    bar: 'bg-destructive',
  },
  balanced: { label: 'Balanced', tone: 'bg-success/10 text-success', bar: 'bg-primary' },
  underutilized: { label: 'Underused', tone: 'bg-warning/10 text-warning', bar: 'bg-warning' },
  unavailable: {
    label: 'On leave',
    tone: 'bg-muted text-muted-foreground',
    bar: 'bg-muted-foreground',
  },
};

/** Utilisation bar: capacity is 100%; anything beyond is shown in the overflow colour. */
export function UtilizationBar({ row }: { row: WorkloadRowDto }) {
  const pct = Math.min(row.utilization, 150);
  return (
    <div className="flex items-center gap-2">
      <div
        className="relative h-2 w-32 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-valuenow={row.utilization}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Utilisation"
      >
        <div
          className={cn('h-full rounded-full', STATE[row.state].bar)}
          style={{ width: `${(pct / 150) * 100}%` }}
        />
        <div
          className="absolute inset-y-0 w-px bg-foreground/40"
          style={{ left: `${(100 / 150) * 100}%` }}
          aria-hidden
        />
      </div>
      <span className="w-12 text-right text-xs tabular">
        {row.capacityHours > 0 ? `${Math.round(row.utilization)}%` : '—'}
      </span>
    </div>
  );
}

function Workload() {
  const navigate = useNavigate();
  const canAssign = useCan('assignment:execute');
  const departments = useDepartments();
  const [dept, setDept] = useState(ALL);
  const rows = useTeamWorkload(dept === ALL ? undefined : dept);
  const reassign = useTrackMutation((userId: string) => t.previewReassign(userId));

  const counts = (rows.data ?? []).reduce<Record<string, number>>(
    (acc, r) => ({ ...acc, [r.state]: (acc[r.state] ?? 0) + 1 }),
    {},
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={dept} onValueChange={setDept}>
          <SelectTrigger size="sm" className="w-48" aria-label="Filter by department">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All departments</SelectItem>
            {departments.data?.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(['overloaded', 'balanced', 'underutilized', 'unavailable'] as const).map((s) => (
          <span
            key={s}
            className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATE[s].tone)}
          >
            {STATE[s].label}: {counts[s] ?? 0}
          </span>
        ))}
      </div>
      {rows.error ? (
        <ErrorState error={rows.error} onRetry={() => void rows.refetch()} />
      ) : rows.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !rows.data?.length ? (
        <div className="rounded-xl border bg-card">
          <EmptyState icon={UsersRound} title="No people in view" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Person</th>
                <th className="px-3 py-2 text-left font-medium">Utilisation</th>
                <th className="px-3 py-2 text-right font-medium">Load / capacity</th>
                <th className="px-3 py-2 text-right font-medium">Open</th>
                <th className="px-3 py-2 text-right font-medium">Overdue</th>
                <th className="px-3 py-2 text-right font-medium">Logged this week</th>
                <th className="px-3 py-2 text-left font-medium">State</th>
                {canAssign ? <th className="px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.data.map((r) => (
                <tr key={r.user.id}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <UserAvatar name={r.user.name} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{r.user.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {r.user.designation ?? r.user.department ?? ''}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <UtilizationBar row={r} />
                  </td>
                  <td className="px-3 py-2.5 text-right tabular">
                    {r.loadHours} h / {r.capacityHours} h
                  </td>
                  <td className="px-3 py-2.5 text-right tabular">{r.openTasks}</td>
                  <td
                    className={cn(
                      'px-3 py-2.5 text-right tabular',
                      r.overdueTasks && 'font-medium text-destructive',
                    )}
                  >
                    {r.overdueTasks}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular">{r.loggedHoursThisWeek} h</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        STATE[r.state].tone,
                      )}
                    >
                      {STATE[r.state].label}
                    </span>
                    {r.leaveDaysInHorizon > 0 && r.state !== 'unavailable' ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {r.leaveDaysInHorizon}d leave
                      </span>
                    ) : null}
                  </td>
                  {canAssign ? (
                    <td className="px-3 py-2.5 text-right">
                      {r.openTasks > 0 &&
                      (r.state === 'unavailable' || r.state === 'overloaded') ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={reassign.isPending}
                          onClick={() =>
                            reassign.mutate(r.user.id, {
                              onSuccess: (plan) => navigate(`/smart-assignment?plan=${plan.id}`),
                            })
                          }
                        >
                          <Shuffle /> Reassign work
                        </Button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Load is the remaining estimated effort of open tasks across all projects. Capacity covers
        the planning window (working days ahead) after approved leave.
      </p>
    </div>
  );
}

function Leave() {
  const canApprove = useCan('timesheet:approve');
  const pending = useAvailability({ scope: 'approvals' }, canApprove);
  const team = useAvailability({ scope: 'team' });
  const decide = useTrackMutation(
    ({ id, d }: { id: string; d: 'approve' | 'reject' }) => t.decideAvailability(id, d),
    {
      success: (r) => `Request ${r.status}`,
    },
  );
  return (
    <div className="space-y-5">
      {canApprove ? (
        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Waiting for your decision</h2>
          {pending.data?.items.length ? (
            <ul className="divide-y">
              {pending.data.items.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <span className="font-medium">{l.user?.name}</span>
                  <span className="text-muted-foreground capitalize">
                    {l.type}
                    {l.hoursPerDay != null ? ` (${l.hoursPerDay} h/day)` : ''}
                  </span>
                  <span>
                    {formatDay(l.from, 'd MMM')} – {formatDay(l.to, 'd MMM yyyy')}
                  </span>
                  {l.reason ? (
                    <span className="text-xs text-muted-foreground">“{l.reason}”</span>
                  ) : null}
                  {l.canDecide ? (
                    <span className="ml-auto flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => decide.mutate({ id: l.id, d: 'reject' })}
                      >
                        Reject
                      </Button>
                      <Button size="sm" onClick={() => decide.mutate({ id: l.id, d: 'approve' })}>
                        Approve
                      </Button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No pending requests.</p>
          )}
        </section>
      ) : null}
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Team leave</h2>
        {team.data?.items.length ? (
          <ul className="divide-y">
            {team.data.items.map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-44 truncate font-medium">{l.user?.name}</span>
                <span className="flex-1">
                  {formatDay(l.from, 'd MMM')} – {formatDay(l.to, 'd MMM yyyy')}{' '}
                  <span className="text-xs text-muted-foreground capitalize">· {l.type}</span>
                </span>
                <AvailabilityBadge status={l.status} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact icon={CalendarOff} title="No leave recorded" />
        )}
      </section>
    </div>
  );
}

export function TeamsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Teams & Resources"
        description="Who has capacity, who is delivering on time, and who is away."
      />
      <Tabs defaultValue="workload">
        <TabsList>
          <TabsTrigger value="workload">Workload</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="teams">Teams</TabsTrigger>
          <TabsTrigger value="leave">Leave</TabsTrigger>
        </TabsList>
        <TabsContent value="workload" className="mt-4">
          <Workload />
        </TabsContent>
        <TabsContent value="performance" className="mt-4">
          <PerformancePanel />
        </TabsContent>
        <TabsContent value="teams" className="mt-4">
          <TeamsPanel />
        </TabsContent>
        <TabsContent value="leave" className="mt-4">
          <Leave />
        </TabsContent>
      </Tabs>
    </div>
  );
}
