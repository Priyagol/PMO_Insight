import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  changeRequestQuerySchema,
  createChangeRequestSchema,
  createFeedbackSchema,
  createReleaseSchema,
  createStakeholderSchema,
  deploySchema,
  documentQuerySchema,
  feedbackQuerySchema,
  objectIdSchema,
  releaseQuerySchema,
  rollbackSchema,
  stakeholderQuerySchema,
  updateChangeRequestSchema,
  updateDocumentSchema,
  updateReleaseSchema,
  updateStakeholderSchema,
} from '@arihant/shared';
import { ValidationError } from '../../core/errors';
import { sendCreated, sendNoContent, sendOk, sendPage } from '../../core/http';
import { requestContext } from '../../core/rbac/context';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { handleUpload } from '../work.routes';
import * as documents from './document.service';
import * as releases from './release.service';
import * as stakeholders from './stakeholder.service';

const idParams = z.object({ id: objectIdSchema });
const id = (req: Request) => (req.valid!.params as { id: string }).id;
const body = <T>(req: Request) => req.valid!.body as T;
const query = <T>(req: Request) => req.valid!.query as T;

/** Multipart "meta" field carrying JSON. */
function jsonField(req: Request, name: string): unknown {
  const raw = (req.body as Record<string, unknown> | undefined)?.[name];
  if (raw === undefined) return {};
  try {
    return JSON.parse(String(raw));
  } catch {
    throw new ValidationError([{ path: name, message: 'Must be valid JSON' }]);
  }
}

/* ============================ Documents ============================ */

export const documentRoutes = Router();
documentRoutes.use(authenticate, authorize('document:read'));
documentRoutes.get('/', validate({ query: documentQuerySchema.strict() }), async (req, res) => {
  const { items, meta } = await documents.listDocuments(requestContext(req), query(req));
  sendPage(res, items, meta);
});
documentRoutes.post('/', authorize('document:write'), async (req, res) => {
  await handleUpload(req, res);
  sendCreated(
    res,
    await documents.createDocument(requestContext(req), jsonField(req, 'meta'), req.file),
  );
});
documentRoutes.get('/:id', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await documents.getDocument(requestContext(req), id(req)));
});
documentRoutes.patch(
  '/:id',
  authorize('document:write'),
  validate({ params: idParams, body: updateDocumentSchema }),
  async (req, res) => {
    sendOk(res, await documents.updateDocument(requestContext(req), id(req), body(req)));
  },
);
documentRoutes.delete(
  '/:id',
  authorize('document:write'),
  validate({ params: idParams }),
  async (req, res) => {
    await documents.archiveDocument(requestContext(req), id(req));
    sendNoContent(res);
  },
);
documentRoutes.post(
  '/:id/versions',
  authorize('document:write'),
  validate({ params: idParams }),
  async (req, res) => {
    await handleUpload(req, res);
    const note = (req.body as { note?: string } | undefined)?.note;
    sendCreated(
      res,
      await documents.addVersion(requestContext(req), id(req), note?.slice(0, 500), req.file),
    );
  },
);
documentRoutes.post(
  '/:id/publish',
  authorize('document:write'),
  validate({ params: idParams }),
  async (req, res) => {
    sendOk(res, await documents.requestPublish(requestContext(req), id(req)));
  },
);
documentRoutes.get(
  '/:id/versions/:version/download',
  validate({ params: z.object({ id: objectIdSchema, version: z.coerce.number().int().min(1) }) }),
  async (req, res) => {
    const p = req.valid!.params as { id: string; version: number };
    sendOk(res, await documents.downloadVersion(requestContext(req), p.id, p.version));
  },
);

/* ============================ Releases ============================ */

