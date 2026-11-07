import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  QUEUE_VIEWS,
  objectIdSchema,
  requestCommentSchema,
  requestFeedbackSchema,
  requestTypeSchema,
  serviceDeskSettingsSchema,
  submitRequestSchema,
  type QueueView,
} from '@arihant/shared';
import { sendCreated, sendOk } from '../../core/http';
import { requestContext } from '../../core/rbac/context';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { registerApprovalClosed, registerApprovalEffect } from '../approvals/approval.service';
import * as sd from './servicedesk.service';

const idParams = z.object({ id: objectIdSchema });
const id = (req: Request) => (req.valid!.params as { id: string }).id;

/** /service-desk: help centre, requests, queues and setup. */
export const serviceDeskRoutes = Router();
serviceDeskRoutes.use(authenticate);

// Help centre (anyone in the organisation)
serviceDeskRoutes.get('/portal', async (req, res) => {
  sendOk(res, await sd.portal(requestContext(req)));
});
serviceDeskRoutes.post('/requests', validate({ body: submitRequestSchema }), async (req, res) => {
  sendCreated(res, await sd.submitRequest(requestContext(req), req.valid!.body as never));
});
serviceDeskRoutes.get('/requests/mine', async (req, res) => {
  sendOk(res, await sd.myRequests(requestContext(req)));
});
serviceDeskRoutes.get('/requests/:id', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await sd.getRequest(requestContext(req), id(req)));
});
serviceDeskRoutes.get(
  '/requests/:id/comments',
  validate({ params: idParams }),
  async (req, res) => {
    sendOk(res, await sd.requestComments(requestContext(req), id(req)));
  },
);
serviceDeskRoutes.post(
  '/requests/:id/comments',
  validate({ params: idParams, body: requestCommentSchema }),
  async (req, res) => {
    sendCreated(
      res,
      await sd.addRequestComment(
        requestContext(req),
        id(req),
        (req.valid!.body as { body: string }).body,
      ),
    );
  },
);
serviceDeskRoutes.post(
  '/requests/:id/feedback',
  validate({ params: idParams, body: requestFeedbackSchema }),
  async (req, res) => {
    sendOk(res, await sd.rateRequest(requestContext(req), id(req), req.valid!.body as never));
  },
);

// Project setup and agents
serviceDeskRoutes.get(
  '/projects/:id/settings',
  validate({ params: idParams }),
  async (req, res) => {
    sendOk(res, await sd.getSettings(requestContext(req), id(req)));
  },
);
serviceDeskRoutes.put(
  '/projects/:id/settings',
  validate({ params: idParams, body: serviceDeskSettingsSchema }),
  async (req, res) => {
    sendOk(res, await sd.saveSettings(requestContext(req), id(req), req.valid!.body));
  },
);
serviceDeskRoutes.get(
  '/projects/:id/request-types',
  validate({ params: idParams }),
  async (req, res) => {
    sendOk(res, await sd.listRequestTypes(requestContext(req), id(req)));
  },
);
serviceDeskRoutes.post(
  '/projects/:id/request-types',
  validate({ params: idParams, body: requestTypeSchema }),
  async (req, res) => {
    sendCreated(
      res,
      await sd.createRequestType(requestContext(req), id(req), req.valid!.body as never),
    );
  },
);
serviceDeskRoutes.put(
  '/request-types/:id',
  validate({ params: idParams, body: requestTypeSchema }),
  async (req, res) => {
    sendOk(res, await sd.updateRequestType(requestContext(req), id(req), req.valid!.body as never));
  },
);
serviceDeskRoutes.get(
  '/projects/:id/queue',
  validate({
    params: idParams,
    query: z.strictObject({ view: z.enum(QUEUE_VIEWS).default('open') }),
  }),
  async (req, res) => {
    sendOk(
      res,
      await sd.queue(requestContext(req), id(req), (req.valid!.query as { view: QueueView }).view),
    );
  },
);
serviceDeskRoutes.get('/projects/:id/report', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await sd.report(requestContext(req), id(req)));
});

/* Requests whose type needs approval start work when approved, and are cancelled otherwise. */
registerApprovalEffect('service_request', async (rc, a) => {
  if (a.entityId) await sd.onRequestApproval(rc, a.entityId, true);
});
registerApprovalClosed('service_request', async (rc, a) => {
  if (a.entityId) await sd.onRequestApproval(rc, a.entityId, false);
});
