import type { ColumnDef } from '@tanstack/react-table';
import { ArrowUpCircle, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  RISK_SEVERITIES,
  RISK_TYPES,
  riskSeverity,
  type RiskDto,
  type RiskQuery,
  type RiskSeverity,
  type RiskType,
} from '@arihant/shared';
import { SeverityBadge, severityColor } from '@/components/charts/HealthBadge';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDay } from '@/features/work/format';
import { useProjects } from '@/features/work/hooks';
import { useCan } from '@/hooks/use-permission';
import * as api from '@/services/api/insights';
import { useRiskHeatmap, useRiskMutation, useRisks } from './hooks';
import { EscalateDialog, RISK_STATUS_LABELS, RISK_TYPE_LABELS, RiskDialog } from './RiskDialog';

const ALL = 'all';
const SEVERITY_LABEL: Record<RiskSeverity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

/** 5×5 probability × impact grid of active items. Count text stays in text tokens. */
export function RiskHeatmap({ projectId }: { projectId?: string }) {
  const heat = useRiskHeatmap(projectId ? { projectId } : {});
  const [asTable, setAsTable] = useState(false);
  if (heat.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!heat.data) return null;
  const { cells, total } = heat.data;
  const levels = [5, 4, 3, 2, 1];
  return (
    <section className="rounded-xl border bg-card p-4" aria-label="Risk heatmap">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Heatmap</h3>
          <p className="text-xs text-muted-foreground">
            {total} active items · probability × impact
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
        >
          {asTable ? 'Grid' : 'Table'}
        </Button>
      </header>
      {asTable ? (
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-medium">Probability \ Impact</th>
              {[1, 2, 3, 4, 5].map((i) => (
                <th key={i} className="py-1 text-right font-medium">
                  {i}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {levels.map((p) => (
              <tr key={p} className="border-t">
                <td className="py-1">{p}</td>
                {[1, 2, 3, 4, 5].map((i) => (
                  <td key={i} className="py-1 text-right tabular">
                    {cells[p - 1]?.[i - 1] ?? 0}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="flex gap-2">
          <div className="flex w-4 items-center justify-center">
            <span className="-rotate-90 whitespace-nowrap text-xs text-muted-foreground">
              Probability
            </span>
          </div>
          <div className="flex-1">
            <div className="grid grid-cols-[1.25rem_repeat(5,minmax(0,1fr))] gap-1">
              {levels.map((p) => (
                <div key={p} className="contents">
                  <span className="flex items-center text-xs text-muted-foreground tabular">
                    {p}
                  </span>
                  {[1, 2, 3, 4, 5].map((i) => {
                    const count = cells[p - 1]?.[i - 1] ?? 0;
                    const sev = riskSeverity(p * i);
                    return (
                      <div
                        key={i}
                        title={`Probability ${p}, impact ${i}: ${count} item${count === 1 ? '' : 's'} (${SEVERITY_LABEL[sev]})`}
                        className="relative flex aspect-[4/3] items-center justify-center rounded-md border text-sm font-semibold tabular"
                      >
                        <span
                          className="absolute inset-0 rounded-md"
                          style={{ background: severityColor(sev), opacity: count ? 0.35 : 0.08 }}
                          aria-hidden
                        />
                        <span className="relative">{count || ''}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
              <span />
              {[1, 2, 3, 4, 5].map((i) => (
                <span key={i} className="text-center text-xs text-muted-foreground tabular">
                  {i}
                </span>
              ))}
            </div>
            <p className="mt-1 text-center text-xs text-muted-foreground">Impact</p>
          </div>
        </div>
      )}
      <ul className="mt-3 flex flex-wrap gap-3" aria-label="Severity legend">
        {RISK_SEVERITIES.map((s) => (
          <li key={s}>
            <SeverityBadge severity={s} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Risk register with filters, used by the Risks page and the project page tab. */
export function RiskRegister({ projectId, canCreate }: { projectId?: string; canCreate: boolean }) {
  const [status, setStatus] = useState<string>('active');
  const [type, setType] = useState<string>(ALL);
  const [severity, setSeverity] = useState<string>(ALL);
  const [project, setProject] = useState<string>(ALL);
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<RiskDto | 'new' | null>(null);
  const [escalating, setEscalating] = useState<RiskDto | null>(null);
  const [deleting, setDeleting] = useState<RiskDto | null>(null);
  const projects = useProjects({ limit: 100, archived: 'false' }, !projectId);

  const query: Partial<RiskQuery> = {
    page,
    limit: 20,
    status: status === ALL ? undefined : (status as RiskQuery['status']),
    type: type === ALL ? undefined : (type as RiskType),
    severity: severity === ALL ? undefined : (severity as RiskSeverity),
    projectId: projectId ?? (project === ALL ? undefined : project),
  };
  const risks = useRisks(query);
  const remove = useRiskMutation((id: string) => api.deleteRisk(id), 'Risk deleted');
  const reset =
    <T,>(fn: (v: T) => void) =>
    (v: T) => {
      setPage(1);
      fn(v);
    };

  const columns = useMemo<ColumnDef<RiskDto, unknown>[]>(
    () => [
      {
        header: 'Item',
        cell: ({ row: { original: r } }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">
              <span className="font-mono text-xs text-muted-foreground">{r.key}</span> {r.title}
            </p>
            <p className="text-xs text-muted-foreground">
              {RISK_TYPE_LABELS[r.type]}
              {projectId ? '' : ` · ${r.project.key}`}
              {r.escalationLevel ? ` · escalated ×${r.escalationLevel}` : ''}
            </p>
          </div>
        ),
      },
      {
        header: 'Severity',
        cell: ({ row: { original: r } }) => <SeverityBadge severity={r.severity} score={r.score} />,
      },
      { header: 'Status', cell: ({ row: { original: r } }) => RISK_STATUS_LABELS[r.status] },
      {
        header: 'Owner',
        cell: ({ row: { original: r } }) =>
          r.owner?.name ?? <span className="text-muted-foreground">Unassigned</span>,
      },
      { header: 'Target', cell: ({ row: { original: r } }) => formatDay(r.dueDate) },
      {
        id: 'actions',
        header: '',
        cell: ({ row: { original: r } }) =>
          r.canEdit ? (
            <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {r.escalationLevel < 3 && (r.status === 'open' || r.status === 'mitigating') ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Escalate ${r.key}`}
                  onClick={() => setEscalating(r)}
                >
                  <ArrowUpCircle />
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={`Delete ${r.key}`}
                onClick={() => setDeleting(r)}
              >
                <Trash2 />
              </Button>
            </span>
          ) : null,
      },
    ],
    [projectId],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onValueChange={reset(setStatus)}>
          <SelectTrigger size="sm" className="w-36" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {Object.entries(RISK_STATUS_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={reset(setType)}>
          <SelectTrigger size="sm" className="w-32" aria-label="Filter by type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            {RISK_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {RISK_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={reset(setSeverity)}>
          <SelectTrigger size="sm" className="w-36" aria-label="Filter by severity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All severities</SelectItem>
            {RISK_SEVERITIES.map((s) => (
              <SelectItem key={s} value={s}>
                {SEVERITY_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {projectId ? null : (
          <Select value={project} onValueChange={reset(setProject)}>
            <SelectTrigger size="sm" className="w-52" aria-label="Filter by project">
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
        )}
        {canCreate ? (
          <Button size="sm" className="ml-auto" onClick={() => setDialog('new')}>
            <Plus /> Raise
          </Button>
        ) : null}
      </div>
      <DataTable
        columns={columns}
        data={risks.data?.items}
        meta={risks.data?.meta}
        onPageChange={setPage}
        isLoading={risks.isLoading}
        error={risks.error}
        onRetry={() => void risks.refetch()}
        getRowId={(r) => r.id}
        onRowClick={(r) => setDialog(r)}
        empty={
          <EmptyState
            compact
            icon={ShieldAlert}
            title="No risks or issues match"
            description="Raise one when something threatens scope, schedule or quality."
          />
        }
      />
      {dialog ? (
        <RiskDialog
          risk={dialog === 'new' ? undefined : dialog}
          projectId={projectId}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {escalating ? <EscalateDialog risk={escalating} onClose={() => setEscalating(null)} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.key ?? ''}?`}
        description="The item is removed from the register. Its audit trail is kept."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleting) await remove.mutateAsync(deleting.id);
        }}
      />
    </div>
  );
}

export function RisksPage() {
  const canWrite = useCan('risk:write');
  return (
    <div className="space-y-5">
      <PageHeader
        title="Risks & Issues"
        description="Register of risks, issues and blockers across the projects you can see."
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <RiskRegister canCreate={canWrite} />
        <RiskHeatmap />
      </div>
    </div>
  );
}
