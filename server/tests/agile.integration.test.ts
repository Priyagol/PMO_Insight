import { Types } from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Release } from '../src/modules/delivery/delivery.models';
import { Task } from '../src/modules/tasks/task.model';
import { createDepartment, loginAs, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);
type Who = { auth: Record<string, string>; user: { _id: { toString(): string } } };

let seq = 0;
async function setup() {
  seq += 1;
  const dept = await createDepartment(`AG${seq}`);
  const pm = await loginAs(h.app, 'project_manager', { departmentId: dept._id });
  const dev = await loginAs(h.app, 'developer', { departmentId: dept._id, managerId: pm.user._id });
  const mk = async (key: string) => {
    const res = await api()
      .post('/api/v1/projects')
      .set(pm.auth)
      .send({
        key,
        name: `Agile ${key}`,
        managerId: pm.user._id.toString(),
        memberIds: [dev.user._id.toString()],
        departmentId: dept._id.toString(),
      });
    expect(res.status).toBe(201);
    return res.body.data as { id: string; key: string };
  };
  return { pm, dev, project: await mk(`AG${seq}`), other: await mk(`AH${seq}`) };
}
const task = async (who: Who, body: Record<string, unknown>) => {
  const res = await api().post('/api/v1/tasks').set(who.auth).send(body);
  return res;
};
const created = async (who: Who, body: Record<string, unknown>) => {
  const res = await task(who, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; key: string } & Record<string, unknown>;
};
const patch = (who: Who, id: string, body: Record<string, unknown>) =>
  api().patch(`/api/v1/tasks/${id}`).set(who.auth).send(body);

