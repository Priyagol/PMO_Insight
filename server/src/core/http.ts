import type { Response } from 'express';
import type { ApiSuccess, PageMeta } from '@arihant/shared';

/** Sends the standard success envelope. Controllers should only respond through these helpers. */
export function sendOk<T>(res: Response, data: T, status = 200): Response<ApiSuccess<T>> {
  return res.status(status).json({ success: true, data });
}

export function sendCreated<T>(res: Response, data: T): Response<ApiSuccess<T>> {
  return sendOk(res, data, 201);
}

export function sendPage<T>(res: Response, items: T[], meta: PageMeta): Response<ApiSuccess<T[]>> {
  return res.status(200).json({ success: true, data: items, meta });
}

export function sendNoContent(res: Response): Response {
  return res.status(204).end();
}
