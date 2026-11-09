import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionGrant, RoleDto } from '@arihant/shared';
import { routes } from '@/routes/routes';
import { renderRoutes } from '@/test/render';
import { testUser } from '@/test/fixtures';
import { toGrants } from './roles/grants';
import { PermissionMatrix } from './roles/RolesPage';

vi.mock('@/services/api/org', () => ({
  fetchUsers: vi.fn(),
  fetchUser: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  setUserStatus: vi.fn(),
  setUserRoles: vi.fn(),
  resendInvite: vi.fn(),
  sendPasswordReset: vi.fn(),
  fetchSkills: vi.fn().mockResolvedValue([]),
  fetchDepartments: vi.fn().mockResolvedValue([]),
  fetchRoles: vi.fn(),
  createDepartment: vi.fn(),
  updateDepartment: vi.fn(),
  archiveDepartment: vi.fn(),
  fetchArchivedDepartments: vi.fn(),
  restoreDepartment: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(),
  fetchAuditLogs: vi.fn(),
  fetchLoginHistory: vi.fn(),
  fetchSettings: vi.fn(),
  saveSettings: vi.fn(),
}));
const org = await import('@/services/api/org');

const role = (key: string, name: string, grants: PermissionGrant[] = []): RoleDto => ({
  id: `role-${key}`,
  key,
  name,
  isSystem: true,
  locked: key === 'super_admin',
  grants,
  userCount: 0,
  createdAt: '',
  updatedAt: '',
});

beforeEach(() => {
  vi.mocked(org.fetchUsers).mockResolvedValue({
    items: [
      testUser({ id: 'a', name: 'Asha Rao', email: 'asha@example.test', employeeId: 'E-1' }),
      testUser({
        id: 'b',
        name: 'Vikram Shah',
        email: 'vikram@example.test',
        employeeId: 'E-2',
        hasPassword: false,
      }),
    ],
    meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
  });
  vi.mocked(org.fetchRoles).mockResolvedValue([
    role('developer', 'Developer'),
    role('qa_tester', 'QA / Tester'),
  ]);
});

describe('EmployeesPage', () => {
  it('lists employees and shows invite status; read-only users get no "Add" action', async () => {
    renderRoutes(routes, { path: '/admin/employees', permissions: { 'user:read': 'department' } });
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByText('Invite pending')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add employee/i })).not.toBeInTheDocument();
    expect(vi.mocked(org.fetchUsers).mock.calls[0]![0]).toMatchObject({
      status: 'active',
      page: 1,
      limit: 20,
    });
  });

  it('validates the new-employee form and submits the API payload', async () => {
    const user = userEvent.setup();
    vi.mocked(org.createUser).mockResolvedValue({
      user: testUser({ name: 'Neha K' }),
      inviteSent: true,
    });
    renderRoutes(routes, {
      path: '/admin/employees',
      permissions: { 'user:read': 'org', 'user:manage': 'org' },
    });

    await user.click(await screen.findByRole('button', { name: /add employee/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Add employee' }));
    expect(await within(dialog).findByText('Enter the full name')).toBeInTheDocument();
    expect(within(dialog).getByText('Select at least one role')).toBeInTheDocument();
    expect(org.createUser).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(/Full name/), 'Neha K');
    await user.type(within(dialog).getByLabelText(/Work e-mail/), 'neha@example.test');
    await user.type(within(dialog).getByLabelText(/Employee ID/), 'EMP-9');
    await user.click(within(dialog).getByRole('checkbox', { name: 'QA / Tester' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add employee' }));

    await waitFor(() => expect(org.createUser).toHaveBeenCalledOnce());
    expect(vi.mocked(org.createUser).mock.calls[0]![0]).toMatchObject({
      name: 'Neha K',
      email: 'neha@example.test',
      employeeId: 'EMP-9',
      roleIds: ['role-qa_tester'],
      departmentId: null,
      managerId: null,
      weeklyCapacityHours: 40,
      skills: [],
    });
  });
});

describe('DepartmentsPage', () => {
  it('lists archived departments for administrators and restores one', async () => {
    const dept = {
      id: 'd1',
      name: 'Old Ops',
      code: 'OPS',
      head: null,
      parent: null,
      memberCount: 0,
      archivedAt: '2026-10-01T00:00:00.000Z',
      createdAt: '',
      updatedAt: '',
    };
    vi.mocked(org.fetchArchivedDepartments).mockResolvedValue([dept]);
    vi.mocked(org.restoreDepartment).mockResolvedValue({ ...dept, archivedAt: undefined });
    const user = userEvent.setup();
    renderRoutes(routes, {
      path: '/admin/departments',
      permissions: { 'department:manage': 'org', 'user:read': 'org' },
    });
    await user.click(
      await screen.findByRole('button', { name: /Show archived departments/ }, { timeout: 15_000 }),
    );
    const section = screen.getByRole('region', { name: 'Archived departments' });
    expect(await within(section).findByText('Old Ops')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: /Restore/ }));
    await waitFor(() => expect(org.restoreDepartment).toHaveBeenCalledWith('d1'));
  });
});

describe('PermissionMatrix', () => {
  function Harness({ initial }: { initial: PermissionGrant[] }) {
    const [value, setValue] = useState(
      Object.fromEntries(initial.map((g) => [g.permission, g.scope])),
    );
    return (
      <>
        <PermissionMatrix value={value} onChange={setValue} />
        <output data-testid="grants">{JSON.stringify(toGrants(value))}</output>
      </>
    );
  }

  it('changes scopes and offers only organisation scope for admin permissions', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ permission: 'task:read', scope: 'own' }]} />);

    await user.click(screen.getByRole('combobox', { name: 'Scope for View tasks' }));
    await user.click(await screen.findByRole('option', { name: 'Department' }));
    expect(screen.getByTestId('grants')).toHaveTextContent(
      '{"permission":"task:read","scope":"department"}',
    );

    await user.click(screen.getByRole('combobox', { name: 'Scope for Manage employees' }));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual(['No access', 'Organisation']);
  });
});
