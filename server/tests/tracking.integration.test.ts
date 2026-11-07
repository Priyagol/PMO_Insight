import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { addDaysIso, orgToday, weekStartIso } from '../src/core/time';
import { Project } from '../src/modules/projects/project.model';
import { Task } from '../src/modules/tasks/task.model';
import { sendTimesheetReminders } from '../src/modules/tracking/people.service';
import { Timer } from '../src/modules/tracking/tracking.models';
import { User } from '../src/modules/users/user.model';
import { createUser, login, loginAs, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);
const today = orgToday();
const thisWeek = weekStartIso(today);
// A date safely inside last week, so tests do not depend on the weekday they run on.
const lastWeekDay = addDaysIso(weekStartIso(today), -5);

/** A team lead managing a developer, both on one project with one task. */
async function setup() {
  const lead = await loginAs(h.app, 'team_lead');
  const devUser = await createUser({ role: 'developer', managerId: lead.user._id });
  const dev = { user: devUser, ...(await login(h.app, devUser.email)) };
  const devAuth = { Authorization: `Bearer ${dev.token}` };
  const project = await Project.create({
    key: 'WRK',
    name: 'Work Tracking',
    managerId: lead.user._id,
    members: [
      { userId: lead.user._id, role: 'manager' },
      { userId: devUser._id, role: 'member' },
    ],
  });
  const task = await Task.create({
    key: 'WRK-1',
    projectId: project._id,
    title: 'Build API',
    reporterId: lead.user._id,
    assigneeId: devUser._id,
    rank: 'V',
    estimatedHours: 10,
  });
  return { lead, dev: { ...dev, auth: devAuth }, project, task };
}

describe('work logs', () => {
  it('logs time by duration or by range, updates task actual hours and rejects overlaps', async () => {
    const { dev, project, task } = await setup();
    const base = {
      date: lastWeekDay,
      projectId: project._id.toString(),
      taskId: task._id.toString(),
      category: 'development',
    };
    const a = await api()
      .post('/api/v1/worklogs')
      .set(dev.auth)
      .send({ ...base, description: 'Endpoint design', startTime: '09:00', endTime: '11:30' });
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({
      minutes: 150,
      startTime: '09:00',
      endTime: '11:30',
      source: 'manual',
    });
    const b = await api()
      .post('/api/v1/worklogs')
      .set(dev.auth)
      .send({ ...base, description: 'Code review', minutes: 30 });
    expect(b.status).toBe(201);
    expect((await Task.findById(task._id).lean())!.actualHours).toBe(3);

    const overlap = await api()
      .post('/api/v1/worklogs')
      .set(dev.auth)
      .send({ ...base, description: 'Overlapping', startTime: '11:00', endTime: '12:00' });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.message).toMatch(/09:00–11:30/);

    const future = await api()
      .post('/api/v1/worklogs')
      .set(dev.auth)
      .send({ ...base, date: addDaysIso(today, 2), description: 'Future', minutes: 10 });
    expect(future.status).toBe(422);
    const tooMuch = await api()
      .post('/api/v1/worklogs')
      .set(dev.auth)
      .send({ ...base, description: 'Marathon', minutes: 1440 });
    expect(tooMuch.status).toBe(422);
  });

  it('only allows logging on your projects; others cannot read your logs unless they manage you', async () => {
    const { dev, lead, project } = await setup();
    const outsider = await loginAs(h.app, 'developer');
    const res = await api()
      .post('/api/v1/worklogs')
      .set(outsider.auth)
      .send({ date: today, projectId: project._id.toString(), description: 'Sneaky', minutes: 30 });
    expect(res.status).toBe(403);

    await api().post('/api/v1/worklogs').set(dev.auth).send({
      date: today,
      projectId: project._id.toString(),
      description: 'Real work',
      minutes: 45,
    });
    expect(
      (await api().get(`/api/v1/worklogs?userId=${dev.user._id}`).set(outsider.auth)).status,
    ).toBe(404);
    const asLead = await api().get(`/api/v1/worklogs?userId=${dev.user._id}`).set(lead.auth);
    expect(asLead.body.meta.totalMinutes).toBe(45);
  });
});

