import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { addDaysIso, orgToday, startOfOrgDay, weekStartIso } from '../src/core/time';
import { Risk } from '../src/modules/risks/risk.model';
import { Task } from '../src/modules/tasks/task.model';
import { Journal, Worklog } from '../src/modules/tracking/tracking.models';
import { TaskTransition } from '../src/modules/workflows/workflow.models';
import { createDepartment, loginAs, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);
const today = orgToday();
const at = (day: string, hour = 10) => new Date(startOfOrgDay(day).getTime() + hour * 3600_000);

let seq = 0;
async function setup() {
  seq += 1;
  const dept = await createDepartment(`DG${seq}`);
  const head = await loginAs(h.app, 'department_head', { departmentId: dept._id });
  const pm = await loginAs(h.app, 'project_manager', { departmentId: dept._id });
  const dev = await loginAs(h.app, 'developer', { departmentId: dept._id });
  const dev2 = await loginAs(h.app, 'developer', { departmentId: dept._id });
  const res = await api()
    .post('/api/v1/projects')
    .set(pm.auth)
    .send({
      key: `DG${seq}`,
      name: 'Digest Project',
      managerId: pm.user._id.toString(),
      memberIds: [dev.user._id.toString(), dev2.user._id.toString()],
      startDate: addDaysIso(today, -60),
      endDate: addDaysIso(today, 30),
    });
  expect(res.status).toBe(201);
  const project = res.body.data as { id: string; key: string };
  let n = 0;
  const mk = (over: Record<string, unknown>) =>
    Task.create({
      key: `${project.key}-${++n}`,
      projectId: project.id,
      title: `Task ${n}`,
      reporterId: pm.user._id,
      rank: String(n),
      ...over,
    });
  return { dept, head, pm, dev, dev2, project, mk };
}

