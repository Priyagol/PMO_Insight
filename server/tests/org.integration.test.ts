import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/audit-log.model';
import { Role } from '../src/modules/roles/role.model';
import { User } from '../src/modules/users/user.model';
import {
  createDepartment,
  createUser,
  login,
  loginAs,
  tokenFromEmail,
  useHarness,
} from './helpers/harness';

const h = useHarness();
const api = () => request(h.app);

async function roleId(key: string) {
  return (await Role.findOne({ key }).lean())!._id.toString();
}

describe('authorization', () => {
  it('rejects unauthenticated access to every protected module', async () => {
    for (const path of [
      '/users',
      '/departments',
      '/roles',
      '/audit-logs',
      '/settings',
      '/skills',
    ]) {
      expect((await api().get(`/api/v1${path}`)).status, path).toBe(401);
    }
  });

  it('forbids non-admins from administrative actions', async () => {
    const dev = await loginAs(h.app, 'developer');
    const cases: [string, string, object?][] = [
      ['post', '/api/v1/users', {}],
      ['post', '/api/v1/departments', { name: 'X', code: 'XX' }],
      ['get', '/api/v1/roles'],
      ['post', '/api/v1/roles', { name: 'X', grants: [] }],
      ['get', '/api/v1/audit-logs'],
      ['put', '/api/v1/settings', {}],
      ['get', '/api/v1/permissions'],
    ];
    for (const [method, path, body] of cases) {
      const req = (api() as unknown as Record<string, (p: string) => request.Test>)[method]!(
        path,
      ).set(dev.auth);
      const res = body ? await req.send(body) : await req;
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it('limits the directory to the caller department and hides others as 404', async () => {
    const tech = await createDepartment('TECH');
    const qa = await createDepartment('QA');
    const colleague = await createUser({ role: 'developer', departmentId: tech._id });
    const outsider = await createUser({ role: 'qa_tester', departmentId: qa._id });
    const dev = await loginAs(h.app, 'developer', { departmentId: tech._id });

    const list = await api().get('/api/v1/users').set(dev.auth);
    expect(list.status).toBe(200);
    const ids = list.body.data.map((u: { id: string }) => u.id);
    expect(ids).toEqual(
      expect.arrayContaining([colleague._id.toString(), dev.user._id.toString()]),
    );
    expect(ids).not.toContain(outsider._id.toString());
    expect(list.body.meta.total).toBe(2);

    expect((await api().get(`/api/v1/users/${outsider._id}`).set(dev.auth)).status).toBe(404);
    expect((await api().get(`/api/v1/users/${colleague._id}`).set(dev.auth)).status).toBe(200);
  });

  it('an organisation-wide reader sees everyone', async () => {
    await createUser({ role: 'developer', departmentId: (await createDepartment('TECH'))._id });
    await createUser({ role: 'developer', departmentId: (await createDepartment('QA'))._id });
    const director = await loginAs(h.app, 'director');
    const res = await api().get('/api/v1/users').set(director.auth);
    expect(res.body.meta.total).toBe(3);
  });

  it('a role edit takes effect on the very next request', async () => {
    const lead = await loginAs(h.app, 'team_lead');
    expect((await api().get('/api/v1/users').set(lead.auth)).status).toBe(200);
    await Role.updateOne({ key: 'team_lead' }, { $pull: { grants: { permission: 'user:read' } } });
    expect((await api().get('/api/v1/users').set(lead.auth)).status).toBe(403);
  });
});

describe('employees', () => {
  it('creates an employee, sends an invite and the invite activates the account', async () => {
    const admin = await loginAs(h.app, 'super_admin');
    const dept = await createDepartment('TECH');
    const res = await api()
      .post('/api/v1/users')
      .set(admin.auth)
      .send({
        name: 'Neha Kulkarni',
        email: 'Neha.K@example.test',
        employeeId: 'EMP-100',
        departmentId: dept._id.toString(),
        designation: 'QA Engineer',
        managerId: admin.user._id.toString(),
        roleIds: [await roleId('qa_tester')],
        skills: [{ name: 'API Testing', level: 4 }],
        weeklyCapacityHours: 40,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.inviteSent).toBe(true);
    expect(res.body.data.user).toMatchObject({
      email: 'neha.k@example.test',
      hasPassword: false,
      department: { code: 'TECH' },
      manager: { id: admin.user._id.toString() },
      roles: [{ key: 'qa_tester' }],
    });
    expect(h.emails[0]?.subject).toBe('Activate your Arihant Workspace account');

    const token = tokenFromEmail(h.emails);
    expect(
      (await api().post('/api/v1/auth/reset-password').send({ token, password: 'Welcome2Arihant' }))
        .status,
    ).toBe(200);
    await login(h.app, 'neha.k@example.test', 'Welcome2Arihant');

    const skills = await api().get('/api/v1/skills?q=api').set(admin.auth);
    expect(skills.body.data).toEqual(['API Testing']);
    expect(await AuditLog.countDocuments({ action: 'user.created' })).toBe(1);
  });

  it('rejects duplicate e-mail / employee ID with 409', async () => {
    const admin = await loginAs(h.app, 'super_admin');
    const body = {
      name: 'A Person',
      email: 'dup@example.test',
      employeeId: 'EMP-1',
      roleIds: [await roleId('employee')],
    };
    expect((await api().post('/api/v1/users').set(admin.auth).send(body)).status).toBe(201);
    const dup = await api()
      .post('/api/v1/users')
      .set(admin.auth)
      .send({ ...body, employeeId: 'EMP-2' });
    expect(dup.status).toBe(409);
  });

  it('prevents reporting cycles', async () => {
    const admin = await loginAs(h.app, 'super_admin');
    const boss = await createUser({ role: 'department_head' });
    const report = await createUser({ role: 'developer', managerId: boss._id });
    const res = await api()
      .patch(`/api/v1/users/${boss._id}`)
      .set(admin.auth)
      .send({ managerId: report._id.toString() });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/cycle/);
  });

  it('deactivation revokes sessions; self-deactivation and losing the last super admin are blocked', async () => {
    const admin = await loginAs(h.app, 'super_admin');
    const dev = await loginAs(h.app, 'developer');
    const off = await api()
      .patch(`/api/v1/users/${dev.user._id}/status`)
      .set(admin.auth)
      .send({ status: 'inactive' });
    expect(off.status).toBe(200);
    expect((await api().get('/api/v1/auth/me').set(dev.auth)).status).toBe(401);

    const self = await api()
      .patch(`/api/v1/users/${admin.user._id}/status`)
      .set(admin.auth)
      .send({ status: 'inactive' });
    expect(self.status).toBe(422);
    const demote = await api()
      .put(`/api/v1/users/${admin.user._id}/roles`)
      .set(admin.auth)
      .send({ roleIds: [await roleId('director')] });
    expect(demote.status).toBe(422);
  });

  it('only a Super Admin can grant Super Admin (no privilege escalation)', async () => {
    // A custom HR role that may manage employees but is not Super Admin.
    const hr = await Role.create({
      key: 'custom_hr',
      name: 'HR Admin',
      grants: [
        { permission: 'user:read', scope: 'org' },
        { permission: 'user:manage', scope: 'org' },
      ],
    });
    const hrUser = await createUser({ role: 'employee' });
    await User.updateOne({ _id: hrUser._id }, { $set: { roleIds: [hr._id] } });
    const { token } = await login(h.app, hrUser.email);
    const target = await createUser({ role: 'employee' });
    const res = await api()
      .put(`/api/v1/users/${target._id}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [await roleId('super_admin')] });
    expect(res.status).toBe(403);
  });
});

describe('departments', () => {
  it('creates, lists with head counts, rejects duplicate codes and archives safely', async () => {
    const admin = await loginAs(h.app, 'super_admin');
    const created = await api()
      .post('/api/v1/departments')
      .set(admin.auth)
      .send({ name: 'Technology', code: 'tech' });
    expect(created.status).toBe(201);
    expect(created.body.data.code).toBe('TECH');
    expect(
      (
        await api()
          .post('/api/v1/departments')
          .set(admin.auth)
          .send({ name: 'Other', code: 'TECH' })
      ).status,
    ).toBe(409);

    const member = await createUser({ role: 'developer', departmentId: created.body.data.id });
    const list = await api().get('/api/v1/departments').set(admin.auth);
    expect(list.body.data[0]).toMatchObject({ code: 'TECH', memberCount: 1 });

    const blocked = await api()
      .delete(`/api/v1/departments/${created.body.data.id}`)
      .set(admin.auth);
    expect(blocked.status).toBe(409);
    await User.updateOne({ _id: member._id }, { $set: { departmentId: null } });
    expect(
      (await api().delete(`/api/v1/departments/${created.body.data.id}`).set(admin.auth)).status,
    ).toBe(204);
    // Code is free again after archiving.
    expect(
      (
        await api()
          .post('/api/v1/departments')
          .set(admin.auth)
          .send({ name: 'Tech 2', code: 'TECH' })
      ).status,
    ).toBe(201);
  });
});

describe('roles', () => {
  it('lists the nine system roles with Super Admin locked', async () => {
    const admin = await loginAs(h.app, 'super_admin');
    const res = await api().get('/api/v1/roles').set(admin.auth);
    expect(res.body.data).toHaveLength(9);
    expect(res.body.data[0]).toMatchObject({ key: 'super_admin', locked: true, userCount: 1 });
    const locked = await api()
      .patch(`/api/v1/roles/${res.body.data[0].id}`)
      .set(admin.auth)
      .send({ grants: [] });
    expect(locked.status).toBe(422);
  });

  it('creates, edits and deletes a custom role with validation', async () => {
    const admin = await loginAs(h.app, 'super_admin');
    const narrowAdmin = await api()
      .post('/api/v1/roles')
      .set(admin.auth)
      .send({ name: 'Bad', grants: [{ permission: 'user:manage', scope: 'department' }] });
    expect(narrowAdmin.status).toBe(422);

    const created = await api()
      .post('/api/v1/roles')
      .set(admin.auth)
      .send({ name: 'Finance Viewer', grants: [{ permission: 'analytics:view', scope: 'org' }] });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ key: 'custom_finance_viewer', isSystem: false });

    const updated = await api()
      .patch(`/api/v1/roles/${created.body.data.id}`)
      .set(admin.auth)
      .send({ grants: [{ permission: 'analytics:view', scope: 'department' }] });
    expect(updated.body.data.grants).toEqual([
      { permission: 'analytics:view', scope: 'department' },
    ]);

    const holder = await createUser({ role: 'employee' });
    await User.updateOne({ _id: holder._id }, { $push: { roleIds: created.body.data.id } });
    expect(
      (await api().delete(`/api/v1/roles/${created.body.data.id}`).set(admin.auth)).status,
    ).toBe(409);
    await User.updateOne({ _id: holder._id }, { $pull: { roleIds: created.body.data.id } });
    expect(
      (await api().delete(`/api/v1/roles/${created.body.data.id}`).set(admin.auth)).status,
    ).toBe(204);
    expect(await AuditLog.countDocuments({ action: /^role\./ })).toBe(3);
  });
});

describe('audit logs and settings', () => {
  it('records actions and lets auditors filter them; there is no way to modify them', async () => {
    const admin = await loginAs(h.app, 'super_admin');
    await api()
      .post('/api/v1/departments')
      .set(admin.auth)
      .send({ name: 'Technology', code: 'TECH' });
    const res = await api().get('/api/v1/audit-logs?action=department.').set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      action: 'department.created',
      actor: { id: admin.user._id.toString() },
    });
    expect(
      (await api().delete(`/api/v1/audit-logs/${res.body.data[0].id}`).set(admin.auth)).status,
    ).toBe(404);
    await expect(AuditLog.deleteMany({})).rejects.toThrow(/append-only/);

    const logins = await api().get('/api/v1/audit-logs/logins').set(admin.auth);
    expect(logins.body.data[0]).toMatchObject({ success: true });
  });

  it('reads defaults and updates organisation settings', async () => {
    const admin = await loginAs(h.app, 'super_admin');
    const current = await api().get('/api/v1/settings').set(admin.auth);
    expect(current.body.data).toMatchObject({
      timezone: 'Asia/Kolkata',
      workingDays: [1, 2, 3, 4, 5],
      fiscalYearStartMonth: 4,
    });
    const bad = await api()
      .put('/api/v1/settings')
      .set(admin.auth)
      .send({ ...current.body.data, updatedAt: undefined, timezone: 'Mars/Olympus' });
    expect(bad.status).toBe(400);
    const { updatedAt: _ignored, ...body } = current.body.data;
    const ok = await api()
      .put('/api/v1/settings')
      .set(admin.auth)
      .send({ ...body, workingDays: [1, 2, 3, 4, 5, 6] });
    expect(ok.status).toBe(200);
    expect(ok.body.data.workingDays).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
