import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestTypeDto, ServiceRequestDto } from '@arihant/shared';
import { renderRoutes } from '@/test/render';
import { HelpCenterPage } from './HelpCenterPage';
import { ServiceDeskQueue } from './ServiceDeskPanels';

vi.mock('@/services/api/servicedesk', () => ({
  fetchPortal: vi.fn(),
  submitRequest: vi.fn(),
  fetchMyRequests: vi.fn(),
  fetchRequest: vi.fn(),
  fetchRequestComments: vi.fn(),
  addRequestComment: vi.fn(),
  rateRequest: vi.fn(),
  fetchDeskSettings: vi.fn(),
  saveDeskSettings: vi.fn(),
  fetchRequestTypes: vi.fn(),
  createRequestType: vi.fn(),
  updateRequestType: vi.fn(),
  fetchQueue: vi.fn(),
  fetchDeskReport: vi.fn(),
}));
const sd = await import('@/services/api/servicedesk');

const FIRST = { timeout: 20_000 };
const type: RequestTypeDto = {
  id: 'rt1',
  project: { id: 'p1', key: 'ITD', name: 'IT Help Desk' },
  name: 'Laptop problem',
  description: 'Hardware and software issues',
  kind: 'service_request',
  fields: [
    {
      key: 'category',
      label: 'Category',
      type: 'select',
      required: true,
      options: ['Hardware', 'Software'],
    },
    {
      key: 'asset_tag',
      label: 'Asset tag',
      type: 'text',
      required: true,
      options: [],
      showIf: { field: 'category', equals: 'Hardware' },
    },
  ],
  defaultPriority: 'medium',
  requesterSetsPriority: false,
  sla: { responseHours: 1, resolutionHours: 8 },
  approvalRequired: false,
  helpLinks: [{ title: 'Restart guide', url: 'https://intranet.example/restart' }],
  active: true,
};
const request = (over: Partial<ServiceRequestDto> = {}): ServiceRequestDto => ({
  id: 'r1',
  key: 'ITD-1',
  summary: 'Laptop will not boot',
  kind: 'service_request',
  requestType: { id: 'rt1', name: 'Laptop problem' },
  project: { id: 'p1', key: 'ITD', name: 'IT Help Desk' },
  status: 'done',
  statusLabel: 'Done',
  priority: 'medium',
  requester: { id: 'u1', name: 'Asha' },
  assignee: { id: 'u2', name: 'Ravi' },
  answers: [{ key: 'category', label: 'Category', value: 'Hardware' }],
  sla: {
    response: {
      dueAt: '2026-11-07T05:00:00.000Z',
      doneAt: '2026-11-07T04:30:00.000Z',
      state: 'met',
    },
    resolution: { dueAt: '2026-11-07T12:00:00.000Z', doneAt: null, state: 'breached' },
  },
  awaitingApproval: false,
  feedback: null,
  createdAt: '2026-11-07T04:00:00.000Z',
  resolvedAt: null,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('Help Center', () => {
  it('shows conditional fields, checks them before sending and raises the request', async () => {
    vi.mocked(sd.fetchPortal).mockResolvedValue([type]);
    vi.mocked(sd.fetchMyRequests).mockResolvedValue([]);
    vi.mocked(sd.submitRequest).mockResolvedValue(
      request({ status: 'todo', statusLabel: 'To Do' }),
    );
    vi.mocked(sd.fetchRequest).mockResolvedValue(request());
    vi.mocked(sd.fetchRequestComments).mockResolvedValue([]);
    const user = userEvent.setup();
    renderRoutes([{ path: '/help', element: <HelpCenterPage /> }], {
      path: '/help',
      permissions: { 'task:read': 'own' },
    });
    await user.click(await screen.findByRole('button', { name: /Laptop problem/ }, FIRST));
    expect(screen.getByRole('link', { name: 'Restart guide' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Asset tag/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Summary'), 'Laptop will not boot');
    await user.click(screen.getByRole('combobox', { name: 'Category' }));
    await user.click(await screen.findByRole('option', { name: 'Hardware' }));
    expect(screen.getByLabelText(/Asset tag/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Raise request' }));
    expect(await screen.findByText('Required')).toBeInTheDocument();
    expect(sd.submitRequest).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/Asset tag/), 'AC-1001');
    await user.click(screen.getByRole('button', { name: 'Raise request' }));
    await waitFor(() =>
      expect(sd.submitRequest).toHaveBeenCalledWith({
        requestTypeId: 'rt1',
        summary: 'Laptop will not boot',
        answers: { category: 'Hardware', asset_tag: 'AC-1001' },
      }),
    );
  });

  it('shows a request with its SLA, conversation and asks for a rating when resolved', async () => {
    vi.mocked(sd.fetchPortal).mockResolvedValue([]);
    vi.mocked(sd.fetchMyRequests).mockResolvedValue([request()]);
    vi.mocked(sd.fetchRequest).mockResolvedValue(request());
    vi.mocked(sd.fetchRequestComments).mockResolvedValue([
      {
        id: 'c1',
        author: { id: 'u2', name: 'Ravi' },
        fromTeam: true,
        body: 'Replaced the battery',
        createdAt: '2026-11-07T05:00:00.000Z',
      },
    ]);
    vi.mocked(sd.rateRequest).mockResolvedValue(
      request({ feedback: { rating: 4, comment: null } }),
    );
    const user = userEvent.setup();
    renderRoutes([{ path: '/help', element: <HelpCenterPage /> }], {
      path: '/help?request=r1',
      permissions: { 'task:read': 'own' },
    });
    const detail = await screen.findByRole('region', { name: 'Request ITD-1' }, FIRST);
    expect(detail).toHaveTextContent('Response met');
    expect(detail).toHaveTextContent('Resolution breached');
    expect(within(detail).getByRole('list', { name: 'Conversation' })).toHaveTextContent(
      'Replaced the battery',
    );
    await user.click(within(detail).getByRole('button', { name: '4 stars' }));
    await user.click(within(detail).getByRole('button', { name: 'Send rating' }));
    await waitFor(() => expect(sd.rateRequest).toHaveBeenCalledWith('r1', 4));
  });
});

describe('Service desk queue', () => {
  it('lists requests by queue with SLA clocks and the desk numbers', async () => {
    vi.mocked(sd.fetchQueue).mockResolvedValue([
      request({ status: 'in_progress', statusLabel: 'In Progress' }),
    ]);
    vi.mocked(sd.fetchDeskReport).mockResolvedValue({
      open: 1,
      resolvedLast30: 4,
      responseSlaMetPercent: 75,
      resolutionSlaMetPercent: 50,
      averageRating: 4.5,
      ratings: 2,
      byKind: [],
    });
    const user = userEvent.setup();
    renderRoutes([{ path: '/', element: <ServiceDeskQueue projectId="p1" /> }], {
      permissions: { 'task:read': 'project' },
    });
    expect(await screen.findByText('4.5 / 5', {}, FIRST)).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Requests' });
    expect(within(list).getByText('Laptop will not boot')).toBeInTheDocument();
    expect(list).toHaveTextContent('Resolution breached');
    await user.click(screen.getByRole('tab', { name: 'SLA breached' }));
    await waitFor(() => expect(sd.fetchQueue).toHaveBeenLastCalledWith('p1', 'breached'));
  });
});
