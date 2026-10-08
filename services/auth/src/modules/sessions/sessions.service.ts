import { env } from '../../config/env.js';
import { db, type DbOrTx } from '../../db/client.js';
import type { DeviceSnapshot } from '../../db/schema.js';
import type { ClientInfo } from '../../lib/request-context.js';
import { Result } from '../../lib/results.js';
import { authEventsRepository } from '../events/auth-events.repository.js';
import { hashRefreshToken, markSessionsRevoked, newRefreshToken, signAccessToken } from '../tokens/token.service.js';
import { usersRepository, type UserRow } from '../users/users.repository.js';
import { sessionsRepository, type SessionRow } from './sessions.repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AuthTokens {
  __typename: 'AuthTokens';
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

/** Refresh tokens slide forward 30 days on each use, but never past the session's absolute cap. */
const refreshExpiry = (session: SessionRow) =>
  new Date(Math.min(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS, session.expiresAt.getTime()));

async function issueTokens(
  user: UserRow,
  session: SessionRow,
  tx: DbOrTx,
): Promise<{ tokens: AuthTokens; refreshTokenId: string }> {
  const refresh = newRefreshToken();
  const refreshTokenExpiresAt = refreshExpiry(session);
  const row = await sessionsRepository.createRefreshToken(
    { sessionId: session.id, tokenHash: refresh.hash, expiresAt: refreshTokenExpiresAt },
    tx,
  );
  const access = await signAccessToken({ userId: user.id, sessionId: session.id, role: user.role });
  return {
    refreshTokenId: row.id,
    tokens: {
      __typename: 'AuthTokens',
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: refresh.token,
      refreshTokenExpiresAt,
    },
  };
}

export const sessionsService = {
  /** Creates a device session with its first refresh token. Records where and on what it started. */
  async create(
    input: {
      user: UserRow;
      method: SessionRow['loginMethod'];
      client: ClientInfo;
      device: DeviceSnapshot;
    },
    tx: DbOrTx = db,
  ): Promise<{ session: SessionRow; tokens: AuthTokens }> {
    const { user, client, device } = input;
    const geo = client.geo;
    const session = await sessionsRepository.create(
      {
        userId: user.id,
        loginMethod: input.method,
        createdIp: client.ip,
        lastIp: client.ip,
        ...device,
        geoCountryCode: geo?.countryCode ?? null,
        geoCountry: geo?.country ?? null,
        geoRegion: geo?.region ?? null,
        geoCity: geo?.city ?? null,
        geoLat: geo?.lat ?? null,
        geoLon: geo?.lon ?? null,
        expiresAt: new Date(Date.now() + env.SESSION_MAX_AGE_DAYS * DAY_MS),
      },
      tx,
    );
    const { tokens } = await issueTokens(user, session, tx);
    return { session, tokens };
  },

  /**
   * Rotating refresh: every refresh token works exactly once.
   * Presenting an already-used token means it was copied (stolen or leaked), so the whole
   * session is revoked: both the attacker and the real user must sign in again.
   */
  async refresh(refreshToken: string, client: ClientInfo) {
    const tokenHash = hashRefreshToken(refreshToken);

    const outcome = await db.transaction(async (tx) => {
      const token = await sessionsRepository.findRefreshTokenForUpdate(tokenHash, tx);
      if (!token) return { kind: 'invalid' as const };

      const session = await sessionsRepository.findById(token.sessionId, tx);
      if (!session || session.status !== 'active') return { kind: 'invalid' as const, session };

      if (token.usedAt) {
        await sessionsRepository.revoke({ sessionId: session.id }, 'refresh_token_reuse', tx);
        return { kind: 'reuse' as const, session };
      }
      if (token.expiresAt <= new Date() || session.expiresAt <= new Date()) {
        await sessionsRepository.markExpired(session.id, tx);
        return { kind: 'invalid' as const, session };
      }

      const user = await usersRepository.findById(session.userId, tx);
      if (!user || user.status !== 'active') {
        await sessionsRepository.revoke({ sessionId: session.id }, 'account_disabled', tx);
        return { kind: 'revoked' as const, session };
      }

      const { tokens, refreshTokenId } = await issueTokens(user, session, tx);
      await sessionsRepository.markRefreshTokenUsed(token.id, refreshTokenId, tx);
      await sessionsRepository.touch(session.id, client.ip, tx);
      return { kind: 'ok' as const, session, user, tokens };
    });

    switch (outcome.kind) {
      case 'ok':
        await authEventsRepository.record({
          type: 'refresh',
          client,
          userId: outcome.user.id,
          sessionId: outcome.session.id,
        });
        return outcome.tokens;
      case 'reuse':
        await markSessionsRevoked([outcome.session.id]);
        await authEventsRepository.record({
          type: 'refresh_reuse_detected',
          client,
          userId: outcome.session.userId,
          sessionId: outcome.session.id,
        });
        return Result.invalidRefreshToken();
      case 'revoked':
        await markSessionsRevoked([outcome.session.id]);
        return Result.invalidRefreshToken();
      default:
        return Result.invalidRefreshToken();
    }
  },

  listActive: (userId: string) => sessionsRepository.listActiveForUser(userId),

  /** Revokes sessions in Postgres and blacklists their live access tokens in Redis. */
  async revoke(
    where: Parameters<typeof sessionsRepository.revoke>[0],
    reason: string,
    audit: { client: ClientInfo; userId: string; type: 'logout' | 'session_revoked' },
  ): Promise<string[]> {
    const ids = await sessionsRepository.revoke(where, reason);
    await markSessionsRevoked(ids);
    for (const sessionId of ids) {
      await authEventsRepository.record({
        type: audit.type,
        client: audit.client,
        userId: audit.userId,
        sessionId,
        metadata: { reason },
      });
    }
    return ids;
  },
};
