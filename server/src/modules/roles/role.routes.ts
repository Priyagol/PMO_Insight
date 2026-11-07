import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  ORG_ONLY_PERMISSIONS,
  PERMISSION_GROUPS,
  objectIdSchema,
  roleSchema,
  updateRoleSchema,
  type RoleInput,
} from '@arihant/shared';
import { sendCreated, sendNoContent, sendOk } from '../../core/http';
import { requestContext } from '../../core/rbac/context';
import { authenticate, authorize, authorizeAny } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as roles from './role.service';

const idParams = z.object({ id: objectIdSchema });
const id = (req: Request) => (req.valid!.params as { id: string }).id;

export const roleRoutes = Router();
roleRoutes.use(authenticate);

// Reading roles is needed both to manage roles and to assign them to employees.
roleRoutes.get('/', authorizeAny('role:manage', 'user:manage'), async (_req, res) => {
  sendOk(res, await roles.listRoles());
});
roleRoutes.get(
  '/:id',
  authorizeAny('role:manage', 'user:manage'),
  validate({ params: idParams }),
  async (req, res) => {
    sendOk(res, await roles.getRole(id(req)));
  },
);
roleRoutes.post(
  '/',
  authorize('role:manage', 'org'),
  validate({ body: roleSchema }),
  async (req: Request, res: Response) => {
    sendCreated(res, await roles.createRole(requestContext(req), req.valid!.body as RoleInput));
  },
);
roleRoutes.patch(
  '/:id',
  authorize('role:manage', 'org'),
  validate({ params: idParams, body: updateRoleSchema }),
  async (req: Request, res: Response) => {
    sendOk(
      res,
      await roles.updateRole(requestContext(req), id(req), req.valid!.body as Partial<RoleInput>),
    );
  },
);
roleRoutes.delete(
  '/:id',
  authorize('role:manage', 'org'),
  validate({ params: idParams }),
  async (req, res) => {
    await roles.deleteRole(requestContext(req), id(req));
    sendNoContent(res);
  },
);

/** Static permission catalogue for the role editor. */
export const permissionRoutes = Router();
permissionRoutes.use(authenticate, authorize('role:manage', 'org'));
permissionRoutes.get('/', (_req, res) => {
  sendOk(res, { groups: PERMISSION_GROUPS, orgOnly: ORG_ONLY_PERMISSIONS });
});
