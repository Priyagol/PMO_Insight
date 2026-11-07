import request from 'supertest';
import type { TaskDto } from '@arihant/shared';
import { describe, expect, it } from 'vitest';
import { addDaysIso, orgToday } from '../src/core/time';
import { AuditLog } from '../src/modules/audit/audit-log.model';
import { Milestone, ProjectTemplate } from '../src/modules/planning/planning.models';
import { nextDueDate } from '../src/modules/planning/recurrence';
import { Project } from '../src/modules/projects/project.model';
import { Task } from '../src/modules/tasks/task.model';
import { createDepartment, loginAs, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);
const today = orgToday();

let seq = 0;
async function setup() {
  seq += 1;
  const dept = await createDepartment(`PL${seq}`);
  const pm = await loginAs(h.app, 'project_manager', { departmentId: dept._id });
  const dev = await loginAs(h.app, 'developer', { departmentId: dept._id });
  // Has project rights in general, but is not on this project.
  const outsider = await loginAs(h.app, 'project_manager', { departmentId: dept._id });
  const res = await api()
    .post('/api/v1/projects')
    .set(pm.auth)
    .send({
      key: `PL${seq}`,
      name: 'Planning Project',
      managerId: pm.user._id.toString(),
      memberIds: [dev.user._id.toString()],
      departmentId: dept._id.toString(),
      startDate: addDaysIso(today, -10),
      endDate: addDaysIso(today, 60),
    });
  expect(res.status).toBe(201);
  const project = res.body.data as { id: string; key: string };
  const task = async (body: Record<string, unknown>, who = pm) => {
    const r = await api()
      .post('/api/v1/tasks')
      .set(who.auth)
      .send({ projectId: project.id, title: 'A task', ...body });
    return r;
  };
  /** Moves a task to Done through In progress (the workflow forbids To do → Done), asserting each step. */
  const finish = async (taskId: string, who = pm) => {
    const url = `/api/v1/tasks/${taskId}`;
    const cur = (await api().get(url).set(who.auth)).body.data;
    if (cur.status !== 'in_progress')
      expect((await api().patch(url).set(who.auth).send({ status: 'in_progress' })).status).toBe(
        200,
      );
    const r = await api().patch(url).set(who.auth).send({ status: 'done' });
    expect(r.status).toBe(200);
    return r;
  };
  return { dept, pm, dev, outsider, project, task, finish };
}

describe('milestones', () => {
  it('tracks task progress, enforces project boundaries and permissions, and unlinks on delete', async () => {
    const { pm, dev, outsider, project, task, finish } = await setup();
    const ms = await api()
      .post(`/api/v1/projects/${project.id}/milestones`)
      .set(pm.auth)
      .send({ name: 'Beta release', dueDate: addDaysIso(today, 14) });
    expect(ms.status).toBe(201);
    expect(ms.body.data).toMatchObject({
      name: 'Beta release',
      status: 'open',
      overdue: false,
      progress: { total: 0 },
    });
    const msId = ms.body.data.id as string;

    expect(
      (
        await api()
          .post(`/api/v1/projects/${project.id}/milestones`)
          .set(dev.auth)
          .send({ name: 'Nope', dueDate: today })
      ).status,
    ).toBe(403);
    expect(
      (await api().patch(`/api/v1/milestones/${msId}`).set(outsider.auth).send({ name: 'Hidden' }))
        .status,
    ).toBe(404);

    const t1 = (await task({ title: 'Build', milestoneId: msId })).body.data;
    const t2 = (await task({ title: 'Test' })).body.data;
    expect(t1.milestone).toMatchObject({ id: msId, name: 'Beta release' });
    await api().patch(`/api/v1/tasks/${t2.id}`).set(pm.auth).send({ milestoneId: msId });
    await finish(t2.id);
    const filtered = await api().get(`/api/v1/tasks?milestoneId=${msId}`).set(pm.auth);
    expect(filtered.body.data).toHaveLength(2);

    let list = await api().get(`/api/v1/projects/${project.id}/milestones`).set(dev.auth);
    expect(list.body.data[0].progress).toEqual({ total: 2, done: 1, percent: 50 });

    // A milestone of another project cannot be used.
    const other = await setup();
    const foreign = await api()
      .post(`/api/v1/projects/${other.project.id}/milestones`)
      .set(other.pm.auth)
      .send({ name: 'Other', dueDate: today });
    expect(
      (
        await api()
          .patch(`/api/v1/tasks/${t1.id}`)
          .set(pm.auth)
          .send({ milestoneId: foreign.body.data.id })
      ).status,
    ).toBe(422);

    const done = await api()
      .patch(`/api/v1/milestones/${msId}`)
      .set(pm.auth)
      .send({ status: 'completed' });
    expect(done.body.data.status).toBe('completed');
    expect(done.body.data.completedAt).toBeTruthy();

    expect((await api().delete(`/api/v1/milestones/${msId}`).set(pm.auth)).status).toBe(204);
    expect(await Task.countDocuments({ milestoneId: msId })).toBe(0);
    list = await api().get(`/api/v1/projects/${project.id}/milestones`).set(pm.auth);
    expect(list.body.data).toHaveLength(0);
    expect(await AuditLog.countDocuments({ action: 'milestone.deleted' })).toBe(1);
  });

  it('raises a health warning for an overdue open milestone', async () => {
    const { pm, project } = await setup();
    await Milestone.create({
      projectId: project.id,
      name: 'Contract signed',
      dueDate: addDaysIso(today, -2),
    });
    const health = await api().get(`/api/v1/analytics/health?projectId=${project.id}`).set(pm.auth);
    expect(health.body.data[0].warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'milestone_overdue',
          message: expect.stringContaining('Contract signed'),
        }),
      ]),
    );
  });
});

