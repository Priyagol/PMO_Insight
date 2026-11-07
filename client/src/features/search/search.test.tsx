import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedFilterDto, TaskDto } from '@arihant/shared';
import { renderRoutes } from '@/test/render';
import { SearchPage } from './SearchPage';

vi.mock('@/services/api/search', () => ({
  searchTasks: vi.fn(),
  fetchSearchStats: vi.fn(),
  exportSearch: vi.fn(),
  fetchSearchHistory: vi.fn(),
  clearSearchHistory: vi.fn(),
  globalSearch: vi.fn(),
  fetchFilters: vi.fn(),
  createFilter: vi.fn(),
  updateFilter: vi.fn(),
  deleteFilter: vi.fn(),
  setFilterFavourite: vi.fn(),
  fetchGadgets: vi.fn(),
  addGadget: vi.fn(),
  removeGadget: vi.fn(),
}));
vi.mock('@/services/api/reporting', () => ({
  fetchCreatedResolved: vi.fn().mockResolvedValue({
    period: { from: '2026-10-09', to: '2026-11-07' },
    interval: 'day',
    points: [{ bucket: '2026-11-07', created: 1, resolved: 0, openChange: 1 }],
    totals: { created: 1, resolved: 0 },
  }),
  fetchSubscriptions: vi.fn().mockResolvedValue([]),
  createSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  deleteSubscription: vi.fn(),
  sendSubscriptionNow: vi.fn(),
}));
vi.mock('@/services/api/work', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchProjects: vi.fn().mockResolvedValue({
    items: [],
    meta: { page: 1, limit: 100, total: 0, totalPages: 0 },
  }),
}));
const api = await import('@/services/api/search');

const FIRST = { timeout: 20_000 };
const task = {
  id: '64b0000000000000000000t1',
  key: 'TRD-1',
  title: 'Login retry fails',
  type: 'bug',
  status: 'todo',
  priority: 'critical',
  assignee: null,
  dueDate: '2026-01-10',
  updatedAt: '2026-11-07T04:00:00.000Z',
  project: { id: 'p1', key: 'TRD', name: 'Trading' },
} as unknown as TaskDto;
const filter: SavedFilterDto = {
  id: 'f1',
  name: 'Open bugs',
  description: null,
  aql: 'type = bug AND status != done',
  sharing: 'project',
  project: { id: 'p1', key: 'TRD', name: 'Trading' },
  owner: { id: 'u1', name: 'PM One' },
  favourite: true,
  canEdit: true,
  updatedAt: '2026-11-07T04:00:00.000Z',
};

const render = (path = '/search') =>
  renderRoutes([{ path: '/search', element: <SearchPage /> }], {
    path,
    permissions: { 'task:read': 'project', 'project:read': 'project' },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.searchTasks).mockResolvedValue({
    items: [task],
    meta: { page: 1, limit: 25, total: 1, totalPages: 1 },
  });
  vi.mocked(api.fetchSearchStats).mockResolvedValue([{ key: 'todo', label: 'To Do', count: 1 }]);
  vi.mocked(api.fetchSearchHistory).mockResolvedValue([
    { id: 'h1', aql: 'priority = high', resultCount: 4, at: '2026-11-07T04:00:00.000Z' },
  ]);
  vi.mocked(api.fetchFilters).mockResolvedValue([filter]);
  vi.mocked(api.fetchGadgets).mockResolvedValue([]);
});

