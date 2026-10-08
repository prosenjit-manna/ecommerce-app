import { and, desc, eq, gt, ne, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '../../db/client.js';
import { refreshTokens, sessions } from '../../db/schema.js';

export type SessionRow = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;

const isLive = () => and(eq(sessions.status, 'active'), gt(sessions.expiresAt, sql`now()`));

export const sessionsRepository = {
  async create(data: NewSession, tx: DbOrTx = db): Promise<SessionRow> {
    const [row] = await tx.insert(sessions).values(data).returning();
    return row!;
  },

  async findById(id: string, tx: DbOrTx = db): Promise<SessionRow | undefined> {
    const [row] = await tx.select().from(sessions).where(eq(sessions.id, id)).limit(1);
    return row;
  },

  listActiveForUser(userId: string, tx: DbOrTx = db): Promise<SessionRow[]> {
    return tx
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isLive()))
      .orderBy(desc(sessions.lastSeenAt));
  },

  /** Has this user ever had a session from this device (by device id, else UA + country)? */
  async hasSeenDevice(
    userId: string,
    device: { clientDeviceId: string | null; userAgent: string | null; geoCountryCode: string | null },
    tx: DbOrTx = db,
  ): Promise<boolean> {
    const match = device.clientDeviceId
      ? eq(sessions.clientDeviceId, device.clientDeviceId)
      : and(
          device.userAgent ? eq(sessions.userAgent, device.userAgent) : sql`${sessions.userAgent} is null`,
          device.geoCountryCode
            ? eq(sessions.geoCountryCode, device.geoCountryCode)
            : sql`${sessions.geoCountryCode} is null`,
        );
    const [row] = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), match))
      .limit(1);
    return !!row;
  },

  async touch(id: string, ip: string | null, tx: DbOrTx = db): Promise<void> {
    await tx.update(sessions).set({ lastSeenAt: new Date(), lastIp: ip }).where(eq(sessions.id, id));
  },

  /** Revokes and returns the ids actually changed (so callers can blacklist them in Redis). */
  async revoke(
    where: { sessionId: string } | { userId: string; exceptSessionId?: string },
    reason: string,
    tx: DbOrTx = db,
  ): Promise<string[]> {
    const filter =
      'sessionId' in where
        ? eq(sessions.id, where.sessionId)
        : and(
            eq(sessions.userId, where.userId),
            where.exceptSessionId ? ne(sessions.id, where.exceptSessionId) : undefined,
          );
    const rows = await tx
      .update(sessions)
      .set({ status: 'revoked', revokedAt: new Date(), revokeReason: reason })
      .where(and(filter, eq(sessions.status, 'active')))
      .returning({ id: sessions.id });
    return rows.map((r) => r.id);
  },

  async markExpired(id: string, tx: DbOrTx = db): Promise<void> {
    await tx.update(sessions).set({ status: 'expired' }).where(and(eq(sessions.id, id), eq(sessions.status, 'active')));
  },

  // --- refresh tokens -------------------------------------------------------

  async createRefreshToken(
    data: { sessionId: string; tokenHash: string; expiresAt: Date },
    tx: DbOrTx = db,
  ): Promise<RefreshTokenRow> {
    const [row] = await tx.insert(refreshTokens).values(data).returning();
    return row!;
  },

  /** Row-locks the token so two concurrent refreshes with the same token are serialised. */
  async findRefreshTokenForUpdate(tokenHash: string, tx: DbOrTx): Promise<RefreshTokenRow | undefined> {
    const [row] = await tx
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1)
      .for('update');
    return row;
  },

  async markRefreshTokenUsed(id: string, replacedById: string, tx: DbOrTx): Promise<void> {
    await tx.update(refreshTokens).set({ usedAt: new Date(), replacedById }).where(eq(refreshTokens.id, id));
  },
};
