import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PerformanceRowDto, TeamPerformanceDto } from '@arihant/shared';
import { periodRange } from '@/features/insights/hooks';
import { renderRoutes } from '@/test/render';
import { PerformancePanel } from './PerformancePanel';
import { TeamsPanel } from './TeamsPanel';

vi.mock('@/services/api/tracking', () => ({
  fetchTeamPerformance: vi.fn(),
  fetchTeams: vi.fn(),
  createTeam: vi.fn(),
  updateTeam: vi.fn(),
  archiveTeam: vi.fn(),
}));
vi.mock('@/services/api/org', () => ({ fetchDepartments: vi.fn().mockResolvedValue([]) }));
const tracking = await import('@/services/api/tracking');

const counts: Omit<PerformanceRowDto, 'user'> = {
  assigned: 4,
  pending: 2,
  overdue: 1,
  completed: 2,
  completedWithDueDate: 2,
  completedOnTime: 1,
  onTimeRate: 50,
  reworked: 2,
  qaRejections: 1,
  estimatedHours: 6,
  actualHours: 7,
  loggedHours: 1.5,
};

describe('Teams: performance', () => {
  it('shows each person’s delivery counts with a team total', async () => {
    const data: TeamPerformanceDto = {
      period: { key: '30d', from: '2026-10-11', to: '2026-11-09' },
      rows: [
        {
          user: { id: 'u1', name: 'Dev One', email: 'd1@example.test', employeeId: 'E-1' },
          ...counts,
        },
      ],
      totals: counts,
      teams: [{ team: { id: 't1', name: 'Mobile squad' }, members: 1, totals: counts }],
    };
    vi.mocked(tracking.fetchTeams).mockResolvedValue([]);
    vi.mocked(tracking.fetchTeamPerformance).mockResolvedValue(data);
    renderRoutes([{ path: '/', element: <PerformancePanel /> }], {
      permissions: { 'team:read': 'team' },
    });
    const row = (await screen.findByText('Dev One')).closest('tr')!;
    expect(within(row).getByText('50%')).toBeInTheDocument();
    expect(within(row).getByText('6 / 7 h')).toBeInTheDocument();
    expect(screen.getByText('Total (1 people)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mobile squad' })).toBeInTheDocument();
    expect(vi.mocked(tracking.fetchTeamPerformance)).toHaveBeenCalledWith('30d', {
      departmentId: undefined,
      teamId: undefined,
    });
  });
});

describe('analytics period presets', () => {
  it('covers financial quarters and years (April start)', () => {
    const now = new Date(2026, 10, 9);
    expect(periodRange('quarter', now)).toEqual({ from: '2026-10-01', to: '2026-11-09' });
    expect(periodRange('last-quarter', now)).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(periodRange('year', now)).toEqual({ from: '2026-04-01', to: '2026-11-09' });
    expect(periodRange('30', now)).toEqual({ from: '2026-10-11', to: '2026-11-09' });
  });
});

describe('Teams: named teams', () => {
  it('creates a team with a lead and members', async () => {
    const user = userEvent.setup();
    vi.mocked(tracking.fetchTeams).mockResolvedValue([]);
    vi.mocked(tracking.createTeam).mockResolvedValue({
      id: 't1',
      name: 'QA Payments',
      description: null,
      department: null,
      lead: null,
      members: [],
      canEdit: true,
    });
    renderRoutes([{ path: '/', element: <TeamsPanel /> }], {
      permissions: { 'team:read': 'org', 'department:manage': 'org' },
    });
    expect(await screen.findByText('No teams yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New team' }));
    await user.type(await screen.findByLabelText(/^Name/), 'QA Payments');
    await user.click(screen.getByRole('button', { name: 'Create team' }));
    await waitFor(() =>
      expect(vi.mocked(tracking.createTeam).mock.calls[0]![0]).toEqual({
        name: 'QA Payments',
        description: undefined,
        departmentId: null,
        leadId: null,
        memberIds: [],
      }),
    );
  });

  it('hides team editing from people who cannot manage teams', async () => {
    vi.mocked(tracking.fetchTeams).mockResolvedValue([
      {
        id: 't1',
        name: 'Mobile squad',
        description: null,
        department: null,
        lead: null,
        members: [{ id: 'u1', name: 'Dev One', email: 'd1@example.test', employeeId: 'E-1' }],
        canEdit: false,
      },
    ]);
    renderRoutes([{ path: '/', element: <TeamsPanel /> }], {
      permissions: { 'team:read': 'team' },
    });
    expect(await screen.findByText('Mobile squad')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New team' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Mobile squad' })).toBeNull();
  });
});
