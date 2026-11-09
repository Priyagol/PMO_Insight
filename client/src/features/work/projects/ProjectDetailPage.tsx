import { formatDistanceToNow } from 'date-fns';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  CheckCircle2,
  BadgeCheck,
  Copy,
  LayoutTemplate,
  ListTodo,
  Pencil,
  Save,
  Timer,
} from 'lucide-react';
import { Suspense, useState } from 'react';
import { lazyFresh } from '@/lib/lazy-fresh';
import { HoldBanner, HoldButton } from './ProjectHold';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import {
  PROJECT_MEMBER_ROLES,
  STATUS_LABELS,
  type ProjectDto,
  type ProjectMemberRole,
  type UserRef,
} from '@arihant/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { FormField } from '@/components/common/FormField';
import { PriorityIndicator } from '@/components/common/PriorityIndicator';
import { StatCard } from '@/components/common/StatCard';
import { StatusBadge } from '@/components/common/StatusBadge';
import { UserAvatar } from '@/components/common/UserAvatar';
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
import { MultiUserPicker } from '@/features/org/components/MultiUserPicker';
import { RiskHeatmap, RiskRegister } from '@/features/insights/RisksPage';
import { NewApprovalDialog } from '@/features/collaboration/ApprovalsPage';
import { MeetingsHost } from '@/features/collaboration/MeetingsPage';
import { DocumentsHost } from '@/features/delivery/DocumentsPage';
import { ReleasesHost } from '@/features/delivery/ReleasesPage';
import { ChangeRequestsHost } from '@/features/delivery/StakeholdersPage';
import { AgileSetupPanel } from '@/features/agile/AgileSetupPanel';
import { ProjectWorkflowPanel } from '@/features/workflows/ProjectWorkflowPanel';
import { ProjectConfidentialToggle } from '@/features/security/RestrictionControls';
import { ServiceDeskQueue, ServiceDeskSetup } from '@/features/servicedesk/ServiceDeskPanels';
import { BacklogPanel } from '@/features/agile/BacklogPanel';
import { ProjectSummaryButton } from '@/features/intelligence/ai-actions';
import { MilestonesPanel } from '@/features/planning/MilestonesPanel';
import { CustomFieldsEditor, DependenciesPanel } from '@/features/planning/ProjectSetupPanels';
import { SaveAsTemplateDialog } from '@/features/planning/TemplatesPage';
import { useCan } from '@/hooks/use-permission';
import * as work from '@/services/api/work';
import { ActivityList } from '../collab/ActivityList';
import { AttachmentsPanel } from '../collab/AttachmentsPanel';
import { formatDay } from '../format';
import {
  useProject,
  useProjectActivity,
  useProjectOverview,
  useProjectVersions,
  useWorkMutation,
} from '../hooks';
import { TaskWorkspace } from '../tasks/TaskWorkspace';
import { useTaskDrawer } from '../tasks/use-task-drawer';
import { ProgressBar } from './ProgressBar';

// Charts (Recharts) load only when the Analytics tab is opened.
// Charts (Recharts) load only when a report tab is opened.
const AgileReportsPanel = lazyFresh(() =>
  import('@/features/agile/AgileReportsPanel').then((m) => ({ default: m.AgileReportsPanel })),
);
const DelayAnalysis = lazyFresh(() =>
  import('@/features/insights/DelayAnalysis').then((m) => ({ default: m.DelayAnalysis })),
);
const ProjectAnalyticsTab = lazyFresh(() =>
  import('@/features/insights/ProjectAnalyticsTab').then((m) => ({
    default: m.ProjectAnalyticsTab,
  })),
);
import { ProjectFormDialog } from './ProjectFormDialog';

const ROLE_LABELS: Record<ProjectMemberRole, string> = {
  manager: 'Manager',
  lead: 'Lead',
  member: 'Member',
  viewer: 'Viewer',
};

