import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Plus,
  Rocket,
  RotateCcw,
  Undo2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  ENVIRONMENTS,
  ENVIRONMENT_LABELS,
  RELEASE_STATUS_LABELS,
  type DeploymentStatus,
  type Environment,
  type ReleaseDto,
  type ReleaseStatus,
} from '@arihant/shared';
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
import { formatDay } from '@/features/work/format';
import { useProjects } from '@/features/work/hooks';
import { useCan } from '@/hooks/use-permission';
import * as api from '@/services/api/delivery';
import { useDeliveryMutation } from './hooks';

const RELEASE_ICON: Record<ReleaseStatus, { icon: LucideIcon; color: string }> = {
  planned: { icon: CircleDashed, color: 'var(--muted-foreground)' },
  in_progress: { icon: Rocket, color: 'var(--status-warning)' },
  released: { icon: CheckCircle2, color: 'var(--status-good)' },
  rolled_back: { icon: Undo2, color: 'var(--status-critical)' },
  cancelled: { icon: XCircle, color: 'var(--muted-foreground)' },
};
export function ReleaseStatusBadge({ status }: { status: ReleaseStatus }) {
  const s = RELEASE_ICON[status];
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium">
      <s.icon className="size-3.5" style={{ color: s.color }} aria-hidden />{' '}
      {RELEASE_STATUS_LABELS[status]}
    </span>
  );
}
const DEPLOY: Record<DeploymentStatus, { label: string; icon: LucideIcon; color: string }> = {
  not_deployed: { label: 'Not deployed', icon: CircleDashed, color: 'var(--muted-foreground)' },
  deployed: { label: 'Deployed', icon: CheckCircle2, color: 'var(--status-good)' },
  failed: { label: 'Failed', icon: AlertTriangle, color: 'var(--status-critical)' },
  rolled_back: { label: 'Rolled back', icon: Undo2, color: 'var(--status-serious)' },
};