describe('summaries without AI', () => {
  it('summarises who did what in the period, with blockers and silent people', async () => {
    const { head, dev, dev2, project, mk } = await setup();
    const t1 = await mk({
      assigneeId: dev.user._id,
      status: 'done',
      completedAt: at(today, 9),
      dueDate: today,
    });
    await mk({ assigneeId: dev.user._id, status: 'in_progress', dueDate: addDaysIso(today, -2) });
    await TaskTransition.create({
      taskId: t1._id,
      projectId: project.id,
      from: 'in_progress',
      to: 'testing',
      via: 'user',
      actorId: dev.user._id,
      at: at(today, 8),
    });
    await Worklog.create({
      userId: dev.user._id,
      projectId: project.id,
      taskId: t1._id,
      date: today,
      minutes: 150,
      description: 'Build',
      category: 'development',
      source: 'manual',
    });
    await Journal.create({
      userId: dev2.user._id,
      date: today,
      completed: '',
      inProgress: 'Reports',
      blockers: 'Waiting for API keys from the vendor',
      tomorrow: '',
    });

    const res = await api()
      .get(`/api/v1/analytics/work-summary?from=${today}&to=${today}`)
      .set(head.auth);
    expect(res.status).toBe(200);
    const d = res.body.data;
    const one = d.people.find(
      (p: { user: { id: string } }) => p.user.id === dev.user._id.toString(),
    );
    expect(one).toMatchObject({
      loggedHours: 2.5,
      handedOver: 1,
      overdue: 1,
      noTimeLogged: false,
      completed: [{ key: t1.key }],
    });
    const two = d.people.find(
      (p: { user: { id: string } }) => p.user.id === dev2.user._id.toString(),
    );
    expect(two).toMatchObject({
      noTimeLogged: true,
      blockers: ['Waiting for API keys from the vendor'],
    });
    expect(d.highlights.join(' ')).toMatch(/1 task finished/);
    expect(d.highlights.join(' ')).toMatch(/Blockers reported in journals by/);

    // A developer sees only themselves.
    const own = await api().get('/api/v1/analytics/work-summary').set(dev.auth);
    expect(own.status).toBe(200);
    expect(own.body.data.people.map((p: { user: { id: string } }) => p.user.id)).toEqual([
      dev.user._id.toString(),
    ]);
  });

  it('colours projects red, amber or green and says why', async () => {
    const { pm, project, mk, dev } = await setup();
    await mk({ assigneeId: dev.user._id, status: 'todo', dueDate: addDaysIso(today, -3) });
    await mk({ assigneeId: dev.user._id, status: 'todo', dueDate: addDaysIso(today, 5) });
    await Risk.create({
      key: 'R-1',
      projectId: project.id,
      type: 'risk',
      title: 'Vendor may miss the date',
      severity: 'critical',
      probability: 4,
      impact: 5,
      score: 20,
      ownerId: pm.user._id,
      createdBy: pm.user._id,
    });
    const res = await api().get('/api/v1/analytics/project-status').set(pm.auth);
    expect(res.status).toBe(200);
    const row = res.body.data.projects.find(
      (p: { project: { id: string } }) => p.project.id === project.id,
    );
    expect(row.rag).toBe('red');
    expect(row.overdue).toBe(1);
    expect(row.openCriticalRisks).toBe(1);
    expect(row.notes.join(' ')).toMatch(/1 open task past due/);
    expect(row.notes.join(' ')).toMatch(/critical risk/);
  });

  it('shows weekly delivery trends and flags a falling pace', async () => {
    const { pm, dev, mk } = await setup();
    const thisWeek = weekStartIso(today);
    // Weeks 0–3 (older): 3 a week; weeks 4–7: 1 a week.
    for (let w = 0; w < 8; w++) {
      const monday = addDaysIso(thisWeek, (w - 8) * 7);
      for (let i = 0; i < (w < 4 ? 3 : 1); i++)
        await mk({
          assigneeId: dev.user._id,
          status: 'done',
          completedAt: at(addDaysIso(monday, 1)),
        });
    }
    const res = await api().get('/api/v1/analytics/trends').set(pm.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.weeks).toHaveLength(9);
    const row = res.body.data.people.find(
      (p: { user: { id: string } }) => p.user.id === dev.user._id.toString(),
    );
    expect(row.completedPerWeek.slice(0, 8)).toEqual([3, 3, 3, 3, 1, 1, 1, 1]);
    expect(row).toMatchObject({ previousAverage: 3, recentAverage: 1, direction: 'declining' });
  });

  it('finds where work waits, bounces back and gets stuck', async () => {
    const { pm, project, mk, dev } = await setup();
    const t = await mk({
      assigneeId: dev.user._id,
      status: 'blocked',
      blockedSince: new Date(Date.now() - 5 * 86_400_000),
      tags: ['vendor'],
    });
    await mk({
      assigneeId: dev.user._id,
      status: 'todo',
      dueDate: addDaysIso(today, -1),
      tags: ['vendor'],
    });
    const base = { taskId: t._id, projectId: project.id, via: 'user' as const, at: at(today, 9) };
    await TaskTransition.create([
      {
        ...base,
        from: 'in_review' as const,
        to: 'in_progress' as const,
        durationMs: 50 * 3600_000,
      },
      {
        ...base,
        from: 'in_review' as const,
        to: 'in_progress' as const,
        durationMs: 30 * 3600_000,
      },
      { ...base, from: 'in_review' as const, to: 'testing' as const, durationMs: 40 * 3600_000 },
      { ...base, from: 'todo' as const, to: 'in_progress' as const, durationMs: 2 * 3600_000 },
    ]);
    const res = await api().get('/api/v1/analytics/bottlenecks').set(pm.auth);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.statusWaits[0]).toEqual({ status: 'in_review', averageHours: 40, moves: 3 });
    expect(d.rework).toEqual([
      { project: expect.objectContaining({ key: project.key }), sentBack: 2 },
    ]);
    expect(d.longBlocked[0].tasks).toBe(1);
    expect(d.recurringTags).toEqual([{ tag: 'vendor', tasks: 2 }]);
    expect(d.findings[0]).toMatch(/In Review/);
  });

  it('e-mails the work summary on a schedule with a CSV of the detail', async () => {
    const { pm, dev, mk } = await setup();
    await mk({
      assigneeId: dev.user._id,
      status: 'done',
      completedAt: at(addDaysIso(today, -1)),
      title: '=HYPERLINK("x")',
    });
    const sub = await api()
      .post('/api/v1/reporting/subscriptions')
      .set(pm.auth)
      .send({
        name: 'Daily work summary',
        report: 'work_summary',
        format: 'csv',
        frequency: 'daily',
        recipientIds: [pm.user._id.toString()],
      });
    expect(sub.status).toBe(201);
    const wrongFormat = await api()
      .post('/api/v1/reporting/subscriptions')
      .set(pm.auth)
      .send({
        name: 'Bad',
        report: 'project_status',
        format: 'pdf',
        frequency: 'weekly',
        recipientIds: [pm.user._id.toString()],
      });
    expect(wrongFormat.status).toBe(400);
    h.emails.length = 0;
    const sent = await api()
      .post(`/api/v1/reporting/subscriptions/${sub.body.data.id}/send`)
      .set(pm.auth);
    expect(sent.body.data.lastResult).toBe('sent to 1');
    const mail = h.emails.at(-1)!;
    expect(mail.text).toMatch(/1 task finished/);
    const csv = Buffer.from(mail.attachments![0]!.contentBase64, 'base64').toString();
    expect(csv.split('\r\n')[0]).toMatch(/^Person,Hours logged,Tasks finished/);
    expect(csv).toContain(dev.user.name);
  });
});
