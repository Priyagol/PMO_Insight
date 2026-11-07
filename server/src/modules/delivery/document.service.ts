import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import {
  createDocumentSchema,
  documentQuerySchema,
  updateDocumentSchema,
  type DocumentDto,
  type DocumentQuery,
  type PageMeta,
  type UpdateDocumentInput,
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
import { storage } from '../../services/storage';
import { Approval } from '../approvals/approval.model';
import {
  registerApprovalClosed,
  registerApprovalEffect,
  requestApproval,
} from '../approvals/approval.service';
import { recordAudit } from '../audit/audit.service';
import { recordActivity } from '../collab/activity.service';
import {
  detectAllowedType,
  sanitizeFileName,
  type UploadedFile,
} from '../collab/attachment.service';
import { Project, type IProject } from '../projects/project.model';
import { loadReadableProject } from '../projects/project.service';
import { toUserRef } from '../users/user.mapper';
import { User } from '../users/user.model';
import { DocumentModel, type IDocument } from './delivery.models';

const oid = (id: string) => new Types.ObjectId(id);

/** People whose only role is the external stakeholder role. */
export const isExternal = (auth: AuthContext) =>
  auth.roleKeys.length > 0 && auth.roleKeys.every((k) => k === 'external_stakeholder');

/** Internal readers see every document of a readable project; externals only shared, published ones. */
async function visibleFilter(auth: AuthContext): Promise<Record<string, unknown>> {
  if (!can(auth, 'document:read')) throw new ForbiddenError();
  const ids = await readableProjectIds(auth);
  return {
    deletedAt: null,
    ...(ids === 'all' ? {} : { projectId: { $in: ids } }),
    ...(isExternal(auth) ? { sharedWithStakeholders: true, publishedVersion: { $ne: null } } : {}),
  };
}

const canEdit = (auth: AuthContext, project: IProject) =>
  !project.archived &&
  can(auth, 'document:write') &&
  !isExternal(auth) &&
  (isProjectParticipant(project, auth.userId) || canUpdateProject(auth, project));

async function present(auth: AuthContext, docs: IDocument[]): Promise<DocumentDto[]> {
  const userIds = new Set<string>();
  docs.forEach((d) => {
    userIds.add(d.createdBy.toString());
    d.versions.forEach((v) => userIds.add(v.uploadedBy.toString()));
  });
  const [users, projects, approvals] = await Promise.all([
    User.find({ _id: { $in: [...userIds] } })
      .select('name email employeeId designation')
      .lean(),
    Project.find({ _id: { $in: docs.map((d) => d.projectId) } }).lean(),
    Approval.find({ entityType: 'document_publish', entityId: { $in: docs.map((d) => d._id) } })
      .sort({ createdAt: -1 })
      .select('key status entityId')
      .lean(),
  ]);
  const u = new Map<string, UserRef>(users.map((x) => [x._id.toString(), toUserRef(x)]));
  const p = new Map(projects.map((x) => [x._id.toString(), x as IProject]));
  const latest = new Map<string, { id: string; key: string; status: string }>();
  for (const a of approvals)
    if (!latest.has(a.entityId!.toString()))
      latest.set(a.entityId!.toString(), { id: a._id.toString(), key: a.key, status: a.status });
  const external = isExternal(auth);
  return docs.map((d) => {
    const project = p.get(d.projectId.toString())!;
    const editable = canEdit(auth, project);
    // Externals see only the published version.
    const versions = external
      ? d.versions.filter((v) => v.version === d.publishedVersion)
      : d.versions;
    return {
      id: d._id.toString(),
      project: { id: project._id.toString(), key: project.key, name: project.name },
      title: d.title,
      category: d.category,
      description: d.description ?? undefined,
      tags: d.tags,
      status: d.status,
      sharedWithStakeholders: d.sharedWithStakeholders,
      currentVersion: external ? (d.publishedVersion ?? 0) : d.currentVersion,
      versions: [...versions]
        .sort((a, b) => b.version - a.version)
        .map((v) => ({
          version: v.version,
          fileName: v.fileName,
          mime: v.mime,
          size: v.size,
          note: v.note ?? undefined,
          uploadedBy: u.get(v.uploadedBy.toString()) ?? null,
          uploadedAt: v.uploadedAt.toISOString(),
        })),
      publishedVersion: d.publishedVersion,
      publishedAt: d.publishedAt?.toISOString(),
      approval: external ? null : (latest.get(d._id.toString()) ?? null),
      createdBy: external ? null : (u.get(d.createdBy.toString()) ?? null),
      can: {
        edit: editable && d.status !== 'pending_approval',
        publish:
          editable && d.status !== 'pending_approval' && d.publishedVersion !== d.currentVersion,
      },
      updatedAt: d.updatedAt.toISOString(),
    };
  });
}

async function load(auth: AuthContext, id: string): Promise<{ doc: IDocument; project: IProject }> {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Document');
  const doc = await DocumentModel.findOne({
    $and: [{ _id: oid(id) }, await visibleFilter(auth)],
  }).lean();
  if (!doc) throw new NotFoundError('Document');
  const project = await Project.findById(doc.projectId).lean();
  if (!project) throw new NotFoundError('Document');
  return { doc, project };
}

export async function listDocuments(
  rc: RequestContext,
  raw: DocumentQuery,
): Promise<{ items: DocumentDto[]; meta: PageMeta }> {
  const auth = requireAuth(rc);
  const q = documentQuerySchema.parse(raw);
  const and: Record<string, unknown>[] = [await visibleFilter(auth)];
  if (q.projectId) and.push({ projectId: oid(q.projectId) });
  if (q.category) and.push({ category: q.category });
  if (q.status) and.push({ status: q.status });
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    and.push({ $or: [{ title: rx }, { description: rx }, { tags: rx }] });
  }
  const filter = { $and: and };
  const win = toPageWindow(q, ['title', 'updatedAt'], { updatedAt: -1, _id: -1 });
  const [docs, total] = await Promise.all([
    DocumentModel.find(filter).sort(win.sort).skip(win.skip).limit(win.limit).lean(),
    DocumentModel.countDocuments(filter),
  ]);
  return { items: await present(auth, docs), meta: toPageMeta(q, total) };
}

