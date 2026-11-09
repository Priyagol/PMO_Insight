import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MilestoneDto, ProjectDto, TaskDto, TemplateSummaryDto } from '@arihant/shared';
import { routes } from '@/routes/routes';
import type * as WorkApi from '@/services/api/work';
import { renderRoutes } from '@/test/render';

vi.mock('@/services/api/work', async (orig) => {
  const actual = await orig<typeof WorkApi>();
  return {
    toParams: actual.toParams,
    fetchProjects: vi.fn(),
    fetchProject: vi.fn(),
    fetchProjectOverview: vi.fn(),
    fetchProjectVersions: vi.fn().mockResolvedValue([]),
    fetchProjectActivity: vi
      .fn()
      .mockResolvedValue({ items: [], meta: { page: 1, limit: 30, total: 0, totalPages: 0 } }),
    fetchTasks: vi.fn(),
    fetchBoard: vi.fn().mockResolvedValue([]),
    createTask: vi.fn(),
    createProject: vi.fn(),
    fetchSavedViews: vi.fn().mockResolvedValue([]),
    createSavedView: vi.fn(),
    deleteSavedView: vi.fn(),
    updateTask: vi.fn(),
    bulkUpdateTasks: vi.fn(),
    bulkDeleteTasks: vi.fn(),
    fetchTask: vi.fn(),
  };
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
vi.mock('@/services/api/planning', () => ({
  fetchMilestones: vi.fn(),
  createMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  fetchDependencies: vi.fn(),
  setDependencies: vi.fn(),
  setCustomFields: vi.fn(),
  fetchTemplates: vi.fn(),
  fetchTemplate: vi.fn(),
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  saveAsTemplate: vi.fn(),
}));
const work = await import('@/services/api/work');
const planning = await import('@/services/api/planning');

const meta = (total: number) => ({ page: 1, limit: 25, total, totalPages: 1 });
const user = { id: 'u-pm', name: 'Pat Manager', email: 'pm@example.test', employeeId: 'E-1' };
const pmPerms = {
  'project:read': 'project',
  'project:create': 'project',
  'project:update': 'project',
  'task:read': 'project',
  'task:create': 'project',
} as const;

const project = (over: Partial<ProjectDto> = {}): ProjectDto => ({
  id: 'p1',
  key: 'TST',
  name: 'Test Project',
  department: null,
  manager: user,
  owner: null,
  members: [{ user, role: 'manager' }],
  priority: 'medium',
  status: 'in_progress',
  objectives: [],
  archived: false,
  autoAssign: false,
  customFields: [
    { key: 'client_ref', label: 'Client ref', type: 'text', options: [], required: true },
    { key: 'env', label: 'Environment', type: 'select', options: ['UAT', 'PROD'], required: false },
  ],
  dependsOnCount: 2,
  wipLimits: {},
  components: [],
  workflow: { id: null, name: 'Standard workflow', statuses: [], labels: {} },
  confidential: false,
  hold: null,
  version: 1,
  progress: {
    totalTasks: 0,
    doneTasks: 0,
    overdueTasks: 0,
    blockedTasks: 0,
    percent: 0,
    byStatus: {},
  },
  can: { update: true, archive: true, createTask: true, manageMembers: true },
  createdAt: '',
  updatedAt: '',
  ...over,
});

const milestone = (over: Partial<MilestoneDto> = {}): MilestoneDto => ({
  id: 'm1',
  projectId: 'p1',
  name: 'UAT sign-off',
  dueDate: '2026-11-01',
  status: 'open',
  overdue: true,
  progress: { total: 2, done: 1, percent: 50 },
  canEdit: true,
  createdAt: '',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(work.fetchProjects).mockResolvedValue({ items: [project()], meta: meta(1) });
  vi.mocked(work.fetchProject).mockResolvedValue(project());
  vi.mocked(work.fetchProjectOverview).mockResolvedValue({
    project: project(),
    upcoming: [],
    workload: [],
  });
  vi.mocked(planning.fetchMilestones).mockResolvedValue([milestone()]);
});

describe('Duplicate check', () => {
  it('warns about similar tasks while typing a new task title', async () => {
    vi.mocked(intel.fetchSimilarTasks).mockResolvedValue([
      {
        id: 't7',
        key: 'TST-7',
        title: 'Fix login bug on Safari',
        status: 'in_progress',
        score: 0.86,
      },
    ]);
    const u = userEvent.setup();
    renderRoutes(routes, { path: '/tasks/board', permissions: pmPerms });
    await u.click(await screen.findByRole('button', { name: /new task/i }, { timeout: 15_000 }));
    const dialog = await screen.findByRole('dialog');
    await u.click(within(dialog).getByRole('combobox', { name: /project/i }));
    await u.click(await screen.findByRole('option', { name: 'TST · Test Project' }));
    await u.type(within(dialog).getByLabelText(/^Title/), 'Login bug fix for Safari');
    const warn = await within(dialog).findByRole(
      'status',
      { name: 'Possible duplicates' },
      { timeout: 5_000 },
    );
    expect(warn).toHaveTextContent('TST-7 Fix login bug on Safari (In Progress, 86% similar)');
    expect(intel.fetchSimilarTasks).toHaveBeenLastCalledWith('p1', 'Login bug fix for Safari');
  });
});

describe('New task with project fields, milestone and repeat', () => {
  it('validates required fields and a due date for repeating work, then sends everything', async () => {
    vi.mocked(work.createTask).mockResolvedValue({ id: 't9', key: 'TST-9' } as TaskDto);
    const u = userEvent.setup();
    renderRoutes(routes, { path: '/tasks/board', permissions: pmPerms });

    await u.click(await screen.findByRole('button', { name: /new task/i }, { timeout: 15_000 }));
    const dialog = await screen.findByRole('dialog');
    await u.click(within(dialog).getByRole('combobox', { name: /project/i }));
    await u.click(await screen.findByRole('option', { name: 'TST · Test Project' }));
    await u.type(within(dialog).getByLabelText(/^Title/), 'Monthly reconciliation');

    // Project fields appear once the project is chosen; the required one is enforced.
    await u.click(await within(dialog).findByRole('button', { name: 'Create task' }));
    expect(await within(dialog).findByText('Client ref is required')).toBeInTheDocument();
    expect(work.createTask).not.toHaveBeenCalled();
    await u.type(within(dialog).getByLabelText('Client ref (required)'), 'C-7');
    await u.click(within(dialog).getByRole('combobox', { name: 'Environment' }));
    await u.click(await screen.findByRole('option', { name: 'PROD' }));

    await u.click(within(dialog).getByRole('combobox', { name: 'Milestone' }));
    await u.click(await screen.findByRole('option', { name: /UAT sign-off/ }));
    await u.click(within(dialog).getByRole('combobox', { name: 'Repeat' }));
    await u.click(await screen.findByRole('option', { name: 'Monthly' }));
    expect(within(dialog).getByText(/Set a due date/)).toBeInTheDocument();
    await u.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(
      await within(dialog).findByText('A repeating task needs a due date'),
    ).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('Due date'), {
      target: { value: '2026-11-30' },
    });
    expect(
      await within(dialog).findByText(/Every month\. The next occurrence/),
    ).toBeInTheDocument();
    await u.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(work.createTask).toHaveBeenCalledOnce());
    expect(vi.mocked(work.createTask).mock.calls[0]![0]).toMatchObject({
      projectId: 'p1',
      title: 'Monthly reconciliation',
      dueDate: '2026-11-30',
      milestoneId: 'm1',
      recurrence: { frequency: 'monthly', interval: 1, workdaysOnly: false, until: null },
      customFields: { client_ref: 'C-7', env: 'PROD' },
    });
  });
});

