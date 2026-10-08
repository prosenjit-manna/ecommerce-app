import { describe, expect, it } from '@jest/globals';
import {
  burnPasswordVerify,
  checkPasswordStrength,
  hashPassword,
  verifyPassword,
} from './password.js';

const ctx = { email: 'jane.doe@example.com', name: 'Jane' };

describe('checkPasswordStrength', () => {
  it('accepts a long password with three character classes', () => {
    expect(checkPasswordStrength('Str0ngPassword', ctx)).toEqual([]);
  });

  it.each([
    ['too short', 'Ab1!', 'at least 8'],
    ['too few character classes', 'alllowercase', 'three of'],
    ['contains the email local part', 'Jane.Doe#2026x', 'email'],
    ['contains the name', 'xxJANE#2026', 'name'],
  ])('rejects a password that is %s', (_case, password, reason) => {
    expect(checkPasswordStrength(password, ctx).join(' ')).toContain(reason);
  });

  it('rejects passwords over the max length', () => {
    expect(checkPasswordStrength('Aa1!'.repeat(40), ctx).join(' ')).toContain('at most 128');
  });

  it('ignores very short names and email parts (too many false positives)', () => {
    expect(checkPasswordStrength('Bo1!xxxxxx', { email: 'bo@example.com', name: 'Bo' })).toEqual([]);
  });
});

describe('hashPassword / verifyPassword', () => {
  it('hashes with argon2id and verifies the right password only', async () => {
    const hash = await hashPassword('Str0ng!Passw0rd');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, 'Str0ng!Passw0rd')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'wrong')).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('returns false for a malformed hash instead of throwing', async () => {
    await expect(verifyPassword('not-a-hash', 'x')).resolves.toBe(false);
  });

  it('burnPasswordVerify completes without revealing anything', async () => {
    await expect(burnPasswordVerify('whatever')).resolves.toBeUndefined();
  });
});
