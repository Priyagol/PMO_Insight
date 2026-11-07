import { Types } from 'mongoose';
import {
  createMeetingSchema,
  meetingMinutesSchema,
  meetingQuerySchema,
  updateMeetingSchema,
  type CreateMeetingInput,
  type MeetingDto,
  type MeetingMinutesInput,
  type MeetingQuery,
  type PageMeta,
  type UpdateMeetingInput,
  type UserRef,
} from '@arihant/shared';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from '../../core/errors';
import { toPageMeta, toPageWindow } from '../../core/pagination';
import { requireAuth, type AuthContext, type RequestContext } from '../../core/rbac/context';
import { can } from '../../core/rbac/policy';
import {
  canCreateTaskIn,
  canUpdateProject,
  isProjectParticipant,
  readableProjectIds,
} from '../../core/rbac/work-access';
import { recordAudit } from '../audit/audit.service';
import { recordActivity } from '../collab/activity.service';
import { notify } from '../notifications/notification.service';
import { Project, type IProject } from '../projects/project.model';
import { loadReadableProject } from '../projects/project.service';
import { Task } from '../tasks/task.model';
import { createTask } from '../tasks/task.service';
import { toUserRef } from '../users/user.mapper';
import { User } from '../users/user.model';
import { Meeting, type IMeeting } from './meeting.model';

const oid = (id: string) => new Types.ObjectId(id);
const link = (m: { _id: Types.ObjectId }) => `/meetings?open=${m._id.toString()}`;
const fmt = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

/** Organiser, or someone who manages the project, may change a meeting. */
const canEdit = (auth: AuthContext, m: IMeeting, project: IProject) =>
  !project.archived && (m.organizerId.equals(auth.userObjectId) || canUpdateProject(auth, project));

/** Meetings of readable projects, plus any meeting the person takes part in. */
async function visibleFilter(auth: AuthContext): Promise<Record<string, unknown>> {
  const mine = [{ participantIds: auth.userObjectId }, { organizerId: auth.userObjectId }];
  if (!can(auth, 'meeting:read')) return { $or: mine };
  const projects = await readableProjectIds(auth);
  return projects === 'all' ? {} : { $or: [...mine, { projectId: { $in: projects } }] };
}

async function present(auth: AuthContext, docs: IMeeting[]): Promise<MeetingDto[]> {
  const userIds = new Set<string>();
  const taskIds: Types.ObjectId[] = [];
  for (const m of docs) {
    userIds.add(m.organizerId.toString());
    m.participantIds.forEach((p) => userIds.add(p.toString()));
    m.actionItems.forEach((a) => {
      if (a.assigneeId) userIds.add(a.assigneeId.toString());
      if (a.taskId) taskIds.push(a.taskId);
    });
  }
  const [users, projects, tasks] = await Promise.all([
    User.find({ _id: { $in: [...userIds] } })
      .select('name email employeeId designation')
      .lean(),
    Project.find({ _id: { $in: docs.map((d) => d.projectId) } }).lean(),
    Task.find({ _id: { $in: taskIds }, deletedAt: null })
      .select('key status')
      .lean(),
  ]);
  const u = new Map<string, UserRef>(users.map((x) => [x._id.toString(), toUserRef(x)]));
  const p = new Map(projects.map((x) => [x._id.toString(), x as IProject]));
  const t = new Map(tasks.map((x) => [x._id.toString(), x]));
  return docs.map((m) => {
    const project = p.get(m.projectId.toString())!;
    return {
      id: m._id.toString(),
      project: { id: project._id.toString(), key: project.key, name: project.name },
      title: m.title,
      type: m.type,
      status: m.status,
      startAt: m.startAt.toISOString(),
      endAt: m.endAt.toISOString(),
      location: m.location ?? undefined,
      organizer: u.get(m.organizerId.toString()) ?? null,
      participants: m.participantIds
        .map((x) => u.get(x.toString()))
        .filter((x): x is UserRef => Boolean(x)),
      agenda: m.agenda,
      minutes: m.minutes ?? undefined,
      decisions: m.decisions,
      actionItems: m.actionItems.map((a) => {
        const task = a.taskId ? t.get(a.taskId.toString()) : undefined;
        return {
          id: a._id.toString(),
          text: a.text,
          assignee: a.assigneeId ? (u.get(a.assigneeId.toString()) ?? null) : null,
          dueDate: a.dueDate ?? undefined,
          priority: a.priority,
          task: task ? { id: task._id.toString(), key: task.key, status: task.status } : null,
        };
      }),
      minutesPublishedAt: m.minutesPublishedAt?.toISOString(),
      can: { edit: canEdit(auth, m, project) },
      createdAt: m.createdAt.toISOString(),
    };
  });
}