describe('project dependencies', () => {
  it('links projects, rejects self and cycles, flags delays and lists dependents', async () => {
    const a = await setup();
    const upstream = await api()
      .post('/api/v1/projects')
      .set(a.pm.auth)
      .send({
        key: `UP${seq}`,
        name: 'Upstream',
        managerId: a.pm.user._id.toString(),
        departmentId: a.dept._id.toString(),
        endDate: addDaysIso(today, -1),
      });
    const upId = upstream.body.data.id as string;

    expect(
      (
        await api()
          .put(`/api/v1/projects/${a.project.id}/dependencies`)
          .set(a.pm.auth)
          .send({ dependencies: [{ projectId: a.project.id }] })
      ).status,
    ).toBe(422);
    const set = await api()
      .put(`/api/v1/projects/${a.project.id}/dependencies`)
      .set(a.pm.auth)
      .send({ dependencies: [{ projectId: upId, note: 'Needs the API' }] });
    expect(set.status).toBe(200);
    expect(set.body.data.dependsOn[0]).toMatchObject({
      project: { id: upId },
      note: 'Needs the API',
      delayed: true,
    });
    expect(set.body.data.dependsOn[0].reason).toMatch(/passed its end date/);

    const cycle = await api()
      .put(`/api/v1/projects/${upId}/dependencies`)
      .set(a.pm.auth)
      .send({ dependencies: [{ projectId: a.project.id }] });
    expect(cycle.status).toBe(422);
    expect(cycle.body.error.message).toMatch(/cycle/);

    const back = await api().get(`/api/v1/projects/${upId}/dependencies`).set(a.pm.auth);
    expect(back.body.data.dependents.map((d: { id: string }) => d.id)).toEqual([a.project.id]);

    const health = await api()
      .get(`/api/v1/analytics/health?projectId=${a.project.id}`)
      .set(a.pm.auth);
    expect(health.body.data[0].warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'upstream_project_delayed' })]),
    );

    // A member who cannot see the upstream project sees only a count, not its name.
    const view = await api().get(`/api/v1/projects/${a.project.id}/dependencies`).set(a.dev.auth);
    expect(view.body.data).toMatchObject({ dependsOn: [], hiddenUpstream: 1, canEdit: false });
    expect(
      (
        await api()
          .put(`/api/v1/projects/${a.project.id}/dependencies`)
          .set(a.dev.auth)
          .send({ dependencies: [] })
      ).status,
    ).toBe(403);
    const detail = await api().get(`/api/v1/projects/${a.project.id}`).set(a.dev.auth);
    expect(detail.body.data.dependsOnCount).toBe(1);
  });
});

