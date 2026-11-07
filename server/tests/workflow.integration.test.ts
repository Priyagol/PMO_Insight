import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/audit-log.model';
import { createDepartment, loginAs, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);

const DEFINITION = {
  statuses: ['todo', 'in_progress', 'in_review', 'done'],
  labels: { in_review: 'Code review' },
  required: { done: ['estimatedHours'] },
  transitions: [
    {
      id: 'start',
      name: 'Start work',
      from: ['todo'],
      to: 'in_progress',
      actions: ['assign_actor'],
    },
    {
      id: 'review',
      name: 'Send to code review',
      from: ['in_progress'],
      to: 'in_review',
      conditions: ['checklist_done'],
      requireComment: true,
      actions: ['notify_watchers'],
    },
    { id: 'back', name: 'Rework', from: ['in_review'], to: 'in_progress' },
    { id: 'accept', name: 'Accept', from: ['in_review'], to: 'done', roles: ['project_manager'] },
    { id: 'reopen', name: 'Reopen', from: ['*'], to: 'todo', approval: true },
  ],
};

let seq = 0;
async function setup() {
  seq += 1;
  const dept = await createDepartment(`WF${seq}`);
  const admin = await loginAs(h.app, 'super_admin');
  const pm = await loginAs(h.app, 'project_manager', { departmentId: dept._id });
  const dev = await loginAs(h.app, 'developer', { departmentId: dept._id, managerId: pm.user._id });
  const key = `WF${seq}`;
  const p = await api()
    .post('/api/v1/projects')
    .set(pm.auth)
    .send({
      key,
      name: 'Workflow Project',
      managerId: pm.user._id.toString(),
      departmentId: dept._id.toString(),
      memberIds: [dev.user._id.toString()],
    });
  expect(p.status).toBe(201);
  const mk = async (body: Record<string, unknown> = {}) => {
    const r = await api()
      .post('/api/v1/tasks')
      .set(dev.auth)
      .send({ projectId: p.body.data.id, title: `Task ${Math.random()}`, ...body });
    expect(r.status).toBe(201);
    return r.body.data as { id: string; key: string; status: string };
  };
  return { admin, pm, dev, key, projectId: p.body.data.id as string, mk };
}

const patch = (auth: Record<string, string>, id: string, body: Record<string, unknown>) =>
  api().patch(`/api/v1/tasks/${id}`).set(auth).send(body);

describe('Workflow library', () => {
  it('lets administrators manage workflows, validates them and protects ones in use', async () => {
    const { admin, dev, pm, projectId } = await setup();
    const denied = await api()
      .post('/api/v1/workflows')
      .set(dev.auth)
      .send({ name: 'Mine', definition: DEFINITION });
    expect(denied.status).toBe(403);

    const unreachable = await api()
      .post('/api/v1/workflows')
      .set(admin.auth)
      .send({
        name: 'Broken',
        definition: {
          ...DEFINITION,
          transitions: DEFINITION.transitions.filter((t) => t.id !== 'accept'),
        },
      });
    expect(unreachable.status).toBe(400);
    expect(JSON.stringify(unreachable.body.error)).toContain('No transition leads to Done');

    const created = await api()
      .post('/api/v1/workflows')
      .set(admin.auth)
      .send({ name: `Code review flow ${seq}`, definition: DEFINITION });
    expect(created.status).toBe(201);
    const wid = created.body.data.id as string;
    expect(
      (
        await api()
          .post('/api/v1/workflows')
          .set(admin.auth)
          .send({ name: `Code review flow ${seq}`, definition: DEFINITION })
      ).status,
    ).toBe(409);

    await api()
      .put(`/api/v1/projects/${projectId}/workflow`)
      .set(pm.auth)
      .send({ workflowId: wid })
      .expect(200);
    expect((await api().delete(`/api/v1/workflows/${wid}`).set(admin.auth)).status).toBe(409);
    expect(await AuditLog.countDocuments({ action: 'workflow.created' })).toBeGreaterThanOrEqual(1);
  });
});

