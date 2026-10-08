import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { DeviceSnapshot } from '../../db/schema.js';
import type { OtpChallengeRow } from '../otp/otp.repository.js';
import type { SessionRow } from '../sessions/sessions.repository.js';
import type { UserRow } from '../users/users.repository.js';
import { type AnyFn, challenge, client, device, session, src, user } from '../../../test/helpers/fixtures.js';

// --- mocks for everything below the auth service --------------------------------------------
const tx = { name: 'tx' };
const db = { transaction: jest.fn<AnyFn>(async (fn: (t: typeof tx) => unknown) => fn(tx)) };

const usersRepository = {
  findByEmail: jest.fn<AnyFn>(),
  findById: jest.fn<AnyFn>(),
  create: jest.fn<AnyFn>(async (data: Partial<UserRow>) => user({ ...data, emailVerifiedAt: null, lastLoginAt: null })),
  update: jest.fn<AnyFn>(async (id: string, data: Partial<UserRow>) => user({ id, ...data })),
};
const sessionsRepository = {
  findById: jest.fn<AnyFn>(),
  hasSeenDevice: jest.fn<AnyFn>(async () => true),
};
const tokens = { __typename: 'AuthTokens', accessToken: 'jwt', refreshToken: 'rt' };
const sessionsService = {
  create: jest.fn<AnyFn>(async (input: { user: UserRow; method: SessionRow['loginMethod'] }) => ({
    session: session({ userId: input.user.id, loginMethod: input.method }),
    tokens,
  })),
  revoke: jest.fn<AnyFn>(async () => ['s1']),
  refresh: jest.fn<AnyFn>(),
};
type StartInput = { userId: string | null; email: string; purpose: OtpChallengeRow['purpose']; device?: DeviceSnapshot | null };
const otpService = {
  start: jest.fn<AnyFn>(async (i: StartInput) => challenge({ userId: i.userId, email: i.email, purpose: i.purpose })),
  verify: jest.fn<AnyFn>(),
  resend: jest.fn<AnyFn>(),
};
const otpRepository = { findById: jest.fn<AnyFn>() };
const record = jest.fn<AnyFn>(async () => {});
const sendMail = jest.fn<AnyFn>(async () => {});
const rateLimit = {
  consume: jest.fn<AnyFn>(async () => ({ ok: true })),
  isBlocked: jest.fn<AnyFn>(async () => ({ ok: true }) as { ok: true } | { ok: false; retryAfterSeconds: number }),
  resetLimit: jest.fn<AnyFn>(async () => {}),
};

jest.unstable_mockModule(src('db/client.ts'), () => ({ db }));
jest.unstable_mockModule(src('modules/users/users.repository.ts'), () => ({ usersRepository }));
jest.unstable_mockModule(src('modules/sessions/sessions.repository.ts'), () => ({ sessionsRepository }));
jest.unstable_mockModule(src('modules/sessions/sessions.service.ts'), () => ({ sessionsService }));
jest.unstable_mockModule(src('modules/otp/otp.service.ts'), () => ({
  otpService,
  toOtpChallenge: (c: OtpChallengeRow) => ({ __typename: 'OtpChallenge', challengeId: c.id, purpose: c.purpose.toUpperCase() }),
}));
jest.unstable_mockModule(src('modules/otp/otp.repository.ts'), () => ({ otpRepository }));
jest.unstable_mockModule(src('modules/events/auth-events.repository.ts'), () => ({ authEventsRepository: { record } }));
jest.unstable_mockModule(src('lib/mailer.ts'), () => ({ sendMail }));
jest.unstable_mockModule(src('lib/rate-limit.ts'), () => rateLimit);

const { authService } = await import('./auth.service.js');
const { hashPassword, verifyPassword } = await import('../../lib/password.js');

const PASSWORD = 'Str0ng!Passw0rd';
let passwordHash: string;
beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(() => {
  jest.clearAllMocks();
  rateLimit.isBlocked.mockResolvedValue({ ok: true });
  sessionsRepository.hasSeenDevice.mockResolvedValue(true);
});

const eventTypes = () => record.mock.calls.map((c) => (c as unknown as [{ type: string }])[0].type);

