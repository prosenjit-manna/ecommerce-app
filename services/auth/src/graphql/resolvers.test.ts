import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Kind } from 'graphql';
import type { GraphQLContext } from './context.js';
import type { AuthEventRow } from '../modules/events/auth-events.repository.js';
import { type AnyFn, client, session, src, user } from '../../test/helpers/fixtures.js';

const authService = {
  signUp: jest.fn<AnyFn>(async () => ({ __typename: 'OtpChallenge' })),
  verifyEmail: jest.fn<AnyFn>(async () => ({ __typename: 'AuthSuccess' })),
  login: jest.fn<AnyFn>(async () => ({ __typename: 'OtpChallenge' })),
  verifyLoginOtp: jest.fn<AnyFn>(async () => ({ __typename: 'AuthSuccess' })),
  resendOtp: jest.fn<AnyFn>(async () => ({ __typename: 'OtpChallenge' })),
  refreshTokens: jest.fn<AnyFn>(async () => ({ __typename: 'AuthTokens' })),
  forgotPassword: jest.fn<AnyFn>(async () => ({ __typename: 'OtpChallenge' })),
  resetPassword: jest.fn<AnyFn>(async () => ({ __typename: 'PasswordResetSuccess' })),
  logout: jest.fn<AnyFn>(async () => ({ revokedSessionIds: ['s1'] })),
  revokeSession: jest.fn<AnyFn>(async () => ({ revokedSessionIds: ['s2'] })),
  revokeOtherSessions: jest.fn<AnyFn>(async () => ({ revokedSessionIds: [] })),
  setTwoFactor: jest.fn<AnyFn>(async () => ({ __typename: 'User' })),
};
const listActive = jest.fn<AnyFn>(async () => []);
const record = jest.fn<AnyFn>(async () => {});
const listForUser = jest.fn<AnyFn>();
const consumeAll = jest.fn<AnyFn>(async () => ({ ok: true }) as { ok: true } | { ok: false; retryAfterSeconds: number });
const isAllowlisted = jest.fn<AnyFn>(() => false);

jest.unstable_mockModule(src('modules/auth/auth.service.ts'), () => ({ authService }));
jest.unstable_mockModule(src('modules/sessions/sessions.service.ts'), () => ({ sessionsService: { listActive } }));
jest.unstable_mockModule(src('modules/events/auth-events.repository.ts'), () => ({
  authEventsRepository: { record, listForUser },
}));
jest.unstable_mockModule(src('lib/rate-limit.ts'), () => ({ consumeAll, isAllowlisted }));
// context.ts → token.service.ts → redis.ts would open a real Redis connection.
jest.unstable_mockModule(src('modules/tokens/token.service.ts'), () => ({
  verifyAccessToken: jest.fn<AnyFn>(),
  isSessionRevoked: jest.fn<AnyFn>(),
}));
jest.unstable_mockModule(src('modules/users/users.service.ts'), () => ({
  normalizeEmail: (e: string) => e.trim().toLowerCase(),
  createUserLoader: () => ({ load: jest.fn<AnyFn>() }), // imported by graphql/context.ts
}));

const { resolvers } = await import('./resolvers.js');

// --- helpers ------------------------------------------------------------------------------------
const loadUser = jest.fn<AnyFn>();
const ctx = (auth: GraphQLContext['auth'] = null, overrides: Partial<GraphQLContext> = {}): GraphQLContext => ({
  client: client(),
  auth,
  authError: null,
  loaders: { user: { load: loadUser } as never },
  ...overrides,
});
const signedIn = () => ctx({ userId: 'u1', sessionId: 'current', role: 'customer' });

type AnyResolver = (parent: unknown, args: unknown, ctx: GraphQLContext, info: unknown) => unknown;
const M = resolvers.Mutation as Record<string, AnyResolver>;
const Q = resolvers.Query as Record<string, AnyResolver>;
const field = (type: 'User' | 'Session' | 'AuthEvent', name: string) =>
  (resolvers[type] as Record<string, AnyResolver>)[name]!;
const mutate = (name: string, input: unknown, c = ctx()) => M[name]!({}, { input }, c, {});

const DEVICE = { platform: 'ios', deviceName: 'iPhone', appVersion: '1.0.0', deviceId: 'd1' };
const CHALLENGE_ID = '0199c0de-0000-7000-8000-000000000001';

beforeEach(() => {
  jest.clearAllMocks();
  consumeAll.mockResolvedValue({ ok: true });
  isAllowlisted.mockReturnValue(false);
});

