import { Router, type Request } from 'express';
import type { Types } from 'mongoose';
import { z } from 'zod';
import {
  assignWorkflowSchema,
  createWorkflowSchema,
  objectIdSchema,
  updateWorkflowSchema,
} from '@arihant/shared';
import { sendCreated, sendNoContent, sendOk } from '../../core/http';
import { requestContext, requireAuth, type RequestContext } from '../../core/rbac/context';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { registerApprovalClosed, registerApprovalEffect } from '../approvals/approval.service';
import { notify } from '../notifications/notification.service';
import { Task } from '../tasks/task.model';
import { loadTask, updateTask } from '../tasks/task.service';
import * as workflows from './workflow.service';

const idParams = z.object({ id: objectIdSchema });
const id = (req: Request) => (req.valid!.params as { id: string }).id;

/** /workflows: the task workflow library. */
export const workflowRoutes = Router();
workflowRoutes.use(authenticate, authorize('project:read'));

workflowRoutes.get('/', async (req, res) => {
  sendOk(res, await workflows.listWorkflows(requestContext(req)));
});
workflowRoutes.post('/', validate({ body: createWorkflowSchema }), async (req, res) => {
  sendCreated(res, await workflows.createWorkflow(requestContext(req), req.valid!.body as never));
});
workflowRoutes.post('/validate', (req, res) => {
  sendOk(res, workflows.validateDefinition(req.body));
});
workflowRoutes.get('/:id', validate({ params: idParams }), async (req, res) => {
  sendOk(res, await workflows.getWorkflow(requestContext(req), id(req)));
});
workflowRoutes.patch(
  '/:id',
  validate({ params: idParams, body: updateWorkflowSchema }),
  async (req, res) => {
    sendOk(res, await workflows.updateWorkflow(requestContext(req), id(req), req.valid!.body));
  },
);
workflowRoutes.delete('/:id', validate({ params: idParams }), async (req, res) => {
  await workflows.deleteWorkflow(requestContext(req), id(req));
  sendNoContent(res);
});

/** PUT /projects/:id/workflow: switch a project's workflow. */
export function mountProjectWorkflowRoutes(router: Router): void {
  router.put(
    '/:id/workflow',
    validate({ params: idParams, body: assignWorkflowSchema }),
    async (req, res) => {
      sendOk(
        res,
        await workflows.assignWorkflow(requestContext(req), id(req), req.valid!.body as never),
      );
    },
  );
}

/** GET /tasks/:id/transitions and /tasks/:id/transitions/history. */
export function mountTaskWorkflowRoutes(router: Router): void {
  router.get('/:id/transitions', validate({ params: idParams }), async (req, res) => {
    const auth = requireAuth(requestContext(req));
    const { task, project } = await loadTask(auth, id(req));
    sendOk(res, await workflows.availableTransitions(auth, task, project));
  });
  router.get('/:id/transitions/history', validate({ params: idParams }), async (req, res) => {
    const auth = requireAuth(requestContext(req));
    const { task } = await loadTask(auth, id(req));
    sendOk(res, await workflows.transitionHistory(task));
  });
}

/* ---------- Approval of workflow moves ---------- */

async function tellRequester(taskId: Types.ObjectId, title: string, body: string) {
  const t = await Task.findById(taskId).select('key pendingTransition').lean();
  if (!t?.pendingTransition) return;
  await notify([t.pendingTransition.requestedBy], {
    type: 'task_status',
    title: `${t.key}: ${title}`,
    body,
    link: `/tasks/board?task=${taskId.toString()}`,
  });
}

registerApprovalEffect('task_transition', async (rc: RequestContext, approval) => {
  if (!approval.entityId) return;
  const task = await Task.findById(approval.entityId).lean();
  const pending = task?.pendingTransition;
  if (!task || !pending || !pending.approvalId.equals(approval._id)) return;
  try {
    await updateTask(
      rc,
      task._id.toString(),
      {
        status: pending.to,
        ...(pending.comment ? { transitionComment: pending.comment } : {}),
      },
      { via: 'approval', approved: true },
    );
  } catch (err) {
    // The task changed while waiting (for example a required field was cleared).
    await tellRequester(
      task._id,
      'approved, but the move could not be made',
      err instanceof Error ? err.message : 'The task no longer meets the workflow rules',
    );
    await Task.updateOne({ _id: task._id }, { $set: { pendingTransition: null } });
  }
});

registerApprovalClosed('task_transition', async (_rc, approval, outcome) => {
  if (!approval.entityId) return;
  await tellRequester(
    approval.entityId,
    `status change ${outcome}`,
    `${approval.key}: the task stays where it is.`,
  );
  await Task.updateOne(
    { _id: approval.entityId, 'pendingTransition.approvalId': approval._id },
    { $set: { pendingTransition: null } },
  );
});
