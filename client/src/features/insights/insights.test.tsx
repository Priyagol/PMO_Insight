import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ManagementSnapshotDto,
  OverviewDto,
  ProjectDto,
  ProjectHealthDto,
  RiskDto,
} from '@arihant/shared';
import { routes } from '@/routes/routes';
import { renderRoutes } from '@/test/render';

vi.mock('@/services/api/insights', () => ({
  fetchOverview: vi.fn(),
  fetchDashboardActivity: vi.fn().mockResolvedValue([]),
  fetchHealth: vi.fn(),
  fetchProjectAnalytics: vi.fn(),
  fetchHours: vi.fn().mockResolvedValue([]),
  fetchSnapshot: vi.fn(),
  downloadFile: vi.fn().mockResolvedValue(undefined),
  fetchRisks: vi.fn(),
  fetchRiskHeatmap: vi.fn(),
  createRisk: vi.fn(),
  updateRisk: vi.fn(),
  escalateRisk: vi.fn(),
  deleteRisk: vi.fn(),
}));
vi.mock('@/services/api/work', async (orig) => {
  const actual = await orig<typeof WorkApi>();
  return { toParams: actual.toParams, fetchProjects: vi.fn() };
});
vi.mock('@/services/api/intelligence', () => ({
  fetchAiStatus: vi
    .fn()
    .mockResolvedValue({ enabled: false, configured: false, dailyLimitPerUser: 50, usedToday: 0 }),
  fetchForecasts: vi.fn().mockResolvedValue([]),
  fetchSimilarTasks: vi.fn().mockResolvedValue([]),
}));
const intel = await import('@/services/api/intelligence');
vi.mock('@/services/api/org', () => ({
  fetchDepartments: vi.fn().mockResolvedValue([]),
  fetchUsers: vi
    .fn()
    .mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } }),
}));
import type * as WorkApi from '@/services/api/work';
const insights = await import('@/services/api/insights');
const work = await import('@/services/api/work');

const user = { id: 'u1', name: 'Test Lead', email: 'lead@example.test', employeeId: 'E-1' };
const proj = { id: 'p1', key: 'TST', name: 'Test Project' };
// Pages are lazy chunks (Recharts); the first render can be slow when the suite runs in parallel.
const FIRST = { timeout: 30_000 };
const analyst = {
  'dashboard:view': 'org',
  'analytics:view': 'org',
  'risk:read': 'org',
  'risk:write': 'org',
} as const;

const overview = (): OverviewDto => ({
  period: { from: '2026-10-08', to: '2026-11-06' },
  scope: 'organisation',
  projects: { total: 4, active: 3, completed: 1, delayed: 1, atRisk: 1, onHold: 0 },
  tasks: { total: 40, open: 27, overdue: 5, blocked: 2, completedInPeriod: 13, createdInPeriod: 9 },
  people: { total: 6, avgUtilization: 0.62, overloaded: 1, onLeave: 0 },
  hours: { loggedInPeriod: 182.5, estimatedOpen: 240 },
  taskStatus: [
    { status: 'todo', count: 20 },
    { status: 'done', count: 13 },
  ],
  completionTrend: [{ week: '2026-11-02', completed: 4, created: 3 }],
  departments: [
    {
      id: 'd1',
      name: 'QA Dept',
      projects: 2,
      openTasks: 11,
      overdue: 2,
      completed: 5,
      loggedHours: 60,
    },
  ],
  plannedVsActual: [{ project: proj, estimated: 120, actual: 80 }],
  workload: [{ user, utilization: 1.2, loadHours: 96, capacityHours: 80 }],
  assignmentMethods: [{ method: 'auto', count: 3 }],
  upcoming: { projects: [], tasks: [] },
  health: { healthy: 2, watch: 0, at_risk: 1 },
});

const health = (): ProjectHealthDto => ({
  project: { ...proj, status: 'in_progress', endDate: '2026-11-01' },
  manager: user,
  score: 42,
  band: 'at_risk',
  progress: 35,
  factors: [
    {
      key: 'schedule',
      label: 'Schedule',
      weight: 0.4,
      value: 0.2,
      detail: 'Past end date with 65% of effort left',
    },
    { key: 'effort', label: 'Effort', weight: 0.2, value: 1, detail: 'Within estimate' },
  ],
  warnings: [
    {
      type: 'project_overdue',
      severity: 'critical',
      project: proj,
      message: 'Project is past its end date',
    },
  ],
});

const risk = (over: Partial<RiskDto> = {}): RiskDto => ({
  id: 'r1',
  key: 'TST-R1',
  project: proj,
  type: 'risk',
  title: 'Vendor API delay',
  probability: 4,
  impact: 4,
  score: 16,
  severity: 'critical',
  status: 'open',
  owner: user,
  linkedTasks: [],
  escalationLevel: 0,
  history: [],
  canEdit: true,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(work.fetchProjects).mockResolvedValue({
    items: [{ ...proj } as ProjectDto],
    meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
  });
});