// --- validation ------------------------------------------------------------------------------------
describe('input validation → ValidationError', () => {
  it.each([
    ['signUp', { email: 'not-an-email', name: 'Jane', password: 'x' }, 'email'],
    ['signUp', { email: 'jane@example.com', name: '   ', password: 'x' }, 'name'],
    ['signUp', { email: 'jane@example.com', name: 'Jane', password: 'x', device: { platform: 'windows' } }, 'device.platform'],
    ['login', { email: 'jane@example.com', password: '' }, 'password'],
    ['verifyLoginOtp', { challengeId: CHALLENGE_ID, code: '12345' }, 'code'],
    ['verifyLoginOtp', { challengeId: 'not-a-uuid', code: '123456' }, 'challengeId'],
    ['verifyEmail', { challengeId: CHALLENGE_ID, code: 'abcdef' }, 'code'],
    ['resendOtp', { challengeId: 'nope' }, 'challengeId'],
    ['refreshTokens', { refreshToken: 'short' }, 'refreshToken'],
    ['forgotPassword', { email: 'x' }, 'email'],
    ['resetPassword', { challengeId: CHALLENGE_ID, code: '123456', newPassword: 'x'.repeat(200) }, 'newPassword'],
  ])('%s rejects bad input (%j) on field %s', async (op, input, fieldName) => {
    await expect(mutate(op, input)).resolves.toMatchObject({ __typename: 'ValidationError', field: fieldName });
    expect(authService[op as keyof typeof authService]).not.toHaveBeenCalled();
  });
});

// --- rate limits -------------------------------------------------------------------------------
describe('per-operation rate limits', () => {
  it('signUp is limited per IP and passes clean input to the service', async () => {
    await mutate('signUp', { email: 'jane@example.com', name: '  Jane  ', password: 'pw', device: DEVICE });
    expect(consumeAll).toHaveBeenCalledWith([['signupIp', '203.0.113.10']]);
    expect(authService.signUp).toHaveBeenCalledWith(
      { email: 'jane@example.com', name: 'Jane', password: 'pw', device: DEVICE },
      client(),
    );
  });

  it('login is limited per IP+email and per IP per day', async () => {
    await mutate('login', { email: 'Jane@Example.com', password: 'pw' });
    expect(consumeAll).toHaveBeenCalledWith([
      ['loginIpEmail', '203.0.113.10:jane@example.com'],
      ['loginIpDaily', '203.0.113.10'],
    ]);
  });

  it('forgotPassword is limited per IP and per email', async () => {
    await mutate('forgotPassword', { email: 'jane@example.com' });
    expect(consumeAll).toHaveBeenCalledWith([
      ['forgotPasswordIp', '203.0.113.10'],
      ['forgotPasswordEmail', 'jane@example.com'],
    ]);
  });

  it.each([
    ['verifyEmail', { challengeId: CHALLENGE_ID, code: '123456' }, 'otpVerifyIp'],
    ['verifyLoginOtp', { challengeId: CHALLENGE_ID, code: '123456' }, 'otpVerifyIp'],
    ['resetPassword', { challengeId: CHALLENGE_ID, code: '123456', newPassword: 'N3w!Passw0rd' }, 'otpVerifyIp'],
    ['refreshTokens', { refreshToken: 'r'.repeat(43) }, 'refreshIp'],
  ])('%s is limited by %s', async (op, input, limiter) => {
    await mutate(op, input);
    expect(consumeAll).toHaveBeenCalledWith([[limiter, '203.0.113.10']]);
    expect(authService[op as keyof typeof authService]).toHaveBeenCalled();
  });

  it('returns RateLimited and audits it, without calling the service', async () => {
    consumeAll.mockResolvedValue({ ok: false, retryAfterSeconds: 42 });
    await expect(mutate('login', { email: 'jane@example.com', password: 'pw' })).resolves.toMatchObject({
      __typename: 'RateLimited',
      retryAfterSeconds: 42,
    });
    expect(authService.login).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'rate_limited', email: 'jane@example.com', metadata: { op: 'login' } }),
    );
  });

  it('skips limits for allowlisted IPs (e.g. load tests)', async () => {
    isAllowlisted.mockReturnValue(true);
    await mutate('signUp', { email: 'jane@example.com', name: 'Jane', password: 'pw' });
    expect(consumeAll).not.toHaveBeenCalled();
  });

  it('uses "unknown" as the key when the IP is missing', async () => {
    await mutate('signUp', { email: 'jane@example.com', name: 'Jane', password: 'pw' }, ctx(null, { client: client({ ip: null }) }));
    expect(consumeAll).toHaveBeenCalledWith([['signupIp', 'unknown']]);
  });

  it('resendOtp has no resolver-level limit (the OTP service enforces its own)', async () => {
    await mutate('resendOtp', { challengeId: CHALLENGE_ID });
    expect(consumeAll).not.toHaveBeenCalled();
    expect(authService.resendOtp).toHaveBeenCalledWith({ challengeId: CHALLENGE_ID }, client());
  });
});

