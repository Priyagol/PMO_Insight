import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STATUS_LABELS, type ProjectDto, type TaskDto } from '@arihant/shared';
import { routes } from '@/routes/routes';
import type * as WorkApi from '@/services/api/work';
import { renderRoutes } from '@/test/render';
import { CommentBody } from './collab/CommentsPanel';

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
    fetchBoard: vi.fn(),
    fetchTask: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    bulkUpdateTasks: vi.fn(),
    bulkDeleteTasks: vi.fn(),
    fetchSavedViews: vi.fn().mockResolvedValue([]),
    createSavedView: vi.fn(),
    deleteSavedView: vi.fn(),
  };
});
vi.mock('@/services/api/org', () => ({
  fetchDepartments: vi.fn().mockResolvedValue([]),
  fetchUsers: vi.fn(),
}));
const work = await import('@/services/api/work');

const meta = (total: number) => ({ page: 1, limit: 25, total, totalPages: 1 });
const user = { id: 'u-dev', name: 'Dev One', email: 'dev@example.test', employeeId: 'E-1' };

const project = (over: Partial<ProjectDto> = {}): ProjectDto => ({
  id: 'p1',
  key: 'TRD',
  name: 'Trading Platform Revamp',
  department: null,
  manager: { ...user, id: 'u-pm', name: 'Pat Manager' },
  owner: null,
  members: [{ user, role: 'member' }],
  priority: 'high',
  status: 'in_progress',
  objectives: [],
  archived: false,
  autoAssign: false,
  customFields: [],
  dependsOnCount: 0,
  wipLimits: {},
  components: [],
  workflow: { id: null, name: 'Standard workflow', statuses: [], labels: {} },
  confidential: false,
  version: 1,
  progress: {
    totalTasks: 4,
    doneTasks: 1,
    overdueTasks: 1,
    blockedTasks: 0,
    percent: 25,
    byStatus: {},
  },
  can: { update: true, archive: false, createTask: true, manageMembers: true },
  createdAt: '',
  updatedAt: '',
  ...over,
});

const task = (over: Partial<TaskDto> = {}): TaskDto => ({
  id: 't1',
  key: 'TRD-1',
  project: { id: 'p1', key: 'TRD', name: 'Trading Platform Revamp' },
  parent: null,
  title: 'Fix login bug',
  status: 'todo',
  priority: 'critical',
  assignee: user,
  reporter: user,
  watcherIds: [],
  actualHours: 0,
  requiredSkills: [],
  tags: [],
  checklist: [],
  dependencies: [],
  milestone: null,
  recurrence: null,
  customFields: {},
  type: 'task',
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
  statusLabel: STATUS_LABELS[over.status ?? 'todo'],
  pendingTransition: null,
  restricted: false,
  allowedUserIds: [],
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('ProjectsPage', () => {
  it('lists projects with real progress figures and opens the project on click', async () => {
    vi.mocked(work.fetchProjects).mockResolvedValue({ items: [project()], meta: meta(1) });
    vi.mocked(work.fetchProject).mockResolvedValue(project());
    vi.mocked(work.fetchProjectOverview).mockResolvedValue({
      project: project(),
      upcoming: [],
      workload: [],
    });
    const user = userEvent.setup();
    const { router } = renderRoutes(routes, {
      path: '/projects',
      permissions: { 'project:read': 'project', 'project:create': 'project' },
    });
    expect(await screen.findByText('Trading Platform Revamp')).toBeInTheDocument();
    expect(screen.getByText('1/4 tasks')).toBeInTheDocument();
    expect(screen.getByText('· 1 overdue')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    await user.click(screen.getByText('Trading Platform Revamp'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p1'));
    expect(
      await screen.findByRole('heading', { name: 'Trading Platform Revamp' }),
    ).toBeInTheDocument();
  });
});

describe('My Tasks list view', () => {
  it('filters to my tasks and applies a bulk status change to the selection', async () => {
    vi.mocked(work.fetchTasks).mockResolvedValue({
      items: [task(), task({ id: 't2', key: 'TRD-2', title: 'Write tests' })],
      meta: meta(2),
    });
    vi.mocked(work.bulkUpdateTasks).mockResolvedValue({ updated: 2, failed: [] });
    const u = userEvent.setup();
    renderRoutes(routes, {
      path: '/tasks/mine',
      permissions: { 'task:read': 'own', 'task:update': 'own' },
    });

    expect(await screen.findByText('Fix login bug')).toBeInTheDocument();
    expect(vi.mocked(work.fetchTasks).mock.calls[0]![0]).toMatchObject({
      assigneeId: 'me',
      page: 1,
    });

    await u.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));
    const toolbar = screen.getByRole('toolbar', { name: 'Bulk actions' });
    expect(within(toolbar).getByText('2 selected')).toBeInTheDocument();
    await u.click(within(toolbar).getByRole('combobox', { name: 'Set priority' }));
    await u.click(await screen.findByRole('option', { name: 'Low' }));
    await waitFor(() => expect(work.bulkUpdateTasks).toHaveBeenCalledOnce());
    expect(vi.mocked(work.bulkUpdateTasks).mock.calls[0]![0]).toEqual({
      ids: ['t1', 't2'],
      set: { priority: 'low' },
    });
  });
});

describe('New task dialog', () => {
  it('requires a project and title, then sends the payload', async () => {
    vi.mocked(work.fetchBoard).mockResolvedValue([]);
    vi.mocked(work.fetchProjects).mockResolvedValue({ items: [project()], meta: meta(1) });
    vi.mocked(work.fetchProject).mockResolvedValue(project());
    vi.mocked(work.createTask).mockResolvedValue(task({ key: 'TRD-9' }));
    const u = userEvent.setup();
    renderRoutes(routes, {
      path: '/tasks/board',
      permissions: { 'task:read': 'project', 'task:create': 'project', 'project:read': 'project' },
    });

    await u.click(await screen.findByRole('button', { name: /new task/i }));
    const dialog = await screen.findByRole('dialog');
    await u.click(within(dialog).getByRole('button', { name: 'Create task' }));
    // The error message (a <p>), not the select placeholder with the same words.
    expect(
      await within(dialog).findByText('Choose a project', { selector: 'p' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a task title')).toBeInTheDocument();

    await u.click(within(dialog).getByRole('combobox', { name: /project/i }));
    await u.click(await screen.findByRole('option', { name: 'TRD · Trading Platform Revamp' }));
    await u.type(within(dialog).getByLabelText(/Title/), 'Add audit export');
    await u.type(within(dialog).getByLabelText(/Tags/), 'api, export');
    await u.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(work.createTask).toHaveBeenCalledOnce());
    expect(vi.mocked(work.createTask).mock.calls[0]![0]).toMatchObject({
      projectId: 'p1',
      title: 'Add audit export',
      status: 'todo',
      priority: 'medium',
      assigneeId: null,
      tags: ['api', 'export'],
    });
  });
});

describe('CommentBody', () => {
  it('highlights mentions and never renders HTML from comment text', () => {
    const { container } = render(
      <CommentBody
        body={'Hi @[Asha Rao](aaaaaaaaaaaaaaaaaaaaaaaa) <img src=x onerror=alert(1)>'}
      />,
    );
    expect(screen.getByText('@Asha Rao')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
