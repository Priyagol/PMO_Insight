import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { eventBus } from '../src/core/events';
import { AuditLog } from '../src/modules/audit/audit-log.model';
import { Task } from '../src/modules/tasks/task.model';
import { createDepartment, loginAs, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);
const SECRET = 'test-only-github-webhook-secret';
const HOOK = '/api/v1/integrations/github/webhook';
const REPO = 'Arihant-Dev/Trading-Platform';

const sign = (body: string, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
function deliver(
  event: string,
  payload: unknown,
  opts: { delivery?: string; secret?: string } = {},
) {
  const body = JSON.stringify(payload);
  return api()
    .post(HOOK)
    .set('Content-Type', 'application/json')
    .set('X-GitHub-Event', event)
    .set('X-GitHub-Delivery', opts.delivery ?? randomUUID())
    .set('X-Hub-Signature-256', sign(body, opts.secret))
    .send(body);
}
const push = (commits: { id: string; message: string }[], repo = REPO) => ({
  ref: 'refs/heads/feature/login',
  repository: { full_name: repo },
  commits: commits.map((c) => ({
    ...c,
    url: `https://github.com/${repo}/commit/${c.id}`,
    timestamp: '2026-11-07T10:00:00+05:30',
    author: { name: 'Dev One', username: 'dev-one' },
  })),
});
const sha = (n: number) => n.toString(16).padStart(40, 'a');

let seq = 0;
async function setup() {
  seq += 1;
  const dept = await createDepartment(`GT${seq}`);
  const admin = await loginAs(h.app, 'super_admin');
  const pm = await loginAs(h.app, 'project_manager', { departmentId: dept._id });
  const dev = await loginAs(h.app, 'developer', { departmentId: dept._id, managerId: pm.user._id });
  const key = `GT${seq}`;
  const p = await api()
    .post('/api/v1/projects')
    .set(pm.auth)
    .send({
      key,
      name: 'Git Project',
      managerId: pm.user._id.toString(),
      memberIds: [dev.user._id.toString()],
    });
  expect(p.status).toBe(201);
  const mk = async (title: string, status = 'todo') => {
    const r = await api()
      .post('/api/v1/tasks')
      .set(dev.auth)
      .send({ projectId: p.body.data.id, title, status });
    expect(r.status).toBe(201);
    return r.body.data as { id: string; key: string };
  };
  return { admin, pm, dev, key, mk };
}
const enable = (admin: { auth: Record<string, string> }, moveOnFix = true) =>
  api()
    .put('/api/v1/integrations/github')
    .set(admin.auth)
    .send({ enabled: true, repos: [REPO], moveOnFix });

describe('GitHub webhook security and settings', () => {
  it('rejects unsigned or wrongly signed deliveries and only accepts configured repositories', async () => {
    const { admin, dev, mk } = await setup();
    const t = await mk('Login timeout');
    const body = JSON.stringify(push([{ id: sha(1), message: `${t.key} retry login` }]));
    const unsigned = await api()
      .post(HOOK)
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'push')
      .set('X-GitHub-Delivery', randomUUID())
      .send(body);
    expect(unsigned.status).toBe(401);
    expect(
      (await deliver('push', JSON.parse(body), { secret: 'wrong-secret-0123456789' })).status,
    ).toBe(401);

    // Off by default: deliveries are acknowledged but change nothing.
    const off = await deliver('push', JSON.parse(body));
    expect(off.status).toBe(200);
    expect(off.body.data.outcome).toBe('ignored: integration switched off');

    expect(
      (
        await api()
          .put('/api/v1/integrations/github')
          .set(dev.auth)
          .send({ enabled: true, repos: [REPO], moveOnFix: true })
      ).status,
    ).toBe(403);
    expect(
      (
        await api()
          .put('/api/v1/integrations/github')
          .set(admin.auth)
          .send({ enabled: true, repos: ['not a repo'], moveOnFix: true })
      ).status,
    ).toBe(400);
    const saved = await enable(admin);
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({
      enabled: true,
      repos: [REPO.toLowerCase()],
      secretConfigured: true,
      webhookPath: HOOK,
      lastDelivery: { event: 'push', outcome: 'ignored: integration switched off' },
    });
    const other = await deliver(
      'push',
      push([{ id: sha(2), message: `fixes ${t.key}` }], 'someone/else'),
    );
    expect(other.body.data.outcome).toBe('ignored: repository not allowed');
    expect((await Task.findById(t.id).lean())!.status).toBe('todo');
    expect(
      (
        await deliver('ping', {
          zen: 'Keep it logically awesome.',
          repository: { full_name: REPO },
        })
      ).body.data.outcome,
    ).toBe('ping');
  });
});

