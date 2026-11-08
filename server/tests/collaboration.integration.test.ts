import type { Types } from 'mongoose';
import request from 'supertest';
import type { NotificationType } from '@arihant/shared';
import { describe, expect, it } from 'vitest';
import { eventBus } from '../src/core/events';
import { addDaysIso, orgToday } from '../src/core/time';
import { AuditLog } from '../src/modules/audit/audit-log.model';
import { Approval } from '../src/modules/approvals/approval.model';
import { sendApprovalReminders } from '../src/modules/approvals/approval.service';
import { Department } from '../src/modules/departments/department.model';
import { Notification } from '../src/modules/notifications/notification.model';
import { sendDueReminders } from '../src/modules/notifications/notification.subscribers';
import { Project } from '../src/modules/projects/project.model';
import { Task } from '../src/modules/tasks/task.model';
import { User } from '../src/modules/users/user.model';
import { createDepartment, loginAs, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);
const today = orgToday();

let seq = 0;
async function setup() {
  seq += 1;
  const dept = await createDepartment(`CO${seq}`);
  const head = await loginAs(h.app, 'department_head', { departmentId: dept._id });
  await Department.updateOne({ _id: dept._id }, { $set: { headId: head.user._id } });
  const director = await loginAs(h.app, 'director');
  const pm = await loginAs(h.app, 'project_manager', {
    departmentId: dept._id,
    managerId: head.user._id,
  });
  const dev = await loginAs(h.app, 'developer', { departmentId: dept._id, managerId: pm.user._id });
  const outsider = await loginAs(h.app, 'developer', { departmentId: dept._id });
  const res = await api()
    .post('/api/v1/projects')
    .set(pm.auth)
    .send({
      key: `CO${seq}`,
      name: 'Collab Project',
      managerId: pm.user._id.toString(),
      memberIds: [dev.user._id.toString()],
      departmentId: dept._id.toString(),
    });
  expect(res.status).toBe(201);
  return {
    dept,
    head,
    director,
    pm,
    dev,
    outsider,
    project: res.body.data as { id: string; key: string },
  };
}

const notesOf = async (userId: Types.ObjectId, type?: NotificationType) =>
  Notification.find(type ? { userId, type } : { userId }).lean();

