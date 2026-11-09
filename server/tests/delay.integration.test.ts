import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { addDaysIso, orgToday } from '../src/core/time';
import { ProjectVersion } from '../src/modules/projects/project.model';
import { Task } from '../src/modules/tasks/task.model';
import { createDepartment, loginAs, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);
const today = orgToday();

let seq = 0;
async function setup() {
  seq += 1;
  const dept = await createDepartment(`DL${seq}`);
  const director = await loginAs(h.app, 'director');
  const pm = await loginAs(h.app, 'project_manager', { departmentId: dept._id });
  const dev = await loginAs(h.app, 'developer', { departmentId: dept._id });
  const dev2 = await loginAs(h.app, 'developer', { departmentId: dept._id });
  const end = addDaysIso(today, 10);
  const p = await api()
    .post('/api/v1/projects')
    .set(pm.auth)
    .send({
      key: `DL${seq}`,
      name: 'Delay Project',
      managerId: pm.user._id.toString(),
      memberIds: [dev.user._id.toString(), dev2.user._id.toString()],
      startDate: addDaysIso(today, -30),
      endDate: end,
    });
  expect(p.status).toBe(201);
  return { director, pm, dev, dev2, end, project: p.body.data as { id: string; key: string } };
}

describe('project delay analysis', () => {
  it('asks for a reason when the end date moves later and keeps it in the history', async () => {
    const { pm, end, project } = await setup();
    const later = addDaysIso(end, 7);
    const noReason = await api()
      .patch(`/api/v1/projects/${project.id}`)
      .set(pm.auth)
      .send({ endDate: later });
    expect(noReason.status).toBe(422);
    expect(noReason.body.error.message).toMatch(/reason/);

    const ok = await api()
      .patch(`/api/v1/projects/${project.id}`)
      .set(pm.auth)
      .send({ endDate: later, dateChangeReason: 'Client added two reports' });
    expect(ok.status).toBe(200);
    const [v] = await ProjectVersion.find({ projectId: project.id }).sort({ version: -1 }).lean();
    expect(v).toMatchObject({ reason: 'Client added two reports' });

    // Moving it earlier needs no reason.
    const earlier = await api()
      .patch(`/api/v1/projects/${project.id}`)
      .set(pm.auth)
      .send({ endDate: addDaysIso(later, -2) });
    expect(earlier.status).toBe(200);
  });

  it('shows managers where time was lost and who was involved; developers see only their own work', async () => {
    const { director, pm, dev, dev2, end, project } = await setup();
    await api()
      .patch(`/api/v1/projects/${project.id}`)
      .set(pm.auth)
      .send({ endDate: addDaysIso(end, 5), dateChangeReason: 'Vendor API late' });

    const mk = (over: Record<string, unknown>) =>
      Task.create({
        key: `${project.key}-${Math.random().toString(36).slice(2, 7)}`,
        projectId: project.id,
        title: 'Task',
        reporterId: pm.user._id,
        rank: 'm',
        ...over,
      });
    // Finished 4 days after its due date.
    await mk({
      title: 'Payment screen',
      status: 'done',
      dueDate: addDaysIso(today, -6),
      completedAt: new Date(Date.now() - 2 * 86_400_000),
      assigneeId: dev.user._id,
    });
    // Still open, 3 days overdue (someone else's).
    await mk({
      title: 'Export',
      status: 'in_progress',
      dueDate: addDaysIso(today, -3),
      assigneeId: dev2.user._id,
    });
    // Blocked now, then its due date pushed by the PM.
    const t = await api()
      .post('/api/v1/tasks')
      .set(pm.auth)
      .send({
        projectId: project.id,
        title: 'Report engine',
        assigneeId: dev.user._id.toString(),
        status: 'in_progress',
        dueDate: addDaysIso(today, 2),
      });
    expect(t.status).toBe(201);
    await api()
      .patch(`/api/v1/tasks/${t.body.data.id}`)
      .set(dev.auth)
      .send({ status: 'blocked', transitionComment: 'Waiting for vendor keys' });
    await api()
      .patch(`/api/v1/tasks/${t.body.data.id}`)
      .set(pm.auth)
      .send({ dueDate: addDaysIso(today, 9) });

    const res = await api().get(`/api/v1/analytics/projects/${project.id}/delays`).set(pm.auth);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.showPeople).toBe(true);
    expect(d.timeline).toMatchObject({ baselineEndDate: end, slipDays: 5, slips: 1 });
    expect(d.slipHistory[0]).toMatchObject({
      from: end,
      to: addDaysIso(end, 5),
      days: 5,
      reason: 'Vendor API late',
      by: { id: pm.user._id.toString() },
    });
    expect(
      d.lateTasks.map((x: { title: string; daysLate: number }) => [x.title, x.daysLate]),
    ).toEqual([
      ['Payment screen', 4],
      ['Export', 3],
    ]);
    expect(d.lateTasks[0].assignee.id).toBe(dev.user._id.toString());
    expect(d.blocked[0]).toMatchObject({
      key: t.body.data.key,
      current: true,
      comment: 'Waiting for vendor keys',
      markedBy: { id: dev.user._id.toString() },
    });
    expect(d.dueDatePushes[0]).toMatchObject({ days: 7, by: { id: pm.user._id.toString() } });
    const devRow = d.people.find(
      (p: { user: { id: string } }) => p.user.id === dev.user._id.toString(),
    );
    expect(devRow).toMatchObject({ lateTasks: 1, lateTaskDays: 4 });
    expect(
      d.people.find((p: { user: { id: string } }) => p.user.id === pm.user._id.toString()),
    ).toMatchObject({
      dueDatePushDays: 7,
    });

    // A developer sees the project picture and only their own tasks, without names.
    const mine = (await api().get(`/api/v1/analytics/projects/${project.id}/delays`).set(dev.auth))
      .body.data;
    expect(mine.showPeople).toBe(false);
    expect(mine.lateTasks.map((x: { title: string }) => x.title)).toEqual(['Payment screen']);
    expect(mine.lateTasks[0].assignee).toBeNull();
    expect(mine.slipHistory[0].by).toBeNull();
    expect(mine.slipHistory[0].reason).toBe('Vendor API late');
    expect(mine.people).toEqual([]);

    // The portfolio timeline lists it for the director.
    const tl = await api().get('/api/v1/analytics/timeline').set(director.auth);
    expect(tl.status).toBe(200);
    expect(
      tl.body.data.find((r: { project: { id: string } }) => r.project.id === project.id),
    ).toMatchObject({
      baselineEndDate: end,
      endDate: addDaysIso(end, 5),
    });

    // Moved end date: at least at risk; late too when the forecast passes the new date.
    expect(['at_risk', 'late']).toContain(
      tl.body.data.find((r: { project: { id: string } }) => r.project.id === project.id).state,
    );

    // Someone outside the project cannot open it.
    const outsider = await loginAs(h.app, 'project_manager');
    expect(
      (await api().get(`/api/v1/analytics/projects/${project.id}/delays`).set(outsider.auth))
        .status,
    ).toBe(404);
  });
});
