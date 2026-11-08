import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderRoutes } from '@/test/render';
import { GitIntegrationPanel, TaskDevelopment } from './GitIntegration';

vi.mock('@/services/api/integrations', () => ({
  fetchGitSettings: vi.fn(),
  saveGitSettings: vi.fn(),
  fetchTaskGitLinks: vi.fn(),
}));
const api = await import('@/services/api/integrations');

const FIRST = { timeout: 15_000 };
const render = (el: React.ReactNode) =>
  renderRoutes([{ path: '/', element: el }], {
    path: '/',
    permissions: { 'settings:manage': 'org', 'task:read': 'project' },
  });

const settings = {
  enabled: false,
  repos: [] as string[],
  moveOnFix: true,
  smartCommits: true,
  secretConfigured: false,
  webhookPath: '/api/v1/integrations/github/webhook',
  lastDelivery: null,
  canEdit: true,
};

beforeEach(() => vi.clearAllMocks());

describe('GitHub integration settings', () => {
  it('warns when the server secret is missing and saves repositories and switches', async () => {
    vi.mocked(api.fetchGitSettings).mockResolvedValue(settings);
    vi.mocked(api.saveGitSettings).mockResolvedValue({
      ...settings,
      enabled: true,
      repos: ['arihant/trading-platform'],
    });
    const user = userEvent.setup();
    render(<GitIntegrationPanel />);
    const panel = await screen.findByRole('region', { name: 'GitHub integration' }, FIRST);
    expect(await within(panel).findByRole('status', {}, FIRST)).toHaveTextContent(
      'GITHUB_WEBHOOK_SECRET',
    );
    expect(panel).toHaveTextContent(`${window.location.origin}/api/v1/integrations/github/webhook`);
    expect(panel).toHaveTextContent('No deliveries received yet.');

    const add = within(panel).getByRole('button', { name: /Add/ });
    await user.type(within(panel).getByLabelText('Repository'), 'not a repo');
    expect(add).toBeDisabled();
    await user.clear(within(panel).getByLabelText('Repository'));
    await user.type(within(panel).getByLabelText('Repository'), 'Arihant/Trading-Platform');
    await user.click(add);
    await user.click(
      within(panel).getByRole('checkbox', { name: /Link commits and pull requests/ }),
    );
    await user.click(within(panel).getByRole('checkbox', { name: /Smart commits/ }));
    await user.click(within(panel).getByRole('button', { name: 'Save GitHub settings' }));
    await waitFor(() =>
      expect(api.saveGitSettings).toHaveBeenCalledWith({
        enabled: true,
        moveOnFix: true,
        smartCommits: false,
        repos: ['arihant/trading-platform'],
      }),
    );
  });
});

describe('Task development section', () => {
  it('lists commits and pull requests with their state, and is hidden when there are none', async () => {
    vi.mocked(api.fetchTaskGitLinks).mockResolvedValue([
      {
        id: 'l1',
        kind: 'commit',
        repo: 'arihant/trading-platform',
        ref: 'abc1234',
        title: 'Fixes TRD-42: retry login',
        url: 'https://github.com/arihant/trading-platform/commit/abc1234',
        author: 'dev-one',
        branch: 'feature/login',
        movedTask: true,
        actions: ['Comment added', 'Logged 1h 30m'],
        at: '2026-11-07T04:30:00.000Z',
      },
      {
        id: 'l2',
        kind: 'pull_request',
        repo: 'arihant/trading-platform',
        ref: '#42',
        title: 'Login retry',
        url: 'https://github.com/arihant/trading-platform/pull/42',
        author: 'dev-one',
        state: 'merged',
        movedTask: false,
        actions: [],
        at: '2026-11-07T05:00:00.000Z',
      },
    ]);
    render(<TaskDevelopment taskId="t1" />);
    const section = await screen.findByRole('region', { name: 'Development' }, FIRST);
    expect(within(section).getByRole('link', { name: /abc1234 Fixes TRD-42/ })).toHaveAttribute(
      'href',
      'https://github.com/arihant/trading-platform/commit/abc1234',
    );
    expect(section).toHaveTextContent('moved this task to In review');
    expect(section).toHaveTextContent('Smart commit: Comment added · Logged 1h 30m');
    expect(section).toHaveTextContent('merged');
  });

  it('renders nothing without links', async () => {
    vi.mocked(api.fetchTaskGitLinks).mockResolvedValue([]);
    render(<TaskDevelopment taskId="t2" />);
    await waitFor(() => expect(api.fetchTaskGitLinks).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Development' })).not.toBeInTheDocument();
  });
});
