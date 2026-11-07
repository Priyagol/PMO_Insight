import { Router } from 'express';
import { z } from 'zod';
import {
  auditQuerySchema,
  objectIdSchema,
  orgSettingsSchema,
  paginationQuerySchema,
  type AuditQuery,
  type OrgSettings,
} from '@arihant/shared';
import { sendOk, sendPage } from '../../core/http';
import { requestContext } from '../../core/rbac/context';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { listAuditLogs } from '../audit/audit.service';
import { listLoginHistory } from '../auth/auth.service';
import { getOrgSettings, updateOrgSettings } from '../settings/settings.service';
import { Skill } from '../skills/skill.model';

/* ---------- Audit logs & login history (read-only by design) ---------- */

export const auditRoutes = Router();
auditRoutes.use(authenticate, authorize('audit:read', 'org'));

auditRoutes.get('/', validate({ query: auditQuerySchema.strict() }), async (req, res) => {
  const { items, meta } = await listAuditLogs(req.valid!.query as AuditQuery);
  sendPage(res, items, meta);
});

const loginHistoryQuery = paginationQuerySchema
  .extend({
    userId: objectIdSchema.optional(),
    success: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  })
  .strict();

auditRoutes.get('/logins', validate({ query: loginHistoryQuery }), async (req, res) => {
  const { items, meta } = await listLoginHistory(
    req.valid!.query as z.infer<typeof loginHistoryQuery>,
  );
  sendPage(res, items, meta);
});

/* ---------- Organisation settings ---------- */

export const settingsRoutes = Router();
settingsRoutes.use(authenticate);
// Readable by every signed-in user: the client needs timezone and working days.
settingsRoutes.get('/', async (_req, res) => {
  sendOk(res, await getOrgSettings());
});
settingsRoutes.put(
  '/',
  authorize('settings:manage', 'org'),
  validate({ body: orgSettingsSchema }),
  async (req, res) => {
    sendOk(res, await updateOrgSettings(requestContext(req), req.valid!.body as OrgSettings));
  },
);

/* ---------- Skills catalogue ---------- */

export const skillRoutes = Router();
skillRoutes.use(authenticate);
skillRoutes.get(
  '/',
  validate({ query: z.strictObject({ q: z.string().trim().max(60).optional() }) }),
  async (req, res) => {
    const q = (req.valid!.query as { q?: string }).q;
    const filter = q
      ? { normalized: new RegExp(`^${q.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }
      : {};
    const skills = await Skill.find(filter).sort({ name: 1 }).limit(50).lean();
    sendOk(
      res,
      skills.map((s) => s.name),
    );
  },
);
