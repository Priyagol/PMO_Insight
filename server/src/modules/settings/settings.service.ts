import type { OrgSettings, OrgSettingsDto } from '@arihant/shared';
import { env } from '../../config/env';
import { requireAuth, type RequestContext } from '../../core/rbac/context';
import { recordAudit } from '../audit/audit.service';
import { Setting } from './settings.model';

const ORG_KEY = 'org';

/** Defaults reflect the documented assumptions (Mon–Fri, 8 h/day, 40 h/week, April fiscal year). */
export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  organizationName: 'Arihant Capitals',
  timezone: env.ORG_TIMEZONE,
  workingDays: [1, 2, 3, 4, 5],
  workingHoursPerDay: 8,
  defaultWeeklyCapacityHours: 40,
  fiscalYearStartMonth: 4,
};

export async function getOrgSettings(): Promise<OrgSettingsDto> {
  const doc = await Setting.findOne({ key: ORG_KEY }).lean();
  const value = {
    ...DEFAULT_ORG_SETTINGS,
    ...((doc?.value as Partial<OrgSettings> | undefined) ?? {}),
  };
  return { ...value, updatedAt: doc?.updatedAt.toISOString() };
}

export async function updateOrgSettings(
  rc: RequestContext,
  input: OrgSettings,
): Promise<OrgSettingsDto> {
  const auth = requireAuth(rc);
  const before = await getOrgSettings();
  const value: OrgSettings = { ...input, workingDays: [...new Set(input.workingDays)].sort() };
  await Setting.updateOne(
    { key: ORG_KEY },
    { $set: { value, updatedBy: auth.userObjectId } },
    { upsert: true },
  );
  const after = await getOrgSettings();
  await recordAudit(rc, {
    action: 'settings.updated',
    entityType: 'settings',
    summary: 'Updated organisation settings',
    before,
    after,
  });
  return after;
}