describe('notifications', () => {
  it('tells the project testers when a task is ready for testing', async () => {
    const { dept, pm, dev, project } = await setup();
    const tester = await loginAs(h.app, 'qa_tester', { departmentId: dept._id });
    const watchingTester = await loginAs(h.app, 'qa_tester', { departmentId: dept._id });
    const viewerTester = await loginAs(h.app, 'qa_tester', { departmentId: dept._id });
    const otherTester = await loginAs(h.app, 'qa_tester', { departmentId: dept._id });
    await Project.updateOne(
      { _id: project.id },
      {
        $push: {
          members: {
            $each: [
              { userId: tester.user._id, role: 'member' },
              { userId: watchingTester.user._id, role: 'member' },
              { userId: viewerTester.user._id, role: 'viewer' },
            ],
          },
        },
      },
    );
    const t = await api().post('/api/v1/tasks').set(pm.auth).send({
      projectId: project.id,
      title: 'Checkout page',
      assigneeId: dev.user._id.toString(),
    });
    expect(t.status).toBe(201);
    await Task.updateOne(
      { _id: t.body.data.id },
      { $set: { status: 'in_review' }, $addToSet: { watcherIds: watchingTester.user._id } },
    );

    const moved = await api()
      .patch(`/api/v1/tasks/${t.body.data.id}`)
      .set(dev.auth)
      .send({ status: 'testing' });
    expect(moved.status).toBe(200);
    await eventBus.settle();

    const [ready] = await notesOf(tester.user._id, 'task_status');
    expect(ready).toMatchObject({
      title: `${t.body.data.key} is ready for testing`,
      link: `/tasks/mine?task=${t.body.data.id}`,
    });
    // A tester who already follows the task gets the usual status update, not a second one.
    const watching = await notesOf(watchingTester.user._id, 'task_status');
    expect(watching.map((n) => n.title)).toEqual([`${t.body.data.key} moved to Testing`]);
    // Viewers, testers outside the project and the person who moved it hear nothing.
    expect(await notesOf(viewerTester.user._id)).toHaveLength(0);
    expect(await notesOf(otherTester.user._id)).toHaveLength(0);
    expect(await notesOf(dev.user._id, 'task_status')).toHaveLength(0);

    // Other moves don't page the testers.
    await api().patch(`/api/v1/tasks/${t.body.data.id}`).set(dev.auth).send({ status: 'done' });
    await eventBus.settle();
    expect(await notesOf(tester.user._id, 'task_status')).toHaveLength(1);
  });

  it('notifies assignees and mentioned people (never the actor) in-app and by e-mail, respecting preferences', async () => {
    const { pm, dev, project } = await setup();
    const t = await api().post('/api/v1/tasks').set(pm.auth).send({
      projectId: project.id,
      title: 'Prepare report',
      assigneeId: dev.user._id.toString(),
    });
    await eventBus.settle();
    const [assigned] = await notesOf(dev.user._id, 'task_assigned');
    expect(assigned).toMatchObject({
      title: `${t.body.data.key} was assigned to you`,
      link: `/tasks/mine?task=${t.body.data.id}`,
    });
    expect(await notesOf(pm.user._id, 'task_assigned')).toHaveLength(0);
    expect(
      h.emails.some((m) => m.to === dev.user.email && m.subject.includes('was assigned to you')),
    ).toBe(true);

    // Turning off e-mail for mentions keeps the in-app notification only.
    const prefs = await api().get('/api/v1/notifications/preferences').set(dev.auth);
    expect(prefs.body.data).toMatchObject({
      emailEnabled: true,
      email: { mentioned: true, task_status: false },
    });
    await api()
      .put('/api/v1/notifications/preferences')
      .set(dev.auth)
      .send({ emailEnabled: true, email: { ...prefs.body.data.email, mentioned: false } });
    h.emails.length = 0;
    await api()
      .post(`/api/v1/tasks/${t.body.data.id}/comments`)
      .set(pm.auth)
      .send({ body: `Please check @[${dev.user.name}](${dev.user._id.toString()})` });
    await eventBus.settle();
    expect(await notesOf(dev.user._id, 'mentioned')).toHaveLength(1);
    expect(await notesOf(dev.user._id, 'task_comment')).toHaveLength(0); // mentioned people are not told twice
    expect(h.emails.filter((m) => m.to === dev.user.email)).toHaveLength(0);
  });

  it('lists, counts and marks notifications as read for their owner only', async () => {
    const { pm, dev, outsider, project } = await setup();
    for (const title of ['One', 'Two'])
      await api()
        .post('/api/v1/tasks')
        .set(pm.auth)
        .send({ projectId: project.id, title, assigneeId: dev.user._id.toString() });
    await eventBus.settle();
    let list = await api().get('/api/v1/notifications').set(dev.auth);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.meta.unread).toBe(2);
    expect(list.body.data[0].actor).toMatchObject({ id: pm.user._id.toString() });
    const first = list.body.data[0].id as string;
    expect(
      (await api().post(`/api/v1/notifications/${first}/read`).set(outsider.auth)).status,
    ).toBe(404);
    expect((await api().post(`/api/v1/notifications/${first}/read`).set(dev.auth)).status).toBe(
      204,
    );
    expect(
      (await api().get('/api/v1/notifications/unread-count').set(dev.auth)).body.data.unread,
    ).toBe(1);
    await api().post('/api/v1/notifications/read-all').set(dev.auth);
    list = await api().get('/api/v1/notifications?unread=true').set(dev.auth);
    expect(list.body.data).toHaveLength(0);
  });

  it('tells managers about leave requests and owners about decisions; reminds about due tasks', async () => {
    const { pm, dev, project } = await setup();
    const leave = await api()
      .post('/api/v1/availability')
      .set(dev.auth)
      .send({ type: 'leave', from: addDaysIso(today, 5), to: addDaysIso(today, 6) });
    expect(leave.status).toBe(201);
    await eventBus.settle();
    expect(await notesOf(pm.user._id, 'leave_requested')).toHaveLength(1);
    await api().post(`/api/v1/availability/${leave.body.data.id}/approve`).set(pm.auth);
    await eventBus.settle();
    expect((await notesOf(dev.user._id, 'leave_decided'))[0]!.title).toMatch(/was approved/);

    await Task.create({
      key: `CO${seq}-90`,
      projectId: project.id,
      title: 'Due soon',
      reporterId: pm.user._id,
      assigneeId: dev.user._id,
      rank: 'V',
      dueDate: addDaysIso(today, 1),
    });
    await Task.create({
      key: `CO${seq}-91`,
      projectId: project.id,
      title: 'Late',
      reporterId: pm.user._id,
      assigneeId: dev.user._id,
      rank: 'W',
      dueDate: addDaysIso(today, -1),
    });
    await Task.create({
      key: `CO${seq}-92`,
      projectId: project.id,
      title: 'Done',
      reporterId: pm.user._id,
      assigneeId: dev.user._id,
      rank: 'X',
      dueDate: addDaysIso(today, 1),
      status: 'done',
    });
    expect(await sendDueReminders(today)).toBe(2);
    expect((await notesOf(dev.user._id, 'task_due')).map((n) => n.title).sort()).toEqual([
      `CO${seq}-90 is due tomorrow`,
      `CO${seq}-91 is now overdue`,
    ]);
  });
});

