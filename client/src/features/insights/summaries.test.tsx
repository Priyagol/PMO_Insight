import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderRoutes } from '@/test/render';
import { SummariesTab } from './SummariesTab';

vi.mock('@/services/api/insights', () => ({
  fetchProjectStatus: vi.fn().mockResolvedValue({
    period: { from: '2026-11-03', to: '2026-11-09' },
    projects: [
      {
        project: { id: 'p1', key: 'PAY', name: 'Payments' },
        manager: null,
        rag: 'red',
        healthScore: 41,
        progress: 55,
        completedInPeriod: 3,
        createdInPeriod: 1,
        overdue: 4,
        blocked: 0,
        openCriticalRisks: 0,
        forecastDate: null,
        slipDays: null,
        notes: ['4 open tasks past due.'],
      },
    ],
    counts: { red: 1, amber: 0, green: 0 },
    highlights: ['1 active project: 1 red, 0 amber, 0 green.'],
  }),
  fetchWorkSummary: vi.fn().mockResolvedValue({
    period: { from: '2026-11-09', to: '2026-11-09' },
    people: [],
    totals: { loggedHours: 0, completed: 0, handedOver: 0, overdue: 0 },
    highlights: ['No tasks were finished on this day; 0 h logged in total.'],
  }),
  fetchTrends: vi.fn().mockResolvedValue({
    weeks: Array.from({ length: 9 }, (_, i) => `2026-09-${String(7 + i).padStart(2, '0')}`),
    people: [
      {
        user: { id: 'u1', name: 'Dev One', email: 'd@example.test', employeeId: 'E-1' },
        completedPerWeek: [3, 3, 3, 3, 1, 1, 1, 1, 0],
        onTimePerWeek: Array(9).fill(null),
        recentAverage: 1,
        previousAverage: 3,
        direction: 'declining',
        explanation: '1 tasks a week over the last 4 full weeks, against 3 in the 4 weeks before.',
      },
    ],
  }),
  fetchBottlenecks: vi.fn().mockResolvedValue({
    period: { from: '2026-10-11', to: '2026-11-09' },
    statusWaits: [{ status: 'in_review', averageHours: 40, moves: 3 }],
    rework: [],
    longBlocked: [],
    recurringTags: [],
    findings: ['Work waits longest in “In Review”: 40 h on average over 3 moves.'],
  }),
}));

describe('Analytics: summaries', () => {
  it('shows project colours, highlights, trends and bottlenecks without AI', async () => {
    renderRoutes([{ path: '/', element: <SummariesTab query={{}} /> }], {
      permissions: { 'analytics:view': 'org' },
    });
    expect(
      await screen.findByText('1 active project: 1 red, 0 amber, 0 green.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Red')).toBeInTheDocument();
    expect(screen.getByText('4 open tasks past due.')).toBeInTheDocument();
    expect(await screen.findByText('Declining')).toBeInTheDocument();
    expect(
      await screen.findByText('Work waits longest in “In Review”: 40 h on average over 3 moves.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/No AI service is used/)).toBeInTheDocument();
  });
});
