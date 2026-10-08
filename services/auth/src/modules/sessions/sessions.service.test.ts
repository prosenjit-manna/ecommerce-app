import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { RefreshTokenRow, SessionRow } from './sessions.repository.js';
import type { UserRow } from '../users/users.repository.js';
import { type AnyFn, client, device, refreshToken, session, src, user } from '../../../test/helpers/fixtures.js';

const tx = { name: 'tx' };
const db = { transaction: jest.fn<AnyFn>(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
const sessionsRepository = {
  create: jest.fn<AnyFn>(async (data: Partial<SessionRow>) => session(data)),
  findById: jest.fn<AnyFn>(),
  revoke: jest.fn<AnyFn>(async () => []),
  markExpired: jest.fn<AnyFn>(async () => {}),
  touch: jest.fn<AnyFn>(async () => {}),
  createRefreshToken: jest.fn<AnyFn>(async (data: Partial<RefreshTokenRow>) => refreshToken({ id: 'rt-new', ...data })),
  findRefreshTokenForUpdate: jest.fn<AnyFn>(),
  markRefreshTokenUsed: jest.fn<AnyFn>(async () => {}),
  listActiveForUser: jest.fn<AnyFn>(async () => []),
};
const usersRepository = { findById: jest.fn<AnyFn>() };
const record = jest.fn<AnyFn>(async () => {});
const tokenService = {
  newRefreshToken: jest.fn<AnyFn>(() => ({ token: 'new-refresh-token', hash: 'new-hash' })),
  hashRefreshToken: jest.fn<AnyFn>((t: string) => `hash(${t})`),
  signAccessToken: jest.fn<AnyFn>(async () => ({ token: 'access-jwt', expiresAt: new Date(Date.now() + 900_000) })),
  markSessionsRevoked: jest.fn<AnyFn>(async () => {}),
};

jest.unstable_mockModule(src('db/client.ts'), () => ({ db }));
jest.unstable_mockModule(src('modules/sessions/sessions.repository.ts'), () => ({ sessionsRepository }));
jest.unstable_mockModule(src('modules/users/users.repository.ts'), () => ({ usersRepository }));
jest.unstable_mockModule(src('modules/events/auth-events.repository.ts'), () => ({
  authEventsRepository: { record },
}));
jest.unstable_mockModule(src('modules/tokens/token.service.ts'), () => tokenService);

const { sessionsService } = await import('./sessions.service.js');
const DAY = 86_400_000;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sessionsService.create', () => {
  it('records device, IP and location, and issues the first token pair', async () => {
    const u = user();
    const { session: s, tokens } = await sessionsService.create({
      user: u,
      method: 'password_otp',
      client: client(),
      device: device(),
    });

    expect(sessionsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: u.id,
        loginMethod: 'password_otp',
        createdIp: '203.0.113.10',
        lastIp: '203.0.113.10',
        deviceName: 'Pixel 9',
        clientDeviceId: 'device-1',
        geoCity: 'Kolkata',
        geoCountryCode: 'IN',
      }),
      db, // no transaction passed: repositories fall back to the shared db
    );
    // Absolute session cap: 90 days.
    const expiresAt = sessionsRepository.create.mock.calls[0]![0].expiresAt as Date;
    expect(expiresAt.getTime()).toBeCloseTo(Date.now() + 90 * DAY, -4);

    expect(sessionsRepository.createRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: s.id, tokenHash: 'new-hash' }),
      db,
    );
    expect(tokenService.signAccessToken).toHaveBeenCalledWith({ userId: u.id, sessionId: s.id, role: 'customer' });
    expect(tokens).toMatchObject({ __typename: 'AuthTokens', accessToken: 'access-jwt', refreshToken: 'new-refresh-token' });
  });

  it('stores null location when the IP has no geo data', async () => {
    await sessionsService.create({ user: user(), method: 'password', client: client({ geo: null }), device: device() });
    expect(sessionsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ geoCity: null, geoCountry: null, geoLat: null }),
      db,
    );
  });

  it('never lets the refresh token outlive the session', async () => {
    const shortSession = session({ expiresAt: new Date(Date.now() + 2 * DAY) });
    sessionsRepository.create.mockResolvedValueOnce(shortSession);
    const { tokens } = await sessionsService.create({ user: user(), method: 'password', client: client(), device: device() });
    expect(tokens.refreshTokenExpiresAt).toEqual(shortSession.expiresAt);
  });
});

