import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AssignmentHistory, Activity } from '../src/modules/collab/collab.models';
import { Task } from '../src/modules/tasks/task.model';
import {
  createDepartment,
  createUser,
  loginAs,
  storedObjects,
  useHarness,
} from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);

type Auth = { Authorization: string };

/** A PM-owned project with a developer and a tester on the team. */
async function setup() {
  const dept = await createDepartment('TECH');
  const pm = await loginAs(h.app, 'project_manager', { departmentId: dept._id });
  const dev = await loginAs(h.app, 'developer', { departmentId: dept._id });
  const qa = await loginAs(h.app, 'qa_tester', { departmentId: dept._id });
  const res = await api()
    .post('/api/v1/projects')
    .set(pm.auth)
    .send({
      key: 'trd',
      name: 'Trading Platform Revamp',
      managerId: pm.user._id.toString(),
      departmentId: dept._id.toString(),
      memberIds: [dev.user._id.toString(), qa.user._id.toString()],
      startDate: '2026-11-01',
      endDate: '2027-03-31',
    });
  expect(res.status).toBe(201);
  return { dept, pm, dev, qa, project: res.body.data as { id: string; key: string } };
}

async function createTask(auth: Auth, projectId: string, extra: Record<string, unknown> = {}) {
  const res = await api()
    .post('/api/v1/tasks')
    .set(auth)
    .send({ projectId, title: 'A task to do', ...extra });
  if (res.status !== 201) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string; key: string; status: string; rank: string };
}

