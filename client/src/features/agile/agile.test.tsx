import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SprintDto, TaskDto } from '@arihant/shared';
import { renderRoutes } from '@/test/render';
import { AgileReportsPanel } from './AgileReportsPanel';
import { BacklogPanel } from './BacklogPanel';

vi.mock('@/services/api/agile', () => ({
  fetchBacklog: vi.fn(),
  fetchEpics: vi.fn(),
  fetchSprints: vi.fn(),
  createSprint: vi.fn(),
  startSprint: vi.fn(),
  completeSprint: vi.fn(),
  deleteSprint: vi.fn(),
  setSprintScope: vi.fn(),
  rankInBacklog: vi.fn(),
  fetchVelocity: vi.fn(),
  fetchSprintChart: vi.fn(),
  fetchCycleTime: vi.fn(),
  fetchDefects: vi.fn(),
}));
const api = await import('@/services/api/agile');

const FIRST = { timeout: 15_000 };
const proj = { id: '64b000000000000000000001', key: 'AGL', name: 'Agile Project' };

const task = (id: string, over: Partial<TaskDto> = {}): TaskDto =>
  ({
    id,
    key: `AGL-${id.slice(-1)}`,
    project: proj,
    parent: null,
    title: `Task ${id.slice(-1)}`,
    status: 'todo',
    priority: 'medium',
    assignee: null,
    reporter: null,
    watcherIds: [],
    actualHours: 0,
    requiredSkills: [],
    tags: [],
    checklist: [],
    dependencies: [],
    milestone: null,
    recurrence: null,
    customFields: {},
    type: 'story',
    storyPoints: 3,
    epic: null,
    sprint: null,
    components: [],
    fixRelease: null,
    remainingIsManual: false,
    bug: null,
    links: [],
    previousKeys: [],
    subtaskCount: 0,
    subtasksDone: 0,
    commentCount: 0,
    attachmentCount: 0,
    rank: 'V',
    overdue: false,
    can: { update: true, delete: true },
    createdAt: '',
    updatedAt: '',
    ...over,
  }) as TaskDto;

const sprint = (over: Partial<SprintDto> = {}): SprintDto => ({
  id: '64b0000000000000000000a1',
  project: proj,
  name: 'AGL Sprint 1',
  status: 'planned',
  taskCount: 1,
  doneCount: 0,
  points: 5,
  donePoints: 0,
  committedPoints: null,
  completedPoints: null,
  daysLeft: null,
  can: { edit: true },
  ...over,
});

const render = (el: React.ReactNode) =>
  renderRoutes([{ path: '/', element: el }], {
    path: '/',
    permissions: { 'project:read': 'project', 'task:read': 'project', 'task:update': 'project' },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.fetchEpics).mockResolvedValue([
    {
      id: 'e1',
      key: 'AGL-9',
      title: 'Online onboarding',
      status: 'in_progress',
      childCount: 4,
      childDone: 1,
      points: 20,
      donePoints: 5,
      percent: 25,
    },
  ]);
});