describe('recurring tasks', () => {
  it('computes next due dates (weekly, monthly clamp, working days, skip-ahead, until)', () => {
    const weekly = { frequency: 'weekly' as const, interval: 1, workdaysOnly: false, until: null };
    expect(nextDueDate(weekly, '2026-11-02', '2026-11-01')).toBe('2026-11-09');
    expect(nextDueDate(weekly, '2026-10-05', '2026-11-06')).toBe('2026-11-09'); // completed late: skips ahead
    expect(nextDueDate({ ...weekly, frequency: 'monthly' }, '2027-01-31', '2027-01-01')).toBe(
      '2027-02-28',
    );
    expect(
      nextDueDate(
        { ...weekly, frequency: 'daily', workdaysOnly: true },
        '2026-11-06',
        '2026-11-01',
      ),
    ).toBe('2026-11-09'); // Fri → Mon
    expect(nextDueDate({ ...weekly, until: '2026-11-08' }, '2026-11-02', '2026-11-01')).toBeNull();
  });

  it('creates the next occurrence exactly once when completed', async () => {
    const { pm, dev, task, finish } = await setup();
    expect(
      (await task({ title: 'Weekly report', recurrence: { frequency: 'weekly' } })).status,
    ).toBe(400); // needs a due date
    const created = await task({
      title: 'Weekly report',
      assigneeId: dev.user._id.toString(),
      startDate: addDaysIso(today, 1),
      dueDate: addDaysIso(today, 2),
      checklist: [{ text: 'Collect numbers', done: false }],
      recurrence: { frequency: 'weekly', interval: 1 },
    });
    expect(created.status).toBe(201);
    expect(created.body.data.recurrence).toMatchObject({
      summary: 'Every week',
      index: 1,
      nextTask: null,
    });
    const id = created.body.data.id as string;

    await api()
      .patch(`/api/v1/tasks/${id}`)
      .set(pm.auth)
      .send({ checklist: [{ text: 'Collect numbers', done: true }] });
    const done = await finish(id, dev);
    const nextRef = done.body.data.recurrence.nextTask;
    expect(nextRef).toBeTruthy();

    const next = (await api().get(`/api/v1/tasks/${nextRef.id}`).set(pm.auth)).body.data;
    expect(next).toMatchObject({
      title: 'Weekly report',
      status: 'todo',
      startDate: addDaysIso(today, 8),
      dueDate: addDaysIso(today, 9),
      assignee: { id: dev.user._id.toString() },
      recurrence: { index: 2, nextTask: null },
    });
    expect(next.checklist[0].done).toBe(false);

    // Reopen and complete again: no second copy.
    await finish(id);
    expect(await Task.countDocuments({ title: 'Weekly report', deletedAt: null })).toBe(2);

    // Drag-and-drop to Done continues the series too.
    await api()
      .post(`/api/v1/tasks/${nextRef.id}/move`)
      .set(pm.auth)
      .send({ status: 'in_progress' });
    const moved = await api()
      .post(`/api/v1/tasks/${nextRef.id}/move`)
      .set(pm.auth)
      .send({ status: 'done' });
    expect(moved.status).toBe(200);
    expect(moved.body.data.recurrence.nextTask).toBeTruthy();
    expect(await Task.countDocuments({ title: 'Weekly report', deletedAt: null })).toBe(3);
  });

  it('stops at the end date and when the rule is removed; subtasks cannot repeat', async () => {
    const { pm, task, finish } = await setup();
    const last = await task({
      title: 'Ends soon',
      dueDate: today,
      recurrence: { frequency: 'weekly', until: addDaysIso(today, 3) },
    });
    await finish(last.body.data.id);
    expect(await Task.countDocuments({ title: 'Ends soon' })).toBe(1);

    const stopped = await task({
      title: 'Stopped',
      dueDate: today,
      recurrence: { frequency: 'daily' },
    });
    await api()
      .patch(`/api/v1/tasks/${stopped.body.data.id}`)
      .set(pm.auth)
      .send({ recurrence: null });
    await finish(stopped.body.data.id);
    expect(await Task.countDocuments({ title: 'Stopped' })).toBe(1);

    const parent = await task({ title: 'Parent' });
    const sub = await task({
      title: 'Sub',
      parentId: parent.body.data.id,
      dueDate: today,
      recurrence: { frequency: 'daily' },
    });
    expect(sub.status).toBe(400);
  });
});

