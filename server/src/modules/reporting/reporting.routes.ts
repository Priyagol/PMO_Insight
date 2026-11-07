import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  createdResolvedQuerySchema,
  objectIdSchema,
  reportSubscriptionSchema,
} from '@arihant/shared';
import { sendCreated, sendNoContent, sendOk } from '../../core/http';
import { requestContext } from '../../core/rbac/context';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as reporting from './reporting.service';

const idParams = z.object({ id: objectIdSchema });
const id = (req: Request) => (req.valid!.params as { id: string }).id;

/** /reporting: created vs resolved and scheduled report e-mails. */
export const reportingRoutes = Router();
reportingRoutes.use(authenticate, authorize('task:read'));

reportingRoutes.get(
  '/created-vs-resolved',
  validate({ query: createdResolvedQuerySchema }),
  async (req, res) => {
    sendOk(res, await reporting.createdVsResolved(requestContext(req), req.valid!.query));
  },
);
reportingRoutes.get('/subscriptions', async (req, res) => {
  sendOk(res, await reporting.listSubscriptions(requestContext(req)));
});
reportingRoutes.post(
  '/subscriptions',
  validate({ body: reportSubscriptionSchema }),
  async (req, res) => {
    sendCreated(
      res,
      await reporting.createSubscription(requestContext(req), req.valid!.body as never),
    );
  },
);
reportingRoutes.put(
  '/subscriptions/:id',
  validate({ params: idParams, body: reportSubscriptionSchema }),
  async (req, res) => {
    sendOk(
      res,
      await reporting.updateSubscription(requestContext(req), id(req), req.valid!.body as never),
    );
  },
);
reportingRoutes.delete('/subscriptions/:id', validate({ params: idParams }), async (req, res) => {
  await reporting.deleteSubscription(requestContext(req), id(req));
  sendNoContent(res);
});
reportingRoutes.post(
  '/subscriptions/:id/send',
  validate({ params: idParams }),
  async (req, res) => {
    sendOk(res, await reporting.sendNow(requestContext(req), id(req)));
  },
);