describe('projects', () => {
  it('creates a project: key normalised, manager added to the team, empty progress', async () => {
    const { project, pm } = await setup();
    const res = await api().get(`/api/v1/projects/${project.id}`).set(pm.auth);
    expect(res.body.data).toMatchObject({
      key: 'TRD',
      status: 'planning',
      progress: { totalTasks: 0, percent: 0 },
      can: { update: true, createTask: true },
    });
    const roles = Object.fromEntries(
      res.body.data.members.map((m: { user: { id: string }; role: string }) => [m.user.id, m.role]),
    );
    expect(roles[pm.user._id.toString()]).toBe('manager');
    const dup = await api()
      .post('/api/v1/projects')
      .set(pm.auth)
      .send({ key: 'TRD', name: 'Other', managerId: pm.user._id.toString() });
    expect(dup.status).toBe(409);
  });

  it('developers cannot create projects and only see projects they belong to', async () => {
    const { dev, project } = await setup();
    const outsider = await loginAs(h.app, 'developer');
    expect(
      (
        await api()
          .post('/api/v1/projects')
          .set(dev.auth)
          .send({ key: 'NEW', name: 'New one', managerId: dev.user._id.toString() })
      ).status,
    ).toBe(403);
    expect((await api().get('/api/v1/projects').set(dev.auth)).body.meta.total).toBe(1);
    expect((await api().get('/api/v1/projects').set(outsider.auth)).body.meta.total).toBe(0);
    expect((await api().get(`/api/v1/projects/${project.id}`).set(outsider.auth)).status).toBe(404);
  });

  it('department heads can only create projects in their own department', async () => {
    const own = await createDepartment('OPS');
    const other = await createDepartment('FIN');
    const head = await loginAs(h.app, 'department_head', { departmentId: own._id });
    const body = { key: 'OPX', name: 'Ops project', managerId: head.user._id.toString() };
    expect(
      (
        await api()
          .post('/api/v1/projects')
          .set(head.auth)
          .send({ ...body, departmentId: other._id.toString() })
      ).status,
    ).toBe(403);
    expect(
      (
        await api()
          .post('/api/v1/projects')
          .set(head.auth)
          .send({ ...body, departmentId: own._id.toString() })
      ).status,
    ).toBe(201);
  });

  it('records versions and activity on update; members with open work cannot be removed', async () => {
    const { project, pm, dev } = await setup();
    const upd = await api()
      .patch(`/api/v1/projects/${project.id}`)
      .set(pm.auth)
      .send({ status: 'in_progress', priority: 'high' });
    expect(upd.body.data.version).toBe(2);
    const versions = await api().get(`/api/v1/projects/${project.id}/versions`).set(pm.auth);
    expect(versions.body.data[0].changes.map((c: { field: string }) => c.field).sort()).toEqual([
      'priority',
      'status',
    ]);
    // A partial update changes only the fields sent (no schema defaults leak in).
    const renamed = await api()
      .patch(`/api/v1/projects/${project.id}`)
      .set(pm.auth)
      .send({ name: 'Renamed Project' });
    expect(renamed.body.data).toMatchObject({
      name: 'Renamed Project',
      status: 'in_progress',
      priority: 'high',
    });

    await createTask(pm.auth, project.id, { assigneeId: dev.user._id.toString() });
    const remove = await api()
      .put(`/api/v1/projects/${project.id}/members`)
      .set(pm.auth)
      .send({ members: [] });
    expect(remove.status).toBe(409);
    // The developer is a plain member and cannot edit the project.
    expect(
      (await api().patch(`/api/v1/projects/${project.id}`).set(dev.auth).send({ name: 'Hacked' }))
        .status,
    ).toBe(403);
  });

  it('archived projects are read-only until restored (archiving needs project:delete)', async () => {
    const { project, pm } = await setup();
    const admin = await loginAs(h.app, 'super_admin');
    // Project managers may edit but not archive (no project:delete in the default matrix).
    expect(
      (
        await api()
          .post('/api/v1/projects/' + project.id + '/archive')
          .set(pm.auth)
      ).status,
    ).toBe(403);
    const task = await createTask(pm.auth, project.id);
    expect(
      (await api().post(`/api/v1/projects/${project.id}/archive`).set(admin.auth)).body.data
        .archived,
    ).toBe(true);
    expect(
      (await api().patch(`/api/v1/tasks/${task.id}`).set(pm.auth).send({ title: 'Changed title' }))
        .status,
    ).toBe(422);
    expect((await api().get('/api/v1/projects').set(pm.auth)).body.meta.total).toBe(0);
    expect((await api().get('/api/v1/projects?archived=true').set(pm.auth)).body.meta.total).toBe(
      1,
    );
    await api().post(`/api/v1/projects/${project.id}/restore`).set(admin.auth);
    expect(
      (await api().patch(`/api/v1/tasks/${task.id}`).set(pm.auth).send({ title: 'Changed title' }))
        .status,
    ).toBe(200);
  });

  it('duplicates a project with its tasks, subtasks and dependencies re-linked', async () => {
    const { project, pm } = await setup();
    const a = await createTask(pm.auth, project.id, {
      title: 'Parent task',
      status: 'in_progress',
    });
    const b = await createTask(pm.auth, project.id, { title: 'Child task', parentId: a.id });
    await api()
      .patch(`/api/v1/tasks/${b.id}`)
      .set(pm.auth)
      .send({ dependencyIds: [a.id] });
    const res = await api()
      .post(`/api/v1/projects/${project.id}/duplicate`)
      .set(pm.auth)
      .send({ key: 'TRD2', name: 'Copy' });
    expect(res.status).toBe(201);
    const copied = await Task.find({ projectId: res.body.data.id }).lean();
    expect(copied.map((t) => t.key).sort()).toEqual(['TRD2-1', 'TRD2-2']);
    expect(copied.every((t) => t.status === 'todo')).toBe(true);
    const parent = copied.find((t) => t.title === 'Parent task')!;
    const child = copied.find((t) => t.title === 'Child task')!;
    expect(child.parentId?.toString()).toBe(parent._id.toString());
    expect(child.dependencyIds.map(String)).toEqual([parent._id.toString()]);
  });

  it('computes effort-weighted progress (unestimated = 1 h, cancelled excluded)', async () => {
    const { project, pm } = await setup();
    const big = await createTask(pm.auth, project.id, { estimatedHours: 9, status: 'in_progress' });
    await createTask(pm.auth, project.id, { status: 'in_progress' }); // 1 h default
    await createTask(pm.auth, project.id, { estimatedHours: 50, status: 'todo' }).then((t) =>
      api().patch(`/api/v1/tasks/${t.id}`).set(pm.auth).send({ status: 'cancelled' }),
    );
    await api().patch(`/api/v1/tasks/${big.id}`).set(pm.auth).send({ status: 'done' });
    const res = await api().get(`/api/v1/projects/${project.id}`).set(pm.auth);
    expect(res.body.data.progress).toMatchObject({ totalTasks: 2, doneTasks: 1, percent: 90 });
  });
});

