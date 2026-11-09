import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CapacityPlanDto } from '@arihant/shared';
import { renderRoutes } from '@/test/render';
import { CapacityPanel } from './CapacityPanel';

vi.mock('@/services/api/tracking', () => ({
  fetchCapacityPlan: vi.fn(),
  fetchTeams: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/services/api/org', () => ({ fetchDepartments: vi.fn().mockResolvedValue([]) }));
const api = await import('@/services/api/tracking');

const plan: CapacityPlanDto = {
  weeks: ['2026-11-09', '2026-11-16'],
  groupBy: 'person',
  rows: [
    {
      id: 'u1',
      label: 'Dev One',
      people: 1,
      weeks: [
        { capacity: 40, demand: 50 },
        { capacity: 40, demand: 10 },
      ],
      unscheduled: 3,
      overdue: 6,
    },
  ],
  totals: {
    id: 'total',
    label: 'Total',
    people: 1,
    weeks: [
      { capacity: 40, demand: 50 },
      { capacity: 40, demand: 10 },
    ],
    unscheduled: 3,
    overdue: 6,
  },
  shortfalls: [{ row: 'Dev One', week: '2026-11-09', gap: 10 }],
  assumptions: ['Capacity is each person’s weekly hours.'],
};

describe('Teams: capacity plan', () => {
  it('shows planned vs available hours per week, shortfalls, and regroups on request', async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchCapacityPlan).mockResolvedValue(plan);
    renderRoutes([{ path: '/', element: <CapacityPanel /> }], {
      permissions: { 'team:read': 'team' },
    });
    expect(await screen.findByText('Shortfalls coming up')).toBeInTheDocument();
    expect(screen.getByText(/10 h more planned than available/)).toBeInTheDocument();
    const row = screen
      .getAllByText('Dev One')
      .map((e) => e.closest('tr'))
      .find(Boolean)!;
    expect(within(row).getByText('50 / 40')).toHaveClass('text-destructive');
    expect(within(row).getByText('10 / 40')).not.toHaveClass('text-destructive');
    await user.click(screen.getByRole('button', { name: 'By skill' }));
    expect(vi.mocked(api.fetchCapacityPlan)).toHaveBeenLastCalledWith(
      expect.objectContaining({ groupBy: 'skill', weeks: 8 }),
    );
  });
});