describe('Project milestones and setup', () => {
  it('shows milestone progress with a labelled overdue state and adds a milestone', async () => {
    vi.mocked(planning.createMilestone).mockResolvedValue(milestone({ id: 'm2', name: 'Go-live' }));
    const u = userEvent.setup();
    renderRoutes(routes, { path: '/projects/p1', permissions: pmPerms });

    await u.click(await screen.findByRole('tab', { name: 'Milestones' }));
    const panel = await screen.findByRole('region', { name: 'Milestones' });
    expect(await within(panel).findByText('UAT sign-off')).toBeInTheDocument();
    expect(within(panel).getByText('1/2 tasks done')).toBeInTheDocument();
    expect(within(panel).getAllByText('Overdue').length).toBeGreaterThan(0);

    await u.click(within(panel).getByRole('button', { name: 'Add milestone' }));
    const dialog = await screen.findByRole('dialog');
    await u.type(within(dialog).getByLabelText(/Name/), 'Go-live');
    fireEvent.change(within(dialog).getByLabelText(/Due date/), {
      target: { value: '2026-12-15' },
    });
    await u.click(within(dialog).getByRole('button', { name: 'Add milestone' }));
    await waitFor(() =>
      expect(planning.createMilestone).toHaveBeenCalledWith('p1', {
        name: 'Go-live',
        dueDate: '2026-12-15',
        description: undefined,
      }),
    );
  });

  it('flags delayed upstream projects, hides inaccessible ones, and validates task field definitions', async () => {
    vi.mocked(planning.fetchDependencies).mockResolvedValue({
      dependsOn: [
        {
          project: {
            id: 'p9',
            key: 'API',
            name: 'Core API',
            status: 'in_progress',
            endDate: '2026-10-01',
          },
          delayed: true,
          reason: 'API passed its end date',
        },
      ],
      hiddenUpstream: 1,
      dependents: [],
      canEdit: true,
    });
    vi.mocked(planning.setCustomFields).mockImplementation(
      async (_id, input) => input.fields as never,
    );
    const u = userEvent.setup();
    renderRoutes(routes, { path: '/projects/p1', permissions: pmPerms });

    await u.click(await screen.findByRole('tab', { name: /Setup/ }));
    const deps = await screen.findByRole('region', { name: 'Project dependencies' });
    expect(await within(deps).findByText('At risk of delaying this project')).toBeInTheDocument();
    expect(within(deps).getByText('+ 1 project you do not have access to')).toBeInTheDocument();

    const fields = screen.getByRole('region', { name: 'Task fields' });
    await u.click(within(fields).getByRole('button', { name: 'Add field' }));
    await u.type(within(fields).getByLabelText('Field 3 label'), 'Release train');
    await u.click(within(fields).getByRole('combobox', { name: 'Field 3 type' }));
    await u.click(await screen.findByRole('option', { name: 'Dropdown' }));
    await u.type(within(fields).getByLabelText('Field 3 options'), 'Blue');
    await u.click(within(fields).getByRole('button', { name: 'Save fields' }));
    expect(await within(fields).findByRole('alert')).toHaveTextContent(
      'Release train: A dropdown needs at least two options',
    );
    expect(planning.setCustomFields).not.toHaveBeenCalled();

    await u.type(within(fields).getByLabelText('Field 3 options'), ', Green');
    // Removing an existing field warns that its values will be cleared.
    await u.click(within(fields).getByRole('button', { name: 'Remove field Environment' }));
    expect(
      within(fields).getByText(/clears the values tasks hold for: Environment/),
    ).toBeInTheDocument();
    await u.click(within(fields).getByRole('button', { name: 'Save fields' }));
    await waitFor(() => expect(planning.setCustomFields).toHaveBeenCalledOnce());
    expect(vi.mocked(planning.setCustomFields).mock.calls[0]![1]).toEqual({
      fields: [
        { key: 'client_ref', label: 'Client ref', type: 'text', options: [], required: true },
        {
          key: 'release_train',
          label: 'Release train',
          type: 'select',
          options: ['Blue', 'Green'],
          required: false,
        },
      ],
    });
  });
});

