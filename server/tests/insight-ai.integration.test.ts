import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { AskPlan } from '@arihant/shared';
import { eventBus } from '../src/core/events';
import { addDaysIso, orgDateTime, orgToday } from '../src/core/time';
import { setAiProvider, type AiProvider, type AiRequest } from '../src/modules/ai/ai.provider';
import { runScheduledRules, scheduleSlot } from '../src/modules/automations/automation.engine';
import { AutomationRun } from '../src/modules/automations/automation.model';
import { forecastProject } from '../src/modules/insights/forecast.service';
import { Notification } from '../src/modules/notifications/notification.model';
import { Task } from '../src/modules/tasks/task.model';
import { Worklog } from '../src/modules/tracking/tracking.models';
import { createDepartment, loginAs, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);
const today = orgToday();

let seq = 0;
async function setup() {
  seq += 1;
  const dept = await createDepartment(`IA${seq}`);
  const pm = await loginAs(h.app, 'project_manager', {
    departmentId: dept._id,
    name: `Asha Manager${seq}`,
  });
  const dev = await loginAs(h.app, 'developer', {
    departmentId: dept._id,
    name: `Ravi Kumar${seq}`,
    managerId: pm.user._id,
  });
  const res = await api()
    .post('/api/v1/projects')
    .set(pm.auth)
    .send({
      key: `IA${seq}`,
      name: 'Insight Project',
      managerId: pm.user._id.toString(),
      memberIds: [dev.user._id.toString()],
      departmentId: dept._id.toString(),
      startDate: addDaysIso(today, -40),
      endDate: addDaysIso(today, 20),
    });
  expect(res.status).toBe(201);
  return { dept, pm, dev, project: res.body.data as { id: string; key: string } };
}
let n = 0;
const mkTask = (projectId: string, over: Record<string, unknown>) => {
  n += 1;
  // Test fixture: loosely typed overrides on top of a valid task.
  return Task.create({
    key: `X-${n}`,
    projectId,
    title: `Task ${n}`,
    reporterId: over.reporterId,
    rank: `r${n}`,
    ...over,
  } as Record<string, unknown>);
};

describe('scheduled automations', () => {
  it('runs at the scheduled hour for each matching open task, once per slot', async () => {
    const { pm, dev, project } = await setup();
    const now = new Date();
    const { hour, weekday } = scheduleSlot(now);
    const rule = await api()
      .post('/api/v1/automations')
      .set(pm.auth)
      .send({
        name: 'Daily nudge',
        projectId: project.id,
        trigger: 'schedule',
        schedule: { frequency: 'weekly', weekday, hour },
        conditions: {
          match: 'all',
          conditions: [{ field: 'task.daysUntilDue', op: 'lte', value: 2 }],
        },
        actions: [{ type: 'notify', to: ['assignee'], message: 'Due within two days' }],
      });
    expect(rule.status).toBe(201);
    expect(rule.body.data.schedule).toEqual({ frequency: 'weekly', weekday, hour });
    expect(
      (
        await api()
          .post('/api/v1/automations')
          .set(pm.auth)
          .send({
            ...rule.body.data,
            id: undefined,
            trigger: 'schedule',
            schedule: null,
            projectId: project.id,
          })
      ).status,
    ).toBe(400);

    const base = { reporterId: pm.user._id, assigneeId: dev.user._id };
    await mkTask(project.id, { ...base, dueDate: addDaysIso(today, 1) });
    await mkTask(project.id, { ...base, dueDate: addDaysIso(today, -3) });
    await mkTask(project.id, { ...base, dueDate: addDaysIso(today, 9) });
    await mkTask(project.id, { ...base, dueDate: today, status: 'done' });

    expect(await runScheduledRules(now)).toEqual({ rules: 1, runs: 2 });
    expect(await runScheduledRules(now)).toEqual({ rules: 0, runs: 0 }); // slot already claimed
    expect(await Notification.countDocuments({ userId: dev.user._id, type: 'automation' })).toBe(2);
    // A different hour does not fire this rule.
    expect((await runScheduledRules(new Date(now.getTime() + 3600_000))).rules).toBe(0);
    expect(
      await AutomationRun.countDocuments({ ruleId: rule.body.data.id, status: 'success' }),
    ).toBe(2);
  });
});

