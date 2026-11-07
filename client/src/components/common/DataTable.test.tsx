import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnDef } from '@tanstack/react-table';
import { describe, expect, it, vi } from 'vitest';
import { toSortParam } from '@/lib/table';
import { DataTable } from './DataTable';

interface Row {
  id: string;
  name: string;
}

const columns: ColumnDef<Row, unknown>[] = [{ accessorKey: 'name', header: 'Name' }];

describe('DataTable', () => {
  it('renders skeleton rows while loading', () => {
    render(<DataTable columns={columns} data={undefined} isLoading skeletonRows={3} />);
    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(3);
  });

  it('renders the empty state when there are no rows', () => {
    render(<DataTable columns={columns} data={[]} />);
    expect(screen.getByText('No records found')).toBeInTheDocument();
  });

  it('renders an error with a working retry button', async () => {
    const onRetry = vi.fn();
    render(
      <DataTable columns={columns} data={undefined} error={new Error('boom')} onRetry={onRetry} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders rows, paginates and reports sorting changes', async () => {
    const onPageChange = vi.fn();
    const onSortingChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={[
          { id: '1', name: 'Alpha' },
          { id: '2', name: 'Beta' },
        ]}
        meta={{ page: 1, limit: 2, total: 5, totalPages: 3 }}
        onPageChange={onPageChange}
        onSortingChange={onSortingChange}
      />,
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('1–2 of 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(2);

    await userEvent.click(screen.getByRole('button', { name: /name/i }));
    expect(onSortingChange).toHaveBeenCalledWith([{ id: 'name', desc: false }]);
  });

  it('converts sorting state to the API sort param', () => {
    expect(toSortParam([{ id: 'dueDate', desc: true }])).toBe('-dueDate');
    expect(toSortParam([{ id: 'name', desc: false }])).toBe('name');
    expect(toSortParam([])).toBeUndefined();
  });
});
