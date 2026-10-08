import { randomUUID } from 'node:crypto';
import type { DeviceSnapshot } from '../../src/db/schema.js';
import type { ClientInfo } from '../../src/lib/request-context.js';
import type { OtpChallengeRow } from '../../src/modules/otp/otp.repository.js';
import type { RefreshTokenRow, SessionRow } from '../../src/modules/sessions/sessions.repository.js';
import type { UserRow } from '../../src/modules/users/users.repository.js';

/** Loose signature for test doubles: lets assertions check call arguments without fighting the types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFn = (...args: any[]) => any;

/**
 * Absolute path to a source module, for `jest.unstable_mockModule`.
 * ESM mocks must be registered by resolved path *before* the code under test is imported,
 * and an absolute path resolves the same no matter which file calls it.
 */
export const src = (path: string) => new URL(`../../src/${path}`, import.meta.url).pathname;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export const client = (overrides: Partial<ClientInfo> = {}): ClientInfo => ({
  ip: '203.0.113.10',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  geo: { countryCode: 'IN', country: 'India', region: 'West Bengal', city: 'Kolkata', lat: 22.57, lon: 88.36 },
  requestId: 'req-test',
  ...overrides,
});

export const device = (overrides: Partial<DeviceSnapshot> = {}): DeviceSnapshot => ({
  userAgent: 'okhttp/4.12.0',
  deviceType: 'mobile',
  deviceName: 'Pixel 9',
  os: null,
  browser: null,
  clientPlatform: 'android',
  appVersion: '1.0.0',
  clientDeviceId: 'device-1',
  ...overrides,
});

export const user = (overrides: Partial<UserRow> = {}): UserRow => ({
  id: randomUUID(),
  email: 'jane@example.com',
  name: 'Jane Doe',
  passwordHash: '$argon2id$fake',
  role: 'customer',
  status: 'active',
  emailVerifiedAt: new Date(Date.now() - DAY),
  twoFactorEnabled: true,
  passwordChangedAt: null,
  lastLoginAt: new Date(Date.now() - DAY),
  createdAt: new Date(Date.now() - 7 * DAY),
  updatedAt: new Date(Date.now() - DAY),
  ...overrides,
});

export const session = (overrides: Partial<SessionRow> = {}): SessionRow => ({
  id: randomUUID(),
  userId: randomUUID(),
  loginMethod: 'password_otp',
  status: 'active',
  revokedAt: null,
  revokeReason: null,
  createdIp: '203.0.113.10',
  lastIp: '203.0.113.10',
  userAgent: 'okhttp/4.12.0',
  deviceType: 'mobile',
  deviceName: 'Pixel 9',
  os: null,
  browser: null,
  clientPlatform: 'android',
  appVersion: '1.0.0',
  clientDeviceId: 'device-1',
  geoCountryCode: 'IN',
  geoCountry: 'India',
  geoRegion: 'West Bengal',
  geoCity: 'Kolkata',
  geoLat: 22.57,
  geoLon: 88.36,
  createdAt: new Date(Date.now() - DAY),
  lastSeenAt: new Date(Date.now() - MINUTE),
  expiresAt: new Date(Date.now() + 89 * DAY),
  ...overrides,
});

export const refreshToken = (overrides: Partial<RefreshTokenRow> = {}): RefreshTokenRow => ({
  id: randomUUID(),
  sessionId: randomUUID(),
  tokenHash: 'hash',
  expiresAt: new Date(Date.now() + 29 * DAY),
  usedAt: null,
  replacedById: null,
  createdAt: new Date(Date.now() - DAY),
  ...overrides,
});

export const challenge = (overrides: Partial<OtpChallengeRow> = {}): OtpChallengeRow => ({
  id: randomUUID(),
  userId: randomUUID(),
  email: 'jane@example.com',
  purpose: 'login',
  codeHash: '00',
  attempts: 0,
  maxAttempts: 5,
  sendCount: 1,
  lastSentAt: new Date(Date.now() - 2 * MINUTE),
  expiresAt: new Date(Date.now() + 8 * MINUTE),
  consumedAt: null,
  ip: '203.0.113.10',
  device: null,
  createdAt: new Date(Date.now() - 2 * MINUTE),
  ...overrides,
});
