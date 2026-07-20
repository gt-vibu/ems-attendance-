import crypto from 'crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { db, schema } from '../../db';
import { hashPassword, verifyPassword } from '../../password';

// Distinguishes an API key from a JWT at the authenticate.ts entry point
// without needing a DB round-trip first: JWTs are three dot-separated
// base64url segments, API keys are a single opaque token starting with
// this prefix.
const KEY_PREFIX = 'stk_live_';
// Stored (and looked up) in the clear alongside the bcrypt hash — long
// enough to make prefix collisions practically impossible, short enough to
// safely display/log without exposing the secret portion.
const PREFIX_DISPLAY_LEN = KEY_PREFIX.length + 8;

export function looksLikeApiKey(token: string): boolean {
  return token.startsWith(KEY_PREFIX);
}

// Generates a new raw key + its storable {keyPrefix, keyHash}. The raw key
// is returned to the caller exactly once (at creation) and is never
// persisted or logged anywhere — only its hash is stored, same as a user
// password.
export async function generateServiceAccountKey(): Promise<{ rawKey: string; keyPrefix: string; keyHash: string }> {
  const secret = crypto.randomBytes(24).toString('base64url');
  const rawKey = `${KEY_PREFIX}${secret}`;
  const keyPrefix = rawKey.slice(0, PREFIX_DISPLAY_LEN);
  const keyHash = await hashPassword(rawKey);
  return { rawKey, keyPrefix, keyHash };
}

// Looks up the candidate row by its cheap, indexable prefix, then does the
// slow bcrypt compare against the full key — mirrors verifying a password,
// just keyed differently since (unlike a login form) there's no separate
// "username" to look the row up by first.
export async function verifyServiceAccountKey(rawKey: string): Promise<
  { serviceAccountId: number; tenantId: number; privileges: string[] } | null
> {
  const keyPrefix = rawKey.slice(0, PREFIX_DISPLAY_LEN);
  const rows = await db.select().from(schema.serviceAccounts).where(
    and(eq(schema.serviceAccounts.keyPrefix, keyPrefix), isNull(schema.serviceAccounts.revokedAt))
  ).limit(1);
  if (rows.length === 0) return null;
  const account = rows[0];
  const valid = await verifyPassword(rawKey, account.keyHash);
  if (!valid) return null;

  // Best-effort — a failed write here shouldn't fail the request the key
  // was presented for.
  try {
    await db.update(schema.serviceAccounts).set({ lastUsedAt: new Date() }).where(eq(schema.serviceAccounts.id, account.id));
  } catch { /* best effort */ }

  return {
    serviceAccountId: account.id,
    tenantId: account.tenantId,
    privileges: Array.isArray(account.privileges) ? (account.privileges as string[]) : [],
  };
}