export async function getDocument(rc: RequestContext, id: string): Promise<DocumentDto> {
  const auth = requireAuth(rc);
  return (await present(auth, [(await load(auth, id)).doc]))[0]!;
}

async function storeFile(projectId: Types.ObjectId, file: UploadedFile | undefined) {
  if (!file) throw new UnprocessableError('Choose a file to upload');
  const mime = await detectAllowedType(file);
  const storageKey = `documents/${projectId.toString()}/${randomUUID()}`;
  await storage().put(storageKey, file.buffer, mime);
  return { storageKey, mime, fileName: sanitizeFileName(file.originalname), size: file.size };
}

export async function createDocument(
  rc: RequestContext,
  rawMeta: unknown,
  file: UploadedFile | undefined,
): Promise<DocumentDto> {
  const auth = requireAuth(rc);
  const input = createDocumentSchema.parse(rawMeta);
  const project = await loadReadableProject(auth, input.projectId);
  if (!canEdit(auth, project)) throw new ForbiddenError('You cannot add documents to this project');
  const stored = await storeFile(project._id, file);
  const doc = await DocumentModel.create({
    projectId: project._id,
    title: input.title,
    category: input.category,
    description: input.description ?? null,
    tags: [...new Set(input.tags)],
    sharedWithStakeholders: input.sharedWithStakeholders,
    versions: [{ version: 1, ...stored, uploadedBy: auth.userObjectId, uploadedAt: new Date() }],
    currentVersion: 1,
    createdBy: auth.userObjectId,
  });
  await recordActivity(rc, {
    projectId: project._id,
    entityType: 'project',
    entityId: project._id,
    entityLabel: `${project.key} ${project.name}`,
    verb: 'document_added',
    summary: `added document "${doc.title}" (${stored.fileName})`,
  });
  return getDocument(rc, doc._id.toString());
}

export async function addVersion(
  rc: RequestContext,
  id: string,
  note: string | undefined,
  file: UploadedFile | undefined,
): Promise<DocumentDto> {
  const auth = requireAuth(rc);
  const { doc, project } = await load(auth, id);
  if (!canEdit(auth, project)) throw new ForbiddenError();
  if (doc.status === 'pending_approval')
    throw new ConflictError(
      'A version is awaiting approval. Wait for the decision before uploading another.',
    );
  const stored = await storeFile(project._id, file);
  const version = doc.currentVersion + 1;
  const updated = await DocumentModel.updateOne(
    { _id: doc._id, currentVersion: doc.currentVersion },
    {
      $push: {
        versions: {
          version,
          ...stored,
          note: note?.trim() || null,
          uploadedBy: auth.userObjectId,
          uploadedAt: new Date(),
        },
      },
      $set: {
        currentVersion: version,
        status:
          doc.status === 'archived' ? 'archived' : doc.publishedVersion ? 'published' : 'draft',
      },
    },
  );
  if (!updated.modifiedCount)
    throw new ConflictError(
      'Someone else uploaded a version at the same time. Reload and try again.',
    );
  await recordActivity(rc, {
    projectId: project._id,
    entityType: 'project',
    entityId: project._id,
    entityLabel: `${project.key} ${project.name}`,
    verb: 'document_version',
    summary: `uploaded version ${version} of "${doc.title}"`,
  });
  return getDocument(rc, id);
}