// -----------------------------------------------------------------------------------------------
describe('signUp', () => {
  const input = { email: '  Jane@Example.COM ', name: ' Jane Doe ', password: PASSWORD, device: { platform: 'ios' } };

  it('creates an unverified user and emails a verification code', async () => {
    usersRepository.findByEmail.mockResolvedValue(undefined);

    const result = await authService.signUp(input, client());

    expect(result).toMatchObject({ __typename: 'OtpChallenge', purpose: 'EMAIL_VERIFY' });
    const created = usersRepository.create.mock.calls[0]![0];
    expect(created).toMatchObject({ email: 'jane@example.com', name: 'Jane Doe' });
    await expect(verifyPassword(created.passwordHash!, PASSWORD)).resolves.toBe(true);
    expect(otpService.start).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'jane@example.com', purpose: 'email_verify', device: expect.objectContaining({ clientPlatform: 'ios' }) }),
    );
    expect(eventTypes()).toEqual(['signup']);
  });

  it('rejects an email that is already registered', async () => {
    usersRepository.findByEmail.mockResolvedValue(user());
    await expect(authService.signUp(input, client())).resolves.toMatchObject({ __typename: 'EmailAlreadyRegistered' });
    expect(usersRepository.create).not.toHaveBeenCalled();
  });

  it('rejects a weak password with reasons', async () => {
    usersRepository.findByEmail.mockResolvedValue(undefined);
    const result = await authService.signUp({ ...input, password: 'password' }, client());
    expect(result).toMatchObject({ __typename: 'WeakPassword' });
    expect((result as { reasons: string[] }).reasons.length).toBeGreaterThan(0);
  });

  it('turns a unique-index race into EmailAlreadyRegistered', async () => {
    usersRepository.findByEmail.mockResolvedValue(undefined);
    usersRepository.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { cause: { code: '23505' } }));
    await expect(authService.signUp(input, client())).resolves.toMatchObject({ __typename: 'EmailAlreadyRegistered' });
  });

  it('rethrows unexpected database errors', async () => {
    usersRepository.findByEmail.mockResolvedValue(undefined);
    usersRepository.create.mockRejectedValueOnce(new Error('connection lost'));
    await expect(authService.signUp(input, client())).rejects.toThrow('connection lost');
  });
});

// -----------------------------------------------------------------------------------------------
describe('verifyEmail', () => {
  it('marks the email verified and signs the user in on the signup device', async () => {
    const u = user({ emailVerifiedAt: null, lastLoginAt: null });
    const signupDevice = device({ deviceName: 'iPhone' });
    otpService.verify.mockResolvedValue({ __typename: 'Verified', challenge: challenge({ userId: u.id, device: signupDevice }) });
    usersRepository.findById.mockResolvedValue(u);

    const result = await authService.verifyEmail({ challengeId: 'c', code: '123456' }, client());

    expect(result).toMatchObject({ __typename: 'AuthSuccess', tokens });
    expect(usersRepository.update).toHaveBeenCalledWith(u.id, { emailVerifiedAt: expect.any(Date) });
    expect(sessionsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'email_verify', device: signupDevice }),
      tx,
    );
    expect(eventTypes()).toEqual(['email_verified', 'login_success']);
  });

  it('passes OTP failures straight through', async () => {
    otpService.verify.mockResolvedValue({ __typename: 'InvalidOtp' });
    await expect(authService.verifyEmail({ challengeId: 'c', code: '000000' }, client())).resolves.toEqual({
      __typename: 'InvalidOtp',
    });
    expect(sessionsService.create).not.toHaveBeenCalled();
  });

  it('refuses disabled accounts', async () => {
    const u = user({ status: 'disabled' });
    otpService.verify.mockResolvedValue({ __typename: 'Verified', challenge: challenge({ userId: u.id }) });
    usersRepository.findById.mockResolvedValue(u);
    await expect(authService.verifyEmail({ challengeId: 'c', code: '1' }, client())).resolves.toMatchObject({
      __typename: 'AccountDisabled',
    });
  });

  it('returns OtpExpired if the user no longer exists', async () => {
    otpService.verify.mockResolvedValue({ __typename: 'Verified', challenge: challenge() });
    usersRepository.findById.mockResolvedValue(undefined);
    await expect(authService.verifyEmail({ challengeId: 'c', code: '1' }, client())).resolves.toMatchObject({
      __typename: 'OtpExpired',
    });
  });
});

