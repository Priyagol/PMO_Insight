import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { BoardColumnDto, TaskDto } from '@arihant/shared';
import type * as WorkApi from '@/services/api/work';

vi.mock('@/services/api/work', async (orig) => ({
  ...(await orig<typeof WorkApi>()),
  updateTask: vi.fn(),
}));
const work = await import('@/services/api/work');
const { useTaskUpdate, workKeys } = await import('./hooks');

const task = {
  id: 't1',
  key: 'ITH-13',
  title: 'Asset register clean-up',
  status: 'todo',
  statusLabel: 'To Do',
  priority: 'low',
  project: { id: 'p1' },
} as unknown as TaskDto;

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  qc.setQueryData(workKeys.task('t1'), task);
  qc.setQueryData(workKeys.taskList({ mine: true }), { items: [task], meta: {} });
  qc.setQueryData<BoardColumnDto[]>(workKeys.board({}), [
    { status: 'todo', total: 1, tasks: [task] },
    { status: 'in_progress', total: 0, tasks: [] },
  ]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, hook: renderHook(() => useTaskUpdate('t1'), { wrapper }) };
}

describe('task panel edits', () => {
  it('shows a status change at once, before the server answers', async () => {
    let answer!: (t: TaskDto) => void;
    vi.mocked(work.updateTask).mockReturnValue(new Promise((r) => (answer = r)));
    const { qc, hook } = setup();

    act(() => hook.result.current.mutate({ status: 'in_progress' }));
    await waitFor(() =>
      expect(qc.getQueryData<TaskDto>(workKeys.task('t1'))?.status).toBe('in_progress'),
    );
    expect(qc.getQueryData<TaskDto>(workKeys.task('t1'))?.statusLabel).toBe('In Progress');
    const list = qc.getQueryData<{ items: TaskDto[] }>(workKeys.taskList({ mine: true }));
    expect(list?.items[0]?.status).toBe('in_progress');
    const board = qc.getQueryData<BoardColumnDto[]>(workKeys.board({}));
    expect(board?.[0]?.tasks).toHaveLength(0);
    expect(board?.[1]?.tasks[0]?.id).toBe('t1');

    // The saved task from the server replaces the early copy.
    await act(async () => answer({ ...task, status: 'in_progress', statusLabel: 'Working' }));
    await waitFor(() =>
      expect(qc.getQueryData<TaskDto>(workKeys.task('t1'))?.statusLabel).toBe('Working'),
    );
  });

  it('puts the old value back when the save fails', async () => {
    vi.mocked(work.updateTask).mockRejectedValue(new Error('Not allowed'));
    const { qc, hook } = setup();
    act(() => hook.result.current.mutate({ status: 'in_progress' }));
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(qc.getQueryData<TaskDto>(workKeys.task('t1'))?.status).toBe('todo');
    const board = qc.getQueryData<BoardColumnDto[]>(workKeys.board({}));
    expect(board?.[0]?.tasks[0]?.id).toBe('t1');
  });
});
