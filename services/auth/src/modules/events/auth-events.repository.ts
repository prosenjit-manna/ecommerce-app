import { and, desc, eq, lt } from 'drizzle-orm';
import { db, type DbOrTx } from '../../db/client.js';
import { authEvents } from '../../db/schema.js';
import type { ClientInfo } from '../../lib/request-context.js';
import { logger } from '../../lib/logger.js';

export type AuthEventRow = typeof authEvents.$inferSelect;
export type AuthEventType = AuthEventRow['type'];

export interface RecordEventInput {
  type: AuthEventType;
  client: ClientInfo;
  userId?: string | null;
  sessionId?: string | null;
  email?: string | null;
  metadata?: Record<string, unknown>;
}

export const authEventsRepository = {
  /** Audit writes must never break the auth flow, so failures are logged and swallowed. */
  async record(input: RecordEventInput, tx: DbOrTx = db): Promise<void> {
    try {
      await tx.insert(authEvents).values({
        type: input.type,
        userId: input.userId ?? null,
        sessionId: input.sessionId ?? null,
        email: input.email ?? null,
        ip: input.client.ip,
        userAgent: input.client.userAgent,
        geoCountry: input.client.geo?.country ?? null,
        geoCity: input.client.geo?.city ?? null,
        metadata: input.metadata ?? null,
      });
    } catch (err) {
      logger.error({ err, type: input.type }, 'Failed to record auth event');
    }
  },

  /** Keyset pagination on the time-ordered uuidv7 id: newest first, stable under inserts. */
  listForUser(userId: string, opts: { first: number; afterId?: string }, tx: DbOrTx = db): Promise<AuthEventRow[]> {
    return tx
      .select()
      .from(authEvents)
      .where(and(eq(authEvents.userId, userId), opts.afterId ? lt(authEvents.id, opts.afterId) : undefined))
      .orderBy(desc(authEvents.id))
      .limit(opts.first + 1); // one extra row tells us whether there's a next page
  },
};
