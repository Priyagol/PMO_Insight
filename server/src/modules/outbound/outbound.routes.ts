import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  objectIdSchema,
  outboundHookSchema,
  updateOutboundHookSchema,
  webLinkSchema,
} from '@arihant/shared';
import { sendCreated, sendNoContent, sendOk } from '../../core/http';
import { requestContext } from '../../core/rbac/context';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as hooks from './outbound.service';
import { addWebLink, listWebLinks, removeWebLink } from './web-links';

const idParams = z.object({ id: objectIdSchema });
const id = (req: Request) => (req.valid!.params as { id: string }).id;

/** /integrations/outgoing: webhooks, Slack and Teams channels (administrators). */
export const outboundRoutes = Router();
outboundRoutes.use(authenticate, authorize('settings:manage', 'org'));
outboundRoutes.get('/', async (req, res) => {
  sendOk(res, await hooks.listHooks(requestContext(req)));
});
outboundRoutes.post('/', validate({ body: outboundHookSchema }), async (req, res) => {
  sendCreated(res, await hooks.createHook(requestContext(req), req.valid!.body as never));
});
outboundRoutes.patch(
  '/:id',
  validate({ params: idParams, body: updateOutboundHookSchema }),
  async (req, res) => {
    sendOk(res, await hooks.updateHook(requestContext(req), id(req), req.valid!.body));
  },
);
outboundRoutes.delete('/:id', validate({ params: idParams }), async (req, res) => {
  await hooks.deleteHook(requestContext(req), id(req));
  sendNoContent(res);
});
outboundRoutes.post('/:id/test', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await hooks.testHook(requestContext(req), id(req)));
});
outboundRoutes.post('/:id/rotate-secret', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await hooks.rotateSecret(requestContext(req), id(req)));
});
outboundRoutes.get('/:id/deliveries', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await hooks.listDeliveries(requestContext(req), id(req)));
});

/** /tasks/:id/web-links */
export function mountTaskWebLinkRoutes(router: Router): void {
  router.get('/:id/web-links', validate({ params: idParams }), async (req, res) => {
    sendOk(res, await listWebLinks(requestContext(req), id(req)));
  });
  router.post(
    '/:id/web-links',
    validate({ params: idParams, body: webLinkSchema }),
    async (req, res) => {
      sendCreated(res, await addWebLink(requestContext(req), id(req), req.valid!.body as never));
    },
  );
  router.delete(
    '/:id/web-links/:linkId',
    validate({ params: z.object({ id: objectIdSchema, linkId: objectIdSchema }) }),
    async (req, res) => {
      const p = req.valid!.params as { id: string; linkId: string };
      await removeWebLink(requestContext(req), p.id, p.linkId);
      sendNoContent(res);
    },
  );
}