export const releaseRoutes = Router();
releaseRoutes.use(authenticate, authorize('release:read'));
releaseRoutes.get('/', validate({ query: releaseQuerySchema.strict() }), async (req, res) => {
  const { items, meta } = await releases.listReleases(requestContext(req), query(req));
  sendPage(res, items, meta);
});
releaseRoutes.post(
  '/',
  authorize('release:write'),
  validate({ body: createReleaseSchema }),
  async (req, res) => {
    sendCreated(res, await releases.createRelease(requestContext(req), body(req)));
  },
);
releaseRoutes.get('/:id', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await releases.getRelease(requestContext(req), id(req)));
});
releaseRoutes.patch(
  '/:id',
  authorize('release:write'),
  validate({ params: idParams, body: updateReleaseSchema }),
  async (req, res) => {
    sendOk(res, await releases.updateRelease(requestContext(req), id(req), body(req)));
  },
);
releaseRoutes.post(
  '/:id/deploy',
  authorize('release:write'),
  validate({ params: idParams, body: deploySchema }),
  async (req, res) => {
    sendOk(res, await releases.deploy(requestContext(req), id(req), body(req)));
  },
);
releaseRoutes.post(
  '/:id/rollback',
  authorize('release:write'),
  validate({ params: idParams, body: rollbackSchema }),
  async (req, res) => {
    sendOk(res, await releases.rollback(requestContext(req), id(req), body(req)));
  },
);
releaseRoutes.post(
  '/:id/request-go-live',
  authorize('release:write'),
  validate({ params: idParams }),
  async (req, res) => {
    sendOk(res, await releases.requestGoLive(requestContext(req), id(req)));
  },
);

/* ============================ Stakeholders ============================ */

export const stakeholderRoutes = Router();
stakeholderRoutes.use(authenticate, authorize('stakeholder:read'));
stakeholderRoutes.get(
  '/',
  validate({ query: stakeholderQuerySchema.strict() }),
  async (req, res) => {
    const { items, meta } = await stakeholders.listStakeholders(requestContext(req), query(req));
    sendPage(res, items, meta);
  },
);
stakeholderRoutes.post(
  '/',
  authorize('stakeholder:write'),
  validate({ body: createStakeholderSchema }),
  async (req, res) => {
    sendCreated(res, await stakeholders.createStakeholder(requestContext(req), body(req)));
  },
);
stakeholderRoutes.patch(
  '/:id',
  authorize('stakeholder:write'),
  validate({ params: idParams, body: updateStakeholderSchema }),
  async (req, res) => {
    sendOk(res, await stakeholders.updateStakeholder(requestContext(req), id(req), body(req)));
  },
);
stakeholderRoutes.delete(
  '/:id',
  authorize('stakeholder:write'),
  validate({ params: idParams }),
  async (req, res) => {
    await stakeholders.deleteStakeholder(requestContext(req), id(req));
    sendNoContent(res);
  },
);

/** Change requests: anyone on the project may raise one; decisions go through approvals. */
export const changeRequestRoutes = Router();
changeRequestRoutes.use(authenticate, authorize('project:read'));
changeRequestRoutes.get(
  '/',
  validate({ query: changeRequestQuerySchema.strict() }),
  async (req, res) => {
    const { items, meta } = await stakeholders.listChangeRequests(requestContext(req), query(req));
    sendPage(res, items, meta);
  },
);
changeRequestRoutes.post('/', validate({ body: createChangeRequestSchema }), async (req, res) => {
  sendCreated(res, await stakeholders.createChangeRequest(requestContext(req), body(req)));
});
changeRequestRoutes.get('/:id', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await stakeholders.getChangeRequest(requestContext(req), id(req)));
});
changeRequestRoutes.patch(
  '/:id',
  validate({ params: idParams, body: updateChangeRequestSchema }),
  async (req, res) => {
    sendOk(res, await stakeholders.updateChangeRequest(requestContext(req), id(req), body(req)));
  },
);
changeRequestRoutes.post('/:id/submit', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await stakeholders.submitChangeRequest(requestContext(req), id(req)));
});
changeRequestRoutes.post('/:id/withdraw', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await stakeholders.withdrawChangeRequest(requestContext(req), id(req)));
});
changeRequestRoutes.post(
  '/:id/create-task',
  authorize('task:create'),
  validate({ params: idParams }),
  async (req, res) => {
    sendOk(res, await stakeholders.createImplementationTask(requestContext(req), id(req)));
  },
);
changeRequestRoutes.post('/:id/implemented', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await stakeholders.markImplemented(requestContext(req), id(req)));
});

export const feedbackRoutes = Router();
feedbackRoutes.use(authenticate, authorize('stakeholder:read'));
feedbackRoutes.get('/', validate({ query: feedbackQuerySchema.strict() }), async (req, res) => {
  const { items, meta } = await stakeholders.listFeedback(requestContext(req), query(req));
  sendPage(res, items, meta);
});
feedbackRoutes.post(
  '/',
  authorize('stakeholder:write'),
  validate({ body: createFeedbackSchema }),
  async (req, res) => {
    sendCreated(res, await stakeholders.recordFeedback(requestContext(req), body(req)));
  },
);
