import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectDto } from '@arihant/shared';
import type * as WorkApi from '@/services/api/work';

vi.mock('@/services/api/work', async (orig) => ({
  ...(await orig<typeof WorkApi>()),
  updateProject: vi.fn(),
}));
const work = await import('@/services/api/work');
const { HoldBanner, HoldButton } = await import('./ProjectHold');

const project = (over: Partial<ProjectDto> = {}) =>
  ({
    id: 'p1',
    key: 'RRA',
    name: 'Regulatory Reporting Automation',
    status: 'in_progress',
    hold: null,
    can: { update: true, archive: false, createTask: true, manageMembers: true },
    ...over,
  }) as ProjectDto;

const wrap = (ui: React.ReactNode) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe('project on hold', () => {
  it('shows why, since when, by whom and the expected restart', () => {
    wrap(
      <HoldBanner
        project={project({
          status: 'on_hold',
          hold: {
            reason: 'Business priorities changed',
            since: '2026-11-09T06:00:00.000Z',
            by: { id: 'u1', name: 'Arjun Mehta', email: 'a@example.test', employeeId: 'E1' },
            until: '2026-12-15',
          },
        })}
      />,
    );
    expect(screen.getByText('This project is on hold')).toBeInTheDocument();
    expect(screen.getByText('Business priorities changed')).toBeInTheDocument();
    expect(
      screen.getByText(
        /Since 9 Nov 2026 · put on hold by Arjun Mehta · expected to restart 15 Dec 2026/,
      ),
    ).toBeInTheDocument();
  });

  it('asks for a reason before putting the project on hold', async () => {
    vi.mocked(work.updateProject).mockResolvedValue(project({ status: 'on_hold' }));
    wrap(<HoldButton project={project()} />);
    await userEvent.click(screen.getByRole('button', { name: /put on hold/i }));
    await userEvent.click(screen.getAllByRole('button', { name: /put on hold/i }).at(-1)!);
    expect(await screen.findByText('Say why the project is on hold')).toBeInTheDocument();
    expect(work.updateProject).not.toHaveBeenCalled();

    await userEvent.type(screen.getByRole('textbox'), 'Budget moved to CRM');
    await userEvent.click(screen.getAllByRole('button', { name: /put on hold/i }).at(-1)!);
    await waitFor(() =>
      expect(work.updateProject).toHaveBeenCalledWith('p1', {
        status: 'on_hold',
        holdReason: 'Budget moved to CRM',
        holdUntil: null,
      }),
    );
  });

  it('offers Restart while on hold, and nothing to people who cannot edit', () => {
    const { unmount } = wrap(<HoldButton project={project({ status: 'on_hold' })} />);
    expect(screen.getByRole('button', { name: /restart/i })).toBeInTheDocument();
    unmount();
    wrap(
      <HoldButton
        project={project({
          can: { update: false, archive: false, createTask: false, manageMembers: false },
        })}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