async function loadVisible(
  auth: AuthContext,
  id: string,
): Promise<{ meeting: IMeeting; project: IProject }> {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Meeting');
  const meeting = await Meeting.findOne({
    $and: [{ _id: oid(id), deletedAt: null }, await visibleFilter(auth)],
  }).lean();
  if (!meeting) throw new NotFoundError('Meeting');
  const project = await Project.findById(meeting.projectId).lean();
  if (!project) throw new NotFoundError('Meeting');
  return { meeting, project };
}

async function loadEditable(auth: AuthContext, id: string) {
  const r = await loadVisible(auth, id);
  if (!canEdit(auth, r.meeting, r.project))
    throw new ForbiddenError('Only the organiser or the project manager can change this meeting');
  return r;
}

async function assertParticipants(ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (
    unique.length &&
    (await User.countDocuments({ _id: { $in: unique.map(oid) }, status: 'active' })) !==
      unique.length
  )
    throw new UnprocessableError('Participants must be active employees');
}

/* ---------- Queries ---------- */

export async function listMeetings(
  rc: RequestContext,
  raw: MeetingQuery,
): Promise<{ items: MeetingDto[]; meta: PageMeta }> {
  const auth = requireAuth(rc);
  const q = meetingQuerySchema.parse(raw);
  const and: Record<string, unknown>[] = [{ deletedAt: null }, await visibleFilter(auth)];
  if (q.projectId) and.push({ projectId: oid(q.projectId) });
  if (q.status) and.push({ status: q.status });
  if (q.mine === 'true')
    and.push({ $or: [{ participantIds: auth.userObjectId }, { organizerId: auth.userObjectId }] });
  if (q.from || q.to)
    and.push({
      startAt: {
        ...(q.from ? { $gte: new Date(q.from) } : {}),
        ...(q.to ? { $lte: new Date(q.to) } : {}),
      },
    });
  const filter = { $and: and };
  const win = toPageWindow(q, ['startAt', 'createdAt'], { startAt: -1, _id: -1 });
  const [docs, total] = await Promise.all([
    Meeting.find(filter).sort(win.sort).skip(win.skip).limit(win.limit).lean(),
    Meeting.countDocuments(filter),
  ]);
  return { items: await present(auth, docs), meta: toPageMeta(q, total) };
}

export async function getMeeting(rc: RequestContext, id: string): Promise<MeetingDto> {
  const auth = requireAuth(rc);
  return (await present(auth, [(await loadVisible(auth, id)).meeting]))[0]!;
}

/* ---------- Commands ---------- */

export async function createMeeting(
  rc: RequestContext,
  raw: CreateMeetingInput,
): Promise<MeetingDto> {
  const auth = requireAuth(rc);
  const input = createMeetingSchema.parse(raw);
  const project = await loadReadableProject(auth, input.projectId);
  if (project.archived) throw new UnprocessableError('This project is archived');
  if (
    !can(auth, 'meeting:write') ||
    (!isProjectParticipant(project, auth.userId) && !canUpdateProject(auth, project))
  )
    throw new ForbiddenError('You cannot schedule meetings for this project');
  await assertParticipants(input.participantIds);
  const participants = [...new Set([auth.userId, ...input.participantIds])].map(oid);
  const doc = await Meeting.create({
    projectId: project._id,
    title: input.title,
    type: input.type,
    startAt: new Date(input.startAt),
    endAt: new Date(input.endAt),
    location: input.location ?? null,
    organizerId: auth.userObjectId,
    participantIds: participants,
    agenda: input.agenda,
  });
  await recordActivity(rc, {
    projectId: project._id,
    entityType: 'project',
    entityId: project._id,
    entityLabel: `${project.key} ${project.name}`,
    verb: 'meeting_scheduled',
    summary: `scheduled meeting "${doc.title}" for ${fmt(doc.startAt)}`,
  });
  await notify(participants, {
    type: 'meeting_invite',
    title: `Meeting: ${doc.title}`,
    body: `${project.key} · ${fmt(doc.startAt)}${doc.location ? ` · ${doc.location}` : ''}`,
    link: link(doc),
    actorId: auth.userId,
  });
  return getMeeting(rc, doc._id.toString());
}

