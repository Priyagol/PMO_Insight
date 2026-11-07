import type { Request, Response } from 'express';
import type {
  CreateUserInput,
  EmploymentStatus,
  UpdateUserInput,
  UserListQuery,
} from '@arihant/shared';
import { sendCreated, sendOk, sendPage } from '../../core/http';
import { requestContext } from '../../core/rbac/context';
import * as users from './user.service';

const idParam = (req: Request) => (req.valid!.params as { id: string }).id;

export async function list(req: Request, res: Response): Promise<void> {
  const { items, meta } = await users.listUsers(
    requestContext(req),
    req.valid!.query as UserListQuery,
  );
  sendPage(res, items, meta);
}

export async function get(req: Request, res: Response): Promise<void> {
  sendOk(res, await users.getUser(requestContext(req), idParam(req)));
}

export async function create(req: Request, res: Response): Promise<void> {
  sendCreated(res, await users.createUser(requestContext(req), req.valid!.body as CreateUserInput));
}

export async function update(req: Request, res: Response): Promise<void> {
  sendOk(
    res,
    await users.updateUser(requestContext(req), idParam(req), req.valid!.body as UpdateUserInput),
  );
}

export async function setStatus(req: Request, res: Response): Promise<void> {
  const { status } = req.valid!.body as { status: EmploymentStatus };
  sendOk(res, await users.setUserStatus(requestContext(req), idParam(req), status));
}

export async function setRoles(req: Request, res: Response): Promise<void> {
  const { roleIds } = req.valid!.body as { roleIds: string[] };
  sendOk(res, await users.setUserRoles(requestContext(req), idParam(req), roleIds));
}

export async function resendInvite(req: Request, res: Response): Promise<void> {
  sendOk(res, await users.resendInvite(requestContext(req), idParam(req)));
}

export async function sendReset(req: Request, res: Response): Promise<void> {
  sendOk(res, await users.sendResetLink(requestContext(req), idParam(req)));
}
