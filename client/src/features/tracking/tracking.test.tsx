import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssignmentPlanDto, ProjectDto } from '@arihant/shared';
import { routes } from '@/routes/routes';
import { renderRoutes } from '@/test/render';
import { formatClock } from './elapsed';
import { formatMinutes } from './hooks';

vi.mock('@/services/api/tracking', () => ({
  fetchWorklogs: vi.fn().mockResolvedValue({
    items: [],
    meta: { page: 1, limit: 100, total: 0, totalPages: 0, totalMinutes: 0 },
  }),
  createWorklog: vi.fn(),
  updateWorklog: vi.fn(),
  deleteWorklog: vi.fn(),
  fetchTimer: vi.fn().mockResolvedValue(null),
  startTimer: vi.fn(),
  fetchPlan: vi.fn(),
  fetchPlans: vi.fn().mockResolvedValue([]),
  approvePlan: vi.fn(),
  rejectPlan: vi.fn(),
  modifyPlan: vi.fn(),
  fetchAssignmentConfig: vi.fn(),
}));
vi.mock('@/services/api/work', async (orig) => {
  const actual = await orig<typeof WorkApi>();
  return {
    toParams: actual.toParams,
    fetchProjects: vi.fn(),
    fetchTasks: vi.fn(),
    fetchSavedViews: vi.fn().mockResolvedValue([]),
  };
});
import type * as WorkApi from '@/services/api/work';
const tracking = await import('@/services/api/tracking');
const work = await import('@/services/api/work');

const meta = { page: 1, limit: 100, total: 1, totalPages: 1 };
const user = { id: 'u1', name: 'Tester A', email: 'a@example.test', employeeId: 'E-1' };

beforeEach(() => vi.clearAllMocks());

describe('formatting helpers', () => {
  it('formats durations and the running clock', () => {
    expect(formatMinutes(0)).toBe('0m');
    expect(formatMinutes(150)).toBe('2h 30m');
    expect(formatMinutes(120)).toBe('2h');
    expect(formatClock(3_725_000)).toBe('01:02:05');
  });
});

describe('Work Logs: log work dialog', () => {
  it('validates the entry and sends a duration-based work log', async () => {
    vi.mocked(work.fetchProjects).mockResolvedValue({
      items: [{ id: 'p1', key: 'QA', name: 'Regression' } as ProjectDto],
      meta,
    });
    vi.mocked(work.fetchTasks).mockResolvedValue({ items: [], meta: { ...meta, total: 0 } });
    vi.mocked(tracking.createWorklog).mockResolvedValue({} as never);
    const u = userEvent.setup();
    renderRoutes(routes, { path: '/work-logs', permissions: { 'worklog:write': 'own' } });

    await u.click((await screen.findAllByRole('button', { name: /log work/i }))[0]!);
    const dialog = await screen.findByRole('dialog');
    await u.click(within(dialog).getByRole('button', { name: 'Log work' }));
    expect(
      await within(dialog).findByText('Choose a project', { selector: 'p' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Enter how long you worked')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Describe the work (at least 3 characters)'),
    ).toBeInTheDocument();

    await u.click(within(dialog).getByRole('combobox', { name: /project/i }));
    await u.click(await screen.findByRole('option', { name: 'QA · Regression' }));
    await u.type(within(dialog).getByLabelText('Hours'), '1');
    await u.type(within(dialog).getByLabelText('Minutes'), '30');
    await u.type(within(dialog).getByLabelText(/What did you do/), 'Regression run on login');
    await u.click(within(dialog).getByRole('button', { name: 'Log work' }));
    await waitFor(() => expect(tracking.createWorklog).toHaveBeenCalledOnce());
    expect(vi.mocked(tracking.createWorklog).mock.calls[0]![0]).toMatchObject({
      projectId: 'p1',
      taskId: null,
      minutes: 90,
      category: 'development',
      description: 'Regression run on login',
    });
  });
});

describe('Smart Assignment plan review', () => {
  const plan: AssignmentPlanDto = {
    id: 'plan1',
    kind: 'batch',
    status: 'draft',
    project: { id: 'p1', key: 'QA', name: 'Regression' },
    createdBy: user,
    proposals: [
      {
        taskId: 't1',
        key: 'QA-1',
        title: 'Login tests',
        priority: 'high',
        effortHours: 2,
        fromUser: null,
        toUser: user,
        score: 91.5,
        reason: 'Score 92 (workload 100%)',
      },
    ],
    skipped: [
      {
        taskId: 't2',
        key: 'QA-2',
        title: 'Mainframe',
        reason: 'No eligible person: needs mainframe level 4',
      },
    ],
    manualReview: [],
    workload: [
      {
        user,
        capacityHours: 80,
        loadBefore: 10,
        loadAfter: 12,
        tasksAdded: 1,
        tasksRemoved: 0,
        overCapacity: false,
      },
    ],
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  };

  it('shows proposals, workload impact and skipped reasons, and approves', async () => {
    vi.mocked(tracking.fetchPlan).mockResolvedValue(plan);
    vi.mocked(tracking.approvePlan).mockResolvedValue({
      ...plan,
      status: 'executed',
      result: { assigned: 1, conflicts: [] },
    });
    const u = userEvent.setup();
    renderRoutes(routes, {
      path: '/smart-assignment?plan=plan1',
      permissions: { 'assignment:execute': 'project' },
    });

    expect(await screen.findByText('Login tests')).toBeInTheDocument();
    expect(screen.getByText('91.5')).toBeInTheDocument();
    expect(screen.getByText(/10 → 12 \/ 80 h/)).toBeInTheDocument();
    expect(screen.getByText(/needs mainframe level 4/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /approve & assign/i }));
    await waitFor(() => expect(tracking.approvePlan).toHaveBeenCalledWith('plan1'));
  });
});
