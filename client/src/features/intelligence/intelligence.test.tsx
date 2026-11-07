import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiStatusDto, AutomationRuleDto, ProjectDto, TaskDto } from '@arihant/shared';
import { routes } from '@/routes/routes';
import type * as WorkApi from '@/services/api/work';
import { renderRoutes } from '@/test/render';

vi.mock('@/services/api/intelligence', () => ({
  fetchAutomations: vi.fn(),
  createAutomation: vi.fn(),
  updateAutomation: vi.fn(),
  deleteAutomation: vi.fn(),
  fetchAutomationRuns: vi.fn(),
  testAutomation: vi.fn(),
  fetchAiStatus: vi.fn(),
  saveAiSettings: vi.fn(),
  aiRequirementsToTasks: vi.fn(),
  aiProjectSummary: vi.fn(),
  aiWorklogDraft: vi.fn(),
  aiMinutesToActions: vi.fn(),
  aiExplainHealth: vi.fn(),
  askData: vi.fn(),
  aiRiskScan: vi.fn(),
  fetchForecasts: vi.fn().mockResolvedValue([]),
  fetchSimilarTasks: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/services/api/work', async (orig) => {
  const actual = await orig<typeof WorkApi>();
  return {
    toParams: actual.toParams,
    fetchProjects: vi.fn(),
    fetchTasks: vi.fn(),
    createTask: vi.fn(),
  };
});
vi.mock('@/services/api/org', () => ({
  fetchDepartments: vi.fn().mockResolvedValue([]),
  fetchUsers: vi
    .fn()
    .mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } }),
  saveSettings: vi.fn(),
  fetchSettings: vi.fn().mockResolvedValue({
    organizationName: 'Test Org',
    timezone: 'Asia/Kolkata',
    workingDays: [1, 2, 3, 4, 5],
    workingHoursPerDay: 8,
    defaultWeeklyCapacityHours: 40,
    fiscalYearStartMonth: 4,
  }),
}));
const intel = await import('@/services/api/intelligence');
const work = await import('@/services/api/work');

const FIRST = { timeout: 15_000 };
const PID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const project = {
  id: PID,
  key: 'TST',
  name: 'Test Project',
  can: { update: true, createTask: true, archive: true, manageMembers: true },
} as ProjectDto;
const page = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, limit: 25, total: items.length, totalPages: 1 },
});
const status = (over: Partial<AiStatusDto> = {}): AiStatusDto => ({
  enabled: true,
  configured: true,
  dailyLimitPerUser: 50,
  usedToday: 0,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(work.fetchProjects).mockResolvedValue({ items: [project], meta: page([]).meta });
  vi.mocked(work.fetchTasks).mockResolvedValue(page([]));
  vi.mocked(intel.fetchAutomationRuns).mockResolvedValue(page([]));
  vi.mocked(intel.fetchAiStatus).mockResolvedValue(status());
});