describe('Executive dashboard', () => {
  it('shows KPIs exactly as returned by the API and offers a table view of each chart', async () => {
    vi.mocked(insights.fetchOverview).mockResolvedValue(overview());
    const u = userEvent.setup();
    renderRoutes(routes, { path: '/', permissions: analyst });

    expect(
      await screen.findByText('Whole organisation', { exact: false }, FIRST),
    ).toBeInTheDocument();
    const kpi = (label: string) =>
      screen.getByText(label, { selector: 'p' }).closest('div.rounded-xl')!;
    expect(kpi('Active projects')).toHaveTextContent('3');
    expect(kpi('Overdue tasks')).toHaveTextContent('5');
    expect(kpi('Hours logged')).toHaveTextContent('182.5');
    expect(kpi('Avg utilisation')).toHaveTextContent('62%');
    expect(screen.queryByText(/Phase 5/)).not.toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: 'Show Team workload as a table' }));
    const card = screen.getByRole('region', { name: 'Team workload' });
    const row = within(card).getByRole('row', { name: /Test Lead/ });
    expect(row).toHaveTextContent('96');
    expect(row).toHaveTextContent('120%');
  });

  it('passes the chosen period to the API', async () => {
    vi.mocked(insights.fetchOverview).mockResolvedValue(overview());
    const u = userEvent.setup();
    renderRoutes(routes, { path: '/', permissions: analyst });
    await screen.findByText('Whole organisation', { exact: false }, FIRST);
    await u.click(screen.getByRole('combobox', { name: 'Period' }));
    await u.click(await screen.findByRole('option', { name: 'Last 7 days' }));
    await waitFor(() => {
      const last = vi.mocked(insights.fetchOverview).mock.calls.at(-1)![0];
      const days = (Date.parse(last.to!) - Date.parse(last.from!)) / 86_400_000;
      expect(days).toBe(6);
    });
  });

  it('shows an error state instead of numbers when the API fails', async () => {
    vi.mocked(insights.fetchOverview).mockRejectedValue(new Error('boom'));
    renderRoutes(routes, { path: '/', permissions: analyst });
    expect(
      await screen.findByRole('button', { name: /try again|retry/i }, FIRST),
    ).toBeInTheDocument();
  });
});

describe('Delivery forecast', () => {
  it('shows the forecast label and explains it with the weekly history and tasks at risk', async () => {
    vi.mocked(insights.fetchHealth).mockResolvedValue([health()]);
    vi.mocked(intel.fetchForecasts).mockResolvedValue([
      {
        project: { id: 'p1', key: 'TST', name: 'Test Project', endDate: '2026-11-20' },
        label: 'likely_late',
        remainingTasks: 4,
        remainingHours: 30,
        hoursPerWeek: 5,
        weeklyHistory: [
          { week: '2026-10-10', hours: 4 },
          { week: '2026-10-17', hours: 6 },
          { week: '2026-10-24', hours: 5 },
          { week: '2026-10-31', hours: 5 },
        ],
        forecastDate: '2026-12-18',
        range: { optimistic: '2026-12-12', pessimistic: '2026-12-29' },
        slipDays: 28,
        explanation:
          'At the recent pace of 5 h per week, the remaining 30 h finish around 2026-12-18, 28 day(s) after the end date.',
        tasksAtRisk: [
          {
            id: 't1',
            key: 'TST-9',
            title: 'Sign-off',
            dueDate: '2026-11-08',
            reason: 'no assignee',
          },
        ],
      },
    ]);
    const u = userEvent.setup();
    renderRoutes(routes, { path: '/project-health', permissions: analyst });
    const row = await screen.findByRole('button', { name: /TST Test Project/ }, FIRST);
    expect(await within(row).findByText('Likely late')).toBeInTheDocument();
    await u.click(row);
    const f = await screen.findByRole('region', { name: 'Delivery forecast' });
    expect(within(f).getByText(/28 day\(s\) after the end date/)).toBeInTheDocument();
    expect(within(f).getByText(/TST-9/)).toBeInTheDocument();
    expect(within(f).getByRole('table')).toHaveTextContent('Done (h)4655');
  });
});

describe('Project health', () => {
  it('labels bands with text and explains the score on expand', async () => {
    vi.mocked(insights.fetchHealth).mockResolvedValue([health()]);
    const u = userEvent.setup();
    renderRoutes(routes, { path: '/project-health', permissions: analyst });

    const row = await screen.findByRole('button', { name: /TST Test Project/ }, FIRST);
    expect(row).toHaveTextContent('At risk');
    expect(row).toHaveTextContent('42');
    expect(screen.getByRole('region', { name: 'Early warnings' })).toHaveTextContent(
      'Project is past its end date',
    );

    await u.click(row);
    expect(await screen.findByText('Past end date with 65% of effort left')).toBeInTheDocument();
  });
});

