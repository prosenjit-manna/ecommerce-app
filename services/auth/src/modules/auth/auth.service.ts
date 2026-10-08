import { db } from '../../db/client.js';
import type { DeviceSnapshot } from '../../db/schema.js';
import { buildDeviceSnapshot, type ClientDeviceInfo } from '../../lib/device.js';
import { sendMail } from '../../lib/mailer.js';
import {
  burnPasswordVerify,
  checkPasswordStrength,
  hashPassword,
  verifyPassword,
} from '../../lib/password.js';
import { consume, isBlocked, resetLimit } from '../../lib/rate-limit.js';
import type { ClientInfo } from '../../lib/request-context.js';
import { notFound, Result } from '../../lib/results.js';
import { newDeviceLoginEmail, passwordChangedEmail } from '../../lib/templates/index.js';
import { authEventsRepository } from '../events/auth-events.repository.js';
import { otpRepository } from '../otp/otp.repository.js';
import { otpService, toOtpChallenge } from '../otp/otp.service.js';
import { sessionsRepository, type SessionRow } from '../sessions/sessions.repository.js';
import { sessionsService } from '../sessions/sessions.service.js';
import { usersRepository, type UserRow } from '../users/users.repository.js';
import { normalizeEmail } from '../users/users.service.js';

export interface AuthContextUser {
  userId: string;
  sessionId: string;
}

/** Final step of every successful sign-in: create the device session and hand out tokens. */
async function completeLogin(input: {
  user: UserRow;
  method: SessionRow['loginMethod'];
  device: DeviceSnapshot;
  client: ClientInfo;
}) {
  const { user, device, client } = input;

  // Alert on a new device, but not on the very first login (signup), which is always "new".
  const isNewDevice =
    user.lastLoginAt !== null &&
    !(await sessionsRepository.hasSeenDevice(user.id, {
      clientDeviceId: device.clientDeviceId,
      userAgent: device.userAgent,
      geoCountryCode: client.geo?.countryCode ?? null,
    }));

  const { session, tokens, updatedUser } = await db.transaction(async (tx) => {
    const created = await sessionsService.create({ user, method: input.method, client, device }, tx);
    const updatedUser = await usersRepository.update(user.id, { lastLoginAt: new Date() }, tx);
    return { ...created, updatedUser: updatedUser ?? user };
  });

  await authEventsRepository.record({
    type: 'login_success',
    client,
    userId: user.id,
    sessionId: session.id,
    email: user.email,
    metadata: { method: input.method },
  });

  if (isNewDevice) {
    const location = [client.geo?.city, client.geo?.country].filter(Boolean).join(', ') || null;
    await sendMail(
      newDeviceLoginEmail(user.email, { deviceName: device.deviceName, location, ip: client.ip, at: new Date() }),
    );
  }

  return { __typename: 'AuthSuccess' as const, user: updatedUser, session, tokens };
}

