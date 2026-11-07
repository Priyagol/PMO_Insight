import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_WORKFLOW,
  type ProjectDto,
  type TaskDto,
  type TaskTransitionsDto,
  type WorkflowDto,
} from '@arihant/shared';
import { ApiClientError } from '@/services/api/client';
import { renderRoutes } from '@/test/render';
import { ProjectWorkflowPanel } from './ProjectWorkflowPanel';
import { TaskWorkflowControl } from './TaskWorkflowControl';
import { WorkflowsPage } from './WorkflowsPage';

vi.mock('@/services/api/workflows', () => ({
  fetchWorkflows: vi.fn(),
  createWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
  assignWorkflow: vi.fn(),
  fetchTaskTransitions: vi.fn(),
  fetchTransitionHistory: vi.fn(),
}));
const api = await import('@/services/api/workflows');

const FIRST = { timeout: 20_000 };
const managerPerms = {
  'project:read': 'department',
  'project:update': 'department',
  'task:read': 'department',
  'task:update': 'department',
} as const;

const task = {
  id: 't1',
  key: 'TRD-1',
  title: 'Login retry',
  status: 'in_progress',
  statusLabel: 'In Progress',
  pendingTransition: null,
} as unknown as TaskDto;

const transitions: TaskTransitionsDto = {
  workflow: {
    id: 'w1',
    name: 'Code review flow',
    statuses: ['todo', 'in_progress', 'in_review', 'done'],
    labels: { in_review: 'Code review' },
  },
  current: 'in_progress',
  pending: null,
  transitions: [
    {
      id: 'review',
      name: 'Send to code review',
      to: 'in_review',
      toLabel: 'Code review',
      requireComment: true,
      approval: false,
      blockers: [],
    },
    {
      id: 'accept',
      name: 'Accept',
      to: 'done',
      toLabel: 'Done',
      requireComment: false,
      approval: false,
      blockers: ['Only Project Manager can use “Accept”'],
    },
  ],
};

const workflow: WorkflowDto = {
  id: 'w1',
  name: 'Code review flow',
  description: null,
  definition: {
    ...DEFAULT_WORKFLOW,
    statuses: ['todo', 'in_progress', 'in_review', 'done'],
    transitions: DEFAULT_WORKFLOW.transitions
      .filter((t) => ['todo', 'in_progress', 'in_review', 'done'].includes(t.to))
      .map((t) => ({
        ...t,
        from: t.from.filter((f) => ['todo', 'in_progress', 'in_review', 'done'].includes(f)),
      })),
  },
  projects: [],
  canEdit: true,
  updatedAt: '2026-11-07T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.fetchTaskTransitions).mockResolvedValue(transitions);
  vi.mocked(api.fetchWorkflows).mockResolvedValue([workflow]);
});

