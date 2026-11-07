import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  APPROVAL_ENTITY_TYPES,
  approvalDecisionSchema,
  approvalDelegateSchema,
  approvalQuerySchema,
  approvalRejectSchema,
  approvalWorkflowSchema,
  createApprovalSchema,
  createMeetingSchema,
  meetingMinutesSchema,
  meetingQuerySchema,
  notificationPrefsSchema,
  notificationQuerySchema,
  objectIdSchema,
  updateMeetingSchema,
} from '@arihant/shared';
import { sendCreated, sendNoContent, sendOk, sendPage } from '../core/http';
import { requestContext } from '../core/rbac/context';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as approvals from './approvals/approval.service';
import * as meetings from './meetings/meeting.service';
import * as notifications from './notifications/notification.service';

const idParams = z.object({ id: objectIdSchema });
const id = (req: Request) => (req.valid!.params as { id: string }).id;
const body = <T>(req: Request) => req.valid!.body as T;
const query = <T>(req: Request) => req.valid!.query as T;

/* ============================ Notifications ============================ */

export const notificationRoutes = Router();
notificationRoutes.use(authenticate);
notificationRoutes.get(
  '/',
  validate({ query: notificationQuerySchema.strict() }),
  async (req, res) => {
    const { items, meta } = await notifications.listNotifications(requestContext(req), query(req));
    sendPage(res, items, meta);
  },
);
notificationRoutes.get('/unread-count', async (req, res) => {
  sendOk(res, { unread: await notifications.unreadCount(requestContext(req)) });
});
notificationRoutes.post('/read-all', async (req, res) => {
  sendOk(res, { updated: await notifications.markAllRead(requestContext(req)) });
});
notificationRoutes.get('/preferences', async (req, res) => {
  sendOk(res, await notifications.getPrefs(requestContext(req)));
});
notificationRoutes.put(
  '/preferences',
  validate({ body: notificationPrefsSchema }),
  async (req, res) => {
    sendOk(res, await notifications.setPrefs(requestContext(req), body(req)));
  },
);
notificationRoutes.post('/:id/read', validate({ params: idParams }), async (req, res) => {
  await notifications.markRead(requestContext(req), id(req));
  sendNoContent(res);
});

/* ============================ Approvals ============================ */

/** Anyone signed in can raise requests for their projects and see their own; deciding needs `approval:act`. */
export const approvalRoutes = Router();
approvalRoutes.use(authenticate);
approvalRoutes.get('/workflows', async (req, res) => {
  sendOk(res, await approvals.listWorkflows(requestContext(req)));
});
approvalRoutes.put(
  '/workflows/:type',
  authorize('settings:manage', 'org'),
  validate({
    params: z.object({ type: z.enum(APPROVAL_ENTITY_TYPES) }),
    body: approvalWorkflowSchema,
  }),
  async (req, res) => {
    sendOk(
      res,
      await approvals.updateWorkflow(
        requestContext(req),
        (req.valid!.params as { type: string }).type,
        body(req),
      ),
    );
  },
);
approvalRoutes.get('/', validate({ query: approvalQuerySchema.strict() }), async (req, res) => {
  const { items, meta } = await approvals.listApprovals(requestContext(req), query(req));
  sendPage(res, items, meta);
});
approvalRoutes.post('/', validate({ body: createApprovalSchema }), async (req, res) => {
  sendCreated(res, await approvals.createApproval(requestContext(req), body(req)));
});
approvalRoutes.get('/:id', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await approvals.getApproval(requestContext(req), id(req)));
});
approvalRoutes.post(
  '/:id/approve',
  authorize('approval:act'),
  validate({ params: idParams, body: approvalDecisionSchema }),
  async (req, res) => {
    sendOk(res, await approvals.approve(requestContext(req), id(req), body(req)));
  },
);
approvalRoutes.post(
  '/:id/reject',
  authorize('approval:act'),
  validate({ params: idParams, body: approvalRejectSchema }),
  async (req, res) => {
    sendOk(res, await approvals.reject(requestContext(req), id(req), body(req)));
  },
);
approvalRoutes.post(
  '/:id/delegate',
  authorize('approval:act'),
  validate({ params: idParams, body: approvalDelegateSchema }),
  async (req, res) => {
    sendOk(res, await approvals.delegate(requestContext(req), id(req), body(req)));
  },
);
approvalRoutes.post('/:id/cancel', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await approvals.cancel(requestContext(req), id(req)));
});

/* ============================ Meetings ============================ */

export const meetingRoutes = Router();
meetingRoutes.use(authenticate);
meetingRoutes.get('/', validate({ query: meetingQuerySchema.strict() }), async (req, res) => {
  const { items, meta } = await meetings.listMeetings(requestContext(req), query(req));
  sendPage(res, items, meta);
});
meetingRoutes.post(
  '/',
  authorize('meeting:write'),
  validate({ body: createMeetingSchema }),
  async (req, res) => {
    sendCreated(res, await meetings.createMeeting(requestContext(req), body(req)));
  },
);
meetingRoutes.get('/:id', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await meetings.getMeeting(requestContext(req), id(req)));
});
meetingRoutes.patch(
  '/:id',
  validate({ params: idParams, body: updateMeetingSchema }),
  async (req, res) => {
    sendOk(res, await meetings.updateMeeting(requestContext(req), id(req), body(req)));
  },
);
meetingRoutes.delete('/:id', validate({ params: idParams }), async (req, res) => {
  await meetings.deleteMeeting(requestContext(req), id(req));
  sendNoContent(res);
});
meetingRoutes.put(
  '/:id/minutes',
  validate({ params: idParams, body: meetingMinutesSchema }),
  async (req, res) => {
    sendOk(res, await meetings.saveMinutes(requestContext(req), id(req), body(req)));
  },
);
meetingRoutes.post(
  '/:id/action-items/:itemId/convert',
  authorize('task:create'),
  validate({ params: z.object({ id: objectIdSchema, itemId: objectIdSchema }) }),
  async (req, res) => {
    const p = req.valid!.params as { id: string; itemId: string };
    sendOk(res, await meetings.convertActionItem(requestContext(req), p.id, p.itemId));
  },
);