describe('sessionsService.refresh', () => {
  const u = user();
  const s = session({ userId: u.id });

  it('rotates: marks the old token used, issues a new pair, updates last IP', async () => {
    const old = refreshToken({ id: 'rt-old', sessionId: s.id });
    sessionsRepository.findRefreshTokenForUpdate.mockResolvedValue(old);
    sessionsRepository.findById.mockResolvedValue(s);
    usersRepository.findById.mockResolvedValue(u);

    const result = await sessionsService.refresh('old-token', client({ ip: '198.51.100.7' }));

    expect(sessionsRepository.findRefreshTokenForUpdate).toHaveBeenCalledWith('hash(old-token)', tx);
    expect(result).toMatchObject({ __typename: 'AuthTokens', refreshToken: 'new-refresh-token' });
    expect(sessionsRepository.markRefreshTokenUsed).toHaveBeenCalledWith('rt-old', 'rt-new', tx);
    expect(sessionsRepository.touch).toHaveBeenCalledWith(s.id, '198.51.100.7', tx);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ type: 'refresh', sessionId: s.id }));
  });

  it('detects reuse of a used token and revokes the whole session', async () => {
    sessionsRepository.findRefreshTokenForUpdate.mockResolvedValue(refreshToken({ sessionId: s.id, usedAt: new Date() }));
    sessionsRepository.findById.mockResolvedValue(s);

    await expect(sessionsService.refresh('stolen', client())).resolves.toMatchObject({ __typename: 'InvalidRefreshToken' });
    expect(sessionsRepository.revoke).toHaveBeenCalledWith({ sessionId: s.id }, 'refresh_token_reuse', tx);
    expect(tokenService.markSessionsRevoked).toHaveBeenCalledWith([s.id]);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ type: 'refresh_reuse_detected' }));
    expect(tokenService.signAccessToken).not.toHaveBeenCalled();
  });

  it('rejects an unknown token', async () => {
    sessionsRepository.findRefreshTokenForUpdate.mockResolvedValue(undefined);
    await expect(sessionsService.refresh('nope', client())).resolves.toMatchObject({ __typename: 'InvalidRefreshToken' });
  });

  it('rejects a token whose session was already revoked', async () => {
    sessionsRepository.findRefreshTokenForUpdate.mockResolvedValue(refreshToken({ sessionId: s.id }));
    sessionsRepository.findById.mockResolvedValue({ ...s, status: 'revoked' });
    await expect(sessionsService.refresh('t', client())).resolves.toMatchObject({ __typename: 'InvalidRefreshToken' });
    expect(sessionsRepository.revoke).not.toHaveBeenCalled();
  });

  it.each([
    ['token', { token: { expiresAt: new Date(Date.now() - 1000) }, session: {} }],
    ['session', { token: {}, session: { expiresAt: new Date(Date.now() - 1000) } }],
  ])('marks the session expired when the %s has expired', async (_case, o) => {
    sessionsRepository.findRefreshTokenForUpdate.mockResolvedValue(refreshToken({ sessionId: s.id, ...o.token }));
    sessionsRepository.findById.mockResolvedValue({ ...s, ...o.session });
    await expect(sessionsService.refresh('t', client())).resolves.toMatchObject({ __typename: 'InvalidRefreshToken' });
    expect(sessionsRepository.markExpired).toHaveBeenCalledWith(s.id, tx);
  });

  it('revokes the session when the account was disabled', async () => {
    sessionsRepository.findRefreshTokenForUpdate.mockResolvedValue(refreshToken({ sessionId: s.id }));
    sessionsRepository.findById.mockResolvedValue(s);
    usersRepository.findById.mockResolvedValue({ ...u, status: 'disabled' });

    await expect(sessionsService.refresh('t', client())).resolves.toMatchObject({ __typename: 'InvalidRefreshToken' });
    expect(sessionsRepository.revoke).toHaveBeenCalledWith({ sessionId: s.id }, 'account_disabled', tx);
    expect(tokenService.markSessionsRevoked).toHaveBeenCalledWith([s.id]);
  });
});

describe('sessionsService.revoke', () => {
  it('revokes, blacklists live access tokens and audits each session', async () => {
    sessionsRepository.revoke.mockResolvedValue(['s1', 's2']);
    const ids = await sessionsService.revoke({ userId: 'u1', exceptSessionId: 's0' }, 'revoked_by_user', {
      client: client(),
      userId: 'u1',
      type: 'session_revoked',
    });
    expect(ids).toEqual(['s1', 's2']);
    expect(tokenService.markSessionsRevoked).toHaveBeenCalledWith(['s1', 's2']);
    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session_revoked', sessionId: 's2', metadata: { reason: 'revoked_by_user' } }),
    );
  });
});
