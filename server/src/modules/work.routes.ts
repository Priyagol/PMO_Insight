import { Router, type Request } from 'express';
import multer from 'multer';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  MAX_ATTACHMENT_BYTES,
  bulkDeleteSchema,
  bulkTaskSchema,
  commentSchema,
  createProjectSchema,
  createTaskSchema,
  duplicateProjectSchema,
  moveTaskSchema,
  objectIdSchema,
  paginationQuerySchema,
  projectListQuerySchema,
  projectMembersSchema,
  savedViewSchema,
  taskListQuerySchema,
  boardQuerySchema,
  updateCommentSchema,
  updateProjectSchema,
  updateTaskSchema,
  type ProjectMemberRole,
} from '@arihant/shared';
import { ConflictError, NotFoundError, UnprocessableError } from '../core/errors';
import { sendCreated, sendNoContent, sendOk, sendPage } from '../core/http';
import { requestContext, requireAuth } from '../core/rbac/context';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { listActivity } from './collab/activity.service';
import * as attachments from './collab/attachment.service';
import * as comments from './collab/comment.service';
import { SavedView } from './collab/collab.models';
import { mountProjectAgileRoutes, mountTaskAgileRoutes } from './agile/agile.routes';
import { mountTaskGitRoutes } from './integrations/git.routes';
import { mountProjectWorkflowRoutes, mountTaskWorkflowRoutes } from './workflows/workflow.routes';
import { mountProjectSecurityRoutes, mountTaskSecurityRoutes } from './security/security.routes';
import { hiddenRestrictedTasks } from '../core/rbac/work-access';
import { mountTaskWebLinkRoutes } from './outbound/outbound.routes';
import { mountProjectPlanningRoutes } from './planning/planning.routes';
import * as projects from './projects/project.service';
import * as tasks from './tasks/task.service';

const idParams = z.object({ id: objectIdSchema });
const id = (req: Request) => (req.valid!.params as { id: string }).id;
const body = <T>(req: Request) => req.valid!.body as T;
const query = <T>(req: Request) => req.valid!.query as T;
const pageQuery = paginationQuerySchema.pick({ page: true, limit: true }).strict();

/** Multipart upload kept in memory (≤ 25 MB) and pushed to object storage; one file per request. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
}).single('file');
export const handleUpload = (req: Request, res: Parameters<typeof upload>[1]) =>
  new Promise<void>((resolve, reject) =>
    upload(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        reject(
          new UnprocessableError(
            err.code === 'LIMIT_FILE_SIZE' ? 'Files must be 25 MB or smaller' : err.message,
          ),
        );
      } else if (err) reject(err);
      else resolve();
    }),
  );

/* ============================ Projects ============================ */

export const projectRoutes = Router();
projectRoutes.use(authenticate, authorize('project:read'));