export async function updateDocument(
  rc: RequestContext,
  id: string,
  raw: UpdateDocumentInput,
): Promise<DocumentDto> {
  const auth = requireAuth(rc);
  const input = updateDocumentSchema.parse(raw);
  const { doc, project } = await load(auth, id);
  if (!canEdit(auth, project)) throw new ForbiddenError();
  const set: Record<string, unknown> = { ...input };
  if (input.tags) set.tags = [...new Set(input.tags)];
  await DocumentModel.updateOne({ _id: doc._id }, { $set: set });
  if (
    input.sharedWithStakeholders !== undefined &&
    input.sharedWithStakeholders !== doc.sharedWithStakeholders
  )
    await recordAudit(rc, {
      action: input.sharedWithStakeholders ? 'document.shared' : 'document.unshared',
      entityType: 'document',
      entityId: doc._id,
      summary: `${input.sharedWithStakeholders ? 'Shared' : 'Stopped sharing'} "${doc.title}" with external stakeholders (${project.key})`,
    });
  return getDocument(rc, id);
}

export async function archiveDocument(rc: RequestContext, id: string): Promise<void> {
  const auth = requireAuth(rc);
  const { doc, project } = await load(auth, id);
  if (!canEdit(auth, project)) throw new ForbiddenError();
  await DocumentModel.updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } });
  await recordAudit(rc, {
    action: 'document.deleted',
    entityType: 'document',
    entityId: doc._id,
    summary: `Deleted document "${doc.title}" (${project.key})`,
  });
}

/** Sends the current version for publication approval. */
export async function requestPublish(rc: RequestContext, id: string): Promise<DocumentDto> {
  const auth = requireAuth(rc);
  const { doc, project } = await load(auth, id);
  if (!canEdit(auth, project)) throw new ForbiddenError();
  if (doc.publishedVersion === doc.currentVersion)
    throw new UnprocessableError('This version is already published');
  if (doc.status === 'pending_approval')
    throw new ConflictError('Publication is already awaiting approval');
  await requestApproval(rc, project, {
    entityType: 'document_publish',
    entityId: doc._id,
    title: `Publish "${doc.title}" (version ${doc.currentVersion})`,
    description: doc.description ?? null,
  });
  await DocumentModel.updateOne({ _id: doc._id }, { $set: { status: 'pending_approval' } });
  return getDocument(rc, id);
}

/** Pre-signed download (5 minutes) after the visibility check; externals only the published version. */
export async function downloadVersion(
  rc: RequestContext,
  id: string,
  version: number,
): Promise<{ url: string; fileName: string }> {
  const auth = requireAuth(rc);
  const { doc } = await load(auth, id);
  if (isExternal(auth) && version !== doc.publishedVersion) throw new NotFoundError('Version');
  const v = doc.versions.find((x) => x.version === version);
  if (!v) throw new NotFoundError('Version');
  return {
    url: await storage().signedDownloadUrl(v.storageKey, v.fileName, v.mime),
    fileName: v.fileName,
  };
}

/* ---------- Approval outcomes ---------- */

registerApprovalEffect('document_publish', async (rc, a) => {
  const doc = await DocumentModel.findById(a.entityId).lean();
  if (!doc) return;
  await DocumentModel.updateOne(
    { _id: doc._id },
    {
      $set: { status: 'published', publishedVersion: doc.currentVersion, publishedAt: new Date() },
    },
  );
  await recordActivity(rc, {
    projectId: doc.projectId,
    entityType: 'project',
    entityId: doc.projectId,
    entityLabel: doc.title,
    verb: 'document_published',
    summary: `published "${doc.title}" version ${doc.currentVersion} (approval ${a.key})`,
  });
});
registerApprovalClosed('document_publish', async (_rc, a) => {
  const doc = await DocumentModel.findById(a.entityId).lean();
  if (!doc || doc.status !== 'pending_approval') return;
  await DocumentModel.updateOne(
    { _id: doc._id },
    { $set: { status: doc.publishedVersion ? 'published' : 'draft' } },
  );
});
