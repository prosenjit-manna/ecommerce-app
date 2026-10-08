import type { MailMessage } from '../mailer.js';

type OtpPurpose = 'email_verify' | 'login' | 'password_reset';

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(title: string, body: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;color:#111">
<h2 style="margin-top:0">${escape(title)}</h2>${body}
<p style="color:#666;font-size:12px;margin-top:32px">If this wasn't you, you can ignore this email or reset your password.</p>
</body></html>`;
}

const OTP_COPY: Record<OtpPurpose, { subject: string; intro: string }> = {
  email_verify: { subject: 'Verify your email', intro: 'Use this code to verify your email address:' },
  login: { subject: 'Your login code', intro: 'Use this code to finish signing in:' },
  password_reset: { subject: 'Reset your password', intro: 'Use this code to reset your password:' },
};

export function otpEmail(to: string, purpose: OtpPurpose, code: string, ttlMinutes: number): MailMessage {
  const copy = OTP_COPY[purpose];
  return {
    to,
    subject: `${copy.subject}: ${code}`,
    text: `${copy.intro}\n\n${code}\n\nThe code expires in ${ttlMinutes} minutes. Never share it with anyone.`,
    html: layout(
      copy.subject,
      `<p>${copy.intro}</p>
<p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:24px 0">${code}</p>
<p>The code expires in ${ttlMinutes} minutes. Never share it with anyone.</p>`,
    ),
  };
}

export function passwordChangedEmail(to: string): MailMessage {
  return {
    to,
    subject: 'Your password was changed',
    text: 'Your password was just changed, and every device was signed out.',
    html: layout('Your password was changed', '<p>Your password was just changed, and every device was signed out.</p>'),
  };
}

export interface NewDeviceDetails {
  deviceName: string | null;
  location: string | null;
  ip: string | null;
  at: Date;
}

export function newDeviceLoginEmail(to: string, d: NewDeviceDetails): MailMessage {
  const rows: [string, string][] = [
    ['Device', d.deviceName ?? 'Unknown device'],
    ['Location', d.location ?? 'Unknown'],
    ['IP address', d.ip ?? 'Unknown'],
    ['Time', d.at.toUTCString()],
  ];
  return {
    to,
    subject: 'New sign-in to your account',
    text: `We noticed a sign-in from a new device.\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nIf this wasn't you, reset your password and sign out other devices.`,
    html: layout(
      'New sign-in to your account',
      `<p>We noticed a sign-in from a new device.</p>
<table cellpadding="4">${rows.map(([k, v]) => `<tr><td><b>${k}</b></td><td>${escape(v)}</td></tr>`).join('')}</table>
<p>If this wasn't you, reset your password and sign out other devices.</p>`,
    ),
  };
}
