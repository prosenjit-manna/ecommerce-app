import type { NextFunction, Request, Response } from 'express';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { env } from '../config/env.js';
import { redis } from '../redis.js';
import { logger } from './logger.js';

interface LimiterConfig {
  points: number; // allowed actions…
  duration: number; // …per this many seconds
  blockDuration?: number; // seconds to block once exceeded (default: until the window resets)
}

/**
 * Every limit in one place. Keys are chosen per limiter (IP, email, IP+email, session, ...).
 * Single-endpoint GraphQL means URL-based limits can't tell `login` from `products`,
 * so the per-operation limits are applied inside resolvers.
 */
const LIMITS = {
  globalIp: { points: 300, duration: 60 },

  signupIp: { points: 5, duration: 60 * 60 },

  loginIpEmail: { points: 10, duration: 15 * 60 },
  loginIpDaily: { points: 100, duration: 24 * 60 * 60 },
  // Counts consecutive wrong passwords per email; reset on a successful password check.
  loginFailuresEmail: { points: 10, duration: 15 * 60, blockDuration: 15 * 60 },

  otpVerifyIp: { points: 20, duration: 15 * 60 },
  otpSendEmail: { points: 10, duration: 60 * 60 },

  forgotPasswordEmail: { points: 3, duration: 60 * 60 },
  forgotPasswordIp: { points: 10, duration: 60 * 60 },

  refreshIp: { points: 60, duration: 60 },
} satisfies Record<string, LimiterConfig>;

export type LimiterName = keyof typeof LIMITS;

const limiters = Object.fromEntries(
  Object.entries(LIMITS).map(([name, cfg]) => [
    name,
    new RateLimiterRedis({ storeClient: redis, keyPrefix: `auth:rl:${name}`, ...cfg }),
  ]),
) as Record<LimiterName, RateLimiterRedis>;

export type LimitOutcome = { ok: true } | { ok: false; retryAfterSeconds: number };

const retryAfter = (res: RateLimiterRes) => Math.max(1, Math.ceil(res.msBeforeNext / 1000));

/** Consumes one point. Fails open if Redis is down (availability over strictness; logged loudly). */
export async function consume(name: LimiterName, key: string, points = 1): Promise<LimitOutcome> {
  try {
    await limiters[name].consume(key, points);
    return { ok: true };
  } catch (err) {
    if (err instanceof RateLimiterRes) return { ok: false, retryAfterSeconds: retryAfter(err) };
    logger.error({ err, limiter: name }, 'Rate limiter unavailable; allowing request');
    return { ok: true };
  }
}

/** Consumes from several limiters; the first one exhausted wins. */
export async function consumeAll(checks: [LimiterName, string][]): Promise<LimitOutcome> {
  for (const [name, key] of checks) {
    const outcome = await consume(name, key);
    if (!outcome.ok) return outcome;
  }
  return { ok: true };
}

/** Read-only check: is this key already over its limit? Used for the brute-force counter. */
export async function isBlocked(name: LimiterName, key: string): Promise<LimitOutcome> {
  try {
    const res = await limiters[name].get(key);
    if (res && res.consumedPoints >= LIMITS[name].points) return { ok: false, retryAfterSeconds: retryAfter(res) };
    return { ok: true };
  } catch (err) {
    logger.error({ err, limiter: name }, 'Rate limiter unavailable; allowing request');
    return { ok: true };
  }
}

export async function resetLimit(name: LimiterName, key: string): Promise<void> {
  try {
    await limiters[name].delete(key);
  } catch (err) {
    logger.error({ err, limiter: name }, 'Failed to reset rate limiter');
  }
}

/** Express middleware: coarse per-IP limit on the whole /graphql endpoint. */
export async function globalRateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ip = req.clientInfo.ip ?? 'unknown';
  if (env.RATE_LIMIT_ALLOWLIST.includes(ip)) return next();

  const outcome = await consume('globalIp', ip);
  if (outcome.ok) return next();
  res.set('Retry-After', String(outcome.retryAfterSeconds));
  res.status(429).json({
    errors: [{ message: 'Too many requests', extensions: { code: 'RATE_LIMITED', retryAfterSeconds: outcome.retryAfterSeconds } }],
  });
}

export const isAllowlisted = (ip: string | null) => !!ip && env.RATE_LIMIT_ALLOWLIST.includes(ip);
