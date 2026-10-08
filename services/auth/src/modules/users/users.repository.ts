import { eq, inArray } from 'drizzle-orm';
import { db, type DbOrTx } from '../../db/client.js';
import { users } from '../../db/schema.js';

export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const usersRepository = {
  async findById(id: string, tx: DbOrTx = db): Promise<UserRow | undefined> {
    const [row] = await tx.select().from(users).where(eq(users.id, id)).limit(1);
    return row;
  },

  findManyByIds(ids: readonly string[], tx: DbOrTx = db): Promise<UserRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return tx.select().from(users).where(inArray(users.id, [...ids]));
  },

  async findByEmail(email: string, tx: DbOrTx = db): Promise<UserRow | undefined> {
    const [row] = await tx.select().from(users).where(eq(users.email, email)).limit(1);
    return row;
  },

  async create(data: NewUser, tx: DbOrTx = db): Promise<UserRow> {
    const [row] = await tx.insert(users).values(data).returning();
    return row!;
  },

  async update(id: string, data: Partial<NewUser>, tx: DbOrTx = db): Promise<UserRow | undefined> {
    const [row] = await tx.update(users).set(data).where(eq(users.id, id)).returning();
    return row;
  },
};
