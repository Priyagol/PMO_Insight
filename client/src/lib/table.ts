import type { SortingState } from '@tanstack/react-table';

/** Converts table sorting state into the API `sort` param (`-field` for descending). */
export function toSortParam(sorting: SortingState): string | undefined {
  const first = sorting[0];
  return first ? `${first.desc ? '-' : ''}${first.id}` : undefined;
}
