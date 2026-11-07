import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { eventBus } from '../src/core/events';
import { AuditLog } from '../src/modules/audit/audit-log.model';
import { Department } from '../src/modules/departments/department.model';
import { Task } from '../src/modules/tasks/task.model';
import { createDepartment, loginAs, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
);

let seq = 0;
async function setup() {
  seq += 1;
  const dept = await createDepartment(`DL${seq}`);
  const head = await loginAs(h.app, 'department_head', { departmentId: dept._id });
  await Department.updateOne({ _id: dept._id }, { $set: { headId: head.user._id } });
  const pm = await loginAs(h.app, 'project_manager', {
    departmentId: dept._id,
    managerId: head.user._id,
  });
  const dev = await loginAs(h.app, 'developer', { departmentId: dept._id, managerId: pm.user._id });
  const ext = await loginAs(h.app, 'external_stakeholder');
  const res = await api()
    .post('/api/v1/projects')
    .set(pm.auth)
    .send({
      key: `DL${seq}`,
      name: 'Delivery Project',
      managerId: pm.user._id.toString(),
      memberIds: [dev.user._id.toString(), ext.user._id.toString()],
      departmentId: dept._id.toString(),
    });
  expect(res.status).toBe(201);
  return { head, pm, dev, ext, project: res.body.data as { id: string; key: string } };
}
const upload = (
  who: { auth: Record<string, string> },
  meta: Record<string, unknown>,
  name = 'brd.pdf',
  file = PDF,
) =>
  api()
    .post('/api/v1/documents')
    .set(who.auth)
    .field('meta', JSON.stringify(meta))
    .attach('file', file, name);
const decide = (who: { auth: Record<string, string> }, approvalId: string, comment?: string) =>
  api()
    .post(`/api/v1/approvals/${approvalId}/approve`)
    .set(who.auth)
    .send(comment ? { comment } : {});

describe('documents', () => {
  it('versions files, publishes through approval, and shows externals only shared published versions', async () => {
    const { head, pm, dev, ext, project } = await setup();
    const created = await upload(dev, {
      projectId: project.id,
      title: 'Business requirements',
      category: 'brd',
      sharedWithStakeholders: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      status: 'draft',
      currentVersion: 1,
      publishedVersion: null,
      versions: [{ version: 1, fileName: 'brd.pdf', mime: 'application/pdf' }],
    });
    const id = created.body.data.id as string;
    expect(
      (
        await upload(
          dev,
          { projectId: project.id, title: 'Bad' },
          'evil.pdf',
          Buffer.from('MZ\x90\x00binary'),
        )
      ).status,
    ).toBe(422);

    // Externals see nothing until a version is published.
    expect((await api().get('/api/v1/documents').set(ext.auth)).body.data).toHaveLength(0);

    const pub = await api().post(`/api/v1/documents/${id}/publish`).set(dev.auth);
    expect(pub.body.data).toMatchObject({
      status: 'pending_approval',
      approval: { status: 'pending' },
    });
    const v2blocked = await api()
      .post(`/api/v1/documents/${id}/versions`)
      .set(dev.auth)
      .attach('file', PDF, 'brd-v2.pdf');
    expect(v2blocked.status).toBe(409);
    expect((await decide(pm, pub.body.data.approval.id)).body.data.status).toBe('approved');
    const published = await api().get(`/api/v1/documents/${id}`).set(dev.auth);
    expect(published.body.data).toMatchObject({ status: 'published', publishedVersion: 1 });

    // A new version stays unpublished until approved again; externals still get version 1 only.
    const v2 = await api()
      .post(`/api/v1/documents/${id}/versions`)
      .set(dev.auth)
      .field('note', 'Scope update')
      .attach('file', PDF, 'brd-v2.pdf');
    expect(v2.body.data).toMatchObject({
      currentVersion: 2,
      publishedVersion: 1,
      can: { publish: true },
    });
    const extView = await api().get(`/api/v1/documents/${id}`).set(ext.auth);
    expect(extView.body.data.versions.map((v: { version: number }) => v.version)).toEqual([1]);
    expect(extView.body.data.approval).toBeNull();
    expect(
      (await api().get(`/api/v1/documents/${id}/versions/2/download`).set(ext.auth)).status,
    ).toBe(404);
    const dl = await api().get(`/api/v1/documents/${id}/versions/1/download`).set(ext.auth);
    expect(dl.body.data.url).toMatch(/signed=1/);
    expect(
      (await api().patch(`/api/v1/documents/${id}`).set(ext.auth).send({ title: 'Mine' })).status,
    ).toBe(403);

    // The PM's own publication falls back to the department head; a rejection returns it to its previous state.
    const own = await api().post(`/api/v1/documents/${id}/publish`).set(pm.auth);
    expect(own.body.data.status).toBe('pending_approval');
    const approval = await api().get(`/api/v1/approvals/${own.body.data.approval.id}`).set(pm.auth);
    expect(approval.body.data.stages.map((s: { status: string }) => s.status)).toEqual([
      'skipped',
      'pending',
    ]);
    expect(approval.body.data.stages[1].approvers[0].id).toBe(head.user._id.toString());
    await api()
      .post(`/api/v1/approvals/${own.body.data.approval.id}/reject`)
      .set(head.auth)
      .send({ comment: 'Needs legal review' });
    const after = await api().get(`/api/v1/documents/${id}`).set(pm.auth);
    expect(after.body.data).toMatchObject({
      status: 'published',
      publishedVersion: 1,
      currentVersion: 2,
    });

    // Unshared documents never reach externals.
    await api()
      .patch(`/api/v1/documents/${id}`)
      .set(pm.auth)
      .send({ sharedWithStakeholders: false });
    expect((await api().get(`/api/v1/documents/${id}`).set(ext.auth)).status).toBe(404);
    expect(await AuditLog.countDocuments({ action: 'document.unshared' })).toBe(1);
  });
});

