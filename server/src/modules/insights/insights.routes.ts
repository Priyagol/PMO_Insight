import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  analyticsQuerySchema,
  createRiskSchema,
  escalateRiskSchema,
  hoursQuerySchema,
  objectIdSchema,
  projectStatusQuerySchema,
  workSummaryQuerySchema,
  type ProjectStatusQuery,
  type WorkSummaryQuery,
  riskQuerySchema,
  snapshotQuerySchema,
  updateRiskSchema,
  type AnalyticsQuery,
} from '@arihant/shared';
import { sendCreated, sendNoContent, sendOk, sendPage } from '../../core/http';
import { requestContext } from '../../core/rbac/context';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { recordAudit } from '../audit/audit.service';
import * as risks from '../risks/risk.service';
import * as analytics from './analytics.service';
import * as delays from './delay.service';
import * as digest from './digest.service';
import { projectForecasts } from './forecast.service';
import * as reports from './report.service';

const idParams = z.object({ id: objectIdSchema });
const id = (req: Request) => (req.valid!.params as { id: string }).id;
const query = <T>(req: Request) => req.valid!.query as T;
const body = <T>(req: Request) => req.valid!.body as T;

/* ============================ Risks & issues ============================ */

export const riskRoutes = Router();
riskRoutes.use(authenticate, authorize('risk:read'));
riskRoutes.get('/', validate({ query: riskQuerySchema.strict() }), async (req, res) => {
  const { items, meta } = await risks.listRisks(requestContext(req), query(req));
  sendPage(res, items, meta);
});
riskRoutes.get('/heatmap', validate({ query: riskQuerySchema.strict() }), async (req, res) => {
  sendOk(res, await risks.heatmap(requestContext(req), query(req)));
});
riskRoutes.post(
  '/',
  authorize('risk:write'),
  validate({ body: createRiskSchema }),
  async (req, res) => {
    sendCreated(res, await risks.createRisk(requestContext(req), body(req)));
  },
);
riskRoutes.get('/:id', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await risks.getRisk(requestContext(req), id(req)));
});
riskRoutes.patch(
  '/:id',
  authorize('risk:write'),
  validate({ params: idParams, body: updateRiskSchema }),
  async (req, res) => {
    sendOk(res, await risks.updateRisk(requestContext(req), id(req), body(req)));
  },
);
riskRoutes.post(
  '/:id/escalate',
  authorize('risk:write'),
  validate({ params: idParams, body: escalateRiskSchema }),
  async (req, res) => {
    sendOk(
      res,
      await risks.escalateRisk(requestContext(req), id(req), body<{ note: string }>(req).note),
    );
  },
);
riskRoutes.delete(
  '/:id',
  authorize('risk:write'),
  validate({ params: idParams }),
  async (req, res) => {
    await risks.deleteRisk(requestContext(req), id(req));
    sendNoContent(res);
  },
);

/* ============================ Analytics ============================ */

export const analyticsRoutes = Router();
analyticsRoutes.use(authenticate, authorize('analytics:view'));
analyticsRoutes.get('/overview', validate({ query: analyticsQuerySchema }), async (req, res) => {
  sendOk(res, await analytics.overview(requestContext(req), query<AnalyticsQuery>(req)));
});
analyticsRoutes.get('/activity', async (req, res) => {
  sendOk(res, await analytics.recentActivity(requestContext(req)));
});
analyticsRoutes.get('/health', validate({ query: analyticsQuerySchema }), async (req, res) => {
  sendOk(res, await analytics.projectHealthList(requestContext(req), query<AnalyticsQuery>(req)));
});
analyticsRoutes.get('/projects/:id', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await analytics.projectAnalytics(requestContext(req), id(req)));
});
analyticsRoutes.get(
  '/forecast',
  validate({
    query: z.strictObject({
      projectId: objectIdSchema.optional(),
      departmentId: objectIdSchema.optional(),
    }),
  }),
  async (req, res) => {
    sendOk(
      res,
      await projectForecasts(requestContext(req), req.valid!.query as Partial<AnalyticsQuery>),
    );
  },
);
analyticsRoutes.get(
  '/timeline',
  validate({ query: z.strictObject({ departmentId: objectIdSchema.optional() }) }),
  async (req, res) => {
    sendOk(
      res,
      await delays.portfolioTimeline(
        requestContext(req),
        req.valid!.query as Partial<AnalyticsQuery>,
      ),
    );
  },
);
analyticsRoutes.get('/projects/:id/delays', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await delays.projectDelays(requestContext(req), id(req)));
});
analyticsRoutes.get('/hours', validate({ query: hoursQuerySchema.strict() }), async (req, res) => {
  sendOk(res, await analytics.hoursBreakdown(requestContext(req), query(req)));
});

/* Summaries computed from the data (they work without an AI service). */
analyticsRoutes.get(
  '/work-summary',
  validate({ query: workSummaryQuerySchema }),
  async (req, res) => {
    sendOk(res, await digest.workSummary(requestContext(req), query<WorkSummaryQuery>(req)));
  },
);
analyticsRoutes.get(
  '/project-status',
  validate({ query: projectStatusQuerySchema }),
  async (req, res) => {
    sendOk(res, await digest.projectStatus(requestContext(req), query<ProjectStatusQuery>(req)));
  },
);
analyticsRoutes.get(
  '/trends',
  validate({ query: z.strictObject({ departmentId: objectIdSchema.optional() }) }),
  async (req, res) => {
    sendOk(
      res,
      await digest.performanceTrends(requestContext(req), query<{ departmentId?: string }>(req)),
    );
  },
);
analyticsRoutes.get(
  '/bottlenecks',
  validate({ query: projectStatusQuerySchema }),
  async (req, res) => {
    sendOk(res, await digest.bottlenecks(requestContext(req), query<ProjectStatusQuery>(req)));
  },
);

/* ============================ Reports & exports ============================ */

export const reportRoutes = Router();
reportRoutes.use(authenticate, authorize('analytics:view'));
reportRoutes.get(
  '/snapshot',
  validate({ query: snapshotQuerySchema.strict() }),
  async (req, res) => {
    const q = query<AnalyticsQuery & { format: 'json' | 'pdf' | 'xlsx' }>(req);
    const rc = requestContext(req);
    const snapshot = await reports.buildSnapshot(rc, q);
    if (q.format === 'json') {
      sendOk(res, snapshot);
      return;
    }
    const name = `management-snapshot_${snapshot.period.from}_${snapshot.period.to}`;
    const file =
      q.format === 'pdf'
        ? await reports.renderSnapshotPdf(snapshot)
        : await reports.renderSnapshotXlsx(snapshot);
    await recordAudit(rc, {
      action: `export.snapshot_${q.format}`,
      entityType: 'export',
      summary: `Exported management snapshot (${snapshot.period.from} to ${snapshot.period.to}, ${snapshot.scope}) as ${q.format.toUpperCase()}`,
    });
    res.setHeader(
      'Content-Type',
      q.format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${name}.${q.format}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(file);
  },
);
reportRoutes.get(
  '/tasks.csv',
  authorize('task:read'),
  validate({ query: z.strictObject({ projectId: objectIdSchema.optional() }) }),
  async (req, res) => {
    const csv = await reports.tasksCsv(requestContext(req), query(req));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="tasks_${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  },
);
