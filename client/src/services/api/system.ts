import type { HealthReport } from '@arihant/shared';
import { apiGet } from './client';

/**
 * Readiness is reported with HTTP 503 when degraded, but the body is still a valid report,
 * so 503 is accepted as a normal response and shown to the user as "degraded".
 */
export function fetchReadiness(): Promise<HealthReport> {
  return apiGet<HealthReport>('/ready', { validateStatus: (s) => s === 200 || s === 503 });
}
