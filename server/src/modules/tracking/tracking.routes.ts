import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  assignmentConfigSchema,
  availabilityQuerySchema,
  availabilitySchema,
  batchPreviewSchema,
  createWorklogSchema,
  journalQuerySchema,
  journalSchema,
  modifyPlanSchema,
  objectIdSchema,
  reassignPreviewSchema,
  rebalancePreviewSchema,
  startTimerSchema,
  stopTimerSchema,
  timesheetDecisionSchema,
  timesheetQuerySchema,
  timesheetRejectSchema,
  timesheetWeekSchema,
  capacityPlanQuerySchema,
  teamPerformanceQuerySchema,
  type CapacityPlanQuery,
  teamSchema,
  updateTeamSchema,
  type TeamInput,
  type TeamPerformanceQuery,
  updateWorklogSchema,
  worklogQuerySchema,
  type AssignmentConfig,
} from '@arihant/shared';
import { sendCreated, sendNoContent, sendOk, sendPage } from '../../core/http';
import { requestContext, requireAuth } from '../../core/rbac/context';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { recordAudit } from '../audit/audit.service';
import * as assignment from '../assignment/assignment.service';
import { capacityPlan } from './capacity.service';
import { teamPerformance } from './performance.service';
import * as teams from './team.service';
import { getAssignmentConfig } from '../assignment/workload.service';
import { Setting } from '../settings/settings.model';
import * as people from './people.service';
import * as logs from './worklog.service';

const idParams = z.object({ id: objectIdSchema });
const id = (req: Request) => (req.valid!.params as { id: string }).id;
const body = <T>(req: Request) => req.valid!.body as T;
const query = <T>(req: Request) => req.valid!.query as T;

/* ============================ Work logs & timer ============================ */

export const worklogRoutes = Router();
worklogRoutes.use(authenticate, authorize('worklog:write'));

worklogRoutes.get('/', validate({ query: worklogQuerySchema.strict() }), async (req, res) => {
  const { items, meta, totalMinutes } = await logs.listWorklogs(requestContext(req), query(req));
  res.json({ success: true, data: items, meta: { ...meta, totalMinutes } });
});
worklogRoutes.post('/', validate({ body: createWorklogSchema }), async (req, res) => {
  sendCreated(res, await logs.createWorklog(requestContext(req), body(req)));
});
worklogRoutes.patch(
  '/:id',
  validate({ params: idParams, body: updateWorklogSchema }),
  async (req, res) => {
    sendOk(res, await logs.updateWorklog(requestContext(req), id(req), body(req)));
  },
);
worklogRoutes.delete('/:id', validate({ params: idParams }), async (req, res) => {
  await logs.deleteWorklog(requestContext(req), id(req));
  sendNoContent(res);
});

export const timerRoutes = Router();
timerRoutes.use(authenticate, authorize('worklog:write'));
timerRoutes.get('/', async (req, res) => {
  sendOk(res, await logs.getTimer(requestContext(req)));
});
timerRoutes.post('/start', validate({ body: startTimerSchema }), async (req, res) => {
  sendCreated(res, await logs.startTimer(requestContext(req), body(req)));
});
timerRoutes.post('/pause', async (req, res) => {
  sendOk(res, await logs.pauseTimer(requestContext(req)));
});
timerRoutes.post('/resume', async (req, res) => {
  sendOk(res, await logs.resumeTimer(requestContext(req)));
});
timerRoutes.post('/stop', validate({ body: stopTimerSchema }), async (req, res) => {
  sendOk(res, await logs.stopTimer(requestContext(req), body(req)));
});

/* ============================ Timesheets ============================ */