describe('delivery forecast', () => {
  const proj = (endDate?: string) => ({
    _id: { toString: () => 'p' } as never,
    key: 'F',
    name: 'F',
    endDate,
    status: 'in_progress' as const,
  });
  const done = (daysAgo: number, hours: number) => ({
    _id: { toString: () => `d${daysAgo}${hours}` } as never,
    key: 'F-d',
    title: 'done',
    status: 'done' as const,
    estimatedHours: hours,
    completedAt: orgDateTime(addDaysIso('2026-11-06', -daysAgo), '12:00'),
    dueDate: null,
    assigneeId: null,
    parentId: null,
  });
  const open = (hours: number, over: Record<string, unknown> = {}) => ({
    _id: { toString: () => `o${hours}` } as never,
    key: 'F-o',
    title: 'open',
    status: 'todo' as const,
    estimatedHours: hours,
    completedAt: null,
    dueDate: null,
    assigneeId: null,
    parentId: null,
    ...over,
  });

  it('projects completion from the last four weeks of completed effort', () => {
    // 10 h completed in each of the last four weeks; 30 h remain → about 3 weeks.
    const history = [1, 8, 15, 22].map((d) => done(d, 10));
    const f = forecastProject(proj('2026-12-31'), [...history, open(20), open(10)], '2026-11-06');
    expect(f).toMatchObject({
      hoursPerWeek: 10,
      remainingHours: 30,
      remainingTasks: 2,
      forecastDate: '2026-11-27',
      label: 'on_track',
      slipDays: -34,
    });
    expect(f.range).toEqual({ optimistic: '2026-11-27', pessimistic: '2026-11-27' });
    const late = forecastProject(
      proj('2026-11-10'),
      [...history, open(20), open(10)],
      '2026-11-06',
    );
    expect(late).toMatchObject({ label: 'likely_late', slipDays: 17 });
    expect(late.explanation).toMatch(/17 day\(s\) after the end date/);
  });

  it('says when there is no pace to project from, and flags tasks at risk', () => {
    const f = forecastProject(
      proj('2026-12-31'),
      [
        open(5, { dueDate: '2026-11-05' }),
        open(3, { dueDate: '2026-11-08', status: 'in_progress', assigneeId: 'x' }),
      ],
      '2026-11-06',
    );
    expect(f).toMatchObject({ label: 'insufficient_data', forecastDate: null });
    expect(f.tasksAtRisk).toEqual([
      expect.objectContaining({
        dueDate: '2026-11-05',
        reason: 'already overdue, no assignee, not started',
      }),
    ]);
  });

  it('is served per project in scope', async () => {
    const { pm, dev, project } = await setup();
    await mkTask(project.id, {
      reporterId: pm.user._id,
      status: 'done',
      completedAt: new Date(Date.now() - 2 * 86_400_000),
      estimatedHours: 8,
    });
    await mkTask(project.id, { reporterId: pm.user._id, estimatedHours: 8 });
    const r = await api().get(`/api/v1/analytics/forecast?projectId=${project.id}`).set(pm.auth);
    expect(r.status).toBe(200);
    expect(r.body.data[0]).toMatchObject({
      project: { key: project.key },
      remainingHours: 8,
      hoursPerWeek: 2,
    });
    const other = await setup();
    expect(
      (await api().get(`/api/v1/analytics/forecast?projectId=${project.id}`).set(other.pm.auth))
        .status,
    ).toBe(404);
    void dev;
  });
});

