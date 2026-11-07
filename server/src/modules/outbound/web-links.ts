import mongoose, { Schema, Types } from 'mongoose';
import {
  WEB_LINK_PROVIDERS,
  WEB_LINK_PROVIDER_LABELS,
  detectWebLinkProvider,
  webLinkSchema,
  type WebLinkDto,
  type WebLinkInput,
  type WebLinkProvider,
} from '@arihant/shared';
import { ForbiddenError, NotFoundError, UnprocessableError } from '../../core/errors';
import { requireAuth, type RequestContext } from '../../core/rbac/context';
import { recordActivity } from '../collab/activity.service';
import { canEditTask, loadTask } from '../tasks/task.service';
import { User } from '../users/user.model';

/*
 * Links from a task to designs, documents and builds in other tools (Figma, Confluence,
 * Google Drive, SharePoint, Jenkins, Azure DevOps…). The tool is recognised from the address;
 * nothing is fetched from it.
 */

interface IWebLink {
  _id: Types.ObjectId;
  taskId: Types.ObjectId;
  projectId: Types.ObjectId;
  url: string;
  title: string;
  provider: WebLinkProvider;
  addedBy: Types.ObjectId;
  createdAt: Date;
}
const webLinkModelSchema = new Schema<IWebLink>(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    url: { type: String, required: true, maxlength: 1000 },
    title: { type: String, required: true, maxlength: 200 },
    provider: { type: String, enum: WEB_LINK_PROVIDERS, required: true },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'webLinks' },
);
webLinkModelSchema.index({ taskId: 1, createdAt: 1 });
export const WebLink =
  (mongoose.models.WebLink as mongoose.Model<IWebLink> | undefined) ??
  mongoose.model<IWebLink>('WebLink', webLinkModelSchema);

const MAX_LINKS = 50;

async function present(rows: IWebLink[]): Promise<WebLinkDto[]> {
  const users = await User.find({ _id: { $in: rows.map((r) => r.addedBy) } })
    .select('name')
    .lean();
  return rows.map((r) => {
    const u = users.find((x) => x._id.equals(r.addedBy));
    return {
      id: r._id.toString(),
      url: r.url,
      title: r.title,
      provider: r.provider,
      addedBy: u ? { id: u._id.toString(), name: u.name } : null,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export async function listWebLinks(rc: RequestContext, taskId: string): Promise<WebLinkDto[]> {
  const { task } = await loadTask(requireAuth(rc), taskId);
  return present(await WebLink.find({ taskId: task._id }).sort({ createdAt: 1 }).lean());
}

export async function addWebLink(
  rc: RequestContext,
  taskId: string,
  raw: WebLinkInput,
): Promise<WebLinkDto> {
  const auth = requireAuth(rc);
  const input = webLinkSchema.parse(raw);
  const { task, project } = await loadTask(auth, taskId);
  if (!(await canEditTask(auth, task, project)))
    throw new ForbiddenError('You cannot change this task');
  if ((await WebLink.countDocuments({ taskId: task._id })) >= MAX_LINKS)
    throw new UnprocessableError(`A task can have ${MAX_LINKS} links`);
  const provider = detectWebLinkProvider(input.url);
  const title =
    input.title?.trim() || `${WEB_LINK_PROVIDER_LABELS[provider]}: ${new URL(input.url).hostname}`;
  const doc = await WebLink.create({
    taskId: task._id,
    projectId: task.projectId,
    url: input.url,
    title,
    provider,
    addedBy: auth.userObjectId,
  });
  await recordActivity(rc, {
    projectId: task.projectId,
    entityType: 'task',
    entityId: task._id,
    entityLabel: `${task.key} ${task.title}`,
    verb: 'updated',
    summary: `linked ${WEB_LINK_PROVIDER_LABELS[provider]} “${title}” to ${task.key}`,
  });
  return (await present([doc.toObject()]))[0]!;
}

export async function removeWebLink(
  rc: RequestContext,
  taskId: string,
  linkId: string,
): Promise<void> {
  const auth = requireAuth(rc);
  const { task, project } = await loadTask(auth, taskId);
  if (!(await canEditTask(auth, task, project)))
    throw new ForbiddenError('You cannot change this task');
  if (!Types.ObjectId.isValid(linkId)) throw new NotFoundError('Link');
  const res = await WebLink.deleteOne({ _id: new Types.ObjectId(linkId), taskId: task._id });
  if (!res.deletedCount) throw new NotFoundError('Link');
}