describe('custom fields', () => {
  it('validates values against project definitions and cleans up when definitions change', async () => {
    const { pm, dev, project, task } = await setup();
    const fields = [
      { key: 'client_ref', label: 'Client ref', type: 'text', required: true },
      { key: 'env', label: 'Environment', type: 'select', options: ['UAT', 'PROD', 'DR'] },
      { key: 'story_points', label: 'Story points', type: 'number' },
      { key: 'go_live', label: 'Go-live', type: 'date' },
      { key: 'regulatory', label: 'Regulatory', type: 'checkbox' },
    ];
    expect(
      (
        await api()
          .put(`/api/v1/projects/${project.id}/custom-fields`)
          .set(dev.auth)
          .send({ fields })
      ).status,
    ).toBe(403);
    expect(
      (
        await api()
          .put(`/api/v1/projects/${project.id}/custom-fields`)
          .set(pm.auth)
          .send({ fields: [{ key: 'x', label: 'X', type: 'select', options: ['only'] }] })
      ).status,
    ).toBe(400);
    const put = await api()
      .put(`/api/v1/projects/${project.id}/custom-fields`)
      .set(pm.auth)
      .send({ fields });
    expect(put.status).toBe(200);

    const missing = await task({ title: 'No ref', customFields: { env: 'UAT' } });
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toBe('Client ref is required');
    expect((await task({ customFields: { client_ref: 'C-1', env: 'QA' } })).status).toBe(400);
    expect((await task({ customFields: { client_ref: 'C-1', nope: 1 } })).status).toBe(400);
    expect((await task({ customFields: { client_ref: 'C-1', story_points: 'many' } })).status).toBe(
      400,
    );

    const ok = await task({
      customFields: {
        client_ref: ' C-42 ',
        env: 'PROD',
        story_points: '5',
        go_live: today,
        regulatory: true,
      },
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.customFields).toEqual({
      client_ref: 'C-42',
      env: 'PROD',
      story_points: 5,
      go_live: today,
      regulatory: true,
    });
    const id = ok.body.data.id as string;

    // Partial update keeps other values; null clears; a required field cannot be cleared.
    let upd = await api()
      .patch(`/api/v1/tasks/${id}`)
      .set(pm.auth)
      .send({ customFields: { story_points: 8, go_live: null } });
    expect(upd.body.data.customFields).toEqual({
      client_ref: 'C-42',
      env: 'PROD',
      story_points: 8,
      regulatory: true,
    });
    expect(
      (
        await api()
          .patch(`/api/v1/tasks/${id}`)
          .set(pm.auth)
          .send({ customFields: { client_ref: null } })
      ).status,
    ).toBe(400);

    // Removing an option, changing a type and removing a field clear the affected values.
    await api()
      .put(`/api/v1/projects/${project.id}/custom-fields`)
      .set(pm.auth)
      .send({
        fields: [
          { key: 'client_ref', label: 'Client ref', type: 'text' },
          { key: 'env', label: 'Environment', type: 'select', options: ['UAT', 'DR'] },
          { key: 'story_points', label: 'Story points', type: 'text' },
        ],
      });
    upd = await api().get(`/api/v1/tasks/${id}`).set(pm.auth);
    expect(upd.body.data.customFields).toEqual({ client_ref: 'C-42' });
    const raw = await Task.findById(id).lean();
    expect(raw!.customFields).toEqual({ client_ref: 'C-42' });
    expect(await AuditLog.countDocuments({ action: 'project.custom_fields_updated' })).toBe(2);
    const p = await api().get(`/api/v1/projects/${project.id}`).set(dev.auth);
    expect(p.body.data.customFields.map((f: { key: string }) => f.key)).toEqual([
      'client_ref',
      'env',
      'story_points',
    ]);
  });
});

describe('project templates', () => {
  it('saves a project as a template and creates a dated project from it in one step', async () => {
    const { pm, dev, project, task, finish } = await setup();
    await api()
      .put(`/api/v1/projects/${project.id}/custom-fields`)
      .set(pm.auth)
      .send({
        fields: [{ key: 'env', label: 'Environment', type: 'select', options: ['UAT', 'PROD'] }],
      });
    const ms = (
      await api()
        .post(`/api/v1/projects/${project.id}/milestones`)
        .set(pm.auth)
        .send({ name: 'UAT sign-off', dueDate: addDaysIso(today, 20) })
    ).body.data;
    // Project starts today-10, so offsets are: milestone 30, build start 10 / due 15, test due 25.
    const build = (
      await task({
        title: 'Build',
        startDate: today,
        dueDate: addDaysIso(today, 5),
        estimatedHours: 16,
        milestoneId: ms.id,
        customFields: { env: 'UAT' },
      })
    ).body.data;
    const test = (
      await task({
        title: 'Test',
        dueDate: addDaysIso(today, 15),
        recurrence: { frequency: 'weekly' },
      })
    ).body.data;
    await api()
      .patch(`/api/v1/tasks/${test.id}`)
      .set(pm.auth)
      .send({ dependencyIds: [build.id] });
    // A completed repeating task has a successor; the series must appear once in the template.
    const standup = (
      await task({ title: 'Standup notes', dueDate: today, recurrence: { frequency: 'daily' } })
    ).body.data;
    await finish(standup.id);
    await task({ title: 'Checklist item', parentId: build.id });

    expect(
      (
        await api()
          .post(`/api/v1/projects/${project.id}/save-as-template`)
          .set(dev.auth)
          .send({ name: 'Nope' })
      ).status,
    ).toBe(403);
    const saved = await api()
      .post(`/api/v1/projects/${project.id}/save-as-template`)
      .set(pm.auth)
      .send({ name: 'Release template' });
    expect(saved.status).toBe(201);
    expect(saved.body.data).toMatchObject({
      taskCount: 4,
      milestoneCount: 1,
      customFieldCount: 1,
      durationDays: 70,
      canEdit: true,
    });
    const tplBuild = saved.body.data.tasks.find((t: { title: string }) => t.title === 'Build');
    expect(tplBuild).toMatchObject({
      startOffsetDays: 10,
      dueOffsetDays: 15,
      milestoneRef: 'm1',
      customFields: { env: 'UAT' },
    });
    expect(saved.body.data.milestones[0]).toMatchObject({
      name: 'UAT sign-off',
      dueOffsetDays: 30,
    });

    const start = addDaysIso(today, 7);
    const created = await api()
      .post('/api/v1/projects')
      .set(pm.auth)
      .send({
        key: `TP${seq}`,
        name: 'From template',
        managerId: pm.user._id.toString(),
        startDate: start,
        templateId: saved.body.data.id,
      });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      startDate: start,
      endDate: addDaysIso(start, 70),
      customFields: [{ key: 'env' }],
    });
    expect(created.body.data.progress.totalTasks).toBe(3); // top-level tasks
    expect(
      saved.body.data.tasks.filter((x: { title: string }) => x.title === 'Standup notes'),
    ).toHaveLength(1);
    const newId = created.body.data.id as string;

    const tasks = (await api().get(`/api/v1/tasks?projectId=${newId}&limit=50`).set(pm.auth)).body
      .data as TaskDto[];
    const nb = tasks.find((t) => t.title === 'Build')!;
    const nt = tasks.find((t) => t.title === 'Test')!;
    expect(nb).toMatchObject({
      status: 'todo',
      assignee: null,
      startDate: addDaysIso(start, 10),
      dueDate: addDaysIso(start, 15),
      estimatedHours: 16,
      customFields: { env: 'UAT' },
    });
    expect(nb.milestone).toMatchObject({ name: 'UAT sign-off', dueDate: addDaysIso(start, 30) });
    expect(nt.dependencies.map((d: { id: string }) => d.id)).toEqual([nb.id]);
    expect(nt.recurrence).toMatchObject({ frequency: 'weekly', index: 1 });
    expect(tasks.find((t) => t.title === 'Checklist item')!.parent?.id).toBe(nb.id);
    expect(nb.key).toMatch(new RegExp(`^TP${seq}-`));
    expect((await ProjectTemplate.findById(saved.body.data.id).lean())!.usageCount).toBe(1);
  });

  it('is a shared library: authors edit, others only use; deleted templates cannot be used', async () => {
    const { pm } = await setup();
    const other = await loginAs(h.app, 'project_manager');
    const dev = await loginAs(h.app, 'developer');
    const tpl = await api()
      .post('/api/v1/project-templates')
      .set(pm.auth)
      .send({
        name: 'Onboarding',
        milestones: [{ ref: 'm1', name: 'Week one', dueOffsetDays: 5 }],
        tasks: [
          { ref: 'a', title: 'Laptop', dueOffsetDays: 1, milestoneRef: 'm1' },
          { ref: 'b', title: 'Access', dependencyRefs: ['a'] },
        ],
      });
    expect(tpl.status).toBe(201);
    const id = tpl.body.data.id as string;
    const bad = await api()
      .post('/api/v1/project-templates')
      .set(pm.auth)
      .send({ name: 'Broken', tasks: [{ ref: 'a', title: 'X y', dependencyRefs: ['zz'] }] });
    expect(bad.status).toBe(400);

    expect((await api().get('/api/v1/project-templates').set(dev.auth)).status).toBe(403);
    const seen = await api().get('/api/v1/project-templates?q=onboard').set(other.auth);
    expect(seen.body.data).toEqual([expect.objectContaining({ id, canEdit: false, taskCount: 2 })]);
    expect(
      (
        await api()
          .patch(`/api/v1/project-templates/${id}`)
          .set(other.auth)
          .send({ name: 'Mine now' })
      ).status,
    ).toBe(403);
    // Replacing tasks must keep links valid against the stored milestones.
    expect(
      (
        await api()
          .patch(`/api/v1/project-templates/${id}`)
          .set(pm.auth)
          .send({ tasks: [{ ref: 'x', title: 'Desk', milestoneRef: 'm9' }] })
      ).status,
    ).toBe(400);
    expect(
      (
        await api()
          .patch(`/api/v1/project-templates/${id}`)
          .set(pm.auth)
          .send({ name: 'Onboarding v2' })
      ).body.data.name,
    ).toBe('Onboarding v2');

    expect((await api().delete(`/api/v1/project-templates/${id}`).set(pm.auth)).status).toBe(204);
    const use = await api()
      .post('/api/v1/projects')
      .set(pm.auth)
      .send({ key: `DT${seq}`, name: 'Late', managerId: pm.user._id.toString(), templateId: id });
    expect(use.status).toBe(422);
    expect(await Project.countDocuments({ key: `DT${seq}` })).toBe(0);
  });

  it('duplicating a project copies milestones, task links and custom field values', async () => {
    const { pm, project, task } = await setup();
    await api()
      .put(`/api/v1/projects/${project.id}/custom-fields`)
      .set(pm.auth)
      .send({ fields: [{ key: 'env', label: 'Env', type: 'text' }] });
    const ms = (
      await api()
        .post(`/api/v1/projects/${project.id}/milestones`)
        .set(pm.auth)
        .send({ name: 'M1', dueDate: today })
    ).body.data;
    await task({ title: 'Linked', milestoneId: ms.id, customFields: { env: 'UAT' } });
    const copy = await api()
      .post(`/api/v1/projects/${project.id}/duplicate`)
      .set(pm.auth)
      .send({ key: `DU${seq}`, name: 'Copy' });
    expect(copy.status).toBe(201);
    const tasks = (await api().get(`/api/v1/tasks?projectId=${copy.body.data.id}`).set(pm.auth))
      .body.data;
    expect(tasks[0].customFields).toEqual({ env: 'UAT' });
    expect(tasks[0].milestone.name).toBe('M1');
    expect(tasks[0].milestone.id).not.toBe(ms.id);
  });
});
