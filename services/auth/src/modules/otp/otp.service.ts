import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import type { DeviceSnapshot } from '../../db/schema.js';
import { hmacSha256, randomNumericCode, safeEqualHex } from '../../lib/crypto.js';
import { sendMail } from '../../lib/mailer.js';
import { consume } from '../../lib/rate-limit.js';
import type { ClientInfo } from '../../lib/request-context.js';
import { Result } from '../../lib/results.js';
import { otpEmail } from '../../lib/templates/index.js';
import { authEventsRepository } from '../events/auth-events.repository.js';
import { otpRepository, type OtpChallengeRow } from './otp.repository.js';

type Purpose = OtpChallengeRow['purpose'];

/**
 * The code is HMAC'd with a server-side pepper and bound to its challenge id.
 * A 6-digit code has only 1M possibilities, so a plain hash could be brute-forced offline from a DB dump.
 */
const hashCode = (challengeId: string, code: string) => hmacSha256(env.OTP_PEPPER, `${challengeId}:${code}`);

/** "john.doe@example.com" → "j******e@example.com" */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (local.length <= 2) return `${local[0] ?? ''}*@${domain}`;
  return `${local[0]}${'*'.repeat(Math.min(local.length - 2, 6))}${local.at(-1)}@${domain}`;
}

/** GraphQL shape of a challenge (the `OtpChallenge` union member). */
export function toOtpChallenge(c: OtpChallengeRow) {
  return {
    __typename: 'OtpChallenge' as const,
    challengeId: c.id,
    purpose: c.purpose.toUpperCase() as 'EMAIL_VERIFY' | 'LOGIN' | 'PASSWORD_RESET',
    maskedEmail: maskEmail(c.email),
    expiresAt: c.expiresAt,
    resendAvailableAt: new Date(c.lastSentAt.getTime() + env.OTP_RESEND_COOLDOWN_SECONDS * 1000),
  };
}

export type VerifiedChallenge = OtpChallengeRow & { userId: string };

export const otpService = {
  /**
   * Creates a challenge and emails the code. With `userId: null` (password reset for an unknown
   * email) nothing is sent and the challenge can never verify, but the caller gets the same response.
   */
  async start(input: {
    userId: string | null;
    email: string;
    purpose: Purpose;
    client: ClientInfo;
    device?: DeviceSnapshot | null;
  }): Promise<OtpChallengeRow> {
    const id = randomUUID();
    const code = randomNumericCode(6);
    const challenge = await otpRepository.create({
      id,
      userId: input.userId,
      email: input.email,
      purpose: input.purpose,
      codeHash: hashCode(id, code),
      maxAttempts: env.OTP_MAX_ATTEMPTS,
      expiresAt: new Date(Date.now() + env.OTP_TTL_SECONDS * 1000),
      ip: input.client.ip,
      device: input.device ?? null,
    });

    if (input.userId) {
      await sendMail(otpEmail(input.email, input.purpose, code, Math.round(env.OTP_TTL_SECONDS / 60)));
      await authEventsRepository.record({
        type: 'otp_sent',
        client: input.client,
        userId: input.userId,
        email: input.email,
        metadata: { purpose: input.purpose, challengeId: id },
      });
    }
    return challenge;
  },

  /** Checks a code. Every wrong guess burns one of the challenge's attempts. */
  async verify(input: { challengeId: string; code: string; purpose: Purpose; client: ClientInfo }) {
    const c = await otpRepository.findById(input.challengeId);
    if (!c || c.purpose !== input.purpose || c.consumedAt || c.expiresAt <= new Date()) {
      return Result.otpExpired();
    }
    if (c.attempts >= c.maxAttempts) return Result.invalidOtp(0);

    const matches = safeEqualHex(hashCode(c.id, input.code), c.codeHash);
    if (!matches || !c.userId) {
      const attempts = await otpRepository.incrementAttempts(c.id);
      await authEventsRepository.record({
        type: 'otp_failed',
        client: input.client,
        userId: c.userId,
        email: c.email,
        metadata: { purpose: c.purpose, challengeId: c.id, attempts },
      });
      return Result.invalidOtp(Math.max(0, c.maxAttempts - attempts));
    }

    // Only one request can consume a code, even if two arrive at the same moment.
    if (!(await otpRepository.consume(c.id))) return Result.otpExpired();
    return { __typename: 'Verified' as const, challenge: c as VerifiedChallenge };
  },

  /** New code on the same challenge: cooldown between sends and a cap on the total. */
  async resend(input: { challengeId: string; client: ClientInfo }) {
    const c = await otpRepository.findById(input.challengeId);
    if (!c || c.consumedAt) return Result.otpExpired();
    if (c.sendCount >= env.OTP_MAX_SENDS) return Result.rateLimited(Math.max(1, secondsUntil(c.expiresAt)));

    const cooldownLeft = secondsUntil(new Date(c.lastSentAt.getTime() + env.OTP_RESEND_COOLDOWN_SECONDS * 1000));
    if (cooldownLeft > 0) return Result.rateLimited(cooldownLeft);

    // Hourly cap per inbox across all challenges, so opening new challenges can't dodge it.
    const perEmail = await consume('otpSendEmail', c.email);
    if (!perEmail.ok) return Result.rateLimited(perEmail.retryAfterSeconds);

    const code = randomNumericCode(6);
    const updated = await otpRepository.resend(c.id, {
      codeHash: hashCode(c.id, code),
      expiresAt: new Date(Date.now() + env.OTP_TTL_SECONDS * 1000),
    });
    if (c.userId) {
      await sendMail(otpEmail(c.email, c.purpose, code, Math.round(env.OTP_TTL_SECONDS / 60)));
      await authEventsRepository.record({
        type: 'otp_sent',
        client: input.client,
        userId: c.userId,
        email: c.email,
        metadata: { purpose: c.purpose, challengeId: c.id, resend: true },
      });
    }
    return toOtpChallenge(updated);
  },
};

const secondsUntil = (d: Date) => Math.ceil((d.getTime() - Date.now()) / 1000);
