import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { type AnyFn, src } from '../../test/helpers/fixtures.js';

// A stand-in for rate-limiter-flexible: every limiter instance shares these mocks.
class RateLimiterRes {
  constructor(
    public msBeforeNext = 0,
    public consumedPoints = 0,
  ) {}
}
const consumeMock = jest.fn<AnyFn>();
const getMock = jest.fn<AnyFn>();
const deleteMock = jest.fn<AnyFn>();

jest.unstable_mockModule('rate-limiter-flexible', () => ({
  RateLimiterRes,
  RateLimiterRedis: class {
    consume = consumeMock;
    get = getMock;
    delete = deleteMock;
  },
}));
jest.unstable_mockModule(src('redis.ts'), () => ({ redis: {} }));

const { consume, consumeAll, globalRateLimit, isAllowlisted, isBlocked, resetLimit } = await import(
  './rate-limit.js'
);

describe('consume', () => {
  beforeEach(() => {
    consumeMock.mockReset();
    getMock.mockReset();
    deleteMock.mockReset();
  });

  it('allows when the limiter has points left', async () => {
    consumeMock.mockResolvedValue(new RateLimiterRes());
    await expect(consume('signupIp', '1.2.3.4')).resolves.toEqual({ ok: true });
  });

  it('blocks and rounds retryAfter up to whole seconds', async () => {
    consumeMock.mockRejectedValue(new RateLimiterRes(1500));
    await expect(consume('signupIp', '1.2.3.4')).resolves.toEqual({ ok: false, retryAfterSeconds: 2 });
  });

  it('never reports less than 1 second', async () => {
    consumeMock.mockRejectedValue(new RateLimiterRes(0));
    await expect(consume('signupIp', '1.2.3.4')).resolves.toEqual({ ok: false, retryAfterSeconds: 1 });
  });

  it('fails open when Redis is down', async () => {
    consumeMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(consume('signupIp', '1.2.3.4')).resolves.toEqual({ ok: true });
  });

  it('consumeAll stops at the first exhausted limiter', async () => {
    consumeMock.mockResolvedValueOnce(new RateLimiterRes()).mockRejectedValueOnce(new RateLimiterRes(5000));
    const outcome = await consumeAll([
      ['loginIpEmail', 'a'],
      ['loginIpDaily', 'b'],
      ['signupIp', 'c'],
    ]);
    expect(outcome).toEqual({ ok: false, retryAfterSeconds: 5 });
    expect(consumeMock).toHaveBeenCalledTimes(2);
  });
});

describe('isBlocked (brute-force counter)', () => {
  beforeEach(() => {
  getMock.mockReset();
});

  it('is not blocked below the limit', async () => {
    getMock.mockResolvedValue(new RateLimiterRes(60_000, 9));
    await expect(isBlocked('loginFailuresEmail', 'jane@example.com')).resolves.toEqual({ ok: true });
  });

  it('is blocked once the failures reach the limit', async () => {
    getMock.mockResolvedValue(new RateLimiterRes(60_000, 10));
    await expect(isBlocked('loginFailuresEmail', 'jane@example.com')).resolves.toEqual({
      ok: false,
      retryAfterSeconds: 60,
    });
  });

  it('is not blocked for an unknown key, or when Redis is down', async () => {
    getMock.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('down'));
    await expect(isBlocked('loginFailuresEmail', 'x')).resolves.toEqual({ ok: true });
    await expect(isBlocked('loginFailuresEmail', 'x')).resolves.toEqual({ ok: true });
  });

  it('resetLimit deletes the key and swallows Redis errors', async () => {
    deleteMock.mockRejectedValue(new Error('down'));
    await expect(resetLimit('loginFailuresEmail', 'x')).resolves.toBeUndefined();
    expect(deleteMock).toHaveBeenCalledWith('x');
  });
});

describe('globalRateLimit middleware', () => {
  function call(ip: string | null) {
    const res = { set: jest.fn<AnyFn>(), status: jest.fn<AnyFn>(), json: jest.fn<AnyFn>() } as unknown as Response;
    (res.status as jest.Mock).mockReturnValue(res);
    const next = jest.fn<AnyFn>() as unknown as NextFunction;
    const req = { clientInfo: { ip } } as Request;
    return { run: () => globalRateLimit(req, res, next), res, next };
  }

  beforeEach(() => {
  consumeMock.mockReset();
});

  it('calls next() while under the limit', async () => {
    consumeMock.mockResolvedValue(new RateLimiterRes());
    const { run, next } = call('1.2.3.4');
    await run();
    expect(next).toHaveBeenCalled();
  });

  it('answers 429 with Retry-After and a GraphQL-shaped error when over the limit', async () => {
    consumeMock.mockRejectedValue(new RateLimiterRes(30_000));
    const { run, res, next } = call('1.2.3.4');
    await run();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith('Retry-After', '30');
    expect(res.json).toHaveBeenCalledWith({
      errors: [expect.objectContaining({ extensions: { code: 'RATE_LIMITED', retryAfterSeconds: 30 } })],
    });
  });

  it('isAllowlisted is false when the allowlist is empty', () => {
    expect(isAllowlisted('1.2.3.4')).toBe(false);
    expect(isAllowlisted(null)).toBe(false);
  });
});
