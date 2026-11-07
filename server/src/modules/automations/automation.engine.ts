import { Types } from 'mongoose';
import type {
  AutomationAction,
  AutomationTrigger,
  Condition,
  ConditionGroup,
} from '@arihant/shared';
import { logger } from '../../config/logger';
import { automationScope, eventBus, type DomainEvent } from '../../core/events';
import { loadAuthContext, type RequestContext } from '../../core/rbac/context';
import { can } from '../../core/rbac/policy';
import { addDaysIso, daysBetweenIso, dayOfWeekIso, orgTimeOf, orgToday } from '../../core/time';
import { suggest, assignSuggested } from '../assignment/assignment.service';
import { addComment } from '../collab/comment.service';
import { notify } from '../notifications/notification.service';
import { Project, type IProject } from '../projects/project.model';
import { Risk } from '../risks/risk.model';
import { Task, type ITask } from '../tasks/task.model';
import { createTask, updateTask } from '../tasks/task.service';
import { User } from '../users/user.model';
import { AutomationRule, AutomationRun, type IAutomationRule } from './automation.model';

/** Events caused by automations are followed at most this deep (A triggers B triggers C). */
export const MAX_DEPTH = 3;
/** Runs per rule per hour before further events are throttled. */
export const MAX_RUNS_PER_HOUR = 100;

/* ============================ Context & conditions (pure) ============================ */

export type FieldValue = string | number | boolean | string[] | null;
export type EventContext = Record<string, FieldValue>;

export function taskContext(
  task: ITask,
  previousStatus: string | null = null,
  today: string = orgToday(),
): EventContext {
  const open = task.status !== 'done' && task.status !== 'cancelled';
  const daysUntilDue = task.dueDate ? daysBetweenIso(today, task.dueDate) : null;
  return {
    'task.overdue': Boolean(open && daysUntilDue !== null && daysUntilDue < 0),
    'task.daysUntilDue': daysUntilDue,
    'task.priority': task.priority,
    'task.status': task.status,
    'task.previousStatus': previousStatus,
    'task.assigned': Boolean(task.assigneeId),
    'task.tags': task.tags,
    'task.estimatedHours': task.estimatedHours ?? null,
    'task.title': task.title,
    'task.isSubtask': Boolean(task.parentId),
  };
}

const norm = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : v);

export function checkCondition(
  c: Condition,
  ctx: EventContext,
): { actual: FieldValue; passed: boolean } {
  const actual = ctx[c.field] ?? null;
  const v = c.value ?? null;
  const list = Array.isArray(v) ? v.map(norm) : [norm(v)];
  let passed: boolean;
  switch (c.op) {
    case 'eq':
      passed = Array.isArray(actual)
        ? actual.map(norm).includes(norm(v))
        : norm(actual) === norm(v);
      break;
    case 'neq':
      passed = Array.isArray(actual)
        ? !actual.map(norm).includes(norm(v))
        : norm(actual) !== norm(v);
      break;
    case 'in':
      passed = Array.isArray(actual)
        ? actual.some((a) => list.includes(norm(a)))
        : list.includes(norm(actual));
      break;
    case 'nin':
      passed = Array.isArray(actual)
        ? !actual.some((a) => list.includes(norm(a)))
        : !list.includes(norm(actual));
      break;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = typeof actual === 'number' ? actual : NaN;
      const b = typeof v === 'number' ? v : Number(v);
      passed =
        Number.isFinite(a) &&
        Number.isFinite(b) &&
        ({ gt: a > b, gte: a >= b, lt: a < b, lte: a <= b }[c.op] as boolean);
      break;
    }
    case 'contains':
      passed = Array.isArray(actual)
        ? actual.map(norm).includes(norm(v))
        : typeof actual === 'string' &&
          typeof v === 'string' &&
          actual.toLowerCase().includes(v.toLowerCase());
      break;
    case 'is_empty':
      passed = actual === null || actual === '' || (Array.isArray(actual) && actual.length === 0);
      break;
    case 'not_empty':
      passed = !(
        actual === null ||
        actual === '' ||
        (Array.isArray(actual) && actual.length === 0)
      );
      break;
  }
  return { actual, passed };
}

