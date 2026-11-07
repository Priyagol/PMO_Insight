import { createHmac, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eventBus } from '../src/core/events';
import { GitLink } from '../src/modules/integrations/git.models';
import {
  HookDelivery,
  OutboundHook,
  registerOutboundSubscribers,
  retryDueDeliveries,
} from '../src/modules/outbound/outbound.service';
import { createDepartment, loginAs, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);

/** A local receiver standing in for Slack, Teams, Zapier or a custom endpoint. */
const received: { path: string; headers: Record<string, string>; raw: string }[] = [];
let base = '';
let server: ReturnType<express.Express['listen']>;
let failNext = 0;
beforeAll(async () => {
  const app = express();
  app.use(express.text({ type: '*/*' }));
  app.post('/:name', (req, res) => {
    if (failNext > 0) {
      failNext -= 1;
      res.status(500).send('boom');
      return;
    }
    received.push({
      path: req.params.name,
      headers: req.headers as Record<string, string>,
      raw: req.body as string,
    });
    res.status(200).send('ok');
  });
  await new Promise<void>((r) => {
    server = app.listen(0, '127.0.0.1', () => r());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

let stop: (() => void) | undefined;
beforeEach(() => {
  received.length = 0;
  failNext = 0;
  stop?.();
  stop = registerOutboundSubscribers();
});

let seq = 0;
async function setup() {
  seq += 1;
  const dept = await createDepartment(`OB${seq}`);
  const admin = await loginAs(h.app, 'super_admin');
  const pm = await loginAs(h.app, 'project_manager', { departmentId: dept._id });
  const dev = await loginAs(h.app, 'developer', { departmentId: dept._id });
  const mkProject = async (key: string) =>
    (
      await api()
        .post('/api/v1/projects')
        .set(pm.auth)
        .send({
          key,
          name: `Project ${key}`,
          managerId: pm.user._id.toString(),
          memberIds: [dev.user._id.toString()],
        })
    ).body.data as { id: string; key: string };
  return { admin, pm, dev, mkProject };
}

describe('Outgoing webhooks and channels', () => {
  it('signs webhook deliveries and formats Slack and Teams messages; only administrators manage them', async () => {
    const { admin, pm, dev, mkProject } = await setup();
    expect(
      (
        await api()
          .post('/api/v1/integrations/outgoing')
          .set(dev.auth)
          .send({ name: 'x', kind: 'slack', url: `${base}/x`, events: ['task.created'] })
      ).status,
    ).toBe(403);
    const hook = await api()
      .post('/api/v1/integrations/outgoing')
      .set(admin.auth)
      .send({
        name: 'Zapier',
        kind: 'webhook',
        url: `${base}/hook`,
        events: ['task.created', 'task.status_changed'],
      });
    expect(hook.status).toBe(201);
    const secret = hook.body.data.secret as string;
    expect(secret.length).toBeGreaterThan(20);
    await api()
      .post('/api/v1/integrations/outgoing')
      .set(admin.auth)
      .send({ name: 'Team channel', kind: 'slack', url: `${base}/slack`, events: ['task.created'] })
      .expect(201);
    await api()
      .post('/api/v1/integrations/outgoing')
      .set(admin.auth)
      .send({ name: 'Teams', kind: 'teams', url: `${base}/teams`, events: ['task.status_changed'] })
      .expect(201);
    const list = await api().get('/api/v1/integrations/outgoing').set(admin.auth);
    expect(JSON.stringify(list.body.data)).not.toContain(secret);
    expect(list.body.data[0].urlPreview).toContain('127.0.0.1');

    const p = await mkProject(`OB${seq}`);
    const t = (
      await api()
        .post('/api/v1/tasks')
        .set(pm.auth)
        .send({ projectId: p.id, title: 'Margin report' })
    ).body.data;
    await api()
      .patch(`/api/v1/tasks/${t.id}`)
      .set(pm.auth)
      .send({ status: 'in_progress' })
      .expect(200);
    await eventBus.settle();

    const hooks = received.filter((r) => r.path === 'hook');
    expect(hooks.map((r) => JSON.parse(r.raw).event)).toEqual([
      'task.created',
      'task.status_changed',
    ]);
    const first = hooks[0]!;
    expect(first.headers['x-arihant-signature']).toBe(
      `sha256=${createHmac('sha256', secret).update(first.raw).digest('hex')}`,
    );
    expect(JSON.parse(first.raw).data.task).toMatchObject({ key: t.key, title: 'Margin report' });

    const slack = received.find((r) => r.path === 'slack')!;
    expect(JSON.parse(slack.raw).text).toContain(`${t.key} created`);
    const teams = received.find((r) => r.path === 'teams')!;
    const card = JSON.parse(teams.raw).attachments[0];
    expect(card.contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(card.content.body[0].text).toContain('moved from To Do to In Progress');

    const deliveries = await api()
      .get(`/api/v1/integrations/outgoing/${hook.body.data.id}/deliveries`)
      .set(admin.auth);
    expect(deliveries.body.data.map((d: { status: string }) => d.status)).toEqual([
      'delivered',
      'delivered',
    ]);
  });

  it('respects project filters and never sends restricted tasks or confidential projects', async () => {
    const { admin, pm, mkProject } = await setup();
    const a = await mkProject(`OA${seq}`);
    const b = await mkProject(`OC${seq}`);
    await api()
      .post('/api/v1/integrations/outgoing')
      .set(admin.auth)
      .send({
        name: 'Only A',
        kind: 'slack',
        url: `${base}/a`,
        events: ['task.created', 'task.status_changed'],
        projectIds: [a.id],
      })
      .expect(201);
    await api()
      .post('/api/v1/tasks')
      .set(pm.auth)
      .send({ projectId: b.id, title: 'In B' })
      .expect(201);
    const secretTask = (
      await api().post('/api/v1/tasks').set(pm.auth).send({ projectId: a.id, title: 'Salary file' })
    ).body.data;
    await eventBus.settle();
    expect(received.map((r) => JSON.parse(r.raw).text)).toEqual([
      expect.stringContaining('Salary file'),
    ]);

    received.length = 0;
    await api()
      .put(`/api/v1/tasks/${secretTask.id}/restriction`)
      .set(pm.auth)
      .send({ restricted: true })
      .expect(200);
    await api()
      .patch(`/api/v1/tasks/${secretTask.id}`)
      .set(pm.auth)
      .send({ status: 'in_progress' })
      .expect(200);
    await api()
      .put(`/api/v1/projects/${a.id}/confidential`)
      .set(pm.auth)
      .send({ confidential: true })
      .expect(200);
    await api()
      .post('/api/v1/tasks')
      .set(pm.auth)
      .send({ projectId: a.id, title: 'Board pack' })
      .expect(201);
    await eventBus.settle();
    expect(received).toEqual([]);
  });

  it('retries failed deliveries with back-off and switches off a destination that keeps failing', async () => {
    const { admin, pm, mkProject } = await setup();
    const hook = (
      await api()
        .post('/api/v1/integrations/outgoing')
        .set(admin.auth)
        .send({ name: 'Flaky', kind: 'webhook', url: `${base}/flaky`, events: ['task.created'] })
    ).body.data as { id: string };
    const p = await mkProject(`OF${seq}`);
    failNext = 1;
    await api()
      .post('/api/v1/tasks')
      .set(pm.auth)
      .send({ projectId: p.id, title: 'Retry me' })
      .expect(201);
    await eventBus.settle();
    const pending = await HookDelivery.findOne({ hookId: hook.id }).lean();
    expect(pending).toMatchObject({ status: 'pending', attempts: 1, httpStatus: 500 });
    expect(pending!.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await retryDueDeliveries(new Date(Date.now() + 2 * 60_000))).toBe(1);
    expect(await HookDelivery.findOne({ hookId: hook.id }).lean()).toMatchObject({
      status: 'delivered',
      attempts: 2,
    });

    // A test message reports the receiver's answer straight away.
    failNext = 1;
    const test = await api().post(`/api/v1/integrations/outgoing/${hook.id}/test`).set(admin.auth);
    expect(test.body.data).toMatchObject({ status: 'failed', httpStatus: 500 });

    await OutboundHook.updateOne({ _id: hook.id }, { $set: { consecutiveFailures: 9 } });
    failNext = 1;
    await api()
      .post('/api/v1/tasks')
      .set(pm.auth)
      .send({ projectId: p.id, title: 'Tenth failure' })
      .expect(201);
    await eventBus.settle();
    const off = (await api().get('/api/v1/integrations/outgoing').set(admin.auth)).body.data[0];
    expect(off).toMatchObject({
      active: false,
      disabledReason: expect.stringContaining('Switched off after 10'),
    });
    const again = await api()
      .patch(`/api/v1/integrations/outgoing/${hook.id}`)
      .set(admin.auth)
      .send({ active: true });
    expect(again.body.data).toMatchObject({
      active: true,
      disabledReason: null,
      consecutiveFailures: 0,
    });
  });
});

describe('GitLab and Bitbucket', () => {
  it('links commits and merge requests from GitLab and pull requests from Bitbucket', async () => {
    const { admin, pm, mkProject } = await setup();
    const p = await mkProject(`GL${seq}`);
    const t = (
      await api()
        .post('/api/v1/tasks')
        .set(pm.auth)
        .send({ projectId: p.id, title: 'Rate limiter' })
    ).body.data;
    await api()
      .put('/api/v1/integrations/github')
      .set(admin.auth)
      .send({ enabled: true, repos: ['arihant/platform/api', 'arihant/web'], moveOnFix: true })
      .expect(200);

    const gl = (body: object, token = 'test-only-gitlab-webhook-secret', event = 'Push Hook') =>
      api()
        .post('/api/v1/integrations/gitlab/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Gitlab-Token', token)
        .set('X-Gitlab-Event', event)
        .set('X-Gitlab-Event-UUID', randomUUID())
        .send(JSON.stringify(body));
    expect((await gl({}, 'wrong-token-0000000000000000')).status).toBe(401);
    const push = await gl({
      object_kind: 'push',
      ref: 'refs/heads/feature/limiter',
      project: { path_with_namespace: 'Arihant/Platform/API' },
      commits: [
        {
          id: 'a'.repeat(40),
          message: `Fixes ${t.key} add limiter`,
          url: 'https://gitlab.example/c/1',
          author: { name: 'Dev' },
        },
      ],
    });
    expect(push.body.data).toMatchObject({ linked: 1, moved: [t.key] });
    expect((await api().get(`/api/v1/tasks/${t.id}`).set(pm.auth)).body.data.status).toBe(
      'in_review',
    );

    const mr = await gl(
      {
        object_kind: 'merge_request',
        project: { path_with_namespace: 'arihant/platform/api' },
        user: { username: 'dev' },
        object_attributes: {
          iid: 12,
          title: `${t.key} limiter`,
          url: 'https://gitlab.example/mr/12',
          state: 'merged',
          action: 'merge',
          source_branch: 'feature/limiter',
        },
      },
      undefined,
      'Merge Request Hook',
    );
    expect(mr.body.data.linked).toBe(1);

    const bbBody = JSON.stringify({
      repository: { full_name: 'arihant/web' },
      pullrequest: {
        id: 7,
        title: `${t.key} web limiter`,
        state: 'OPEN',
        links: { html: { href: 'https://bitbucket.example/pr/7' } },
        author: { nickname: 'web-dev' },
        source: { branch: { name: 'feature/web' } },
      },
    });
    const sign = (b: string) =>
      `sha256=${createHmac('sha256', 'test-only-bitbucket-webhook-secret').update(b).digest('hex')}`;
    const bb = (b: string, sig = sign(b)) =>
      api()
        .post('/api/v1/integrations/bitbucket/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Event-Key', 'pullrequest:created')
        .set('X-Request-UUID', randomUUID())
        .set('X-Hub-Signature', sig)
        .send(b);
    expect((await bb(bbBody, 'sha256=00')).status).toBe(401);
    expect((await bb(bbBody)).body.data.linked).toBe(1);

    const links = await GitLink.find({ taskId: t.id }).lean();
    expect(links.map((l) => `${l.provider}:${l.kind}`).sort()).toEqual([
      'bitbucket:pull_request',
      'gitlab:commit',
      'gitlab:pull_request',
    ]);
    const view = await api().get(`/api/v1/tasks/${t.id}/git`).set(pm.auth);
    expect(view.body.data.find((l: { ref: string }) => l.ref === '#12').state).toBe('merged');
  });
});

describe('Web links on tasks', () => {
  it('recognises Figma, Confluence and Google Drive links and lets editors manage them', async () => {
    const { pm, mkProject } = await setup();
    const outsider = await loginAs(h.app, 'developer');
    const p = await mkProject(`WL${seq}`);
    const t = (
      await api()
        .post('/api/v1/tasks')
        .set(pm.auth)
        .send({ projectId: p.id, title: 'Checkout design' })
    ).body.data;
    const add = (url: string, title?: string) =>
      api().post(`/api/v1/tasks/${t.id}/web-links`).set(pm.auth).send({ url, title });
    expect(
      (await add('https://www.figma.com/design/abc/Checkout', 'Checkout screens')).body.data,
    ).toMatchObject({ provider: 'figma', title: 'Checkout screens' });
    expect(
      (await add('https://arihant.atlassian.net/wiki/spaces/ENG/pages/1')).body.data.provider,
    ).toBe('confluence');
    expect((await add('https://docs.google.com/document/d/xyz')).body.data).toMatchObject({
      provider: 'google_drive',
      title: 'Google Drive: docs.google.com',
    });
    expect((await add('http://insecure.example/doc')).status).toBe(400);
    expect(
      (
        await api()
          .post(`/api/v1/tasks/${t.id}/web-links`)
          .set(outsider.auth)
          .send({ url: 'https://figma.com/x' })
      ).status,
    ).toBe(404);
    const list = await api().get(`/api/v1/tasks/${t.id}/web-links`).set(pm.auth);
    expect(list.body.data).toHaveLength(3);
    await api()
      .delete(`/api/v1/tasks/${t.id}/web-links/${list.body.data[0].id}`)
      .set(pm.auth)
      .expect(204);
    expect(
      (await api().get(`/api/v1/tasks/${t.id}/web-links`).set(pm.auth)).body.data,
    ).toHaveLength(2);
  });
});