export const authService = {
  async signUp(
    input: { email: string; name: string; password: string; device?: ClientDeviceInfo | null },
    client: ClientInfo,
  ) {
    const email = normalizeEmail(input.email);
    const name = input.name.trim();

    // Trade-off: telling the user "already registered" lets someone probe for accounts.
    // It's accepted here for UX, and the per-IP signup limit keeps probing slow.
    if (await usersRepository.findByEmail(email)) return Result.emailAlreadyRegistered();

    const weak = checkPasswordStrength(input.password, { email, name });
    if (weak.length) return Result.weakPassword(weak);

    let user: UserRow;
    try {
      user = await usersRepository.create({ email, name, passwordHash: await hashPassword(input.password) });
    } catch (err) {
      // Lost a race with a parallel signup for the same email (unique index).
      if ((err as { cause?: { code?: string } }).cause?.code === '23505' || (err as { code?: string }).code === '23505') {
        return Result.emailAlreadyRegistered();
      }
      throw err;
    }
    await authEventsRepository.record({ type: 'signup', client, userId: user.id, email });

    const challenge = await otpService.start({
      userId: user.id,
      email,
      purpose: 'email_verify',
      client,
      device: buildDeviceSnapshot(client.userAgent, input.device),
    });
    return toOtpChallenge(challenge);
  },

  /** Verifying the email also signs the user in (one fewer step after signup). */
  async verifyEmail(input: { challengeId: string; code: string; device?: ClientDeviceInfo | null }, client: ClientInfo) {
    const verified = await otpService.verify({ ...input, purpose: 'email_verify', client });
    if (verified.__typename !== 'Verified') return verified;

    const existing = await usersRepository.findById(verified.challenge.userId);
    if (!existing) return Result.otpExpired();
    if (existing.status !== 'active') return Result.accountDisabled();

    const user = (await usersRepository.update(existing.id, { emailVerifiedAt: existing.emailVerifiedAt ?? new Date() }))!;
    await authEventsRepository.record({ type: 'email_verified', client, userId: user.id, email: user.email });

    const device = verified.challenge.device ?? buildDeviceSnapshot(client.userAgent, input.device);
    return completeLogin({ user, method: 'email_verify', device, client });
  },

  /**
   * Step 1 of sign-in. With two-factor on (the default) a correct password only
   * starts an email OTP challenge; tokens come from `verifyLoginOtp`.
   */
  async login(
    input: { email: string; password: string; device?: ClientDeviceInfo | null },
    client: ClientInfo,
  ) {
    const email = normalizeEmail(input.email);

    // Brute-force guard: too many consecutive wrong passwords for this email → temporary block.
    const blocked = await isBlocked('loginFailuresEmail', email);
    if (!blocked.ok) {
      await authEventsRepository.record({ type: 'rate_limited', client, email, metadata: { op: 'login' } });
      return Result.rateLimited(blocked.retryAfterSeconds);
    }

    const user = await usersRepository.findByEmail(email);
    const passwordOk = user ? await verifyPassword(user.passwordHash, input.password) : await burnPasswordVerify(input.password).then(() => false);

    if (!user || !passwordOk) {
      await consume('loginFailuresEmail', email);
      await authEventsRepository.record({
        type: 'login_failed',
        client,
        userId: user?.id ?? null,
        email,
        metadata: { reason: user ? 'wrong_password' : 'unknown_email' },
      });
      return Result.invalidCredentials();
    }

    await resetLimit('loginFailuresEmail', email);
    if (user.status !== 'active') return Result.accountDisabled();
    await authEventsRepository.record({ type: 'login_password_ok', client, userId: user.id, email });

    const device = buildDeviceSnapshot(client.userAgent, input.device);

    if (!user.emailVerifiedAt) {
      const challenge = await otpService.start({ userId: user.id, email, purpose: 'email_verify', client, device });
      return {
        __typename: 'EmailNotVerified' as const,
        message: 'Verify your email to continue. We sent you a new code.',
        challenge: toOtpChallenge(challenge),
      };
    }

    if (user.twoFactorEnabled) {
      const challenge = await otpService.start({ userId: user.id, email, purpose: 'login', client, device });
      return toOtpChallenge(challenge);
    }

    return completeLogin({ user, method: 'password', device, client });
  },

  /** Step 2 of sign-in: the emailed code. */
  async verifyLoginOtp(input: { challengeId: string; code: string }, client: ClientInfo) {
    const verified = await otpService.verify({ ...input, purpose: 'login', client });
    if (verified.__typename !== 'Verified') return verified;

    const user = await usersRepository.findById(verified.challenge.userId);
    if (!user) return Result.otpExpired();
    if (user.status !== 'active') return Result.accountDisabled();

    const device = verified.challenge.device ?? buildDeviceSnapshot(client.userAgent, null);
    return completeLogin({ user, method: 'password_otp', device, client });
  },

  resendOtp: (input: { challengeId: string }, client: ClientInfo) => otpService.resend({ ...input, client }),

  refreshTokens: (input: { refreshToken: string }, client: ClientInfo) =>
    sessionsService.refresh(input.refreshToken, client),

  /**
   * Always answers with a challenge, whether or not the email has an account,
   * so this endpoint can't be used to discover who is registered.
   */
  async forgotPassword(input: { email: string }, client: ClientInfo) {
    const email = normalizeEmail(input.email);
    const user = await usersRepository.findByEmail(email);
    const userId = user && user.status === 'active' ? user.id : null;

    const challenge = await otpService.start({ userId, email, purpose: 'password_reset', client });
    await authEventsRepository.record({ type: 'password_reset_requested', client, userId, email });
    return toOtpChallenge(challenge);
  },

  async resetPassword(input: { challengeId: string; code: string; newPassword: string }, client: ClientInfo) {
    // Check strength before the code, so a weak password doesn't burn the code.
    // Uses the challenge's email for both real and decoy challenges, so responses look the same.
    const pending = await otpRepository.findById(input.challengeId);
    if (!pending || pending.purpose !== 'password_reset') return Result.otpExpired();
    const weak = checkPasswordStrength(input.newPassword, { email: pending.email });
    if (weak.length) return Result.weakPassword(weak);

    const verified = await otpService.verify({ ...input, purpose: 'password_reset', client });
    if (verified.__typename !== 'Verified') return verified;

    const user = await usersRepository.findById(verified.challenge.userId);
    if (!user) return Result.otpExpired();

    await usersRepository.update(user.id, {
      passwordHash: await hashPassword(input.newPassword),
      passwordChangedAt: new Date(),
      // Receiving the code proves they own the inbox.
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
    });
    await resetLimit('loginFailuresEmail', user.email);

    // A password reset usually means "someone else may have my password": sign out everywhere.
    await sessionsService.revoke({ userId: user.id }, 'password_reset', {
      client,
      userId: user.id,
      type: 'session_revoked',
    });
    await authEventsRepository.record({ type: 'password_reset', client, userId: user.id, email: user.email });
    await sendMail(passwordChangedEmail(user.email));

    return {
      __typename: 'PasswordResetSuccess' as const,
      message: 'Your password was changed. Sign in with your new password.',
    };
  },

  // --- authenticated -----------------------------------------------------------------------------

  async logout(auth: AuthContextUser, client: ClientInfo) {
    const ids = await sessionsService.revoke({ sessionId: auth.sessionId }, 'logout', {
      client,
      userId: auth.userId,
      type: 'logout',
    });
    return { revokedSessionIds: ids };
  },

  async revokeSession(auth: AuthContextUser, sessionId: string, client: ClientInfo) {
    const session = await sessionsRepository.findById(sessionId);
    // Same error for "doesn't exist" and "not yours", so ids of other users' sessions can't be probed.
    if (!session || session.userId !== auth.userId) throw notFound('Session not found.');
    const ids = await sessionsService.revoke({ sessionId }, 'revoked_by_user', {
      client,
      userId: auth.userId,
      type: sessionId === auth.sessionId ? 'logout' : 'session_revoked',
    });
    return { revokedSessionIds: ids };
  },

  async revokeOtherSessions(auth: AuthContextUser, client: ClientInfo) {
    const ids = await sessionsService.revoke(
      { userId: auth.userId, exceptSessionId: auth.sessionId },
      'revoked_by_user',
      { client, userId: auth.userId, type: 'session_revoked' },
    );
    return { revokedSessionIds: ids };
  },

  /** Turning two-factor off is sensitive, so it asks for the password again. */
  async setTwoFactor(auth: AuthContextUser, input: { enabled: boolean; password: string }) {
    const user = await usersRepository.findById(auth.userId);
    if (!user) throw notFound('User not found.');
    if (!(await verifyPassword(user.passwordHash, input.password))) return Result.invalidCredentials();
    const updated = (await usersRepository.update(user.id, { twoFactorEnabled: input.enabled }))!;
    return { __typename: 'User' as const, ...updated };
  },
};