describe('Switching a project to a workflow', () => {
  it('requires a destination for statuses the new workflow does not use, then moves the tasks', async () => {
    const { admin, pm, dev, projectId, mk } = await setup();
    const testing = await mk({ status: 'in_progress' });
    await patch(pm.auth, testing.id, { status: 'testing' }).expect(200);
    const wid = (
      await api()
        .post('/api/v1/workflows')
        .set(admin.auth)
        .send({ name: `Switch flow ${seq}`, definition: DEFINITION })
    ).body.data.id as string;

    expect(
      (
        await api()
          .put(`/api/v1/projects/${projectId}/workflow`)
          .set(dev.auth)
          .send({ workflowId: wid })
      ).status,
    ).toBe(403);
    const refused = await api()
      .put(`/api/v1/projects/${projectId}/workflow`)
      .set(pm.auth)
      .send({ workflowId: wid });
    expect(refused.status).toBe(422);
    expect(refused.body.error.details.unmapped).toEqual([{ status: 'testing', count: 1 }]);

    const ok = await api()
      .put(`/api/v1/projects/${projectId}/workflow`)
      .set(pm.auth)
      .send({ workflowId: wid, statusMap: { testing: 'in_review' } });
    expect(ok.body.data).toEqual({ workflowId: wid, moved: 1 });
    const t = await api().get(`/api/v1/tasks/${testing.id}`).set(pm.auth);
    expect(t.body.data).toMatchObject({ status: 'in_review', statusLabel: 'Code review' });
    const project = await api().get(`/api/v1/projects/${projectId}`).set(pm.auth);
    expect(project.body.data.workflow).toMatchObject({ id: wid, statuses: DEFINITION.statuses });
    const hist = await api().get(`/api/v1/tasks/${testing.id}/transitions/history`).set(pm.auth);
    expect(hist.body.data.at(-1)).toMatchObject({
      from: 'testing',
      to: 'in_review',
      via: 'workflow_change',
    });

    // New tasks start in a status the workflow uses.
    const fresh = await mk({ status: 'backlog' });
    expect(fresh.status).toBe('todo');
  });
});