describe('Search page', () => {
  it('checks the query while typing and runs it, recording history', async () => {
    const user = userEvent.setup();
    render();
    const box = await screen.findByRole('textbox', { name: 'Query' }, FIRST);
    await user.type(box, 'stats = done');
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown field "stats"');
    expect(screen.getByRole('button', { name: /Search$/ })).toBeDisabled();

    await user.clear(box);
    await user.type(box, 'priority >= high');
    await user.click(screen.getByRole('button', { name: /Search$/ }));
    expect(await screen.findByText('Login retry fails', {}, FIRST)).toBeInTheDocument();
    expect(screen.getByText('1 task')).toBeInTheDocument();
    expect(api.searchTasks).toHaveBeenCalledWith('priority >= high', 1, true, 1);
    expect(api.searchTasks).toHaveBeenCalledWith('priority >= high', 1);
  });

  it('suggests field names and runs saved filters and history entries', async () => {
    const user = userEvent.setup();
    render();
    const box = await screen.findByRole('textbox', { name: 'Query' }, FIRST);
    await user.type(box, 'assig');
    await user.click(screen.getByRole('button', { name: 'assignee' }));
    expect(box).toHaveValue('assignee ');

    const filters = screen.getByRole('region', { name: 'Saved filters' });
    await user.click(await within(filters).findByRole('button', { name: 'Open bugs' }));
    await waitFor(() =>
      expect(api.searchTasks).toHaveBeenCalledWith('type = bug AND status != done', 1),
    );
    expect(await screen.findByText(/filter “Open bugs”/)).toBeInTheDocument();

    const history = screen.getByRole('region', { name: 'Search history' });
    await user.click(await within(history).findByRole('button', { name: /priority = high/ }));
    await waitFor(() => expect(api.searchTasks).toHaveBeenCalledWith('priority = high', 1));
  });

  it('exports all results in the chosen format', async () => {
    const user = userEvent.setup();
    vi.mocked(api.exportSearch).mockResolvedValue();
    render(`/search?aql=${encodeURIComponent('type = bug')}`);
    await screen.findByText('Login retry fails', {}, FIRST);
    await user.click(screen.getByRole('button', { name: /Export/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Excel (all results)' }));
    await waitFor(() =>
      expect(api.exportSearch).toHaveBeenCalledWith(
        'type = bug',
        'xlsx',
        expect.arrayContaining(['key', 'title']),
      ),
    );
  });

  it('saves the current query as a new filter', async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchFilters).mockResolvedValue([]);
    vi.mocked(api.createFilter).mockResolvedValue({ ...filter, id: 'f2', name: 'Critical' });
    render(`/search?aql=${encodeURIComponent('priority = critical')}`);
    await screen.findByText('Login retry fails', {}, FIRST);
    await user.click(screen.getByRole('button', { name: /Save as filter/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Critical');
    await user.click(within(dialog).getByRole('button', { name: 'Save filter' }));
    await waitFor(() =>
      expect(api.createFilter).toHaveBeenCalledWith({
        name: 'Critical',
        description: null,
        aql: 'priority = critical',
        sharing: 'private',
        projectId: null,
      }),
    );
  });
});

describe('Global search in the command palette', () => {
  it('finds tasks and projects and opens the chosen task', async () => {
    const { CommandPalette } = await import('@/components/layout/CommandPalette');
    vi.mocked(api.globalSearch).mockResolvedValue({
      tasks: [
        { id: 't1', key: 'TRD-1', title: 'Login retry fails', status: 'todo', projectKey: 'TRD' },
      ],
      projects: [{ id: 'p1', key: 'TRD', name: 'Trading' }],
      people: [],
      documents: [],
    });
    const user = userEvent.setup();
    const { router } = renderRoutes(
      [
        {
          path: '/',
          element: <CommandPalette open onOpenChange={() => undefined} sections={[]} />,
        },
      ],
      { permissions: { 'task:read': 'project' } },
    );
    await user.type(await screen.findByRole('combobox', {}, FIRST), 'login');
    expect(await screen.findByText('Login retry fails', {}, FIRST)).toBeInTheDocument();
    expect(api.globalSearch).toHaveBeenCalledWith('login');
    expect(screen.getByText('Trading')).toBeInTheDocument();
    await user.click(screen.getByText('Login retry fails'));
    expect(router.state.location.search).toBe('?task=t1');
  });
});
