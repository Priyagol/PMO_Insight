import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { eventBus } from '../src/core/events';
import { Notification } from '../src/modules/notifications/notification.model';
import { Task } from '../src/modules/tasks/task.model';
import {
  registerServiceDeskSubscribers,
  scanSlas,
} from '../src/modules/servicedesk/servicedesk.service';
import { createDepartment, loginAs, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);
let stop: (() => void) | undefined;
beforeEach(() => {
  stop?.();
  stop = registerServiceDeskSubscribers();
});

const FIELDS = [
  {
    key: 'category',
    label: 'Category',
    type: 'select',
    required: true,
    options: ['Hardware', 'Software'],
  },
  {
    key: 'asset_tag',
    label: 'Asset tag',
    type: 'text',
    required: true,
    showIf: { field: 'category', equals: 'Hardware' },
  },
  { key: 'details', label: 'Details', type: 'textarea' },
  { key: 'confirm', label: 'I have restarted the device', type: 'checkbox', required: true },
];

let seq = 0;
async function setup() {
  seq += 1;
  const dept = await createDepartment(`SD${seq}`);
  const other = await createDepartment(`SE${seq}`);
  const pm = await loginAs(h.app, 'project_manager', { departmentId: dept._id });
  const agent1 = await loginAs(h.app, 'developer', { departmentId: dept._id });
  const agent2 = await loginAs(h.app, 'qa_tester', { departmentId: dept._id });
  const employee = await loginAs(h.app, 'employee', { departmentId: other._id });
  const p = (
    await api()
      .post('/api/v1/projects')
      .set(pm.auth)
      .send({
        key: `SD${seq}`,
        name: 'IT Help Desk',
        managerId: pm.user._id.toString(),
        departmentId: dept._id.toString(),
        memberIds: [agent1.user._id.toString(), agent2.user._id.toString()],
      })
  ).body.data as { id: string };
  return { pm, agent1, agent2, employee, projectId: p.id };
}

async function enable(s: Awaited<ReturnType<typeof setup>>, type: Record<string, unknown> = {}) {
  await api()
    .put(`/api/v1/service-desk/projects/${s.projectId}/settings`)
    .set(s.pm.auth)
    .send({
      enabled: true,
      agentIds: [s.agent1.user._id.toString(), s.agent2.user._id.toString()],
      autoAssign: 'round_robin',
    })
    .expect(200);
  const t = await api()
    .post(`/api/v1/service-desk/projects/${s.projectId}/request-types`)
    .set(s.pm.auth)
    .send({
      name: 'Laptop problem',
      kind: 'service_request',
      fields: FIELDS,
      sla: { responseHours: 1, resolutionHours: 8 },
      ...type,
    });
  expect(t.status).toBe(201);
  return t.body.data as { id: string };
}

describe('Service desk setup and help centre', () => {
  it('lets the project manager set up request types and anyone raise requests with validated forms', async () => {
    const s = await setup();
    expect(
      (
        await api()
          .put(`/api/v1/service-desk/projects/${s.projectId}/settings`)
          .set(s.agent1.auth)
          .send({ enabled: true })
      ).status,
    ).toBe(403);
    const badForm = await api()
      .post(`/api/v1/service-desk/projects/${s.projectId}/request-types`)
      .set(s.pm.auth)
      .send({
        name: 'Bad',
        fields: [{ key: 'a', label: 'A', type: 'text', showIf: { field: 'later', equals: 'x' } }],
      });
    expect(badForm.status).toBe(400);
    const type = await enable(s);

    const portal = await api().get('/api/v1/service-desk/portal').set(s.employee.auth);
    expect(portal.body.data.map((t: { name: string }) => t.name)).toContain('Laptop problem');

    const submit = (answers: Record<string, unknown>) =>
      api()
        .post('/api/v1/service-desk/requests')
        .set(s.employee.auth)
        .send({ requestTypeId: type.id, summary: 'Laptop will not boot', answers });
    const missing = await submit({ category: 'Hardware', confirm: true });
    expect(missing.status).toBe(422);
    expect(missing.body.error.details.fields).toEqual({ asset_tag: 'Required' });
    // The conditional field is not needed for software problems, and hidden answers are dropped.
    const first = await submit({ category: 'Software', confirm: true, asset_tag: 'ignored' });
    expect(first.status).toBe(201);
    expect(first.body.data.answers.map((a: { key: string }) => a.key)).toEqual([
      'category',
      'details',
      'confirm',
    ]);
    const second = await submit({ category: 'Hardware', asset_tag: 'AC-1001', confirm: true });
    // Round robin: two requests go to two different agents.
    expect(new Set([first.body.data.assignee.id, second.body.data.assignee.id]).size).toBe(2);
    expect(second.body.data.sla.response.state).toBe('running');

    // The requester is not on the project: no task access, but their own requests are visible.
    expect(
      (await api().get(`/api/v1/tasks/${first.body.data.id}`).set(s.employee.auth)).status,
    ).toBe(404);
    const mine = await api().get('/api/v1/service-desk/requests/mine').set(s.employee.auth);
    expect(mine.body.data).toHaveLength(2);
    const task = await api().get(`/api/v1/tasks/${first.body.data.id}`).set(s.pm.auth);
    expect(task.body.data.description).toContain('**Category:** Software');
    // The requester is recorded on the request, not as the task's reporter or a watcher.
    expect(task.body.data.reporter.id).toBe(s.pm.user._id.toString());
    expect(task.body.data.watcherIds).not.toContain(s.employee.user._id.toString());
    expect(first.body.data.requester.id).toBe(s.employee.user._id.toString());
  });
});

