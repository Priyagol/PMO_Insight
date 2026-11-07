import { Types } from 'mongoose';
import {
  ENVIRONMENT_LABELS,
  createReleaseSchema,
  deploySchema,
  releaseQuerySchema,
  rollbackSchema,
  updateReleaseSchema,
  type CreateReleaseInput,
  type DeployInput,
  type PageMeta,
  type ReleaseDto,
  type ReleaseQuery,
  type UpdateReleaseInput,
  type UserRef,
} from '@arihant/shared';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from '../../core/errors';
import { escapeRegex, toPageMeta, toPageWindow } from '../../core/pagination';
import { requireAuth, type AuthContext, type RequestContext } from '../../core/rbac/context';
import { can } from '../../core/rbac/policy';
import {
  canUpdateProject,
  isProjectParticipant,
  readableProjectIds,
} from '../../core/rbac/work-access';
import { Approval } from '../approvals/approval.model';
import { registerApprovalEffect, requestApproval } from '../approvals/approval.service';
import { recordAudit } from '../audit/audit.service';
import { recordActivity } from '../collab/activity.service';
import { notify } from '../notifications/notification.service';
import { Project, type IProject } from '../projects/project.model';
import { loadReadableProject } from '../projects/project.service';
import { Task } from '../tasks/task.model';
import { toUserRef } from '../users/user.mapper';
import { User } from '../users/user.model';
import { Release, type IRelease } from './delivery.models';
import { isExternal } from './document.service';

const oid = (id: string) => new Types.ObjectId(id);

const canEdit = (auth: AuthContext, project: IProject) =>
  !project.archived &&
  can(auth, 'release:write') &&
  !isExternal(auth) &&
  (canUpdateProject(auth, project) || isProjectParticipant(project, auth.userId));

async function visibleFilter(auth: AuthContext): Promise<Record<string, unknown>> {
  if (!can(auth, 'release:read')) throw new ForbiddenError();
  const ids = await readableProjectIds(auth);
  return ids === 'all' ? {} : { projectId: { $in: ids } };
}

/** Latest production-deployment approval per release. */
async function prodApprovals(ids: Types.ObjectId[]) {
  const rows = await Approval.find({ entityType: 'release_deploy', entityId: { $in: ids } })
    .sort({ createdAt: -1 })
    .select('key status entityId')
    .lean();
  const m = new Map<string, { id: string; key: string; status: string }>();
  for (const a of rows)
    if (!m.has(a.entityId!.toString()))
      m.set(a.entityId!.toString(), { id: a._id.toString(), key: a.key, status: a.status });
  return m;
}

