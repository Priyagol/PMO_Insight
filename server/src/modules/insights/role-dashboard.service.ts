import { Types } from 'mongoose';
import type {
  DashboardItemDto,
  DashboardKpiDto,
  DashboardPersona,
  RoleDashboardDto,
  TaskStatus,
  TeamPerformanceDto,
} from '@arihant/shared';
import { AppError } from '../../core/errors';
import { requireAuth, type AuthContext, type RequestContext } from '../../core/rbac/context';
import { addDaysIso, orgToday, startOfOrgDay, weekStartIso } from '../../core/time';
import { Approval } from '../approvals/approval.model';
import { listReleases } from '../delivery/release.service';
import { Milestone } from '../planning/planning.models';
import { Task } from '../tasks/task.model';
import { listAvailability, listTimesheets } from '../tracking/people.service';
import { teamPerformance } from '../tracking/performance.service';
import { Worklog } from '../tracking/tracking.models';
import { TaskTransition } from '../workflows/workflow.models';
import { resolveScope } from './analytics.service';
import { bottlenecks, performanceTrends, projectStatus } from './digest.service';

const OPEN: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'testing', 'blocked'];
const taskLink = (id: string) => `/tasks/mine?task=${id}`;
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n}%`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Most specific system role wins; custom roles fall back to their analytics scope. */
const ROLE_PERSONA: [string, DashboardPersona][] = [
  ['managing_director', 'executive'],
  ['cto', 'technology'],
  ['director', 'executive'],
  ['super_admin', 'executive'],
  ['department_head', 'department'],
  ['project_manager', 'project'],
  ['team_lead', 'team'],
  ['qa_tester', 'quality'],
  ['developer', 'individual'],
  ['employee', 'individual'],
];
const SCOPE_PERSONA: Record<string, DashboardPersona> = {
  org: 'executive',
  department: 'department',
  project: 'project',
  team: 'team',
  own: 'individual',
};

export function personaFor(auth: Pick<AuthContext, 'roleKeys' | 'permissions'>): DashboardPersona {
  for (const [role, persona] of ROLE_PERSONA) if (auth.roleKeys.includes(role)) return persona;
  return SCOPE_PERSONA[auth.permissions['analytics:view'] ?? 'own'] ?? 'individual';
}

/** Runs a section that needs a permission the viewer may not hold; missing access → null. */
async function optional<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError && (err.statusCode === 403 || err.statusCode === 404)) return null;
    throw err;
  }
}

async function decisionsWaiting(rc: RequestContext, auth: AuthContext) {
  const approvals = await Approval.countDocuments({
    status: 'pending',
    pendingApproverIds: auth.userObjectId,
  });
  const canApprove = Boolean(auth.permissions['timesheet:approve']);
  const [timesheets, leave] = canApprove
    ? await Promise.all([
        listTimesheets(rc, { scope: 'approvals', limit: 1 }).then((r) => r.meta.total),
        listAvailability(rc, { scope: 'approvals', limit: 1 }).then((r) => r.meta.total),
      ])
    : [0, 0];
  return { approvals, timesheets, leave, total: approvals + timesheets + leave };
}

function decisionItems(d: Awaited<ReturnType<typeof decisionsWaiting>>): DashboardItemDto[] {
  const out: DashboardItemDto[] = [];
  if (d.approvals)
    out.push({
      text: `${plural(d.approvals, 'approval')} waiting for your decision`,
      link: '/approvals',
    });
  if (d.timesheets)
    out.push({ text: `${plural(d.timesheets, 'timesheet')} to approve`, link: '/timesheets' });
  if (d.leave) out.push({ text: `${plural(d.leave, 'leave request')} to decide`, link: '/teams' });
  return out;
}

function decisionKpi(d: Awaited<ReturnType<typeof decisionsWaiting>>): DashboardKpiDto {
  return {
    label: 'Decisions waiting',
    value: String(d.total),
    hint: `${d.approvals} approvals · ${d.timesheets} timesheets · ${d.leave} leave`,
    tone: d.total ? 'warning' : 'good',
    link: '/approvals',
  };
}

function performanceKpis(perf: TeamPerformanceDto | null): DashboardKpiDto[] {
  if (!perf) return [];
  const t = perf.totals;
  return [
    {
      label: 'On-time delivery',
      value: pct(t.onTimeRate),
      hint: `${t.completedOnTime} of ${t.completedWithDueDate} with a due date`,
      tone:
        t.onTimeRate === null
          ? undefined
          : t.onTimeRate >= 80
            ? 'good'
            : t.onTimeRate >= 60
              ? 'warning'
              : 'bad',
      link: '/teams',
    },
    {
      label: 'Overdue tasks',
      value: String(t.overdue),
      hint: `${t.pending} pending in total`,
      tone: t.overdue ? 'bad' : 'good',
      link: '/teams',
    },
    {
      label: 'Rework',
      value: String(t.reworked),
      hint: `${t.qaRejections} sent back by QA`,
      tone: t.reworked ? 'warning' : 'good',
      link: '/teams',
    },
  ];
}

function peopleWithOverdue(perf: TeamPerformanceDto | null, max = 3): DashboardItemDto[] {
  if (!perf) return [];
  return perf.rows
    .filter((r) => r.overdue > 0)
    .slice(0, max)
    .map((r) => ({
      text: `${r.user.name} has ${plural(r.overdue, 'overdue task')}`,
      detail: `${r.pending} pending, ${pct(r.onTimeRate)} on time`,
      link: '/teams',
      tone: 'warning' as const,
    }));
}

/* ============================ Builders per role ============================ */

type Ctx = { rc: RequestContext; auth: AuthContext; period: { from: string; to: string } };
type Body = Pick<RoleDashboardDto, 'focus' | 'kpis' | 'attention' | 'lists'>;

async function executive({ rc, auth, period }: Ctx): Promise<Body> {
  const [status, perf, trends, decisions] = await Promise.all([
    projectStatus(rc, period),
    optional(() => teamPerformance(rc, { period: '30d' })),
    optional(() => performanceTrends(rc)),
    decisionsWaiting(rc, auth),
  ]);
  const declining = trends?.people.filter((p) => p.direction === 'declining') ?? [];
  const departments = new Map<
    string,
    {
      people: number;
      completed: number;
      overdue: number;
      withDue: number;
      onTime: number;
      rework: number;
    }
  >();
  for (const r of perf?.rows ?? []) {
    const k = r.user.department ?? 'No department';
    const d = departments.get(k) ?? {
      people: 0,
      completed: 0,
      overdue: 0,
      withDue: 0,
      onTime: 0,
      rework: 0,
    };
    d.people += 1;
    d.completed += r.completed;
    d.overdue += r.overdue;
    d.withDue += r.completedWithDueDate;
    d.onTime += r.completedOnTime;
    d.rework += r.reworked;
    departments.set(k, d);
  }
  return {
    focus:
      'Where the organisation stands: which projects need attention, how reliably work is delivered, and what is waiting for your decision.',
    kpis: [
      {
        label: 'Active projects',
        value: String(status.projects.length),
        hint: `${status.counts.red} red · ${status.counts.amber} amber · ${status.counts.green} green`,
        tone: status.counts.red ? 'bad' : status.counts.amber ? 'warning' : 'good',
        link: '/analytics',
      },
      ...performanceKpis(perf),
      decisionKpi(decisions),
    ],
    attention: [
      ...status.projects
        .filter((p) => p.rag === 'red')
        .slice(0, 6)
        .map((p) => ({
          text: `${p.project.key} ${p.project.name} is red`,
          detail: p.notes.join(' '),
          link: `/projects/${p.project.id}`,
          tone: 'bad' as const,
        })),
      ...decisionItems(decisions),
      ...(declining.length
        ? [
            {
              text: `${plural(declining.length, 'person', 'people')} finishing fewer tasks than the month before`,
              detail: declining
                .slice(0, 4)
                .map((p) => p.user.name)
                .join(', '),
              link: '/analytics',
              tone: 'warning' as const,
            },
          ]
        : []),
    ],
    lists: departments.size
      ? [
          {
            title: 'Departments (last 30 days)',
            columns: ['Department', 'People', 'Completed', 'Overdue now', 'On time', 'Rework'],
            rows: [...departments.entries()]
              .sort((a, b) => b[1].overdue - a[1].overdue)
              .map(([name, d]) => ({
                cells: [
                  name,
                  String(d.people),
                  String(d.completed),
                  String(d.overdue),
                  d.withDue ? `${Math.round((d.onTime / d.withDue) * 100)}%` : '—',
                  String(d.rework),
                ],
              })),
          },
        ]
      : [],
  };
}

async function technology({ rc, auth, period }: Ctx): Promise<Body> {
  const scope = await resolveScope(auth, period);
  const ids = scope.projectIds;
  const start = startOfOrgDay(period.from);
  const end = startOfOrgDay(addDaysIso(period.to, 1));
  const today = orgToday();
  const [status, perf, flow, bugs, releases] = await Promise.all([
    projectStatus(rc, period),
    optional(() => teamPerformance(rc, { period: '30d' })),
    bottlenecks(rc, period),
    Task.aggregate<{ _id: string; n: number; regressions: number }>([
      { $match: { projectId: { $in: ids }, deletedAt: null, type: 'bug', status: { $in: OPEN } } },
      {
        $group: {
          _id: { $ifNull: ['$bug.severity', 'major'] },
          n: { $sum: 1 },
          regressions: { $sum: { $cond: ['$bug.regression', 1, 0] } },
        },
      },
    ]),
    listReleases(rc, { limit: 100 }).then((r) => r.items),
  ]);
  const sev = new Map(bugs.map((b) => [b._id, b.n]));
  const severe = (sev.get('blocker') ?? 0) + (sev.get('critical') ?? 0);
  const regressions = bugs.reduce((a, b) => a + b.regressions, 0);
  const openBugs = bugs.reduce((a, b) => a + b.n, 0);
  const soon = addDaysIso(today, 14);
  const upcoming = releases
    .filter(
      (r) =>
        (r.status === 'planned' || r.status === 'in_progress') &&
        r.targetDate &&
        r.targetDate <= soon,
    )
    .sort((a, b) => (a.targetDate ?? '').localeCompare(b.targetDate ?? ''));
  const deployments = releases.flatMap((r) =>
    r.environments
      .filter((e) => e.at && new Date(e.at) >= start && new Date(e.at) < end)
      .map((e) => ({ release: r, env: e })),
  );
  const failed = deployments.filter(
    (d) => d.env.status === 'failed' || d.env.status === 'rolled_back',
  );
  return {
    focus:
      'Engineering health across the portfolio: defects, rework, releases and where work gets stuck.',
    kpis: [
      {
        label: 'Open critical bugs',
        value: String(severe),
        hint: `${openBugs} open bugs · ${regressions} regressions`,
        tone: severe ? 'bad' : 'good',
        link: '/tasks/board',
      },
      {
        label: 'Sent back by QA',
        value: String(perf?.totals.qaRejections ?? 0),
        hint: `${perf?.totals.reworked ?? 0} reworked in 30 days`,
        tone: perf?.totals.qaRejections ? 'warning' : 'good',
        link: '/teams',
      },
      {
        label: 'Releases due (14 days)',
        value: String(upcoming.length),
        hint: `${upcoming.filter((r) => r.targetDate! < today).length} past target date`,
        tone: upcoming.some((r) => r.targetDate! < today) ? 'bad' : undefined,
        link: '/releases',
      },
      {
        label: 'Deployments',
        value: String(deployments.length),
        hint: `${failed.length} failed or rolled back in the period`,
        tone: failed.length ? 'bad' : 'good',
        link: '/releases',
      },
      {
        label: 'Projects at red',
        value: String(status.counts.red),
        hint: `${status.counts.amber} amber of ${status.projects.length}`,
        tone: status.counts.red ? 'bad' : 'good',
        link: '/analytics',
      },
    ],
    attention: [
      ...failed.slice(0, 4).map((d) => ({
        text: `${d.release.project.key} ${d.release.version} ${d.env.status === 'failed' ? 'failed' : 'was rolled back'} on ${d.env.environment.toUpperCase()}`,
        link: '/releases',
        tone: 'bad' as const,
      })),
      ...upcoming
        .filter((r) => r.openTasks > 0)
        .slice(0, 4)
        .map((r) => ({
          text: `${r.project.key} ${r.version} due ${r.targetDate} with ${plural(r.openTasks, 'open task')}`,
          link: '/releases',
          tone: 'warning' as const,
        })),
      ...flow.findings
        .filter((f) => !f.startsWith('No recurring'))
        .map((f) => ({ text: f, link: '/analytics' })),
    ],
    lists: [
      {
        title: 'Upcoming releases',
        columns: ['Project', 'Version', 'Target', 'Status', 'Open tasks'],
        rows: upcoming.slice(0, 10).map((r) => ({
          cells: [
            r.project.key,
            r.version,
            r.targetDate ?? '—',
            r.status.replace('_', ' '),
            String(r.openTasks),
          ],
          link: '/releases',
        })),
      },
      {
        title: 'Open bugs by severity',
        columns: ['Severity', 'Open'],
        rows: ['blocker', 'critical', 'major', 'minor', 'trivial']
          .filter((s) => sev.get(s))
          .map((s) => ({ cells: [s[0]!.toUpperCase() + s.slice(1), String(sev.get(s))] })),
      },
    ],
  };
}

async function department({ rc, auth, period }: Ctx): Promise<Body> {
  const [status, perf, decisions] = await Promise.all([
    projectStatus(rc, period),
    optional(() => teamPerformance(rc, { period: '30d' })),
    decisionsWaiting(rc, auth),
  ]);
  return {
    focus:
      'How your department is delivering: teams, people with slipping work, projects at risk and decisions waiting for you.',
    kpis: [
      ...performanceKpis(perf),
      {
        label: 'Projects at red',
        value: String(status.counts.red),
        hint: `${status.counts.amber} amber of ${status.projects.length}`,
        tone: status.counts.red ? 'bad' : 'good',
        link: '/analytics',
      },
      decisionKpi(decisions),
    ],
    attention: [
      ...decisionItems(decisions),
      ...status.projects
        .filter((p) => p.rag === 'red')
        .slice(0, 4)
        .map((p) => ({
          text: `${p.project.key} ${p.project.name} is red`,
          detail: p.notes.join(' '),
          link: `/projects/${p.project.id}`,
          tone: 'bad' as const,
        })),
      ...peopleWithOverdue(perf),
    ],
    lists: perf?.teams.length
      ? [
          {
            title: 'Teams (last 30 days)',
            columns: ['Team', 'Members', 'Completed', 'Overdue now', 'On time', 'Rework'],
            rows: perf.teams.map((t) => ({
              cells: [
                t.team.name,
                String(t.members),
                String(t.totals.completed),
                String(t.totals.overdue),
                pct(t.totals.onTimeRate),
                String(t.totals.reworked),
              ],
              link: '/teams',
            })),
          },
        ]
      : [],
  };
}

async function projectManager({ rc, auth, period }: Ctx): Promise<Body> {
  const [status, decisions] = await Promise.all([
    projectStatus(rc, period),
    decisionsWaiting(rc, auth),
  ]);
  const mine = status.projects.filter((p) => p.manager?.id === auth.userId);
  const rows = mine.length ? mine : status.projects;
  const today = orgToday();
  const milestones = await Milestone.find({
    projectId: { $in: rows.map((r) => new Types.ObjectId(r.project.id)) },
    status: { $ne: 'completed' },
    dueDate: { $lte: addDaysIso(today, 14) },
  })
    .select('projectId name dueDate')
    .sort({ dueDate: 1 })
    .limit(20)
    .lean();
  const key = new Map(rows.map((r) => [r.project.id, r.project.key]));
  return {
    focus: mine.length
      ? 'The projects you manage: their status, what is late or blocked, milestones coming up and decisions waiting for you.'
      : 'Projects you take part in: their status, what is late or blocked and milestones coming up.',
    kpis: [
      {
        label: mine.length ? 'My projects' : 'Projects',
        value: String(rows.length),
        hint: `${rows.filter((r) => r.rag === 'red').length} red · ${rows.filter((r) => r.rag === 'amber').length} amber`,
        tone: rows.some((r) => r.rag === 'red')
          ? 'bad'
          : rows.some((r) => r.rag === 'amber')
            ? 'warning'
            : 'good',
        link: '/projects',
      },
      {
        label: 'Overdue tasks',
        value: String(rows.reduce((a, r) => a + r.overdue, 0)),
        tone: rows.some((r) => r.overdue) ? 'bad' : 'good',
        link: '/tasks/board',
      },
      {
        label: 'Blocked tasks',
        value: String(rows.reduce((a, r) => a + r.blocked, 0)),
        tone: rows.some((r) => r.blocked) ? 'warning' : 'good',
        link: '/tasks/board',
      },
      {
        label: 'Milestones (14 days)',
        value: String(milestones.length),
        hint: `${milestones.filter((m) => m.dueDate < today).length} already past due`,
        tone: milestones.some((m) => m.dueDate < today) ? 'bad' : undefined,
        link: '/project-timeline',
      },
      decisionKpi(decisions),
    ],
    attention: [
      ...rows
        .filter((r) => r.rag !== 'green')
        .slice(0, 6)
        .map((r) => ({
          text: `${r.project.key} ${r.project.name} is ${r.rag}`,
          detail: r.notes.join(' '),
          link: `/projects/${r.project.id}`,
          tone: r.rag === 'red' ? ('bad' as const) : ('warning' as const),
        })),
      ...milestones
        .filter((m) => m.dueDate < today)
        .slice(0, 4)
        .map((m) => ({
          text: `Milestone “${m.name}” (${key.get(m.projectId.toString()) ?? ''}) was due ${m.dueDate}`,
          link: `/projects/${m.projectId.toString()}`,
          tone: 'bad' as const,
        })),
      ...decisionItems(decisions),
    ],
    lists: [
      {
        title: mine.length ? 'My projects' : 'Projects',
        columns: ['Project', 'Status', 'Health', 'Progress', 'Overdue', 'Forecast finish'],
        rows: rows.map((r) => ({
          cells: [
            `${r.project.key} ${r.project.name}`,
            r.rag.toUpperCase(),
            String(r.healthScore),
            `${r.progress}%`,
            String(r.overdue),
            r.forecastDate ?? '—',
          ],
          link: `/projects/${r.project.id}`,
        })),
      },
    ],
  };
}

async function teamLead({ rc, auth }: Ctx): Promise<Body> {
  const [perf, decisions] = await Promise.all([
    optional(() => teamPerformance(rc, { period: '30d' })),
    decisionsWaiting(rc, auth),
  ]);
  const others = perf
    ? { ...perf, rows: perf.rows.filter((r) => r.user.id !== auth.userId) }
    : null;
  return {
    focus:
      'Your team: who is behind, how reliably work is finished, and timesheets or leave waiting for you.',
    kpis: [...performanceKpis(perf), decisionKpi(decisions)],
    attention: [...decisionItems(decisions), ...peopleWithOverdue(others, 5)],
    lists: others?.rows.length
      ? [
          {
            title: 'Team (last 30 days)',
            columns: ['Person', 'Pending', 'Overdue', 'Completed', 'On time', 'Rework'],
            rows: others.rows.map((r) => ({
              cells: [
                r.user.name,
                String(r.pending),
                String(r.overdue),
                String(r.completed),
                pct(r.onTimeRate),
                String(r.reworked),
              ],
              link: '/teams',
            })),
          },
        ]
      : [],
  };
}

async function quality({ auth, period }: Ctx): Promise<Body> {
  const scope = await resolveScope(auth, period);
  const start = startOfOrgDay(period.from);
  const end = startOfOrgDay(addDaysIso(period.to, 1));
  const [queue, mine, myBugs, rejected] = await Promise.all([
    Task.find({ projectId: { $in: scope.projectIds }, deletedAt: null, status: 'testing' })
      .select('key title assigneeId updatedAt')
      .populate('assigneeId', 'name')
      .sort({ updatedAt: 1 })
      .limit(50)
      .lean(),
    Task.countDocuments({ assigneeId: auth.userObjectId, deletedAt: null, status: 'testing' }),
    Task.countDocuments({
      reporterId: auth.userObjectId,
      deletedAt: null,
      type: 'bug',
      status: { $in: OPEN },
    }),
    TaskTransition.countDocuments({
      actorId: auth.userObjectId,
      from: 'testing',
      to: { $in: ['backlog', 'todo', 'in_progress'] },
      at: { $gte: start, $lt: end },
    }),
  ]);
  // When each task entered testing (its latest move into the status).
  const entered = await TaskTransition.aggregate<{ _id: Types.ObjectId; at: Date }>([
    { $match: { taskId: { $in: queue.map((t) => t._id) }, to: 'testing' } },
    { $group: { _id: '$taskId', at: { $max: '$at' } } },
  ]);
  const since = new Map(entered.map((e) => [e._id.toString(), e.at]));
  const days = (d?: Date) => (d ? Math.floor((Date.now() - d.getTime()) / 86_400_000) : 0);
  const rows = queue
    .map((t) => ({ t, at: since.get(t._id.toString()) ?? t.updatedAt }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const oldest = rows[0] ? days(rows[0].at) : 0;
  return {
    focus:
      'The testing queue in your projects, what is waiting longest, and the defects you raised.',
    kpis: [
      {
        label: 'Waiting for testing',
        value: String(queue.length),
        hint: 'in your projects',
        link: '/tasks/board',
      },
      { label: 'Assigned to me', value: String(mine), link: '/tasks/mine' },
      {
        label: 'Longest wait',
        value: `${oldest} d`,
        tone: oldest > 3 ? 'bad' : oldest > 1 ? 'warning' : 'good',
        link: '/tasks/board',
      },
      { label: 'My open bug reports', value: String(myBugs), link: '/tasks/mine' },
      { label: 'Sent back by me', value: String(rejected), hint: 'in the period' },
    ],
    attention: rows
      .filter((r) => days(r.at) > 2)
      .slice(0, 5)
      .map((r) => ({
        text: `${r.t.key} has waited ${days(r.at)} days for testing`,
        detail: r.t.title,
        link: taskLink(r.t._id.toString()),
        tone: 'warning' as const,
      })),
    lists: [
      {
        title: 'Testing queue (longest waiting first)',
        columns: ['Task', 'Assignee', 'Waiting'],
        rows: rows.slice(0, 10).map((r) => ({
          cells: [
            `${r.t.key} ${r.t.title}`,
            (r.t.assigneeId as unknown as { name?: string } | null)?.name ?? 'Unassigned',
            `${days(r.at)} d`,
          ],
          link: taskLink(r.t._id.toString()),
        })),
      },
    ],
  };
}

async function individual({ auth, period }: Ctx): Promise<Body> {
  const today = orgToday();
  const week = weekStartIso(today);
  const start = startOfOrgDay(period.from);
  const end = startOfOrgDay(addDaysIso(period.to, 1));
  const [open, completed, logged] = await Promise.all([
    Task.find({ assigneeId: auth.userObjectId, deletedAt: null, status: { $in: OPEN } })
      .select('key title dueDate status priority')
      .lean(),
    Task.countDocuments({
      assigneeId: auth.userObjectId,
      deletedAt: null,
      status: 'done',
      completedAt: { $gte: start, $lt: end },
    }),
    Worklog.aggregate<{ m: number }>([
      { $match: { userId: auth.userObjectId, date: { $gte: week, $lte: today } } },
      { $group: { _id: null, m: { $sum: '$minutes' } } },
    ]),
  ]);
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
  const dueSoon = open
    .filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= addDaysIso(today, 7))
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  const hours = Math.round(((logged[0]?.m ?? 0) / 60) * 10) / 10;
  const next = [
    ...overdue,
    ...dueSoon,
    ...open.filter((t) => !t.dueDate || t.dueDate > addDaysIso(today, 7)),
  ];
  return {
    focus: 'Your own work: what is late, what is due this week, and the time you have logged.',
    kpis: [
      { label: 'My open tasks', value: String(open.length), link: '/tasks/mine' },
      {
        label: 'Overdue',
        value: String(overdue.length),
        tone: overdue.length ? 'bad' : 'good',
        link: '/tasks/mine',
      },
      { label: 'Due in 7 days', value: String(dueSoon.length), link: '/tasks/mine' },
      { label: 'Finished', value: String(completed), hint: 'in the period' },
      { label: 'Logged this week', value: `${hours} h`, link: '/work-logs' },
    ],
    attention: [
      ...overdue.slice(0, 5).map((t) => ({
        text: `${t.key} was due ${t.dueDate}`,
        detail: t.title,
        link: taskLink(t._id.toString()),
        tone: 'bad' as const,
      })),
      ...dueSoon.slice(0, 3).map((t) => ({
        text: `${t.key} is due ${t.dueDate}`,
        detail: t.title,
        link: taskLink(t._id.toString()),
      })),
    ],
    lists: [
      {
        title: 'My next tasks',
        columns: ['Task', 'Due', 'Status'],
        rows: next.slice(0, 10).map((t) => ({
          cells: [`${t.key} ${t.title}`, t.dueDate ?? '—', t.status.replace('_', ' ')],
          link: taskLink(t._id.toString()),
        })),
      },
    ],
  };
}

const BUILDERS: Record<DashboardPersona, (c: Ctx) => Promise<Body>> = {
  executive,
  technology,
  department,
  project: projectManager,
  team: teamLead,
  quality,
  individual,
};

/** The Overview "focus" panel: figures and to-dos chosen for the viewer's role. */
export async function roleDashboard(
  rc: RequestContext,
  q: { from?: string; to?: string },
): Promise<RoleDashboardDto> {
  const auth = requireAuth(rc);
  const today = orgToday();
  const period = { from: q.from ?? addDaysIso(today, -29), to: q.to ?? today };
  const persona = personaFor(auth);
  const body = await BUILDERS[persona]({ rc, auth, period });
  return { persona, period, ...body };
}
