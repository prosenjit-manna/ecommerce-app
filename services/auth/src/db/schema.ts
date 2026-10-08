import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  inet,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Everything this service owns lives in the `auth` Postgres schema of the `auth` database. */
export const authSchema = pgSchema('auth');

// Postgres 18 has a native, time-ordered uuidv7(): good for B-tree index locality.
const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const userRole = authSchema.enum('user_role', ['customer', 'admin']);
export const userStatus = authSchema.enum('user_status', ['active', 'disabled']);
export const otpPurpose = authSchema.enum('otp_purpose', ['email_verify', 'login', 'password_reset']);
export const loginMethod = authSchema.enum('login_method', ['password_otp', 'password', 'email_verify']);
export const sessionStatus = authSchema.enum('session_status', ['active', 'revoked', 'expired']);
export const authEventType = authSchema.enum('auth_event_type', [
  'signup',
  'email_verified',
  'login_password_ok',
  'login_failed',
  'otp_sent',
  'otp_failed',
  'login_success',
  'refresh',
  'refresh_reuse_detected',
  'logout',
  'session_revoked',
  'password_reset_requested',
  'password_reset',
  'rate_limited',
]);

/** Device details captured at login and copied onto the session. */
export interface DeviceSnapshot {
  userAgent: string | null;
  deviceType: string | null;
  deviceName: string | null;
  os: string | null;
  browser: string | null;
  clientPlatform: string | null;
  appVersion: string | null;
  clientDeviceId: string | null;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------
export const users = authSchema.table(
  'users',
  {
    id: id(),
    email: text('email').notNull(), // always stored lowercased + trimmed
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: userRole('role').notNull().default('customer'),
    status: userStatus('status').notNull().default('active'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(true),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email)],
);

export const otpChallenges = authSchema.table(
  'otp_challenges',
  {
    id: id(), // exposed to clients as challengeId
    // Null for password-reset requests on unknown emails: the challenge can never verify,
    // but the response looks identical, so it doesn't reveal whether the account exists.
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    purpose: otpPurpose('purpose').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull(),
    sendCount: integer('send_count').notNull().default(1),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    ip: inet('ip'),
    device: jsonb('device').$type<DeviceSnapshot>(),
    createdAt: createdAt(),
  },
  (t) => [index('otp_challenges_email_purpose_idx').on(t.email, t.purpose, t.createdAt)],
);

export const sessions = authSchema.table(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    loginMethod: loginMethod('login_method').notNull(),
    status: sessionStatus('status').notNull().default('active'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeReason: text('revoke_reason'),

    // Where the session started vs. where it was last used (updated on refresh).
    createdIp: inet('created_ip'),
    lastIp: inet('last_ip'),

    userAgent: text('user_agent'),
    deviceType: text('device_type'),
    deviceName: text('device_name'),
    os: text('os'),
    browser: text('browser'),
    clientPlatform: text('client_platform'),
    appVersion: text('app_version'),
    clientDeviceId: text('client_device_id'),

    geoCountryCode: text('geo_country_code'),
    geoCountry: text('geo_country'),
    geoRegion: text('geo_region'),
    geoCity: text('geo_city'),
    geoLat: doublePrecision('geo_lat'),
    geoLon: doublePrecision('geo_lon'),

    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), // absolute cap
  },
  (t) => [index('sessions_user_status_idx').on(t.userId, t.status)],
);

export const refreshTokens = authSchema.table(
  'refresh_tokens',
  {
    id: id(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(), // sha256(token), never the token itself
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    replacedById: uuid('replaced_by_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_hash_uq').on(t.tokenHash),
    index('refresh_tokens_session_idx').on(t.sessionId),
  ],
);

export const authEvents = authSchema.table(
  'auth_events',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id'),
    email: text('email'),
    type: authEventType('type').notNull(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    geoCountry: text('geo_country'),
    geoCity: text('geo_city'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('auth_events_user_created_idx').on(t.userId, t.createdAt.desc())],
);