async function present(auth: AuthContext, docs: IRelease[]): Promise<ReleaseDto[]> {
  const userIds = new Set<string>();
  docs.forEach((r) => {
    r.environments.forEach((e) => e.by && userIds.add(e.by.toString()));
    r.history.forEach((h) => h.by && userIds.add(h.by.toString()));
  });
  const [users, projects, tasks, approvals] = await Promise.all([
    User.find({ _id: { $in: [...userIds] } })
      .select('name email employeeId designation')
      .lean(),
    Project.find({ _id: { $in: docs.map((d) => d.projectId) } }).lean(),
    Task.find({ _id: { $in: docs.flatMap((d) => d.taskIds) }, deletedAt: null })
      .select('key title status')
      .lean(),
    prodApprovals(docs.map((d) => d._id)),
  ]);
  const u = new Map<string, UserRef>(users.map((x) => [x._id.toString(), toUserRef(x)]));
  const p = new Map(projects.map((x) => [x._id.toString(), x as IProject]));
  const t = new Map(tasks.map((x) => [x._id.toString(), x]));
  return docs.map((r) => {
    const project = p.get(r.projectId.toString())!;
    const linked = r.taskIds
      .map((id) => t.get(id.toString()))
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
    const approval = approvals.get(r._id.toString()) ?? null;
    const editable = canEdit(auth, project) && r.status !== 'cancelled';
    return {
      id: r._id.toString(),
      project: { id: project._id.toString(), key: project.key, name: project.name },
      version: r.version,
      name: r.name ?? undefined,
      notes: r.notes ?? undefined,
      status: r.status,
      targetDate: r.targetDate ?? undefined,
      releasedAt: r.releasedAt?.toISOString(),
      tasks: linked.map((x) => ({
        id: x._id.toString(),
        key: x.key,
        title: x.title,
        status: x.status,
      })),
      openTasks: linked.filter((x) => x.status !== 'done' && x.status !== 'cancelled').length,
      environments: r.environments.map((e) => ({
        environment: e.environment,
        status: e.status,
        build: e.build ?? undefined,
        at: e.at?.toISOString(),
        by: e.by ? (u.get(e.by.toString()) ?? null) : null,
      })),
      history: [...r.history].reverse().map((h) => ({
        at: h.at.toISOString(),
        by: h.by ? (u.get(h.by.toString()) ?? null) : null,
        action: h.action,
        environment: h.environment ?? undefined,
        notes: h.notes ?? undefined,
      })),
      approval,
      can: { edit: editable, deployProd: editable && approval?.status === 'approved' },
      createdAt: r.createdAt.toISOString(),
    };
  });
}

async function load(
  auth: AuthContext,
  id: string,
): Promise<{ release: IRelease; project: IProject }> {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Release');
  const release = await Release.findOne({
    $and: [{ _id: oid(id) }, await visibleFilter(auth)],
  }).lean();
  if (!release) throw new NotFoundError('Release');
  const project = await Project.findById(release.projectId).lean();
  if (!project) throw new NotFoundError('Release');
  return { release, project };
}

async function loadEditable(auth: AuthContext, id: string) {
  const r = await load(auth, id);
  if (!canEdit(auth, r.project))
    throw new ForbiddenError('You cannot manage releases for this project');
  if (r.release.status === 'cancelled') throw new UnprocessableError('This release was cancelled');
  return r;
}

async function assertTasksInProject(projectId: Types.ObjectId, ids: string[]) {
  const unique = [...new Set(ids)];
  if (
    unique.length &&
    (await Task.countDocuments({ _id: { $in: unique.map(oid) }, projectId, deletedAt: null })) !==
      unique.length
  )
    throw new UnprocessableError('Every linked task must belong to the project');
  return unique.map(oid);
}

export async function listReleases(
  rc: RequestContext,
  raw: ReleaseQuery,
): Promise<{ items: ReleaseDto[]; meta: PageMeta }> {
  const auth = requireAuth(rc);
  const q = releaseQuerySchema.parse(raw);
  const and: Record<string, unknown>[] = [await visibleFilter(auth)];
  if (q.projectId) and.push({ projectId: oid(q.projectId) });
  if (q.status) and.push({ status: q.status });
  if (q.q)
    and.push({
      $or: [
        { version: new RegExp(escapeRegex(q.q), 'i') },
        { name: new RegExp(escapeRegex(q.q), 'i') },
      ],
    });
  const filter = { $and: and };
  const win = toPageWindow(q, ['createdAt', 'targetDate'], { createdAt: -1, _id: -1 });
  const [docs, total] = await Promise.all([
    Release.find(filter).sort(win.sort).skip(win.skip).limit(win.limit).lean(),
    Release.countDocuments(filter),
  ]);
  return { items: await present(auth, docs), meta: toPageMeta(q, total) };
}

export async function getRelease(rc: RequestContext, id: string): Promise<ReleaseDto> {
  const auth = requireAuth(rc);
  return (await present(auth, [(await load(auth, id)).release]))[0]!;
}

