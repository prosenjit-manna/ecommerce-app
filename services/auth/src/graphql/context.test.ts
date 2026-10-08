import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Request } from 'express';
import { type AnyFn, client, src } from '../../test/helpers/fixtures.js';

type Verify = { ok: true; claims: { userId: string; sessionId: string; role: 'customer' } } | { ok: false; reason: 'expired' | 'invalid' };
const verifyAccessToken = jest.fn<AnyFn>();
const isSessionRevoked = jest.fn<AnyFn>(async () => false);
jest.unstable_mockModule(src('modules/tokens/token.service.ts'), () => ({ verifyAccessToken, isSessionRevoked }));
jest.unstable_mockModule(src('modules/users/users.service.ts'), () => ({ createUserLoader: () => ({ load: jest.fn<AnyFn>() }) }));

const { buildContext, requireAuth } = await import('./context.js');

const claims = { userId: 'u1', sessionId: 's1', role: 'customer' as const };
const req = (authorization?: string) => ({ headers: authorization ? { authorization } : {}, clientInfo: client() }) as unknown as Request;

beforeEach(() => {
  verifyAccessToken.mockReset();
  isSessionRevoked.mockReset().mockResolvedValue(false);
});

describe('buildContext', () => {
  it('is anonymous without an Authorization header', async () => {
    const ctx = await buildContext({ req: req() });
    expect(ctx).toMatchObject({ auth: null, authError: null, client: client() });
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('ignores non-Bearer schemes', async () => {
    await expect(buildContext({ req: req('Basic abc') })).resolves.toMatchObject({ auth: null, authError: null });
  });

  it('sets ctx.auth for a valid, non-revoked token', async () => {
    verifyAccessToken.mockResolvedValue({ ok: true, claims });
    const ctx = await buildContext({ req: req('Bearer good') });
    expect(verifyAccessToken).toHaveBeenCalledWith('good');
    expect(ctx.auth).toEqual(claims);
    expect(isSessionRevoked).toHaveBeenCalledWith('s1');
  });

  it.each(['expired', 'invalid'] as const)('records why a %s token was not accepted', async (reason) => {
    verifyAccessToken.mockResolvedValue({ ok: false, reason });
    await expect(buildContext({ req: req('Bearer x') })).resolves.toMatchObject({ auth: null, authError: reason });
  });

  it('rejects a valid token whose session was signed out', async () => {
    verifyAccessToken.mockResolvedValue({ ok: true, claims });
    isSessionRevoked.mockResolvedValue(true);
    await expect(buildContext({ req: req('Bearer x') })).resolves.toMatchObject({ auth: null, authError: 'revoked' });
  });
});

describe('requireAuth', () => {
  const base = { client: client(), loaders: {} as never };

  it('returns the claims when signed in', () => {
    expect(requireAuth({ ...base, auth: claims, authError: null })).toBe(claims);
  });

  it('throws UNAUTHENTICATED without a token', () => {
    expect(() => requireAuth({ ...base, auth: null, authError: null })).toThrow(
      expect.objectContaining({ extensions: expect.objectContaining({ code: 'UNAUTHENTICATED' }) }),
    );
  });

  it.each([
    ['expired', 'EXPIRED', /Refresh/],
    ['revoked', 'REVOKED', /signed out/],
    ['invalid', 'INVALID', /Invalid/],
  ] as const)('tells the client the token was %s', (authError, reason, message) => {
    try {
      requireAuth({ ...base, auth: null, authError });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toMatchObject({ message: expect.stringMatching(message), extensions: { code: 'UNAUTHENTICATED', reason } });
    }
  });
});
