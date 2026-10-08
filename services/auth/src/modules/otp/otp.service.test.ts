import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { hmacSha256 } from '../../lib/crypto.js';
import type { OtpChallengeRow } from './otp.repository.js';
import { type AnyFn, challenge, client, src } from '../../../test/helpers/fixtures.js';

const repo = {
  create: jest.fn<AnyFn>(async (data: Partial<OtpChallengeRow>) => challenge(data)),
  findById: jest.fn<AnyFn>(),
  incrementAttempts: jest.fn<AnyFn>(),
  consume: jest.fn<AnyFn>(),
  resend: jest.fn<AnyFn>(async (id: string, data: { codeHash: string; expiresAt: Date }) =>
    challenge({ id, ...data, sendCount: 2, lastSentAt: new Date() }),
  ),
};
const sendMail = jest.fn<AnyFn>(async () => {});
const record = jest.fn<AnyFn>(async () => {});
const consume = jest.fn<AnyFn>(async () => ({ ok: true }) as { ok: true } | { ok: false; retryAfterSeconds: number });

jest.unstable_mockModule(src('modules/otp/otp.repository.ts'), () => ({ otpRepository: repo }));
jest.unstable_mockModule(src('lib/mailer.ts'), () => ({ sendMail }));
jest.unstable_mockModule(src('modules/events/auth-events.repository.ts'), () => ({
  authEventsRepository: { record },
}));
jest.unstable_mockModule(src('lib/rate-limit.ts'), () => ({ consume }));

const { otpService, maskEmail, toOtpChallenge } = await import('./otp.service.js');

/** Starts a challenge and returns the stored row plus the code that was "emailed". */
async function startChallenge(overrides: { userId?: string | null; purpose?: OtpChallengeRow['purpose'] } = {}) {
  await otpService.start({
    userId: overrides.userId === undefined ? 'user-1' : overrides.userId,
    email: 'jane@example.com',
    purpose: overrides.purpose ?? 'login',
    client: client(),
  });
  const row = challenge(repo.create.mock.calls.at(-1)![0]);
  const code = sendMail.mock.calls.at(-1)?.[0].subject.match(/(\d{6})$/)?.[1];
  return { row, code };
}

beforeEach(() => {
  jest.clearAllMocks();
  consume.mockResolvedValue({ ok: true });
});

describe('maskEmail', () => {
  it.each([
    ['john.doe@example.com', 'j******e@example.com'],
    ['jo@example.com', 'j*@example.com'],
    ['abc@example.com', 'a*c@example.com'],
  ])('%s → %s', (email, masked) => expect(maskEmail(email)).toBe(masked));
});

describe('toOtpChallenge', () => {
  it('maps a row to the GraphQL shape with the resend time', () => {
    const c = challenge({ purpose: 'password_reset', lastSentAt: new Date('2026-10-08T10:00:00Z') });
    expect(toOtpChallenge(c)).toMatchObject({
      __typename: 'OtpChallenge',
      challengeId: c.id,
      purpose: 'PASSWORD_RESET',
      maskedEmail: 'j**e@example.com',
      resendAvailableAt: new Date('2026-10-08T10:01:00Z'),
    });
  });
});

describe('otpService.start', () => {
  it('stores only an HMAC of the code and emails the code', async () => {
    const { row, code } = await startChallenge();
    expect(code).toMatch(/^\d{6}$/);
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.codeHash).not.toContain(code!);
    expect(row).toMatchObject({ maxAttempts: 5, purpose: 'login', ip: '203.0.113.10' });
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ type: 'otp_sent' }));
  });

  it('sends nothing for a decoy challenge (unknown email on password reset)', async () => {
    await startChallenge({ userId: null, purpose: 'password_reset' });
    expect(sendMail).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});

