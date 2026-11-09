import { Types } from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { addDaysIso, orgToday, startOfOrgDay } from '../src/core/time';
import { Task } from '../src/modules/tasks/task.model';
import { performancePeriod } from '../src/modules/tracking/performance.service';
import { Worklog } from '../src/modules/tracking/tracking.models';
import { TaskTransition } from '../src/modules/workflows/workflow.models';
import { AuditLog } from '../src/modules/audit/audit-log.model';
import { createDepartment, createUser, loginAs, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);
const today = orgToday();
const at = (day: string) => new Date(startOfOrgDay(day).getTime() + 10 * 3600_000);

describe('fiscal periods', () => {
  it('quarters and years follow April to March', () => {
    expect(performancePeriod('quarter', '2026-11-09')).toEqual({
      from: '2026-10-01',
      to: '2026-11-09',
    });
    expect(performancePeriod('quarter', '2026-02-15')).toEqual({
      from: '2026-01-01',
      to: '2026-02-15',
    });
    expect(performancePeriod('year', '2026-02-15')).toEqual({
      from: '2025-04-01',
      to: '2026-02-15',
    });
    expect(performancePeriod('year', '2026-04-01')).toEqual({
      from: '2026-04-01',
      to: '2026-04-01',
    });
    expect(performancePeriod('30d', '2026-11-09')).toEqual({
      from: '2026-10-11',
      to: '2026-11-09',
    });
  });
});

describe('team performance', () => {
  it('counts assigned, completed, overdue, on-time and rework per person in the lead’s team', async () => {
    const lead = await loginAs(h.app, 'team_lead');
    const dev = await createUser({ role: 'developer', managerId: lead.user._id });
    const outsider = await createUser({ role: 'developer' });
    const projectId = new Types.ObjectId();
    let n = 0;
    const mk = (over: Record<string, unknown>) =>
      Task.create({
        key: `PF-${++n}`,
        projectId,
        title: `Task ${n}`,
        reporterId: lead.user._id,
        assigneeId: dev._id,
        rank: 'm',
        ...over,
      });
    // Done on time, done late, one overdue, one open, one cancelled (ignored).
    const onTime = await mk({
      status: 'done',
      dueDate: addDaysIso(today, -3),
      completedAt: at(addDaysIso(today, -4)),
      estimatedHours: 4,
      actualHours: 5,
    });
    await mk({
      status: 'done',
      dueDate: addDaysIso(today, -10),
      completedAt: at(addDaysIso(today, -6)),
      estimatedHours: 2,
      actualHours: 2,
    });
    await mk({ status: 'in_progress', dueDate: addDaysIso(today, -1) });
    await mk({ status: 'todo' });
    await mk({ status: 'cancelled' });
    await mk({ status: 'todo', assigneeId: outsider._id });
    // Sent back from testing once and from review once; a forward move does not count.
    const base = {
      taskId: onTime._id,
      projectId,
      via: 'user' as const,
      at: at(addDaysIso(today, -5)),
    };
    await TaskTransition.create([
      { ...base, from: 'testing' as const, to: 'in_progress' as const },
      { ...base, from: 'in_review' as const, to: 'todo' as const },
      { ...base, from: 'in_progress' as const, to: 'testing' as const },
    ]);
    await Worklog.create({
      userId: dev._id,
      projectId,
      taskId: onTime._id,
      date: addDaysIso(today, -4),
      minutes: 90,
      description: 'Fix',
      category: 'development',
      source: 'manual',
    });

    const res = await api().get('/api/v1/teams/performance?period=30d').set(lead.auth);
    expect(res.status).toBe(200);
    const rows = res.body.data.rows as { user: { id: string } }[];
    expect(rows.map((r) => r.user.id)).not.toContain(outsider._id.toString());
    const row = rows.find((r) => r.user.id === dev._id.toString());
    expect(row).toMatchObject({
      assigned: 4,
      pending: 2,
      overdue: 1,
      completed: 2,
      completedWithDueDate: 2,
      completedOnTime: 1,
      onTimeRate: 50,
      reworked: 2,
      qaRejections: 1,
      estimatedHours: 6,
      actualHours: 7,
      loggedHours: 1.5,
    });
    expect(res.body.data.totals.completed).toBe(2);
  });

  it('is closed to people without team access and rejects unknown periods', async () => {
    const lead = await loginAs(h.app, 'team_lead');
    const emp = await loginAs(h.app, 'employee');
    expect((await api().get('/api/v1/teams/performance').set(emp.auth)).status).toBe(403);
    expect((await api().get('/api/v1/teams/performance?period=week').set(lead.auth)).status).toBe(
      400,
    );
  });
});

