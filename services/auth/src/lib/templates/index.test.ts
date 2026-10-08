import { describe, expect, it } from '@jest/globals';
import { newDeviceLoginEmail, otpEmail, passwordChangedEmail } from './index.js';

describe('email templates', () => {
  it('puts the code in the OTP subject and body, with a purpose-specific subject', () => {
    const mail = otpEmail('jane@example.com', 'login', '042917', 10);
    expect(mail.subject).toBe('Your login code: 042917');
    expect(mail.text).toContain('042917');
    expect(mail.html).toContain('042917');
    expect(otpEmail('a@b.c', 'password_reset', '111111', 10).subject).toMatch(/^Reset your password/);
    expect(otpEmail('a@b.c', 'email_verify', '111111', 10).subject).toMatch(/^Verify your email/);
  });

  it('escapes untrusted values in the new-device email', () => {
    const mail = newDeviceLoginEmail('jane@example.com', {
      deviceName: '<script>alert(1)</script>',
      location: null,
      ip: null,
      at: new Date('2026-10-08T10:00:00Z'),
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.text).toContain('Location: Unknown');
  });

  it('tells the user every device was signed out after a password change', () => {
    expect(passwordChangedEmail('jane@example.com').text).toContain('every device was signed out');
  });
});
