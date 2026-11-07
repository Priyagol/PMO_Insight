import express, { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { gitSettingsSchema, objectIdSchema } from '@arihant/shared';
import { BadRequestError } from '../../core/errors';
import { sendOk } from '../../core/http';
import { requestContext } from '../../core/rbac/context';
import { authenticate, authorize } from '../../middleware/auth';
import { webhookLimiter } from '../../middleware/rate-limit';
import { validate } from '../../middleware/validate';
import {
  handleGithubEvent,
  verifySignature,
  WEBHOOK_PATH,
  BITBUCKET_WEBHOOK_PATH,
  GITLAB_WEBHOOK_PATH,
  fromBitbucket,
  fromGitlab,
  handleProviderEvent,
  verifyBitbucketSignature,
  verifyGitlabToken,
  getGitSettings,
  listTaskGitLinks,
  saveGitSettings,
} from './git.service';

/**
 * GitHub webhook. Mounted before the JSON body parser: the signature is checked against the raw
 * bytes. No user session; authenticity comes from the shared secret (X-Hub-Signature-256).
 */
export function mountGithubWebhook(app: express.Express): void {
  app.post(
    WEBHOOK_PATH,
    webhookLimiter,
    express.raw({ type: 'application/json', limit: '5mb' }),
    async (req: Request, res: Response) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      verifySignature(raw, req.get('x-hub-signature-256'));
      const event = req.get('x-github-event');
      const delivery = req.get('x-github-delivery');
      if (!event || !delivery) throw new BadRequestError('Missing GitHub event headers');
      let payload: unknown;
      try {
        payload = JSON.parse(raw.toString('utf8'));
      } catch {
        throw new BadRequestError(
          'The payload must be JSON (set the webhook content type to application/json)',
        );
      }
      sendOk(
        res,
        await handleGithubEvent(
          event,
          delivery.slice(0, 100),
          payload,
          req.get('x-request-id') ?? undefined,
        ),
      );
    },
  );
}

const parseJson = (raw: Buffer): unknown => {
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new BadRequestError('The payload must be JSON');
  }
};

/** GitLab and Bitbucket webhooks: same rules and allow-list as GitHub, their own secrets. */
export function mountGitProviderWebhooks(app: express.Express): void {
  const raw = express.raw({ type: 'application/json', limit: '5mb' });
  app.post(GITLAB_WEBHOOK_PATH, webhookLimiter, raw, async (req: Request, res: Response) => {
    verifyGitlabToken(req.get('x-gitlab-token'));
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const delivery = req.get('x-gitlab-event-uuid') ?? req.get('x-gitlab-webhook-uuid');
    if (!delivery) throw new BadRequestError('Missing GitLab event headers');
    const n = fromGitlab(req.get('x-gitlab-event') ?? '', parseJson(body));
    sendOk(
      res,
      await handleProviderEvent(
        'gitlab',
        n,
        delivery.slice(0, 100),
        req.get('x-request-id') ?? undefined,
      ),
    );
  });
  app.post(BITBUCKET_WEBHOOK_PATH, webhookLimiter, raw, async (req: Request, res: Response) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    verifyBitbucketSignature(body, req.get('x-hub-signature'));
    const delivery = req.get('x-request-uuid') ?? req.get('x-hook-uuid');
    const eventKey = req.get('x-event-key');
    if (!delivery || !eventKey) throw new BadRequestError('Missing Bitbucket event headers');
    const n = fromBitbucket(eventKey, parseJson(body));
    sendOk(
      res,
      await handleProviderEvent(
        'bitbucket',
        n,
        delivery.slice(0, 100),
        req.get('x-request-id') ?? undefined,
      ),
    );
  });
}

/** /integrations/github: settings for administrators, status for everyone signed in. */
export const integrationRoutes = Router();
integrationRoutes.use(authenticate);
integrationRoutes.get('/github', async (req, res) => {
  sendOk(res, await getGitSettings(requestContext(req)));
});
integrationRoutes.put(
  '/github',
  authorize('settings:manage'),
  validate({ body: gitSettingsSchema }),
  async (req, res) => {
    sendOk(res, await saveGitSettings(requestContext(req), req.valid!.body));
  },
);

/** GET /tasks/:id/git: commits and pull requests that mention the task. */
export function mountTaskGitRoutes(router: Router): void {
  router.get(
    '/:id/git',
    validate({ params: z.object({ id: objectIdSchema }) }),
    async (req, res) => {
      sendOk(
        res,
        await listTaskGitLinks(requestContext(req), (req.valid!.params as { id: string }).id),
      );
    },
  );
}
