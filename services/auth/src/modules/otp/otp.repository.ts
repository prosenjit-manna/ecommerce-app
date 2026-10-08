import { and, eq, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '../../db/client.js';
import { otpChallenges } from '../../db/schema.js';

export type OtpChallengeRow = typeof otpChallenges.$inferSelect;
export type NewOtpChallenge = typeof otpChallenges.$inferInsert;

export const otpRepository = {
  async create(data: NewOtpChallenge, tx: DbOrTx = db): Promise<OtpChallengeRow> {
    const [row] = await tx.insert(otpChallenges).values(data).returning();
    return row!;
  },

  async findById(id: string, tx: DbOrTx = db): Promise<OtpChallengeRow | undefined> {
    const [row] = await tx.select().from(otpChallenges).where(eq(otpChallenges.id, id)).limit(1);
    return row;
  },

  /** Atomic increment so two parallel guesses can't both slip under max_attempts. */
  async incrementAttempts(id: string, tx: DbOrTx = db): Promise<number> {
    const [row] = await tx
      .update(otpChallenges)
      .set({ attempts: sql`${otpChallenges.attempts} + 1` })
      .where(eq(otpChallenges.id, id))
      .returning({ attempts: otpChallenges.attempts });
    return row?.attempts ?? Number.MAX_SAFE_INTEGER;
  },

  /** Marks consumed only if nobody else did first; returns false if it lost the race. */
  async consume(id: string, tx: DbOrTx = db): Promise<boolean> {
    const rows = await tx
      .update(otpChallenges)
      .set({ consumedAt: new Date() })
      .where(and(eq(otpChallenges.id, id), sql`${otpChallenges.consumedAt} is null`))
      .returning({ id: otpChallenges.id });
    return rows.length === 1;
  },

  async resend(id: string, data: { codeHash: string; expiresAt: Date }, tx: DbOrTx = db): Promise<OtpChallengeRow> {
    const [row] = await tx
      .update(otpChallenges)
      .set({
        codeHash: data.codeHash,
        expiresAt: data.expiresAt,
        attempts: 0,
        lastSentAt: new Date(),
        sendCount: sql`${otpChallenges.sendCount} + 1`,
      })
      .where(eq(otpChallenges.id, id))
      .returning();
    return row!;
  },
};
