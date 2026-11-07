import { Types } from 'mongoose';
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_STATUSES,
  aiRiskScanOutput,
  askDataSchema,
  askPlanSchema,
  projectAiSchema,
  type AiResult,
  type AiRiskScanOutput,
  type AskPlan,
  type AskResultDto,
} from '@arihant/shared';
import { ForbiddenError } from '../../core/errors';
import { escapeRegex } from '../../core/pagination';
import { requireAuth, type AuthContext, type RequestContext } from '../../core/rbac/context';
import { can } from '../../core/rbac/policy';
import { readableProjectIds, taskReadFilter } from '../../core/rbac/work-access';
import { addDaysIso, orgToday } from '../../core/time';
import { forecastProject } from '../insights/forecast.service';
import { hoursBreakdown, overview, projectHealthList } from '../insights/analytics.service';
import { Project, type IProject } from '../projects/project.model';
import { loadReadableProject } from '../projects/project.service';
import { Risk } from '../risks/risk.model';
import { Task } from '../tasks/task.model';
import { User } from '../users/user.model';
import { BASE_SYSTEM, DISCLAIMER, run, tag } from './ai.service';

const LIST_LIMIT = 50;
const clampScale = (n: number) => Math.min(5, Math.max(1, Math.round(n)));

async function visibleProjects(auth: AuthContext): Promise<IProject[]> {
  const ids = await readableProjectIds(auth);
  return Project.find({ archived: false, ...(ids === 'all' ? {} : { _id: { $in: ids } }) })
    .sort({ key: 1 })
    .limit(300)
    .lean();
}

/* ============================ Plan → query ============================ */

function describePlan(plan: AskPlan, me: string): string {
  const parts: string[] = [
    {
      tasks: 'Tasks',
      hours: 'Hours logged',
      projects: 'Projects',
      risks: 'Open risks and issues',
      workload: 'Team workload',
      unsupported: 'Not supported',
    }[plan.intent],
  ];
  if (plan.projectKeys.length) parts.push(`project ${plan.projectKeys.join(', ')}`);
  if (plan.statuses.length)
    parts.push(`status ${plan.statuses.map((s) => STATUS_LABELS[s]).join('/')}`);
  if (plan.priorities.length)
    parts.push(`priority ${plan.priorities.map((p) => PRIORITY_LABELS[p]).join('/')}`);
  if (plan.assignee === 'me') parts.push(`assigned to ${me}`);
  if (plan.assignee === 'unassigned') parts.push('unassigned');
  if (plan.assignee === 'named' && plan.assigneeName)
    parts.push(`assigned to "${plan.assigneeName}"`);
  if (plan.overdueOnly) parts.push('overdue only');
  if (plan.dueWithinDays != null) parts.push(`due within ${plan.dueWithinDays} day(s)`);
  if (plan.from || plan.to)
    parts.push(
      `${plan.intent === 'hours' ? 'logged' : 'due'} ${plan.from ?? '…'} to ${plan.to ?? '…'}`,
    );
  if (plan.severities.length) parts.push(`severity ${plan.severities.join('/')}`);
  if (plan.healthBand !== 'any') parts.push(`health ${plan.healthBand.replace('_', ' ')}`);
  if (plan.groupBy !== 'none') parts.push(`grouped by ${plan.groupBy}`);
  return parts.join(' · ');
}

const isDate = (s: string | null): s is string => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));