describe('Automation Center', () => {
  it('builds a rule from trigger, condition and action, and validates before saving', async () => {
    vi.mocked(intel.fetchAutomations).mockResolvedValue([]);
    vi.mocked(intel.createAutomation).mockResolvedValue({ id: 'r1' } as AutomationRuleDto);
    const u = userEvent.setup();
    renderRoutes(routes, {
      path: '/automations',
      permissions: { 'automation:manage': 'project', 'project:read': 'project' },
    });

    await u.click(await screen.findByRole('button', { name: 'New automation' }, FIRST));
    const dialog = await screen.findByRole('dialog');
    await u.type(within(dialog).getByLabelText(/^Name/), 'Escalate critical');
    await u.click(within(dialog).getByRole('combobox', { name: 'Applies to' }));
    await u.click(await screen.findByRole('option', { name: 'TST · Test Project' }));
    // Organisation-wide is not offered without organisation-level rights.
    expect(screen.queryByRole('option', { name: /organisation-wide/ })).not.toBeInTheDocument();

    await u.click(within(dialog).getByRole('button', { name: /Condition/ }));
    await u.click(within(dialog).getByRole('combobox', { name: 'Condition 1 field' }));
    await u.click(await screen.findByRole('option', { name: 'Task priority' }));
    await u.click(within(dialog).getByRole('combobox', { name: 'Value' }));
    await u.click(await screen.findByRole('option', { name: 'critical' }));

    // The default action is "add tag" with an empty tag: saving shows the validation message.
    await u.click(within(dialog).getByRole('button', { name: 'Create automation' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/actions › 0 › tag/);
    expect(intel.createAutomation).not.toHaveBeenCalled();
    await u.type(within(dialog).getByLabelText('Action 1 tag'), 'escalated');
    await u.click(within(dialog).getByRole('button', { name: 'Create automation' }));
    await waitFor(() => expect(intel.createAutomation).toHaveBeenCalledOnce());
    expect(vi.mocked(intel.createAutomation).mock.calls[0]![0]).toEqual({
      name: 'Escalate critical',
      projectId: PID,
      trigger: 'task.created',
      conditions: {
        match: 'all',
        conditions: [{ field: 'task.priority', op: 'eq', value: 'critical' }],
      },
      actions: [{ type: 'add_tag', tag: 'escalated' }],
      schedule: null,
    });
  });

  it('lists rules with their last result and toggles them on and off', async () => {
    vi.mocked(intel.fetchAutomations).mockResolvedValue([
      {
        id: 'r1',
        name: 'Overdue alert',
        project: { id: PID, key: 'TST', name: 'Test Project' },
        trigger: 'task.overdue',
        conditions: { match: 'all', conditions: [] },
        actions: [{ type: 'notify', to: ['project_manager'], message: 'Overdue' }],
        enabled: true,
        schedule: null,
        owner: { id: 'u1', name: 'Pat Manager' },
        runCount: 4,
        lastRunAt: new Date().toISOString(),
        lastStatus: 'partial',
        canEdit: true,
        updatedAt: '',
      },
    ]);
    vi.mocked(intel.updateAutomation).mockResolvedValue({
      id: 'r1',
      name: 'Overdue alert',
      enabled: false,
    } as AutomationRuleDto);
    const u = userEvent.setup();
    renderRoutes(routes, {
      path: '/automations',
      permissions: { 'automation:manage': 'project', 'project:read': 'project' },
    });
    expect(await screen.findByText('Overdue alert', {}, FIRST)).toBeInTheDocument();
    expect(screen.getByText('Partly failed')).toBeInTheDocument();
    expect(screen.getByText(/4 run\(s\)/)).toBeInTheDocument();
    await u.click(screen.getByRole('checkbox', { name: 'Turn off Overdue alert' }));
    await waitFor(() =>
      expect(intel.updateAutomation).toHaveBeenCalledWith('r1', { enabled: false }),
    );
  });
});

describe('AI assistant', () => {
  it('explains when the assistant is unavailable instead of showing tools', async () => {
    vi.mocked(intel.fetchAiStatus).mockResolvedValue(status({ enabled: false }));
    renderRoutes(routes, {
      path: '/ai',
      permissions: { 'ai:use': 'own', 'project:read': 'project' },
    });
    expect(
      await screen.findByText('The AI assistant is not available', {}, FIRST),
    ).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Requirements/ })).not.toBeInTheDocument();
  });

  it('turns requirements into proposals and creates only the selected tasks (with subtasks)', async () => {
    vi.mocked(intel.aiRequirementsToTasks).mockResolvedValue({
      feature: 'requirements_to_tasks',
      model: 'claude-opus-5-5',
      disclaimer: 'AI-generated proposal. Review it before applying; nothing has been changed.',
      proposal: {
        tasks: [
          {
            title: 'Build login API',
            description: 'Accepts e-mail and password',
            priority: 'high',
            estimatedHours: 8,
            tags: ['api'],
            subtasks: ['Write tests'],
          },
          {
            title: 'Design login page',
            description: 'Accessible form',
            priority: 'medium',
            estimatedHours: null,
            tags: [],
            subtasks: [],
          },
        ],
        assumptions: ['SSO is out of scope'],
      },
    });
    vi.mocked(work.createTask).mockImplementation(
      async (input) => ({ id: `t-${input.title}`, key: 'TST-1' }) as TaskDto,
    );
    const u = userEvent.setup();
    renderRoutes(routes, {
      path: '/ai',
      permissions: { 'ai:use': 'own', 'project:read': 'project', 'task:create': 'project' },
    });

    await u.click(await screen.findByRole('tab', { name: 'Requirements → tasks' }, FIRST));
    await u.click(await screen.findByRole('combobox', { name: 'Project' }));
    await u.click(await screen.findByRole('option', { name: 'TST · Test Project' }));
    await u.type(
      screen.getByRole('textbox', { name: /^Requirements/ }),
      'Users must be able to log in with e-mail and password.',
    );
    await u.click(screen.getByRole('button', { name: /Propose tasks/ }));

    const list = await screen.findByRole('region', { name: 'Proposed tasks' });
    expect(within(list).getByText('AI proposal')).toBeInTheDocument();
    expect(within(list).getByText(/nothing has been changed/)).toBeInTheDocument();
    expect(work.createTask).not.toHaveBeenCalled();
    await u.click(within(list).getByRole('checkbox', { name: 'Include Design login page' }));
    await u.click(within(list).getByRole('button', { name: 'Create 1 selected task' }));
    await waitFor(() => expect(work.createTask).toHaveBeenCalledTimes(2));
    expect(vi.mocked(work.createTask).mock.calls.map((c) => c[0])).toEqual([
      {
        projectId: PID,
        title: 'Build login API',
        description: 'Accepts e-mail and password',
        priority: 'high',
        estimatedHours: 8,
        tags: ['api'],
      },
      { projectId: PID, parentId: 't-Build login API', title: 'Write tests' },
    ]);
  });

  it('lets an administrator enable the assistant and shows missing server configuration', async () => {
    vi.mocked(intel.fetchAiStatus).mockResolvedValue(status({ enabled: false, configured: false }));
    vi.mocked(intel.saveAiSettings).mockResolvedValue(
      status({ enabled: true, configured: false, dailyLimitPerUser: 20 }),
    );
    const u = userEvent.setup();
    renderRoutes(routes, { path: '/admin/settings', permissions: { 'settings:manage': 'org' } });
    const panel = await screen.findByRole('region', { name: 'AI assistant settings' }, FIRST);
    expect(within(panel).getByText(/no API key configured/)).toBeInTheDocument();
    await u.click(within(panel).getByRole('checkbox'));
    const limit = within(panel).getByRole('spinbutton');
    await u.clear(limit);
    await u.type(limit, '20');
    await u.click(within(panel).getByRole('button', { name: 'Save AI settings' }));
    await waitFor(() =>
      expect(intel.saveAiSettings).toHaveBeenCalledWith({ enabled: true, dailyLimitPerUser: 20 }),
    );
  });
});

