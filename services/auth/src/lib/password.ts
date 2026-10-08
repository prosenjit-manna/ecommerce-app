import argon2 from 'argon2';

// OWASP-recommended argon2id parameters (19 MiB, 2 iterations, 1 lane).
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, HASH_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// Hash of a random string, computed once. Verifying against it when the user doesn't exist
// makes "unknown email" take as long as "wrong password", so timing doesn't reveal accounts.
let dummyHash: Promise<string> | undefined;
export async function burnPasswordVerify(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalisation');
  await verifyPassword(await dummyHash, password);
}

/** Returns the reasons a password is too weak; an empty array means it's acceptable. */
export function checkPasswordStrength(password: string, context: { email: string; name?: string }): string[] {
  const reasons: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) reasons.push(`Must be at least ${PASSWORD_MIN_LENGTH} characters`);
  if (password.length > PASSWORD_MAX_LENGTH) reasons.push(`Must be at most ${PASSWORD_MAX_LENGTH} characters`);
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) reasons.push('Use at least three of: lowercase, uppercase, digits, symbols');

  const lower = password.toLowerCase();
  const localPart = context.email.split('@')[0]?.toLowerCase();
  if (localPart && localPart.length >= 3 && lower.includes(localPart)) reasons.push('Must not contain your email');
  const name = context.name?.trim().toLowerCase();
  if (name && name.length >= 3 && lower.includes(name)) reasons.push('Must not contain your name');
  return reasons;
}
