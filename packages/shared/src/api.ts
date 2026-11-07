import { z } from 'zod';

/** Standard API envelope used by every `/api/v1` endpoint. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: PageMeta;
}

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
  requestId?: string;
}

export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'UNPROCESSABLE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const MAX_PAGE_SIZE = 100;

/** Offset pagination + sorting query params shared by list endpoints. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
  sort: z
    .string()
    .regex(/^-?[a-zA-Z][a-zA-Z0-9_.]*$/, 'Invalid sort field')
    .optional(),
  q: z.string().trim().max(200).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export interface HealthCheckResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  version: string;
  checks?: Record<string, HealthCheckResult>;
}

type WithoutDefault<T> = T extends z.ZodDefault<infer Inner> ? Inner : T;

/**
 * Returns the shape with every `.default()` removed. Update (PATCH) schemas are built from it:
 * `.partial()` keeps inner defaults, so without this an omitted field would be silently reset.
 */
export function withoutDefaults<T extends z.ZodRawShape>(
  shape: T,
): { [K in keyof T]: WithoutDefault<T[K]> } {
  return Object.fromEntries(
    Object.entries(shape).map(([k, v]) => [k, v instanceof z.ZodDefault ? v.unwrap() : v]),
  ) as { [K in keyof T]: WithoutDefault<T[K]> };
}