describe('approvals', () => {
  it('runs a two-stage project closure and closes the project on final approval', async () => {
    const { head, director, pm, dev, project } = await setup();
    expect(
      (
        await api()
          .post('/api/v1/approvals')
          .set(dev.auth)
          .send({ entityType: 'project_closure', projectId: project.id, title: 'Close it' })
      ).status,
    ).toBe(403);
    const req = await api().post('/api/v1/approvals').set(pm.auth).send({
      entityType: 'project_closure',
      projectId: project.id,
      title: 'All deliverables accepted',
    });
    expect(req.status).toBe(201);
    const a = req.body.data;
    expect(a).toMatchObject({
      key: expect.stringMatching(/^APR-/),
      status: 'pending',
      currentStage: 0,
      can: { act: false, cancel: true },
    });
    expect(a.stages[0]).toMatchObject({
      name: 'Department head',
      status: 'pending',
      approvers: [{ id: head.user._id.toString() }],
    });
    expect(a.stages[1].status).toBe('waiting');
    await eventBus.settle();
    expect(await notesOf(head.user._id, 'approval_requested')).toHaveLength(1);
    expect(
      (
        await api()
          .post('/api/v1/approvals')
          .set(pm.auth)
          .send({ entityType: 'project_closure', projectId: project.id, title: 'Again' })
      ).status,
    ).toBe(409);

    // Only the current stage's approvers may act.
    expect(
      (await api().post(`/api/v1/approvals/${a.id}/approve`).set(director.auth).send({})).status,
    ).toBe(403);
    const inbox = await api().get('/api/v1/approvals?box=inbox').set(head.auth);
    expect(inbox.body.data.map((x: { id: string }) => x.id)).toEqual([a.id]);
    const s1 = await api()
      .post(`/api/v1/approvals/${a.id}/approve`)
      .set(head.auth)
      .send({ comment: 'Looks complete' });
    expect(s1.body.data).toMatchObject({ status: 'pending', currentStage: 1 });
    expect(s1.body.data.stages[1].approvers.map((u: { id: string }) => u.id)).toContain(
      director.user._id.toString(),
    );
    expect((await Project.findById(project.id).lean())!.status).not.toBe('completed');

    const s2 = await api().post(`/api/v1/approvals/${a.id}/approve`).set(director.auth).send({});
    expect(s2.body.data.status).toBe('approved');
    expect((await Project.findById(project.id).lean())!.status).toBe('completed');
    await eventBus.settle();
    expect((await notesOf(pm.user._id, 'approval_decided'))[0]!.title).toMatch(/was approved/);
    expect(await AuditLog.countDocuments({ action: 'approval.approved' })).toBe(1);
    expect(
      (await api().post(`/api/v1/approvals/${a.id}/approve`).set(director.auth).send({})).status,
    ).toBe(409);
  });

  it('skips stages nobody can approve, never lets requesters approve, and supports reject, delegate and withdraw', async () => {
    const { head, director, pm, dev, project } = await setup();
    // A general request by the PM: the PM stage is skipped (requester), the department head decides.
    const g = (
      await api().post('/api/v1/approvals').set(pm.auth).send({
        entityType: 'general',
        projectId: project.id,
        title: 'Budget increase',
        amount: 250000,
      })
    ).body.data;
    expect(g.stages[0]).toMatchObject({
      status: 'skipped',
      note: 'No eligible approver for this stage',
    });
    expect(g.currentStage).toBe(1);
    expect(
      (await api().post(`/api/v1/approvals/${g.id}/reject`).set(head.auth).send({})).status,
    ).toBe(400);
    const rejected = await api()
      .post(`/api/v1/approvals/${g.id}/reject`)
      .set(head.auth)
      .send({ comment: 'Not this quarter' });
    expect(rejected.body.data.status).toBe('rejected');

    // Delegation hands the decision over; the original approver can no longer act.
    const d = (
      await api()
        .post('/api/v1/approvals')
        .set(dev.auth)
        .send({ entityType: 'general', projectId: project.id, title: 'Extra licence' })
    ).body.data;
    expect(d.stages[0].approvers.map((u: { id: string }) => u.id)).toEqual([
      pm.user._id.toString(),
    ]);
    expect(
      (
        await api()
          .post(`/api/v1/approvals/${d.id}/delegate`)
          .set(pm.auth)
          .send({ toUserId: dev.user._id.toString() })
      ).status,
    ).toBe(422);
    const del = await api()
      .post(`/api/v1/approvals/${d.id}/delegate`)
      .set(pm.auth)
      .send({ toUserId: director.user._id.toString(), comment: 'On leave' });
    expect(del.body.data.stages[0].approvers.map((u: { id: string }) => u.id)).toEqual([
      director.user._id.toString(),
    ]);
    expect(
      (await api().post(`/api/v1/approvals/${d.id}/approve`).set(pm.auth).send({})).status,
    ).toBe(403);
    expect((await api().post(`/api/v1/approvals/${d.id}/cancel`).set(pm.auth)).status).toBe(403);
    expect(
      (await api().post(`/api/v1/approvals/${d.id}/cancel`).set(dev.auth)).body.data.status,
    ).toBe('cancelled');

    // Without a department head the closure workflow still reaches the director.
    await Department.updateOne({}, { $set: { headId: null } });
    const c = (
      await api()
        .post('/api/v1/approvals')
        .set(pm.auth)
        .send({ entityType: 'project_closure', projectId: project.id, title: 'Close' })
    ).body.data;
    expect(c.stages.map((s: { status: string }) => s.status)).toEqual(['skipped', 'pending']);
  });

  it('refuses requests nobody can approve, lets admins change workflows, and reminds once after the deadline', async () => {
    const { pm, dev, project } = await setup();
    const admin = await loginAs(h.app, 'super_admin');
    expect(
      (
        await api()
          .put('/api/v1/approvals/workflows/general')
          .set(pm.auth)
          .send({ name: 'X', stages: [] })
      ).status,
    ).toBe(403);
    // A single stage: the requester's reporting manager.
    const wf = await api()
      .put('/api/v1/approvals/workflows/general')
      .set(admin.auth)
      .send({
        name: 'Manager sign-off',
        stages: [{ name: 'Reporting manager', approverType: 'reporting_manager', slaHours: 1 }],
      });
    expect(wf.status).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'approval_workflow.updated' })).toBe(1);
    // The PM reports to nobody, so their own request has no eligible approver.
    await User.updateOne({ _id: pm.user._id }, { $set: { managerId: null } });
    const none = await api()
      .post('/api/v1/approvals')
      .set(pm.auth)
      .send({ entityType: 'general', projectId: project.id, title: 'Nobody' });
    expect(none.status).toBe(422);

    const ok = (
      await api()
        .post('/api/v1/approvals')
        .set(dev.auth)
        .send({ entityType: 'general', projectId: project.id, title: 'Training budget' })
    ).body.data;
    expect(ok.stages[0].approvers.map((u: { id: string }) => u.id)).toEqual([
      pm.user._id.toString(),
    ]);
    await Approval.updateOne(
      { _id: ok.id },
      { $set: { 'stages.0.dueAt': new Date(Date.now() - 60_000) } },
    );
    expect(await sendApprovalReminders()).toBe(1);
    expect(await sendApprovalReminders()).toBe(0);
    expect(await notesOf(pm.user._id, 'approval_reminder')).toHaveLength(1);
    const listed = await api().get('/api/v1/approvals?box=mine').set(dev.auth);
    expect(listed.body.data[0].stages[0].overdue).toBe(true);
  });
});

