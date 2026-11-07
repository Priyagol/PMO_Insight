import { Types, type QueryFilter } from 'mongoose';
import {
  OPEN_RISK_STATUSES,
  createRiskSchema,
  riskQuerySchema,
  riskSeverity,
  updateRiskSchema,
  type CreateRiskInput,
  type PageMeta,
  type RiskDto,
  type RiskHeatmapDto,
  type RiskQuery,
  type UpdateRiskInput,
  type UserRef,
} from '@arihant/shared';
import { eventBus } from '../../core/events';
import { ForbiddenError, NotFoundError, UnprocessableError } from '../../core/errors';
import { nextKey } from '../../core/idgen';
import { toPageMeta } from '../../core/pagination';
import { requireAuth, type AuthContext, type RequestContext } from '../../core/rbac/context';
import { isProjectParticipant, projectScopeFilter } from '../../core/rbac/work-access';
import { recordAudit } from '../audit/audit.service';
import { recordActivity } from '../collab/activity.service';
import { Project, type IProject } from '../projects/project.model';
import { Task } from '../tasks/task.model';
import { toUserRef } from '../users/user.mapper';
import { User } from '../users/user.model';
import { Risk, type IRisk } from './risk.model';

const oid = (id: string | Types.ObjectId) => (typeof id === 'string' ? new Types.ObjectId(id) : id);

/** Projects whose risks the caller may read (risk:read scope; defaults to project read scope). */
async function readableRiskProjects(auth: AuthContext): Promise<QueryFilter<IProject>> {
  const scope = auth.permissions['risk:read'];
  if (!scope) throw new ForbiddenError();
  return projectScopeFilter(auth, scope);
}

/** Raising/editing risks: org, own department, or participants of the project. */
function canWriteRisk(auth: AuthContext, project: IProject, risk?: IRisk): boolean {
  const scope = auth.permissions['risk:write'];
  if (!scope || project.archived) return false;
  if (scope === 'org') return true;
  if (
    scope === 'department' &&
    auth.departmentId &&
    project.departmentId?.toString() === auth.departmentId
  )
    return true;
  if (scope === 'own')
    return Boolean(
      risk && (risk.createdBy.equals(auth.userObjectId) || risk.ownerId?.equals(auth.userObjectId)),
    );
  return isProjectParticipant(project, auth.userId);
}