describe('otpService.verify', () => {
  const verify = (c: OtpChallengeRow, code: string, purpose: OtpChallengeRow['purpose'] = c.purpose) => {
    repo.findById.mockResolvedValue(c);
    return otpService.verify({ challengeId: c.id, code, purpose, client: client() });
  };

  it('accepts the emailed code once', async () => {
    const { row, code } = await startChallenge();
    repo.consume.mockResolvedValue(true);
    await expect(verify(row, code!)).resolves.toEqual({ __typename: 'Verified', challenge: row });
    expect(repo.consume).toHaveBeenCalledWith(row.id);
  });

  it('returns OtpExpired when a parallel request consumed the code first', async () => {
    const { row, code } = await startChallenge();
    repo.consume.mockResolvedValue(false);
    await expect(verify(row, code!)).resolves.toMatchObject({ __typename: 'OtpExpired' });
  });

  it('counts a wrong code and reports the attempts left', async () => {
    const { row } = await startChallenge();
    repo.incrementAttempts.mockResolvedValue(1);
    await expect(verify(row, '000000')).resolves.toMatchObject({ __typename: 'InvalidOtp', attemptsRemaining: 4 });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ type: 'otp_failed' }));
  });

  it('refuses even the right code once all attempts are used', async () => {
    const { row, code } = await startChallenge();
    await expect(verify({ ...row, attempts: 5 }, code!)).resolves.toMatchObject({
      __typename: 'InvalidOtp',
      attemptsRemaining: 0,
    });
    expect(repo.consume).not.toHaveBeenCalled();
  });

  it('never verifies a decoy challenge, even with the right code', async () => {
    const { row } = await startChallenge({ userId: null, purpose: 'password_reset' });
    // Make the stored hash match '123456' exactly, the same way the service hashes codes.
    const decoy = { ...row, codeHash: hmacSha256(process.env.OTP_PEPPER!, `${row.id}:123456`) };
    repo.incrementAttempts.mockResolvedValue(1);
    await expect(verify(decoy, '123456')).resolves.toMatchObject({ __typename: 'InvalidOtp' });
    expect(repo.consume).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown challenge', undefined],
    ['already consumed', { consumedAt: new Date() }],
    ['expired', { expiresAt: new Date(Date.now() - 1000) }],
  ])('returns OtpExpired for an %s', async (_case, overrides) => {
    const { row, code } = await startChallenge();
    repo.findById.mockResolvedValue(overrides ? { ...row, ...overrides } : undefined);
    await expect(
      otpService.verify({ challengeId: row.id, code: code!, purpose: 'login', client: client() }),
    ).resolves.toMatchObject({ __typename: 'OtpExpired' });
  });

  it('does not accept a code for a different purpose', async () => {
    const { row, code } = await startChallenge({ purpose: 'login' });
    await expect(verify(row, code!, 'password_reset')).resolves.toMatchObject({ __typename: 'OtpExpired' });
  });
});

describe('otpService.resend', () => {
  const resend = (c: OtpChallengeRow | undefined) => {
    repo.findById.mockResolvedValue(c);
    return otpService.resend({ challengeId: c?.id ?? 'missing', client: client() });
  };

  it('sends a fresh code and resets the expiry', async () => {
    const c = challenge();
    const result = await resend(c);
    expect(result).toMatchObject({ __typename: 'OtpChallenge', challengeId: c.id });
    const [, data] = repo.resend.mock.calls[0]!;
    expect(data.codeHash).not.toBe(c.codeHash);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('enforces the cooldown between sends', async () => {
    const result = await resend(challenge({ lastSentAt: new Date(Date.now() - 20_000) }));
    expect(result).toMatchObject({ __typename: 'RateLimited' });
    expect((result as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThanOrEqual(39);
    expect(repo.resend).not.toHaveBeenCalled();
  });

  it('caps the number of sends per challenge', async () => {
    await expect(resend(challenge({ sendCount: 5 }))).resolves.toMatchObject({ __typename: 'RateLimited' });
  });

  it('applies the hourly per-email cap', async () => {
    consume.mockResolvedValue({ ok: false, retryAfterSeconds: 1200 });
    await expect(resend(challenge())).resolves.toMatchObject({ __typename: 'RateLimited', retryAfterSeconds: 1200 });
    expect(consume).toHaveBeenCalledWith('otpSendEmail', 'jane@example.com');
  });

  it('returns OtpExpired for unknown or used challenges', async () => {
    await expect(resend(undefined)).resolves.toMatchObject({ __typename: 'OtpExpired' });
    await expect(resend(challenge({ consumedAt: new Date() }))).resolves.toMatchObject({ __typename: 'OtpExpired' });
  });

  it('re-arms a decoy challenge without sending email', async () => {
    await resend(challenge({ userId: null }));
    expect(repo.resend).toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });
});