/** A rule with no conditions always matches. */
export function evaluate(group: ConditionGroup, ctx: EventContext) {
  const checks = group.conditions.map((c) => ({
    field: c.field,
    op: c.op,
    expected: c.value ?? null,
    ...checkCondition(c, ctx),
  }));
  const matched =
    !checks.length ||
    (group.match === 'any' ? checks.some((c) => c.passed) : checks.every((c) => c.passed));
  return { matched, checks };
}

/* ============================ Event → subject ============================ */

interface Subject {
  projectId: Types.ObjectId;
  task?: ITask;
  label: string;
  ctx: EventContext;
}

async function subjectFor(
  trigger: AutomationTrigger,
  payload: Record<string, unknown>,
): Promise<Subject | null> {
  if (trigger.startsWith('task.')) {
    const task = await Task.findOne({ _id: payload.taskId as string, deletedAt: null }).lean();
    if (!task) return null;
    const previous = trigger === 'task.status_changed' ? ((payload.from as string) ?? null) : null;
    return {
      projectId: task.projectId,
      task,
      label: `${task.key} ${task.title}`,
      ctx: taskContext(task, previous),
    };
  }
  if (trigger === 'risk.critical') {
    const risk = await Risk.findById(payload.riskId as string).lean();
    if (!risk) return null;
    return {
      projectId: risk.projectId,
      label: `${risk.key} ${risk.title}`,
      ctx: { 'risk.type': risk.type },
    };
  }
  const project = await Project.findById(payload.projectId as string).lean();
  if (!project) return null;
  return {
    projectId: project._id,
    label: `${project.key} ${project.name}`,
    ctx: {
      'project.status': project.status,
      'project.previousStatus': (payload.from as string) ?? null,
    },
  };
}

/* ============================ Actions ============================ */

export function describeAction(a: AutomationAction): string {
  switch (a.type) {
    case 'notify':
      return `Notify ${a.to.join(', ').replace('_', ' ')}: "${a.message}"`;
    case 'set_priority':
      return `Set priority to ${a.priority}`;
    case 'add_tag':
      return `Add tag "${a.tag}"`;
    case 'add_comment':
      return 'Add a comment';
    case 'assign_user':
      return 'Assign to a named person';
    case 'smart_assign':
      return 'Smart-assign to the best-scoring eligible person';
    case 'create_task':
      return `Create task "${a.title}"`;
  }
}

async function runAction(
  rc: RequestContext,
  rule: IAutomationRule,
  a: AutomationAction,
  s: Subject,
  project: IProject,
): Promise<string> {
  const task = s.task;
  const tag = `[Automation: ${rule.name}]`;
  switch (a.type) {
    case 'notify': {
      const ids: (Types.ObjectId | null | undefined)[] = [];
      for (const t of a.to) {
        if (t === 'assignee') ids.push(task?.assigneeId);
        if (t === 'reporter') ids.push(task?.reporterId);
        if (t === 'watchers') ids.push(...(task?.watcherIds ?? []));
        if (t === 'project_manager') ids.push(project.managerId);
        if (t === 'users') ids.push(...(a.userIds ?? []).map((u) => new Types.ObjectId(u)));
      }
      const sent = await notify(ids, {
        type: 'automation',
        title: `${s.label.split(' ')[0]}: ${a.message}`,
        body: `${rule.name} · ${s.label}`,
        link: task
          ? `/tasks/mine?task=${task._id.toString()}`
          : `/projects/${project._id.toString()}`,
      });
      return `Notified ${sent} person(s)`;
    }
    case 'set_priority':
      await updateTask(rc, task!._id.toString(), { priority: a.priority });
      return `Priority set to ${a.priority}`;
    case 'add_tag': {
      const fresh = await Task.findById(task!._id).select('tags').lean();
      if (fresh?.tags.includes(a.tag)) return `Tag "${a.tag}" already present`;
      await updateTask(rc, task!._id.toString(), { tags: [...(fresh?.tags ?? []), a.tag] });
      return `Tag "${a.tag}" added`;
    }
    case 'add_comment':
      await addComment(rc, task!._id.toString(), { body: `${tag} ${a.text}` });
      return 'Comment added';
    case 'assign_user':
      await updateTask(rc, task!._id.toString(), { assigneeId: a.userId });
      return 'Assigned';
    case 'smart_assign': {
      const best = (await suggest(rc, task!._id.toString())).candidates.find((c) => c.eligible);
      if (!best) throw new Error('No eligible person to assign');
      await assignSuggested(rc, task!._id.toString(), best.user.id);
      return `Smart-assigned to ${best.user.name} (score ${Math.round(best.score)})`;
    }
    case 'create_task': {
      const assigneeId =
        a.assignTo === 'same_assignee'
          ? (task?.assigneeId?.toString() ?? null)
          : a.assignTo === 'project_manager'
            ? project.managerId.toString()
            : null;
      const created = await createTask(rc, {
        projectId: project._id.toString(),
        title: a.title,
        description: `${tag} Created after: ${s.label}`,
        priority: a.priority,
        dueDate: a.dueInDays != null ? addDaysIso(orgToday(), a.dueInDays) : null,
        assigneeId,
      });
      return `Created ${created.key}`;
    }
  }
}

