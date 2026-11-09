import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Network } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  STATUS_LABELS,
  type DependencyLinkDto,
  type DependencyState,
  type TaskBriefDto,
} from '@arihant/shared';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { StatCard } from '@/components/common/StatCard';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { fetchDependencies } from '@/services/api/insights';
import { AnalyticsFilters, useAnalyticsFilters } from './AnalyticsFilters';

const STATE: Record<DependencyState, { label: string; tone: string }> = {
  late: { label: 'Late', tone: 'bg-destructive/10 text-destructive' },
  at_risk: { label: 'At risk', tone: 'bg-warning/10 text-warning' },
  waiting: { label: 'Waiting', tone: 'bg-muted text-muted-foreground' },
  ready: { label: 'Ready', tone: 'bg-success/10 text-success' },
};
const PROJECT_STATE = {
  late: { label: 'Late', tone: 'bg-destructive/10 text-destructive' },
  at_risk: { label: 'At risk', tone: 'bg-warning/10 text-warning' },
  ok: { label: 'On plan', tone: 'bg-muted text-muted-foreground' },
  done: { label: 'Done', tone: 'bg-success/10 text-success' },
} as const;

const taskLink = (id: string) => `/tasks/mine?task=${id}`;

function Pill({ label, tone }: { label: string; tone: string }) {
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', tone)}>
      {label}
    </span>
  );
}

function TaskCell({ t }: { t: TaskBriefDto | null }) {
  if (!t) return <span className="text-muted-foreground">A task in a project you cannot open</span>;
  return (
    <div className="min-w-0">
      <Link to={taskLink(t.id)} className="hover:underline">
        <span className="font-mono">{t.key}</span> {t.title}
      </Link>
      <p className="text-muted-foreground">
        {STATUS_LABELS[t.status]}
        {t.dueDate ? ` · due ${t.dueDate}` : ''}
        {t.assignee ? ` · ${t.assignee}` : ' · unassigned'}
      </p>
    </div>
  );
}

const th = 'px-3 py-2 text-left font-medium';
const td = 'px-3 py-2 align-top';

