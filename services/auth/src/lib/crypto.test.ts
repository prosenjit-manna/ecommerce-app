import { describe, expect, it } from '@jest/globals';
import { hmacSha256, randomNumericCode, randomToken, safeEqualHex, sha256 } from './crypto.js';

describe('randomNumericCode', () => {
  it('returns exactly the requested number of digits, keeping leading zeros', () => {
    for (let i = 0; i < 200; i++) expect(randomNumericCode(6)).toMatch(/^\d{6}$/);
  });
});

describe('randomToken', () => {
  it('is URL-safe base64 with 256 bits of entropy by default', () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('never repeats', () => {
    expect(new Set(Array.from({ length: 100 }, () => randomToken())).size).toBe(100);
  });
});

describe('hashing', () => {
  it('sha256 is deterministic hex', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hmacSha256 depends on the secret', () => {
    expect(hmacSha256('a', 'value')).not.toBe(hmacSha256('b', 'value'));
    expect(hmacSha256('a', 'value')).toBe(hmacSha256('a', 'value'));
  });
});

describe('safeEqualHex', () => {
  it('compares digests', () => {
    expect(safeEqualHex(sha256('x'), sha256('x'))).toBe(true);
    expect(safeEqualHex(sha256('x'), sha256('y'))).toBe(false);
  });

  it('returns false (instead of throwing) for different lengths', () => {
    expect(safeEqualHex('abcd', 'abcdef')).toBe(false);
  });
});
