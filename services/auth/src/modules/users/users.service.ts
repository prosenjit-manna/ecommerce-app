import DataLoader from 'dataloader';
import { usersRepository, type UserRow } from './users.repository.js';

/** Normalises emails so "Foo@Example.com " and "foo@example.com" are the same account. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** One loader per request (created in the GraphQL context) to batch federation `_entities` lookups. */
export function createUserLoader() {
  return new DataLoader<string, UserRow | null>(async (ids) => {
    const rows = await usersRepository.findManyByIds(ids);
    const byId = new Map(rows.map((u) => [u.id, u]));
    return ids.map((id) => byId.get(id) ?? null);
  });
}