describe('meetings & minutes', () => {
  it('schedules, publishes minutes, notifies, and converts action items to tasks exactly once', async () => {
    const { pm, dev, outsider, project } = await setup();
    const start = new Date(Date.now() + 86_400_000).toISOString();
    const end = new Date(Date.now() + 86_400_000 + 3_600_000).toISOString();
    expect(
      (
        await api()
          .post('/api/v1/meetings')
          .set(pm.auth)
          .send({ projectId: project.id, title: 'Sprint review', startAt: end, endAt: start })
      ).status,
    ).toBe(400);
    const m = await api()
      .post('/api/v1/meetings')
      .set(pm.auth)
      .send({
        projectId: project.id,
        title: 'Sprint review',
        type: 'review',
        startAt: start,
        endAt: end,
        participantIds: [dev.user._id.toString()],
        agenda: ['Demo', 'Risks'],
      });
    expect(m.status).toBe(201);
    expect(m.body.data.participants.map((p: { id: string }) => p.id).sort()).toEqual(
      [pm.user._id.toString(), dev.user._id.toString()].sort(),
    );
    const id = m.body.data.id as string;
    await eventBus.settle();
    expect(await notesOf(dev.user._id, 'meeting_invite')).toHaveLength(1);
    expect((await api().get(`/api/v1/meetings/${id}`).set(outsider.auth)).status).toBe(404);
    expect(
      (await api().patch(`/api/v1/meetings/${id}`).set(dev.auth).send({ title: 'Mine' })).status,
    ).toBe(403);

    const bad = await api()
      .put(`/api/v1/meetings/${id}/minutes`)
      .set(pm.auth)
      .send({
        minutes: 'x',
        decisions: [],
        actionItems: [{ text: 'Not on team', assigneeId: outsider.user._id.toString() }],
      });
    expect(bad.status).toBe(422);

    const saved = await api()
      .put(`/api/v1/meetings/${id}/minutes`)
      .set(pm.auth)
      .send({
        minutes: 'Demo went well.',
        decisions: ['Ship on Friday'],
        actionItems: [
          {
            text: 'Fix export bug',
            assigneeId: dev.user._id.toString(),
            dueDate: addDaysIso(today, 3),
            priority: 'high',
          },
        ],
        publish: true,
      });
    expect(saved.body.data).toMatchObject({ status: 'completed', decisions: ['Ship on Friday'] });
    expect(saved.body.data.minutesPublishedAt).toBeTruthy();
    await eventBus.settle();
    expect(await notesOf(dev.user._id, 'minutes_published')).toHaveLength(1);
    expect(await notesOf(dev.user._id, 'action_item')).toHaveLength(1);

    const itemId = saved.body.data.actionItems[0].id as string;
    const converted = await api()
      .post(`/api/v1/meetings/${id}/action-items/${itemId}/convert`)
      .set(pm.auth);
    expect(converted.status).toBe(200);
    const linked = converted.body.data.actionItems[0].task;
    expect(linked).toMatchObject({
      key: expect.stringMatching(new RegExp(`^CO${seq}-`)),
      status: 'todo',
    });
    const task = await Task.findById(linked.id).lean();
    expect(task).toMatchObject({
      title: 'Fix export bug',
      priority: 'high',
      dueDate: addDaysIso(today, 3),
    });
    expect(task!.assigneeId!.toString()).toBe(dev.user._id.toString());
    expect(
      (await api().post(`/api/v1/meetings/${id}/action-items/${itemId}/convert`).set(pm.auth))
        .status,
    ).toBe(409);

    // Editing the minutes keeps the item's link to its task.
    const again = await api()
      .put(`/api/v1/meetings/${id}/minutes`)
      .set(pm.auth)
      .send({
        minutes: 'Demo went well. Updated.',
        decisions: ['Ship on Friday'],
        actionItems: [
          { id: itemId, text: 'Fix export bug (CSV)', assigneeId: dev.user._id.toString() },
        ],
      });
    expect(again.body.data.actionItems[0].task.id).toBe(linked.id);
    expect((await api().delete(`/api/v1/meetings/${id}`).set(pm.auth)).status).toBe(409);

    const mine = await api().get('/api/v1/meetings?mine=true').set(dev.auth);
    expect(mine.body.data.map((x: { id: string }) => x.id)).toEqual([id]);
  });
});
