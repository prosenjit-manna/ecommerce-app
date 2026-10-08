import { randomUUID } from 'node:crypto';
import { errors as joseErrors, exportJWK, importPKCS8, importSPKI, jwtVerify, SignJWT, type JWK } from 'jose';
import { env } from '../../config/env.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { redis } from '../../redis.js';

const ALG = 'EdDSA'; // Ed25519: small keys, fast, and asymmetric so other services verify with the public key only.

type PrivateKey = Awaited<ReturnType<typeof importPKCS8>>;
type PublicKey = Awaited<ReturnType<typeof importSPKI>>;
let privateKey: PrivateKey;
let publicKey: PublicKey;
let publicJwk: JWK;

export async function initTokenKeys(): Promise<void> {
  privateKey = await importPKCS8(env.JWT_PRIVATE_KEY, ALG);
  publicKey = await importSPKI(env.JWT_PUBLIC_KEY, ALG, { extractable: true });
  publicJwk = { ...(await exportJWK(publicKey)), kid: env.JWT_KEY_ID, alg: ALG, use: 'sig' };
}

/** Served at /.well-known/jwks.json so the router or other subgraphs can verify access tokens. */
export const jwks = () => ({ keys: [publicJwk] });

export interface AccessClaims {
  userId: string;
  sessionId: string;
  role: 'customer' | 'admin';
}

export async function signAccessToken(claims: AccessClaims): Promise<{ token: string; expiresAt: Date }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + env.ACCESS_TOKEN_TTL_SECONDS;
  const token = await new SignJWT({ sid: claims.sessionId, role: claims.role })
    .setProtectedHeader({ alg: ALG, kid: env.JWT_KEY_ID, typ: 'at+jwt' })
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setSubject(claims.userId)
    .setJti(randomUUID())
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(privateKey);
  return { token, expiresAt: new Date(exp * 1000) };
}

export type VerifyResult = { ok: true; claims: AccessClaims } | { ok: false; reason: 'expired' | 'invalid' };

export async function verifyAccessToken(token: string): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: [ALG],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      typ: 'at+jwt',
    });
    const { sub, sid, role } = payload;
    if (typeof sub !== 'string' || typeof sid !== 'string' || (role !== 'customer' && role !== 'admin')) {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, claims: { userId: sub, sessionId: sid, role } };
  } catch (err) {
    return { ok: false, reason: err instanceof joseErrors.JWTExpired ? 'expired' : 'invalid' };
  }
}

// --- Revocation of still-valid access tokens --------------------------------------------------
// JWTs are stateless, so a revoked session's access token would keep working until it expires.
// We remember revoked session ids in Redis for exactly one access-token lifetime; after that,
// any token for that session has expired on its own.

const revokedKey = (sessionId: string) => `auth:revoked-sid:${sessionId}`;

export async function markSessionsRevoked(sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return;
  const pipeline = redis.pipeline();
  for (const id of sessionIds) pipeline.set(revokedKey(id), '1', 'EX', env.ACCESS_TOKEN_TTL_SECONDS);
  await pipeline.exec();
}

export async function isSessionRevoked(sessionId: string): Promise<boolean> {
  return (await redis.exists(revokedKey(sessionId))) === 1;
}

// --- Refresh tokens -----------------------------------------------------------------------------

/** Opaque random token; only its sha256 is stored, so a DB leak can't be replayed. */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomToken(32);
  return { token, hash: sha256(token) };
}

export const hashRefreshToken = (token: string) => sha256(token);