/* ============================ Runner ============================ */

async function ownerContext(rule: IAutomationRule): Promise<RequestContext | null> {
  const owner = await User.findById(rule.ownerId).select('tokenVersion status').lean();
  if (!owner || owner.status !== 'active') return null;
  try {
    return {
      auth: await loadAuthContext(owner._id.toString(), owner.tokenVersion),
      requestId: `automation:${rule._id.toString()}`,
    };
  } catch {
    return null;
  }
}

/** Handles one domain event for every matching enabled rule. Never throws. */
type ActionResult = { type: AutomationAction['type']; ok: boolean; detail: string };

/**
 * Runs one rule for one subject, exactly once per eventId (unique run record), with the
 * depth guard, hourly throttle and owner checks. Returns the run status, or null when the
 * rule had already handled this event.
 */
async function executeRule(
  rule: IAutomationRule,
  subject: Subject,
  project: IProject,
  trigger: AutomationTrigger,
  eventId: string,
  depth: number,
): Promise<string | null> {
  const started = Date.now();
  let run;
  try {
    run = await AutomationRun.create({
      ruleId: rule._id,
      eventId,
      trigger,
      projectId: subject.projectId,
      status: 'running',
      subject: subject.label,
    });
  } catch {
    return null; // already handled (same event delivered twice)
  }
  const finish = async (status: string, actions: ActionResult[], error?: string) => {
    await AutomationRun.updateOne(
      { _id: run._id },
      { $set: { status, actions, error: error ?? null, durationMs: Date.now() - started } },
    );
    await AutomationRule.updateOne(
      { _id: rule._id },
      { $inc: { runCount: 1 }, $set: { lastRunAt: new Date(), lastStatus: status } },
    );
    return status;
  };

  if (depth >= MAX_DEPTH)
    return finish(
      'loop_blocked',
      [],
      `Stopped: this event was caused by ${depth} chained automations`,
    );
  const recent = await AutomationRun.countDocuments({
    ruleId: rule._id,
    createdAt: { $gte: new Date(Date.now() - 3600_000) },
  });
  if (recent > MAX_RUNS_PER_HOUR)
    return finish('throttled', [], `More than ${MAX_RUNS_PER_HOUR} runs in the last hour`);
  const rc = await ownerContext(rule);
  if (!rc?.auth) return finish('failed', [], 'The rule owner is no longer active');
  // An organisation-wide rule only acts while its owner may still manage automations org-wide.
  if (!rule.projectId && !can(rc.auth, 'automation:manage', 'org'))
    return finish('failed', [], 'The rule owner no longer has organisation-wide automation rights');

  const results: ActionResult[] = [];
  await automationScope.run({ depth: depth + 1 }, async () => {
    for (const a of rule.actions) {
      try {
        results.push({
          type: a.type,
          ok: true,
          detail: await runAction(rc, rule, a, subject, project),
        });
      } catch (err) {
        results.push({
          type: a.type,
          ok: false,
          detail: err instanceof Error ? err.message : 'Failed',
        });
      }
    }
  });
  const ok = results.filter((r) => r.ok).length;
  if (ok < results.length)
    logger.warn({ ruleId: rule._id.toString(), results }, 'Automation actions failed');
  return finish(ok === results.length ? 'success' : ok ? 'partial' : 'failed', results);
}