describe('Ask Your Data', () => {
  it('shows what was looked up, the answer, notes, and a chart with a table view', async () => {
    vi.mocked(intel.askData).mockResolvedValue({
      question: 'Critical tasks by project',
      interpretation:
        'Tasks · priority Critical · grouped by project. Counts critical tasks per project.',
      answer: '5 task(s) in 2 group(s).',
      columns: ['Project', 'Tasks'],
      rows: [
        ['TST · Test Project', 3],
        ['OPS · Operations', 2],
      ],
      chart: { labelColumn: 0, valueColumn: 1 },
      notes: ['Not found among your projects: XYZ.'],
      model: 'claude-opus-5-5',
      plan: {} as never,
    });
    const u = userEvent.setup();
    renderRoutes(routes, {
      path: '/ai',
      permissions: { 'ai:use': 'own', 'project:read': 'project' },
    });
    await u.type(
      await screen.findByRole('textbox', { name: 'Your question' }, FIRST),
      'Critical tasks by project',
    );
    await u.click(screen.getByRole('button', { name: /^Ask$/ }));
    await waitFor(() => expect(intel.askData).toHaveBeenCalledWith('Critical tasks by project'));
    const answer = await screen.findByRole('region', { name: 'Answer' });
    expect(within(answer).getByText('5 task(s) in 2 group(s).')).toBeInTheDocument();
    expect(within(answer).getByText(/grouped by project/)).toBeInTheDocument();
    expect(within(answer).getByText(/Not found among your projects: XYZ/)).toBeInTheDocument();
    await u.click(within(answer).getByRole('button', { name: /as a table/ }));
    expect(within(answer).getByRole('row', { name: /TST · Test Project 3/ })).toBeInTheDocument();
  });
});

describe('Workflow Builder', () => {
  it('draws the rule as it is edited and saves a scheduled rule', async () => {
    vi.mocked(intel.fetchAutomations).mockResolvedValue([]);
    vi.mocked(intel.createAutomation).mockResolvedValue({ id: 'r9' } as AutomationRuleDto);
    const u = userEvent.setup();
    renderRoutes(routes, {
      path: '/workflows',
      permissions: { 'automation:manage': 'project', 'project:read': 'project' },
    });
    const editor = await screen.findByRole('region', { name: 'Rule editor' }, FIRST);
    const diagram = screen.getByRole('list', { name: 'Rule diagram' });
    expect(within(diagram).getByText('A task is created')).toBeInTheDocument();

    await u.type(within(editor).getByLabelText(/^Name/), 'Weekly overdue sweep');
    await u.click(within(editor).getByRole('combobox', { name: 'Applies to' }));
    await u.click(await screen.findByRole('option', { name: 'TST · Test Project' }));
    await u.click(within(editor).getByRole('combobox', { name: 'Trigger' }));
    await u.click(
      await screen.findByRole('option', { name: 'On a schedule (checks each open task)' }),
    );
    await u.click(within(editor).getByRole('combobox', { name: 'Frequency' }));
    await u.click(await screen.findByRole('option', { name: 'Every week' }));
    expect(within(diagram).getByText('Every Monday at 09:00')).toBeInTheDocument();

    await u.click(within(editor).getByRole('button', { name: /Condition/ }));
    await u.click(within(editor).getByRole('combobox', { name: 'Condition 1 field' }));
    await u.click(await screen.findByRole('option', { name: 'Task is overdue' }));
    expect(within(diagram).getByText(/Task is overdue is/)).toBeInTheDocument();
    await u.type(within(editor).getByLabelText('Action 1 tag'), 'overdue');
    expect(within(diagram).getByText('Add tag “overdue”')).toBeInTheDocument();

    await u.click(within(editor).getByRole('button', { name: 'Create rule' }));
    await waitFor(() => expect(intel.createAutomation).toHaveBeenCalledOnce());
    expect(vi.mocked(intel.createAutomation).mock.calls[0]![0]).toMatchObject({
      trigger: 'schedule',
      schedule: { frequency: 'weekly', weekday: 1, hour: 9 },
      conditions: { match: 'all', conditions: [{ field: 'task.overdue', op: 'eq', value: true }] },
    });
  });
});
