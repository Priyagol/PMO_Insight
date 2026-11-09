import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { addDaysIso, orgToday } from '../src/core/time';
import { personaFor } from '../src/modules/insights/role-dashboard.service';
import { Task } from '../src/modules/tasks/task.model';
import { TaskTransition } from '../src/modules/workflows/workflow.models';
import { createDepartment, loginAs, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);
const today = orgToday();

type Dash = {
  persona: string;
  kpis: { label: string; value: string }[];
  attention: { text: string }[];
  lists: { title: string; rows: { cells: string[] }[] }[];
};
const dash = async (auth: Record<string, string>) => {
  const res = await api().get('/api/v1/analytics/my-dashboard').set(auth);
  expect(res.status).toBe(200);
  return res.body.data as Dash;
};
const kpi = (d: Dash, label: string) => d.kpis.find((k) => k.label === label)?.value;

let seq = 0;
async function setup() {
  seq += 1;
  const dept = await createDepartment(`RD${seq}`);
  const pm = await loginAs(h.app, 'project_manager', { departmentId: dept._id });
  const lead = await loginAs(h.app, 'team_lead', { departmentId: dept._id });
  const dev = await loginAs(h.app, 'developer', {
    departmentId: dept._id,
    managerId: lead.user._id,
  });
  const qa = await loginAs(h.app, 'qa_tester', { departmentId: dept._id });
  const res = await api()
    .post('/api/v1/projects')
    .set(pm.auth)
    .send({
      key: `RD${seq}`,
      name: 'Role Dashboard',
      managerId: pm.user._id.toString(),
      memberIds: [dev.user._id.toString(), qa.user._id.toString(), lead.user._id.toString()],
      startDate: addDaysIso(today, -30),
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
  // One overdue task for the developer, one bug in testing.
  const late = await mk({
    assigneeId: dev.user._id,
    status: 'in_progress',
    dueDate: addDaysIso(today, -2),
  });
  const bug = await mk({
    assigneeId: dev.user._id,
    status: 'testing',
    type: 'bug',
    bug: { severity: 'critical', regression: true },
  });
  await TaskTransition.create({
    taskId: bug._id,
    projectId: project.id,
    from: 'in_progress',
    to: 'testing',
    via: 'user',
    actorId: dev.user._id,
    at: new Date(Date.now() - 4 * 86_400_000),
  });
  return { dept, pm, lead, dev, qa, project, late, bug };
}

describe('role dashboard', () => {
  it('picks the view from the most specific role', () => {
    const p = (roleKeys: string[], scope?: string) =>
      personaFor({ roleKeys, permissions: scope ? { 'analytics:view': scope } : {} } as never);
    expect(p(['managing_director'])).toBe('executive');
    expect(p(['cto'])).toBe('technology');
    expect(p(['developer', 'team_lead'])).toBe('team');
    expect(p(['qa_tester'])).toBe('quality');
    expect(p(['custom'], 'department')).toBe('department');
    expect(p(['custom'])).toBe('individual');
  });

  it('shows each role the figures and to-dos that matter to it', async () => {
    const { dept, pm, lead, dev, qa, project, late } = await setup();

    const mine = await dash(dev.auth);
    expect(mine.persona).toBe('individual');
    expect(kpi(mine, 'Overdue')).toBe('1');
    expect(mine.attention[0]!.text).toBe(`${late.key} was due ${addDaysIso(today, -2)}`);

    const testing = await dash(qa.auth);
    expect(testing.persona).toBe('quality');
    expect(kpi(testing, 'Waiting for testing')).toBe('1');
    expect(kpi(testing, 'Longest wait')).toBe('4 d');
    expect(testing.attention[0]!.text).toMatch(/has waited 4 days for testing/);

    const team = await dash(lead.auth);
    expect(team.persona).toBe('team');
    expect(team.attention.map((a) => a.text)).toContain(`${dev.user.name} has 1 overdue task`);
    expect(team.lists[0]!.rows.map((r) => r.cells[0])).toEqual([dev.user.name]);

    const pmView = await dash(pm.auth);
    expect(pmView.persona).toBe('project');
    expect(kpi(pmView, 'My projects')).toBe('1');
    expect(pmView.lists[0]!.rows[0]!.cells[0]).toBe(`${project.key} Role Dashboard`);

    const head = await loginAs(h.app, 'department_head', { departmentId: dept._id });
    const deptView = await dash(head.auth);
    expect(deptView.persona).toBe('department');
    expect(kpi(deptView, 'Overdue tasks')).toBe('1');

    const cto = await loginAs(h.app, 'cto');
    const tech = await dash(cto.auth);
    expect(tech.persona).toBe('technology');
    expect(kpi(tech, 'Open critical bugs')).toBe('1');
    expect(tech.lists.find((l) => l.title === 'Open bugs by severity')!.rows).toEqual([
      { cells: ['Critical', '1'] },
    ]);

    const md = await loginAs(h.app, 'managing_director');
    const exec = await dash(md.auth);
    expect(exec.persona).toBe('executive');
    expect(Number(kpi(exec, 'Active projects'))).toBeGreaterThanOrEqual(1);
    expect(exec.lists[0]!.title).toBe('Departments (last 30 days)');
  });

  it('is closed to external stakeholders', async () => {
    const ext = await loginAs(h.app, 'external_stakeholder');
    expect((await api().get('/api/v1/analytics/my-dashboard').set(ext.auth)).status).toBe(403);
  });
});
