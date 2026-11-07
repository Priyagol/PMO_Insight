import { Types } from 'mongoose';
import {
  AUTOMATION_TRIGGERS,
  automationRunQuerySchema,
  createAutomationSchema,
  updateAutomationSchema,
  type AutomationRuleDto,
  type AutomationRunDto,
  type AutomationRunQuery,
  type AutomationTestResultDto,
  type CreateAutomationInput,
  type PageMeta,
  type UpdateAutomationInput,
} from '@arihant/shared';
import { ForbiddenError, NotFoundError, UnprocessableError } from '../../core/errors';
import { toPageMeta, toPageWindow } from '../../core/pagination';
import { requireAuth, type AuthContext, type RequestContext } from '../../core/rbac/context';
import { can } from '../../core/rbac/policy';
import { canUpdateProject, readableProjectIds } from '../../core/rbac/work-access';
import { recordAudit } from '../audit/audit.service';
import { Project } from '../projects/project.model';
import { loadReadableProject } from '../projects/project.service';
import { Task } from '../tasks/task.model';
import { User } from '../users/user.model';
import { describeAction, evaluate, taskContext } from './automation.engine';
import { AutomationRule, AutomationRun, type IAutomationRule } from './automation.model';

const oid = (id: string) => new Types.ObjectId(id);

/** Project rules: automation rights plus the right to edit that project. Organisation rules: org scope. */
async function assertCanManage(
  auth: AuthContext,
  projectId: Types.ObjectId | string | null,
): Promise<void> {
  if (!can(auth, 'automation:manage')) throw new ForbiddenError();
  if (!projectId) {
    if (!can(auth, 'automation:manage', 'org'))
      throw new ForbiddenError('Organisation-wide rules need organisation-level automation rights');
    return;
  }
  const project = await loadReadableProject(auth, projectId.toString());
  if (!canUpdateProject(auth, project))
    throw new ForbiddenError('You can only automate projects you manage');
}

async function canEdit(auth: AuthContext, r: IAutomationRule): Promise<boolean> {
  try {
    await assertCanManage(auth, r.projectId);
    return true;
  } catch {
    return false;
  }
}

async function present(auth: AuthContext, rules: IAutomationRule[]): Promise<AutomationRuleDto[]> {
  const [projects, owners] = await Promise.all([
    Project.find({
      _id: { $in: rules.map((r) => r.projectId).filter((p): p is Types.ObjectId => Boolean(p)) },
    })
      .select('key name')
      .lean(),
    User.find({ _id: { $in: rules.map((r) => r.ownerId) } })
      .select('name')
      .lean(),
  ]);
  const p = new Map(
    projects.map((x) => [x._id.toString(), { id: x._id.toString(), key: x.key, name: x.name }]),
  );
  const o = new Map(owners.map((x) => [x._id.toString(), { id: x._id.toString(), name: x.name }]));
  return Promise.all(
    rules.map(async (r) => ({
      id: r._id.toString(),
      name: r.name,
      description: r.description ?? undefined,
      project: r.projectId ? (p.get(r.projectId.toString()) ?? null) : null,
      trigger: r.trigger,
      conditions: r.conditions,
      actions: r.actions,
      enabled: r.enabled,
      schedule: r.schedule ?? null,
      owner: o.get(r.ownerId.toString()) ?? null,
      runCount: r.runCount,
      lastRunAt: r.lastRunAt?.toISOString(),
      lastStatus: r.lastStatus ?? undefined,
      canEdit: await canEdit(auth, r),
      updatedAt: r.updatedAt.toISOString(),
    })),
  );
}

/** Rules for projects the caller can see, plus organisation-wide rules. */
async function visibleFilter(auth: AuthContext): Promise<Record<string, unknown>> {
  const projects = await readableProjectIds(auth);
  return projects === 'all'
    ? { deletedAt: null }
    : { deletedAt: null, $or: [{ projectId: null }, { projectId: { $in: projects } }] };
}

async function load(auth: AuthContext, id: string): Promise<IAutomationRule> {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Automation');
  const r = await AutomationRule.findOne({
    $and: [{ _id: oid(id) }, await visibleFilter(auth)],
  }).lean();
  if (!r) throw new NotFoundError('Automation');
  return r;
}

export async function listRules(
  rc: RequestContext,
  projectId?: string,
): Promise<AutomationRuleDto[]> {
  const auth = requireAuth(rc);
  const filter: Record<string, unknown> = await visibleFilter(auth);
  if (projectId) filter.projectId = oid(projectId);
  const rules = await AutomationRule.find(filter).sort({ updatedAt: -1 }).limit(200).lean();
  return present(auth, rules);
}

export async function createRule(
  rc: RequestContext,
  raw: CreateAutomationInput,
): Promise<AutomationRuleDto> {
  const auth = requireAuth(rc);
  const input = createAutomationSchema.parse(raw);
  await assertCanManage(auth, input.projectId);
  await assertUsersExist(input.actions);
  const doc = await AutomationRule.create({
    ...input,
    schedule: input.trigger === 'schedule' ? input.schedule : null,
    projectId: input.projectId ? oid(input.projectId) : null,
    ownerId: auth.userObjectId,
  });
  await recordAudit(rc, {
    action: 'automation.created',
    entityType: 'automation',
    entityId: doc._id,
    summary: `Created automation "${doc.name}" (${doc.trigger}, ${doc.actions.length} action(s))`,
  });
  return (await present(auth, [doc.toObject()]))[0]!;
}

