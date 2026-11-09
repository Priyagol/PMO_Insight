import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Department } from '../src/modules/departments/department.model';
import { createDepartment, loginAs, useHarness } from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);

let seq = 0;
async function projectWithoutDepartment(
  pmDept: Awaited<ReturnType<typeof createDepartment>>['_id'] | null,
) {
  seq += 1;
  const pm = await loginAs(h.app, 'project_manager', pmDept ? { departmentId: pmDept } : undefined);
  const p = await api()
    .post('/api/v1/projects')
    .set(pm.auth)
    .send({ key: `NF${seq}`, name: 'No department', managerId: pm.user._id.toString() });
  expect(p.status).toBe(201);
  return { pm, project: p.body.data as { id: string } };
}

describe('department head stage when the project has no department head', () => {
  it("goes to the head of the project manager's department, with a note", async () => {
    const dept = await createDepartment('NFD');
    const head = await loginAs(h.app, 'department_head', { departmentId: dept._id });
    await Department.updateOne({ _id: dept._id }, { $set: { headId: head.user._id } });
    const { pm, project } = await projectWithoutDepartment(dept._id);

    // The project manager asks: their own stage is skipped, the department head stage falls back.
    const res = await api()
      .post('/api/v1/approvals')
      .set(pm.auth)
      .send({ entityType: 'general', projectId: project.id, title: 'Extra licences' });
    expect(res.status).toBe(201);
    const stage = res.body.data.stages[res.body.data.currentStage];
    expect(stage).toMatchObject({
      name: 'Department head',
      status: 'pending',
      approvers: [{ id: head.user._id.toString() }],
    });
    expect(stage.note).toMatch(/project manager's department/);
  });

  it('goes to the directors only when nobody else in the workflow could approve', async () => {
    const director = await loginAs(h.app, 'director');
    const { pm, project } = await projectWithoutDepartment(null);
    // Closure already has a Director stage: the department head stage is skipped as before.
    const closure = await api()
      .post('/api/v1/approvals')
      .set(pm.auth)
      .send({ entityType: 'project_closure', projectId: project.id, title: 'Done' });
    expect(closure.status).toBe(201);
    expect(closure.body.data.stages.map((s: { status: string }) => s.status)).toEqual([
      'skipped',
      'pending',
    ]);
    // A general request by the project manager has nobody else: the directors get it.
    const general = await api()
      .post('/api/v1/approvals')
      .set(pm.auth)
      .send({ entityType: 'general', projectId: project.id, title: 'Budget' });
    expect(general.status).toBe(201);
    const stage = general.body.data.stages[general.body.data.currentStage];
    expect(stage.name).toBe('Department head');
    expect(stage.approvers.map((a: { id: string }) => a.id)).toContain(
      director.user._id.toString(),
    );
    expect(stage.note).toMatch(/sent to the directors/);
  });
});

describe('restoring archived departments', () => {
  it('lists archived departments for administrators and restores them', async () => {
    const admin = await loginAs(h.app, 'super_admin');
    const dev = await loginAs(h.app, 'developer');
    const parent = await api()
      .post('/api/v1/departments')
      .set(admin.auth)
      .send({ name: 'Parent', code: 'PAR' });
    const child = await api()
      .post('/api/v1/departments')
      .set(admin.auth)
      .send({ name: 'Child', code: 'CHI', parentId: parent.body.data.id });
    expect(child.status).toBe(201);
    expect(
      (await api().delete(`/api/v1/departments/${child.body.data.id}`).set(admin.auth)).status,
    ).toBe(204);
    expect(
      (await api().delete(`/api/v1/departments/${parent.body.data.id}`).set(admin.auth)).status,
    ).toBe(204);

    const archived = await api().get('/api/v1/departments?archived=true').set(admin.auth);
    expect(archived.status).toBe(200);
    expect(archived.body.data.map((d: { code: string }) => d.code)).toEqual(['PAR', 'CHI']);
    expect(archived.body.data[0].archivedAt).toBeTruthy();
    expect((await api().get('/api/v1/departments?archived=true').set(dev.auth)).status).toBe(403);
    expect(
      (await api().post(`/api/v1/departments/${child.body.data.id}/restore`).set(dev.auth)).status,
    ).toBe(403);

    // The child comes back at the top level because its parent is still archived.
    const restored = await api()
      .post(`/api/v1/departments/${child.body.data.id}/restore`)
      .set(admin.auth);
    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({ code: 'CHI', parent: null });

    // A code taken in the meantime blocks the restore with a clear message.
    await api()
      .post('/api/v1/departments')
      .set(admin.auth)
      .send({ name: 'New parent', code: 'PAR' });
    const blocked = await api()
      .post(`/api/v1/departments/${parent.body.data.id}/restore`)
      .set(admin.auth);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/Code PAR is now used by New parent/);
  });
});