describe('releases', () => {
  it('tracks deployments per environment and needs approval before production', async () => {
    const { head, pm, dev, project } = await setup();
    const t = await api()
      .post('/api/v1/tasks')
      .set(pm.auth)
      .send({ projectId: project.id, title: 'Release work' });
    const rel = await api()
      .post('/api/v1/releases')
      .set(pm.auth)
      .send({
        projectId: project.id,
        version: '1.4.0',
        name: 'November',
        taskIds: [t.body.data.id],
      });
    expect(rel.status).toBe(201);
    expect(rel.body.data).toMatchObject({
      status: 'planned',
      openTasks: 1,
      environments: [{ environment: 'dev', status: 'not_deployed' }, {}, {}, {}],
    });
    const id = rel.body.data.id as string;
    expect(
      (
        await api()
          .post('/api/v1/releases')
          .set(pm.auth)
          .send({ projectId: project.id, version: '1.4.0' })
      ).status,
    ).toBe(409);
    expect(
      (await api().post(`/api/v1/releases/${id}/deploy`).set(dev.auth).send({ environment: 'qa' }))
        .status,
    ).toBe(403);

    const uat = await api()
      .post(`/api/v1/releases/${id}/deploy`)
      .set(pm.auth)
      .send({ environment: 'uat', build: '2026.11.06-3' });
    expect(uat.body.data.status).toBe('in_progress');
    expect(
      uat.body.data.environments.find((e: { environment: string }) => e.environment === 'uat'),
    ).toMatchObject({ status: 'deployed', build: '2026.11.06-3' });
    const blocked = await api()
      .post(`/api/v1/releases/${id}/deploy`)
      .set(pm.auth)
      .send({ environment: 'prod' });
    expect(blocked.status).toBe(422);

    const req = await api().post(`/api/v1/releases/${id}/request-go-live`).set(pm.auth);
    expect(req.body.data.approval.status).toBe('pending');
    const appr = await api().get(`/api/v1/approvals/${req.body.data.approval.id}`).set(pm.auth);
    expect(appr.body.data.description).toMatch(
      /Linked tasks still open: 1 of 1\. UAT: deployed \(build 2026\.11\.06-3\)/,
    );
    await decide(head, req.body.data.approval.id);
    const live = await api()
      .post(`/api/v1/releases/${id}/deploy`)
      .set(pm.auth)
      .send({ environment: 'prod', build: '2026.11.06-3' });
    expect(live.status).toBe(200);
    expect(live.body.data).toMatchObject({ status: 'released', can: { deployProd: true } });
    expect(live.body.data.releasedAt).toBeTruthy();
    await eventBus.settle();

    expect(
      (
        await api()
          .post(`/api/v1/releases/${id}/rollback`)
          .set(pm.auth)
          .send({ environment: 'qa', reason: 'n/a' })
      ).status,
    ).toBe(422);
    const rb = await api()
      .post(`/api/v1/releases/${id}/rollback`)
      .set(pm.auth)
      .send({ environment: 'prod', reason: 'Payment errors after go-live' });
    expect(rb.body.data.status).toBe('rolled_back');
    expect(rb.body.data.history[0]).toMatchObject({
      action: 'rolled back Production',
      notes: 'Payment errors after go-live',
    });
    expect(
      await AuditLog.countDocuments({
        action: { $in: ['release.deployed', 'release.rolled_back'] },
      }),
    ).toBe(3);
  });
});