export async function createRelease(
  rc: RequestContext,
  raw: CreateReleaseInput,
): Promise<ReleaseDto> {
  const auth = requireAuth(rc);
  const input = createReleaseSchema.parse(raw);
  const project = await loadReadableProject(auth, input.projectId);
  if (!canEdit(auth, project))
    throw new ForbiddenError('You cannot manage releases for this project');
  if (await Release.exists({ projectId: project._id, version: input.version }))
    throw new ConflictError(`Version ${input.version} already exists in ${project.key}`);
  const taskIds = await assertTasksInProject(project._id, input.taskIds);
  const doc = await Release.create({
    projectId: project._id,
    version: input.version,
    name: input.name ?? null,
    notes: input.notes ?? null,
    targetDate: input.targetDate ?? null,
    taskIds,
    createdBy: auth.userObjectId,
    history: [{ at: new Date(), by: auth.userObjectId, action: 'created' }],
  });
  await recordActivity(rc, {
    projectId: project._id,
    entityType: 'project',
    entityId: project._id,
    entityLabel: `${project.key} ${project.name}`,
    verb: 'release_created',
    summary: `planned release ${doc.version}`,
  });
  return getRelease(rc, doc._id.toString());
}

export async function updateRelease(
  rc: RequestContext,
  id: string,
  raw: UpdateReleaseInput,
): Promise<ReleaseDto> {
  const auth = requireAuth(rc);
  const input = updateReleaseSchema.parse(raw);
  const { release, project } = await loadEditable(auth, id);
  const set: Record<string, unknown> = { ...input };
  if (input.taskIds) set.taskIds = await assertTasksInProject(project._id, input.taskIds);
  if (input.status && ['released', 'rolled_back'].includes(release.status))
    throw new UnprocessableError(
      'A deployed release changes status through deployments and rollbacks',
    );
  await Release.updateOne(
    { _id: release._id },
    {
      $set: set,
      ...(input.status
        ? {
            $push: {
              history: {
                at: new Date(),
                by: auth.userObjectId,
                action: `status set to ${input.status}`,
              },
            },
          }
        : {}),
    },
  );
  return getRelease(rc, id);
}

/** Records a deployment. Production needs an approved go-live request for this release. */
export async function deploy(
  rc: RequestContext,
  id: string,
  raw: DeployInput,
): Promise<ReleaseDto> {
  const auth = requireAuth(rc);
  const input = deploySchema.parse(raw);
  const { release, project } = await loadEditable(auth, id);
  if (input.environment === 'prod') {
    const approval = (await prodApprovals([release._id])).get(release._id.toString());
    if (approval?.status !== 'approved')
      throw new UnprocessableError(
        'Deploying to production needs an approved go-live request for this release',
      );
  }
  const now = new Date();
  const ok = input.outcome === 'deployed';
  const status =
    input.environment === 'prod' && ok
      ? 'released'
      : release.status === 'planned'
        ? 'in_progress'
        : release.status;
  await Release.updateOne(
    { _id: release._id, 'environments.environment': input.environment },
    {
      $set: {
        'environments.$.status': ok ? 'deployed' : 'failed',
        'environments.$.build': input.build ?? null,
        'environments.$.at': now,
        'environments.$.by': auth.userObjectId,
        status,
        ...(input.environment === 'prod' && ok ? { releasedAt: now } : {}),
      },
      $push: {
        history: {
          at: now,
          by: auth.userObjectId,
          action: ok
            ? `deployed to ${ENVIRONMENT_LABELS[input.environment]}`
            : `deployment to ${ENVIRONMENT_LABELS[input.environment]} failed`,
          environment: input.environment,
          notes:
            [input.build ? `build ${input.build}` : '', input.notes ?? '']
              .filter(Boolean)
              .join(' · ') || null,
        },
      },
    },
  );
  await recordAudit(rc, {
    action: ok ? 'release.deployed' : 'release.deploy_failed',
    entityType: 'release',
    entityId: release._id,
    summary: `${project.key} ${release.version}: ${ok ? 'deployed to' : 'failed deployment to'} ${ENVIRONMENT_LABELS[input.environment]}${input.build ? ` (build ${input.build})` : ''}`,
  });
  await recordActivity(rc, {
    projectId: project._id,
    entityType: 'project',
    entityId: project._id,
    entityLabel: `${project.key} ${project.name}`,
    verb: 'release_deployed',
    summary: `${ok ? 'deployed' : 'recorded a failed deployment of'} ${release.version} ${ok ? 'to' : 'to'} ${ENVIRONMENT_LABELS[input.environment]}`,
  });
  if (input.environment === 'prod' && ok)
    await notify([project.managerId, ...project.members.map((m) => m.userId)], {
      type: 'approval_decided',
      title: `${project.key} ${release.version} is live in production`,
      link: `/releases?open=${release._id.toString()}`,
      actorId: auth.userId,
    });
  return getRelease(rc, id);
}