describe('commits and pull requests', () => {
  it('links commits that mention a task and moves "fixes" tasks to In review', async () => {
    const { admin, dev, mk } = await setup();
    await enable(admin);
    const a = await mk('Login timeout on Safari');
    const b = await mk('Session expiry banner', 'in_progress');
    const c = await mk('Already finished', 'in_progress');
    await api().patch(`/api/v1/tasks/${c.id}`).set(dev.auth).send({ status: 'done' });

    const delivery = randomUUID();
    const res = await deliver(
      'push',
      push([
        { id: sha(10), message: `${a.key} add retry with backoff\n\nLonger description` },
        { id: sha(11), message: `Fixes ${a.key}, ${b.key} and ${c.key}` },
        { id: sha(12), message: 'Fix typo in README (no task)' },
      ]),
      { delivery },
    );
    expect(res.status).toBe(200);
    await eventBus.settle();
    expect(res.body.data).toMatchObject({ linked: 4 });
    expect(res.body.data.moved.sort()).toEqual([a.key, b.key].sort());

    const ta = (await Task.findById(a.id).lean())!;
    expect(ta.status).toBe('in_review'); // To do → In progress → In review
    expect(ta.startedAt).toBeTruthy();
    expect((await Task.findById(b.id).lean())!.status).toBe('in_review');
    expect((await Task.findById(c.id).lean())!.status).toBe('done'); // finished work is never reopened

    const links = await api().get(`/api/v1/tasks/${a.id}/git`).set(dev.auth);
    expect(links.status).toBe(200);
    expect(links.body.data).toHaveLength(2);
    expect(links.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'commit',
          ref: sha(10).slice(0, 7),
          title: `${a.key} add retry with backoff`,
          author: 'dev-one',
          branch: 'feature/login',
          movedTask: false,
        }),
        expect.objectContaining({
          kind: 'commit',
          ref: sha(11).slice(0, 7),
          movedTask: true,
          url: `https://github.com/${REPO}/commit/${sha(11)}`,
        }),
      ]),
    );
    const activity = await api().get(`/api/v1/tasks/${a.id}/activity`).set(dev.auth);
    expect(JSON.stringify(activity.body.data)).toContain('GitHub moved');
    expect(
      await AuditLog.countDocuments({ action: 'task.status_changed_by_git', entityId: a.id }),
    ).toBe(1);

    // A redelivered webhook changes nothing.
    const again = await deliver('push', push([{ id: sha(13), message: `${a.key} again` }]), {
      delivery,
    });
    expect(again.body.data.outcome).toBe('duplicate');
    expect((await api().get(`/api/v1/tasks/${a.id}/git`).set(dev.auth)).body.data).toHaveLength(2);
  });

  it('tracks pull request state, honours "link only" mode and finds moved tasks by their old key', async () => {
    const { admin, pm, dev, mk } = await setup();
    await enable(admin, false);
    const t = await mk('Export to CSV');
    const pr = (action: string, extra: Record<string, unknown>) => ({
      action,
      repository: { full_name: REPO },
      pull_request: {
        number: 42,
        title: `Fixes ${t.key}: CSV export`,
        body: 'Adds the export button',
        html_url: `https://github.com/${REPO}/pull/42`,
        state: 'open',
        merged: false,
        user: { login: 'dev-one' },
        head: { ref: `feature/${t.key}-csv` },
        ...extra,
      },
    });
    await deliver('pull_request', pr('opened', {}));
    expect((await Task.findById(t.id).lean())!.status).toBe('todo'); // link only
    await deliver('pull_request', pr('closed', { state: 'closed', merged: true }));
    const links = (await api().get(`/api/v1/tasks/${t.id}/git`).set(dev.auth)).body.data;
    expect(links).toEqual([
      expect.objectContaining({
        kind: 'pull_request',
        ref: '#42',
        state: 'merged',
        branch: `feature/${t.key}-csv`,
      }),
    ]);

    // Turn moving on; a closed (not merged) pull request still moves nothing.
    await enable(admin, true);
    await deliver('pull_request', pr('closed', { number: 43, state: 'closed', merged: false }));
    expect((await Task.findById(t.id).lean())!.status).toBe('todo');

    // The task moves to another project; commits using the old key still find it.
    const other = await api()
      .post('/api/v1/projects')
      .set(pm.auth)
      .send({
        key: `GX${seq}`,
        name: 'Other',
        managerId: pm.user._id.toString(),
        memberIds: [dev.user._id.toString()],
      });
    const moved = await api()
      .post(`/api/v1/tasks/${t.id}/move-project`)
      .set(pm.auth)
      .send({ projectId: other.body.data.id });
    expect(moved.status).toBe(200);
    const r = await deliver('push', push([{ id: sha(20), message: `fixes ${t.key}` }]));
    expect(r.body.data.moved).toEqual([moved.body.data.key]);
    expect((await Task.findById(t.id).lean())!.status).toBe('in_review');
  });

  it('only shows links to people who can see the task', async () => {
    const { admin, mk } = await setup();
    await enable(admin);
    const t = await mk('Private work');
    await deliver('push', push([{ id: sha(30), message: `${t.key} start` }]));
    const outsider = await loginAs(h.app, 'developer');
    expect((await api().get(`/api/v1/tasks/${t.id}/git`).set(outsider.auth)).status).toBe(404);
  });
});
