import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  createMilestoneSchema,
  createTemplateSchema,
  objectIdSchema,
  projectCustomFieldsSchema,
  projectDependenciesSchema,
  saveAsTemplateSchema,
  updateMilestoneSchema,
  updateTemplateSchema,
} from '@arihant/shared';
import { sendCreated, sendNoContent, sendOk } from '../../core/http';
import { requestContext } from '../../core/rbac/context';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as planning from './planning.service';
import { similarTasks } from './similar.service';
import * as templates from './template.service';

const idParams = z.object({ id: objectIdSchema });
const id = (req: Request) => (req.valid!.params as { id: string }).id;
const body = <T>(req: Request) => req.valid!.body as T;

/** Routes nested under /projects/:id (mounted on the project router, which already authenticates). */
export function mountProjectPlanningRoutes(router: Router): void {
  router.get(
    '/:id/similar-tasks',
    validate({
      params: idParams,
      query: z.strictObject({
        title: z.string().trim().min(3).max(200),
        excludeId: objectIdSchema.optional(),
      }),
    }),
    async (req, res) => {
      const q = req.valid!.query as { title: string; excludeId?: string };
      sendOk(res, await similarTasks(requestContext(req), id(req), q.title, q.excludeId));
    },
  );
  router.get('/:id/milestones', validate({ params: idParams }), async (req, res) => {
    sendOk(res, await planning.listMilestones(requestContext(req), id(req)));
  });
  router.post(
    '/:id/milestones',
    authorize('project:update'),
    validate({ params: idParams, body: createMilestoneSchema }),
    async (req, res) => {
      sendCreated(res, await planning.createMilestone(requestContext(req), id(req), body(req)));
    },
  );
  router.get('/:id/dependencies', validate({ params: idParams }), async (req, res) => {
    sendOk(res, await planning.getDependencies(requestContext(req), id(req)));
  });
  router.put(
    '/:id/dependencies',
    authorize('project:update'),
    validate({ params: idParams, body: projectDependenciesSchema }),
    async (req, res) => {
      sendOk(res, await planning.setDependencies(requestContext(req), id(req), body(req)));
    },
  );
  router.put(
    '/:id/custom-fields',
    authorize('project:update'),
    validate({ params: idParams, body: projectCustomFieldsSchema }),
    async (req, res) => {
      sendOk(res, await planning.setCustomFields(requestContext(req), id(req), body(req)));
    },
  );
  router.post(
    '/:id/save-as-template',
    authorize('project:create'),
    validate({ params: idParams, body: saveAsTemplateSchema }),
    async (req, res) => {
      sendCreated(
        res,
        await templates.saveProjectAsTemplate(requestContext(req), id(req), body(req)),
      );
    },
  );
}

export const milestoneRoutes = Router();
milestoneRoutes.use(authenticate, authorize('project:read'));
milestoneRoutes.patch(
  '/:id',
  authorize('project:update'),
  validate({ params: idParams, body: updateMilestoneSchema }),
  async (req, res) => {
    sendOk(res, await planning.updateMilestone(requestContext(req), id(req), body(req)));
  },
);
milestoneRoutes.delete(
  '/:id',
  authorize('project:update'),
  validate({ params: idParams }),
  async (req, res) => {
    await planning.deleteMilestone(requestContext(req), id(req));
    sendNoContent(res);
  },
);

export const templateRoutes = Router();
templateRoutes.use(authenticate, authorize('project:create'));
templateRoutes.get(
  '/',
  validate({ query: z.strictObject({ q: z.string().trim().max(80).optional() }) }),
  async (req, res) => {
    sendOk(
      res,
      await templates.listTemplates(requestContext(req), (req.valid!.query as { q?: string }).q),
    );
  },
);
templateRoutes.post('/', validate({ body: createTemplateSchema }), async (req, res) => {
  sendCreated(res, await templates.createTemplate(requestContext(req), body(req)));
});
templateRoutes.get('/:id', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await templates.getTemplate(requestContext(req), id(req)));
});
templateRoutes.patch(
  '/:id',
  validate({ params: idParams, body: updateTemplateSchema }),
  async (req, res) => {
    sendOk(res, await templates.updateTemplate(requestContext(req), id(req), body(req)));
  },
);
templateRoutes.delete('/:id', validate({ params: idParams }), async (req, res) => {
  await templates.deleteTemplate(requestContext(req), id(req));
  sendNoContent(res);
});
