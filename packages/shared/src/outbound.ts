import { z } from 'zod';
import { objectIdSchema, withoutDefaults } from './api';

/*
 * Outgoing integrations (Jira group F): signed JSON webhooks (Zapier, Jenkins, Azure DevOps,
 * Power Automate or any custom receiver) and channel messages for Slack and Microsoft Teams.
 */

export const HOOK_KINDS = ['webhook', 'slack', 'teams'] as const;
export type HookKind = (typeof HOOK_KINDS)[number];
export const HOOK_KIND_LABELS: Record<HookKind, string> = {
  webhook: 'Webhook (signed JSON)',
  slack: 'Slack channel',
  teams: 'Microsoft Teams channel',
};

/** Events that can be sent out. */
export const HOOK_EVENTS = [
  'task.created',
  'task.status_changed',
  'task.assigned',
  'comment.created',
  'project.created',
  'project.status_changed',
  'risk.critical',
  'risk.escalated',
] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];
export const HOOK_EVENT_LABELS: Record<HookEvent, string> = {
  'task.created': 'Task created',
  'task.status_changed': 'Task status changed',
  'task.assigned': 'Task assigned',
  'comment.created': 'Comment added',
  'project.created': 'Project created',
  'project.status_changed': 'Project status changed',
  'risk.critical': 'Critical risk raised',
  'risk.escalated': 'Risk escalated',
};

const url = z
  .string()
  .trim()
  .max(1000)
  .url('Enter the full address, starting with https://')
  .refine((u) => /^https?:\/\//i.test(u), 'Use an http(s) address');

export const outboundHookSchema = z.strictObject({
  name: z.string().trim().min(1, 'Name it').max(80),
  kind: z.enum(HOOK_KINDS),
  url,
  events: z.array(z.enum(HOOK_EVENTS)).min(1, 'Choose at least one event').max(HOOK_EVENTS.length),
  /** Only events from these projects; empty = all projects. */
  projectIds: z.array(objectIdSchema).max(50).default([]),
  active: z.boolean().default(true),
});
export type OutboundHookInput = z.input<typeof outboundHookSchema>;
export const updateOutboundHookSchema = z
  .strictObject(withoutDefaults(outboundHookSchema.shape))
  .partial();

export interface OutboundHookDto {
  id: string;
  name: string;
  kind: HookKind;
  /** Shown shortened: these addresses often contain a secret. */
  urlPreview: string;
  events: HookEvent[];
  projects: { id: string; key: string }[];
  active: boolean;
  /** Set when the hook was switched off after repeated failures. */
  disabledReason: string | null;
  consecutiveFailures: number;
  lastDelivery: { at: string; status: DeliveryStatus; httpStatus: number | null } | null;
  createdAt: string;
}

export interface CreatedOutboundHookDto extends OutboundHookDto {
  /** Signing secret for webhooks, shown once (X-Arihant-Signature: sha256=…). */
  secret: string | null;
}

export const DELIVERY_STATUSES = ['pending', 'delivered', 'failed'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export interface HookDeliveryDto {
  id: string;
  event: string;
  status: DeliveryStatus;
  attempts: number;
  httpStatus: number | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
  nextAttemptAt: string | null;
}

/* ---------- Web links on tasks (Figma, Confluence, Google Drive, …) ---------- */

export const WEB_LINK_PROVIDERS = [
  'figma',
  'confluence',
  'google_drive',
  'sharepoint',
  'jenkins',
  'azure_devops',
  'gitlab',
  'bitbucket',
  'github',
  'other',
] as const;
export type WebLinkProvider = (typeof WEB_LINK_PROVIDERS)[number];
export const WEB_LINK_PROVIDER_LABELS: Record<WebLinkProvider, string> = {
  figma: 'Figma',
  confluence: 'Confluence',
  google_drive: 'Google Drive',
  sharepoint: 'SharePoint / OneDrive',
  jenkins: 'Jenkins',
  azure_devops: 'Azure DevOps',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
  github: 'GitHub',
  other: 'Link',
};

/** Recognises the tool from the address. */
export function detectWebLinkProvider(href: string): WebLinkProvider {
  const m = /^https?:\/\/(?:[^@/]*@)?([^/:?#]+)(?::\d+)?([^?#]*)/i.exec(href.trim());
  if (!m) return 'other';
  const host = m[1]!.toLowerCase();
  const path = (m[2] ?? '').toLowerCase();
  if (host.endsWith('figma.com')) return 'figma';
  if (host.endsWith('atlassian.net') && path.startsWith('/wiki')) return 'confluence';
  if (host.includes('confluence')) return 'confluence';
  if (host === 'docs.google.com' || host === 'drive.google.com') return 'google_drive';
  if (host.endsWith('sharepoint.com') || host.endsWith('onedrive.live.com')) return 'sharepoint';
  if (host.includes('jenkins')) return 'jenkins';
  if (host === 'dev.azure.com' || host.endsWith('visualstudio.com')) return 'azure_devops';
  if (host.endsWith('gitlab.com') || host.includes('gitlab')) return 'gitlab';
  if (host.endsWith('bitbucket.org')) return 'bitbucket';
  if (host.endsWith('github.com')) return 'github';
  return 'other';
}

export const webLinkSchema = z.strictObject({
  url: url.refine((u) => /^https:\/\//i.test(u), 'Use an https:// address'),
  title: z.string().trim().max(200).optional(),
});
export type WebLinkInput = z.input<typeof webLinkSchema>;

export interface WebLinkDto {
  id: string;
  url: string;
  title: string;
  provider: WebLinkProvider;
  addedBy: { id: string; name: string } | null;
  createdAt: string;
}
