import { UsersRound } from 'lucide-react';
import { useState } from 'react';
import type { PerformancePeriod, PerformanceRowDto } from '@arihant/shared';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { UserAvatar } from '@/components/common/UserAvatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useDepartments } from '@/features/org/hooks';
import { formatDay } from '@/features/work/format';
import { cn } from '@/lib/utils';
import { useTeamPerformance, useTeams } from './hooks';

const ALL = 'all';
const PERIODS: { value: PerformancePeriod; label: string }[] = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'quarter', label: 'This quarter' },
  { value: 'year', label: 'This financial year' },
];

type Counts = Omit<PerformanceRowDto, 'user'>;

function Cells({ r }: { r: Counts }) {
  const late = r.onTimeRate !== null && r.onTimeRate < 70;
  return (
    <>
      <td className="px-3 py-2.5 text-right tabular">{r.assigned}</td>
      <td className="px-3 py-2.5 text-right tabular">{r.completed}</td>
      <td className="px-3 py-2.5 text-right tabular">{r.pending}</td>
      <td
        className={cn(
          'px-3 py-2.5 text-right tabular',
          r.overdue && 'font-medium text-destructive',
        )}
      >
        {r.overdue}
      </td>
      <td
        className={cn('px-3 py-2.5 text-right tabular', late && 'font-medium text-warning')}
        title={`${r.completedOnTime} of ${r.completedWithDueDate} tasks with a due date`}
      >
        {r.onTimeRate === null ? '—' : `${r.onTimeRate}%`}
      </td>
      <td className="px-3 py-2.5 text-right tabular">{r.reworked}</td>
      <td className="px-3 py-2.5 text-right tabular">{r.qaRejections}</td>
      <td className="px-3 py-2.5 text-right tabular">
        {r.completed ? `${r.estimatedHours} / ${r.actualHours} h` : '—'}
      </td>
      <td className="px-3 py-2.5 text-right tabular">{r.loggedHours} h</td>
    </>
  );
}

function Head({ first }: { first: string }) {
  return (
    <thead className="bg-muted/40 text-xs text-muted-foreground">
      <tr>
        <th className="px-4 py-2 text-left font-medium">{first}</th>
        <th className="px-3 py-2 text-right font-medium">Assigned</th>
        <th className="px-3 py-2 text-right font-medium">Completed</th>
        <th className="px-3 py-2 text-right font-medium">Pending</th>
        <th className="px-3 py-2 text-right font-medium">Overdue</th>
        <th className="px-3 py-2 text-right font-medium">On time</th>
        <th className="px-3 py-2 text-right font-medium">Rework</th>
        <th className="px-3 py-2 text-right font-medium">QA rejections</th>
        <th className="px-3 py-2 text-right font-medium">Est. / actual</th>
        <th className="px-3 py-2 text-right font-medium">Logged</th>
      </tr>
    </thead>
  );
}

/** Per-person delivery facts: assigned, completed, pending, overdue, on time and rework. */
export function PerformancePanel() {
  const departments = useDepartments();
  const [dept, setDept] = useState(ALL);
  const teams = useTeams();
  const [team, setTeam] = useState(ALL);
  const [period, setPeriod] = useState<PerformancePeriod>('30d');
  const q = useTeamPerformance(period, {
    departmentId: dept === ALL ? undefined : dept,
    teamId: team === ALL ? undefined : team,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={period} onValueChange={(v) => setPeriod(v as PerformancePeriod)}>
          <SelectTrigger size="sm" className="w-48" aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
        {teams.data?.length ? (
          <Select value={team} onValueChange={setTeam}>
            <SelectTrigger size="sm" className="w-48" aria-label="Filter by team">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All teams</SelectItem>
              {teams.data.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {q.data ? (
          <span className="text-xs text-muted-foreground">
            {formatDay(q.data.period.from, 'd MMM yyyy')} –{' '}
            {formatDay(q.data.period.to, 'd MMM yyyy')}
          </span>
        ) : null}
      </div>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !q.data?.rows.length ? (
        <div className="rounded-xl border bg-card">
          <EmptyState icon={UsersRound} title="No people in view" />
        </div>
      ) : (
        <>
          {team === ALL && q.data.teams.length ? (
            <section aria-label="By team" className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full text-sm">
                <Head first="Team" />
                <tbody className="divide-y">
                  {q.data.teams.map((t) => (
                    <tr key={t.team.id}>
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          className="font-medium hover:underline"
                          onClick={() => setTeam(t.team.id)}
                        >
                          {t.team.name}
                        </button>
                        <p className="text-xs text-muted-foreground">
                          {t.members} member{t.members === 1 ? '' : 's'}
                        </p>
                      </td>
                      <Cells r={t.totals} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <Head first="Person" />
              <tbody className="divide-y">
                {q.data.rows.map((r) => (
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
                    <Cells r={r} />
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t bg-muted/30 font-medium">
                <tr>
                  <td className="px-4 py-2.5">Total ({q.data.rows.length} people)</td>
                  <Cells r={q.data.totals} />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Assigned, pending and overdue are as of today. Completed, on time, rework and logged hours
        cover the selected period. Rework counts each time a task went back from review, testing or
        done to work; QA rejections are the ones sent back from testing. These are delivery facts,
        not a rating. A person in two teams counts in both team rows.
      </p>
    </div>
  );
}
