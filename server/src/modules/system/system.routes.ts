import { Router } from 'express';
import { sendOk } from '../../core/http';
import { liveness, readiness, type ReadinessChecks } from './system.service';

/**
 * GET /health - liveness: the process is up (no dependency calls; cheap for load balancers).
 * GET /ready  - readiness: MongoDB, Redis and object storage respond. 503 when degraded.
 */
export function systemRoutes(checks: ReadinessChecks): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    sendOk(res, liveness());
  });

  router.get('/ready', async (_req, res) => {
    const report = await readiness(checks);
    sendOk(res, report, report.status === 'ok' ? 200 : 503);
  });

  return router;
}
