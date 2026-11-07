import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalDto, MeetingDto, NotificationDto, ProjectDto } from '@arihant/shared';
import { routes } from '@/routes/routes';
import type * as WorkApi from '@/services/api/work';
import { renderRoutes } from '@/test/render';

vi.mock('@/services/api/collaboration', () => ({
  fetchNotifications: vi.fn(),
  fetchUnreadCount: vi.fn(),
  markNotificationRead: vi.fn().mockResolvedValue(undefined),
  markAllNotificationsRead: vi.fn().mockResolvedValue({ updated: 1 }),
  fetchNotificationPrefs: vi.fn(),
  saveNotificationPrefs: vi.fn(),
  fetchApprovals: vi.fn(),
  fetchApproval: vi.fn(),
  createApproval: vi.fn(),
  approveApproval: vi.fn(),
  rejectApproval: vi.fn(),
  delegateApproval: vi.fn(),
  cancelApproval: vi.fn(),
  fetchWorkflows: vi.fn().mockResolvedValue([]),
  saveWorkflow: vi.fn(),
  fetchMeetings: vi.fn(),
  fetchMeeting: vi.fn(),
  createMeeting: vi.fn(),
  updateMeeting: vi.fn(),
  deleteMeeting: vi.fn(),
  saveMinutes: vi.fn(),
  convertActionItem: vi.fn(),
}));
vi.mock('@/services/api/work', async (orig) => {
  const actual = await orig<typeof WorkApi>();
  return { toParams: actual.toParams, fetchProjects: vi.fn(), fetchProject: vi.fn() };
});
vi.mock('@/services/api/org', () => ({
  fetchDepartments: vi.fn().mockResolvedValue([]),
  fetchUsers: vi
    .fn()
    .mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } }),
  fetchRoles: vi.fn().mockResolvedValue([]),
}));
const collab = await import('@/services/api/collaboration');
const work = await import('@/services/api/work');

const FIRST = { timeout: 15_000 };
const pm = { id: 'u-pm', name: 'Pat Manager', email: 'pm@example.test', employeeId: 'E-1' };
const dev = { id: 'u-dev', name: 'Dev One', email: 'dev@example.test', employeeId: 'E-2' };
const page = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, limit: 20, total: items.length, totalPages: 1 },
});
const proj = { id: 'p1', key: 'TST', name: 'Test Project' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(collab.fetchUnreadCount).mockResolvedValue({ unread: 0 });
  vi.mocked(collab.fetchApprovals).mockResolvedValue(page([]));
  vi.mocked(collab.fetchMeetings).mockResolvedValue(page([]));
  vi.mocked(work.fetchProjects).mockResolvedValue({
    items: [proj as ProjectDto],
    meta: page([]).meta,
  });
  vi.mocked(work.fetchProject).mockResolvedValue({
    ...proj,
    members: [
      { user: pm, role: 'manager' },
      { user: dev, role: 'member' },
    ],
  } as ProjectDto);
});

describe('Notification centre', () => {
  it('shows the unread count, opens a notification (marking it read) and saves e-mail settings', async () => {
    const n: NotificationDto = {
      id: 'n1',
      type: 'task_assigned',
      title: 'TST-4 was assigned to you',
      body: 'Pat Manager assigned "Fix login" to you.',
      link: '/approvals',
      actor: { id: 'u-pm', name: 'Pat Manager' },
      read: false,
      createdAt: new Date().toISOString(),
    };
    vi.mocked(collab.fetchUnreadCount).mockResolvedValue({ unread: 3 });
    vi.mocked(collab.fetchNotifications).mockResolvedValue(page([n]));
    vi.mocked(collab.fetchNotificationPrefs).mockResolvedValue({
      emailEnabled: true,
      email: { task_assigned: true, mentioned: true },
    });
    vi.mocked(collab.saveNotificationPrefs).mockImplementation(async (p) => p);
    const u = userEvent.setup();
    const { router } = renderRoutes(routes, {
      path: '/approvals',
      permissions: { 'project:read': 'project' },
    });

    const bell = await screen.findByRole('button', { name: 'Notifications, 3 unread' }, FIRST);
    await u.click(bell);
    await u.click(await screen.findByRole('button', { name: /TST-4 was assigned to you/ }));
    await waitFor(() => expect(collab.markNotificationRead).toHaveBeenCalledWith('n1'));
    expect(router.state.location.pathname).toBe('/approvals');

    await u.click(screen.getByRole('button', { name: /Notifications/ }));
    await u.click(await screen.findByRole('button', { name: 'Notification settings' }));
    const dialog = await screen.findByRole('dialog');
    await u.click(await within(dialog).findByRole('checkbox', { name: 'Someone @mentions me' }));
    await u.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(collab.saveNotificationPrefs).toHaveBeenCalledOnce());
    expect(vi.mocked(collab.saveNotificationPrefs).mock.calls[0]![0]).toMatchObject({
      emailEnabled: true,
      email: { mentioned: false, task_assigned: true },
    });
  });
});

const approval = (over: Partial<ApprovalDto> = {}): ApprovalDto => ({
  id: 'a1',
  key: 'APR-1',
  entityType: 'general',
  title: 'Budget increase',
  amount: 250000,
  project: proj,
  requestedBy: dev,
  status: 'pending',
  currentStage: 0,
  stages: [
    {
      name: 'Project manager',
      approverType: 'project_manager',
      status: 'pending',
      approvers: [pm],
      decidedBy: null,
      overdue: true,
      dueAt: new Date(Date.now() - 3_600_000).toISOString(),
    },
    {
      name: 'Department head',
      approverType: 'department_head',
      status: 'waiting',
      approvers: [],
      decidedBy: null,
      overdue: false,
    },
  ],
  history: [{ at: new Date().toISOString(), by: dev, action: 'submitted' }],
  can: { act: true, cancel: false },
  createdAt: new Date().toISOString(),
  ...over,
});

