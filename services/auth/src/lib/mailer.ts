import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from './logger.js';

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } } : {}),
});

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Sends inline for now (the caller awaits it). Later this moves to a BullMQ job or the
 * notifications service via SNS, so a slow SMTP server never slows down login.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  try {
    await transport.sendMail({ from: env.MAIL_FROM, ...message });
  } catch (err) {
    // Don't fail the auth flow because email is down; the user can press "resend".
    logger.error({ err, to: message.to, subject: message.subject }, 'Failed to send email');
  }
}