export const timesheetRoutes = Router();
timesheetRoutes.use(authenticate, authorize('worklog:write'));
timesheetRoutes.get('/', validate({ query: timesheetQuerySchema.strict() }), async (req, res) => {
  const { items, meta } = await people.listTimesheets(requestContext(req), query(req));
  sendPage(res, items, meta);
});
timesheetRoutes.get(
  '/week',
  validate({
    query: timesheetWeekSchema
      .extend({ userId: z.union([objectIdSchema, z.literal('me')]).optional() })
      .strict(),
  }),
  async (req, res) => {
    const q = query<{ weekStart: string; userId?: string }>(req);
    sendOk(res, await people.getTimesheetWeek(requestContext(req), q.weekStart, q.userId));
  },
);
timesheetRoutes.post('/submit', validate({ body: timesheetWeekSchema }), async (req, res) => {
  sendOk(
    res,
    await people.submitTimesheet(requestContext(req), body<{ weekStart: string }>(req).weekStart),
  );
});
timesheetRoutes.post(
  '/:id/approve',
  authorize('timesheet:approve'),
  validate({ params: idParams, body: timesheetDecisionSchema }),
  async (req, res) => {
    sendOk(
      res,
      await people.decideTimesheet(
        requestContext(req),
        id(req),
        'approved',
        body<{ comment?: string }>(req).comment,
      ),
    );
  },
);
timesheetRoutes.post(
  '/:id/reject',
  authorize('timesheet:approve'),
  validate({ params: idParams, body: timesheetRejectSchema }),
  async (req, res) => {
    sendOk(
      res,
      await people.decideTimesheet(
        requestContext(req),
        id(req),
        'rejected',
        body<{ comment: string }>(req).comment,
      ),
    );
  },
);

/* ============================ Journal & availability ============================ */

export const journalRoutes = Router();
journalRoutes.use(authenticate, authorize('worklog:write'));
journalRoutes.get('/', validate({ query: journalQuerySchema.strict() }), async (req, res) => {
  const { items, meta } = await people.listJournals(requestContext(req), query(req));
  sendPage(res, items, meta);
});
journalRoutes.put('/', validate({ body: journalSchema }), async (req, res) => {
  sendOk(res, await people.upsertJournal(requestContext(req), body(req)));
});

export const availabilityRoutes = Router();
availabilityRoutes.use(authenticate);
availabilityRoutes.get(
  '/',
  validate({ query: availabilityQuerySchema.strict() }),
  async (req, res) => {
    const { items, meta } = await people.listAvailability(requestContext(req), query(req));
    sendPage(res, items, meta);
  },
);
availabilityRoutes.post('/', validate({ body: availabilitySchema }), async (req, res) => {
  sendCreated(res, await people.requestAvailability(requestContext(req), body(req)));
});
availabilityRoutes.post(
  '/:id/approve',
  authorize('timesheet:approve'),
  validate({ params: idParams }),
  async (req, res) => {
    sendOk(res, await people.decideAvailability(requestContext(req), id(req), 'approved'));
  },
);
availabilityRoutes.post(
  '/:id/reject',
  authorize('timesheet:approve'),
  validate({ params: idParams }),
  async (req, res) => {
    sendOk(res, await people.decideAvailability(requestContext(req), id(req), 'rejected'));
  },
);
availabilityRoutes.post('/:id/cancel', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await people.cancelAvailability(requestContext(req), id(req)));
});

/* ============================ Teams & passport ============================ */

export const teamRoutes = Router();
teamRoutes.use(authenticate, authorize('team:read'));
teamRoutes.get(
  '/workload',
  validate({ query: z.strictObject({ departmentId: objectIdSchema.optional() }) }),
  async (req, res) => {
    sendOk(
      res,
      await people.teamWorkload(
        requestContext(req),
        query<{ departmentId?: string }>(req).departmentId,
      ),
    );
  },
);

teamRoutes.get(
  '/performance',
  validate({ query: teamPerformanceQuerySchema }),
  async (req, res) => {
    sendOk(res, await teamPerformance(requestContext(req), query<TeamPerformanceQuery>(req)));
  },
);

