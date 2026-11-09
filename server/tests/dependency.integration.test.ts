import type { Types } from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { addDaysIso, orgToday } from '../src/core/time';
import { Project } from '../src/modules/projects/project.model';
import { Task } from '../src/modules/tasks/task.model';
import { TaskTransition } from '../src/modules/workflows/workflow.models';
import { createDepartment, loginAs, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);
const today = orgToday();

describe('dependencies & blockers', () => {
  it('shows what waits on what, what is blocked and which project links put dates at risk', async () => {
    const dept = await createDepartment('DEP');
    const pm = await loginAs(h.app, 'project_manager', { departmentId: dept._id });
    const dev = await loginAs(h.app, 'developer', { departmentId: dept._id });
    const mkProject = async (key: string, endDate: string) => {
      const r = await api()
        .post('/api/v1/projects')
        .set(pm.auth)
        .send({
          key,
          name: `${key} project`,
          managerId: pm.user._id.toString(),
          memberIds: [dev.user._id.toString()],
          startDate: addDaysIso(today, -30),
          endDate,
        });
      expect(r.status).toBe(201);
      return r.body.data as { id: string; key: string };
    };
    const app = await mkProject('APP', addDaysIso(today, 20));
    const api2 = await mkProject('API', addDaysIso(today, 40));
    // An outsider's project the PM cannot open.
    const other = await loginAs(h.app, 'project_manager');
    const hidden = await Project.create({
      key: 'HID',
      name: 'Hidden',
      managerId: other.user._id,
      ownerId: other.user._id,
    });
    let n = 0;
    const mk = (projectId: string | Types.ObjectId, over: Record<string, unknown>) =>
      Task.create({
        key: `T-${++n}`,
        projectId,
        title: `Task ${n}`,
        reporterId: pm.user._id,
        assigneeId: dev.user._id,
        rank: String(n),
        ...over,
      });
    const lateUpstream = await mk(api2.id, {
      status: 'in_progress',
      dueDate: addDaysIso(today, -3),
    });
    const slowUpstream = await mk(app.id, { status: 'todo', dueDate: addDaysIso(today, 15) });
    const doneUpstream = await mk(app.id, { status: 'done' });
    const hiddenUpstream = await mk(hidden._id, { status: 'todo' });
    const a = await mk(app.id, {
      status: 'todo',
      dueDate: addDaysIso(today, 10),
      dependencyIds: [lateUpstream._id, slowUpstream._id, doneUpstream._id, hiddenUpstream._id],
    });
    await mk(app.id, { status: 'todo', dependencyIds: [lateUpstream._id] });
    const blocked = await mk(app.id, {
      status: 'blocked',
      blockedSince: new Date(Date.now() - 5 * 86_400_000),
    });
    await TaskTransition.create({
      taskId: blocked._id,
      projectId: app.id,
      from: 'in_progress',
      to: 'blocked',
      via: 'user',
      actorId: dev.user._id,
      comment: 'Waiting for firewall rule',
      at: new Date(Date.now() - 5 * 86_400_000),
    });
    // APP depends on API, which ends after APP is due.
    await Project.updateOne({ _id: app.id }, { $set: { dependsOn: [{ projectId: api2.id }] } });

    const res = await api().get('/api/v1/analytics/dependencies').set(pm.auth);
    expect(res.status).toBe(200);
    const d = res.body.data;
    const ofA = d.links.filter((l: { task: { id: string } }) => l.task.id === a._id.toString());
    const stateOf = (id: string) =>
      ofA.find((l: { dependsOn: { id: string } | null }) => l.dependsOn?.id === id)?.state;
    expect(stateOf(lateUpstream._id.toString())).toBe('late');
    expect(stateOf(slowUpstream._id.toString())).toBe('at_risk');
    expect(stateOf(doneUpstream._id.toString())).toBe('ready');
    // The hidden project's task is not revealed.
    const secret = ofA.find((l: { dependsOn: unknown }) => l.dependsOn === null);
    expect(secret.state).toBe('waiting');
    expect(JSON.stringify(d)).not.toContain('Hidden');
    expect(d.summary).toMatchObject({
      late: 2,
      atRisk: 1,
      crossProject: 3,
      blocked: 1,
      blockedOver3Days: 1,
      projectLinksAtRisk: 1,
    });
    expect(d.blocked[0]).toMatchObject({
      days: 5,
      note: 'Waiting for firewall rule',
      by: dev.user.name,
    });
    expect(d.holdingUpMost[0]).toMatchObject({
      task: { key: lateUpstream.key },
      dependents: 2,
    });
    expect(d.projects[0]).toMatchObject({ state: 'at_risk', dependsOn: { key: 'API' } });

    // Filtering by project narrows it.
    const onlyApi = await api()
      .get(`/api/v1/analytics/dependencies?projectId=${api2.id}`)
      .set(pm.auth);
    expect(onlyApi.body.data.links).toHaveLength(0);
  });
});