describe('timer', () => {
  it('runs one timer at a time, pauses and resumes, and stopping creates a work log', async () => {
    const { dev, project, task } = await setup();
    const start = await api()
      .post('/api/v1/timer/start')
      .set(dev.auth)
      .send({ projectId: project._id.toString(), taskId: task._id.toString() });
    expect(start.status).toBe(201);
    expect(start.body.data.running).toBe(true);
    expect(
      (
        await api()
          .post('/api/v1/timer/start')
          .set(dev.auth)
          .send({ projectId: project._id.toString() })
      ).status,
    ).toBe(409);

    expect((await api().post('/api/v1/timer/pause').set(dev.auth)).body.data.running).toBe(false);
    expect((await api().post('/api/v1/timer/resume').set(dev.auth)).body.data.running).toBe(true);

    const tooShort = await api()
      .post('/api/v1/timer/stop')
      .set(dev.auth)
      .send({ description: 'Quick look' });
    expect(tooShort.status).toBe(422);
    expect(await Timer.countDocuments()).toBe(1); // kept, not lost

    // Simulate 25 minutes of tracked time.
    await Timer.updateOne({}, { $set: { accumulatedMs: 25 * 60_000, runningSince: null } });
    const noDesc = await api().post('/api/v1/timer/stop').set(dev.auth).send({});
    expect(noDesc.status).toBe(422);
    const stop = await api()
      .post('/api/v1/timer/stop')
      .set(dev.auth)
      .send({ description: 'Implemented pagination' });
    expect(stop.body.data.worklog).toMatchObject({
      minutes: 25,
      source: 'timer',
      task: { key: 'WRK-1' },
    });
    expect(await Timer.countDocuments()).toBe(0);
    expect((await api().get('/api/v1/timer').set(dev.auth)).body.data).toBeNull();
  });
});

describe('timesheets', () => {
  it('submit locks the week; the manager approves; self-approval is impossible; rejection unlocks', async () => {
    const { dev, lead, project } = await setup();
    const log = await api().post('/api/v1/worklogs').set(dev.auth).send({
      date: lastWeekDay,
      projectId: project._id.toString(),
      description: 'Testing',
      minutes: 120,
    });
    const week = weekStartIso(lastWeekDay);
    const submitted = await api()
      .post('/api/v1/timesheets/submit')
      .set(dev.auth)
      .send({ weekStart: week });
    expect(submitted.body.data).toMatchObject({ status: 'submitted', totalMinutes: 120 });

    expect(
      (
        await api()
          .patch(`/api/v1/worklogs/${log.body.data.id}`)
          .set(dev.auth)
          .send({ minutes: 60 })
      ).status,
    ).toBe(422);
    expect(
      (
        await api().post('/api/v1/worklogs').set(dev.auth).send({
          date: lastWeekDay,
          projectId: project._id.toString(),
          description: 'Late add',
          minutes: 10,
        })
      ).status,
    ).toBe(422);

    const queue = await api().get('/api/v1/timesheets?scope=approvals').set(lead.auth);
    expect(queue.body.data).toHaveLength(1);
    expect(queue.body.data[0].canApprove).toBe(true);

    const rejected = await api()
      .post(`/api/v1/timesheets/${submitted.body.data.id}/reject`)
      .set(lead.auth)
      .send({ comment: 'Split the testing entry by task' });
    expect(rejected.body.data.status).toBe('rejected');
    expect(
      (
        await api()
          .patch(`/api/v1/worklogs/${log.body.data.id}`)
          .set(dev.auth)
          .send({ minutes: 60 })
      ).status,
    ).toBe(200);
    await api().post('/api/v1/timesheets/submit').set(dev.auth).send({ weekStart: week });
    const approved = await api()
      .post(`/api/v1/timesheets/${submitted.body.data.id}/approve`)
      .set(lead.auth)
      .send({});
    expect(approved.body.data).toMatchObject({
      status: 'approved',
      totalMinutes: 60,
      decidedBy: { id: lead.user._id.toString() },
    });

    // A lead cannot approve their own sheet.
    await api().post('/api/v1/worklogs').set(lead.auth).send({
      date: lastWeekDay,
      projectId: project._id.toString(),
      description: 'Planning',
      minutes: 60,
    });
    const own = await api()
      .post('/api/v1/timesheets/submit')
      .set(lead.auth)
      .send({ weekStart: week });
    expect(
      (await api().post(`/api/v1/timesheets/${own.body.data.id}/approve`).set(lead.auth).send({}))
        .status,
    ).toBe(403);
  });

  it('cannot submit an empty week; reminders go to people who have not submitted', async () => {
    const { dev, project } = await setup();
    expect(
      (await api().post('/api/v1/timesheets/submit').set(dev.auth).send({ weekStart: thisWeek }))
        .status,
    ).toBe(422);
    await api().post('/api/v1/worklogs').set(dev.auth).send({
      date: lastWeekDay,
      projectId: project._id.toString(),
      description: 'Work',
      minutes: 60,
    });
    await api()
      .post('/api/v1/timesheets/submit')
      .set(dev.auth)
      .send({ weekStart: weekStartIso(lastWeekDay) });
    const sent = await sendTimesheetReminders(weekStartIso(lastWeekDay));
    expect(sent).toBe(1); // only the lead
    expect(h.emails.at(-1)?.subject).toMatch(/Timesheet reminder/);
  });
});