describe('duplicate detection', () => {
  it('finds similar task titles in the project, ignoring cancelled and the task itself', async () => {
    const { pm, project } = await setup();
    const login = await api()
      .post('/api/v1/tasks')
      .set(pm.auth)
      .send({ projectId: project.id, title: 'Fix login bug on Safari' });
    await api()
      .post('/api/v1/tasks')
      .set(pm.auth)
      .send({ projectId: project.id, title: 'Quarterly audit report' });
    const cancelled = await api()
      .post('/api/v1/tasks')
      .set(pm.auth)
      .send({ projectId: project.id, title: 'Fix the login bugs in Safari' });
    await Task.updateOne({ _id: cancelled.body.data.id }, { $set: { status: 'cancelled' } });

    const r = await api()
      .get(`/api/v1/projects/${project.id}/similar-tasks`)
      .query({ title: 'Login bug fix for safari' })
      .set(pm.auth);
    expect(r.status).toBe(200);
    expect(r.body.data.map((t: { id: string }) => t.id)).toEqual([login.body.data.id]);
    expect(r.body.data[0].score).toBeGreaterThanOrEqual(0.45);
    const self = await api()
      .get(`/api/v1/projects/${project.id}/similar-tasks`)
      .query({ title: 'Fix login bug on Safari', excludeId: login.body.data.id })
      .set(pm.auth);
    expect(self.body.data).toEqual([]);
  });
});

/* ============================ AI with a stand-in provider ============================ */

class FakeProvider implements AiProvider {
  readonly name = 'fake';
  calls: AiRequest<unknown>[] = [];
  constructor(private readonly reply: (req: AiRequest<unknown>) => unknown) {}
  configured() {
    return true;
  }
  async generate<T>(req: AiRequest<T>) {
    this.calls.push(req as AiRequest<unknown>);
    return {
      data: (req.schema as z.ZodType<T>).parse(this.reply(req as AiRequest<unknown>)),
      model: 'fake-model',
      inputTokens: 1,
      outputTokens: 1,
    };
  }
}
afterEach(() => setAiProvider(null));

const plan = (over: Partial<AskPlan>): AskPlan => ({
  intent: 'tasks',
  groupBy: 'none',
  projectKeys: [],
  statuses: [],
  priorities: [],
  assignee: 'any',
  assigneeName: null,
  overdueOnly: false,
  dueWithinDays: null,
  from: null,
  to: null,
  severities: [],
  healthBand: 'any',
  explanation: 'Plan',
  unsupportedReason: null,
  ...over,
});

async function enableAi() {
  const admin = await loginAs(h.app, 'super_admin');
  await api()
    .put('/api/v1/ai/settings')
    .set(admin.auth)
    .send({ enabled: true, dailyLimitPerUser: 50 });
}