async function assertUsersExist(
  actions: CreateAutomationInput['actions'] | undefined,
): Promise<void> {
  const ids = (actions ?? []).flatMap((a) =>
    a.type === 'assign_user' ? [a.userId] : a.type === 'notify' ? (a.userIds ?? []) : [],
  );
  if (
    ids.length &&
    (await User.countDocuments({ _id: { $in: [...new Set(ids)].map(oid) }, status: 'active' })) !==
      new Set(ids).size
  )
    throw new UnprocessableError('Every person named in an action must be an active employee');
}

export async function updateRule(
  rc: RequestContext,
  id: string,
  raw: UpdateAutomationInput,
): Promise<AutomationRuleDto> {
  const auth = requireAuth(rc);
  const input = updateAutomationSchema.parse(raw);
  const rule = await load(auth, id);
  await assertCanManage(auth, rule.projectId);
  // Trigger, conditions and actions must still fit together after a partial update.
  createAutomationSchema.parse({
    name: input.name ?? rule.name,
    projectId: rule.projectId?.toString() ?? null,
    trigger: input.trigger ?? rule.trigger,
    conditions: input.conditions ?? rule.conditions,
    actions: input.actions ?? rule.actions,
    schedule: input.schedule !== undefined ? input.schedule : (rule.schedule ?? null),
  });
  const trigger = input.trigger ?? rule.trigger;
  const schedule = trigger === 'schedule' ? (input.schedule ?? rule.schedule ?? null) : null;
  await assertUsersExist(input.actions);
  // Whoever last changes a rule becomes the person it acts as.
  const updated = await AutomationRule.findByIdAndUpdate(
    rule._id,
    { $set: { ...input, schedule, ownerId: auth.userObjectId } },
    { returnDocument: 'after' },
  ).lean();
  await recordAudit(rc, {
    action: 'automation.updated',
    entityType: 'automation',
    entityId: rule._id,
    summary: `Updated automation "${updated!.name}" (${Object.keys(input).join(', ')})`,
  });
  return (await present(auth, [updated!]))[0]!;
}

export async function deleteRule(rc: RequestContext, id: string): Promise<void> {
  const auth = requireAuth(rc);
  const rule = await load(auth, id);
  await assertCanManage(auth, rule.projectId);
  await AutomationRule.updateOne(
    { _id: rule._id },
    { $set: { deletedAt: new Date(), enabled: false } },
  );
  await recordAudit(rc, {
    action: 'automation.deleted',
    entityType: 'automation',
    entityId: rule._id,
    summary: `Deleted automation "${rule.name}"`,
  });
}

export async function listRuns(
  rc: RequestContext,
  raw: AutomationRunQuery,
): Promise<{ items: AutomationRunDto[]; meta: PageMeta }> {
  const auth = requireAuth(rc);
  const q = automationRunQuerySchema.parse(raw);
  const rules = await AutomationRule.find(await visibleFilter(auth))
    .select('name')
    .lean();
  const names = new Map(rules.map((r) => [r._id.toString(), r.name]));
  const filter: Record<string, unknown> = {
    ruleId: { $in: rules.map((r) => r._id) },
    status: { $ne: 'running' },
  };
  if (q.ruleId) filter.ruleId = oid(q.ruleId);
  if (q.ruleId && !names.has(q.ruleId)) throw new NotFoundError('Automation');
  if (q.status) filter.status = q.status;
  const win = toPageWindow(q, ['createdAt'], { createdAt: -1, _id: -1 });
  const [docs, total] = await Promise.all([
    AutomationRun.find(filter).sort(win.sort).skip(win.skip).limit(win.limit).lean(),
    AutomationRun.countDocuments(filter),
  ]);
  return {
    items: docs.map((d) => ({
      id: d._id.toString(),
      ruleId: d.ruleId.toString(),
      ruleName: names.get(d.ruleId.toString()) ?? 'Deleted rule',
      trigger: d.trigger,
      status: d.status as AutomationRunDto['status'],
      subject: d.subject ?? undefined,
      actions: d.actions,
      error: d.error ?? undefined,
      durationMs: d.durationMs,
      createdAt: d.createdAt.toISOString(),
    })),
    meta: toPageMeta(q, total),
  };
}

/** Dry run against a task: shows each condition's result and what would happen. Changes nothing. */
export async function testRule(
  rc: RequestContext,
  id: string,
  taskId: string,
): Promise<AutomationTestResultDto> {
  const auth = requireAuth(rc);
  const rule = await load(auth, id);
  if (!rule.trigger.startsWith('task.') && rule.trigger !== 'schedule')
    throw new UnprocessableError('Only task rules can be tested against a task');
  const task = await Task.findOne({ _id: oid(taskId), deletedAt: null }).lean();
  if (!task) throw new NotFoundError('Task');
  await loadReadableProject(auth, task.projectId.toString());
  if (rule.projectId && !rule.projectId.equals(task.projectId))
    throw new UnprocessableError('That task is in a different project');
  const { matched, checks } = evaluate(
    rule.conditions,
    taskContext(task, rule.trigger === 'task.status_changed' ? task.status : null),
  );
  return { matched, checks, wouldRun: matched ? rule.actions.map(describeAction) : [] };
}

export const TRIGGERS = AUTOMATION_TRIGGERS;