// -----------------------------------------------------------------------------------------------
describe('login', () => {
  const login = (overrides: Partial<{ email: string; password: string }> = {}) =>
    authService.login({ email: 'jane@example.com', password: PASSWORD, ...overrides }, client());

  it('with two-factor on (default): a correct password starts a login OTP challenge', async () => {
    const u = user({ passwordHash });
    usersRepository.findByEmail.mockResolvedValue(u);

    const result = await authService.login(
      { email: ' JANE@example.com', password: PASSWORD, device: { platform: 'android', deviceName: 'Pixel 9' } },
      client(),
    );

    expect(usersRepository.findByEmail).toHaveBeenCalledWith('jane@example.com');
    expect(result).toMatchObject({ __typename: 'OtpChallenge', purpose: 'LOGIN' });
    expect(otpService.start).toHaveBeenCalledWith(
      expect.objectContaining({ userId: u.id, purpose: 'login', device: expect.objectContaining({ deviceName: 'Pixel 9' }) }),
    );
    expect(rateLimit.resetLimit).toHaveBeenCalledWith('loginFailuresEmail', 'jane@example.com');
    expect(sessionsService.create).not.toHaveBeenCalled();
  });

  it('with two-factor off: signs in directly', async () => {
    usersRepository.findByEmail.mockResolvedValue(user({ passwordHash, twoFactorEnabled: false }));
    const result = await login();
    expect(result).toMatchObject({ __typename: 'AuthSuccess' });
    expect(sessionsService.create).toHaveBeenCalledWith(expect.objectContaining({ method: 'password' }), tx);
    expect(usersRepository.update).toHaveBeenCalledWith(expect.any(String), { lastLoginAt: expect.any(Date) }, tx);
  });

  it('wrong password: counts the failure and returns InvalidCredentials', async () => {
    usersRepository.findByEmail.mockResolvedValue(user({ passwordHash }));
    await expect(login({ password: 'Wrong!Passw0rd' })).resolves.toMatchObject({ __typename: 'InvalidCredentials' });
    expect(rateLimit.consume).toHaveBeenCalledWith('loginFailuresEmail', 'jane@example.com');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'login_failed', metadata: { reason: 'wrong_password' } }),
    );
    expect(otpService.start).not.toHaveBeenCalled();
  });

  it('unknown email: same answer as a wrong password', async () => {
    usersRepository.findByEmail.mockResolvedValue(undefined);
    await expect(login()).resolves.toMatchObject({ __typename: 'InvalidCredentials' });
    expect(rateLimit.consume).toHaveBeenCalledWith('loginFailuresEmail', 'jane@example.com');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ metadata: { reason: 'unknown_email' } }));
  });

  it('is blocked after too many consecutive failures, without checking the password', async () => {
    rateLimit.isBlocked.mockResolvedValue({ ok: false, retryAfterSeconds: 600 });
    await expect(login()).resolves.toMatchObject({ __typename: 'RateLimited', retryAfterSeconds: 600 });
    expect(usersRepository.findByEmail).not.toHaveBeenCalled();
    expect(eventTypes()).toEqual(['rate_limited']);
  });

  it('refuses a disabled account even with the right password', async () => {
    usersRepository.findByEmail.mockResolvedValue(user({ passwordHash, status: 'disabled' }));
    await expect(login()).resolves.toMatchObject({ __typename: 'AccountDisabled' });
  });

  it('unverified email: sends a new verification code instead of a login code', async () => {
    usersRepository.findByEmail.mockResolvedValue(user({ passwordHash, emailVerifiedAt: null }));
    const result = await login();
    expect(result).toMatchObject({ __typename: 'EmailNotVerified', challenge: { purpose: 'EMAIL_VERIFY' } });
    expect(otpService.start).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'email_verify' }));
  });
});

// -----------------------------------------------------------------------------------------------
describe('verifyLoginOtp', () => {
  it('creates a PASSWORD_OTP session on the device captured at login', async () => {
    const u = user();
    const loginDevice = device();
    otpService.verify.mockResolvedValue({ __typename: 'Verified', challenge: challenge({ userId: u.id, device: loginDevice }) });
    usersRepository.findById.mockResolvedValue(u);

    await expect(authService.verifyLoginOtp({ challengeId: 'c', code: '123456' }, client())).resolves.toMatchObject({
      __typename: 'AuthSuccess',
    });
    expect(otpService.verify).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'login' }));
    expect(sessionsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'password_otp', device: loginDevice }),
      tx,
    );
  });

  it('passes OTP failures through and refuses disabled accounts', async () => {
    otpService.verify.mockResolvedValueOnce({ __typename: 'OtpExpired' });
    await expect(authService.verifyLoginOtp({ challengeId: 'c', code: '1' }, client())).resolves.toEqual({
      __typename: 'OtpExpired',
    });

    const u = user({ status: 'disabled' });
    otpService.verify.mockResolvedValueOnce({ __typename: 'Verified', challenge: challenge({ userId: u.id }) });
    usersRepository.findById.mockResolvedValue(u);
    await expect(authService.verifyLoginOtp({ challengeId: 'c', code: '1' }, client())).resolves.toMatchObject({
      __typename: 'AccountDisabled',
    });
  });
});