async function present(auth: AuthContext, risks: IRisk[]): Promise<RiskDto[]> {
  const userIds = new Set<string>();
  risks.forEach((r) => {
    if (r.ownerId) userIds.add(r.ownerId.toString());
    r.history.forEach((h) => h.by && userIds.add(h.by.toString()));
  });
  const [users, projects, tasks] = await Promise.all([
    User.find({ _id: { $in: [...userIds] } })
      .select('name email employeeId designation')
      .lean(),
    Project.find({ _id: { $in: risks.map((r) => r.projectId) } }).lean(),
    Task.find({ _id: { $in: risks.flatMap((r) => r.linkedTaskIds) }, deletedAt: null })
      .select('key title status')
      .lean(),
  ]);
  const u = new Map<string, UserRef>(users.map((x) => [x._id.toString(), toUserRef(x)]));
  const p = new Map(projects.map((x) => [x._id.toString(), x]));
  const t = new Map(tasks.map((x) => [x._id.toString(), x]));
  return risks.map((r) => {
    const project = p.get(r.projectId.toString())!;
    return {
      id: r._id.toString(),
      key: r.key,
      project: { id: project._id.toString(), key: project.key, name: project.name },
      type: r.type,
      title: r.title,
      description: r.description,
      probability: r.probability,
      impact: r.impact,
      score: r.score,
      severity: r.severity,
      status: r.status,
      owner: r.ownerId ? (u.get(r.ownerId.toString()) ?? null) : null,
      mitigation: r.mitigation,
      dueDate: r.dueDate ?? undefined,
      linkedTasks: r.linkedTaskIds
        .map((id) => t.get(id.toString()))
        .filter((x): x is NonNullable<typeof x> => Boolean(x))
        .map((x) => ({ id: x._id.toString(), key: x.key, title: x.title, status: x.status })),
      escalationLevel: r.escalationLevel,
      history: [...r.history].reverse().map((h) => ({
        at: h.at.toISOString(),
        by: h.by ? (u.get(h.by.toString()) ?? null) : null,
        action: h.action,
        note: h.note,
      })),
      canEdit: canWriteRisk(auth, project, r),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

async function buildFilter(
  auth: AuthContext,
  q: ReturnType<typeof riskQuerySchema.parse>,
): Promise<QueryFilter<IRisk>> {
  const projects = await Project.find(await readableRiskProjects(auth))
    .select('_id')
    .lean();
  const filter: QueryFilter<IRisk> = {
    deletedAt: null,
    projectId: { $in: projects.map((x) => x._id) },
  };
  if (q.projectId)
    filter.projectId = projects.some((x) => x._id.toString() === q.projectId)
      ? oid(q.projectId)
      : { $in: [] };
  if (q.type) filter.type = q.type;
  if (q.status === 'active') filter.status = { $in: [...OPEN_RISK_STATUSES] };
  else if (q.status) filter.status = q.status;
  if (q.severity) filter.severity = q.severity;
  if (q.ownerId) filter.ownerId = q.ownerId === 'me' ? auth.userObjectId : oid(q.ownerId);
  if (q.q) filter.title = new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return filter;
}

export async function listRisks(
  rc: RequestContext,
  raw: RiskQuery,
): Promise<{ items: RiskDto[]; meta: PageMeta }> {
  const auth = requireAuth(rc);
  const q = riskQuerySchema.parse(raw);
  const filter = await buildFilter(auth, q);
  const [docs, total] = await Promise.all([
    Risk.find(filter)
      .sort({ status: 1, score: -1, updatedAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Risk.countDocuments(filter),
  ]);
  return { items: await present(auth, docs), meta: toPageMeta(q, total) };
}

/** 5×5 probability × impact counts of active (open/mitigating) items. */
export async function heatmap(rc: RequestContext, raw: RiskQuery): Promise<RiskHeatmapDto> {
  const auth = requireAuth(rc);
  const q = riskQuerySchema.parse({ ...raw, status: 'active' });
  const rows = await Risk.aggregate<{ _id: { p: number; i: number }; n: number }>([
    { $match: await buildFilter(auth, q) },
    { $group: { _id: { p: '$probability', i: '$impact' }, n: { $sum: 1 } } },
  ]);
  const cells = Array.from({ length: 5 }, () => Array<number>(5).fill(0));
  let total = 0;
  for (const r of rows) {
    cells[r._id.p - 1]![r._id.i - 1] = r.n;
    total += r.n;
  }
  return { cells, total };
}

async function loadRisk(auth: AuthContext, id: string) {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Risk');
  const risk = await Risk.findOne({ _id: oid(id), deletedAt: null }).lean();
  if (!risk) throw new NotFoundError('Risk');
  const project = await Project.findOne({
    $and: [{ _id: risk.projectId }, await readableRiskProjects(auth)],
  }).lean();
  if (!project) throw new NotFoundError('Risk');
  return { risk, project };
}

export async function getRisk(rc: RequestContext, id: string): Promise<RiskDto> {
  const auth = requireAuth(rc);
  const { risk } = await loadRisk(auth, id);
  return (await present(auth, [risk]))[0]!;
}

async function assertRefs(project: IProject, ownerId?: string | null, taskIds?: string[]) {
  if (ownerId && !isProjectParticipant(project, ownerId))
    throw new UnprocessableError('The owner must be on the project team');
  if (taskIds?.length) {
    const n = await Task.countDocuments({
      _id: { $in: taskIds.map(oid) },
      projectId: project._id,
      deletedAt: null,
    });
    if (n !== new Set(taskIds).size)
      throw new UnprocessableError('Linked tasks must belong to the same project');
  }
}

export async function createRisk(rc: RequestContext, raw: CreateRiskInput): Promise<RiskDto> {
  const auth = requireAuth(rc);
  const input = createRiskSchema.parse(raw);
  const project = await Project.findOne({
    $and: [{ _id: oid(input.projectId) }, await readableRiskProjects(auth)],
  }).lean();
  if (!project) throw new NotFoundError('Project');
  if (!canWriteRisk(auth, project))
    throw new ForbiddenError('You cannot raise risks in this project');
  await assertRefs(project, input.ownerId, input.linkedTaskIds);
  const score = input.probability * input.impact;
  const doc = await Risk.create({
    key: await nextKey(`${project.key}-R`).then((k) =>
      k.replace(`${project.key}-R-`, `${project.key}-R`),
    ),
    projectId: project._id,
    type: input.type,
    title: input.title,
    description: input.description,
    probability: input.probability,
    impact: input.impact,
    score,
    severity: riskSeverity(score),
    ownerId: input.ownerId ? oid(input.ownerId) : null,
    mitigation: input.mitigation,
    dueDate: input.dueDate ?? null,
    linkedTaskIds: [...new Set(input.linkedTaskIds)].map(oid),
    createdBy: auth.userObjectId,
    history: [{ at: new Date(), by: auth.userObjectId, action: 'raised' }],
  });
  await recordActivity(rc, {
    projectId: project._id,
    entityType: 'project',
    entityId: project._id,
    entityLabel: `${project.key} ${project.name}`,
    verb: 'risk_raised',
    summary: `raised ${doc.type} ${doc.key}: ${doc.title} (${doc.severity})`,
  });
  if (doc.severity === 'critical') {
    eventBus.publish(
      'risk.critical',
      { riskId: doc._id.toString(), projectId: project._id.toString() },
      { actorId: auth.userId },
    );
  }
  return (await present(auth, [doc.toObject()]))[0]!;
}

export async function updateRisk(
  rc: RequestContext,
  id: string,
  raw: UpdateRiskInput,
): Promise<RiskDto> {
  const auth = requireAuth(rc);
  const input = updateRiskSchema.parse(raw);
  const { risk, project } = await loadRisk(auth, id);
  if (!canWriteRisk(auth, project, risk)) throw new ForbiddenError();
  await assertRefs(project, input.ownerId, input.linkedTaskIds);

  const set: Record<string, unknown> = {};
  for (const k of ['type', 'title', 'description', 'mitigation', 'dueDate'] as const)
    if (input[k] !== undefined) set[k] = input[k];
  if (input.ownerId !== undefined) set.ownerId = input.ownerId ? oid(input.ownerId) : null;
  if (input.linkedTaskIds !== undefined)
    set.linkedTaskIds = [...new Set(input.linkedTaskIds)].map(oid);
  const probability = input.probability ?? risk.probability;
  const impact = input.impact ?? risk.impact;
  if (input.probability !== undefined || input.impact !== undefined) {
    set.probability = probability;
    set.impact = impact;
    set.score = probability * impact;
    set.severity = riskSeverity(probability * impact);
  }
  const actions: string[] = [];
  if (input.status && input.status !== risk.status) {
    set.status = input.status;
    set.resolvedAt = input.status === 'resolved' || input.status === 'closed' ? new Date() : null;
    actions.push(`status ${risk.status} → ${input.status}`);
  }
  if (set.score !== undefined && set.score !== risk.score)
    actions.push(`score ${risk.score} → ${set.score as number}`);
  const updated = await Risk.findByIdAndUpdate(
    risk._id,
    {
      $set: set,
      $push: {
        history: {
          at: new Date(),
          by: auth.userObjectId,
          action: actions.join('; ') || 'updated',
          note: input.note,
        },
      },
    },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (updated!.severity === 'critical' && risk.severity !== 'critical') {
    eventBus.publish(
      'risk.critical',
      { riskId: id, projectId: project._id.toString() },
      { actorId: auth.userId },
    );
  }
  return (await present(auth, [updated!]))[0]!;
}

/** Raises the escalation level (max 3) and records why; audited because it alerts management. */
export async function escalateRisk(rc: RequestContext, id: string, note: string): Promise<RiskDto> {
  const auth = requireAuth(rc);
  const { risk, project } = await loadRisk(auth, id);
  if (!canWriteRisk(auth, project, risk)) throw new ForbiddenError();
  if (!OPEN_RISK_STATUSES.includes(risk.status))
    throw new UnprocessableError('Only open risks can be escalated');
  if (risk.escalationLevel >= 3)
    throw new UnprocessableError('This item is already at the highest escalation level');
  const updated = await Risk.findByIdAndUpdate(
    risk._id,
    {
      $inc: { escalationLevel: 1 },
      $push: {
        history: {
          at: new Date(),
          by: auth.userObjectId,
          action: `escalated to level ${risk.escalationLevel + 1}`,
          note,
        },
      },
    },
    { returnDocument: 'after' },
  ).lean();
  await recordAudit(rc, {
    action: 'risk.escalated',
    entityType: 'risk',
    entityId: risk._id,
    summary: `Escalated ${risk.key} (${project.key}) to level ${risk.escalationLevel + 1}: ${note}`,
  });
  eventBus.publish(
    'risk.escalated',
    { riskId: id, level: risk.escalationLevel + 1, projectId: project._id.toString() },
    { actorId: auth.userId },
  );
  return (await present(auth, [updated!]))[0]!;
}

export async function deleteRisk(rc: RequestContext, id: string): Promise<void> {
  const auth = requireAuth(rc);
  const { risk, project } = await loadRisk(auth, id);
  if (!canWriteRisk(auth, project, risk)) throw new ForbiddenError();
  await Risk.updateOne({ _id: risk._id }, { $set: { deletedAt: new Date() } });
  await recordAudit(rc, {
    action: 'risk.deleted',
    entityType: 'risk',
    entityId: risk._id,
    summary: `Deleted ${risk.key}: ${risk.title}`,
  });
}