async function runTasks(auth: AuthContext, plan: AskPlan, projects: IProject[], notes: string[]) {
  const today = orgToday();
  const and: Record<string, unknown>[] = [
    await taskReadFilter(auth),
    { projectId: { $in: projects.map((p) => p._id) } },
  ];
  if (plan.statuses.length) and.push({ status: { $in: plan.statuses } });
  if (plan.priorities.length) and.push({ priority: { $in: plan.priorities } });
  if (plan.assignee === 'me') and.push({ assigneeId: auth.userObjectId });
  if (plan.assignee === 'unassigned') and.push({ assigneeId: null });
  if (plan.assignee === 'named') {
    // Names resolve only among people on projects the caller can see.
    const memberIds = [
      ...new Set(
        projects.flatMap((p) => [p.managerId, ...p.members.map((m) => m.userId)]).map(String),
      ),
    ];
    const matches = plan.assigneeName
      ? await User.find({
          _id: { $in: memberIds },
          name: new RegExp(escapeRegex(plan.assigneeName.trim()), 'i'),
        })
          .select('name')
          .limit(10)
          .lean()
      : [];
    if (matches.length !== 1) {
      notes.push(
        matches.length
          ? `"${plan.assigneeName}" matches several people (${matches.map((m) => m.name).join(', ')}). Ask again with the full name.`
          : `Nobody called "${plan.assigneeName}" is on the projects you can see.`,
      );
      return { columns: [], rows: [], chart: null };
    }
    and.push({ assigneeId: matches[0]!._id });
  }
  const open = { status: { $nin: ['done', 'cancelled'] } };
  if (plan.overdueOnly) and.push({ dueDate: { $ne: null, $lt: today } }, open);
  if (plan.dueWithinDays != null)
    and.push(
      {
        dueDate: {
          $gte: today,
          $lte: addDaysIso(today, Math.max(0, Math.round(plan.dueWithinDays))),
        },
      },
      open,
    );
  if (isDate(plan.from) || isDate(plan.to))
    and.push({
      dueDate: {
        $ne: null,
        ...(isDate(plan.from) ? { $gte: plan.from } : {}),
        ...(isDate(plan.to) ? { $lte: plan.to } : {}),
      },
    });
  const filter = { $and: and };

  if (
    plan.groupBy === 'none' ||
    !['status', 'priority', 'assignee', 'project'].includes(plan.groupBy)
  ) {
    const [docs, total] = await Promise.all([
      Task.find(filter).sort({ dueDate: 1, priorityOrder: 1 }).limit(LIST_LIMIT).lean(),
      Task.countDocuments(filter),
    ]);
    const users = await User.find({
      _id: { $in: docs.map((d) => d.assigneeId).filter((x): x is Types.ObjectId => Boolean(x)) },
    })
      .select('name')
      .lean();
    const names = new Map(users.map((u) => [u._id.toString(), u.name]));
    if (total > LIST_LIMIT) notes.push(`Showing the first ${LIST_LIMIT} of ${total} tasks.`);
    return {
      columns: ['Task', 'Title', 'Status', 'Priority', 'Assignee', 'Due'],
      rows: docs.map((t) => [
        t.key,
        t.title,
        STATUS_LABELS[t.status],
        PRIORITY_LABELS[t.priority],
        t.assigneeId ? (names.get(t.assigneeId.toString()) ?? '—') : 'Unassigned',
        t.dueDate ?? '—',
      ]),
      chart: null,
      total,
    };
  }
  const field =
    plan.groupBy === 'assignee'
      ? '$assigneeId'
      : plan.groupBy === 'project'
        ? '$projectId'
        : `$${plan.groupBy}`;
  const groups = await Task.aggregate<{ _id: unknown; n: number }>([
    { $match: filter },
    { $group: { _id: field, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);
  let label = (k: unknown) => String(k ?? 'None');
  if (plan.groupBy === 'status')
    label = (k) => STATUS_LABELS[k as keyof typeof STATUS_LABELS] ?? String(k);
  if (plan.groupBy === 'priority')
    label = (k) => PRIORITY_LABELS[k as keyof typeof PRIORITY_LABELS] ?? String(k);
  if (plan.groupBy === 'project') {
    const m = new Map(projects.map((p) => [p._id.toString(), `${p.key} · ${p.name}`]));
    label = (k) => m.get(String(k)) ?? 'Unknown';
  }
  if (plan.groupBy === 'assignee') {
    const ids = groups
      .map((g) => g._id)
      .filter((x): x is Types.ObjectId => x instanceof Types.ObjectId);
    const users = await User.find({ _id: { $in: ids } })
      .select('name')
      .lean();
    const m = new Map(users.map((u) => [u._id.toString(), u.name]));
    label = (k) => (k ? (m.get(String(k)) ?? 'Unknown') : 'Unassigned');
  }
  if (plan.groupBy === 'status')
    groups.sort(
      (a, b) => TASK_STATUSES.indexOf(a._id as never) - TASK_STATUSES.indexOf(b._id as never),
    );
  const total = groups.reduce((s, g) => s + g.n, 0);
  return {
    columns: [plan.groupBy[0]!.toUpperCase() + plan.groupBy.slice(1), 'Tasks'],
    rows: groups.map((g) => [label(g._id), g.n]),
    chart: { labelColumn: 0, valueColumn: 1 },
    total,
  };
}

async function execute(rc: RequestContext, auth: AuthContext, plan: AskPlan, visible: IProject[]) {
  const notes: string[] = [];
  const byKey = new Map(visible.map((p) => [p.key.toUpperCase(), p]));
  const wanted = plan.projectKeys.map((k) => k.toUpperCase());
  const unknown = wanted.filter((k) => !byKey.has(k));
  if (unknown.length) notes.push(`Not found among your projects: ${unknown.join(', ')}.`);
  const projects = wanted.length
    ? wanted.map((k) => byKey.get(k)).filter((p): p is IProject => Boolean(p))
    : visible;
  if (wanted.length && !projects.length)
    return { columns: [], rows: [], chart: null, total: 0, notes };

  switch (plan.intent) {
    case 'tasks': {
      if (!can(auth, 'task:read')) throw new ForbiddenError();
      return { ...(await runTasks(auth, plan, projects, notes)), notes };
    }
    case 'hours': {
      if (!can(auth, 'analytics:view'))
        throw new ForbiddenError('Hours analysis needs analytics access');
      const groupBy =
        (['project', 'user', 'category', 'week'] as const).find((g) => g === plan.groupBy) ??
        'project';
      if (projects.length > 1 && wanted.length)
        notes.push(
          'Hours are shown for all projects in your scope; filter by one project for a narrower view.',
        );
      const rows = await hoursBreakdown(rc, {
        groupBy,
        ...(isDate(plan.from) ? { from: plan.from } : {}),
        ...(isDate(plan.to) ? { to: plan.to } : {}),
        ...(wanted.length === 1 ? { projectId: projects[0]!._id.toString() } : {}),
      });
      if (!isDate(plan.from) && !isDate(plan.to))
        notes.push('No period given: showing the last 30 days.');
      return {
        columns: [groupBy[0]!.toUpperCase() + groupBy.slice(1), 'Hours', 'Entries'],
        rows: rows.map((r) => [r.label, r.hours, r.entries]),
        chart: { labelColumn: 0, valueColumn: 1 },
        total: Math.round(rows.reduce((s, r) => s + r.hours, 0) * 10) / 10,
        notes,
      };
    }
    case 'projects': {
      if (!can(auth, 'analytics:view'))
        throw new ForbiddenError('Project health needs analytics access');
      let list = await projectHealthList(rc, {});
      if (wanted.length) list = list.filter((h) => wanted.includes(h.project.key.toUpperCase()));
      if (plan.healthBand !== 'any') list = list.filter((h) => h.band === plan.healthBand);
      return {
        columns: ['Project', 'Name', 'Status', 'Health', 'Band', 'Progress %', 'End date'],
        rows: list.map((h) => [
          h.project.key,
          h.project.name,
          STATUS_LABELS[h.project.status],
          h.score,
          h.band.replace('_', ' '),
          h.progress,
          h.project.endDate ?? '—',
        ]),
        chart: null,
        total: list.length,
        notes,
      };
    }
    case 'risks': {
      if (!can(auth, 'risk:read')) throw new ForbiddenError();
      const risks = await Risk.find({
        projectId: { $in: projects.map((p) => p._id) },
        deletedAt: null,
        status: { $in: ['open', 'mitigating'] },
        ...(plan.severities.length ? { severity: { $in: plan.severities } } : {}),
      })
        .sort({ score: -1 })
        .limit(200)
        .lean();
      const keyOf = new Map(projects.map((p) => [p._id.toString(), p.key]));
      if (plan.groupBy === 'severity' || plan.groupBy === 'project') {
        const counts = new Map<string, number>();
        for (const r of risks) {
          const k =
            plan.groupBy === 'severity' ? r.severity : (keyOf.get(r.projectId.toString()) ?? '?');
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        return {
          columns: [plan.groupBy === 'severity' ? 'Severity' : 'Project', 'Open items'],
          rows: [...counts],
          chart: { labelColumn: 0, valueColumn: 1 },
          total: risks.length,
          notes,
        };
      }
      return {
        columns: ['Key', 'Title', 'Type', 'Severity', 'Score', 'Status'],
        rows: risks
          .slice(0, LIST_LIMIT)
          .map((r) => [r.key, r.title, r.type, r.severity, r.score, r.status]),
        chart: null,
        total: risks.length,
        notes,
      };
    }
    case 'workload': {
      if (!can(auth, 'analytics:view')) throw new ForbiddenError('Workload needs analytics access');
      const o = await overview(rc, {});
      if (!o.people) {
        notes.push('Team workload is not part of your access.');
        return { columns: [], rows: [], chart: null, total: 0, notes };
      }
      return {
        columns: ['Person', 'Utilisation %', 'Open load (h)', 'Capacity (h)'],
        rows: o.workload.map((w) => [
          w.user.name,
          Math.round(w.utilization * 100),
          w.loadHours,
          w.capacityHours,
        ]),
        chart: { labelColumn: 0, valueColumn: 1 },
        total: o.workload.length,
        notes,
      };
    }
    default:
      return { columns: [], rows: [], chart: null, total: 0, notes };
  }
}

/**
 * Ask Your Data: the model turns the question into a whitelisted plan (it never sees
 * records); the server runs the plan through the same permission-scoped queries as the
 * rest of the application.
 */
export async function askData(rc: RequestContext, raw: unknown): Promise<AskResultDto> {
  const auth = requireAuth(rc);
  const { question } = askDataSchema.parse(raw);
  const visible = await visibleProjects(auth);
  const res = await run(rc, 'ask_data', 'question', {
    effort: 'low',
    schema: askPlanSchema,
    system: `${BASE_SYSTEM}
You translate a question about project work into a query plan. You never answer from your own knowledge; the system runs the plan.
Intents: "tasks" (counting or listing tasks), "hours" (time logged), "projects" (project health/status), "risks" (open risks and issues), "workload" (team utilisation), or "unsupported" with a short reason (for anything else, including requests to change data).
Rules: use projectKeys only from the provided list (match names to keys); "me/my/mine" means assignee "me"; a person's name means assignee "named" with assigneeName; dates as YYYY-MM-DD relative to today; for tasks, from/to filter the due date; for hours, from/to are the logging period; leave filters empty or "any" when not asked for; groupBy "none" to list items.
In "explanation", restate the question as the plan answers it, in one short sentence.`,
    prompt: [
      tag('today', orgToday()),
      tag('projects', visible.map((p) => `${p.key}: ${p.name}`).join('\n') || 'none'),
      tag('question', question),
    ].join('\n\n'),
  });
  const plan = res.data;
  const me = (await User.findById(auth.userObjectId).select('name').lean())?.name ?? 'you';
  if (plan.intent === 'unsupported') {
    return {
      question,
      interpretation: 'Not supported',
      answer: plan.unsupportedReason ?? 'This question cannot be answered from the available data.',
      columns: [],
      rows: [],
      chart: null,
      notes: ['Ask about tasks, hours logged, project health, risks or team workload.'],
      model: res.model,
      plan,
    };
  }
  const out = await execute(rc, auth, plan, visible);
  const unit = {
    tasks: 'task(s)',
    hours: 'hours',
    projects: 'project(s)',
    risks: 'open item(s)',
    workload: 'people',
    unsupported: '',
  }[plan.intent];
  const answer =
    out.rows.length === 0
      ? 'No matching records.'
      : plan.intent === 'hours'
        ? `${out.total} hours logged in total.`
        : `${out.total} ${unit}${out.chart && plan.intent !== 'workload' ? ` in ${out.rows.length} group(s)` : ''}.`;
  return {
    question,
    interpretation: `${describePlan(plan, me)}. ${plan.explanation}`.trim(),
    answer,
    columns: out.columns,
    rows: out.rows,
    chart: out.chart,
    notes: out.notes,
    model: res.model,
    plan,
  };
}

/* ============================ Risk scan ============================ */

/** Proposes risks the register does not have yet, from schedule, blockers and the forecast. */
export async function riskScan(
  rc: RequestContext,
  raw: unknown,
): Promise<AiResult<AiRiskScanOutput>> {
  const auth = requireAuth(rc);
  const { projectId } = projectAiSchema.parse(raw);
  if (!can(auth, 'risk:read')) throw new ForbiddenError();
  const project = await loadReadableProject(auth, projectId);
  const today = orgToday();
  const [tasks, risks] = await Promise.all([
    Task.find({ projectId: project._id, deletedAt: null })
      .select(
        'key title status estimatedHours completedAt dueDate assigneeId parentId priority blockedSince',
      )
      .lean(),
    Risk.find({ projectId: project._id, deletedAt: null, status: { $in: ['open', 'mitigating'] } })
      .select('key title')
      .lean(),
  ]);
  const f = forecastProject(project, tasks, today);
  const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled' && !t.parentId);
  const res = await run(rc, 'risk_scan', project.key, {
    schema: aiRiskScanOutput,
    system: `${BASE_SYSTEM}\nYou identify delivery risks and issues for a project register.`,
    prompt: [
      tag(
        'project',
        `${project.key} – ${project.name}; status ${project.status}; end ${project.endDate ?? 'not set'}; today ${today}`,
      ),
      tag('forecast', f.explanation),
      tag(
        'overdue',
        open
          .filter((t) => t.dueDate && t.dueDate < today)
          .slice(0, 20)
          .map((t) => `${t.key} ${t.title} (due ${t.dueDate}, ${t.priority})`)
          .join('\n') || 'none',
      ),
      tag(
        'blocked',
        open
          .filter((t) => t.status === 'blocked')
          .slice(0, 20)
          .map((t) => `${t.key} ${t.title}`)
          .join('\n') || 'none',
      ),
      tag(
        'unassigned_due_soon',
        f.tasksAtRisk.map((t) => `${t.key} ${t.title}: ${t.reason}`).join('\n') || 'none',
      ),
      tag('existing_register', risks.map((r) => `${r.key} ${r.title}`).join('\n') || 'empty'),
      'Propose up to 5 risks or issues that the existing register does not already cover, each grounded in the data above. Give probability and impact from 1 (very low) to 5 (very high), one sentence of rationale citing task keys, and a practical mitigation. If nothing new is evident, return an empty list.',
    ].join('\n\n'),
  });
  res.data.risks = res.data.risks
    .slice(0, 5)
    .map((r) => ({ ...r, probability: clampScale(r.probability), impact: clampScale(r.impact) }));
  return { feature: 'risk_scan', model: res.model, proposal: res.data, disclaimer: DISCLAIMER };
}