describe('Approvals', () => {
  it('lets an approver review stages and approve with a comment; rejecting needs a reason', async () => {
    vi.mocked(collab.fetchApprovals).mockResolvedValue(page([approval()]));
    vi.mocked(collab.fetchApproval).mockResolvedValue(approval());
    vi.mocked(collab.approveApproval).mockResolvedValue(approval({ currentStage: 1 }));
    const u = userEvent.setup();
    renderRoutes(routes, {
      path: '/approvals',
      permissions: { 'project:read': 'project', 'approval:act': 'project' },
    });

    const row = await screen.findByRole('row', { name: /APR-1/ }, FIRST);
    expect(row).toHaveTextContent('₹2,50,000');
    expect(row).toHaveTextContent('past deadline');
    await u.click(row);
    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByText(/Approver: Pat Manager/)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /Reject/ })).toBeDisabled();
    await u.type(within(sheet).getByLabelText('Comment'), 'Within plan');
    expect(within(sheet).getByRole('button', { name: /Reject/ })).toBeEnabled();
    await u.click(within(sheet).getByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(collab.approveApproval).toHaveBeenCalledWith('a1', 'Within plan'));
  });

  it('shows requesters without approval rights only their own requests', async () => {
    renderRoutes(routes, { path: '/approvals', permissions: { 'project:read': 'project' } });
    expect(await screen.findByRole('tab', { name: 'My requests' }, FIRST)).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Waiting for me' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(collab.fetchApprovals).toHaveBeenCalledWith(expect.objectContaining({ box: 'mine' })),
    );
  });
});

const meeting = (over: Partial<MeetingDto> = {}): MeetingDto => ({
  id: 'm1',
  project: proj,
  title: 'Sprint review',
  type: 'review',
  status: 'scheduled',
  startAt: '2026-11-10T04:30:00.000Z',
  endAt: '2026-11-10T05:30:00.000Z',
  organizer: pm,
  participants: [pm, dev],
  agenda: ['Demo'],
  decisions: [],
  actionItems: [{ id: 'ai1', text: 'Fix export bug', assignee: dev, priority: 'high', task: null }],
  can: { edit: true },
  createdAt: '',
  ...over,
});

describe('Meetings', () => {
  it('validates the time range and schedules with participants and agenda', async () => {
    vi.mocked(collab.createMeeting).mockResolvedValue(meeting());
    const u = userEvent.setup();
    renderRoutes(routes, {
      path: '/meetings',
      permissions: {
        'project:read': 'project',
        'meeting:read': 'project',
        'meeting:write': 'project',
      },
    });
    await u.click(await screen.findByRole('button', { name: /Schedule meeting/ }, FIRST));
    const dialog = await screen.findByRole('dialog');
    await u.click(within(dialog).getByRole('combobox', { name: /Project/ }));
    await u.click(await screen.findByRole('option', { name: 'TST · Test Project' }));
    await u.type(within(dialog).getByLabelText(/^Title/), 'Sprint review');
    fireEvent.change(within(dialog).getByLabelText(/^Date/), { target: { value: '2026-11-10' } });
    fireEvent.change(within(dialog).getByLabelText(/^Start/), { target: { value: '11:00' } });
    fireEvent.change(within(dialog).getByLabelText(/^End/), { target: { value: '10:00' } });
    expect(within(dialog).getByText('End must be after the start')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Schedule' })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/^End/), { target: { value: '12:00' } });
    await u.type(within(dialog).getByLabelText(/Agenda/), 'Demo{enter}Risks');
    await u.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(collab.createMeeting).toHaveBeenCalledOnce());
    const sent = vi.mocked(collab.createMeeting).mock.calls[0]![0];
    expect(sent).toMatchObject({
      projectId: 'p1',
      title: 'Sprint review',
      type: 'review',
      agenda: ['Demo', 'Risks'],
    });
    expect(new Date(sent.endAt).getTime() - new Date(sent.startAt).getTime()).toBe(3_600_000);
  });

  it('publishes minutes with decisions and action items, and turns an item into a task', async () => {
    vi.mocked(collab.fetchMeeting).mockResolvedValue(meeting());
    vi.mocked(collab.saveMinutes).mockResolvedValue(
      meeting({ minutesPublishedAt: new Date().toISOString(), status: 'completed' }),
    );
    vi.mocked(collab.convertActionItem).mockResolvedValue(meeting());
    const u = userEvent.setup();
    renderRoutes(routes, {
      path: '/meetings?open=m1',
      permissions: {
        'project:read': 'project',
        'meeting:read': 'project',
        'meeting:write': 'project',
        'task:create': 'project',
      },
    });
    const sheet = await screen.findByRole('dialog', {}, FIRST);
    await u.type(
      await within(sheet).findByRole('textbox', { name: /^Minutes/ }),
      'Demo went well.',
    );
    await u.type(within(sheet).getByLabelText(/^Decisions/), 'Ship on Friday');
    await u.click(within(sheet).getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(collab.convertActionItem).toHaveBeenCalledWith('m1', 'ai1'));
    await u.click(within(sheet).getByRole('button', { name: 'Save & publish' }));
    await waitFor(() => expect(collab.saveMinutes).toHaveBeenCalledOnce());
    expect(vi.mocked(collab.saveMinutes).mock.calls[0]![1]).toEqual({
      minutes: 'Demo went well.',
      decisions: ['Ship on Friday'],
      actionItems: [
        { id: 'ai1', text: 'Fix export bug', assigneeId: 'u-dev', dueDate: null, priority: 'high' },
      ],
      publish: true,
    });
  });
});