describe('Project templates', () => {
  it('lists templates and creates a project from one', async () => {
    const summary: TemplateSummaryDto = {
      id: 'tpl1',
      name: 'Release template',
      description: 'Standard release',
      priority: 'high',
      durationDays: 70,
      taskCount: 12,
      milestoneCount: 3,
      customFieldCount: 1,
      usageCount: 2,
      createdBy: { id: 'u-pm', name: 'Pat Manager' },
      canEdit: true,
      updatedAt: '',
    };
    vi.mocked(planning.fetchTemplates).mockResolvedValue([summary]);
    vi.mocked(planning.fetchTemplate).mockResolvedValue({
      ...summary,
      objectives: ['Ship safely'],
      customFields: [],
      milestones: [],
      tasks: [],
    });
    vi.mocked(work.createProject).mockResolvedValue(project({ id: 'p2', key: 'NEW' }));
    const u = userEvent.setup();
    renderRoutes(routes, { path: '/project-templates', permissions: pmPerms });

    expect(await screen.findByText('Release template')).toBeInTheDocument();
    expect(screen.getByText(/12 tasks · 3 milestones · 1 fields · 70 days/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Use' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText(/Adds 3 milestone\(s\), 12 task\(s\)/),
    ).toBeInTheDocument();
    await u.type(within(dialog).getByLabelText(/^Key/), 'NEW');
    await u.type(within(dialog).getByLabelText(/Project name/), 'New release');
    await u.click(within(dialog).getByRole('button', { name: /create project/i }));
    await waitFor(() => expect(work.createProject).toHaveBeenCalledOnce());
    expect(vi.mocked(work.createProject).mock.calls[0]![0]).toMatchObject({
      key: 'NEW',
      name: 'New release',
      templateId: 'tpl1',
      priority: 'high',
      objectives: ['Ship safely'],
      description: 'Standard release',
    });
  });
});
