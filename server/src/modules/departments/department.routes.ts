import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  departmentSchema,
  objectIdSchema,
  updateDepartmentSchema,
  type DepartmentInput,
} from '@arihant/shared';
import { sendCreated, sendNoContent, sendOk } from '../../core/http';
import { requestContext } from '../../core/rbac/context';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as departments from './department.service';

const idParams = z.object({ id: objectIdSchema });
const listQuery = z.strictObject({ q: z.string().trim().max(80).optional() });
const id = (req: Request) => (req.valid!.params as { id: string }).id;

/* Controllers (thin: parse → service → respond). */
const list = async (req: Request, res: Response) => {
  sendOk(res, await departments.listDepartments((req.valid!.query as { q?: string }).q));
};
const get = async (req: Request, res: Response) => {
  sendOk(res, await departments.getDepartment(id(req)));
};
const create = async (req: Request, res: Response) => {
  sendCreated(
    res,
    await departments.createDepartment(requestContext(req), req.valid!.body as DepartmentInput),
  );
};
const update = async (req: Request, res: Response) => {
  sendOk(
    res,
    await departments.updateDepartment(
      requestContext(req),
      id(req),
      req.valid!.body as Partial<DepartmentInput>,
    ),
  );
};
const archive = async (req: Request, res: Response) => {
  await departments.archiveDepartment(requestContext(req), id(req));
  sendNoContent(res);
};

export const departmentRoutes = Router();
departmentRoutes.use(authenticate);
departmentRoutes.get('/', validate({ query: listQuery }), list);
departmentRoutes.get('/:id', validate({ params: idParams }), get);
departmentRoutes.post(
  '/',
  authorize('department:manage', 'org'),
  validate({ body: departmentSchema }),
  create,
);
departmentRoutes.patch(
  '/:id',
  authorize('department:manage', 'org'),
  validate({ params: idParams, body: updateDepartmentSchema }),
  update,
);
departmentRoutes.delete(
  '/:id',
  authorize('department:manage', 'org'),
  validate({ params: idParams }),
  archive,
);
