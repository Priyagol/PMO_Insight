import { Types } from 'mongoose';
import { MENTION_PATTERN, type CommentDto, type UserRef } from '@arihant/shared';
import { eventBus } from '../../core/events';
import { ForbiddenError, NotFoundError, UnprocessableError } from '../../core/errors';
import { requireAuth, type AuthContext, type RequestContext } from '../../core/rbac/context';
import { isProjectParticipant } from '../../core/rbac/work-access';
import { Task } from '../tasks/task.model';
import { canEditTask, loadTaskForCollab } from '../tasks/task.service';
import { toUserRef } from '../users/user.mapper';
import { User } from '../users/user.model';
import { recordActivity } from './activity.service';
import { Comment, type IComment } from './collab.models';

/** Mentioned user ids found in the text (deduplicated). */
export function extractMentionIds(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION_PATTERN)].map((m) => m[2]!.toLowerCase()))];
}

async function present(auth: AuthContext, comments: IComment[]): Promise<CommentDto[]> {
  const ids = new Set<string>();
  comments.forEach((c) => {
    ids.add(c.authorId.toString());
    c.mentions.forEach((m) => ids.add(m.toString()));
  });
  const users = new Map<string, UserRef>(
    (
      await User.find({ _id: { $in: [...ids] } })
        .select('name email employeeId designation')
        .lean()
    ).map((u) => [u._id.toString(), toUserRef(u)]),
  );
  return comments.map((c) => ({
    id: c._id.toString(),
    author: users.get(c.authorId.toString()) ?? null,
    body: c.body,
    mentions: c.mentions
      .map((m) => users.get(m.toString()))
      .filter((u): u is UserRef => Boolean(u)),
    parentId: c.parentId?.toString() ?? null,
    edited: Boolean(c.editedAt),
    canEdit: c.authorId.equals(auth.userObjectId),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));
}

export async function listComments(rc: RequestContext, taskId: string): Promise<CommentDto[]> {
  const auth = requireAuth(rc);
  const { task } = await loadTaskForCollab(auth, taskId);
  const comments = await Comment.find({ entityType: 'task', entityId: task._id, deletedAt: null })
    .sort({ createdAt: 1 })
    .limit(500)
    .lean();
  return present(auth, comments);
}

/** Any reader of a task may comment. Mentions of people outside the project team are ignored. */
export async function addComment(
  rc: RequestContext,
  taskId: string,
  input: { body: string; parentId?: string | null },
): Promise<CommentDto> {
  const auth = requireAuth(rc);
  const { task, project } = await loadTaskForCollab(auth, taskId);
  if (project.archived) throw new UnprocessableError('This project is archived');
  if (input.parentId) {
    const parent = await Comment.findOne({
      _id: new Types.ObjectId(input.parentId),
      entityId: task._id,
      deletedAt: null,
    }).lean();
    if (!parent) throw new UnprocessableError('The comment you replied to no longer exists');
  }
  const mentions = extractMentionIds(input.body)
    .filter((id) => isProjectParticipant(project, id))
    .map((id) => new Types.ObjectId(id));
  const comment = await Comment.create({
    entityType: 'task',
    entityId: task._id,
    projectId: task.projectId,
    authorId: auth.userObjectId,
    body: input.body,
    mentions,
    parentId: input.parentId ? new Types.ObjectId(input.parentId) : null,
  });
  // Commenters and mentioned people follow the task from now on.
  await Task.updateOne(
    { _id: task._id },
    { $addToSet: { watcherIds: { $each: [auth.userObjectId, ...mentions] } } },
  );
  await recordActivity(rc, {
    projectId: task.projectId,
    entityType: 'task',
    entityId: task._id,
    entityLabel: `${task.key} ${task.title}`,
    verb: 'commented',
    summary: `commented on ${task.key}`,
  });
  eventBus.publish(
    'comment.created',
    { commentId: comment._id.toString(), taskId, mentionIds: mentions.map(String) },
    { actorId: auth.userId, requestId: rc.requestId },
  );
  return (await present(auth, [comment.toObject()]))[0]!;
}

async function loadOwnComment(auth: AuthContext, id: string) {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Comment');
  const comment = await Comment.findOne({ _id: new Types.ObjectId(id), deletedAt: null }).lean();
  if (!comment) throw new NotFoundError('Comment');
  // Confirms the caller can still read the task.
  const access = await loadTaskForCollab(auth, comment.entityId.toString());
  return { comment, ...access };
}

export async function editComment(
  rc: RequestContext,
  id: string,
  body: string,
): Promise<CommentDto> {
  const auth = requireAuth(rc);
  const { comment, project } = await loadOwnComment(auth, id);
  if (!comment.authorId.equals(auth.userObjectId))
    throw new ForbiddenError('You can only edit your own comments');
  const mentions = extractMentionIds(body)
    .filter((uid) => isProjectParticipant(project, uid))
    .map((uid) => new Types.ObjectId(uid));
  const updated = await Comment.findOneAndUpdate(
    { _id: comment._id },
    { $set: { body, mentions, editedAt: new Date() } },
    { returnDocument: 'after' },
  ).lean();
  return (await present(auth, [updated!]))[0]!;
}

/** Authors can delete their comments; people who can edit the task can moderate. */
export async function deleteComment(rc: RequestContext, id: string): Promise<void> {
  const auth = requireAuth(rc);
  const { comment, task, project } = await loadOwnComment(auth, id);
  const own = comment.authorId.equals(auth.userObjectId);
  if (!own && !(await canEditTask(auth, task, project))) throw new ForbiddenError();
  await Comment.updateOne({ _id: comment._id }, { $set: { deletedAt: new Date() } });
}