export async function updateMeeting(
  rc: RequestContext,
  id: string,
  raw: UpdateMeetingInput,
): Promise<MeetingDto> {
  const auth = requireAuth(rc);
  const input = updateMeetingSchema.parse(raw);
  const { meeting } = await loadEditable(auth, id);
  const set: Record<string, unknown> = {};
  if (input.title !== undefined) set.title = input.title;
  if (input.type !== undefined) set.type = input.type;
  if (input.location !== undefined) set.location = input.location;
  if (input.agenda !== undefined) set.agenda = input.agenda;
  if (input.status !== undefined) set.status = input.status;
  if (input.startAt !== undefined) set.startAt = new Date(input.startAt);
  if (input.endAt !== undefined) set.endAt = new Date(input.endAt);
  const start = (set.startAt as Date | undefined) ?? meeting.startAt;
  const end = (set.endAt as Date | undefined) ?? meeting.endAt;
  if (start >= end) throw new UnprocessableError('End must be after the start');
  let added: Types.ObjectId[] = [];
  if (input.participantIds !== undefined) {
    await assertParticipants(input.participantIds);
    const next = [...new Set([meeting.organizerId.toString(), ...input.participantIds])].map(oid);
    added = next.filter((n) => !meeting.participantIds.some((p) => p.equals(n)));
    set.participantIds = next;
  }
  await Meeting.updateOne({ _id: meeting._id }, { $set: set });
  const title = (set.title as string | undefined) ?? meeting.title;
  if (added.length)
    await notify(added, {
      type: 'meeting_invite',
      title: `Meeting: ${title}`,
      body: fmt(start),
      link: link(meeting),
      actorId: auth.userId,
    });
  if (set.status === 'cancelled' && meeting.status !== 'cancelled')
    await notify(meeting.participantIds, {
      type: 'meeting_invite',
      title: `Cancelled: ${title}`,
      body: fmt(start),
      link: link(meeting),
      actorId: auth.userId,
    });
  else if (set.startAt || set.endAt)
    await notify(meeting.participantIds, {
      type: 'meeting_invite',
      title: `Rescheduled: ${title}`,
      body: `Now ${fmt(start)}`,
      link: link(meeting),
      actorId: auth.userId,
    });
  return getMeeting(rc, id);
}

export async function deleteMeeting(rc: RequestContext, id: string): Promise<void> {
  const auth = requireAuth(rc);
  const { meeting, project } = await loadEditable(auth, id);
  if (meeting.minutesPublishedAt)
    throw new ConflictError(
      'Meetings with published minutes are kept as a record. Cancel it instead.',
    );
  await Meeting.updateOne({ _id: meeting._id }, { $set: { deletedAt: new Date() } });
  await recordAudit(rc, {
    action: 'meeting.deleted',
    entityType: 'meeting',
    entityId: meeting._id,
    summary: `Deleted meeting "${meeting.title}" (${project.key})`,
  });
}

/**
 * Saves minutes, decisions and action items. Existing items keep their ids (and links to
 * tasks created from them). Publishing completes the meeting and notifies participants;
 * after publication, newly assigned action items notify their assignee.
 */