describe('Conversation, SLA clocks and queues', () => {
  it('separates internal comments from replies, starts the response clock and escalates breaches once', async () => {
    const s = await setup();
    const type = await enable(s);
    const req = (
      await api()
        .post('/api/v1/service-desk/requests')
        .set(s.employee.auth)
        .send({
          requestTypeId: type.id,
          summary: 'Cannot print',
          answers: { category: 'Software', confirm: true },
        })
    ).body.data as { id: string; assignee: { id: string } };
    const agent = req.assignee.id === s.agent1.user._id.toString() ? s.agent1 : s.agent2;

    await api()
      .post(`/api/v1/tasks/${req.id}/comments`)
      .set(agent.auth)
      .send({ body: 'Internal: driver issue?' })
      .expect(201);
    await api()
      .post(`/api/v1/service-desk/requests/${req.id}/comments`)
      .set(s.employee.auth)
      .send({ body: 'It says offline' })
      .expect(201);
    expect(
      (await api().get(`/api/v1/service-desk/requests/${req.id}`).set(s.employee.auth)).body.data
        .sla.response.doneAt,
    ).toBeNull();
    const reply = await api()
      .post(`/api/v1/service-desk/requests/${req.id}/comments`)
      .set(agent.auth)
      .send({ body: 'Reinstalling the driver now' });
    expect(
      reply.body.data.map((c: { body: string; fromTeam: boolean }) => [c.body, c.fromTeam]),
    ).toEqual([
      ['It says offline', false],
      ['Reinstalling the driver now', true],
    ]);
    const asRequester = await api()
      .get(`/api/v1/service-desk/requests/${req.id}/comments`)
      .set(s.employee.auth);
    expect(JSON.stringify(asRequester.body.data)).not.toContain('Internal');
    const teamView = await api().get(`/api/v1/tasks/${req.id}/comments`).set(agent.auth);
    expect(teamView.body.data.map((c: { body: string }) => c.body)).toContain('It says offline');
    expect(
      (await api().get(`/api/v1/service-desk/requests/${req.id}`).set(s.employee.auth)).body.data
        .sla.response.state,
    ).toBe('met');

    // Resolution: at risk in the last quarter, breached after 8 hours; each alert only once.
    const created = (await Task.findById(req.id).lean())!.createdAt.getTime();
    expect(await scanSlas(new Date(created + 7 * 3_600_000))).toBe(1);
    expect(await scanSlas(new Date(created + 7.5 * 3_600_000))).toBe(0);
    expect(await scanSlas(new Date(created + 9 * 3_600_000))).toBe(1);
    expect(await Notification.countDocuments({ userId: s.pm.user._id, type: 'risk_alert' })).toBe(
      1,
    );

    await Task.updateOne(
      { _id: req.id },
      { $set: { 'serviceRequest.resolutionDueAt': new Date(Date.now() - 60_000) } },
    );
    const breached = await api()
      .get(`/api/v1/service-desk/projects/${s.projectId}/queue?view=breached`)
      .set(s.pm.auth);
    expect(breached.body.data.map((r: { id: string }) => r.id)).toEqual([req.id]);
    const mineQueue = await api()
      .get(`/api/v1/service-desk/projects/${s.projectId}/queue?view=mine`)
      .set(agent.auth);
    expect(mineQueue.body.data).toHaveLength(1);
    expect(
      (await api().get(`/api/v1/service-desk/projects/${s.projectId}/queue`).set(s.employee.auth))
        .status,
    ).toBe(404);
  });

  it('counts a status change as the first response, and collects ratings for the report', async () => {
    const s = await setup();
    const type = await enable(s);
    const req = (
      await api()
        .post('/api/v1/service-desk/requests')
        .set(s.employee.auth)
        .send({
          requestTypeId: type.id,
          summary: 'New mouse',
          answers: { category: 'Hardware', asset_tag: 'AC-7', confirm: true },
        })
    ).body.data as { id: string };
    await api()
      .patch(`/api/v1/tasks/${req.id}`)
      .set(s.pm.auth)
      .send({ status: 'in_progress' })
      .expect(200);
    await eventBus.settle();
    expect((await Task.findById(req.id).lean())!.serviceRequest!.firstResponseAt).not.toBeNull();
    expect(
      (
        await api()
          .post(`/api/v1/service-desk/requests/${req.id}/feedback`)
          .set(s.employee.auth)
          .send({ rating: 5 })
      ).status,
    ).toBe(422);
    await api()
      .patch(`/api/v1/tasks/${req.id}`)
      .set(s.pm.auth)
      .send({ status: 'done' })
      .expect(200);
    expect(
      (
        await api()
          .post(`/api/v1/service-desk/requests/${req.id}/feedback`)
          .set(s.pm.auth)
          .send({ rating: 1 })
      ).status,
    ).toBe(403);
    const rated = await api()
      .post(`/api/v1/service-desk/requests/${req.id}/feedback`)
      .set(s.employee.auth)
      .send({ rating: 5, comment: 'Quick' });
    expect(rated.body.data.feedback).toEqual({ rating: 5, comment: 'Quick' });
    const report = await api()
      .get(`/api/v1/service-desk/projects/${s.projectId}/report`)
      .set(s.pm.auth);
    expect(report.body.data).toMatchObject({
      open: 0,
      resolvedLast30: 1,
      averageRating: 5,
      ratings: 1,
      responseSlaMetPercent: 100,
      resolutionSlaMetPercent: 100,
    });
  });
});