describe('stakeholders, change requests and feedback', () => {
  it('runs a change request through approval into an implementation task', async () => {
    const { head, pm, dev, project } = await setup();
    const sh = await api()
      .post('/api/v1/stakeholders')
      .set(pm.auth)
      .send({
        name: 'Meera Client',
        organisation: 'Client Co',
        type: 'client',
        email: 'MEERA@client.test',
        influence: 'high',
        projectIds: [project.id],
      });
    expect(sh.status).toBe(201);
    expect(sh.body.data).toMatchObject({
      email: 'meera@client.test',
      projects: [{ key: project.key }],
    });
    expect((await api().get('/api/v1/stakeholders').set(dev.auth)).status).toBe(403);

    const cr = await api()
      .post('/api/v1/change-requests')
      .set(pm.auth)
      .send({
        projectId: project.id,
        stakeholderId: sh.body.data.id,
        title: 'Add UPI payments',
        impacts: ['scope', 'cost'],
        estimatedHours: 40,
        costImpact: 150000,
        scheduleImpactDays: 10,
      });
    expect(cr.status).toBe(201);
    expect(cr.body.data).toMatchObject({
      key: expect.stringMatching(/^CR-/),
      status: 'draft',
      stakeholder: { name: 'Meera Client' },
    });
    const id = cr.body.data.id as string;
    expect(
      (await api().post(`/api/v1/change-requests/${id}/create-task`).set(pm.auth)).status,
    ).toBe(422);

    const sub = await api().post(`/api/v1/change-requests/${id}/submit`).set(pm.auth);
    expect(sub.body.data).toMatchObject({ status: 'submitted', approval: { status: 'pending' } });
    expect(
      (await api().patch(`/api/v1/change-requests/${id}`).set(pm.auth).send({ title: 'Changed' }))
        .status,
    ).toBe(403);
    const appr = await api().get(`/api/v1/approvals/${sub.body.data.approval.id}`).set(pm.auth);
    expect(appr.body.data).toMatchObject({ amount: 150000, entityType: 'change_request' });
    await decide(head, sub.body.data.approval.id);
    expect((await api().get(`/api/v1/change-requests/${id}`).set(pm.auth)).body.data.status).toBe(
      'approved',
    );

    const task = await api().post(`/api/v1/change-requests/${id}/create-task`).set(pm.auth);
    expect(task.body.data.implementationTask.key).toMatch(new RegExp(`^${project.key}-`));
    const created = await Task.findById(task.body.data.implementationTask.id).lean();
    expect(created).toMatchObject({ estimatedHours: 40, tags: ['change-request'] });
    expect(
      (await api().post(`/api/v1/change-requests/${id}/create-task`).set(pm.auth)).status,
    ).toBe(409);
    expect(
      (await api().post(`/api/v1/change-requests/${id}/implemented`).set(pm.auth)).body.data.status,
    ).toBe('implemented');

    // A developer on the project can raise one; withdrawing a submitted request withdraws its approval.
    const devCr = await api()
      .post('/api/v1/change-requests')
      .set(dev.auth)
      .send({ projectId: project.id, title: 'Dark mode for reports' });
    await api().post(`/api/v1/change-requests/${devCr.body.data.id}/submit`).set(dev.auth);
    const wd = await api()
      .post(`/api/v1/change-requests/${devCr.body.data.id}/withdraw`)
      .set(dev.auth);
    expect(wd.body.data).toMatchObject({ status: 'withdrawn', approval: { status: 'cancelled' } });
    // A rejection marks it rejected.
    const third = await api()
      .post('/api/v1/change-requests')
      .set(dev.auth)
      .send({ projectId: project.id, title: 'Rewrite in another language' });
    const thirdSub = await api()
      .post(`/api/v1/change-requests/${third.body.data.id}/submit`)
      .set(dev.auth);
    await api()
      .post(`/api/v1/approvals/${thirdSub.body.data.approval.id}/reject`)
      .set(pm.auth)
      .send({ comment: 'Out of scope' });
    expect(
      (await api().get(`/api/v1/change-requests/${third.body.data.id}`).set(dev.auth)).body.data
        .status,
    ).toBe('rejected');
  });

  it('records feedback per project and shows the average rating', async () => {
    const { pm, project } = await setup();
    const other = await setup();
    const sh = (
      await api()
        .post('/api/v1/stakeholders')
        .set(pm.auth)
        .send({ name: 'Arun Vendor', type: 'vendor', projectIds: [project.id] })
    ).body.data;
    for (const rating of [4, 5]) {
      const f = await api().post('/api/v1/feedback').set(pm.auth).send({
        projectId: project.id,
        stakeholderId: sh.id,
        rating,
        category: 'delivery',
        receivedOn: '2026-11-01',
      });
      expect(f.status).toBe(201);
    }
    expect(
      (
        await api().post('/api/v1/feedback').set(other.pm.auth).send({
          projectId: other.project.id,
          stakeholderId: sh.id,
          rating: 1,
          receivedOn: '2026-11-01',
        })
      ).status,
    ).toBe(404);
    const list = await api().get(`/api/v1/stakeholders?projectId=${project.id}`).set(pm.auth);
    expect(list.body.data[0]).toMatchObject({ name: 'Arun Vendor', averageRating: 4.5 });
    const fb = await api().get(`/api/v1/feedback?projectId=${project.id}`).set(pm.auth);
    expect(fb.body.data).toHaveLength(2);
  });
});