describe('issue types, bug details and components', () => {
  it('validates epics, bugs, components and fix versions', async () => {
    const { pm, dev, project } = await setup();
    const epic = await created(pm, {
      projectId: project.id,
      title: 'Online onboarding',
      type: 'epic',
    });
    const story = await created(dev, {
      projectId: project.id,
      title: 'Upload KYC documents',
      type: 'story',
      epicId: epic.id,
      storyPoints: 5,
      acceptanceCriteria: 'PDF and JPEG accepted',
      estimatedHours: 6,
    });
    expect(story).toMatchObject({
      type: 'story',
      storyPoints: 5,
      epic: { id: epic.id },
      remainingHours: 6,
      remainingIsManual: false,
      bug: null,
    });

    // Rules
    expect(
      (
        await task(dev, {
          projectId: project.id,
          title: 'Wrong',
          type: 'story',
          bug: { severity: 'major' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await task(dev, {
          projectId: project.id,
          title: 'Sub epic',
          type: 'epic',
          parentId: story.id,
        })
      ).status,
    ).toBe(400);
    expect(
      (await task(dev, { projectId: project.id, title: 'Under epic', parentId: epic.id })).status,
    ).toBe(422);
    expect(
      (await task(dev, { projectId: project.id, title: 'Bad epic', epicId: story.id })).status,
    ).toBe(422);
    expect(
      (await task(dev, { projectId: project.id, title: 'Comp', components: ['API'] })).status,
    ).toBe(422);
    expect(
      (await task(dev, { projectId: project.id, title: 'Half', storyPoints: 1.25 })).status,
    ).toBe(400);

    // Components and WIP limits are project settings
    expect(
      (
        await api()
          .put(`/api/v1/projects/${project.id}/agile-settings`)
          .set(dev.auth)
          .send({ components: [{ name: 'API' }] })
      ).status,
    ).toBe(403);
    const settings = await api()
      .put(`/api/v1/projects/${project.id}/agile-settings`)
      .set(pm.auth)
      .send({
        components: [{ name: 'API', leadId: dev.user._id.toString() }, { name: 'Web' }],
        wipLimits: { in_progress: 2, todo: 0 },
      });
    expect(settings.status).toBe(200);
    expect(settings.body.data.wipLimits).toEqual({ in_progress: 2 });
    const rel = await api()
      .post('/api/v1/releases')
      .set(pm.auth)
      .send({ projectId: project.id, version: '1.0.0' });
    expect(rel.status).toBe(201);
    const bug = await created(dev, {
      projectId: project.id,
      title: 'Upload fails on Safari',
      type: 'bug',
      components: ['api'],
      fixReleaseId: rel.body.data.id,
      bug: {
        severity: 'critical',
        stepsToReproduce: '1. Open\n2. Upload',
        expectedResult: 'Saved',
        actualResult: 'Error 500',
        environment: 'UAT',
        regression: true,
      },
    });
    expect(bug).toMatchObject({
      components: ['API'],
      fixRelease: { id: rel.body.data.id, version: '1.0.0' },
      bug: { severity: 'critical', regression: true, actualResult: 'Error 500' },
    });
    expect((await Release.findById(rel.body.data.id).lean())!.taskIds.map(String)).toContain(
      bug.id,
    );
    const proj = await api().get(`/api/v1/projects/${project.id}`).set(dev.auth);
    expect(proj.body.data).toMatchObject({
      components: ['API', 'Web'],
      wipLimits: { in_progress: 2 },
    });

    // Changing type away from bug clears details; fix version removal updates the release
    const changed = await patch(dev, bug.id, { type: 'task', fixReleaseId: null });
    expect(changed.status).toBe(200);
    expect(changed.body.data).toMatchObject({ type: 'task', bug: null, fixRelease: null });
    expect((await Release.findById(rel.body.data.id).lean())!.taskIds.map(String)).not.toContain(
      bug.id,
    );
    // An epic with children cannot change type; removing a component strips it from tasks
    expect((await patch(pm, epic.id, { type: 'task' })).status).toBe(422);
    await api()
      .put(`/api/v1/projects/${project.id}/agile-settings`)
      .set(pm.auth)
      .send({ components: [{ name: 'Web' }] });
    expect((await api().get(`/api/v1/tasks/${bug.id}`).set(dev.auth)).body.data.components).toEqual(
      [],
    );

    // Filters and epic progress
    const stories = await api()
      .get(`/api/v1/tasks?projectId=${project.id}&type=story`)
      .set(dev.auth);
    expect(stories.body.data.map((t: { id: string }) => t.id)).toEqual([story.id]);
    await patch(dev, story.id, { status: 'in_progress' });
    await patch(dev, story.id, { status: 'done', remainingHours: 0 });
    const epics = await api().get(`/api/v1/projects/${project.id}/epics`).set(dev.auth);
    expect(epics.body.data[0]).toMatchObject({
      id: epic.id,
      childCount: 1,
      childDone: 1,
      points: 5,
      donePoints: 5,
      percent: 100,
    });
  });
});

describe('sprints', () => {
  it('plans, starts, charts and completes a sprint, carrying unfinished work over', async () => {
    const { pm, dev, project } = await setup();
    const a = await created(dev, { projectId: project.id, title: 'Login page', storyPoints: 3 });
    const b = await created(dev, { projectId: project.id, title: 'Logout', storyPoints: 2 });
    const c = await created(dev, { projectId: project.id, title: 'Remember me', storyPoints: 5 });
    await created(dev, { projectId: project.id, title: 'Sub of a', parentId: a.id });

    const s1 = await api()
      .post('/api/v1/sprints')
      .set(pm.auth)
      .send({ projectId: project.id, goal: 'Sign-in works' });
    expect(s1.status).toBe(201);
    expect(s1.body.data).toMatchObject({ name: `${project.key} Sprint 1`, status: 'planned' });
    const sprintId = s1.body.data.id as string;
    expect(
      (await api().post('/api/v1/sprints').set(dev.auth).send({ projectId: project.id })).status,
    ).toBe(403);
    expect(
      (
        await api()
          .post(`/api/v1/sprints/${sprintId}/start`)
          .set(pm.auth)
          .send({ startDate: '2026-11-02', endDate: '2026-11-13' })
      ).status,
    ).toBe(422);

    const scope = await api()
      .post('/api/v1/sprints/scope')
      .set(pm.auth)
      .send({ taskIds: [a.id, b.id, c.id], sprintId });
    expect(scope.status).toBe(200);
    expect(await Task.countDocuments({ sprintId })).toBe(4); // subtask follows its parent
    expect(
      (
        await api()
          .post('/api/v1/sprints/scope')
          .set(dev.auth)
          .send({ taskIds: [a.id], sprintId: null })
      ).status,
    ).toBe(403);

    const started = await api()
      .post(`/api/v1/sprints/${sprintId}/start`)
      .set(pm.auth)
      .send({ startDate: '2026-11-02', endDate: '2026-11-13' });
    expect(started.status).toBe(200);
    expect(started.body.data).toMatchObject({
      status: 'active',
      committedPoints: 10,
      taskCount: 3,
    });
    const s2 = await api().post('/api/v1/sprints').set(pm.auth).send({ projectId: project.id });
    await api()
      .post('/api/v1/sprints/scope')
      .set(pm.auth)
      .send({ taskIds: [c.id], sprintId: s2.body.data.id });
    await api()
      .post('/api/v1/sprints/scope')
      .set(pm.auth)
      .send({ taskIds: [c.id], sprintId });
    const another = await created(dev, { projectId: project.id, title: 'Extra' });
    await api()
      .post('/api/v1/sprints/scope')
      .set(pm.auth)
      .send({ taskIds: [another.id], sprintId: s2.body.data.id });
    expect(
      (
        await api()
          .post(`/api/v1/sprints/${s2.body.data.id}/start`)
          .set(pm.auth)
          .send({ startDate: '2026-11-02', endDate: '2026-11-13' })
      ).status,
    ).toBe(409);

    // Work: a done (startedAt recorded), b in progress, c untouched
    await patch(dev, a.id, { status: 'in_progress' });
    const doneA = await patch(dev, a.id, { status: 'done' });
    expect(doneA.body.data.startedAt).toBeTruthy();
    await patch(dev, b.id, { status: 'in_progress' });
    const active = await api()
      .get(`/api/v1/tasks?projectId=${project.id}&sprintId=active&parentId=none`)
      .set(dev.auth);
    expect(active.body.meta.total).toBe(3);

    const chart = await api().get(`/api/v1/sprints/${sprintId}/chart`).set(dev.auth);
    expect(chart.status).toBe(200);
    expect(chart.body.data.committed).toBe(10);
    const lastDay = chart.body.data.days.at(-1);
    expect(lastDay).toMatchObject({ scope: 10, completed: 3, remaining: 7 });
    expect(chart.body.data.days[0].ideal).toBe(10);

    const done = await api()
      .post(`/api/v1/sprints/${sprintId}/complete`)
      .set(pm.auth)
      .send({ moveOpenTo: s2.body.data.id });
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({
      status: 'completed',
      completedPoints: 3,
      carriedOver: 2,
    });
    expect((await Task.findById(b.id).lean())!.sprintId!.toString()).toBe(s2.body.data.id);
    expect((await Task.findById(a.id).lean())!.sprintId!.toString()).toBe(sprintId);
    const vel = await api().get(`/api/v1/agile/velocity?projectId=${project.id}`).set(dev.auth);
    expect(vel.body.data).toEqual({
      sprints: [{ id: sprintId, name: `${project.key} Sprint 1`, committed: 10, completed: 3 }],
      average: 3,
    });
    // Completed sprints are closed for planning and editing
    expect((await patch(dev, another.id, { sprintId })).status).toBe(422);
    expect(
      (await api().patch(`/api/v1/sprints/${sprintId}`).set(pm.auth).send({ name: 'x' })).status,
    ).toBe(422);
    const backlog = await api().get(`/api/v1/projects/${project.id}/backlog`).set(dev.auth);
    expect(backlog.body.data.sprints.map((s: { id: string }) => s.id)).toEqual([s2.body.data.id]);
    expect(backlog.body.data.sprints[0].tasks).toHaveLength(3);
    expect(backlog.body.data.canPlan).toBe(false);
  });
});

describe('links, clone, move, restore and backlog order', () => {
  it('links tasks both ways, clones with subtasks, moves between projects and restores deleted work', async () => {
    const { pm, dev, project, other } = await setup();
    const a = await created(dev, {
      projectId: project.id,
      title: 'Payment gateway',
      type: 'story',
      storyPoints: 8,
    });
    const b = await created(dev, { projectId: project.id, title: 'Payment gateway (dup)' });
    await created(dev, { projectId: project.id, title: 'Sandbox keys', parentId: a.id });

    const link = await api()
      .post(`/api/v1/tasks/${b.id}/links`)
      .set(dev.auth)
      .send({ type: 'duplicates', taskId: a.id });
    expect(link.status).toBe(200);
    expect(link.body.data.links).toEqual([
      expect.objectContaining({
        direction: 'outward',
        label: 'duplicates',
        task: expect.objectContaining({ id: a.id }),
      }),
    ]);
    const inward = await api().get(`/api/v1/tasks/${a.id}`).set(dev.auth);
    expect(inward.body.data.links).toEqual([
      expect.objectContaining({ direction: 'inward', label: 'is duplicated by' }),
    ]);
    expect(
      (
        await api()
          .post(`/api/v1/tasks/${b.id}/links`)
          .set(dev.auth)
          .send({ type: 'duplicates', taskId: a.id })
      ).status,
    ).toBe(409);
    expect(
      (
        await api()
          .post(`/api/v1/tasks/${b.id}/links`)
          .set(dev.auth)
          .send({ type: 'relates', taskId: b.id })
      ).status,
    ).toBe(422);
    const unlinked = await api()
      .delete(`/api/v1/tasks/${a.id}/links/duplicates/${b.id}`)
      .set(dev.auth);
    expect(unlinked.status).toBe(200);
    expect(unlinked.body.data.links).toEqual([]);

    const clone = await api().post(`/api/v1/tasks/${a.id}/clone`).set(dev.auth).send({});
    expect(clone.status).toBe(201);
    expect(clone.body.data).toMatchObject({
      title: 'Payment gateway',
      type: 'story',
      storyPoints: 8,
      status: 'todo',
      subtaskCount: 1,
    });
    expect(clone.body.data.links[0]).toMatchObject({
      type: 'clones',
      label: 'is a clone of',
      task: { id: a.id },
    });

    const rel = await api()
      .post('/api/v1/releases')
      .set(pm.auth)
      .send({ projectId: project.id, version: '2.0.0' });
    await patch(dev, a.id, { fixReleaseId: rel.body.data.id });
    const moved = await api()
      .post(`/api/v1/tasks/${a.id}/move-project`)
      .set(pm.auth)
      .send({ projectId: other.id });
    expect(moved.status).toBe(200);
    expect(moved.body.data.key).toMatch(new RegExp(`^${other.key}-\\d+$`));
    expect(moved.body.data).toMatchObject({
      project: { id: other.id },
      previousKeys: [a.key],
      fixRelease: null,
    });
    expect((await Task.findOne({ parentId: a.id }).lean())!.projectId.toString()).toBe(other.id);
    expect((await Release.findById(rel.body.data.id).lean())!.taskIds).toHaveLength(0);
    const found = await api()
      .get(`/api/v1/tasks?q=${encodeURIComponent(a.key)}`)
      .set(dev.auth);
    expect(found.body.data.map((t: { id: string }) => t.id)).toContain(a.id);

    // Delete, then restore (managers only)
    expect((await api().delete(`/api/v1/tasks/${clone.body.data.id}`).set(pm.auth)).status).toBe(
      204,
    );
    expect(
      (await api().get(`/api/v1/projects/${project.id}/deleted-tasks`).set(dev.auth)).status,
    ).toBe(403);
    const trash = await api().get(`/api/v1/projects/${project.id}/deleted-tasks`).set(pm.auth);
    expect(trash.body.data.map((t: { id: string }) => t.id)).toEqual([clone.body.data.id]);
    const restored = await api().post(`/api/v1/tasks/${clone.body.data.id}/restore`).set(pm.auth);
    expect(restored.status).toBe(200);
    expect(restored.body.data.subtaskCount).toBe(1);

    // Backlog order
    const c = await created(dev, { projectId: project.id, title: 'Third' });
    await Task.updateMany({ projectId: project.id }, { $set: { backlogRank: null } }); // tasks from before 9A have none
    const ranked = await api()
      .post(`/api/v1/tasks/${c.id}/backlog-rank`)
      .set(dev.auth)
      .send({ afterId: b.id });
    expect(ranked.status).toBe(200);
    const backlog = await api().get(`/api/v1/projects/${project.id}/backlog`).set(dev.auth);
    const keys = backlog.body.data.backlog.map((t: { id: string }) => t.id);
    expect(keys.indexOf(c.id)).toBeLessThan(keys.indexOf(b.id));
  });
});

describe('flow and defect reports', () => {
  it('reports cycle and lead time and open bugs by severity', async () => {
    const { dev, project } = await setup();
    const t1 = await created(dev, {
      projectId: project.id,
      title: 'Quick fix',
      type: 'bug',
      bug: { severity: 'minor' },
    });
    await created(dev, {
      projectId: project.id,
      title: 'Crash on save',
      type: 'bug',
      bug: { severity: 'blocker', regression: true },
    });
    const t3 = await created(dev, { projectId: project.id, title: 'Feature' });
    await patch(dev, t1.id, { status: 'in_progress' });
    await patch(dev, t1.id, { status: 'done' });
    await patch(dev, t3.id, { status: 'in_progress' });
    await patch(dev, t3.id, { status: 'done' });
    // Make the durations measurable
    const day = 86_400_000;
    await Task.collection.updateOne(
      { _id: new Types.ObjectId(t1.id) },
      {
        $set: {
          createdAt: new Date(Date.now() - 4 * day),
          startedAt: new Date(Date.now() - 2 * day),
        },
      },
    );
    await Task.collection.updateOne(
      { _id: new Types.ObjectId(t3.id) },
      {
        $set: {
          createdAt: new Date(Date.now() - 6 * day),
          startedAt: new Date(Date.now() - 4 * day),
        },
      },
    );

    const ct = await api()
      .get(`/api/v1/agile/cycle-time?projectId=${project.id}&days=30`)
      .set(dev.auth);
    expect(ct.status).toBe(200);
    expect(ct.body.data.cycle).toMatchObject({ median: 3, average: 3, count: 2 });
    expect(ct.body.data.lead).toMatchObject({ median: 5, count: 2 });
    expect(ct.body.data.byType.find((x: { type: string }) => x.type === 'bug')).toMatchObject({
      median: 2,
      count: 1,
    });

    const defects = await api()
      .get(`/api/v1/agile/defects?projectId=${project.id}&days=30`)
      .set(dev.auth);
    expect(defects.body.data).toMatchObject({
      open: 1,
      openBySeverity: { blocker: 1, critical: 0, major: 0, minor: 0, trivial: 0 },
      regressionsOpen: 1,
      averageResolutionDays: 4,
    });
    const weeks = defects.body.data.weeks as { created: number; resolved: number }[];
    expect(weeks.reduce((n, w) => n + w.resolved, 0)).toBe(1);
  });
});
