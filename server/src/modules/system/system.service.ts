import type { HealthCheckResult, HealthReport } from '@arihant/shared';
import { APP_VERSION } from '../../config/app';

export type ReadinessCheck = () => Promise<void>;
export type ReadinessChecks = Record<string, ReadinessCheck>;

const CHECK_TIMEOUT_MS = 3_000;

async function runCheck(check: ReadinessCheck): Promise<HealthCheckResult> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out after ${CHECK_TIMEOUT_MS} ms`)),
          CHECK_TIMEOUT_MS,
        );
      }),
    ]);
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export function liveness(): HealthReport {
  return { status: 'ok', uptimeSeconds: Math.round(process.uptime()), version: APP_VERSION };
}

/** Runs every dependency check in parallel; any failure marks the service degraded. */
export async function readiness(checks: ReadinessChecks): Promise<HealthReport> {
  const names = Object.keys(checks);
  const results = await Promise.all(names.map((name) => runCheck(checks[name]!)));
  const report: Record<string, HealthCheckResult> = {};
  names.forEach((name, i) => {
    report[name] = results[i]!;
  });
  return {
    status: results.every((r) => r.ok) ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    version: APP_VERSION,
    checks: report,
  };
}
