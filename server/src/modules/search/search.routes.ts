import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  exportSearchQuerySchema,
  gadgetSchema,
  globalSearchQuerySchema,
  objectIdSchema,
  savedFilterSchema,
  searchStatsQuerySchema,
  searchTasksQuerySchema,
  updateSavedFilterSchema,
} from '@arihant/shared';
import { sendCreated, sendNoContent, sendOk, sendPage } from '../../core/http';
import { requestContext } from '../../core/rbac/context';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as search from './search.service';

const idParams = z.object({ id: objectIdSchema });
const id = (req: Request) => (req.valid!.params as { id: string }).id;

/** /search: global search, task queries, history, statistics and export. */
export const searchRoutes = Router();
searchRoutes.use(authenticate);

searchRoutes.get('/', validate({ query: globalSearchQuerySchema }), async (req, res) => {
  sendOk(
    res,
    await search.globalSearch(requestContext(req), (req.valid!.query as { q: string }).q),
  );
});
searchRoutes.get(
  '/tasks',
  authorize('task:read'),
  validate({ query: searchTasksQuerySchema.strict() }),
  async (req, res) => {
    const { items, meta } = await search.searchTasks(
      requestContext(req),
      req.valid!.query as never,
    );
    sendPage(res, items, meta);
  },
);
searchRoutes.get(
  '/tasks/stats',
  authorize('task:read'),
  validate({ query: searchStatsQuerySchema }),
  async (req, res) => {
    sendOk(res, await search.searchStats(requestContext(req), req.valid!.query));
  },
);
searchRoutes.get(
  '/tasks/export',
  authorize('task:read'),
  validate({ query: exportSearchQuerySchema }),
  async (req, res) => {
    const file = await search.exportSearch(requestContext(req), req.valid!.query);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(file.body);
  },
);
searchRoutes.get('/history', async (req, res) => {
  sendOk(res, await search.listHistory(requestContext(req)));
});
searchRoutes.delete('/history', async (req, res) => {
  await search.clearHistory(requestContext(req));
  sendNoContent(res);
});

/** /filters: saved and shared filters, and dashboard gadgets built from them. */
export const filterRoutes = Router();
filterRoutes.use(authenticate, authorize('task:read'));

filterRoutes.get('/', async (req, res) => {
  sendOk(res, await search.listFilters(requestContext(req)));
});
filterRoutes.post('/', validate({ body: savedFilterSchema }), async (req, res) => {
  sendCreated(res, await search.createFilter(requestContext(req), req.valid!.body as never));
});
filterRoutes.get('/gadgets', async (req, res) => {
  sendOk(res, await search.listGadgets(requestContext(req)));
});
filterRoutes.post('/gadgets', validate({ body: gadgetSchema }), async (req, res) => {
  sendCreated(res, await search.addGadget(requestContext(req), req.valid!.body as never));
});
filterRoutes.delete('/gadgets/:id', validate({ params: idParams }), async (req, res) => {
  await search.removeGadget(requestContext(req), id(req));
  sendNoContent(res);
});
filterRoutes.get('/:id', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await search.getFilter(requestContext(req), id(req)));
});
filterRoutes.patch(
  '/:id',
  validate({ params: idParams, body: updateSavedFilterSchema }),
  async (req, res) => {
    sendOk(res, await search.updateFilter(requestContext(req), id(req), req.valid!.body));
  },
);
filterRoutes.delete('/:id', validate({ params: idParams }), async (req, res) => {
  await search.deleteFilter(requestContext(req), id(req));
  sendNoContent(res);
});
filterRoutes.put(
  '/:id/favourite',
  validate({ params: idParams, body: z.strictObject({ favourite: z.boolean() }) }),
  async (req, res) => {
    sendOk(
      res,
      await search.setFavourite(
        requestContext(req),
        id(req),
        (req.valid!.body as { favourite: boolean }).favourite,
      ),
    );
  },
);