/** Handles one domain event for every matching enabled rule. Never throws. */
export async function handleEvent(trigger: AutomationTrigger, event: DomainEvent): Promise<void> {
  const rules = await AutomationRule.find({ trigger, enabled: true, deletedAt: null }).lean();
  if (!rules.length) return;
  const subject = await subjectFor(trigger, (event.payload ?? {}) as Record<string, unknown>);
  if (!subject) return;
  const project = await Project.findById(subject.projectId).lean();
  if (!project || project.archived) return;
  for (const rule of rules) {
    if (rule.projectId && !rule.projectId.equals(subject.projectId)) continue;
    if (!evaluate(rule.conditions, subject.ctx).matched) continue;
    await executeRule(rule, subject, project, trigger, event.id, event.depth ?? 0);
  }
}

/** At most this many tasks are acted on per scheduled run of one rule. */
export const MAX_SCHEDULED_TASKS = 200;

/** The schedule slot (organisation time) a moment falls in, e.g. "2026-11-09T09". */
export function scheduleSlot(now: Date): {
  slot: string;
  day: string;
  hour: number;
  weekday: number;
} {
  const day = orgToday(0, now);
  const hour = Number(orgTimeOf(now).slice(0, 2));
  return {
    slot: `${day}T${String(hour).padStart(2, '0')}`,
    day,
    hour,
    weekday: ((dayOfWeekIso(day) + 6) % 7) + 1,
  };
}

/**
 * Hourly (worker): runs scheduled rules whose time has come. Each rule checks every open
 * task in its scope against its conditions; a rule runs once per slot (claimed atomically).
 */
export async function runScheduledRules(
  now = new Date(),
): Promise<{ rules: number; runs: number }> {
  const { slot, hour, weekday } = scheduleSlot(now);
  const due = await AutomationRule.find({
    trigger: 'schedule',
    enabled: true,
    deletedAt: null,
    'schedule.hour': hour,
    $or: [
      { 'schedule.frequency': 'daily' },
      { 'schedule.frequency': 'weekly', 'schedule.weekday': weekday },
    ],
  }).lean();
  let rules = 0;
  let runs = 0;
  const today = orgToday(0, now);
  for (const rule of due) {
    const claimed = await AutomationRule.updateOne(
      { _id: rule._id, lastScheduledSlot: { $ne: slot } },
      { $set: { lastScheduledSlot: slot } },
    );
    if (!claimed.modifiedCount) continue;
    rules += 1;
    const projectFilter = rule.projectId ? { _id: rule.projectId } : {};
    const projects = await Project.find({ ...projectFilter, archived: false }).lean();
    const byId = new Map(projects.map((p) => [p._id.toString(), p]));
    const tasks = await Task.find({
      projectId: { $in: projects.map((p) => p._id) },
      deletedAt: null,
      status: { $nin: ['done', 'cancelled'] },
    })
      .sort({ dueDate: 1 })
      .limit(5000)
      .lean();
    let acted = 0;
    for (const task of tasks) {
      if (acted >= MAX_SCHEDULED_TASKS) break;
      const ctx = taskContext(task, null, today);
      if (!evaluate(rule.conditions, ctx).matched) continue;
      acted += 1;
      const status = await executeRule(
        rule,
        { projectId: task.projectId, task, label: `${task.key} ${task.title}`, ctx },
        byId.get(task.projectId.toString())!,
        'schedule',
        `${slot}:${task._id.toString()}`,
        0,
      );
      if (status) runs += 1;
    }
  }
  return { rules, runs };
}

export function registerAutomationSubscribers(): () => void {
  const triggers: AutomationTrigger[] = [
    'task.created',
    'task.status_changed',
    'task.assigned',
    'task.overdue',
    'risk.critical',
    'project.status_changed',
  ];
  const subs = triggers.map((t) => eventBus.subscribe(t, (e) => handleEvent(t, e)));
  return () => subs.forEach((off) => off());
}