// --- authentication ----------------------------------------------------------------------------
describe('protected operations', () => {
  it.each([
    ['Query', 'me', undefined],
    ['Query', 'mySessions', undefined],
    ['Query', 'myAuthEvents', {}],
    ['Mutation', 'logout', undefined],
    ['Mutation', 'revokeOtherSessions', undefined],
    ['Mutation', 'revokeSession', { input: { sessionId: CHALLENGE_ID } }],
    ['Mutation', 'setTwoFactor', { input: { enabled: false, password: 'pw' } }],
  ])('%s.%s requires a signed-in user', async (type, name, args) => {
    const fn = (type === 'Query' ? Q : M)[name]!;
    await expect(Promise.resolve().then(() => fn({}, args ?? {}, ctx(), {}))).rejects.toMatchObject({
      extensions: { code: 'UNAUTHENTICATED' },
    });
  });

  it('me loads the user through the per-request DataLoader', async () => {
    const u = user({ id: 'u1' });
    loadUser.mockResolvedValue(u);
    await expect(Q.me!({}, {}, signedIn(), {})).resolves.toBe(u);
    expect(loadUser).toHaveBeenCalledWith('u1');
  });

  it('me fails as UNAUTHENTICATED if the account was deleted', async () => {
    loadUser.mockResolvedValue(null);
    await expect(Q.me!({}, {}, signedIn(), {})).rejects.toMatchObject({ extensions: { code: 'UNAUTHENTICATED' } });
  });

  it('mySessions lists the caller’s sessions', async () => {
    await Q.mySessions!({}, {}, signedIn(), {});
    expect(listActive).toHaveBeenCalledWith('u1');
  });

  it('session mutations pass the caller’s identity to the service', async () => {
    await M.logout!({}, {}, signedIn(), {});
    expect(authService.logout).toHaveBeenCalledWith({ userId: 'u1', sessionId: 'current', role: 'customer' }, client());
    await M.revokeSession!({}, { input: { sessionId: CHALLENGE_ID } }, signedIn(), {});
    expect(authService.revokeSession).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }), CHALLENGE_ID, client());
  });

  it('revokeSession with a malformed id is NOT_FOUND', async () => {
    await expect(
      Promise.resolve().then(() => M.revokeSession!({}, { input: { sessionId: 'nope' } }, signedIn(), {})),
    ).rejects.toMatchObject({ extensions: { code: 'NOT_FOUND' } });
  });

  it('setTwoFactor with an invalid password value is InvalidCredentials', async () => {
    // Returns synchronously on invalid input, so wrap it in a promise.
    await expect(
      Promise.resolve(M.setTwoFactor!({}, { input: { enabled: true, password: '' } }, signedIn(), {})),
    ).resolves.toMatchObject({ __typename: 'InvalidCredentials' });
    expect(authService.setTwoFactor).not.toHaveBeenCalled();
  });
});

