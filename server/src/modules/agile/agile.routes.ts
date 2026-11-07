import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  LINK_TYPES,
  addLinkSchema,
  agileReportQuerySchema,
  backlogRankSchema,
  cloneTaskSchema,
  completeSprintSchema,
  createSprintSchema,
  moveTaskToProjectSchema,
  objectIdSchema,
  projectAgileSettingsSchema,
  sprintScopeSchema,
  startSprintSchema,
  updateSprintSchema,
  type LinkType,
} from '@arihant/shared';
import { sendCreated, sendNoContent, sendOk } from '../../core/http';
import { requestContext } from '../../core/rbac/context';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as extras from '../tasks/task.extras';
import * as agile from './agile.service';
import * as reports from './reports.service';

const idParams = z.object({ id: objectIdSchema });
const id = (req: Request) => (req.valid!.params as { id: string }).id;
const body = <T>(req: Request) => req.valid!.body as T;
const query = <T>(req: Request) => req.valid!.query as T;

/* ---------- /sprints ---------- */

export const sprintRoutes = Router();
sprintRoutes.use(authenticate, authorize('project:read'));
sprintRoutes.get(
  '/',
  validate({ query: z.strictObject({ projectId: objectIdSchema }) }),
  async (req, res) => {
    sendOk(
      res,
      await agile.listSprints(requestContext(req), query<{ projectId: string }>(req).projectId),
    );
  },
);
sprintRoutes.post('/', validate({ body: createSprintSchema }), async (req, res) => {
  sendCreated(res, await agile.createSprint(requestContext(req), body(req)));
});
sprintRoutes.post(
  '/scope',
  authorize('task:update'),
  validate({ body: sprintScopeSchema }),
  async (req, res) => {
    sendOk(res, await agile.setSprintScope(requestContext(req), body(req)));
  },
);
sprintRoutes.get('/:id', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await agile.getSprint(requestContext(req), id(req)));
});
sprintRoutes.patch(
  '/:id',
  validate({ params: idParams, body: updateSprintSchema }),
  async (req, res) => {
    sendOk(res, await agile.updateSprint(requestContext(req), id(req), body(req)));
  },
);
sprintRoutes.delete('/:id', validate({ params: idParams }), async (req, res) => {
  await agile.deleteSprint(requestContext(req), id(req));
  sendNoContent(res);
});
sprintRoutes.post(
  '/:id/start',
  validate({ params: idParams, body: startSprintSchema }),
  async (req, res) => {
    sendOk(res, await agile.startSprint(requestContext(req), id(req), body(req)));
  },
);
sprintRoutes.post(
  '/:id/complete',
  validate({ params: idParams, body: completeSprintSchema }),
  async (req, res) => {
    sendOk(res, await agile.completeSprint(requestContext(req), id(req), body(req)));
  },
);
sprintRoutes.get('/:id/chart', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await reports.sprintChart(requestContext(req), id(req)));
});

/* ---------- /agile (reports) ---------- */

export const agileReportRoutes = Router();
agileReportRoutes.use(authenticate, authorize('project:read'));
type ReportQuery = { projectId: string; days: number };
agileReportRoutes.get(
  '/velocity',
  validate({ query: agileReportQuerySchema }),
  async (req, res) => {
    sendOk(res, await reports.velocity(requestContext(req), query<ReportQuery>(req).projectId));
  },
);
agileReportRoutes.get(
  '/cycle-time',
  validate({ query: agileReportQuerySchema }),
  async (req, res) => {
    const q = query<ReportQuery>(req);
    sendOk(res, await reports.cycleTime(requestContext(req), q.projectId, q.days));
  },
);
agileReportRoutes.get('/defects', validate({ query: agileReportQuerySchema }), async (req, res) => {
  const q = query<ReportQuery>(req);
  sendOk(res, await reports.defectReport(requestContext(req), q.projectId, q.days));
});

/* ---------- mounted on /projects ---------- */

export function mountProjectAgileRoutes(router: Router): void {
  router.get('/:id/backlog', validate({ params: idParams }), async (req, res) => {
    sendOk(res, await agile.getBacklog(requestContext(req), id(req)));
  });
  router.get('/:id/epics', validate({ params: idParams }), async (req, res) => {
    sendOk(res, await agile.listEpics(requestContext(req), id(req)));
  });
  router.get('/:id/agile-settings', validate({ params: idParams }), async (req, res) => {
    sendOk(res, await agile.getAgileSettings(requestContext(req), id(req)));
  });
  router.put(
    '/:id/agile-settings',
    authorize('project:update'),
    validate({ params: idParams, body: projectAgileSettingsSchema }),
    async (req, res) => {
      sendOk(res, await agile.saveAgileSettings(requestContext(req), id(req), body(req)));
    },
  );
  router.get('/:id/deleted-tasks', validate({ params: idParams }), async (req, res) => {
    sendOk(res, await extras.listDeleted(requestContext(req), id(req)));
  });
}

/* ---------- mounted on /tasks ---------- */

const linkParams = z.object({
  id: objectIdSchema,
  type: z.enum(LINK_TYPES),
  taskId: objectIdSchema,
});

export function mountTaskAgileRoutes(router: Router): void {
  router.post(
    '/:id/links',
    authorize('task:update'),
    validate({ params: idParams, body: addLinkSchema }),
    async (req, res) => {
      sendOk(res, await extras.addLink(requestContext(req), id(req), body(req)));
    },
  );
  router.delete(
    '/:id/links/:type/:taskId',
    authorize('task:update'),
    validate({ params: linkParams }),
    async (req, res) => {
      const p = req.valid!.params as { id: string; type: LinkType; taskId: string };
      sendOk(res, await extras.removeLink(requestContext(req), p.id, p.type, p.taskId));
    },
  );
  router.post(
    '/:id/clone',
    authorize('task:create'),
    validate({ params: idParams, body: cloneTaskSchema }),
    async (req, res) => {
      sendCreated(res, await extras.cloneTask(requestContext(req), id(req), body(req)));
    },
  );
  router.post(
    '/:id/move-project',
    authorize('task:delete'),
    validate({ params: idParams, body: moveTaskToProjectSchema }),
    async (req, res) => {
      sendOk(
        res,
        await extras.moveToProject(
          requestContext(req),
          id(req),
          body<{ projectId: string }>(req).projectId,
        ),
      );
    },
  );
  router.post(
    '/:id/restore',
    authorize('task:delete'),
    validate({ params: idParams }),
    async (req, res) => {
      sendOk(res, await extras.restoreTask(requestContext(req), id(req)));
    },
  );
  router.post(
    '/:id/backlog-rank',
    authorize('task:update'),
    validate({ params: idParams, body: backlogRankSchema }),
    async (req, res) => {
      sendOk(res, await extras.rankInBacklog(requestContext(req), id(req), body(req)));
    },
  );
}
