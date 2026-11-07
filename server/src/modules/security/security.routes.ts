import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import {
  createApiTokenSchema,
  objectIdSchema,
  projectConfidentialSchema,
  securitySettingsSchema,
  taskRestrictionSchema,
} from '@arihant/shared';
import { ForbiddenError } from '../../core/errors';
import { sendCreated, sendNoContent, sendOk } from '../../core/http';
import { requestContext } from '../../core/rbac/context';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { adminReset } from '../auth/mfa.service';
import * as tokens from './api-token.service';
import { setProjectConfidential, setTaskRestriction } from './restriction.service';
import { getSecuritySettings, saveSecuritySettings } from './security.settings';

const idParams = z.object({ id: objectIdSchema });
const id = (req: Request) => (req.valid!.params as { id: string }).id;

/** Security administration and personal API tokens are not available to API tokens themselves. */
const noApiToken: RequestHandler = (req, _res, next) => {
  if (req.apiTokenScope) throw new ForbiddenError('Not available with an API token');
  next();
};

/** /security */
export const securityRoutes = Router();
securityRoutes.use(authenticate, noApiToken);

securityRoutes.get('/settings', async (req, res) => {
  sendOk(res, await getSecuritySettings(requestContext(req)));
});
securityRoutes.put(
  '/settings',
  authorize('settings:manage', 'org'),
  validate({ body: securitySettingsSchema }),
  async (req, res) => {
    sendOk(res, await saveSecuritySettings(requestContext(req), req.valid!.body as never));
  },
);
securityRoutes.get('/api-tokens', async (req, res) => {
  sendOk(res, await tokens.listMyTokens(requestContext(req)));
});
securityRoutes.get('/api-tokens/all', authorize('settings:manage', 'org'), async (req, res) => {
  sendOk(res, await tokens.listAllTokens(requestContext(req)));
});
securityRoutes.post('/api-tokens', validate({ body: createApiTokenSchema }), async (req, res) => {
  sendCreated(res, await tokens.createToken(requestContext(req), req.valid!.body as never));
});
securityRoutes.delete('/api-tokens/:id', validate({ params: idParams }), async (req, res) => {
  await tokens.revokeToken(requestContext(req), id(req));
  sendNoContent(res);
});
securityRoutes.post(
  '/users/:id/mfa-reset',
  authorize('user:manage', 'org'),
  validate({ params: idParams }),
  async (req, res) => {
    await adminReset(requestContext(req), id(req));
    sendNoContent(res);
  },
);

/** PUT /tasks/:id/restriction */
export function mountTaskSecurityRoutes(router: Router): void {
  router.put(
    '/:id/restriction',
    validate({ params: idParams, body: taskRestrictionSchema }),
    async (req, res) => {
      sendOk(res, await setTaskRestriction(requestContext(req), id(req), req.valid!.body));
    },
  );
}

/** PUT /projects/:id/confidential */
export function mountProjectSecurityRoutes(router: Router): void {
  router.put(
    '/:id/confidential',
    validate({ params: idParams, body: projectConfidentialSchema }),
    async (req, res) => {
      sendOk(res, await setProjectConfidential(requestContext(req), id(req), req.valid!.body));
    },
  );
}