describe('tasks', () => {
  it('creates sequential keys and records manual assignment', async () => {
    const { project, pm, dev } = await setup();
    const t1 = await createTask(pm.auth, project.id);
    const t2 = await createTask(pm.auth, project.id, { assigneeId: dev.user._id.toString() });
    expect([t1.key, t2.key]).toEqual(['TRD-1', 'TRD-2']);
    expect(
      await AssignmentHistory.countDocuments({ method: 'manual', toUserId: dev.user._id }),
    ).toBe(1);
    const outsider = await createUser({ role: 'developer' });
    const bad = await api()
      .post('/api/v1/tasks')
      .set(pm.auth)
      .send({ projectId: project.id, title: 'x task', assigneeId: outsider._id.toString() });
    expect(bad.status).toBe(422);
  });

  it('enforces own-scope edits for developers and cancel rights', async () => {
    const { project, pm, dev, qa } = await setup();
    const mine = await createTask(pm.auth, project.id, { assigneeId: dev.user._id.toString() });
    const theirs = await createTask(pm.auth, project.id, { assigneeId: qa.user._id.toString() });
    expect(
      (await api().patch(`/api/v1/tasks/${mine.id}`).set(dev.auth).send({ status: 'in_progress' }))
        .status,
    ).toBe(200);
    expect(
      (
        await api()
          .patch(`/api/v1/tasks/${theirs.id}`)
          .set(dev.auth)
          .send({ status: 'in_progress' })
      ).status,
    ).toBe(403);
    expect(
      (await api().patch(`/api/v1/tasks/${mine.id}`).set(dev.auth).send({ status: 'cancelled' }))
        .status,
    ).toBe(403);
    expect((await api().delete(`/api/v1/tasks/${mine.id}`).set(dev.auth)).status).toBe(403);
    // Project members can still read every task of the project.
    expect((await api().get(`/api/v1/tasks/${theirs.id}`).set(dev.auth)).status).toBe(200);
  });

  it('employees (own scope) only see tasks assigned to, reported by or watched by them', async () => {
    const { project, pm } = await setup();
    const emp = await loginAs(h.app, 'employee');
    await api()
      .put(`/api/v1/projects/${project.id}/members`)
      .set(pm.auth)
      .send({ members: [{ userId: emp.user._id.toString(), role: 'member' }] });
    const visible = await createTask(pm.auth, project.id, { assigneeId: emp.user._id.toString() });
    const hidden = await createTask(pm.auth, project.id);
    const list = await api().get('/api/v1/tasks').set(emp.auth);
    expect(list.body.data.map((t: { id: string }) => t.id)).toEqual([visible.id]);
    expect((await api().get(`/api/v1/tasks/${hidden.id}`).set(emp.auth)).status).toBe(404);
  });

  it('validates workflow transitions and maintains lifecycle timestamps', async () => {
    const { project, pm } = await setup();
    const t = await createTask(pm.auth, project.id, { status: 'backlog' });
    const jump = await api().patch(`/api/v1/tasks/${t.id}`).set(pm.auth).send({ status: 'done' });
    expect(jump.status).toBe(422);
    expect(jump.body.error.message).toMatch(/Backlog to Done/);
    await api().patch(`/api/v1/tasks/${t.id}`).set(pm.auth).send({ status: 'in_progress' });
    const blocked = await api()
      .patch(`/api/v1/tasks/${t.id}`)
      .set(pm.auth)
      .send({ status: 'blocked' });
    expect(blocked.body.data.blockedSince).toBeTruthy();
    await api().patch(`/api/v1/tasks/${t.id}`).set(pm.auth).send({ status: 'in_progress' });
    const done = await api().patch(`/api/v1/tasks/${t.id}`).set(pm.auth).send({ status: 'done' });
    expect(done.body.data.status).toBe('done');
    expect(done.body.data.blockedSince).toBeUndefined();
    expect(done.body.data.completedAt).toBeTruthy();
    expect(await Activity.countDocuments({ verb: 'status_changed' })).toBe(4);
  });

  it('drag-and-drop places a task between neighbours and the board reflects the order', async () => {
    const { project, pm } = await setup();
    const a = await createTask(pm.auth, project.id, { title: 'Task A' });
    const b = await createTask(pm.auth, project.id, { title: 'Task B' });
    const c = await createTask(pm.auth, project.id, { title: 'Task C', status: 'backlog' });
    const moved = await api()
      .post(`/api/v1/tasks/${c.id}/move`)
      .set(pm.auth)
      .send({ status: 'todo', beforeId: a.id, afterId: b.id });
    expect(moved.status).toBe(200);
    const board = await api().get(`/api/v1/tasks/board?projectId=${project.id}`).set(pm.auth);
    const todo = board.body.data.find((col: { status: string }) => col.status === 'todo');
    expect(todo.tasks.map((t: { title: string }) => t.title)).toEqual([
      'Task A',
      'Task C',
      'Task B',
    ]);
    expect(board.body.data.map((col: { status: string }) => col.status)).toEqual([
      'backlog',
      'todo',
      'in_progress',
      'in_review',
      'testing',
      'blocked',
      'done',
    ]);
  });

  it('rejects dependency cycles and nested subtasks; deleting a parent removes its subtasks', async () => {
    const { project, pm } = await setup();
    const a = await createTask(pm.auth, project.id);
    const b = await createTask(pm.auth, project.id);
    await api()
      .patch(`/api/v1/tasks/${b.id}`)
      .set(pm.auth)
      .send({ dependencyIds: [a.id] });
    const cycle = await api()
      .patch(`/api/v1/tasks/${a.id}`)
      .set(pm.auth)
      .send({ dependencyIds: [b.id] });
    expect(cycle.status).toBe(422);

    const sub = await createTask(pm.auth, project.id, { parentId: a.id });
    const nested = await api()
      .post('/api/v1/tasks')
      .set(pm.auth)
      .send({ projectId: project.id, title: 'Too deep', parentId: sub.id });
    expect(nested.status).toBe(422);
    const parent = await api().get(`/api/v1/tasks/${a.id}`).set(pm.auth);
    expect(parent.body.data).toMatchObject({ subtaskCount: 1, subtasksDone: 0 });

    expect((await api().delete(`/api/v1/tasks/${a.id}`).set(pm.auth)).status).toBe(204);
    expect((await api().get(`/api/v1/tasks/${sub.id}`).set(pm.auth)).status).toBe(404);
    // b no longer depends on the deleted task.
    expect((await api().get(`/api/v1/tasks/${b.id}`).set(pm.auth)).body.data.dependencies).toEqual(
      [],
    );
  });

  it('filters, searches and sorts the list', async () => {
    const { project, pm, dev } = await setup();
    await createTask(pm.auth, project.id, {
      title: 'Low thing',
      priority: 'low',
      dueDate: '2020-01-01',
    });
    await createTask(pm.auth, project.id, {
      title: 'Critical login bug',
      priority: 'critical',
      assigneeId: dev.user._id.toString(),
    });
    await createTask(pm.auth, project.id, {
      title: 'Medium thing',
      status: 'in_progress',
      tags: ['api'],
    });
    const get = (qs: string) =>
      api()
        .get(`/api/v1/tasks?${qs}`)
        .set(pm.auth)
        .then((r) => r.body.data.map((t: { title: string }) => t.title));
    expect(await get('sort=priority')).toEqual(['Critical login bug', 'Medium thing', 'Low thing']);
    expect(await get('q=login')).toEqual(['Critical login bug']);
    expect(await get('status=in_progress,blocked')).toEqual(['Medium thing']);
    expect(await get('overdue=true')).toEqual(['Low thing']);
    expect(await get('tag=api')).toEqual(['Medium thing']);
    expect(
      await api()
        .get('/api/v1/tasks?assigneeId=me')
        .set(dev.auth)
        .then((r) => r.body.meta.total),
    ).toBe(1);
    expect((await api().get('/api/v1/tasks?sort=secret').set(pm.auth)).status).toBe(400);
  });

  it('bulk update reports per-task failures without stopping', async () => {
    const { project, pm } = await setup();
    const ok = await createTask(pm.auth, project.id, { status: 'todo' });
    const bad = await createTask(pm.auth, project.id, { status: 'backlog' });
    const res = await api()
      .patch('/api/v1/tasks/bulk')
      .set(pm.auth)
      .send({ ids: [ok.id, bad.id], set: { status: 'in_review' } });
    // todo -> in_review is not allowed; backlog -> in_review is not allowed either.
    expect(res.body.data.updated).toBe(0);
    const res2 = await api()
      .patch('/api/v1/tasks/bulk')
      .set(pm.auth)
      .send({ ids: [ok.id, bad.id], set: { status: 'in_progress', priority: 'high' } });
    expect(res2.body.data).toMatchObject({ updated: 2, failed: [] });
  });
});

