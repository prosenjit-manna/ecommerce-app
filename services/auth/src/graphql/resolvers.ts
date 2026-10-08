import { GraphQLScalarType, Kind } from 'graphql';
import { z } from 'zod';
import { PASSWORD_MAX_LENGTH } from '../lib/password.js';
import { consumeAll, isAllowlisted, type LimiterName } from '../lib/rate-limit.js';
import { notFound, Result, unauthenticated } from '../lib/results.js';
import { authService } from '../modules/auth/auth.service.js';
import { authEventsRepository } from '../modules/events/auth-events.repository.js';
import { sessionsService } from '../modules/sessions/sessions.service.js';
import { normalizeEmail } from '../modules/users/users.service.js';
import { requireAuth, type GraphQLContext } from './context.js';
import type { Resolvers } from './generated.js';

// ---------------------------------------------------------------------------
// Input validation (zod). Failures become the `ValidationError` union member.
// ---------------------------------------------------------------------------
const email = z.email('Enter a valid email address').max(254);
const password = z.string().min(1, 'Password is required').max(PASSWORD_MAX_LENGTH);
const otpCode = z.string().regex(/^\d{6}$/, 'The code is 6 digits');
const challengeId = z.uuid('Invalid challenge id');
const device = z
  .object({
    platform: z.enum(['ios', 'android', 'web']).nullish(),
    deviceName: z.string().max(100).nullish(),
    appVersion: z.string().max(50).nullish(),
    deviceId: z.string().max(100).nullish(),
  })
  .nullish();

const Inputs = {
  signUp: z.object({ email, name: z.string().trim().min(1, 'Name is required').max(100), password, device }),
  verifyEmail: z.object({ challengeId, code: otpCode, device }),
  login: z.object({ email, password, device }),
  verifyLoginOtp: z.object({ challengeId, code: otpCode }),
  resendOtp: z.object({ challengeId }),
  refreshTokens: z.object({ refreshToken: z.string().min(20).max(200) }),
  forgotPassword: z.object({ email }),
  resetPassword: z.object({ challengeId, code: otpCode, newPassword: password }),
};

type Parsed<T extends z.ZodType> = { ok: true; data: z.infer<T> } | { ok: false; error: ReturnType<typeof Result.validationError> };

function parse<T extends z.ZodType>(schema: T, input: unknown): Parsed<T> {
  const r = schema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  const issue = r.error.issues[0]!;
  return { ok: false, error: Result.validationError(issue.path.join('.') || 'input', issue.message) };
}

// ---------------------------------------------------------------------------
// Per-operation rate limits (the global per-IP limit runs as Express middleware).
// ---------------------------------------------------------------------------
async function limit(ctx: GraphQLContext, op: string, checks: [LimiterName, string][], email?: string) {
  if (isAllowlisted(ctx.client.ip)) return null;
  const outcome = await consumeAll(checks);
  if (outcome.ok) return null;
  await authEventsRepository.record({
    type: 'rate_limited',
    client: ctx.client,
    userId: ctx.auth?.userId ?? null,
    email: email ?? null,
    metadata: { op },
  });
  return Result.rateLimited(outcome.retryAfterSeconds);
}

const ipKey = (ctx: GraphQLContext) => ctx.client.ip ?? 'unknown';

// Opaque cursor for keyset pagination (the event's uuidv7 id).
const encodeCursor = (id: string) => Buffer.from(id).toString('base64url');
const decodeCursor = (cursor: string) => {
  const id = Buffer.from(cursor, 'base64url').toString();
  return z.uuid().safeParse(id).success ? id : undefined;
};

const DateTime = new GraphQLScalarType<Date | null, string>({
  name: 'DateTime',
  description: 'ISO-8601 timestamp, e.g. 2026-10-08T12:00:00.000Z',
  serialize: (v) => (v instanceof Date ? v : new Date(v as string)).toISOString(),
  parseValue: (v) => new Date(v as string),
  parseLiteral: (ast) => (ast.kind === Kind.STRING ? new Date(ast.value) : null),
});

const location = (l: {
  city: string | null;
  region?: string | null;
  country: string | null;
  countryCode?: string | null;
  lat?: number | null;
  lon?: number | null;
}) =>
  l.city || l.country
    ? {
        city: l.city,
        region: l.region ?? null,
        country: l.country,
        countryCode: l.countryCode ?? null,
        latitude: l.lat ?? null,
        longitude: l.lon ?? null,
      }
    : null;

