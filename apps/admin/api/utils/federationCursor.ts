import crypto from 'crypto';

// Opaque cursor for every /v1/federation/* list endpoint — binds the
// requesting client, its filters, sort order, and an "as of" snapshot
// timestamp so paging through a large result set stays consistent even if
// new rows are written mid-page (the plan's requirement: "cursor paging,
// not offsets"). Expires 24h after issuance. HMAC-signed with JWT_SECRET so
// a caller can't forge a cursor claiming a different client's filters.
const CURSOR_TTL_MS = 24 * 60 * 60 * 1000;

function cursorSecret(): string {
  return process.env.JWT_SECRET || 'dev-only-insecure-secret-DO-NOT-USE-IN-PRODUCTION';
}

export interface FederationCursorPayload {
  clientId: string;
  filtersHash: string;
  sort: string;
  asOf: string; // ISO timestamp — snapshot boundary every page of this cursor chain shares
  lastId: number; // last-seen internal id/offset marker for the next page
  exp: number; // epoch ms
}

export function hashFilters(filters: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(filters)).digest('hex').slice(0, 16);
}

export function encodeCursor(payload: Omit<FederationCursorPayload, 'exp'>): string {
  const full: FederationCursorPayload = { ...payload, exp: Date.now() + CURSOR_TTL_MS };
  const json = JSON.stringify(full);
  const body = Buffer.from(json, 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', cursorSecret()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

// Returns null on any tamper, expiry, or malformed-token condition — callers
// treat a null decode as "invalid cursor" (400), never as "start from the
// beginning" (that would silently reorder/duplicate a partial scan).
export function decodeCursor(token: string, expectedClientId: string): FederationCursorPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  const expectedSignature = crypto.createHmac('sha256', cursorSecret()).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) return null;
  let payload: FederationCursorPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (payload.exp < Date.now()) return null;
  if (payload.clientId !== expectedClientId) return null;
  return payload;
}

export function resolveLimit(rawLimit: unknown, defaultLimit = 50, maxLimit = 200): number {
  const n = Number(rawLimit);
  if (!Number.isFinite(n) || n <= 0) return defaultLimit;
  return Math.min(maxLimit, Math.floor(n));
}
