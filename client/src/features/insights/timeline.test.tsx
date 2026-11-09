import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDelayDto, TimelineProjectDto } from '@arihant/shared';
import { routes } from '@/routes/routes';
import { renderRoutes } from '@/test/render';

vi.mock('@/services/api/insights', () => ({
  fetchTimeline: vi.fn(),
  fetchProjectDelays: vi.fn(),
}));
vi.mock('@/services/api/org', () => ({
  fetchDepartments: vi.fn().mockResolvedValue([]),
}));
const api = await import('@/services/api/insights');

const FIRST = { timeout: 15_000 };
const user = (id: string, name: string) => ({ id, name, email: `${id}@x.test`, employeeId: id });

const late: TimelineProjectDto = {
  project: { id: 'p1', key: 'CRM', name: 'CRM Modernisation', status: 'in_progress' },
  manager: user('pm', 'Asha PM'),
  startDate: '2026-09-01',
  baselineEndDate: '2026-11-01',
  endDate: '2026-11-20',
  forecastDate: '2026-12-05',
  finishedOn: null,
  slipDays: 19,
  slips: 2,
  lateDays: 34,
  progress: 60,
  state: 'late',
  milestones: [{ name: 'UAT', dueDate: '2026-10-20', status: 'open', late: true }],
  dependsOn: [],
};
const onTrack: TimelineProjectDto = {
  ...late,
  project: { id: 'p2', key: 'OPS', name: 'Ops Portal', status: 'in_progress' },
  baselineEndDate: '2027-01-31',
  endDate: '2027-01-31',
  forecastDate: null,
  slipDays: 0,
  slips: 0,
  lateDays: 0,
  state: 'on_track',
  milestones: [],
};
const delays: ProjectDelayDto = {
  timeline: late,
  showPeople: true,
  slipHistory: [
    {
      at: '2026-10-25T10:00:00.000Z',
      by: user('pm', 'Asha PM'),
      from: '2026-11-01',
      to: '2026-11-20',
      days: 19,
      reason: 'Vendor API late',
    },
  ],
  lateTasks: [
    {
      id: 't1',
      key: 'CRM-7',
      title: 'Payment screen',
      status: 'done',
      dueDate: '2026-10-10',
      finishedOn: '2026-10-16',
      daysLate: 6,
      assignee: user('d1', 'Ravi Dev'),
    },
  ],
  blocked: [],
  slowHandoffs: [],
  approvalWaits: [],
  dueDatePushes: [],
  upstream: [],
  people: [
    {
      user: user('d1', 'Ravi Dev'),
      lateTasks: 1,
      lateTaskDays: 6,
      approvalOverdueDays: 0,
      dueDatePushDays: 0,
    },
  ],
};

beforeEach(() => vi.clearAllMocks());

describe('Project Timeline', () => {
  it('lists projects with their state, filters by state and explains a delay', async () => {
    vi.mocked(api.fetchTimeline).mockResolvedValue([late, onTrack]);
    vi.mocked(api.fetchProjectDelays).mockResolvedValue(delays);
    const u = userEvent.setup();
    renderRoutes(routes, { path: '/project-timeline', permissions: { 'analytics:view': 'org' } });

    expect(
      await screen.findByRole('heading', { name: 'Project Timeline' }, FIRST),
    ).toBeInTheDocument();
    const row = await screen.findByRole('button', { name: /CRM CRM Modernisation/ }, FIRST);
    expect(row).toHaveTextContent('34 d late');
    expect(row).toHaveTextContent('moved 2×');
    expect(screen.getByRole('button', { name: /OPS Ops Portal/ })).toBeInTheDocument();

    // Filter to late projects only.
    await u.click(screen.getByRole('button', { name: 'Late (1)' }));
    expect(screen.queryByRole('button', { name: /OPS Ops Portal/ })).not.toBeInTheDocument();

    // Expanding a row loads the delay breakdown.
    await u.click(row);
    expect(api.fetchProjectDelays).toHaveBeenCalledWith('p1');
    const moves = await screen.findByRole('region', { name: 'End date moves' }, FIRST);
    expect(moves).toHaveTextContent('Vendor API late');
    expect(moves).toHaveTextContent('Asha PM');
    const lateTasks = screen.getByRole('region', { name: 'Late tasks' });
    expect(within(lateTasks).getByRole('button', { name: 'CRM-7' })).toBeInTheDocument();
    expect(lateTasks).toHaveTextContent('Ravi Dev');
    expect(
      screen.getByRole('region', { name: 'Where time was lost, by person' }),
    ).toHaveTextContent('Ravi Dev');
  });

  it('hides names when the viewer only sees their own work', async () => {
    vi.mocked(api.fetchTimeline).mockResolvedValue([late]);
    vi.mocked(api.fetchProjectDelays).mockResolvedValue({
      ...delays,
      showPeople: false,
      people: [],
      slipHistory: delays.slipHistory.map((s) => ({ ...s, by: null })),
      lateTasks: delays.lateTasks.map((t) => ({ ...t, assignee: null })),
    });
    const u = userEvent.setup();
    renderRoutes(routes, { path: '/project-timeline', permissions: { 'analytics:view': 'own' } });
    await u.click(await screen.findByRole('button', { name: /CRM CRM Modernisation/ }, FIRST));
    const lateTasks = await screen.findByRole('region', { name: 'Late tasks' }, FIRST);
    expect(
      within(lateTasks).queryByRole('columnheader', { name: 'Assignee' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Where time was lost, by person' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Managers also see who was involved/)).toBeInTheDocument();
  });
});
