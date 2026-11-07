import { Router } from 'express';
import { z } from 'zod';
import {
  assignRolesSchema,
  createUserSchema,
  objectIdSchema,
  updateUserSchema,
  userListQuerySchema,
  userStatusSchema,
} from '@arihant/shared';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as c from './user.controller';

const idParams = z.object({ id: objectIdSchema });

export const userRoutes = Router();
userRoutes.use(authenticate);

userRoutes.get(
  '/',
  authorize('user:read'),
  validate({ query: userListQuerySchema.strict() }),
  c.list,
);
userRoutes.get('/:id', authorize('user:read'), validate({ params: idParams }), c.get);
userRoutes.post(
  '/',
  authorize('user:manage', 'org'),
  validate({ body: createUserSchema }),
  c.create,
);
userRoutes.patch(
  '/:id',
  authorize('user:manage', 'org'),
  validate({ params: idParams, body: updateUserSchema }),
  c.update,
);
userRoutes.patch(
  '/:id/status',
  authorize('user:manage', 'org'),
  validate({ params: idParams, body: userStatusSchema }),
  c.setStatus,
);
userRoutes.put(
  '/:id/roles',
  authorize('user:manage', 'org'),
  validate({ params: idParams, body: assignRolesSchema }),
  c.setRoles,
);
userRoutes.post(
  '/:id/resend-invite',
  authorize('user:manage', 'org'),
  validate({ params: idParams }),
  c.resendInvite,
);
userRoutes.post(
  '/:id/send-password-reset',
  authorize('user:manage', 'org'),
  validate({ params: idParams }),
  c.sendReset,
);