export async function rollback(rc: RequestContext, id: string, raw: unknown): Promise<ReleaseDto> {
  const auth = requireAuth(rc);
  const input = rollbackSchema.parse(raw);
  const { release, project } = await loadEditable(auth, id);
  const env = release.environments.find((e) => e.environment === input.environment);
  if (env?.status !== 'deployed')
    throw new UnprocessableError(`Nothing is deployed to ${ENVIRONMENT_LABELS[input.environment]}`);
  await Release.updateOne(
    { _id: release._id, 'environments.environment': input.environment },
    {
      $set: {
        'environments.$.status': 'rolled_back',
        'environments.$.at': new Date(),
        'environments.$.by': auth.userObjectId,
        ...(input.environment === 'prod' ? { status: 'rolled_back' } : {}),
      },
      $push: {
        history: {
          at: new Date(),
          by: auth.userObjectId,
          action: `rolled back ${ENVIRONMENT_LABELS[input.environment]}`,
          environment: input.environment,
          notes: input.reason,
        },
      },
    },
  );
  await recordAudit(rc, {
    action: 'release.rolled_back',
    entityType: 'release',
    entityId: release._id,
    summary: `${project.key} ${release.version}: rolled back ${ENVIRONMENT_LABELS[input.environment]}: ${input.reason}`,
  });
  return getRelease(rc, id);
}

export async function requestGoLive(rc: RequestContext, id: string): Promise<ReleaseDto> {
  const auth = requireAuth(rc);
  const { release, project } = await loadEditable(auth, id);
  if (release.status === 'released') throw new UnprocessableError('This release is already live');
  const latest = (await prodApprovals([release._id])).get(release._id.toString());
  if (latest?.status === 'approved')
    throw new ConflictError('Production deployment is already approved');
  const open = await Task.countDocuments({
    _id: { $in: release.taskIds },
    deletedAt: null,
    status: { $nin: ['done', 'cancelled'] },
  });
  const uat = release.environments.find((e) => e.environment === 'uat');
  await requestApproval(rc, project, {
    entityType: 'release_deploy',
    entityId: release._id,
    title: `Go-live: ${project.key} ${release.version}${release.name ? ` (${release.name})` : ''}`,
    description: [
      `Linked tasks still open: ${open} of ${release.taskIds.length}.`,
      `UAT: ${uat?.status === 'deployed' ? `deployed${uat.build ? ` (build ${uat.build})` : ''}` : 'not deployed'}.`,
      release.targetDate ? `Target date: ${release.targetDate}.` : '',
    ]
      .filter(Boolean)
      .join(' '),
  });
  await Release.updateOne(
    { _id: release._id },
    {
      $push: {
        history: { at: new Date(), by: auth.userObjectId, action: 'requested production approval' },
      },
    },
  );
  return getRelease(rc, id);
}

registerApprovalEffect('release_deploy', async (_rc, a) => {
  await Release.updateOne(
    { _id: a.entityId },
    {
      $push: {
        history: { at: new Date(), by: null, action: `production deployment approved (${a.key})` },
      },
    },
  );
});
