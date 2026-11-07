import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { addDaysIso, orgToday } from '../src/core/time';
import { AuditLog } from '../src/modules/audit/audit-log.model';
import { scoreHealth } from '../src/modules/insights/health.service';
import { csvCell } from '../src/modules/insights/report.service';
import { Project } from '../src/modules/projects/project.model';
import { Task } from '../src/modules/tasks/task.model';
import { Worklog } from '../src/modules/tracking/tracking.models';
import { createDepartment, loginAs, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);
const today = orgToday();

let n = 0;
async function setup() {
  const dept = await createDepartment('TECH');
  const director = await loginAs(h.app, 'director');
  const pm = await loginAs(h.app, 'project_manager', { departmentId: dept._id });
  const dev = await loginAs(h.app, 'developer', { departmentId: dept._id });
  const project = await Project.create({
    key: 'ANA',
    name: 'Analytics Project',
    managerId: pm.user._id,
    departmentId: dept._id,
    startDate: addDaysIso(today, -20),
    endDate: addDaysIso(today, 10),
    estimatedHours: 40,
    members: [
      { userId: pm.user._id, role: 'manager' },
      { userId: dev.user._id, role: 'member' },
    ],
  });
  const mk = (over: Record<string, unknown>) => {
    n += 1;
    return Task.create({
      key: `ANA-${n}`,
      projectId: project._id,
      title: `Task ${n}`,
      reporterId: pm.user._id,
      rank: `V${n}`,
      estimatedHours: 4,
      ...over,
    });
  };
  const done = await mk({
    status: 'done',
    completedAt: new Date(),
    dueDate: today,
    assigneeId: dev.user._id,
  });
  const overdue = await mk({
    status: 'in_progress',
    dueDate: addDaysIso(today, -3),
    assigneeId: dev.user._id,
  });
  const blocked = await mk({
    status: 'blocked',
    blockedSince: new Date(Date.now() - 4 * 86_400_000),
  });
  await mk({ status: 'todo', dueDate: addDaysIso(today, 3), priority: 'critical' });
  await Worklog.create({
    userId: dev.user._id,
    projectId: project._id,
    taskId: done._id,
    date: today,
    description: 'Work',
    minutes: 300,
    category: 'testing',
  });
  return { dept, director, pm, dev, project, done, overdue, blocked };
}

describe('health scoring', () => {
  const base = {
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    estimatedHours: 100,
    status: 'in_progress' as const,
  };
  const clean = { open: 10, overdue: 0, blockedLong: [], estimated: 100, actual: 50 };
  it('an on-track project scores high and is explained factor by factor', () => {
    const { score, factors } = scoreHealth(base, 50, clean, 0, '2026-01-16');
    expect(score).toBeGreaterThanOrEqual(95);
    expect(factors.map((f) => f.key)).toEqual([
      'schedule',
      'effort',
      'overdue',
      'risks',
      'blocked',
    ]);
    expect(factors.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(1);
  });
  it('past the end date with work left zeroes the schedule factor', () => {
    const { score, factors } = scoreHealth(base, 60, clean, 0, '2026-02-10');
    expect(factors[0]).toMatchObject({ value: 0 });
    expect(factors[0]!.detail).toMatch(/Past the end date/);
    expect(score).toBeLessThanOrEqual(60);
  });
  it('overdue work, serious risks, long blocks and effort overrun all pull the score down', () => {
    const bad = scoreHealth(
      base,
      20,
      { open: 10, overdue: 5, blockedLong: [{}, {}, {}] as never, estimated: 100, actual: 60 },
      3,
      '2026-01-25',
    );
    expect(bad.score).toBeLessThan(30);
  });
});

describe('risks & issues', () => {
  it('raises a risk with derived severity, escalates (audited) and resolves it', async () => {
    const { dev, pm, project } = await setup();
    const created = await api().post('/api/v1/risks').set(dev.auth).send({
      projectId: project._id.toString(),
      type: 'issue',
      title: 'Vendor API may slip',
      probability: 4,
      impact: 4,
      ownerId: pm.user._id.toString(),
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      key: 'ANA-R1',
      score: 16,
      severity: 'critical',
      status: 'open',
      owner: { id: pm.user._id.toString() },
    });

    const esc = await api()
      .post(`/api/v1/risks/${created.body.data.id}/escalate`)
      .set(pm.auth)
      .send({ note: 'No response from vendor' });
    expect(esc.body.data.escalationLevel).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'risk.escalated' })).toBe(1);

    const resolved = await api()
      .patch(`/api/v1/risks/${created.body.data.id}`)
      .set(pm.auth)
      .send({ status: 'resolved', note: 'Vendor delivered' });
    expect(resolved.body.data.status).toBe('resolved');
    // Fields not sent keep their values (partial PATCH never applies create defaults).
    expect(resolved.body.data).toMatchObject({ type: 'issue', probability: 4, impact: 4 });
    expect(resolved.body.data.history[0]).toMatchObject({
      action: 'status open → resolved',
      note: 'Vendor delivered',
    });
  });

  it('builds a 5×5 heatmap of active items and hides other projects', async () => {
    const { pm, project } = await setup();
    for (const [p, i] of [
      [5, 5],
      [5, 5],
      [2, 3],
    ]) {
      await api()
        .post('/api/v1/risks')
        .set(pm.auth)
        .send({
          projectId: project._id.toString(),
          title: `Risk ${p}${i}`,
          probability: p,
          impact: i,
        });
    }
    const map = await api().get('/api/v1/risks/heatmap').set(pm.auth);
    expect(map.body.data.total).toBe(3);
    expect(map.body.data.cells[4][4]).toBe(2);
    expect(map.body.data.cells[1][2]).toBe(1);
    const outsider = await loginAs(h.app, 'project_manager');
    expect((await api().get('/api/v1/risks/heatmap').set(outsider.auth)).body.data.total).toBe(0);
    expect(
      (
        await api()
          .post('/api/v1/risks')
          .set(outsider.auth)
          .send({ projectId: project._id.toString(), title: 'Sneaky', probability: 1, impact: 1 })
      ).status,
    ).toBe(404);
  });
});