function Overview({ project }: { project: ProjectDto }) {
  const overview = useProjectOverview(project.id);
  const drawer = useTaskDrawer();
  const p = project.progress;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Progress (effort-weighted)"
          value={`${p.percent}%`}
          icon={CheckCircle2}
          hint={<ProgressBar value={p.percent} />}
        />
        <StatCard label="Tasks done" value={`${p.doneTasks} / ${p.totalTasks}`} icon={ListTodo} />
        <StatCard
          label="Overdue tasks"
          value={<span className={p.overdueTasks ? 'text-destructive' : ''}>{p.overdueTasks}</span>}
          icon={Timer}
        />
        <StatCard
          label="Blocked tasks"
          value={<span className={p.blockedTasks ? 'text-warning' : ''}>{p.blockedTasks}</span>}
          icon={AlertTriangle}
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <section className="rounded-xl border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Due in the next 14 days</h2>
            {overview.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : overview.data?.upcoming.length ? (
              <ul className="divide-y">
                {overview.data.upcoming.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => drawer.open(t.id)}
                      className="flex w-full items-center gap-3 py-2 text-left text-sm hover:bg-muted/40"
                    >
                      <span className="font-mono text-xs text-muted-foreground">{t.key}</span>
                      <span className="flex-1 truncate">{t.title}</span>
                      <PriorityIndicator priority={t.priority} showLabel={false} />
                      <span className="w-28 truncate text-xs text-muted-foreground">
                        {t.assignee?.name ?? 'Unassigned'}
                      </span>
                      <span
                        className={`w-20 text-right text-xs tabular ${t.overdue ? 'font-medium text-destructive' : ''}`}
                      >
                        {formatDay(t.dueDate, 'd MMM')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing due in the next two weeks.</p>
            )}
          </section>
          <section className="rounded-xl border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Open work by person</h2>
            {overview.data?.workload.length ? (
              <ul className="space-y-2">
                {overview.data.workload.map((w, i) => (
                  <li key={w.user?.id ?? `none-${i}`} className="flex items-center gap-3 text-sm">
                    <UserAvatar name={w.user?.name ?? '?'} size="sm" />
                    <span className="flex-1">{w.user?.name ?? 'Unassigned'}</span>
                    <span className="text-xs text-muted-foreground tabular">
                      {w.openTasks} open · {w.estimatedHours} h est.
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No open tasks.</p>
            )}
          </section>
        </div>
        <aside className="space-y-4 rounded-xl border bg-card p-4 text-sm">
          <dl className="grid grid-cols-[110px_1fr] gap-y-2">
            <dt className="text-muted-foreground">Manager</dt>
            <dd>{project.manager?.name ?? '—'}</dd>
            <dt className="text-muted-foreground">Business owner</dt>
            <dd>{project.owner?.name ?? '—'}</dd>
            <dt className="text-muted-foreground">Department</dt>
            <dd>{project.department?.name ?? '—'}</dd>
            <dt className="text-muted-foreground">Category</dt>
            <dd>{project.category ?? '—'}</dd>
            <dt className="text-muted-foreground">Priority</dt>
            <dd>
              <PriorityIndicator priority={project.priority} />
            </dd>
            <dt className="text-muted-foreground">Dates</dt>
            <dd>
              {formatDay(project.startDate)} → {formatDay(project.endDate)}
            </dd>
            <dt className="text-muted-foreground">Estimate</dt>
            <dd>{project.estimatedHours != null ? `${project.estimatedHours} h` : '—'}</dd>
            <dt className="text-muted-foreground">Budget</dt>
            <dd>
              {project.budget
                ? new Intl.NumberFormat('en-IN', {
                    style: 'currency',
                    currency: 'INR',
                    maximumFractionDigits: 0,
                  }).format(project.budget.amount)
                : '—'}
            </dd>
          </dl>
          {project.description ? (
            <p className="border-t pt-3 whitespace-pre-wrap text-muted-foreground">
              {project.description}
            </p>
          ) : null}
          {project.objectives.length ? (
            <div className="border-t pt-3">
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">
                Objectives
              </h3>
              <ul className="list-disc space-y-1 pl-4">
                {project.objectives.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function Team({ project }: { project: ProjectDto }) {
  const [draft, setDraft] = useState(() =>
    project.members.map((m) => ({ user: m.user, role: m.role })),
  );
  const dirty =
    JSON.stringify(draft.map((d) => [d.user.id, d.role])) !==
    JSON.stringify(project.members.map((m) => [m.user.id, m.role]));
  const save = useWorkMutation(
    () =>
      work.setProjectMembers(
        project.id,
        draft.map((d) => ({ userId: d.user.id, role: d.role })),
      ),
    { success: 'Team updated' },
  );
  const editable = project.can.manageMembers;
  const managerId = project.manager?.id;

  return (
    <div className="space-y-4">
      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <MultiUserPicker
            value={draft.map((d) => d.user)}
            lockedIds={managerId ? [managerId] : []}
            addLabel="Add members"
            onChange={(users: UserRef[]) =>
              setDraft(
                users.map(
                  (u) =>
                    draft.find((d) => d.user.id === u.id) ?? {
                      user: u,
                      role: 'member' as ProjectMemberRole,
                    },
                ),
              )
            }
          />
          <Button
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate(undefined)}
          >
            <Save /> Save team
          </Button>
        </div>
      ) : null}
      <ul className="divide-y rounded-xl border bg-card">
        {draft.map((m) => (
          <li key={m.user.id} className="flex items-center gap-3 px-4 py-2.5">
            <UserAvatar name={m.user.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{m.user.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {m.user.designation ?? m.user.email}
              </p>
            </div>
            {editable && m.user.id !== managerId ? (
              <Select
                value={m.role}
                onValueChange={(v) =>
                  setDraft((d) =>
                    d.map((x) =>
                      x.user.id === m.user.id ? { ...x, role: v as ProjectMemberRole } : x,
                    ),
                  )
                }
              >
                <SelectTrigger size="sm" className="w-32" aria-label={`Role of ${m.user.name}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_MEMBER_ROLES.filter((r) => r !== 'manager').map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-xs text-muted-foreground">{ROLE_LABELS[m.role]}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Leads can edit the project like the manager. Viewers can see it but are not offered as
        assignees. People with open tasks here must have them reassigned before removal.
      </p>
    </div>
  );
}

function History({ projectId }: { projectId: string }) {
  const versions = useProjectVersions(projectId);
  if (versions.isLoading) return <Skeleton className="h-32 w-full" />;
  if (!versions.data?.length)
    return (
      <EmptyState
        compact
        title="No changes yet"
        description="Edits to project details appear here with before and after values."
      />
    );
  return (
    <ol className="space-y-3">
      {versions.data.map((v) => (
        <li key={v.version} className="rounded-lg border bg-card p-3 text-sm">
          <p>
            <span className="font-medium">Version {v.version}</span> ·{' '}
            {v.changedBy?.name ?? 'System'} ·{' '}
            <span className="text-muted-foreground">
              {formatDistanceToNow(new Date(v.changedAt), { addSuffix: true })}
            </span>
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {v.changes.map((c) => (
              <li key={c.field}>
                <span className="font-medium text-foreground">{c.field}</span>:{' '}
                {String(
                  c.field === 'status'
                    ? (STATUS_LABELS[c.from as keyof typeof STATUS_LABELS] ?? c.from)
                    : JSON.stringify(c.from),
                )}{' '}
                →{' '}
                {String(
                  c.field === 'status'
                    ? (STATUS_LABELS[c.to as keyof typeof STATUS_LABELS] ?? c.to)
                    : JSON.stringify(c.to),
                )}
              </li>
            ))}
          </ul>
          {v.reason ? (
            <p className="mt-1 text-xs">
              <span className="font-medium">Reason:</span> {v.reason}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function DuplicateDialog({
  project,
  open,
  onOpenChange,
}: {
  project: ProjectDto;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const navigate = useNavigate();
  const [key, setKey] = useState('');
  const [name, setName] = useState(`${project.name} (copy)`);
  const [includeTasks, setIncludeTasks] = useState(true);
  const [includeMembers, setIncludeMembers] = useState(true);
  const dup = useWorkMutation(
    () =>
      work.duplicateProject(project.id, {
        key: key.toUpperCase(),
        name,
        includeTasks,
        includeMembers,
      }),
    {
      success: (p) => `${p.key} created`,
    },
  );
  const valid = /^[A-Za-z][A-Za-z0-9]{1,5}$/.test(key) && name.trim().length >= 2;
  return (
    <Dialog open={open} onOpenChange={(o) => !dup.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Duplicate {project.key}</DialogTitle>
          <DialogDescription>
            Copies details and, optionally, the task structure (reset to To Do) and team.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label="New key" hint="2–6 letters/numbers">
            <Input
              className="font-mono uppercase"
              maxLength={6}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoFocus
            />
          </FormField>
          <FormField label="New name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={includeTasks} onCheckedChange={(c) => setIncludeTasks(Boolean(c))} />{' '}
            Copy tasks, subtasks and dependencies
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={includeMembers}
              onCheckedChange={(c) => setIncludeMembers(Boolean(c))}
            />{' '}
            Copy team and assignees
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={dup.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!valid || dup.isPending}
            onClick={() =>
              dup.mutate(undefined, {
                onSuccess: (p) => {
                  onOpenChange(false);
                  navigate(`/projects/${p.id}`);
                },
              })
            }
          >
            {dup.isPending ? 'Copying…' : 'Duplicate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectDetailPage() {
  const { projectId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const project = useProject(projectId);
  const activity = useProjectActivity(projectId);
  const canDuplicate = useCan('project:create');
  const canReadRisks = useCan('risk:read');
  const canReadDocs = useCan('document:read');
  const canReadReleases = useCan('release:read');
  const canWriteRisks = useCan('risk:write');
  const canAnalytics = useCan('analytics:view');
  const [editing, setEditing] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [requestingClosure, setRequestingClosure] = useState(false);
  const canMeet = useCan('meeting:read');
  const canScheduleMeeting = useCan('meeting:write');
  const [confirmArchive, setConfirmArchive] = useState(false);
  const archive = useWorkMutation(
    () =>
      project.data?.archived ? work.restoreProject(projectId) : work.archiveProject(projectId),
    {
      success: (p) => (p.archived ? `${p.key} archived` : `${p.key} restored`),
    },
  );

  if (project.error)
    return (
      <ErrorState
        title="Project unavailable"
        error={project.error}
        onRetry={() => void project.refetch()}
      />
    );
  if (!project.data) return <Skeleton className="h-96 w-full" />;
  const p = project.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{p.key}</span>
            <StatusBadge status={p.status} />
            {p.archived ? (
              <span className="rounded bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                Archived
              </span>
            ) : null}
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{p.name}</h1>
          <p className="text-sm text-muted-foreground">
            {p.department?.name ?? 'No department'} · Managed by {p.manager?.name ?? '—'} ·{' '}
            {p.members.length} people
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {p.can.update ? (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
          ) : null}
          {canDuplicate ? (
            <Button variant="outline" size="sm" onClick={() => setDuplicating(true)}>
              <Copy /> Duplicate
            </Button>
          ) : null}
          {canDuplicate ? (
            <Button variant="outline" size="sm" onClick={() => setSavingTemplate(true)}>
              <LayoutTemplate /> Save as template
            </Button>
          ) : null}
          <ProjectSummaryButton projectId={p.id} />
          <HoldButton project={p} />
          {p.can.update && p.status !== 'completed' && p.status !== 'cancelled' ? (
            <Button variant="outline" size="sm" onClick={() => setRequestingClosure(true)}>
              <BadgeCheck /> Request closure
            </Button>
          ) : null}
          {p.can.archive ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => (p.archived ? archive.mutate(undefined) : setConfirmArchive(true))}
            >
              {p.archived ? (
                <>
                  <ArchiveRestore /> Restore
                </>
              ) : (
                <>
                  <Archive /> Archive
                </>
              )}
            </Button>
          ) : null}
        </div>
      </div>

      <HoldBanner project={p} />

      <Tabs defaultValue={tabParam ?? 'overview'}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tasks">Tasks ({p.progress.totalTasks})</TabsTrigger>
          <TabsTrigger value="backlog">Backlog &amp; sprints</TabsTrigger>
          <TabsTrigger value="sprint-reports">Agile reports</TabsTrigger>
          <TabsTrigger value="milestones">Milestones</TabsTrigger>
          {canMeet ? <TabsTrigger value="meetings">Meetings</TabsTrigger> : null}
          <TabsTrigger value="team">Team</TabsTrigger>
          {canReadRisks ? <TabsTrigger value="risks">Risks</TabsTrigger> : null}
          {canAnalytics ? <TabsTrigger value="analytics">Analytics</TabsTrigger> : null}
          {canAnalytics ? <TabsTrigger value="delays">Delays</TabsTrigger> : null}
          {canReadDocs ? <TabsTrigger value="documents">Documents</TabsTrigger> : null}
          {canReadReleases ? <TabsTrigger value="releases">Releases</TabsTrigger> : null}
          <TabsTrigger value="changes">Change requests</TabsTrigger>
          <TabsTrigger value="service-desk">Service desk</TabsTrigger>
          <TabsTrigger value="setup">
            Setup{p.dependsOnCount ? ` (${p.dependsOnCount} dep.)` : ''}
          </TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <Overview project={p} />
        </TabsContent>
        <TabsContent value="tasks" className="mt-4">
          <TaskWorkspace projectId={p.id} canCreate={p.can.createTask} />
        </TabsContent>
        <TabsContent value="team" className="mt-4">
          <Team key={p.updatedAt} project={p} />
        </TabsContent>
        {canReadRisks ? (
          <TabsContent value="risks" className="mt-4">
            <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
              <RiskRegister projectId={p.id} canCreate={canWriteRisks && !p.archived} />
              <RiskHeatmap projectId={p.id} />
            </div>
          </TabsContent>
        ) : null}
        {canAnalytics ? (
          <TabsContent value="analytics" className="mt-4">
            <Suspense fallback={<Skeleton className="h-96 w-full" />}>
              <ProjectAnalyticsTab projectId={p.id} />
            </Suspense>
          </TabsContent>
        ) : null}
        {canAnalytics ? (
          <TabsContent value="delays" className="mt-4">
            <Suspense fallback={<Skeleton className="h-96 w-full" />}>
              <DelayAnalysis projectId={p.id} />
            </Suspense>
          </TabsContent>
        ) : null}
        {canMeet ? (
          <TabsContent value="meetings" className="mt-4">
            <MeetingsHost projectId={p.id} canSchedule={canScheduleMeeting && !p.archived} />
          </TabsContent>
        ) : null}
        <TabsContent value="milestones" className="mt-4">
          <MilestonesPanel projectId={p.id} canEdit={p.can.update} />
        </TabsContent>
        {canReadDocs ? (
          <TabsContent value="documents" className="mt-4">
            <DocumentsHost projectId={p.id} />
          </TabsContent>
        ) : null}
        {canReadReleases ? (
          <TabsContent value="releases" className="mt-4">
            <ReleasesHost projectId={p.id} />
          </TabsContent>
        ) : null}
        <TabsContent value="service-desk" className="mt-4">
          <ServiceDeskQueue projectId={p.id} />
        </TabsContent>
        <TabsContent value="changes" className="mt-4">
          <ChangeRequestsHost projectId={p.id} />
        </TabsContent>
        <TabsContent value="backlog" className="mt-4">
          <BacklogPanel projectId={p.id} />
        </TabsContent>
        <TabsContent value="sprint-reports" className="mt-4">
          <Suspense fallback={<Skeleton className="h-96 w-full" />}>
            <AgileReportsPanel projectId={p.id} />
          </Suspense>
        </TabsContent>
        <TabsContent value="setup" className="mt-4 space-y-4">
          <ProjectWorkflowPanel project={p} />
          <ProjectConfidentialToggle project={p} />
          <ServiceDeskSetup project={p} />
          <AgileSetupPanel projectId={p.id} />
          <DependenciesPanel project={p} />
          <CustomFieldsEditor key={p.updatedAt + JSON.stringify(p.customFields)} project={p} />
        </TabsContent>
        <TabsContent value="files" className="mt-4">
          <AttachmentsPanel owner={{ type: 'project', id: p.id }} canUpload={p.can.update} />
        </TabsContent>
        <TabsContent value="activity" className="mt-4 rounded-xl border bg-card p-4">
          <ActivityList items={activity.data?.items} isLoading={activity.isLoading} showEntity />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <History projectId={p.id} />
        </TabsContent>
      </Tabs>
      <p className="text-xs text-muted-foreground">
        Documents and releases appear on this page in Phase 6B.
      </p>

      <ProjectFormDialog open={editing} onOpenChange={setEditing} project={p} />
      <DuplicateDialog
        key={String(duplicating)}
        project={p}
        open={duplicating}
        onOpenChange={setDuplicating}
      />
      {requestingClosure ? (
        <NewApprovalDialog
          projectId={p.id}
          entityType="project_closure"
          onClose={() => setRequestingClosure(false)}
        />
      ) : null}
      {savingTemplate ? (
        <SaveAsTemplateDialog
          projectId={p.id}
          projectName={p.name}
          onClose={() => setSavingTemplate(false)}
        />
      ) : null}
      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`Archive ${p.key}?`}
        description="Archived projects are read-only and hidden from lists and boards. You can restore them at any time."
        confirmLabel="Archive"
        onConfirm={async () => {
          await archive.mutateAsync(undefined);
        }}
      />
    </div>
  );
}