function Links({ links }: { links: DependencyLinkDto[] }) {
  const [show, setShow] = useState<'open' | 'all'>('open');
  const rows = show === 'open' ? links.filter((l) => l.state !== 'ready') : links;
  return (
    <div className="space-y-3">
      <div className="flex gap-2" role="group" aria-label="Show">
        <Button
          size="sm"
          variant={show === 'open' ? 'secondary' : 'ghost'}
          aria-pressed={show === 'open'}
          onClick={() => setShow('open')}
        >
          Still waiting
        </Button>
        <Button
          size="sm"
          variant={show === 'all' ? 'secondary' : 'ghost'}
          aria-pressed={show === 'all'}
          onClick={() => setShow('all')}
        >
          Include ready
        </Button>
      </div>
      {!rows.length ? (
        <div className="rounded-xl border bg-card">
          <EmptyState icon={Network} title="No open dependencies" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className={th}>Task</th>
                <th className={th} aria-label="waits for" />
                <th className={th}>Waits for</th>
                <th className={th}>State</th>
                <th className={th}>Why</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((l, i) => (
                <tr key={`${l.task.id}-${l.dependsOn?.id ?? i}`}>
                  <td className={td}>
                    <TaskCell t={l.task} />
                  </td>
                  <td className={cn(td, 'text-muted-foreground')}>
                    <ArrowLeft className="size-4" aria-hidden />
                  </td>
                  <td className={td}>
                    <TaskCell t={l.dependsOn} />
                    {l.crossProject ? (
                      <p className="mt-0.5 text-[11px] font-medium text-primary">Other project</p>
                    ) : null}
                  </td>
                  <td className={td}>
                    <Pill {...STATE[l.state]} />
                  </td>
                  <td className={cn(td, 'text-muted-foreground')}>{l.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Company-wide view of what waits on what, what is blocked, and which projects depend on others. */
export function DependenciesPage() {
  const { state, setState, query } = useAnalyticsFilters();
  const filter = { departmentId: query.departmentId, projectId: query.projectId };
  const q = useQuery({
    queryKey: ['insights', 'dependencies', filter],
    queryFn: () => fetchDependencies(filter),
    placeholderData: keepPreviousData,
  });
  const d = q.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Dependencies & Blockers"
        description="What waits on what across all projects in your view, what is blocked, and which waits put dates at risk."
        actions={<AnalyticsFilters state={state} onChange={setState} showPeriod={false} />}
      />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Open dependencies" value={d?.summary.openLinks} isLoading={!d} />
            <StatCard
              label="Waiting on late work"
              value={d?.summary.late}
              isLoading={!d}
              hint="the task waited for is overdue"
            />
            <StatCard
              label="At risk"
              value={d?.summary.atRisk}
              isLoading={!d}
              hint="due after the task that waits"
            />
            <StatCard label="Across projects" value={d?.summary.crossProject} isLoading={!d} />
            <StatCard
              label="Blocked tasks"
              value={d?.summary.blocked}
              isLoading={!d}
              hint={d ? `${d.summary.blockedOver3Days} for more than 3 days` : undefined}
            />
            <StatCard
              label="Project links at risk"
              value={d?.summary.projectLinksAtRisk}
              isLoading={!d}
            />
          </div>
          {!d ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Tabs defaultValue="tasks">
              <TabsList>
                <TabsTrigger value="tasks">Task dependencies</TabsTrigger>
                <TabsTrigger value="blocked">Blocked work ({d.blocked.length})</TabsTrigger>
                <TabsTrigger value="projects">
                  Project dependencies ({d.projects.length})
                </TabsTrigger>
              </TabsList>
              <TabsContent value="tasks" className="mt-4 space-y-4">
                {d.holdingUpMost.length ? (
                  <section className="rounded-xl border bg-card p-4">
                    <h2 className="mb-2 text-sm font-semibold">Holding up the most work</h2>
                    <ul className="divide-y text-xs">
                      {d.holdingUpMost.map((h) => (
                        <li key={h.task.id} className="flex items-center gap-3 py-2">
                          <div className="min-w-0 flex-1">
                            <TaskCell t={h.task} />
                          </div>
                          <span className="font-medium whitespace-nowrap">
                            {h.dependents} tasks wait for it
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                <Links links={d.links} />
              </TabsContent>
              <TabsContent value="blocked" className="mt-4">
                {!d.blocked.length ? (
                  <div className="rounded-xl border bg-card">
                    <EmptyState icon={Network} title="Nothing is blocked" />
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border bg-card">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 text-muted-foreground">
                        <tr>
                          <th className={th}>Task</th>
                          <th className={th}>Blocked for</th>
                          <th className={th}>Reason given</th>
                          <th className={th}>Holding up</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {d.blocked.map((b) => (
                          <tr key={b.task.id}>
                            <td className={td}>
                              <TaskCell t={b.task} />
                            </td>
                            <td
                              className={cn(
                                td,
                                'tabular',
                                b.days > 3 && 'font-medium text-destructive',
                              )}
                            >
                              {b.days} d
                            </td>
                            <td className={td}>
                              {b.note ?? (
                                <span className="text-muted-foreground">No reason given</span>
                              )}
                              {b.by ? <p className="text-muted-foreground">by {b.by}</p> : null}
                            </td>
                            <td className={cn(td, 'tabular')}>
                              {b.holdingUp ? `${b.holdingUp} tasks` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="projects" className="mt-4">
                {!d.projects.length ? (
                  <div className="rounded-xl border bg-card">
                    <EmptyState
                      icon={Network}
                      title="No project depends on another"
                      description="Add one under “Depends on” in a project's Setup tab to track it here."
                    />
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border bg-card">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 text-muted-foreground">
                        <tr>
                          <th className={th}>Project</th>
                          <th className={th}>Depends on</th>
                          <th className={th}>State</th>
                          <th className={th}>Why</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {d.projects.map((p) => (
                          <tr key={`${p.project.id}-${p.dependsOn.id}`}>
                            <td className={td}>
                              <Link to={`/projects/${p.project.id}`} className="hover:underline">
                                <span className="font-mono">{p.project.key}</span> {p.project.name}
                              </Link>
                              <p className="text-muted-foreground">
                                ends {p.project.endDate ?? 'not set'}
                              </p>
                            </td>
                            <td className={td}>
                              <span className="font-mono">{p.dependsOn.key}</span>{' '}
                              {p.dependsOn.name}
                              {p.note ? <p className="text-muted-foreground">{p.note}</p> : null}
                            </td>
                            <td className={td}>
                              <Pill {...PROJECT_STATE[p.state]} />
                            </td>
                            <td className={cn(td, 'text-muted-foreground')}>{p.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </>
      )}
    </div>
  );
}
