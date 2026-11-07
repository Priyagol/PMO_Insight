import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { Types } from 'mongoose';
import {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  type AttachmentDto,
  type UserRef,
} from '@arihant/shared';
import { ForbiddenError, NotFoundError, UnprocessableError } from '../../core/errors';
import { requireAuth, type AuthContext, type RequestContext } from '../../core/rbac/context';
import { canUpdateProject } from '../../core/rbac/work-access';
import { storage } from '../../services/storage';
import { loadReadableProject } from '../projects/project.service';
import { canEditTask, loadTaskForCollab } from '../tasks/task.service';
import { toUserRef } from '../users/user.mapper';
import { User } from '../users/user.model';
import { recordActivity } from './activity.service';
import { Attachment, type IAttachment } from './collab.models';

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

const TEXT_EXTENSIONS: Record<string, string> = { '.txt': 'text/plain', '.csv': 'text/csv' };
const OFFICE_EXTENSIONS: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** Keeps a readable, path-free file name. */
export function sanitizeFileName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? 'file';
  const clean = base
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .trim()
    .slice(0, 200);
  return clean || 'file';
}

/**
 * Determines the real type from the file's bytes (never from the browser-supplied MIME),
 * then checks it against the allow-list. Plain text has no signature, so it is accepted
 * only with a .txt/.csv extension and when it decodes as UTF-8 without control bytes.
 */
export async function detectAllowedType(file: UploadedFile): Promise<string> {
  if (file.size === 0) throw new UnprocessableError('The file is empty');
  if (file.size > MAX_ATTACHMENT_BYTES)
    throw new UnprocessableError('Files must be 25 MB or smaller');
  const ext = extname(file.originalname).toLowerCase();
  const detected = await fileTypeFromBuffer(file.buffer);
  if (detected) {
    // DOCX/XLSX/PPTX are ZIP containers; trust the Office type only when the extension agrees.
    if (detected.mime === 'application/zip' && OFFICE_EXTENSIONS[ext])
      return OFFICE_EXTENSIONS[ext]!;
    if (ALLOWED_ATTACHMENT_TYPES[detected.mime]) return detected.mime;
    throw new UnprocessableError(`Files of type ${detected.mime} are not allowed`);
  }
  if (TEXT_EXTENSIONS[ext]) {
    const text = new TextDecoder('utf-8', { fatal: true });
    try {
      const decoded = text.decode(file.buffer);
      // eslint-disable-next-line no-control-regex -- binary content disguised as text is rejected
      if (/[\u0000-\u0008\u000e-\u001f]/.test(decoded)) throw new Error('control characters');
      return TEXT_EXTENSIONS[ext]!;
    } catch {
      throw new UnprocessableError('The text file is not valid UTF-8 text');
    }
  }
  throw new UnprocessableError('This file type is not allowed');
}

async function present(
  auth: AuthContext,
  docs: IAttachment[],
  canModerate: boolean,
): Promise<AttachmentDto[]> {
  const users = new Map<string, UserRef>(
    (
      await User.find({ _id: { $in: docs.map((d) => d.uploadedBy) } })
        .select('name email employeeId designation')
        .lean()
    ).map((u) => [u._id.toString(), toUserRef(u)]),
  );
  return docs.map((d) => ({
    id: d._id.toString(),
    fileName: d.fileName,
    mime: d.mime,
    size: d.size,
    uploadedBy: users.get(d.uploadedBy.toString()) ?? null,
    canDelete: canModerate || d.uploadedBy.equals(auth.userObjectId),
    createdAt: d.createdAt.toISOString(),
  }));
}

/** Resolves the parent record and whether the caller may add/moderate files on it. */
async function resolveEntity(auth: AuthContext, entityType: 'task' | 'project', entityId: string) {
  if (entityType === 'task') {
    const { task, project } = await loadTaskForCollab(auth, entityId);
    return {
      entityId: task._id,
      projectId: project._id,
      label: `${task.key} ${task.title}`,
      canWrite: await canEditTask(auth, task, project),
    };
  }
  const project = await loadReadableProject(auth, entityId);
  return {
    entityId: project._id,
    projectId: project._id,
    label: `${project.key} ${project.name}`,
    canWrite: !project.archived && canUpdateProject(auth, project),
  };
}

export async function listAttachments(
  rc: RequestContext,
  entityType: 'task' | 'project',
  entityId: string,
): Promise<AttachmentDto[]> {
  const auth = requireAuth(rc);
  const entity = await resolveEntity(auth, entityType, entityId);
  const docs = await Attachment.find({ entityType, entityId: entity.entityId, deletedAt: null })
    .sort({ createdAt: -1 })
    .lean();
  return present(auth, docs, entity.canWrite);
}

export async function uploadAttachment(
  rc: RequestContext,
  entityType: 'task' | 'project',
  entityId: string,
  file: UploadedFile | undefined,
): Promise<AttachmentDto> {
  const auth = requireAuth(rc);
  if (!file) throw new UnprocessableError('Choose a file to upload');
  const entity = await resolveEntity(auth, entityType, entityId);
  if (!entity.canWrite) throw new ForbiddenError('You cannot add files here');
  const mime = await detectAllowedType(file);
  const fileName = sanitizeFileName(file.originalname);
  // Random key: names are never used in storage paths.
  const storageKey = `attachments/${entity.projectId.toString()}/${randomUUID()}`;
  await storage().put(storageKey, file.buffer, mime);
  const doc = await Attachment.create({
    entityType,
    entityId: entity.entityId,
    projectId: entity.projectId,
    fileName,
    mime,
    size: file.size,
    storageKey,
    uploadedBy: auth.userObjectId,
  });
  await recordActivity(rc, {
    projectId: entity.projectId,
    entityType,
    entityId: entity.entityId,
    entityLabel: entity.label,
    verb: 'attached',
    summary: `attached ${fileName}`,
  });
  return (await present(auth, [doc.toObject()], entity.canWrite))[0]!;
}

async function loadAttachment(auth: AuthContext, id: string) {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('File');
  const doc = await Attachment.findOne({ _id: new Types.ObjectId(id), deletedAt: null }).lean();
  if (!doc) throw new NotFoundError('File');
  const entity = await resolveEntity(auth, doc.entityType, doc.entityId.toString()); // enforces read access
  return { doc, entity };
}

/** Returns a 5-minute pre-signed URL after checking the caller can read the parent record. */
export async function downloadUrl(
  rc: RequestContext,
  id: string,
): Promise<{ url: string; fileName: string }> {
  const auth = requireAuth(rc);
  const { doc } = await loadAttachment(auth, id);
  return {
    url: await storage().signedDownloadUrl(doc.storageKey, doc.fileName, doc.mime),
    fileName: doc.fileName,
  };
}

export async function deleteAttachment(rc: RequestContext, id: string): Promise<void> {
  const auth = requireAuth(rc);
  const { doc, entity } = await loadAttachment(auth, id);
  if (!doc.uploadedBy.equals(auth.userObjectId) && !entity.canWrite) throw new ForbiddenError();
  await Attachment.updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } });
  await storage()
    .remove(doc.storageKey)
    .catch(() => undefined); // metadata is gone; orphaned bytes are harmless and can be swept later
  await recordActivity(rc, {
    projectId: entity.projectId,
    entityType: doc.entityType,
    entityId: entity.entityId,
    entityLabel: entity.label,
    verb: 'removed_file',
    summary: `removed ${doc.fileName}`,
  });
}
