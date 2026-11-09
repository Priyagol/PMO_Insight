import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { eventBus } from '../src/core/events';
import { addDaysIso, orgToday } from '../src/core/time';
import { Department } from '../src/modules/departments/department.model';
import { Notification } from '../src/modules/notifications/notification.model';
import {
  escalateOverdue,
  OVERDUE_ESCALATION,
} from '../src/modules/notifications/notification.subscribers';
import { Project } from '../src/modules/projects/project.model';
import { Task } from '../src/modules/tasks/task.model';
import { createDepartment, createUser, loginAs, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);
const today = orgToday();

async function setup() {
  const dept = await createDepartment('HLD');
  const head = await createUser({ role: 'department_head', departmentId: dept._id });
  await Department.updateOne({ _id: dept._id }, { headId: head._id });
  const pm = await loginAs(h.app, 'project_manager', { departmentId: dept._id });
  const dev = await createUser({
    role: 'developer',
    departmentId: dept._id,
    managerId: pm.user._id,
  });
  const project = await Project.create({
    key: 'HLD',
    name: 'Branch reports',
    managerId: pm.user._id,
    ownerId: pm.user._id,
    departmentId: dept._id,
    status: 'in_progress',
    members: [
      { userId: pm.user._id, role: 'manager' },
      { userId: dev._id, role: 'member' },
    ],
  });
  return { head, pm, dev, project, url: `/api/v1/projects/${project._id.toString()}` };
}

describe('putting a project on hold', () => {
  it('needs a reason, shows it on the project and tells the team and department head', async () => {
    const { head, pm, dev, url } = await setup();

    const noReason = await api().patch(url).set(pm.auth).send({ status: 'on_hold' });
    expect(noReason.status).toBe(422);

    const until = addDaysIso(today, 30);
    const res = await api()
      .patch(url)
      .set(pm.auth)
      .send({ status: 'on_hold', holdReason: 'Business priorities changed', holdUntil: until });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('on_hold');
    expect(res.body.data.hold).toMatchObject({
      reason: 'Business priorities changed',
      until,
      by: { id: pm.user._id.toString() },
    });

    await eventBus.settle();
    const notes = await Notification.find({ type: 'project_hold' }).lean();
    expect(notes.map((n) => String(n.userId)).sort()).toEqual(
      [dev._id.toString(), head._id.toString()].sort(),
    );
    expect(notes[0]!.title).toBe('HLD Branch reports is on hold');

    const activity = await api().get(`${url}/activity`).set(pm.auth);
    expect(JSON.stringify(activity.body.data)).toContain(
      'put the project on hold: Business priorities changed',
    );
  });

  it('clears the hold when the project restarts', async () => {
    const { pm, url } = await setup();
    await api()
      .patch(url)
      .set(pm.auth)
      .send({ status: 'on_hold', holdReason: 'Waiting for budget' });
    const res = await api().patch(url).set(pm.auth).send({ status: 'in_progress' });
    expect(res.status).toBe(200);
    expect(res.body.data.hold).toBeNull();
    await eventBus.settle();
    expect(await Notification.countDocuments({ title: /no longer on hold/ })).toBeGreaterThan(0);
  });

  it('rejects an expected restart date in the past', async () => {
    const { pm, url } = await setup();
    const res = await api()
      .patch(url)
      .set(pm.auth)
      .send({ status: 'on_hold', holdReason: 'Paused', holdUntil: addDaysIso(today, -1) });
    expect(res.status).toBe(422);
  });

  it('pauses overdue escalations for its tasks', async () => {
    const { pm, dev, project } = await setup();
    await Task.create({
      key: 'HLD-1',
      projectId: project._id,
      title: 'Late work',
      reporterId: pm.user._id,
      assigneeId: dev._id,
      rank: 'a',
      status: 'in_progress',
      dueDate: addDaysIso(today, -OVERDUE_ESCALATION.managers),
    });
    await Project.updateOne({ _id: project._id }, { status: 'on_hold' });
    expect(await escalateOverdue(today)).toBe(0);
    await Project.updateOne({ _id: project._id }, { status: 'in_progress' });
    expect(await escalateOverdue(today)).toBeGreaterThan(0);
  });
});
