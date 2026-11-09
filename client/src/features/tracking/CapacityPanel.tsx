import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CalendarRange } from 'lucide-react';
import { useState } from 'react';
import type { CapacityGroup, CapacityRowDto, CapacityWeekDto } from '@arihant/shared';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { Button } from '@/components/ui/button';
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
import { fetchCapacityPlan } from '@/services/api/tracking';
import { useTeams } from './hooks';

const ALL = 'all';
const GROUPS: { value: CapacityGroup; label: string }[] = [
  { value: 'person', label: 'By person' },
  { value: 'team', label: 'By team' },
  { value: 'department', label: 'By department' },
  { value: 'skill', label: 'By skill' },
];

/** Colour by how full the week is: over capacity, nearly full, or room to spare. */
function tone(w: CapacityWeekDto) {
  if (w.capacity <= 0)
    return w.demand > 0 ? 'bg-destructive/15 text-destructive' : 'text-muted-foreground';
  const load = w.demand / w.capacity;
  if (load > 1) return 'bg-destructive/15 text-destructive font-medium';
  if (load >= 0.85) return 'bg-warning/15 text-warning';
  return '';
}

function Cell({ w }: { w: CapacityWeekDto }) {
  return (
    <td
      className={cn('px-2 py-1.5 text-right tabular whitespace-nowrap', tone(w))}
      title={`${w.demand} h planned of ${w.capacity} h available`}
    >
      {w.demand} / {w.capacity}
    </td>
  );
}

function Row({ r, bold }: { r: CapacityRowDto; bold?: boolean }) {
  return (
    <tr className={cn(bold && 'bg-muted/30 font-medium')}>
      <td className="px-3 py-1.5">
        <p className="truncate">{r.label}</p>
        {r.sublabel || r.people !== 1 ? (
          <p className="truncate text-muted-foreground">
            {r.sublabel ?? (r.people ? `${r.people} people` : 'no one')}
          </p>
        ) : null}
      </td>
      {r.weeks.map((w, i) => (
        <Cell key={i} w={w} />
      ))}
      <td className="px-2 py-1.5 text-right tabular">{r.overdue || '—'}</td>
      <td className="px-2 py-1.5 text-right tabular">{r.unscheduled || '—'}</td>
    </tr>
  );
}

/** Hours available against planned work, week by week, for the coming weeks. */
export function CapacityPanel() {
  const departments = useDepartments();
  const teams = useTeams();
  const [groupBy, setGroupBy] = useState<CapacityGroup>('person');
  const [weeks, setWeeks] = useState('8');
  const [dept, setDept] = useState(ALL);
  const [team, setTeam] = useState(ALL);
  const query = {
    groupBy,
    weeks: Number(weeks),
    departmentId: dept === ALL ? undefined : dept,
    teamId: team === ALL ? undefined : team,
  };
  const q = useQuery({
    queryKey: ['tracking', 'capacity', query],
    queryFn: () => fetchCapacityPlan(query),
    placeholderData: keepPreviousData,
  });
  const d = q.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group" aria-label="Group by">
          {GROUPS.map((g) => (
            <Button
              key={g.value}
              size="sm"
              variant={groupBy === g.value ? 'secondary' : 'ghost'}
              aria-pressed={groupBy === g.value}
              onClick={() => setGroupBy(g.value)}
            >
              {g.label}
            </Button>
          ))}
        </div>
        <Select value={weeks} onValueChange={setWeeks}>
          <SelectTrigger size="sm" className="w-32" aria-label="Weeks ahead">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['4', '8', '12'].map((w) => (
              <SelectItem key={w} value={w}>
                {w} weeks
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={dept} onValueChange={setDept}>
          <SelectTrigger size="sm" className="w-44" aria-label="Filter by department">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All departments</SelectItem>
            {departments.data?.map((x) => (
              <SelectItem key={x.id} value={x.id}>
                {x.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {teams.data?.length ? (
          <Select value={team} onValueChange={setTeam}>
            <SelectTrigger size="sm" className="w-44" aria-label="Filter by team">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All teams</SelectItem>
              {teams.data.map((x) => (
                <SelectItem key={x.id} value={x.id}>
                  {x.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !d ? (
        <Skeleton className="h-64 w-full" />
      ) : !d.rows.length ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={CalendarRange}
            title={groupBy === 'team' ? 'No named teams in view' : 'Nothing to plan'}
          />
        </div>
      ) : (
        <>
          {d.shortfalls.length ? (
            <section className="rounded-xl border border-destructive/30 bg-card p-4">
              <h2 className="mb-2 text-sm font-semibold">Shortfalls coming up</h2>
              <ul className="space-y-1 text-sm">
                {d.shortfalls.slice(0, 8).map((s) => (
                  <li key={`${s.row}-${s.week}`}>
                    <span className="font-medium">{s.row}</span>: {s.gap} h more planned than
                    available in the week of {formatDay(s.week, 'd MMM')}
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p className="text-sm text-muted-foreground">
              No week has more planned work than available hours.
            </p>
          )}
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">
                    {GROUPS.find((g) => g.value === groupBy)!.label.replace('By ', '')}
                  </th>
                  {d.weeks.map((w, i) => (
                    <th key={w} className="px-2 py-2 text-right font-medium whitespace-nowrap">
                      {i === 0 ? 'This week' : formatDay(w, 'd MMM')}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-medium">Overdue</th>
                  <th className="px-2 py-2 text-right font-medium">No due date</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {d.rows.map((r) => (
                  <Row key={r.id} r={r} />
                ))}
              </tbody>
              {groupBy !== 'skill' ? (
                <tfoot className="border-t">
                  <Row r={d.totals} bold />
                </tfoot>
              ) : null}
            </table>
          </div>
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              Each cell is planned hours / available hours.{' '}
              <span className="rounded bg-destructive/15 px-1 text-destructive">Red</span> means
              more work than time,{' '}
              <span className="rounded bg-warning/15 px-1 text-warning">amber</span> 85% full or
              more.
            </p>
            {d.assumptions.map((a) => (
              <p key={a}>{a}</p>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