export async function saveMinutes(
  rc: RequestContext,
  id: string,
  raw: MeetingMinutesInput,
): Promise<MeetingDto> {
  const auth = requireAuth(rc);
  const input = meetingMinutesSchema.parse(raw);
  const { meeting, project } = await loadEditable(auth, id);
  if (meeting.status === 'cancelled') throw new UnprocessableError('This meeting was cancelled');
  for (const a of input.actionItems)
    if (a.assigneeId && !isProjectParticipant(project, a.assigneeId))
      throw new UnprocessableError(
        'Action items can only be assigned to people on the project team',
      );

  const previous = new Map(meeting.actionItems.map((a) => [a._id.toString(), a]));
  const items = input.actionItems.map((a) => {
    const old = a.id ? previous.get(a.id) : undefined;
    return {
      _id: old?._id ?? new Types.ObjectId(),
      text: a.text,
      assigneeId: a.assigneeId ? oid(a.assigneeId) : null,
      dueDate: a.dueDate ?? null,
      priority: a.priority,
      taskId: old?.taskId ?? null,
    };
  });
  const publishing = input.publish && !meeting.minutesPublishedAt;
  const published = Boolean(meeting.minutesPublishedAt) || publishing;
  await Meeting.updateOne(
    { _id: meeting._id },
    {
      $set: {
        minutes: input.minutes || null,
        decisions: input.decisions,
        actionItems: items,
        ...(publishing ? { minutesPublishedAt: new Date(), status: 'completed' } : {}),
      },
    },
  );
  if (publishing) {
    await recordActivity(rc, {
      projectId: project._id,
      entityType: 'project',
      entityId: project._id,
      entityLabel: `${project.key} ${project.name}`,
      verb: 'minutes_published',
      summary: `published minutes of "${meeting.title}" (${input.decisions.length} decisions, ${items.length} action items)`,
    });
    await notify(meeting.participantIds, {
      type: 'minutes_published',
      title: `Minutes published: ${meeting.title}`,
      body: `${input.decisions.length} decision(s), ${items.length} action item(s)`,
      link: link(meeting),
      actorId: auth.userId,
    });
  }
  if (published) {
    for (const a of items) {
      if (!a.assigneeId) continue;
      const old = previous.get(a._id.toString());
      if (!publishing && old?.assigneeId?.equals(a.assigneeId)) continue;
      await notify([a.assigneeId], {
        type: 'action_item',
        title: `Action item from "${meeting.title}"`,
        body: `${a.text}${a.dueDate ? ` (due ${a.dueDate})` : ''}`,
        link: link(meeting),
        actorId: auth.userId,
      });
    }
  }
  return getMeeting(rc, id);
}

/** Turns an action item into a project task (once); the item keeps a link to it. */
export async function convertActionItem(
  rc: RequestContext,
  id: string,
  itemId: string,
): Promise<MeetingDto> {
  const auth = requireAuth(rc);
  const { meeting, project } = await loadVisible(auth, id);
  if (!canCreateTaskIn(auth, project))
    throw new ForbiddenError('You cannot create tasks in this project');
  const item = meeting.actionItems.find((a) => a._id.toString() === itemId);
  if (!item) throw new NotFoundError('Action item');
  if (item.taskId) throw new ConflictError('This action item is already a task');
  // Claim the item first so two clicks cannot create two tasks.
  const placeholder = new Types.ObjectId();
  const claimed = await Meeting.updateOne(
    { _id: meeting._id, actionItems: { $elemMatch: { _id: item._id, taskId: null } } },
    { $set: { 'actionItems.$.taskId': placeholder } },
  );
  if (!claimed.modifiedCount) throw new ConflictError('This action item is already a task');
  try {
    const task = await createTask(rc, {
      projectId: project._id.toString(),
      title: item.text.slice(0, 200),
      description: `From meeting "${meeting.title}" on ${fmt(meeting.startAt)}.`,
      assigneeId: item.assigneeId?.toString() ?? null,
      dueDate: item.dueDate ?? null,
      priority: item.priority,
    });
    await Meeting.updateOne(
      { _id: meeting._id, 'actionItems._id': item._id },
      { $set: { 'actionItems.$.taskId': oid(task.id) } },
    );
  } catch (err) {
    await Meeting.updateOne(
      { _id: meeting._id, 'actionItems._id': item._id },
      { $set: { 'actionItems.$.taskId': null } },
    );
    throw err;
  }
  return getMeeting(rc, id);
}
