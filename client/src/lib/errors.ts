import { ApiClientError } from '@/services/api/client';

/** Human-readable message for any thrown value (API errors carry server-sanitised text). */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
