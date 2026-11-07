import { STATUS_LABELS, type TaskStatus } from '@arihant/shared';
import { eventBus, type DomainEvent } from '../../core/events';
import { addDaysIso, orgToday } from '../../core/time';
import { Project } from '../projects/project.model';
import { Risk } from '../risks/risk.model';
import { Task } from '../tasks/task.model';
import { AssignmentPlan } from '../tracking/tracking.models';
import { User } from '../users/user.model';
import { notify } from './notification.service';

const taskLink = (id: string) => `/tasks/mine?task=${id}`;
const actorOf = (e: DomainEvent) => e.actorId ?? null;
const name = async (id: string | undefined | null) =>
  id ? ((await User.findById(id).select('name').lean())?.name ?? 'Someone') : 'Someone';

/** Turns domain events into notifications. Registered once by the API process. */
export function registerNotificationSubscribers(): () => void {
  const subs = [
    eventBus.subscribe('task.assigned', async (e) => {
      const { taskId, to } = e.payload as { taskId: string; to: string | null };
      if (!to) return;
      const t = await Task.findById(taskId).select('key title').lean();
      if (!t) return;
      await notify([to], {
        type: 'task_assigned',
        title: `${t.key} was assigned to you`,
        body: `${await name(actorOf(e))} assigned "${t.title}" to you.`,
        link: taskLink(taskId),
        actorId: actorOf(e),
      });
    }),

    eventBus.subscribe('comment.created', async (e) => {
      const { taskId, mentionIds } = e.payload as { taskId: string; mentionIds: string[] };
      const t = await Task.findById(taskId).select('key title watcherIds assigneeId').lean();
      if (!t) return;
      const who = await name(actorOf(e));
      await notify(mentionIds, {
        type: 'mentioned',
        title: `${who} mentioned you on ${t.key}`,
        body: t.title,
        link: taskLink(taskId),
        actorId: actorOf(e),
      });
      const mentioned = new Set(mentionIds);
      const watchers = [
        ...t.watcherIds.map(String),
        ...(t.assigneeId ? [t.assigneeId.toString()] : []),
      ].filter((w) => !mentioned.has(w));
      await notify(watchers, {
        type: 'task_comment',
        title: `${who} commented on ${t.key}`,
        body: t.title,
        link: taskLink(taskId),
        actorId: actorOf(e),
      });
    }),

    eventBus.subscribe('task.status_changed', async (e) => {
      const { taskId, from, to } = e.payload as {
        taskId: string;
        from: TaskStatus;
        to: TaskStatus;
      };
      const t = await Task.findById(taskId)
        .select('key title watcherIds assigneeId reporterId')
        .lean();
      if (!t) return;
      await notify([...t.watcherIds, t.assigneeId], {
        type: 'task_status',
        title: `${t.key} moved to ${STATUS_LABELS[to]}`,
        body: `${t.title} (was ${STATUS_LABELS[from]})`,
        link: taskLink(taskId),
        actorId: actorOf(e),
      });
    }),

    eventBus.subscribe('timesheet.submitted', async (e) => {
      const { userId } = e.payload as { userId: string };
      const u = await User.findById(userId).select('name managerId').lean();
      if (!u?.managerId) return;
      await notify([u.managerId], {
        type: 'timesheet_submitted',
        title: `${u.name} submitted a timesheet for approval`,
        link: '/timesheets?tab=approvals',
        actorId: actorOf(e),
      });
    }),

    eventBus.subscribe('timesheet.decided', async (e) => {
      const { userId, decision, weekStart, comment } = e.payload as {
        userId: string;
        decision: string;
        weekStart: string;
        comment?: string;
      };
      await notify([userId], {
        type: 'timesheet_decided',
        title: `Your timesheet for the week of ${weekStart} was ${decision}`,
        body: comment ? `Comment: ${comment}` : undefined,
        link: '/timesheets',
        actorId: actorOf(e),
      });
    }),

    eventBus.subscribe('availability.requested', async (e) => {
      const { userId, from, to } = e.payload as { userId: string; from: string; to: string };
      const u = await User.findById(userId).select('name managerId').lean();
      if (!u?.managerId) return;
      await notify([u.managerId], {
        type: 'leave_requested',
        title: `${u.name} requested leave (${from} to ${to})`,
        link: '/teams',
        actorId: actorOf(e),
      });
    }),

    eventBus.subscribe('availability.decided', async (e) => {
      const { userId, decision, from, to } = e.payload as {
        userId: string;
        decision: string;
        from: string;
        to: string;
      };
      await notify([userId], {
        type: 'leave_decided',
        title: `Your leave request (${from} to ${to}) was ${decision}`,
        link: '/my-workspace',
        actorId: actorOf(e),
      });
    }),

    ...(['risk.critical', 'risk.escalated'] as const).map((eventName) =>
      eventBus.subscribe(eventName, async (e) => {
        const { riskId, level } = e.payload as { riskId: string; level?: number };
        const r = await Risk.findById(riskId).select('key title projectId ownerId').lean();
        if (!r) return;
        const p = await Project.findById(r.projectId).select('managerId').lean();
        await notify([p?.managerId, r.ownerId], {
          type: 'risk_alert',
          title:
            eventName === 'risk.critical'
              ? `Critical risk ${r.key}: ${r.title}`
              : `${r.key} escalated to level ${level}`,
          body: eventName === 'risk.escalated' ? r.title : undefined,
          link: `/projects/${r.projectId.toString()}`,
          actorId: actorOf(e),
        });
      }),
    ),

    eventBus.subscribe('assignment.plan_executed', async (e) => {
      const { planId, assigned, conflicts } = e.payload as {
        planId: string;
        assigned: number;
        conflicts: number;
      };
      const plan = await AssignmentPlan.findById(planId).select('createdBy').lean();
      if (!plan) return;
      await notify([plan.createdBy], {
        type: 'assignment_done',
        title: `Assignment plan executed: ${assigned} assigned${conflicts ? `, ${conflicts} conflict(s)` : ''}`,
        link: '/smart-assignment',
      });
    }),
  ];
  return () => subs.forEach((off) => off());
}