projectRoutes.get('/', validate({ query: projectListQuerySchema.strict() }), async (req, res) => {
  const { items, meta } = await projects.listProjects(requestContext(req), query(req));
  sendPage(res, items, meta);
});
projectRoutes.post(
  '/',
  authorize('project:create'),
  validate({ body: createProjectSchema }),
  async (req, res) => {
    sendCreated(res, await projects.createProject(requestContext(req), body(req)));
  },
);
projectRoutes.get('/:id', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await projects.getProject(requestContext(req), id(req)));
});
projectRoutes.patch(
  '/:id',
  authorize('project:update'),
  validate({ params: idParams, body: updateProjectSchema }),
  async (req, res) => {
    sendOk(res, await projects.updateProject(requestContext(req), id(req), body(req)));
  },
);
projectRoutes.put(
  '/:id/members',
  authorize('project:update'),
  validate({ params: idParams, body: projectMembersSchema }),
  async (req, res) => {
    const { members } = body<{ members: { userId: string; role: ProjectMemberRole }[] }>(req);
    sendOk(res, await projects.setMembers(requestContext(req), id(req), members));
  },
);
projectRoutes.post(
  '/:id/archive',
  authorize('project:delete'),
  validate({ params: idParams }),
  async (req, res) => {
    sendOk(res, await projects.setArchived(requestContext(req), id(req), true));
  },
);
projectRoutes.post(
  '/:id/restore',
  authorize('project:delete'),
  validate({ params: idParams }),
  async (req, res) => {
    sendOk(res, await projects.setArchived(requestContext(req), id(req), false));
  },
);
projectRoutes.post(
  '/:id/duplicate',
  authorize('project:create'),
  validate({ params: idParams, body: duplicateProjectSchema }),
  async (req, res) => {
    sendCreated(res, await projects.duplicateProject(requestContext(req), id(req), body(req)));
  },
);
projectRoutes.get('/:id/versions', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await projects.listVersions(requestContext(req), id(req)));
});
projectRoutes.get('/:id/overview', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await projects.projectOverview(requestContext(req), id(req)));
});
projectRoutes.get(
  '/:id/activity',
  validate({ params: idParams, query: pageQuery }),
  async (req, res) => {
    const project = await projects.loadReadableProject(requireAuth(requestContext(req)), id(req));
    const { items, meta } = await listActivity(
      { projectId: project._id },
      query(req),
      await hiddenRestrictedTasks(requireAuth(requestContext(req)), project._id),
    );
    sendPage(res, items, meta);
  },
);
projectRoutes.get('/:id/attachments', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await attachments.listAttachments(requestContext(req), 'project', id(req)));
});
projectRoutes.post('/:id/attachments', validate({ params: idParams }), async (req, res) => {
  await handleUpload(req, res);
  sendCreated(
    res,
    await attachments.uploadAttachment(requestContext(req), 'project', id(req), req.file),
  );
});

mountProjectPlanningRoutes(projectRoutes);
mountProjectAgileRoutes(projectRoutes);
mountProjectWorkflowRoutes(projectRoutes);
mountProjectSecurityRoutes(projectRoutes);

/* ============================ Tasks ============================ */

export const taskRoutes = Router();
taskRoutes.use(authenticate, authorize('task:read'));

taskRoutes.get('/', validate({ query: taskListQuerySchema.strict() }), async (req, res) => {
  const { items, meta } = await tasks.listTasks(requestContext(req), query(req));
  sendPage(res, items, meta);
});
taskRoutes.get('/board', validate({ query: boardQuerySchema.strict() }), async (req, res) => {
  sendOk(res, await tasks.getBoard(requestContext(req), query(req)));
});
taskRoutes.post(
  '/',
  authorize('task:create'),
  validate({ body: createTaskSchema }),
  async (req, res) => {
    sendCreated(res, await tasks.createTask(requestContext(req), body(req)));
  },
);
taskRoutes.patch(
  '/bulk',
  authorize('task:update'),
  validate({ body: bulkTaskSchema }),
  async (req, res) => {
    sendOk(res, await tasks.bulkUpdate(requestContext(req), body(req)));
  },
);
taskRoutes.post(
  '/bulk-delete',
  authorize('task:delete'),
  validate({ body: bulkDeleteSchema }),
  async (req, res) => {
    sendOk(res, await tasks.bulkDelete(requestContext(req), body<{ ids: string[] }>(req).ids));
  },
);
mountTaskAgileRoutes(taskRoutes);
mountTaskGitRoutes(taskRoutes);
mountTaskWorkflowRoutes(taskRoutes);
mountTaskSecurityRoutes(taskRoutes);
mountTaskWebLinkRoutes(taskRoutes);
taskRoutes.get('/:id', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await tasks.getTask(requestContext(req), id(req)));
});
taskRoutes.patch(
  '/:id',
  authorize('task:update'),
  validate({ params: idParams, body: updateTaskSchema }),
  async (req, res) => {
    sendOk(res, await tasks.updateTask(requestContext(req), id(req), body(req)));
  },
);
taskRoutes.post(
  '/:id/move',
  authorize('task:update'),
  validate({ params: idParams, body: moveTaskSchema }),
  async (req, res) => {
    sendOk(res, await tasks.moveTask(requestContext(req), id(req), body(req)));
  },
);
taskRoutes.delete(
  '/:id',
  authorize('task:delete'),
  validate({ params: idParams }),
  async (req, res) => {
    await tasks.deleteTask(requestContext(req), id(req));
    sendNoContent(res);
  },
);
taskRoutes.post('/:id/watch', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await tasks.setWatching(requestContext(req), id(req), true));
});
taskRoutes.delete('/:id/watch', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await tasks.setWatching(requestContext(req), id(req), false));
});
taskRoutes.get(
  '/:id/activity',
  validate({ params: idParams, query: pageQuery }),
  async (req, res) => {
    const { task } = await tasks.loadTaskForCollab(requireAuth(requestContext(req)), id(req));
    const { items, meta } = await listActivity(
      { entityType: 'task', entityId: task._id },
      query(req),
    );
    sendPage(res, items, meta);
  },
);
taskRoutes.get('/:id/comments', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await comments.listComments(requestContext(req), id(req)));
});
taskRoutes.post(
  '/:id/comments',
  validate({ params: idParams, body: commentSchema }),
  async (req, res) => {
    sendCreated(res, await comments.addComment(requestContext(req), id(req), body(req)));
  },
);
taskRoutes.get('/:id/attachments', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await attachments.listAttachments(requestContext(req), 'task', id(req)));
});
taskRoutes.post('/:id/attachments', validate({ params: idParams }), async (req, res) => {
  await handleUpload(req, res);
  sendCreated(
    res,
    await attachments.uploadAttachment(requestContext(req), 'task', id(req), req.file),
  );
});

