import { generateKeyPairSync } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { SignJWT, importPKCS8 } from 'jose';
import { type AnyFn, src } from '../../../test/helpers/fixtures.js';

// Minimal in-memory Redis: just what the token service uses.
const store = new Map<string, string>();
const setCalls: unknown[][] = [];
const redis = {
  exists: jest.fn<AnyFn>(async (key: string) => (store.has(key) ? 1 : 0)),
  pipeline: () => {
    const ops: (() => void)[] = [];
    const p = {
      set: (...args: [string, string, ...unknown[]]) => {
        setCalls.push(args);
        ops.push(() => store.set(args[0], args[1]));
        return p;
      },
      exec: async () => ops.forEach((op) => op()),
    };
    return p;
  },
};
jest.unstable_mockModule(src('redis.ts'), () => ({ redis }));

const tokens = await import('./token.service.js');
const claims = { userId: 'user-1', sessionId: 'session-1', role: 'customer' as const };

beforeAll(async () => {
  await tokens.initTokenKeys();
});

describe('access tokens', () => {
  it('round-trips claims through sign and verify', async () => {
    const { token, expiresAt } = await tokens.signAccessToken(claims);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    await expect(tokens.verifyAccessToken(token)).resolves.toEqual({ ok: true, claims });
  });

  it('puts the key id and token type in the header', async () => {
    const { token } = await tokens.signAccessToken(claims);
    const header = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString());
    expect(header).toEqual({ alg: 'EdDSA', kid: 'test-key', typ: 'at+jwt' });
  });

  it('reports expired tokens separately, so clients know to refresh', async () => {
    jest.useFakeTimers({ now: Date.now() - 60 * 60_000, doNotFake: ['nextTick', 'setImmediate'] });
    const { token } = await tokens.signAccessToken(claims);
    jest.useRealTimers();
    await expect(tokens.verifyAccessToken(token)).resolves.toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a tampered token', async () => {
    const { token } = await tokens.signAccessToken(claims);
    const [h, p, s] = token.split('.');
    const payload = JSON.parse(Buffer.from(p!, 'base64url').toString());
    const forged = Buffer.from(JSON.stringify({ ...payload, role: 'admin' })).toString('base64url');
    await expect(tokens.verifyAccessToken(`${h}.${forged}.${s}`)).resolves.toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects a token signed by a different key', async () => {
    const other = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const token = await new SignJWT({ sid: 's', role: 'customer' })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'at+jwt' })
      .setIssuer('ecommerce-auth')
      .setAudience('ecommerce')
      .setSubject('u')
      .setExpirationTime('5m')
      .sign(await importPKCS8(other, 'EdDSA'));
    await expect(tokens.verifyAccessToken(token)).resolves.toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects garbage and tokens with missing claims', async () => {
    await expect(tokens.verifyAccessToken('not.a.jwt')).resolves.toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('jwks', () => {
  it('publishes only the public key', () => {
    const [key] = tokens.jwks().keys;
    expect(key).toMatchObject({ kty: 'OKP', crv: 'Ed25519', kid: 'test-key', alg: 'EdDSA', use: 'sig' });
    expect(key).not.toHaveProperty('d'); // the private part
  });
});

describe('session revocation list', () => {
  beforeEach(() => {
    store.clear();
    setCalls.length = 0;
  });

  it('remembers revoked sessions for one access-token lifetime', async () => {
    await tokens.markSessionsRevoked(['s1', 's2']);
    expect(setCalls).toEqual([
      ['auth:revoked-sid:s1', '1', 'EX', 900],
      ['auth:revoked-sid:s2', '1', 'EX', 900],
    ]);
    await expect(tokens.isSessionRevoked('s1')).resolves.toBe(true);
    await expect(tokens.isSessionRevoked('other')).resolves.toBe(false);
  });

  it('does nothing for an empty list', async () => {
    await tokens.markSessionsRevoked([]);
    expect(setCalls).toHaveLength(0);
  });
});

describe('refresh tokens', () => {
  it('stores only a hash of the opaque token', () => {
    const { token, hash } = tokens.newRefreshToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(tokens.hashRefreshToken(token)).toBe(hash);
  });
});