// --- pagination -------------------------------------------------------------------------------
describe('myAuthEvents pagination', () => {
  const event = (id: string) =>
    ({ id, type: 'login_success', ip: '1.2.3.4', userAgent: null, geoCity: null, geoCountry: null, createdAt: new Date() }) as AuthEventRow;
  const ids = ['0199c0de-0000-7000-8000-00000000000c', '0199c0de-0000-7000-8000-00000000000b', '0199c0de-0000-7000-8000-00000000000a'];

  it('fetches one extra row to know whether there is a next page', async () => {
    listForUser.mockResolvedValue(ids.map(event));
    const page = (await Q.myAuthEvents!({}, { first: 2 }, signedIn(), {})) as {
      edges: { cursor: string; node: AuthEventRow }[];
      pageInfo: { hasNextPage: boolean; endCursor: string };
    };
    expect(listForUser).toHaveBeenCalledWith('u1', { first: 2, afterId: undefined });
    expect(page.edges.map((e) => e.node.id)).toEqual(ids.slice(0, 2));
    expect(page.pageInfo.hasNextPage).toBe(true);

    // The end cursor decodes back to the last id on the page.
    listForUser.mockResolvedValue([]);
    await Q.myAuthEvents!({}, { first: 2, after: page.pageInfo.endCursor }, signedIn(), {});
    expect(listForUser).toHaveBeenLastCalledWith('u1', { first: 2, afterId: ids[1] });
  });

  it('reports the last page with no cursor when empty', async () => {
    listForUser.mockResolvedValue([]);
    await expect(Q.myAuthEvents!({}, {}, signedIn(), {})).resolves.toEqual({
      edges: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
    expect(listForUser).toHaveBeenCalledWith('u1', { first: 20, afterId: undefined });
  });

  it.each([
    [0, 1],
    [500, 100],
  ])('clamps first=%d to %d', async (first, clamped) => {
    listForUser.mockResolvedValue([]);
    await Q.myAuthEvents!({}, { first }, signedIn(), {});
    expect(listForUser).toHaveBeenCalledWith('u1', { first: clamped, afterId: undefined });
  });

  it('ignores a cursor that is not one of ours', async () => {
    listForUser.mockResolvedValue([]);
    await Q.myAuthEvents!({}, { after: Buffer.from('garbage').toString('base64url') }, signedIn(), {});
    expect(listForUser).toHaveBeenCalledWith('u1', { first: 20, afterId: undefined });
  });
});

// --- field resolvers ----------------------------------------------------------------------------
describe('type resolvers', () => {
  it('User: federation reference, enum casing and emailVerified', async () => {
    const u = user({ id: 'u1', role: 'admin', emailVerifiedAt: null });
    loadUser.mockResolvedValue(u);
    await expect(field('User', '__resolveReference')({ id: 'u1' }, ctx(), {} as never, {})).resolves.toBe(u);
    expect(field('User', 'role')(u, {}, ctx(), {})).toBe('ADMIN');
    expect(field('User', 'emailVerified')(u, {}, ctx(), {})).toBe(false);
  });

  it('Session: current flag, device, IPs and location', () => {
    const s = session({ id: 'current', loginMethod: 'password_otp', lastIp: '198.51.100.1' });
    expect(field('Session', 'isCurrent')(s, {}, signedIn(), {})).toBe(true);
    expect(field('Session', 'isCurrent')(session(), {}, signedIn(), {})).toBe(false);
    expect(field('Session', 'loginMethod')(s, {}, ctx(), {})).toBe('PASSWORD_OTP');
    expect(field('Session', 'device')(s, {}, ctx(), {})).toEqual({
      type: 'mobile',
      name: 'Pixel 9',
      os: null,
      browser: null,
      platform: 'android',
      appVersion: '1.0.0',
    });
    expect(field('Session', 'ipAddress')(s, {}, ctx(), {})).toBe('203.0.113.10');
    expect(field('Session', 'lastIpAddress')(s, {}, ctx(), {})).toBe('198.51.100.1');
    expect(field('Session', 'location')(s, {}, ctx(), {})).toEqual({
      city: 'Kolkata',
      region: 'West Bengal',
      country: 'India',
      countryCode: 'IN',
      latitude: 22.57,
      longitude: 88.36,
    });
  });

  it('Session: location is null when nothing is known', () => {
    const s = session({ geoCity: null, geoCountry: null });
    expect(field('Session', 'location')(s, {}, ctx(), {})).toBeNull();
  });

  it('AuthEvent: enum casing, IP and partial location', () => {
    const e = { type: 'refresh_reuse_detected', ip: '1.2.3.4', geoCity: null, geoCountry: 'India' };
    expect(field('AuthEvent', 'type')(e, {}, ctx(), {})).toBe('REFRESH_REUSE_DETECTED');
    expect(field('AuthEvent', 'ipAddress')(e, {}, ctx(), {})).toBe('1.2.3.4');
    expect(field('AuthEvent', 'location')(e, {}, ctx(), {})).toMatchObject({ country: 'India', city: null });
  });
});

describe('DateTime scalar', () => {
  const scalar = resolvers.DateTime as unknown as {
    serialize: (v: unknown) => string;
    parseValue: (v: unknown) => Date;
    parseLiteral: (ast: unknown) => Date | null;
  };

  it('serialises Dates and ISO strings to ISO-8601', () => {
    expect(scalar.serialize(new Date('2026-10-08T10:00:00Z'))).toBe('2026-10-08T10:00:00.000Z');
    expect(scalar.serialize('2026-10-08T10:00:00Z')).toBe('2026-10-08T10:00:00.000Z');
  });

  it('parses variables and string literals', () => {
    expect(scalar.parseValue('2026-10-08T10:00:00Z')).toEqual(new Date('2026-10-08T10:00:00Z'));
    expect(scalar.parseLiteral({ kind: Kind.STRING, value: '2026-10-08T10:00:00Z' })).toEqual(new Date('2026-10-08T10:00:00Z'));
    expect(scalar.parseLiteral({ kind: Kind.INT, value: '1' })).toBeNull();
  });
});