function NewReleaseDialog({ projectId, onClose }: { projectId?: string; onClose: () => void }) {
  const [project, setProject] = useState(projectId ?? '');
  const [version, setVersion] = useState('');
  const [name, setName] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [notes, setNotes] = useState('');
  const projects = useProjects({ limit: 100, archived: 'false' }, !projectId);
  const save = useDeliveryMutation(
    () =>
      api.createRelease({
        projectId: project,
        version: version.trim(),
        name: name.trim() || undefined,
        targetDate: targetDate || null,
        notes: notes.trim() || undefined,
      }),
    { success: (r) => `Release ${r.version} planned` },
  );
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Plan a release</DialogTitle>
          <DialogDescription>
            Deployments are recorded per environment. Production needs an approved go-live request.
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
          <FormField label="Version" required hint="e.g. 2.4.0">
            <Input value={version} onChange={(e) => setVersion(e.target.value)} maxLength={40} />
          </FormField>
          <FormField label="Target date">
            <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </FormField>
          <FormField label="Name" className="sm:col-span-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </FormField>
          <FormField label="Release notes" className="sm:col-span-2">
            <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!project || !version.trim() || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onClose })}
          >
            Plan release
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeployDialog({
  release,
  environment,
  mode,
  onClose,
}: {
  release: ReleaseDto;
  environment: Environment;
  mode: 'deploy' | 'rollback';
  onClose: () => void;
}) {
  const [build, setBuild] = useState('');
  const [text, setText] = useState('');
  const [outcome, setOutcome] = useState<'deployed' | 'failed'>('deployed');
  const run = useDeliveryMutation(
    () =>
      mode === 'deploy'
        ? api.deployRelease(release.id, {
            environment,
            outcome,
            build: build.trim() || undefined,
            notes: text.trim() || undefined,
          })
        : api.rollbackRelease(release.id, environment, text.trim()),
    {
      success:
        mode === 'deploy'
          ? `${ENVIRONMENT_LABELS[environment]} deployment recorded`
          : `${ENVIRONMENT_LABELS[environment]} rolled back`,
    },
  );
  return (
    <Dialog open onOpenChange={(o) => !o && !run.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'deploy' ? 'Record deployment' : 'Roll back'}: {release.version} →{' '}
            {ENVIRONMENT_LABELS[environment]}
          </DialogTitle>
          <DialogDescription>Recorded in the release history and the audit log.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {mode === 'deploy' ? (
            <>
              <FormField label="Result">
                <Select
                  value={outcome}
                  onValueChange={(v) => setOutcome(v as 'deployed' | 'failed')}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deployed">Deployed successfully</SelectItem>
                    <SelectItem value="failed">Deployment failed</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Build / artefact">
                <Input value={build} onChange={(e) => setBuild(e.target.value)} maxLength={120} />
              </FormField>
            </>
          ) : null}
          <FormField label={mode === 'deploy' ? 'Notes' : 'Reason'} required={mode === 'rollback'}>
            <Textarea
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={2000}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={run.isPending}>
            Cancel
          </Button>
          <Button
            variant={mode === 'rollback' ? 'destructive' : 'default'}
            disabled={run.isPending || (mode === 'rollback' && text.trim().length < 3)}
            onClick={() => run.mutate(undefined, { onSuccess: onClose })}
          >
            {mode === 'deploy' ? 'Record' : 'Roll back'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReleaseDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['releases', 'detail', id], queryFn: () => api.fetchRelease(id) });
  const [action, setAction] = useState<{ env: Environment; mode: 'deploy' | 'rollback' } | null>(
    null,
  );
  const goLive = useDeliveryMutation(() => api.requestGoLive(id), {
    success: 'Go-live approval requested',
  });
  const r = q.data;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {q.error ? (
          <ErrorState error={q.error} />
        ) : !r ? (
          <Skeleton className="m-4 h-64" />
        ) : (
          <div className="space-y-5 p-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                <Link to={`/projects/${r.project.id}`} className="hover:underline">
                  {r.project.key} · {r.project.name}
                </Link>
                {r.targetDate ? ` · target ${formatDay(r.targetDate)}` : ''}
              </p>
              <SheetTitle>
                {r.version}
                {r.name ? ` · ${r.name}` : ''}
              </SheetTitle>
              <SheetDescription asChild>
                <div className="flex flex-wrap items-center gap-3">
                  <ReleaseStatusBadge status={r.status} />
                  {r.approval ? (
                    <Link
                      to={`/approvals?open=${r.approval.id}`}
                      className="text-xs text-primary hover:underline"
                    >
                      Go-live {r.approval.key}: {r.approval.status}
                    </Link>
                  ) : (
                    <span className="text-xs">No go-live request yet</span>
                  )}
                  {r.openTasks ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium">
                      <AlertTriangle
                        className="size-3.5"
                        style={{ color: 'var(--status-warning)' }}
                        aria-hidden
                      />{' '}
                      {r.openTasks} linked task(s) not done
                    </span>
                  ) : null}
                </div>
              </SheetDescription>
            </div>
            <section aria-label="Environments" className="grid gap-2 sm:grid-cols-2">
              {ENVIRONMENTS.map((env) => {
                const e = r.environments.find((x) => x.environment === env)!;
                const st = DEPLOY[e.status];
                const prodLocked = env === 'prod' && !r.can.deployProd;
                return (
                  <div key={env} className="rounded-lg border p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{ENVIRONMENT_LABELS[env]}</p>
                      <span className="inline-flex items-center gap-1 text-xs font-medium">
                        <st.icon className="size-3.5" style={{ color: st.color }} aria-hidden />{' '}
                        {st.label}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {e.at
                        ? `${new Date(e.at).toLocaleString('en-IN')} · ${e.by?.name ?? '—'}`
                        : '—'}
                      {e.build ? ` · build ${e.build}` : ''}
                    </p>
                    {r.can.edit ? (
                      <div className="mt-2 flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={prodLocked}
                          title={prodLocked ? 'Needs an approved go-live request' : undefined}
                          onClick={() => setAction({ env, mode: 'deploy' })}
                        >
                          <Rocket /> Deploy
                        </Button>
                        {e.status === 'deployed' ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setAction({ env, mode: 'rollback' })}
                          >
                            <RotateCcw /> Roll back
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </section>
            {r.can.edit &&
            r.status !== 'released' &&
            r.approval?.status !== 'pending' &&
            r.approval?.status !== 'approved' ? (
              <Button disabled={goLive.isPending} onClick={() => goLive.mutate(undefined)}>
                <CheckCircle2 /> Request go-live approval
              </Button>
            ) : null}
            {r.tasks.length ? (
              <section aria-label="Tasks in this release">
                <h4 className="mb-1 text-sm font-semibold">Tasks ({r.tasks.length})</h4>
                <ul className="space-y-1 text-sm">
                  {r.tasks.map((t) => (
                    <li key={t.id} className="flex items-center gap-2">
                      <span className="font-mono text-xs">{t.key}</span>
                      <span className="flex-1 truncate">{t.title}</span>
                      <StatusBadge status={t.status} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {r.notes ? (
              <section>
                <h4 className="mb-1 text-sm font-semibold">Release notes</h4>
                <p className="text-sm whitespace-pre-wrap">{r.notes}</p>
              </section>
            ) : null}
            <section aria-label="History">
              <h4 className="mb-1 text-sm font-semibold">History</h4>
              <ol className="space-y-1 text-xs">
                {r.history.map((h, i) => (
                  <li key={i}>
                    <span className="text-muted-foreground">
                      {new Date(h.at).toLocaleString('en-IN')}
                    </span>{' '}
                    · {h.by?.name ?? 'System'} {h.action}
                    {h.notes ? <span className="text-muted-foreground"> — {h.notes}</span> : null}
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
        {action && r ? (
          <DeployDialog
            release={r}
            environment={action.env}
            mode={action.mode}
            onClose={() => setAction(null)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export function ReleasesHost({ projectId }: { projectId?: string }) {
  const canWrite = useCan('release:write');
  const [params, setParams] = useSearchParams();
  const openId = params.get('release');
  const [creating, setCreating] = useState(false);
  const query = { projectId, limit: 50 };
  const list = useQuery({
    queryKey: ['releases', 'list', query],
    queryFn: () => api.fetchReleases(query),
  });
  const setOpen = (id: string | null) =>
    setParams((p) => {
      if (id) p.set('release', id);
      else p.delete('release');
      return p;
    });
  return (
    <div className="space-y-3">
      {canWrite ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> Plan release
          </Button>
        </div>
      ) : null}
      {list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <Skeleton className="h-40" />
      ) : !list.data?.items.length ? (
        <div className="rounded-xl border bg-card">
          <EmptyState icon={Rocket} title="No releases yet" />
        </div>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {list.data.items.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50"
                onClick={() => setOpen(r.id)}
              >
                <span className="w-28 font-mono text-sm font-medium">{r.version}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{r.name ?? '—'}</span>
                  <span className="block text-xs text-muted-foreground">
                    {projectId ? '' : `${r.project.key} · `}
                    {r.environments
                      .filter((e) => e.status === 'deployed')
                      .map((e) => ENVIRONMENT_LABELS[e.environment])
                      .join(', ') || 'Not deployed'}
                    {r.targetDate ? ` · target ${formatDay(r.targetDate, 'd MMM')}` : ''}
                  </span>
                </span>
                <ReleaseStatusBadge status={r.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {creating ? (
        <NewReleaseDialog projectId={projectId} onClose={() => setCreating(false)} />
      ) : null}
      {openId ? <ReleaseDetail id={openId} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

export function ReleasesPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Releases"
        description="Versions, deployments per environment, go-live approval and rollbacks."
      />
      <ReleasesHost />
    </div>
  );
}