describe('Backlog and sprint planning', () => {
  it('ranks backlog items, moves selected tasks into a sprint and starts it with dates', async () => {
    const s = sprint();
    const inSprint = task('64b00000000000000000000a', {
      sprint: { id: s.id, name: s.name, status: 'planned' },
      storyPoints: 5,
    });
    const b1 = task('64b00000000000000000000b');
    const b2 = task('64b00000000000000000000c');
    const b3 = task('64b00000000000000000000d', { storyPoints: undefined });
    vi.mocked(api.fetchBacklog).mockResolvedValue({
      sprints: [{ ...s, tasks: [inSprint] }],
      backlog: [b1, b2, b3],
      canPlan: true,
    });
    vi.mocked(api.rankInBacklog).mockResolvedValue(b3);
    vi.mocked(api.setSprintScope).mockResolvedValue({ moved: 2 });
    vi.mocked(api.startSprint).mockResolvedValue({ ...s, status: 'active' });
    const user = userEvent.setup();
    render(<BacklogPanel projectId={proj.id} />);

    const backlog = await screen.findByRole('region', { name: 'Backlog' }, FIRST);
    expect(within(backlog).getByText(/3 open task\(s\) · 6 pts/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Online onboarding progress' })).toHaveAttribute(
      'aria-valuenow',
      '25',
    );

    // Moving the third item up places it between the first and second.
    await user.click(within(backlog).getByRole('button', { name: `Move ${b3.key} up` }));
    await waitFor(() => expect(api.rankInBacklog).toHaveBeenCalledWith(b3.id, b1.id, b2.id));
    expect(within(backlog).getByRole('button', { name: `Move ${b1.key} up` })).toBeDisabled();

    await user.click(within(backlog).getByRole('checkbox', { name: `Select ${b1.key}` }));
    await user.click(within(backlog).getByRole('checkbox', { name: `Select ${b2.key}` }));
    await user.click(within(backlog).getByRole('combobox', { name: 'Move selected to sprint' }));
    await user.click(await screen.findByRole('option', { name: 'AGL Sprint 1' }));
    await waitFor(() => expect(api.setSprintScope).toHaveBeenCalledWith([b1.id, b2.id], s.id));

    const card = screen.getByRole('region', { name: 'AGL Sprint 1' });
    await user.click(within(card).getByRole('button', { name: /Start/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Start AGL Sprint 1' });
    expect(dialog).toHaveTextContent('1 task(s), 5 story point(s)');
    const start = within(dialog).getByLabelText('Start');
    const end = within(dialog).getByLabelText('End');
    await user.clear(start);
    await user.type(start, '2026-11-09');
    await user.clear(end);
    await user.type(end, '2026-11-20');
    await user.type(within(dialog).getByLabelText('Sprint goal'), 'KYC upload live');
    await user.click(within(dialog).getByRole('button', { name: 'Start sprint' }));
    await waitFor(() =>
      expect(api.startSprint).toHaveBeenCalledWith(s.id, {
        startDate: '2026-11-09',
        endDate: '2026-11-20',
        goal: 'KYC upload live',
      }),
    );
  });

  it('completes a running sprint, sending unfinished work to the next sprint', async () => {
    const running = sprint({
      status: 'active',
      taskCount: 3,
      doneCount: 1,
      points: 8,
      donePoints: 3,
      committedPoints: 8,
      startDate: '2026-11-02',
      endDate: '2026-11-13',
      daysLeft: 7,
    });
    const next = sprint({
      id: '64b0000000000000000000b2',
      name: 'AGL Sprint 2',
      taskCount: 0,
      points: 0,
    });
    vi.mocked(api.fetchBacklog).mockResolvedValue({
      sprints: [
        { ...running, tasks: [] },
        { ...next, tasks: [] },
      ],
      backlog: [],
      canPlan: true,
    });
    vi.mocked(api.completeSprint).mockResolvedValue({
      ...running,
      status: 'completed',
      completedPoints: 3,
      carriedOver: 2,
    });
    const user = userEvent.setup();
    render(<BacklogPanel projectId={proj.id} />);
    const card = await screen.findByRole('region', { name: 'AGL Sprint 1' }, FIRST);
    expect(card).toHaveTextContent('7 day(s) left');
    expect(card).toHaveTextContent('3/8 pts done · committed 8');
    await user.click(within(card).getByRole('button', { name: /Complete/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Complete AGL Sprint 1' });
    await user.click(within(dialog).getByRole('combobox', { name: 'Move unfinished tasks to' }));
    await user.click(await screen.findByRole('option', { name: 'AGL Sprint 2' }));
    await user.click(within(dialog).getByRole('button', { name: 'Complete sprint' }));
    await waitFor(() =>
      expect(api.completeSprint).toHaveBeenCalledWith(running.id, { moveOpenTo: next.id }),
    );
  });

  it('hides planning controls from people who cannot plan', async () => {
    vi.mocked(api.fetchBacklog).mockResolvedValue({
      sprints: [{ ...sprint(), tasks: [] }],
      backlog: [task('64b00000000000000000000b', { can: { update: false, delete: false } })],
      canPlan: false,
    });
    render(<BacklogPanel projectId={proj.id} />);
    await screen.findByRole('region', { name: 'Backlog' }, FIRST);
    expect(screen.queryByRole('button', { name: /New sprint/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Sprint for/ })).not.toBeInTheDocument();
  });
});

describe('Agile reports', () => {
  it('shows velocity, sprint burndown data and defect figures exactly as returned', async () => {
    vi.mocked(api.fetchVelocity).mockResolvedValue({
      sprints: [{ id: 's1', name: 'AGL Sprint 1', committed: 10, completed: 8 }],
      average: 8,
    });
    vi.mocked(api.fetchSprints).mockResolvedValue([sprint({ id: 's1', status: 'completed' })]);
    vi.mocked(api.fetchSprintChart).mockResolvedValue({
      sprint: {
        id: 's1',
        name: 'AGL Sprint 1',
        startDate: '2026-11-02',
        endDate: '2026-11-03',
        status: 'completed',
      },
      days: [
        { date: '2026-11-02', remaining: 10, completed: 0, scope: 10, ideal: 10 },
        { date: '2026-11-03', remaining: 2, completed: 8, scope: 10, ideal: 0 },
      ],
      committed: 10,
      notes: ['1 task(s) have no story points and count as 0.'],
    });
    vi.mocked(api.fetchCycleTime).mockResolvedValue({
      cycle: { median: 2.5, average: 3, count: 4 },
      lead: { median: 6, average: 6.5, count: 5 },
      byType: [{ type: 'bug', median: 1.5, count: 2 }],
      items: [],
      days: 90,
    });
    vi.mocked(api.fetchDefects).mockResolvedValue({
      open: 3,
      openBySeverity: { blocker: 1, critical: 0, major: 2, minor: 0, trivial: 0 },
      regressionsOpen: 1,
      weeks: [{ weekStart: '2026-11-02', created: 2, resolved: 1 }],
      averageResolutionDays: 4.2,
      oldestOpen: [
        { id: 'b1', key: 'AGL-4', title: 'Crash on save', severity: 'blocker', ageDays: 12 },
      ],
    });
    render(<AgileReportsPanel projectId={proj.id} />);
    expect(
      await screen.findByText('Average 8 pts completed per sprint', {}, FIRST),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('1 task(s) have no story points and count as 0.'),
    ).toBeInTheDocument();
    expect(screen.getByText('2.5 d')).toBeInTheDocument();
    expect(screen.getByText('4 task(s) with a recorded start')).toBeInTheDocument();
    expect(screen.getByText('4.2 d')).toBeInTheDocument();
    const sev = screen.getByRole('region', { name: 'Open bugs by severity' });
    expect(sev).toHaveTextContent('Crash on save');
    expect(sev).toHaveTextContent('12 d');
    expect(sev).toHaveTextContent('Bug: 1.5 d (2)');
  });
});