describe('Ask Your Data', () => {
  it('runs the model’s plan through the caller’s own scope and never sends records to the model', async () => {
    const { pm, dev, project } = await setup();
    const other = await setup();
    await enableAi();
    const base = { reporterId: pm.user._id };
    await mkTask(project.id, {
      ...base,
      assigneeId: dev.user._id,
      priority: 'critical',
      dueDate: addDaysIso(today, -2),
      title: 'Secret overdue item',
    });
    await mkTask(project.id, {
      ...base,
      assigneeId: dev.user._id,
      priority: 'low',
      dueDate: addDaysIso(today, 5),
    });
    await mkTask(project.id, { ...base, priority: 'critical' });
    await mkTask(other.project.id, {
      reporterId: other.pm.user._id,
      priority: 'critical',
      dueDate: addDaysIso(today, -2),
    });

    let next = plan({ overdueOnly: true });
    const fake = new FakeProvider(() => next);
    setAiProvider(fake);
    const r = await api()
      .post('/api/v1/ai/ask')
      .set(pm.auth)
      .send({ question: 'Which tasks are overdue?' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      answer: '1 task(s).',
      columns: ['Task', 'Title', 'Status', 'Priority', 'Assignee', 'Due'],
    });
    expect(r.body.data.rows[0]).toEqual(
      expect.arrayContaining(['Secret overdue item', `Ravi Kumar${seq - 1}`]),
    );
    // The model sees project keys/names and the question, not task data or people.
    const prompt = fake.calls[0]!.prompt;
    expect(prompt).toContain(`${project.key}: Insight Project`);
    expect(prompt).not.toContain(other.project.key);
    expect(prompt).not.toContain('Secret overdue item');

    next = plan({ priorities: ['critical'], groupBy: 'assignee' });
    const g = await api()
      .post('/api/v1/ai/ask')
      .set(pm.auth)
      .send({ question: 'Critical tasks by person' });
    expect(g.body.data.chart).toEqual({ labelColumn: 0, valueColumn: 1 });
    expect(g.body.data.rows).toEqual(
      expect.arrayContaining([
        [`Ravi Kumar${seq - 1}`, 1],
        ['Unassigned', 1],
      ]),
    );
    expect(g.body.data.interpretation).toMatch(/Tasks · priority Critical · grouped by assignee/);

    next = plan({ assignee: 'named', assigneeName: 'ravi' });
    const named = await api()
      .post('/api/v1/ai/ask')
      .set(pm.auth)
      .send({ question: 'What is Ravi working on?' });
    expect(named.body.data.rows).toHaveLength(2);
    next = plan({ assignee: 'named', assigneeName: 'Nobody Here' });
    const none = await api()
      .post('/api/v1/ai/ask')
      .set(pm.auth)
      .send({ question: 'What is Nobody doing?' });
    expect(none.body.data.notes[0]).toMatch(/Nobody called "Nobody Here"/);

    // A key the caller cannot see behaves like an unknown key.
    next = plan({ projectKeys: [other.project.key] });
    const hidden = await api()
      .post('/api/v1/ai/ask')
      .set(pm.auth)
      .send({ question: 'Tasks in the other project' });
    expect(hidden.body.data).toMatchObject({ rows: [], answer: 'No matching records.' });
    expect(hidden.body.data.notes[0]).toMatch(/Not found among your projects/);

    next = plan({
      intent: 'unsupported',
      unsupportedReason: 'I can only read data, not delete it.',
    });
    const del = await api()
      .post('/api/v1/ai/ask')
      .set(pm.auth)
      .send({ question: 'Delete all overdue tasks' });
    expect(del.body.data).toMatchObject({
      answer: 'I can only read data, not delete it.',
      rows: [],
    });
    expect(await Task.countDocuments({ projectId: project.id })).toBe(3);
  });

  it('answers hours and risk questions with the existing analytics rules', async () => {
    const { pm, dev, project } = await setup();
    await enableAi();
    await Worklog.create({
      userId: dev.user._id,
      projectId: project.id,
      date: today,
      description: 'Work',
      minutes: 90,
      category: 'development',
    });
    await api()
      .post('/api/v1/risks')
      .set(pm.auth)
      .send({ projectId: project.id, title: 'Vendor delay', probability: 5, impact: 4 });
    let next = plan({ intent: 'hours', groupBy: 'category' });
    setAiProvider(new FakeProvider(() => next));
    const hrs = await api()
      .post('/api/v1/ai/ask')
      .set(pm.auth)
      .send({ question: 'Hours by category this month' });
    expect(hrs.body.data).toMatchObject({
      answer: '1.5 hours logged in total.',
      rows: [['Development', 1.5, 1]],
    });
    next = plan({ intent: 'risks', groupBy: 'severity' });
    const rk = await api()
      .post('/api/v1/ai/ask')
      .set(pm.auth)
      .send({ question: 'Open risks by severity' });
    expect(rk.body.data.rows).toEqual([['critical', 1]]);
  });
});

describe('AI risk scan', () => {
  it('proposes new risks from project signals with scores clamped to 1–5', async () => {
    const { pm, project } = await setup();
    await enableAi();
    await mkTask(project.id, {
      reporterId: pm.user._id,
      status: 'blocked',
      title: 'Payment gateway integration',
    });
    await api()
      .post('/api/v1/risks')
      .set(pm.auth)
      .send({ projectId: project.id, title: 'Existing vendor risk', probability: 2, impact: 2 });
    const fake = new FakeProvider(() => ({
      risks: [
        {
          title: 'Gateway delay',
          type: 'issue',
          probability: 9,
          impact: 0,
          rationale: 'X-1 is blocked',
          mitigation: 'Escalate',
        },
      ],
    }));
    setAiProvider(fake);
    const r = await api().post('/api/v1/ai/risk-scan').set(pm.auth).send({ projectId: project.id });
    expect(r.status).toBe(200);
    expect(r.body.data.proposal.risks[0]).toMatchObject({ probability: 5, impact: 1 });
    expect(fake.calls[0]!.prompt).toContain('Payment gateway integration');
    expect(fake.calls[0]!.prompt).toContain('Existing vendor risk');
    await eventBus.settle();
  });
});
