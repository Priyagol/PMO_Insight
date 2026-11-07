import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderRoutes } from '@/test/render';
import { CreatedResolvedChart } from './CreatedResolvedChart';
import { ReportSchedules } from './ReportSchedules';

vi.mock('@/services/api/reporting', () => ({
  fetchCreatedResolved: vi.fn(),
  fetchSubscriptions: vi.fn(),
  createSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  deleteSubscription: vi.fn(),
  sendSubscriptionNow: vi.fn(),
}));
vi.mock('@/services/api/search', () => ({
  fetchFilters: vi.fn().mockResolvedValue([
    {
      id: 'f1',
      name: 'Open bugs',
      aql: 'type = bug',
      sharing: 'private',
      project: null,
      owner: { id: 'u1', name: 'Me' },
      favourite: true,
      canEdit: true,
      description: null,
      updatedAt: '',
    },
  ]),
  globalSearch: vi.fn(),
}));
const rep = await import('@/services/api/reporting');

const FIRST = { timeout: 20_000 };
beforeEach(() => vi.clearAllMocks());

describe('Created vs resolved', () => {
  it('summarises the period and offers the numbers as a table', async () => {
    vi.mocked(rep.fetchCreatedResolved).mockResolvedValue({
      period: { from: '2026-11-01', to: '2026-11-07' },
      interval: 'day',
      points: [
        { bucket: '2026-11-06', created: 3, resolved: 1, openChange: 2 },
        { bucket: '2026-11-07', created: 0, resolved: 2, openChange: 0 },
      ],
      totals: { created: 3, resolved: 3 },
    });
    renderRoutes([{ path: '/', element: <CreatedResolvedChart aql="project = TRD" /> }], {
      permissions: { 'task:read': 'project' },
    });
    expect(await screen.findByText(/3 created, 3 resolved/, {}, FIRST)).toBeInTheDocument();
    expect(rep.fetchCreatedResolved).toHaveBeenCalledWith(
      expect.objectContaining({ aql: 'project = TRD', interval: 'day' }),
    );
  });
});

describe('Scheduled reports', () => {
  it('schedules a weekly Excel export of a saved filter', async () => {
    vi.mocked(rep.fetchSubscriptions).mockResolvedValue([]);
    vi.mocked(rep.createSubscription).mockResolvedValue({
      id: 's1',
      name: 'Weekly bugs',
      report: 'filter',
      filter: { id: 'f1', name: 'Open bugs' },
      format: 'xlsx',
      frequency: 'weekly',
      dayOfWeek: 1,
      dayOfMonth: 1,
      hour: 9,
      recipients: [],
      active: true,
      nextRunAt: null,
      lastRunAt: null,
      lastResult: null,
      canEdit: true,
    });
    const user = userEvent.setup();
    renderRoutes([{ path: '/', element: <ReportSchedules /> }], {
      permissions: { 'task:read': 'project', 'analytics:view': 'project' },
    });
    await user.click(await screen.findByRole('button', { name: /Schedule a report/ }, FIRST));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Weekly bugs');
    await user.click(within(dialog).getByRole('combobox', { name: 'Filter' }));
    await user.click(await screen.findByRole('option', { name: 'Open bugs' }));
    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    await waitFor(() =>
      expect(rep.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Weekly bugs',
          report: 'filter',
          filterId: 'f1',
          format: 'xlsx',
          frequency: 'weekly',
          dayOfWeek: 1,
          hour: 9,
          recipientIds: [expect.any(String)],
        }),
      ),
    );
  });
});