describe('analytics', () => {
  it('overview reports real counts and scopes by role', async () => {
    const { director, dev, project } = await setup();
    const ov = await api().get('/api/v1/analytics/overview').set(director.auth);
    expect(ov.status).toBe(200);
    expect(ov.body.data).toMatchObject({
      scope: 'organisation',
      projects: { total: 1, active: 1 },
      tasks: { total: 4, open: 3, overdue: 1, blocked: 1, completedInPeriod: 1 },
      hours: { loggedInPeriod: 5 },
    });
    expect(ov.body.data.plannedVsActual[0]).toMatchObject({
      project: { key: 'ANA' },
      estimated: 40,
      actual: 5,
    });
    expect(ov.body.data.people.total).toBe(3);
    // Utilisation is a percentage (85.3 = 85.3%), not a ratio: the client shows it as is.
    const workload = ov.body.data.workload as {
      utilization: number;
      loadHours: number;
      capacityHours: number;
    }[];
    expect(workload.some((w) => w.loadHours > 0)).toBe(true);
    for (const w of workload)
      expect(w.utilization).toBeCloseTo((w.loadHours / w.capacityHours) * 100, 0);

    // Developers get a personal view: only their own tasks.
    const mine = await api().get('/api/v1/analytics/overview').set(dev.auth);
    expect(mine.body.data).toMatchObject({ scope: 'personal', tasks: { total: 2 }, people: null });

    const outsider = await loginAs(h.app, 'project_manager');
    expect(
      (await api().get('/api/v1/analytics/overview').set(outsider.auth)).body.data.projects.total,
    ).toBe(0);
    expect(
      (await api().get(`/api/v1/analytics/projects/${project._id}`).set(outsider.auth)).status,
    ).toBe(404);
  });

  it('project health lists warnings for overdue, blocked and approaching deadlines', async () => {
    const { pm } = await setup();
    const res = await api().get('/api/v1/analytics/health').set(pm.auth);
    const types = res.body.data[0].warnings.map((w: { type: string }) => w.type);
    expect(types).toEqual(expect.arrayContaining(['blocked_too_long', 'deadline_approaching']));
    expect(res.body.data[0].factors).toHaveLength(5);
  });

  it('project analytics: burndown, throughput, on-time rate and a daily snapshot', async () => {
    const { pm, project } = await setup();
    const res = await api().get(`/api/v1/analytics/projects/${project._id}`).set(pm.auth);
    expect(res.status).toBe(200);
    const last = res.body.data.burndown.at(-1);
    expect(last).toMatchObject({ date: today, remaining: 12 }); // 4 tasks × 4 h, one done
    expect(res.body.data.throughput.at(-1).completed).toBe(1);
    expect(res.body.data.onTime).toMatchObject({ completed: 1, onTime: 1 });
    expect(res.body.data.flow.at(-1)).toMatchObject({
      date: today,
      counts: { done: 1, blocked: 1 },
    });
  });

  it('hours can be grouped by category and by person', async () => {
    const { director } = await setup();
    const byCat = await api().get('/api/v1/analytics/hours?groupBy=category').set(director.auth);
    expect(byCat.body.data).toEqual([{ key: 'testing', label: 'Testing', hours: 5, entries: 1 }]);
    const byUser = await api().get('/api/v1/analytics/hours?groupBy=user').set(director.auth);
    expect(byUser.body.data[0].hours).toBe(5);
  });
});

describe('reports', () => {
  it('management snapshot as JSON, PDF and Excel (exports are audited)', async () => {
    const { director } = await setup();
    const json = await api().get('/api/v1/reports/snapshot').set(director.auth);
    expect(json.body.data.summary).toMatchObject({
      tasksCompleted: 1,
      tasksOverdue: 1,
      hoursLogged: 5,
    });
    expect(json.body.data.blockers.map((b: { source: string }) => b.source)).toContain(
      'Blocked task',
    );

    const pdf = await api()
      .get('/api/v1/reports/snapshot?format=pdf')
      .set(director.auth)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    const xlsx = await api()
      .get('/api/v1/reports/snapshot?format=xlsx')
      .set(director.auth)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    expect(await AuditLog.countDocuments({ action: /^export\.snapshot_/ })).toBe(2);
  });

  it('task CSV export neutralises spreadsheet formulas', async () => {
    const { pm, project } = await setup();
    await Task.create({
      key: 'ANA-X',
      projectId: project._id,
      title: '=HYPERLINK("http://evil")',
      reporterId: pm.user._id,
      rank: 'z',
    });
    const csv = await api().get('/api/v1/reports/tasks.csv').set(pm.auth);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('a,b')).toBe('"a,b"');
  });
});
