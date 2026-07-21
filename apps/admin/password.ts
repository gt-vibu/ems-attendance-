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

/**
 * Baseline complexity policy applied to every self-chosen password (reset,
 * forgot-password confirm, forced-change) — NOT applied to system-generated
 * temp passwords (those come from crypto.randomBytes and are already far
 * stronger than anything this checks for). Returns an error message, or
 * null if the password passes.
 */
export function validatePasswordStrength(password: string): string | null {
  if (!password || password.length < 8) return 'Password must be at least 8 characters long.';
  if (password.length > 128) return 'Password is too long.';
  let classes = 0;
  if (/[a-z]/.test(password)) classes++;
  if (/[A-Z]/.test(password)) classes++;
  if (/[0-9]/.test(password)) classes++;
  if (/[^a-zA-Z0-9]/.test(password)) classes++;
  if (classes < 3) return 'Password must include at least 3 of: lowercase letters, uppercase letters, numbers, symbols.';
  return null;
}

/**
 * True if `plain` matches the current password or any of the last few
 * remembered hashes — checked before accepting a password change so a
 * reset can't just bounce straight back to what it was.
 */
export async function isPasswordReused(plain: string, currentHash: string | null | undefined, history: string[] | null | undefined): Promise<boolean> {
  const candidates = [currentHash, ...(history || [])].filter((h): h is string => !!h);
  for (const hash of candidates) {
    if (looksHashed(hash) && await bcrypt.compare(plain, hash)) return true;
  }
  return false;
}

/** Appends a new hash to the remembered-password list, capped at `max`. */
export function pushPasswordHistory(history: string[] | null | undefined, newHash: string, max = 5): string[] {
  const next = [...(Array.isArray(history) ? history : []), newHash];
  return next.slice(-max);
}