/* ============================ Comments & attachments by id ============================ */

export const commentRoutes = Router();
commentRoutes.use(authenticate);
commentRoutes.patch(
  '/:id',
  validate({ params: idParams, body: updateCommentSchema }),
  async (req, res) => {
    sendOk(
      res,
      await comments.editComment(requestContext(req), id(req), body<{ body: string }>(req).body),
    );
  },
);
commentRoutes.delete('/:id', validate({ params: idParams }), async (req, res) => {
  await comments.deleteComment(requestContext(req), id(req));
  sendNoContent(res);
});

export const attachmentRoutes = Router();
attachmentRoutes.use(authenticate);
attachmentRoutes.get('/:id/download', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await attachments.downloadUrl(requestContext(req), id(req)));
});
attachmentRoutes.delete('/:id', validate({ params: idParams }), async (req, res) => {
  await attachments.deleteAttachment(requestContext(req), id(req));
  sendNoContent(res);
});

/* ============================ Saved views (per user) ============================ */

export const savedViewRoutes = Router();
savedViewRoutes.use(authenticate);
savedViewRoutes.get(
  '/',
  validate({ query: z.strictObject({ module: z.enum(['tasks']) }) }),
  async (req, res) => {
    const auth = requireAuth(requestContext(req));
    const views = await SavedView.find({
      userId: auth.userObjectId,
      module: query<{ module: 'tasks' }>(req).module,
    })
      .sort({ name: 1 })
      .lean();
    sendOk(
      res,
      views.map((v) => ({
        id: v._id.toString(),
        module: v.module,
        name: v.name,
        view: v.view,
        filters: v.filters,
        createdAt: v.createdAt.toISOString(),
      })),
    );
  },
);
savedViewRoutes.post('/', validate({ body: savedViewSchema }), async (req, res) => {
  const auth = requireAuth(requestContext(req));
  const input = body<z.infer<typeof savedViewSchema>>(req);
  if ((await SavedView.countDocuments({ userId: auth.userObjectId })) >= 50)
    throw new UnprocessableError('You can keep up to 50 saved views');
  try {
    const v = await new SavedView({
      userId: auth.userObjectId,
      module: input.module,
      name: input.name,
      view: input.view,
      filters: input.filters,
    }).save();
    sendCreated(res, {
      id: v._id.toString(),
      module: v.module,
      name: v.name,
      view: v.view,
      filters: v.filters,
      createdAt: v.createdAt.toISOString(),
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000)
      throw new ConflictError('You already have a view with this name');
    throw err;
  }
});
savedViewRoutes.delete('/:id', validate({ params: idParams }), async (req, res) => {
  const auth = requireAuth(requestContext(req));
  const result = await SavedView.deleteOne({
    _id: new Types.ObjectId(id(req)),
    userId: auth.userObjectId,
  });
  if (result.deletedCount === 0) throw new NotFoundError('Saved view');
  sendNoContent(res);
});