// -----------------------------------------------------------------------------------------------
describe('new-device alert', () => {
  const signIn = async (u: UserRow) => {
    otpService.verify.mockResolvedValue({ __typename: 'Verified', challenge: challenge({ userId: u.id, device: device() }) });
    usersRepository.findById.mockResolvedValue(u);
    await authService.verifyLoginOtp({ challengeId: 'c', code: '1' }, client());
  };
  const newDeviceMails = () => sendMail.mock.calls.filter(([m]) => m.subject.startsWith('New sign-in'));

  it('emails the user when a returning user signs in from an unseen device', async () => {
    sessionsRepository.hasSeenDevice.mockResolvedValue(false);
    await signIn(user());
    expect(newDeviceMails()).toHaveLength(1);
    expect(sessionsRepository.hasSeenDevice).toHaveBeenCalledWith(expect.any(String), {
      clientDeviceId: 'device-1',
      userAgent: 'okhttp/4.12.0',
      geoCountryCode: 'IN',
    });
  });

  it('stays quiet for a known device', async () => {
    await signIn(user());
    expect(newDeviceMails()).toHaveLength(0);
  });

  it('stays quiet on the very first sign-in', async () => {
    sessionsRepository.hasSeenDevice.mockResolvedValue(false);
    await signIn(user({ lastLoginAt: null }));
    expect(newDeviceMails()).toHaveLength(0);
    expect(sessionsRepository.hasSeenDevice).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------------------------
describe('forgotPassword', () => {
  it('starts a reset challenge for an active account', async () => {
    const u = user();
    usersRepository.findByEmail.mockResolvedValue(u);
    await expect(authService.forgotPassword({ email: 'Jane@example.com' }, client())).resolves.toMatchObject({
      __typename: 'OtpChallenge',
    });
    expect(otpService.start).toHaveBeenCalledWith(expect.objectContaining({ userId: u.id, purpose: 'password_reset' }));
  });

  it.each([
    ['an unknown email', undefined],
    ['a disabled account', user({ status: 'disabled' })],
  ])('answers the same way for %s, with a decoy challenge', async (_case, found) => {
    usersRepository.findByEmail.mockResolvedValue(found);
    await expect(authService.forgotPassword({ email: 'x@example.com' }, client())).resolves.toMatchObject({
      __typename: 'OtpChallenge',
    });
    expect(otpService.start).toHaveBeenCalledWith(expect.objectContaining({ userId: null, purpose: 'password_reset' }));
  });
});

// -----------------------------------------------------------------------------------------------
describe('resetPassword', () => {
  const NEW = 'N3w!Passw0rd';
  const reset = (newPassword = NEW) => authService.resetPassword({ challengeId: 'c', code: '123456', newPassword }, client());

  it('sets the new password, signs out every device and emails a notice', async () => {
    const u = user({ emailVerifiedAt: null });
    otpRepository.findById.mockResolvedValue(challenge({ purpose: 'password_reset', userId: u.id }));
    otpService.verify.mockResolvedValue({ __typename: 'Verified', challenge: challenge({ userId: u.id }) });
    usersRepository.findById.mockResolvedValue(u);

    await expect(reset()).resolves.toMatchObject({ __typename: 'PasswordResetSuccess' });

    const [, changes] = usersRepository.update.mock.calls[0]!;
    await expect(verifyPassword(changes.passwordHash!, NEW)).resolves.toBe(true);
    expect(changes).toMatchObject({ passwordChangedAt: expect.any(Date), emailVerifiedAt: expect.any(Date) });
    expect(sessionsService.revoke).toHaveBeenCalledWith({ userId: u.id }, 'password_reset', expect.anything());
    expect(rateLimit.resetLimit).toHaveBeenCalledWith('loginFailuresEmail', u.email);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Your password was changed' }));
  });

  it('checks password strength before the code, so a weak password does not burn it', async () => {
    otpRepository.findById.mockResolvedValue(challenge({ purpose: 'password_reset' }));
    await expect(reset('weak')).resolves.toMatchObject({ __typename: 'WeakPassword' });
    expect(otpService.verify).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown challenge', undefined],
    ['a challenge for another purpose', challenge({ purpose: 'login' })],
  ])('returns OtpExpired for %s', async (_case, c) => {
    otpRepository.findById.mockResolvedValue(c);
    await expect(reset()).resolves.toMatchObject({ __typename: 'OtpExpired' });
  });

  it('passes a wrong code through without changing anything', async () => {
    otpRepository.findById.mockResolvedValue(challenge({ purpose: 'password_reset' }));
    otpService.verify.mockResolvedValue({ __typename: 'InvalidOtp' });
    await expect(reset()).resolves.toEqual({ __typename: 'InvalidOtp' });
    expect(usersRepository.update).not.toHaveBeenCalled();
    expect(sessionsService.revoke).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------------------------
describe('session management', () => {
  const auth = { userId: 'u1', sessionId: 'current' };

  it('logout revokes only the current session', async () => {
    await authService.logout(auth, client());
    expect(sessionsService.revoke).toHaveBeenCalledWith({ sessionId: 'current' }, 'logout', expect.objectContaining({ type: 'logout' }));
  });

  it('revokeSession revokes one of your own sessions', async () => {
    sessionsRepository.findById.mockResolvedValue(session({ id: 'other', userId: 'u1' }));
    await expect(authService.revokeSession(auth, 'other', client())).resolves.toEqual({ revokedSessionIds: ['s1'] });
    expect(sessionsService.revoke).toHaveBeenCalledWith(
      { sessionId: 'other' },
      'revoked_by_user',
      expect.objectContaining({ type: 'session_revoked' }),
    );
  });

  it("revokeSession can't touch another user's session (same error as not found)", async () => {
    sessionsRepository.findById.mockResolvedValueOnce(session({ userId: 'someone-else' })).mockResolvedValueOnce(undefined);
    for (let i = 0; i < 2; i++) {
      await expect(authService.revokeSession(auth, 'x', client())).rejects.toMatchObject({
        extensions: { code: 'NOT_FOUND' },
      });
    }
    expect(sessionsService.revoke).not.toHaveBeenCalled();
  });

  it('revokeOtherSessions keeps the current one', async () => {
    await authService.revokeOtherSessions(auth, client());
    expect(sessionsService.revoke).toHaveBeenCalledWith(
      { userId: 'u1', exceptSessionId: 'current' },
      'revoked_by_user',
      expect.anything(),
    );
  });
});

describe('setTwoFactor', () => {
  const auth = { userId: 'u1', sessionId: 's' };

  it('requires the current password', async () => {
    usersRepository.findById.mockResolvedValue(user({ id: 'u1', passwordHash }));
    await expect(authService.setTwoFactor(auth, { enabled: false, password: 'wrong' })).resolves.toMatchObject({
      __typename: 'InvalidCredentials',
    });
    expect(usersRepository.update).not.toHaveBeenCalled();
  });

  it('updates the flag', async () => {
    usersRepository.findById.mockResolvedValue(user({ id: 'u1', passwordHash }));
    await expect(authService.setTwoFactor(auth, { enabled: false, password: PASSWORD })).resolves.toMatchObject({
      __typename: 'User',
      twoFactorEnabled: false,
    });
  });

  it('throws NOT_FOUND for a deleted user', async () => {
    usersRepository.findById.mockResolvedValue(undefined);
    await expect(authService.setTwoFactor(auth, { enabled: true, password: PASSWORD })).rejects.toMatchObject({
      extensions: { code: 'NOT_FOUND' },
    });
  });
});

describe('pass-throughs', () => {
  it('resendOtp and refreshTokens delegate with the client info', async () => {
    await authService.resendOtp({ challengeId: 'c' }, client());
    expect(otpService.resend).toHaveBeenCalledWith({ challengeId: 'c', client: client() });
    await authService.refreshTokens({ refreshToken: 'rt' }, client());
    expect(sessionsService.refresh).toHaveBeenCalledWith('rt', client());
  });
});