describe('Transitions', () => {
  it('enforces transitions, roles, conditions, comments and required fields, and records history', async () => {
    const { admin, pm, dev, projectId, mk } = await setup();
    const wid = (
      await api()
        .post('/api/v1/workflows')
        .set(admin.auth)
        .send({ name: `Rules flow ${seq}`, definition: DEFINITION })
    ).body.data.id as string;
    await api()
      .put(`/api/v1/projects/${projectId}/workflow`)
      .set(pm.auth)
      .send({ workflowId: wid })
      .expect(200);
    const t = await mk({ checklist: [{ text: 'Unit tests' }] });

    // Not a transition of this workflow, and a status it does not use.
    expect((await patch(dev.auth, t.id, { status: 'done' })).body.error.message).toContain(
      'cannot move from To Do to Done',
    );
    expect((await patch(dev.auth, t.id, { status: 'testing' })).body.error.message).toContain(
      'not used',
    );

    // Start work assigns the person who moves it.
    const started = await patch(dev.auth, t.id, { status: 'in_progress' });
    expect(started.status).toBe(200);
    expect(started.body.data.assignee.id).toBe(dev.user._id.toString());

    const avail = await api().get(`/api/v1/tasks/${t.id}/transitions`).set(dev.auth);
    expect(avail.body.data.workflow.labels).toEqual({ in_review: 'Code review' });
    expect(avail.body.data.transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'review',
          toLabel: 'Code review',
          requireComment: true,
          blockers: ['1 checklist item(s) are not done'],
        }),
      ]),
    );

    expect(
      (await patch(dev.auth, t.id, { status: 'in_review', transitionComment: 'Ready' })).body.error
        .message,
    ).toContain('checklist item');
    const cl = (await api().get(`/api/v1/tasks/${t.id}`).set(dev.auth)).body.data.checklist;
    expect(
      (
        await patch(dev.auth, t.id, {
          status: 'in_review',
          checklist: cl.map((c: object) => ({ ...c, done: true })),
        })
      ).body.error.message,
    ).toContain('needs a comment');
    const reviewed = await patch(dev.auth, t.id, {
      status: 'in_review',
      checklist: cl.map((c: object) => ({ ...c, done: true })),
      transitionComment: 'Ready for review',
    });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.data.statusLabel).toBe('Code review');
    const comments = await api().get(`/api/v1/tasks/${t.id}/comments`).set(dev.auth);
    expect(comments.body.data.map((c: { body: string }) => c.body)).toContain('Ready for review');

    // Accept: only project managers, and Done needs an estimate.
    expect((await patch(dev.auth, t.id, { status: 'done' })).status).toBe(403);
    expect((await patch(pm.auth, t.id, { status: 'done' })).body.error.message).toContain(
      'Done needs: Estimate',
    );
    const done = await patch(pm.auth, t.id, { status: 'done', estimatedHours: 4 });
    expect(done.body.data.status).toBe('done');
    // A required field cannot be cleared while the task is in that status.
    expect((await patch(pm.auth, t.id, { estimatedHours: null })).body.error.message).toContain(
      'requires Estimate',
    );

    const hist = await api().get(`/api/v1/tasks/${t.id}/transitions/history`).set(dev.auth);
    expect(
      hist.body.data.map((x: { to: string; transition: string | null; via: string }) => [
        x.to,
        x.transition,
        x.via,
      ]),
    ).toEqual([
      ['todo', null, 'create'],
      ['in_progress', 'Start work', 'user'],
      ['in_review', 'Send to code review', 'user'],
      ['done', 'Accept', 'user'],
    ]);
    expect(hist.body.data[2]).toMatchObject({
      comment: 'Ready for review',
      by: { name: expect.any(String) },
    });
    expect(hist.body.data[1].durationMs).toBeGreaterThanOrEqual(0);

    // Board columns follow the workflow.
    const board = await api().get(`/api/v1/tasks/board?projectId=${projectId}`).set(pm.auth);
    expect(board.body.data.map((c: { status: string }) => c.status)).toEqual(DEFINITION.statuses);
  });

  it('routes moves that need approval through the Approvals module', async () => {
    const { admin, pm, dev, projectId, mk } = await setup();
    const wid = (
      await api()
        .post('/api/v1/workflows')
        .set(admin.auth)
        .send({ name: `Approval flow ${seq}`, definition: DEFINITION })
    ).body.data.id as string;
    await api()
      .put(`/api/v1/projects/${projectId}/workflow`)
      .set(pm.auth)
      .send({ workflowId: wid })
      .expect(200);
    const t = await mk();
    await patch(dev.auth, t.id, { status: 'in_progress' }).expect(200);

    // Reopen needs approval: the task stays where it is and an approval is raised.
    const asked = await patch(dev.auth, t.id, { status: 'todo' });
    expect(asked.status).toBe(200);
    expect(asked.body.data.status).toBe('in_progress');
    expect(asked.body.data.pendingTransition).toMatchObject({ to: 'todo' });
    expect((await patch(dev.auth, t.id, { status: 'todo' })).body.error.message).toContain(
      'already waiting',
    );

    const approvalId = asked.body.data.pendingTransition.approvalId as string;
    const approved = await api()
      .post(`/api/v1/approvals/${approvalId}/approve`)
      .set(pm.auth)
      .send({});
    expect(approved.status).toBe(200);
    const after = await api().get(`/api/v1/tasks/${t.id}`).set(dev.auth);
    expect(after.body.data).toMatchObject({ status: 'todo', pendingTransition: null });
    const hist = await api().get(`/api/v1/tasks/${t.id}/transitions/history`).set(dev.auth);
    expect(hist.body.data.at(-1)).toMatchObject({
      to: 'todo',
      transition: 'Reopen',
      via: 'approval',
    });

    // Dragging on the board asks for approval too; a rejection leaves the task where it is.
    await patch(dev.auth, t.id, { status: 'in_progress' }).expect(200);
    const moveRes = await api()
      .post(`/api/v1/tasks/${t.id}/move`)
      .set(dev.auth)
      .send({ status: 'todo' });
    expect(moveRes.body.data.pendingTransition).toMatchObject({ to: 'todo' });
    await api()
      .post(`/api/v1/approvals/${moveRes.body.data.pendingTransition.approvalId}/reject`)
      .set(pm.auth)
      .send({ comment: 'Not needed' })
      .expect(200);
    const kept = await api().get(`/api/v1/tasks/${t.id}`).set(dev.auth);
    expect(kept.body.data).toMatchObject({ status: 'in_progress', pendingTransition: null });
  });

  it('keeps the standard rules for projects without a custom workflow', async () => {
    const { dev, mk } = await setup();
    const t = await mk();
    expect((await patch(dev.auth, t.id, { status: 'done' })).body.error.message).toContain(
      'cannot move from To Do to Done',
    );
    expect((await patch(dev.auth, t.id, { status: 'in_progress' })).status).toBe(200);
    const avail = await api().get(`/api/v1/tasks/${t.id}/transitions`).set(dev.auth);
    expect(avail.body.data.workflow).toMatchObject({ id: null, name: 'Standard workflow' });
  });
});