describe('Approvals and incidents', () => {
  it('holds requests that need approval and raises major incidents to the project manager', async () => {
    const s = await setup();
    const type = await enable(s, { name: 'New software licence', approvalRequired: true });
    const req = (
      await api()
        .post('/api/v1/service-desk/requests')
        .set(s.employee.auth)
        .send({
          requestTypeId: type.id,
          summary: 'Figma licence',
          answers: { category: 'Software', confirm: true },
        })
    ).body.data as { id: string; status: string; awaitingApproval: boolean };
    expect(req).toMatchObject({ status: 'backlog', awaitingApproval: true });
    const approvals = await api().get('/api/v1/approvals?box=inbox').set(s.pm.auth);
    const approval = (approvals.body.data as { id: string; entityType: string }[]).find(
      (a) => a.entityType === 'service_request',
    )!;
    await api()
      .post(`/api/v1/approvals/${approval.id}/approve`)
      .set(s.pm.auth)
      .send({})
      .expect(200);
    const after = await api().get(`/api/v1/service-desk/requests/${req.id}`).set(s.employee.auth);
    expect(after.body.data).toMatchObject({ status: 'todo', awaitingApproval: false });

    const incident = await api()
      .post(`/api/v1/service-desk/projects/${s.projectId}/request-types`)
      .set(s.pm.auth)
      .send({ name: 'Trading system down', kind: 'incident', requesterSetsPriority: true });
    const raised = await api().post('/api/v1/service-desk/requests').set(s.employee.auth).send({
      requestTypeId: incident.body.data.id,
      summary: 'Order entry failing',
      priority: 'critical',
    });
    expect(raised.body.data).toMatchObject({ kind: 'incident', priority: 'critical' });
    const alerts = await Notification.find({ userId: s.pm.user._id, type: 'risk_alert' }).lean();
    expect(alerts.map((a) => a.title)).toEqual([expect.stringContaining('Major incident')]);
  });
});
