import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DependencyMapDto, TaskBriefDto } from '@arihant/shared';
import { renderRoutes } from '@/test/render';
import { DependenciesPage } from './DependenciesPage';

vi.mock('@/services/api/insights', () => ({ fetchDependencies: vi.fn() }));
vi.mock('@/services/api/org', () => ({ fetchDepartments: vi.fn().mockResolvedValue([]) }));
vi.mock('@/services/api/work', async (orig) => ({
  ...(await orig<object>()),
  fetchProjects: vi
    .fn()
    .mockResolvedValue({ items: [], meta: { page: 1, limit: 100, total: 0, totalPages: 0 } }),
}));
const api = await import('@/services/api/insights');

const task = (key: string, over: Partial<TaskBriefDto> = {}): TaskBriefDto => ({
  id: key,
  key,
  title: `${key} title`,
  status: 'todo',
  dueDate: null,
  assignee: 'Dev One',
  project: { id: 'p1', key: 'APP', name: 'App' },
  ...over,
});

describe('Dependencies & Blockers', () => {
  it('lists waits with their state, hides other projects, and shows blocked work', async () => {
    const user = userEvent.setup();
    const data: DependencyMapDto = {
      summary: {
        openLinks: 2,
        late: 1,
        atRisk: 0,
        crossProject: 1,
        blocked: 1,
        blockedOver3Days: 1,
        projectLinksAtRisk: 0,
      },
      links: [
        {
          task: task('APP-1'),
          dependsOn: task('API-4', { project: { id: 'p2', key: 'API', name: 'Api' } }),
          state: 'late',
          reason: 'API-4 was due 2026-11-06 and is still open',
          crossProject: true,
        },
        {
          task: task('APP-1'),
          dependsOn: null,
          state: 'waiting',
          reason: 'Waiting; no due date set',
          crossProject: true,
        },
      ],
      blocked: [
        {
          task: task('APP-7', { status: 'blocked' }),
          days: 5,
          note: 'Waiting for firewall rule',
          by: 'Dev One',
          holdingUp: 2,
        },
      ],
      holdingUpMost: [],
      projects: [],
    };
    vi.mocked(api.fetchDependencies).mockResolvedValue(data);
    renderRoutes([{ path: '/', element: <DependenciesPage /> }], {
      permissions: { 'analytics:view': 'org' },
    });
    expect(
      await screen.findByText('API-4 was due 2026-11-06 and is still open'),
    ).toBeInTheDocument();
    expect(screen.getByText('A task in a project you cannot open')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Blocked work/ }));
    expect(await screen.findByText('Waiting for firewall rule')).toBeInTheDocument();
    expect(screen.getByText('2 tasks')).toBeInTheDocument();
  });
});
