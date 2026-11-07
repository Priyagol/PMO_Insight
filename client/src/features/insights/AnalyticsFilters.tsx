import { useMemo, useState } from 'react';
import type { AnalyticsQuery } from '@arihant/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDepartments } from '@/features/org/hooks';
import { useProjects } from '@/features/work/hooks';
import { PERIODS, periodRange } from './hooks';

const ALL = 'all';

export interface AnalyticsFilterState {
  period: string;
  departmentId: string;
  projectId: string;
}

/** Filter state for analytics pages; derives the API query (date range + optional scopes). */
export function useAnalyticsFilters(initial: Partial<AnalyticsFilterState> = {}) {
  const [state, setState] = useState<AnalyticsFilterState>({
    period: '30',
    departmentId: ALL,
    projectId: ALL,
    ...initial,
  });
  const query = useMemo<Partial<AnalyticsQuery>>(
    () => ({
      ...periodRange(state.period),
      departmentId: state.departmentId === ALL ? undefined : state.departmentId,
      projectId: state.projectId === ALL ? undefined : state.projectId,
    }),
    [state],
  );
  return { state, setState, query };
}

/** One row of filters above the charts: period, department, project. */
export function AnalyticsFilters({
  state,
  onChange,
  showProject = true,
  showPeriod = true,
}: {
  state: AnalyticsFilterState;
  onChange: (s: AnalyticsFilterState) => void;
  showProject?: boolean;
  showPeriod?: boolean;
}) {
  const departments = useDepartments();
  const projects = useProjects({ limit: 100, archived: 'false' }, showProject);
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
      {showPeriod ? (
        <Select value={state.period} onValueChange={(period) => onChange({ ...state, period })}>
          <SelectTrigger size="sm" className="w-40" aria-label="Period">
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
      ) : null}
      <Select
        value={state.departmentId}
        onValueChange={(departmentId) => onChange({ ...state, departmentId })}
      >
        <SelectTrigger size="sm" className="w-44" aria-label="Department">
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
      {showProject ? (
        <Select
          value={state.projectId}
          onValueChange={(projectId) => onChange({ ...state, projectId })}
        >
          <SelectTrigger size="sm" className="w-52" aria-label="Project">
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
    </div>
  );
}