/**
 * Daily reminder (worker): tasks due tomorrow, and tasks that became overdue yesterday.
 * Each date matches once, so every task is reminded at most twice.
 */
export async function sendDueReminders(today = orgToday()): Promise<number> {
  let sent = 0;
  const open = { $nin: ['done', 'cancelled'] as TaskStatus[] };
  const [dueSoon, overdue] = await Promise.all([
    Task.find({
      dueDate: addDaysIso(today, 1),
      status: open,
      deletedAt: null,
      assigneeId: { $ne: null },
    })
      .select('key title assigneeId')
      .lean(),
    Task.find({
      dueDate: addDaysIso(today, -1),
      status: open,
      deletedAt: null,
      assigneeId: { $ne: null },
    })
      .select('key title assigneeId')
      .lean(),
  ]);
  for (const t of dueSoon)
    sent += await notify([t.assigneeId], {
      type: 'task_due',
      title: `${t.key} is due tomorrow`,
      body: t.title,
      link: taskLink(t._id.toString()),
    });
  for (const t of overdue)
    sent += await notify([t.assigneeId], {
      type: 'task_due',
      title: `${t.key} is now overdue`,
      body: t.title,
      link: taskLink(t._id.toString()),
    });
  // Automations listen for "task.overdue" (every open task that passed its due date yesterday).
  const newlyOverdue = await Task.find({
    dueDate: addDaysIso(today, -1),
    status: open,
    deletedAt: null,
  })
    .select('projectId')
    .lean();
  for (const t of newlyOverdue)
    eventBus.publish('task.overdue', {
      taskId: t._id.toString(),
      projectId: t.projectId.toString(),
    });
  return sent;
}
