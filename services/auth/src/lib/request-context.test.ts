import { describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { requestContext } from './request-context.js';
import type { AnyFn } from '../../test/helpers/fixtures.js';

function run(req: Partial<Request>) {
  const res = { setHeader: jest.fn<AnyFn>() } as unknown as Response;
  const next = jest.fn<AnyFn>() as unknown as NextFunction;
  const r = { headers: {}, ...req } as Request;
  requestContext(r, res, next);
  return { req: r, res, next };
}

describe('requestContext', () => {
  it('normalises IPv4-mapped IPv6 addresses and reads the User-Agent', () => {
    const { req, next } = run({ ip: '::ffff:203.0.113.5', headers: { 'user-agent': 'curl/8' } });
    expect(req.clientInfo).toMatchObject({ ip: '203.0.113.5', userAgent: 'curl/8', geo: null });
    expect(next).toHaveBeenCalled();
  });

  it('reuses an incoming x-request-id and echoes it back', () => {
    const { req, res } = run({ ip: '127.0.0.1', headers: { 'x-request-id': 'abc' } });
    expect(req.clientInfo.requestId).toBe('abc');
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'abc');
  });

  it('generates a request id when none is sent', () => {
    const { req } = run({ ip: undefined });
    expect(req.clientInfo.ip).toBeNull();
    expect(req.clientInfo.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
