import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RoleDashboardDto } from '@arihant/shared';
import { renderRoutes } from '@/test/render';
import { RoleFocus } from './RoleFocus';

vi.mock('@/services/api/insights', () => ({ fetchRoleDashboard: vi.fn() }));
const api = await import('@/services/api/insights');

describe('Overview: role focus', () => {
  it('shows the view, figures, to-dos and lists for the viewer’s role', async () => {
    const data: RoleDashboardDto = {
      persona: 'technology',
      focus: 'Engineering health across the portfolio.',
      period: { from: '2026-10-11', to: '2026-11-09' },
      kpis: [
        { label: 'Open critical bugs', value: '2', tone: 'bad', link: '/tasks/board' },
        { label: 'Deployments', value: '5', hint: '1 failed or rolled back in the period' },
      ],
      attention: [{ text: 'PAY 2.4.0 failed on PROD', link: '/releases', tone: 'bad' }],
      lists: [
        {
          title: 'Open bugs by severity',
          columns: ['Severity', 'Open'],
          rows: [{ cells: ['Critical', '2'] }],
        },
      ],
    };
    vi.mocked(api.fetchRoleDashboard).mockResolvedValue(data);
    renderRoutes([{ path: '/', element: <RoleFocus query={{}} /> }], {
      permissions: { 'analytics:view': 'org' },
    });
    expect(await screen.findByRole('heading', { name: 'Technology view' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open critical bugs/ })).toHaveAttribute(
      'href',
      '/tasks/board',
    );
    expect(screen.getByText('PAY 2.4.0 failed on PROD')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Critical' })).toBeInTheDocument();
  });

  it('says so when nothing needs attention', async () => {
    vi.mocked(api.fetchRoleDashboard).mockResolvedValue({
      persona: 'individual',
      focus: 'Your own work.',
      period: { from: '2026-10-11', to: '2026-11-09' },
      kpis: [],
      attention: [],
      lists: [],
    });
    renderRoutes([{ path: '/', element: <RoleFocus query={{}} /> }], {
      permissions: { 'analytics:view': 'own' },
    });
    expect(await screen.findByText(/Nothing needs your/)).toBeInTheDocument();
  });
});
