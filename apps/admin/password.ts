import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

/**
 * Hash a plaintext password (or temporary password) before it is persisted.
 * Always use this before writing any password-like value to the database.
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/**
 * A bcrypt hash always starts with $2a$, $2b$ or $2y$ followed by a cost factor.
 * We use this to distinguish already-hashed values from legacy plaintext values
 * that may still exist in older rows (e.g. `db_fallback.json` seed data created
 * before hashing was introduced).
 */
function looksHashed(value: string | null | undefined): boolean {
  return !!value && /^\$2[aby]\$\d{2}\$/.test(value);
}

/**
 * Verify a plaintext candidate against a stored value.
 * - If the stored value is a bcrypt hash, does a constant-time bcrypt compare.
 * - If the stored value is legacy plaintext (pre-hashing rows), falls back to a
 *   direct comparison so existing users are not locked out, and the caller can
 *   opt to transparently re-hash and upgrade the stored value on success.
 */
export async function verifyPassword(plain: string | undefined | null, stored: string | null | undefined): Promise<boolean> {
  if (!plain || !stored) return false;
  if (looksHashed(stored)) {
    return bcrypt.compare(plain, stored);
  }
  // Legacy plaintext fallback (only hit for rows created before this fix).
  return plain === stored;
}

export { looksHashed as isPasswordHashed };