describe('journal, leave and team workload', () => {
  it('journal entries are upserted per day and cannot be future-dated', async () => {
    const { dev } = await setup();
    const first = await api()
      .put('/api/v1/journals')
      .set(dev.auth)
      .send({ date: today, completed: 'Login API', tomorrow: 'Tests' });
    const second = await api()
      .put('/api/v1/journals')
      .set(dev.auth)
      .send({ date: today, completed: 'Login API + docs', blockers: 'Waiting for QA env' });
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.blockers).toBe('Waiting for QA env');
    expect(
      (
        await api()
          .put('/api/v1/journals')
          .set(dev.auth)
          .send({ date: addDaysIso(today, 1), completed: 'x' })
      ).status,
    ).toBe(422);
    expect((await api().get('/api/v1/journals').set(dev.auth)).body.meta.total).toBe(1);
  });

  it('leave is approved by the manager and immediately reduces capacity', async () => {
    const { dev, lead } = await setup();
    const req = await api()
      .post('/api/v1/availability')
      .set(dev.auth)
      .send({ type: 'leave', from: today, to: addDaysIso(today, 60), reason: 'Family event' });
    expect(req.body.data.status).toBe('pending');
    expect(
      (await api().post('/api/v1/availability').set(dev.auth).send({ from: today, to: today }))
        .status,
    ).toBe(409);
    expect(
      (await api().post(`/api/v1/availability/${req.body.data.id}/approve`).set(dev.auth)).status,
    ).toBe(403);
    const ok = await api().post(`/api/v1/availability/${req.body.data.id}/approve`).set(lead.auth);
    expect(ok.body.data.status).toBe('approved');

    const workload = await api().get('/api/v1/teams/workload').set(lead.auth);
    const row = workload.body.data.find(
      (r: { user: { id: string } }) => r.user.id === dev.user._id.toString(),
    );
    expect(row).toMatchObject({ state: 'unavailable', capacityHours: 0, openTasks: 1 });
  });

  it('team workload reports capacity, load and utilisation', async () => {
    const { lead, dev } = await setup();
    await User.updateOne({ _id: dev.user._id }, { $set: { weeklyCapacityHours: 10 } }); // 20 h over 10 working days
    const res = await api().get('/api/v1/teams/workload').set(lead.auth);
    const row = res.body.data.find(
      (r: { user: { id: string } }) => r.user.id === dev.user._id.toString(),
    );
    expect(row).toMatchObject({
      capacityHours: 20,
      loadHours: 10,
      utilization: 50,
      state: 'underutilized',
    });
  });

  it('the work passport is visible to the person and their manager only', async () => {
    const { dev, lead, project, task } = await setup();
    await api().post('/api/v1/worklogs').set(dev.auth).send({
      date: today,
      projectId: project._id.toString(),
      taskId: task._id.toString(),
      description: 'Work',
      minutes: 90,
      category: 'testing',
    });
    await Task.updateOne({ _id: task._id }, { $set: { status: 'done', completedAt: new Date() } });
    const mine = await api().get(`/api/v1/users/${dev.user._id}/passport`).set(dev.auth);
    expect(mine.body.data.totals).toEqual({ loggedHours: 1.5, tasksCompleted: 1, projects: 1 });
    expect(mine.body.data.hoursByCategory).toEqual([{ category: 'testing', hours: 1.5 }]);
    expect((await api().get(`/api/v1/users/${dev.user._id}/passport`).set(lead.auth)).status).toBe(
      200,
    );
    const peer = await loginAs(h.app, 'developer');
    expect((await api().get(`/api/v1/users/${dev.user._id}/passport`).set(peer.auth)).status).toBe(
      404,
    );
  });
});
