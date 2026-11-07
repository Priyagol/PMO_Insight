import type { PageMeta, PaginationQuery } from '@arihant/shared';
import { BadRequestError } from './errors';

export interface PageWindow {
  skip: number;
  limit: number;
  sort: Record<string, 1 | -1>;
}

/**
 * Converts validated pagination params into a Mongo query window.
 * `allowedSort` is an allow-list so clients cannot sort on unindexed or private fields.
 */
export function toPageWindow(
  query: PaginationQuery,
  allowedSort: readonly string[],
  defaultSort: Record<string, 1 | -1> = { createdAt: -1 },
): PageWindow {
  let sort = defaultSort;
  if (query.sort) {
    const desc = query.sort.startsWith('-');
    const field = desc ? query.sort.slice(1) : query.sort;
    if (!allowedSort.includes(field)) {
      throw new BadRequestError(`Sorting by "${field}" is not supported`);
    }
    // Secondary _id sort keeps pagination stable when values tie.
    sort = { [field]: desc ? -1 : 1, _id: desc ? -1 : 1 };
  }
  return { skip: (query.page - 1) * query.limit, limit: query.limit, sort };
}

export function toPageMeta(
  query: Pick<PaginationQuery, 'page' | 'limit'>,
  total: number,
): PageMeta {
  return {
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
}

/** Escapes user text for safe use inside a RegExp (search boxes). */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