describe('named teams', () => {
  it('lets admins and department heads manage teams, and adds up figures per team', async () => {
    const dept = await createDepartment('TMS');
    const other = await createDepartment('TMO');
    const admin = await loginAs(h.app, 'super_admin');
    const head = await loginAs(h.app, 'department_head', { departmentId: dept._id });
    const lead = await loginAs(h.app, 'team_lead', { departmentId: dept._id });
    const a = await createUser({ role: 'developer', departmentId: dept._id });
    const b = await createUser({ role: 'qa_tester', departmentId: dept._id });
    const gone = await createUser({ role: 'developer', status: 'inactive' });

    // Department head: own department only, active people only.
    const wrongDept = await api()
      .post('/api/v1/teams')
      .set(head.auth)
      .send({ name: 'Elsewhere', departmentId: other._id.toString() });
    expect(wrongDept.status).toBe(403);
    const inactive = await api()
      .post('/api/v1/teams')
      .set(head.auth)
      .send({ name: 'Squad', departmentId: dept._id.toString(), memberIds: [gone._id.toString()] });
    expect(inactive.status).toBe(422);
    const created = await api()
      .post('/api/v1/teams')
      .set(head.auth)
      .send({
        name: 'Mobile squad',
        departmentId: dept._id.toString(),
        leadId: lead.user._id.toString(),
        memberIds: [a._id.toString(), b._id.toString()],
      });
    expect(created.status).toBe(201);
    const team = created.body.data as { id: string; members: { id: string }[] };
    // The lead is a member too.
    expect(team.members).toHaveLength(3);
    const dup = await api().post('/api/v1/teams').set(admin.auth).send({ name: 'Mobile squad' });
    expect(dup.status).toBe(422);

    // A team lead may edit their own team but not create teams.
    expect((await api().post('/api/v1/teams').set(lead.auth).send({ name: 'My own' })).status).toBe(
      403,
    );
    const renamed = await api()
      .patch(`/api/v1/teams/${team.id}`)
      .set(lead.auth)
      .send({ name: 'Mobile & web squad' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toMatchObject({ name: 'Mobile & web squad', canEdit: true });
    // ...but cannot move it to another department.
    expect(
      (
        await api()
          .patch(`/api/v1/teams/${team.id}`)
          .set(lead.auth)
          .send({ departmentId: other._id.toString() })
      ).status,
    ).toBe(403);

    // Team-wise totals and the team filter.
    const projectId = new Types.ObjectId();
    await Task.create([
      {
        key: 'TM-1',
        projectId,
        title: 'A',
        reporterId: admin.user._id,
        assigneeId: a._id,
        rank: 'a',
      },
      {
        key: 'TM-2',
        projectId,
        title: 'B',
        reporterId: admin.user._id,
        assigneeId: b._id,
        rank: 'b',
      },
    ]);
    const perf = await api().get('/api/v1/teams/performance').set(admin.auth);
    expect(perf.status).toBe(200);
    const squad = perf.body.data.teams.find((t: { team: { id: string } }) => t.team.id === team.id);
    expect(squad).toMatchObject({ members: 3, totals: { assigned: 2, pending: 2 } });
    const filtered = await api().get(`/api/v1/teams/performance?teamId=${team.id}`).set(admin.auth);
    expect(filtered.body.data.rows).toHaveLength(3);

    // Everyone with team access can list teams; archiving hides it.
    expect((await api().get('/api/v1/teams').set(lead.auth)).body.data).toHaveLength(1);
    expect((await api().delete(`/api/v1/teams/${team.id}`).set(head.auth)).status).toBe(204);
    expect((await api().get('/api/v1/teams').set(lead.auth)).body.data).toHaveLength(0);
    const audit = await AuditLog.find({ entityType: 'team' }).lean();
    expect(audit.map((x) => x.action).sort()).toEqual([
      'team.archived',
      'team.created',
      'team.updated',
    ]);
  });
});