describe('Risks & issues', () => {
  it('raises a risk with a live score and severity', async () => {
    vi.mocked(insights.fetchRisks).mockResolvedValue({
      items: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
    vi.mocked(insights.fetchRiskHeatmap).mockResolvedValue({
      cells: Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]),
      total: 0,
    });
    vi.mocked(insights.createRisk).mockResolvedValue(risk());
    const u = userEvent.setup();
    renderRoutes(routes, { path: '/risks', permissions: analyst });

    await u.click(await screen.findByRole('button', { name: /raise/i }, FIRST));
    const dialog = await screen.findByRole('dialog');
    await u.click(within(dialog).getByRole('combobox', { name: /project/i }));
    await u.click(await screen.findByRole('option', { name: 'TST · Test Project' }));
    await u.type(within(dialog).getByLabelText(/title/i), 'Vendor API delay');
    await u.click(within(dialog).getByRole('combobox', { name: /probability/i }));
    await u.click(await screen.findByRole('option', { name: '5 · Very high' }));
    await u.click(within(dialog).getByRole('combobox', { name: /impact/i }));
    await u.click(await screen.findByRole('option', { name: '4 · High' }));
    expect(within(dialog).getByText('20')).toBeInTheDocument();
    expect(within(dialog).getByText('Critical')).toBeInTheDocument();

    await u.click(within(dialog).getByRole('button', { name: 'Raise' }));
    await waitFor(() =>
      expect(insights.createRisk).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'p1',
          title: 'Vendor API delay',
          probability: 5,
          impact: 4,
          type: 'risk',
        }),
      ),
    );
  });

  it('lists risks with severity labels and shows the heatmap as a table', async () => {
    const cells = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]);
    cells[3]![3] = 1;
    vi.mocked(insights.fetchRisks).mockResolvedValue({
      items: [risk()],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    vi.mocked(insights.fetchRiskHeatmap).mockResolvedValue({ cells, total: 1 });
    const u = userEvent.setup();
    renderRoutes(routes, { path: '/risks', permissions: analyst });

    const row = await screen.findByRole('row', { name: /TST-R1/ }, FIRST);
    expect(row).toHaveTextContent('Critical');
    expect(row).toHaveTextContent('(16)');
    const heat = screen.getByRole('region', { name: 'Risk heatmap' });
    expect(within(heat).getByText('1 active items · probability × impact')).toBeInTheDocument();
    await u.click(within(heat).getByRole('button', { name: 'Table' }));
    const p4 = within(heat).getAllByRole('row')[2]!; // header, p5, p4
    expect(
      within(p4)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['4', '0', '0', '0', '1', '0']);
  });

  it('hides edit actions for read-only users', async () => {
    vi.mocked(insights.fetchRisks).mockResolvedValue({
      items: [risk({ canEdit: false })],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    vi.mocked(insights.fetchRiskHeatmap).mockResolvedValue({
      cells: Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]),
      total: 0,
    });
    renderRoutes(routes, { path: '/risks', permissions: { 'risk:read': 'project' } });
    await screen.findByRole('row', { name: /TST-R1/ }, FIRST);
    expect(screen.queryByRole('button', { name: /raise/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Escalate TST-R1' })).not.toBeInTheDocument();
  });
});

describe('Management snapshot', () => {
  it('previews the snapshot and downloads PDF through the authenticated client', async () => {
    vi.mocked(insights.fetchOverview).mockResolvedValue(overview());
    const snap: ManagementSnapshotDto = {
      generatedAt: '2026-11-06T10:00:00.000Z',
      generatedBy: 'Test Lead',
      period: { from: '2026-10-08', to: '2026-11-06' },
      scope: 'organisation',
      summary: {
        projectsActive: 3,
        projectsDelayed: 1,
        tasksCompleted: 13,
        tasksPending: 27,
        tasksOverdue: 5,
        hoursLogged: 182.5,
      },
      completed: [
        {
          key: 'TST-1',
          title: 'Login tests',
          project: 'TST',
          assignee: 'Test Lead',
          completedAt: '2026-11-02',
        },
      ],
      overdue: [],
      delayedProjects: [],
      health: [],
      contributions: [],
      departments: [],
      blockers: [],
      upcoming: [],
      changes: [],
    };
    vi.mocked(insights.fetchSnapshot).mockResolvedValue(snap);
    const u = userEvent.setup();
    renderRoutes(routes, { path: '/analytics', permissions: { ...analyst, 'task:read': 'org' } });

    await u.click(await screen.findByRole('tab', { name: 'Management snapshot' }, FIRST));
    expect(insights.fetchSnapshot).not.toHaveBeenCalled();
    await u.click(screen.getByRole('button', { name: /preview/i }));
    expect(await screen.findByText('TST-1 Login tests')).toBeInTheDocument();
    expect(screen.getByText('No overdue work.')).toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: 'PDF' }));
    await waitFor(() =>
      expect(insights.downloadFile).toHaveBeenCalledWith(
        '/reports/snapshot',
        expect.objectContaining({ format: 'pdf' }),
        'management-snapshot.pdf',
      ),
    );
  });
});
