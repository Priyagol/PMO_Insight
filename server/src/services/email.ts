import { logger } from '../config/logger';
import type { MailMessage } from '../config/mail';
import { getQueue } from '../jobs/queues';

export type EmailTransport = (message: MailMessage) => Promise<void>;

/** Default transport: enqueue on BullMQ; the worker process delivers via SMTP with retries. */
const queueTransport: EmailTransport = async (message) => {
  await getQueue('email').add('send', message);
};

let transport: EmailTransport = queueTransport;

/** Replaces the transport (integration tests capture messages instead of using Redis). */
export function setEmailTransport(next: EmailTransport | null): void {
  transport = next ?? queueTransport;
}

/**
 * Queues an e-mail. Returns false (and logs) when queueing fails so the business action
 * that triggered it is not rolled back; callers surface the failure to the user.
 */
export async function sendEmail(message: MailMessage): Promise<boolean> {
  try {
    await transport(message);
    return true;
  } catch (err) {
    logger.error({ err, subject: message.subject }, 'Failed to queue e-mail');
    return false;
  }
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

function layout(
  title: string,
  paragraphs: string[],
  action?: { label: string; url: string },
): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px">${escapeHtml(p)}</p>`).join('');
  const button = action
    ? `<p style="margin:22px 0"><a href="${escapeHtml(action.url)}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(action.label)}</a></p>
       <p style="margin:0 0 14px;font-size:12px;color:#64748b">If the button does not work, copy this link into your browser:<br>${escapeHtml(action.url)}</p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f7f8fa;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:24px auto;background:#fff;border:1px solid #e4e8ef;border-radius:12px;padding:28px">
    <p style="margin:0 0 18px;font-weight:700;color:#0f1b33">Arihant Workspace</p>
    <h1 style="font-size:18px;margin:0 0 16px">${escapeHtml(title)}</h1>${body}${button}
    <p style="margin:24px 0 0;font-size:12px;color:#64748b">This is an automated message from Arihant Workspace.</p>
  </div></body></html>`;
}

export const emailTemplates = {
  invite(name: string, url: string, hours: number): Omit<MailMessage, 'to'> {
    const lines = [
      `Hello ${name},`,
      'An account has been created for you on Arihant Workspace, the work and project platform of Arihant Capitals.',
      `Set your password to activate it. This link expires in ${hours} hours.`,
    ];
    return {
      subject: 'Activate your Arihant Workspace account',
      text: `${lines.join('\n\n')}\n\n${url}`,
      html: layout('Activate your account', lines, { label: 'Set your password', url }),
    };
  },
  passwordReset(name: string, url: string, minutes: number): Omit<MailMessage, 'to'> {
    const lines = [
      `Hello ${name},`,
      `We received a request to reset your Arihant Workspace password. This link expires in ${minutes} minutes.`,
      'If you did not request this, you can ignore this e-mail; your password will not change.',
    ];
    return {
      subject: 'Reset your Arihant Workspace password',
      text: `${lines.join('\n\n')}\n\n${url}`,
      html: layout('Reset your password', lines, { label: 'Reset password', url }),
    };
  },
  passwordChanged(name: string): Omit<MailMessage, 'to'> {
    const lines = [
      `Hello ${name},`,
      'Your Arihant Workspace password was just changed and all other sessions were signed out.',
      'If you did not make this change, contact your administrator immediately.',
    ];
    return {
      subject: 'Your password was changed',
      text: lines.join('\n\n'),
      html: layout('Password changed', lines),
    };
  },
};

export const emailTemplatesPhase4 = {
  timesheetReminder(name: string, weekStart: string): Omit<MailMessage, 'to'> {
    const lines = [
      `Hello ${name},`,
      `Your timesheet for the week starting ${weekStart} has not been submitted yet.`,
      'Please review your work logs and submit the timesheet for approval.',
    ];
    return {
      subject: `Timesheet reminder: week of ${weekStart}`,
      text: lines.join('\n\n'),
      html: layout('Timesheet reminder', lines),
    };
  },
};

/** Generic notification e-mail (Phase 6). Text is escaped by the layout. */
export function notificationEmail(
  name: string,
  title: string,
  body: string | undefined,
  url: string,
): Omit<MailMessage, 'to'> {
  const lines = [`Hello ${name},`, title, ...(body ? [body] : [])];
  return {
    subject: title.length > 120 ? `${title.slice(0, 117)}...` : title,
    text: [
      ...lines,
      `Open: ${url}`,
      'You can change which e-mails you receive in Notification settings.',
    ].join('\n\n'),
    html: layout(
      title,
      [...lines, 'You can change which e-mails you receive in Notification settings.'],
      {
        label: 'Open in Arihant Workspace',
        url,
      },
    ),
  };
}
