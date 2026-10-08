import { describe, expect, it, jest } from '@jest/globals';
import type { UserRow } from './users.repository.js';
import { type AnyFn, src, user } from '../../../test/helpers/fixtures.js';

const findManyByIds = jest.fn<AnyFn>();
jest.unstable_mockModule(src('modules/users/users.repository.ts'), () => ({ usersRepository: { findManyByIds } }));

const { createUserLoader, normalizeEmail } = await import('./users.service.js');

describe('normalizeEmail', () => {
  it('trims and lowercases', () => expect(normalizeEmail('  Jane.Doe@Example.COM ')).toBe('jane.doe@example.com'));
});

describe('createUserLoader', () => {
  it('batches lookups into one query and keeps the requested order', async () => {
    const a = user({ id: 'a' });
    const b = user({ id: 'b' });
    findManyByIds.mockResolvedValue([b, a]); // the DB returns rows in any order

    const loader = createUserLoader();
    const results = await Promise.all([loader.load('a'), loader.load('missing'), loader.load('b')]);

    expect(findManyByIds).toHaveBeenCalledTimes(1);
    expect(findManyByIds).toHaveBeenCalledWith(['a', 'missing', 'b']);
    expect(results).toEqual([a, null, b]);
  });
});
