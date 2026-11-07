import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  aiSettingsSchema,
  askDataSchema,
  automationRunQuerySchema,
  automationTestSchema,
  createAutomationSchema,
  minutesToActionsSchema,
  objectIdSchema,
  projectAiSchema,
  requirementsToTasksSchema,
  updateAutomationSchema,
  worklogDraftSchema,
} from '@arihant/shared';
import { sendCreated, sendNoContent, sendOk, sendPage } from '../core/http';
import { requestContext } from '../core/rbac/context';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as ai from './ai/ai.service';
import { askData, riskScan } from './ai/ask.service';
import * as automations from './automations/automation.service';

const idParams = z.object({ id: objectIdSchema });
const id = (req: Request) => (req.valid!.params as { id: string }).id;
const body = <T>(req: Request) => req.valid!.body as T;

/* ============================ Automation Center ============================ */

export const automationRoutes = Router();
automationRoutes.use(authenticate, authorize('automation:manage'));
automationRoutes.get(
  '/',
  validate({ query: z.strictObject({ projectId: objectIdSchema.optional() }) }),
  async (req, res) => {
    sendOk(
      res,
      await automations.listRules(
        requestContext(req),
        (req.valid!.query as { projectId?: string }).projectId,
      ),
    );
  },
);
automationRoutes.post('/', validate({ body: createAutomationSchema }), async (req, res) => {
  sendCreated(res, await automations.createRule(requestContext(req), body(req)));
});
automationRoutes.get(
  '/runs',
  validate({ query: automationRunQuerySchema.strict() }),
  async (req, res) => {
    const { items, meta } = await automations.listRuns(
      requestContext(req),
      req.valid!.query as never,
    );
    sendPage(res, items, meta);
  },
);
automationRoutes.patch(
  '/:id',
  validate({ params: idParams, body: updateAutomationSchema }),
  async (req, res) => {
    sendOk(res, await automations.updateRule(requestContext(req), id(req), body(req)));
  },
);
automationRoutes.delete('/:id', validate({ params: idParams }), async (req, res) => {
  await automations.deleteRule(requestContext(req), id(req));
  sendNoContent(res);
});
automationRoutes.post(
  '/:id/test',
  validate({ params: idParams, body: automationTestSchema }),
  async (req, res) => {
    sendOk(
      res,
      await automations.testRule(
        requestContext(req),
        id(req),
        body<{ taskId: string }>(req).taskId,
      ),
    );
  },
);

/* ============================ AI assistant ============================ */

export const aiRoutes = Router();
aiRoutes.use(authenticate);
aiRoutes.get('/status', async (req, res) => {
  sendOk(res, await ai.getStatus(requestContext(req)));
});
aiRoutes.put(
  '/settings',
  authorize('settings:manage', 'org'),
  validate({ body: aiSettingsSchema }),
  async (req, res) => {
    sendOk(res, await ai.updateSettings(requestContext(req), body(req)));
  },
);
aiRoutes.post(
  '/requirements-to-tasks',
  authorize('ai:use'),
  validate({ body: requirementsToTasksSchema }),
  async (req, res) => {
    sendOk(res, await ai.requirementsToTasks(requestContext(req), body(req)));
  },
);
aiRoutes.post(
  '/project-summary',
  authorize('ai:use'),
  validate({ body: projectAiSchema }),
  async (req, res) => {
    sendOk(res, await ai.projectSummary(requestContext(req), body(req)));
  },
);
aiRoutes.post(
  '/worklog-draft',
  authorize('ai:use'),
  validate({ body: worklogDraftSchema }),
  async (req, res) => {
    sendOk(res, await ai.worklogDraft(requestContext(req), body(req)));
  },
);
aiRoutes.post(
  '/minutes-to-actions',
  authorize('ai:use'),
  validate({ body: minutesToActionsSchema }),
  async (req, res) => {
    sendOk(res, await ai.minutesToActions(requestContext(req), body(req)));
  },
);
aiRoutes.post(
  '/explain-health',
  authorize('ai:use'),
  validate({ body: projectAiSchema }),
  async (req, res) => {
    sendOk(res, await ai.explainHealth(requestContext(req), body(req)));
  },
);

aiRoutes.post('/ask', authorize('ai:use'), validate({ body: askDataSchema }), async (req, res) => {
  sendOk(res, await askData(requestContext(req), body(req)));
});
aiRoutes.post(
  '/risk-scan',
  authorize('ai:use'),
  authorize('risk:read'),
  validate({ body: projectAiSchema }),
  async (req, res) => {
    sendOk(res, await riskScan(requestContext(req), body(req)));
  },
);