teamRoutes.get('/capacity', validate({ query: capacityPlanQuerySchema }), async (req, res) => {
  sendOk(res, await capacityPlan(requestContext(req), query<CapacityPlanQuery>(req)));
});
teamRoutes.get('/', async (req, res) => {
  sendOk(res, await teams.listTeams(requestContext(req)));
});
teamRoutes.post('/', validate({ body: teamSchema }), async (req, res) => {
  sendCreated(res, await teams.createTeam(requestContext(req), body<TeamInput>(req)));
});
teamRoutes.patch(
  '/:id',
  validate({ params: idParams, body: updateTeamSchema }),
  async (req, res) => {
    sendOk(res, await teams.updateTeam(requestContext(req), id(req), body<TeamInput>(req)));
  },
);
teamRoutes.delete('/:id', validate({ params: idParams }), async (req, res) => {
  await teams.archiveTeam(requestContext(req), id(req));
  sendNoContent(res);
});

export const passportRoutes = Router();
passportRoutes.use(authenticate);
passportRoutes.get('/:id/passport', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await people.workPassport(requestContext(req), id(req)));
});

/* ============================ Smart assignment ============================ */

export const assignmentRoutes = Router();
assignmentRoutes.use(authenticate);

assignmentRoutes.get('/config', async (_req, res) => {
  sendOk(res, await getAssignmentConfig());
});
assignmentRoutes.put(
  '/config',
  authorize('assignment:configure', 'org'),
  validate({ body: assignmentConfigSchema }),
  async (req, res) => {
    const before = await getAssignmentConfig();
    const value = body<AssignmentConfig>(req);
    await Setting.updateOne(
      { key: 'assignment' },
      { $set: { value, updatedBy: requireAuth(requestContext(req)).userObjectId } },
      { upsert: true },
    );
    await recordAudit(requestContext(req), {
      action: 'assignment.config_updated',
      entityType: 'settings',
      summary: 'Updated smart assignment configuration',
      before,
      after: value,
    });
    sendOk(res, value);
  },
);

assignmentRoutes.use(authorize('assignment:execute'));
assignmentRoutes.get('/tasks/:id/suggestions', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await assignment.suggest(requestContext(req), id(req)));
});
assignmentRoutes.post(
  '/tasks/:id/assign',
  validate({ params: idParams, body: z.strictObject({ userId: objectIdSchema }) }),
  async (req, res) => {
    sendOk(
      res,
      await assignment.assignSuggested(
        requestContext(req),
        id(req),
        body<{ userId: string }>(req).userId,
      ),
    );
  },
);
assignmentRoutes.post('/plans/batch', validate({ body: batchPreviewSchema }), async (req, res) => {
  sendCreated(res, await assignment.previewBatch(requestContext(req), body(req)));
});
assignmentRoutes.post(
  '/plans/reassign',
  validate({ body: reassignPreviewSchema }),
  async (req, res) => {
    sendCreated(
      res,
      await assignment.previewReassign(requestContext(req), body<{ userId: string }>(req).userId),
    );
  },
);
assignmentRoutes.post(
  '/plans/rebalance',
  validate({ body: rebalancePreviewSchema }),
  async (req, res) => {
    sendCreated(res, await assignment.previewRebalance(requestContext(req), body(req)));
  },
);
assignmentRoutes.get('/plans', async (req, res) => {
  sendOk(res, await assignment.listPlans(requestContext(req)));
});
assignmentRoutes.get('/plans/:id', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await assignment.getPlan(requestContext(req), id(req)));
});
assignmentRoutes.patch(
  '/plans/:id',
  validate({ params: idParams, body: modifyPlanSchema }),
  async (req, res) => {
    sendOk(
      res,
      await assignment.modifyPlan(
        requestContext(req),
        id(req),
        body<{ proposals: { taskId: string; toUserId: string | null }[] }>(req).proposals,
      ),
    );
  },
);
assignmentRoutes.post('/plans/:id/approve', validate({ params: idParams }), async (req, res) => {
  res.status(202);
  sendOk(res, await assignment.approvePlan(requestContext(req), id(req)), 202);
});
assignmentRoutes.post('/plans/:id/reject', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await assignment.rejectPlan(requestContext(req), id(req)));
});