describe('Task status control', () => {
  it('offers workflow transitions, explains blocked ones and asks for a comment', async () => {
    const onMove = vi.fn();
    const user = userEvent.setup();
    renderRoutes(
      [{ path: '/', element: <TaskWorkflowControl task={task} editable onMove={onMove} /> }],
      {
        permissions: managerPerms,
      },
    );
    await user.click(await screen.findByRole('button', { name: /Change status/ }, FIRST));
    const accept = await screen.findByRole('menuitem', { name: /Accept/ });
    expect(accept).toHaveAttribute('aria-disabled', 'true');
    expect(accept).toHaveTextContent('Only Project Manager');
    await user.click(screen.getByRole('menuitem', { name: /Send to code review/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Comment'), 'Ready');
    await user.click(within(dialog).getByRole('button', { name: 'Send to code review' }));
    expect(onMove).toHaveBeenCalledWith({ status: 'in_review', transitionComment: 'Ready' });
  });

  it('shows a move waiting for approval', async () => {
    vi.mocked(api.fetchTaskTransitions).mockResolvedValue({
      ...transitions,
      pending: { to: 'todo', approvalId: 'a1', approvalKey: 'APR-7', requestedBy: 'u1' },
    });
    renderRoutes(
      [{ path: '/', element: <TaskWorkflowControl task={task} editable onMove={vi.fn()} /> }],
      {
        permissions: managerPerms,
      },
    );
    expect(await screen.findByRole('status', {}, FIRST)).toHaveTextContent(
      'Waiting for approval to move to To Do (APR-7)',
    );
  });
});

describe('Workflow library', () => {
  it('builds a workflow with live validation and saves it', async () => {
    vi.mocked(api.fetchWorkflows).mockResolvedValue([]);
    vi.mocked(api.createWorkflow).mockResolvedValue(workflow);
    const user = userEvent.setup();
    renderRoutes([{ path: '/', element: <WorkflowsPage /> }], { permissions: managerPerms });
    await user.click(await screen.findByRole('button', { name: /New workflow/ }, FIRST));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Workflow name'), 'QA flow');
    await user.type(within(dialog).getByLabelText('Display name for In Review'), 'Code review');
    await user.click(within(dialog).getByRole('button', { name: 'Estimate required in Done' }));

    // Removing the only way into Done is caught before saving.
    await user.click(within(dialog).getByRole('button', { name: 'Remove transition Done' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'No transition leads to Done',
    );
    expect(within(dialog).getByRole('button', { name: 'Save workflow' })).toBeDisabled();
  }, 60_000);

  it('saves a valid workflow', async () => {
    vi.mocked(api.fetchWorkflows).mockResolvedValue([]);
    vi.mocked(api.createWorkflow).mockResolvedValue(workflow);
    const user = userEvent.setup();
    renderRoutes([{ path: '/', element: <WorkflowsPage /> }], { permissions: managerPerms });
    await user.click(await screen.findByRole('button', { name: /New workflow/ }, FIRST));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Workflow name'), 'QA flow');
    await user.click(within(dialog).getByRole('button', { name: 'Remove Testing' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save workflow' }));
    await waitFor(() => expect(api.createWorkflow).toHaveBeenCalled());
    const input = vi.mocked(api.createWorkflow).mock.calls[0]![0];
    expect(input.name).toBe('QA flow');
    expect(input.definition.statuses).not.toContain('testing');
  }, 60_000);
});

describe('Project workflow', () => {
  it('asks where tasks go when the new workflow drops their status', async () => {
    vi.mocked(api.assignWorkflow)
      .mockRejectedValueOnce(
        new ApiClientError(422, 'UNPROCESSABLE', 'Choose where tasks go', {
          unmapped: [{ status: 'testing', count: 2 }],
        }),
      )
      .mockResolvedValueOnce({ workflowId: 'w1', moved: 2 });
    const project = {
      id: 'p1',
      key: 'TRD',
      can: { update: true },
      workflow: {
        id: null,
        name: 'Standard workflow',
        statuses: DEFAULT_WORKFLOW.statuses,
        labels: {},
      },
    } as unknown as ProjectDto;
    const user = userEvent.setup();
    renderRoutes([{ path: '/', element: <ProjectWorkflowPanel project={project} /> }], {
      permissions: managerPerms,
    });
    await user.click(await screen.findByRole('combobox', { name: 'Workflow' }, FIRST));
    await user.click(await screen.findByRole('option', { name: 'Code review flow' }));
    await user.click(screen.getByRole('button', { name: 'Use this workflow' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Testing (2)');
    await user.click(screen.getByRole('combobox', { name: 'New status for Testing' }));
    await user.click(await screen.findByRole('option', { name: 'In Review' }));
    await user.click(screen.getByRole('button', { name: 'Use this workflow' }));
    await waitFor(() =>
      expect(api.assignWorkflow).toHaveBeenLastCalledWith('p1', {
        workflowId: 'w1',
        statusMap: { testing: 'in_review' },
      }),
    );
  });
});