describe('collaboration', () => {
  it('comments: mentions of team members are stored and they start watching; others are ignored', async () => {
    const { project, pm, dev } = await setup();
    const outsider = await createUser({ role: 'developer', name: 'Out Sider' });
    const t = await createTask(pm.auth, project.id);
    const res = await api()
      .post(`/api/v1/tasks/${t.id}/comments`)
      .set(pm.auth)
      .send({ body: `Please check @[Dev](${dev.user._id}) and @[Out](${outsider._id})` });
    expect(res.status).toBe(201);
    expect(res.body.data.mentions.map((m: { id: string }) => m.id)).toEqual([
      dev.user._id.toString(),
    ]);
    const task = await api().get(`/api/v1/tasks/${t.id}`).set(pm.auth);
    expect(task.body.data.watcherIds).toContain(dev.user._id.toString());
    expect(task.body.data.commentCount).toBe(1);
    // Only the author can edit.
    expect(
      (
        await api()
          .patch(`/api/v1/comments/${res.body.data.id}`)
          .set(dev.auth)
          .send({ body: 'edit' })
      ).status,
    ).toBe(403);
    expect(
      (
        await api()
          .patch(`/api/v1/comments/${res.body.data.id}`)
          .set(pm.auth)
          .send({ body: 'edited' })
      ).body.data.edited,
    ).toBe(true);
  });

  it('attachments: content is sniffed, disguised executables are rejected, downloads are access-checked', async () => {
    const { project, pm } = await setup();
    const t = await createTask(pm.auth, project.id);
    // A real 1x1 PNG.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const up = await api()
      .post(`/api/v1/tasks/${t.id}/attachments`)
      .set(pm.auth)
      .attach('file', png, 'screenshot.png');
    expect(up.status).toBe(201);
    expect(up.body.data).toMatchObject({ fileName: 'screenshot.png', mime: 'image/png' });
    expect(storedObjects.size).toBe(1);

    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0)]);
    const disguised = await api()
      .post(`/api/v1/tasks/${t.id}/attachments`)
      .set(pm.auth)
      .attach('file', exe, 'invoice.pdf');
    expect(disguised.status).toBe(422);

    const txt = await api()
      .post(`/api/v1/tasks/${t.id}/attachments`)
      .set(pm.auth)
      .attach('file', Buffer.from('hello, world\n'), 'notes.txt');
    expect(txt.body.data.mime).toBe('text/plain');

    const dl = await api().get(`/api/v1/attachments/${up.body.data.id}/download`).set(pm.auth);
    expect(dl.body.data.url).toMatch(/^https:\/\/storage\.test\/attachments\//);
    const outsider = await loginAs(h.app, 'developer');
    expect(
      (await api().get(`/api/v1/attachments/${up.body.data.id}/download`).set(outsider.auth))
        .status,
    ).toBe(404);

    expect((await api().delete(`/api/v1/attachments/${up.body.data.id}`).set(pm.auth)).status).toBe(
      204,
    );
    expect(storedObjects.size).toBe(1);
  });

  it('saved views are private to their owner', async () => {
    const { pm, dev } = await setup();
    const created = await api()
      .post('/api/v1/saved-views')
      .set(pm.auth)
      .send({
        module: 'tasks',
        name: 'My critical',
        view: 'board',
        filters: { priority: 'critical' },
      });
    expect(created.status).toBe(201);
    expect(
      (
        await api()
          .post('/api/v1/saved-views')
          .set(pm.auth)
          .send({ module: 'tasks', name: 'My critical' })
      ).status,
    ).toBe(409);
    expect((await api().get('/api/v1/saved-views?module=tasks').set(dev.auth)).body.data).toEqual(
      [],
    );
    expect(
      (await api().delete(`/api/v1/saved-views/${created.body.data.id}`).set(dev.auth)).status,
    ).toBe(404);
  });

  it('project activity feed lists task and project events, newest first', async () => {
    const { project, pm } = await setup();
    const t = await createTask(pm.auth, project.id);
    await api().patch(`/api/v1/tasks/${t.id}`).set(pm.auth).send({ priority: 'high' });
    const feed = await api().get(`/api/v1/projects/${project.id}/activity`).set(pm.auth);
    expect(feed.body.data.map((a: { verb: string }) => a.verb)).toEqual([
      'updated',
      'created',
      'created',
    ]);
  });
});
