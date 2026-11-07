import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderRoutes } from '@/test/render';
import { OutboundPanel } from './OutboundPanel';
import { WebLinksSection } from './WebLinks';

vi.mock('@/services/api/outbound', () => ({
  fetchHooks: vi.fn(),
  createHook: vi.fn(),
  updateHook: vi.fn(),
  deleteHook: vi.fn(),
  testHook: vi.fn(),
  rotateHookSecret: vi.fn(),
  fetchDeliveries: vi.fn(),
  fetchWebLinks: vi.fn(),
  addWebLink: vi.fn(),
  removeWebLink: vi.fn(),
}));
vi.mock('@/services/api/work', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchProjects: vi.fn().mockResolvedValue({
    items: [],
    meta: { page: 1, limit: 100, total: 0, totalPages: 0 },
  }),
}));
const ob = await import('@/services/api/outbound');

const FIRST = { timeout: 20_000 };
const admin = { 'settings:manage': 'org', 'project:read': 'org', 'task:read': 'org' } as const;

beforeEach(() => vi.clearAllMocks());

describe('Outgoing integrations', () => {
  it('adds a webhook and shows its signing secret once', async () => {
    vi.mocked(ob.fetchHooks).mockResolvedValue([]);
    vi.mocked(ob.createHook).mockResolvedValue({
      id: 'h1',
      name: 'Zapier',
      kind: 'webhook',
      urlPreview: 'https://hooks.zapier.com/hooks…',
      events: ['task.created'],
      projects: [],
      active: true,
      disabledReason: null,
      consecutiveFailures: 0,
      lastDelivery: null,
      createdAt: '2026-11-07T00:00:00.000Z',
      secret: 'whsec-test-value',
    });
    const user = userEvent.setup();
    renderRoutes([{ path: '/', element: <OutboundPanel /> }], { permissions: admin });
    const panel = await screen.findByRole('region', { name: 'Outgoing integrations' }, FIRST);
    await user.click(within(panel).getByRole('button', { name: /Add/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('combobox', { name: 'Type' }));
    await user.click(await screen.findByRole('option', { name: 'Webhook (signed JSON)' }));
    await user.type(within(dialog).getByLabelText('Name'), 'Zapier');
    await user.type(
      within(dialog).getByLabelText('Address (URL)'),
      'https://hooks.zapier.com/hooks/catch/1/abc',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Task status changed' })); // turn off
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(ob.createHook).toHaveBeenCalledWith({
        name: 'Zapier',
        kind: 'webhook',
        url: 'https://hooks.zapier.com/hooks/catch/1/abc',
        events: ['task.created'],
        projectIds: [],
      }),
    );
    expect(await within(panel).findByRole('status')).toHaveTextContent('whsec-test-value');
  });

  it('lists destinations with their state and sends a test message', async () => {
    vi.mocked(ob.fetchHooks).mockResolvedValue([
      {
        id: 'h2',
        name: 'Ops channel',
        kind: 'slack',
        urlPreview: 'https://hooks.slack.com/servic…',
        events: ['task.status_changed'],
        projects: [{ id: 'p1', key: 'TRD' }],
        active: false,
        disabledReason: 'Switched off after 10 failed deliveries in a row (last: HTTP 404)',
        consecutiveFailures: 10,
        lastDelivery: { at: '2026-11-07T00:00:00.000Z', status: 'failed', httpStatus: 404 },
        createdAt: '2026-11-07T00:00:00.000Z',
      },
    ]);
    vi.mocked(ob.testHook).mockResolvedValue({
      id: 'd1',
      event: 'test',
      status: 'delivered',
      attempts: 1,
      httpStatus: 200,
      error: null,
      durationMs: 40,
      createdAt: '2026-11-07T00:00:00.000Z',
      nextAttemptAt: null,
    });
    const user = userEvent.setup();
    renderRoutes([{ path: '/', element: <OutboundPanel /> }], { permissions: admin });
    const panel = await screen.findByRole('region', { name: 'Outgoing integrations' }, FIRST);
    expect(await within(panel).findByText(/Switched off after 10/)).toBeInTheDocument();
    expect(panel).toHaveTextContent('only TRD');
    await user.click(within(panel).getByRole('button', { name: /Test/ }));
    await waitFor(() => expect(ob.testHook).toHaveBeenCalledWith('h2'));
  });
});

describe('Web links', () => {
  it('lists links with their tool and adds one', async () => {
    vi.mocked(ob.fetchWebLinks).mockResolvedValue([
      {
        id: 'w1',
        url: 'https://www.figma.com/design/abc',
        title: 'Checkout screens',
        provider: 'figma',
        addedBy: null,
        createdAt: '2026-11-07T00:00:00.000Z',
      },
    ]);
    vi.mocked(ob.addWebLink).mockResolvedValue({
      id: 'w2',
      url: 'https://docs.google.com/document/d/x',
      title: 'Spec',
      provider: 'google_drive',
      addedBy: null,
      createdAt: '2026-11-07T00:00:00.000Z',
    });
    const user = userEvent.setup();
    renderRoutes([{ path: '/', element: <WebLinksSection taskId="t1" editable /> }], {
      permissions: { 'task:read': 'project' },
    });
    const section = await screen.findByRole('region', { name: 'Web links' }, FIRST);
    expect(await within(section).findByRole('link', { name: 'Checkout screens' })).toHaveAttribute(
      'href',
      'https://www.figma.com/design/abc',
    );
    expect(section).toHaveTextContent('Figma');
    await user.click(within(section).getByRole('button', { name: /Add link/ }));
    await user.type(
      within(section).getByLabelText('Link address'),
      'https://docs.google.com/document/d/x',
    );
    await user.type(within(section).getByLabelText('Link title'), 'Spec');
    await user.click(within(section).getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(ob.addWebLink).toHaveBeenCalledWith('t1', {
        url: 'https://docs.google.com/document/d/x',
        title: 'Spec',
      }),
    );
  });
});
