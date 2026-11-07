import nodemailer, { type Transporter } from 'nodemailer';
import { env } from './env';

let transporter: Transporter | null = null;

/** SMTP transport (company relay in production, Mailpit in development). */
export function getMailer(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined,
  });
  return transporter;
}

export interface MailMessage {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  /** Small files (reports). Content is base64 so the message can travel through the queue. */
  attachments?: { filename: string; contentBase64: string; contentType: string }[];
}

export async function sendMail(message: MailMessage): Promise<void> {
  const { attachments, ...rest } = message;
  await getMailer().sendMail({
    from: env.MAIL_FROM,
    ...rest,
    ...(attachments?.length
      ? {
          attachments: attachments.map((a) => ({
            filename: a.filename,
            content: Buffer.from(a.contentBase64, 'base64'),
            contentType: a.contentType,
          })),
        }
      : {}),
  });
}
