import type { Request } from 'express';
import type { ClientInfo } from '../lib/request-context.js';
import { unauthenticated } from '../lib/results.js';
import { isSessionRevoked, verifyAccessToken, type AccessClaims } from '../modules/tokens/token.service.js';
import { createUserLoader } from '../modules/users/users.service.js';

export interface GraphQLContext {
  client: ClientInfo;
  /** Set when a valid, non-revoked access token was sent. */
  auth: AccessClaims | null;
  /** Why `auth` is null even though a token was sent; tells the client to refresh vs. sign in. */
  authError: 'expired' | 'invalid' | 'revoked' | null;
  loaders: { user: ReturnType<typeof createUserLoader> };
}

/**
 * Runs once per request. A bad or missing token doesn't fail the request here: public
 * mutations like `login` must still work. Protected resolvers call `requireAuth`.
 */
export async function buildContext({ req }: { req: Request }): Promise<GraphQLContext> {
  const ctx: GraphQLContext = {
    client: req.clientInfo,
    auth: null,
    authError: null,
    loaders: { user: createUserLoader() },
  };

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return ctx;

  const result = await verifyAccessToken(header.slice('Bearer '.length).trim());
  if (!result.ok) {
    ctx.authError = result.reason;
  } else if (await isSessionRevoked(result.claims.sessionId)) {
    ctx.authError = 'revoked';
  } else {
    ctx.auth = result.claims;
  }
  return ctx;
}

const AUTH_MESSAGES = {
  expired: 'Access token expired. Refresh it and retry.',
  invalid: 'Invalid access token.',
  revoked: 'This session was signed out.',
} as const;

export function requireAuth(ctx: GraphQLContext): AccessClaims {
  if (ctx.auth) return ctx.auth;
  const err = unauthenticated(ctx.authError ? AUTH_MESSAGES[ctx.authError] : undefined);
  if (ctx.authError) err.extensions.reason = ctx.authError.toUpperCase();
  throw err;
}