type Upper<T extends string> = Uppercase<T>;
const upper = <T extends string>(v: T) => v.toUpperCase() as Upper<T>;

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------
export const resolvers: Resolvers = {
  DateTime,

  Query: {
    me: async (_p, _a, ctx) => {
      const { userId } = requireAuth(ctx);
      const user = await ctx.loaders.user.load(userId);
      if (!user) throw unauthenticated('Account no longer exists.');
      return user;
    },
    mySessions: (_p, _a, ctx) => sessionsService.listActive(requireAuth(ctx).userId),
    myAuthEvents: async (_p, args, ctx) => {
      const { userId } = requireAuth(ctx);
      const first = Math.min(Math.max(args.first ?? 20, 1), 100);
      const rows = await authEventsRepository.listForUser(userId, {
        first,
        afterId: args.after ? decodeCursor(args.after) : undefined,
      });
      const page = rows.slice(0, first);
      return {
        edges: page.map((node) => ({ cursor: encodeCursor(node.id), node })),
        pageInfo: { hasNextPage: rows.length > first, endCursor: page.length ? encodeCursor(page.at(-1)!.id) : null },
      };
    },
  },

  Mutation: {
    signUp: async (_p, { input }, ctx) => {
      const p = parse(Inputs.signUp, input);
      if (!p.ok) return p.error;
      const limited = await limit(ctx, 'signUp', [['signupIp', ipKey(ctx)]], p.data.email);
      return limited ?? authService.signUp(p.data, ctx.client);
    },

    verifyEmail: async (_p, { input }, ctx) => {
      const p = parse(Inputs.verifyEmail, input);
      if (!p.ok) return p.error;
      const limited = await limit(ctx, 'verifyEmail', [['otpVerifyIp', ipKey(ctx)]]);
      return limited ?? authService.verifyEmail(p.data, ctx.client);
    },

    login: async (_p, { input }, ctx) => {
      const p = parse(Inputs.login, input);
      if (!p.ok) return p.error;
      const e = normalizeEmail(p.data.email);
      const limited = await limit(
        ctx,
        'login',
        [
          ['loginIpEmail', `${ipKey(ctx)}:${e}`],
          ['loginIpDaily', ipKey(ctx)],
        ],
        e,
      );
      return limited ?? authService.login(p.data, ctx.client);
    },

    verifyLoginOtp: async (_p, { input }, ctx) => {
      const p = parse(Inputs.verifyLoginOtp, input);
      if (!p.ok) return p.error;
      const limited = await limit(ctx, 'verifyLoginOtp', [['otpVerifyIp', ipKey(ctx)]]);
      return limited ?? authService.verifyLoginOtp(p.data, ctx.client);
    },

    resendOtp: async (_p, { input }, ctx) => {
      const p = parse(Inputs.resendOtp, input);
      if (!p.ok) return p.error;
      // Cooldown, per-challenge and per-email send caps are enforced in otpService.resend.
      return authService.resendOtp(p.data, ctx.client);
    },

    refreshTokens: async (_p, { input }, ctx) => {
      const p = parse(Inputs.refreshTokens, input);
      if (!p.ok) return p.error;
      // Keyed by IP: each refresh token is single-use, so a per-token key would never fill up.
      // This mainly slows down guessing of random refresh tokens.
      const limited = await limit(ctx, 'refreshTokens', [['refreshIp', ipKey(ctx)]]);
      return limited ?? authService.refreshTokens(p.data, ctx.client);
    },

    forgotPassword: async (_p, { input }, ctx) => {
      const p = parse(Inputs.forgotPassword, input);
      if (!p.ok) return p.error;
      const e = normalizeEmail(p.data.email);
      const limited = await limit(
        ctx,
        'forgotPassword',
        [
          ['forgotPasswordIp', ipKey(ctx)],
          ['forgotPasswordEmail', e],
        ],
        e,
      );
      return limited ?? authService.forgotPassword(p.data, ctx.client);
    },

    resetPassword: async (_p, { input }, ctx) => {
      const p = parse(Inputs.resetPassword, input);
      if (!p.ok) return p.error;
      const limited = await limit(ctx, 'resetPassword', [['otpVerifyIp', ipKey(ctx)]]);
      return limited ?? authService.resetPassword(p.data, ctx.client);
    },

    logout: (_p, _a, ctx) => authService.logout(requireAuth(ctx), ctx.client),

    revokeSession: async (_p, { input }, ctx) => {
      const auth = requireAuth(ctx);
      const p = parse(z.object({ sessionId: z.uuid() }), input);
      if (!p.ok) throw notFound('Session not found.');
      return authService.revokeSession(auth, p.data.sessionId, ctx.client);
    },

    revokeOtherSessions: (_p, _a, ctx) => authService.revokeOtherSessions(requireAuth(ctx), ctx.client),

    setTwoFactor: (_p, { input }, ctx) => {
      const auth = requireAuth(ctx);
      const p = parse(z.object({ enabled: z.boolean(), password }), input);
      if (!p.ok) return Result.invalidCredentials();
      return authService.setTwoFactor(auth, p.data);
    },
  },

  User: {
    // Federation: other subgraphs send { __typename: "User", id } and we return the full user.
    __resolveReference: (ref, ctx) => ctx.loaders.user.load(ref.id),
    role: (u) => upper(u.role),
    emailVerified: (u) => u.emailVerifiedAt !== null,
  },

  Session: {
    isCurrent: (s, _a, ctx) => s.id === ctx.auth?.sessionId,
    loginMethod: (s) => upper(s.loginMethod),
    device: (s) => ({
      type: s.deviceType,
      name: s.deviceName,
      os: s.os,
      browser: s.browser,
      platform: s.clientPlatform,
      appVersion: s.appVersion,
    }),
    ipAddress: (s) => s.createdIp,
    lastIpAddress: (s) => s.lastIp,
    location: (s) =>
      location({
        city: s.geoCity,
        region: s.geoRegion,
        country: s.geoCountry,
        countryCode: s.geoCountryCode,
        lat: s.geoLat,
        lon: s.geoLon,
      }),
  },

  AuthEvent: {
    type: (e) => upper(e.type),
    ipAddress: (e) => e.ip,
    location: (e) => location({ city: e.geoCity, country: e.geoCountry }),
  },
};
