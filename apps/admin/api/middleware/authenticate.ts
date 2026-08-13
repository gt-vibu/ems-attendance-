import { eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { sendServerError } from '../utils/errors';
import { verifyToken } from '../../jwt';
import { looksLikeApiKey, verifyServiceAccountKey } from '../auth/serviceAccounts';

// idleTimeoutMinutes rarely changes (it's a tenant admin setting, not
// per-request state) but was being re-queried from `tenants` on literally
// every single authenticated request just to read one column — doubling the
// baseline DB round-trips for auth bookkeeping at any real request volume.
// Short TTL cache: worst case, a tenant admin's change to this setting takes
// up to 60s to take effect for already-logged-in sessions, which is an
// acceptable tradeoff for cutting a DB round-trip off every request.
const IDLE_TIMEOUT_CACHE_TTL_MS = 60_000;
const idleTimeoutCache = new Map<number, { value: number; expiresAt: number }>();

async function getCachedIdleTimeoutMinutes(tenantId: number): Promise<number> {
  const cached = idleTimeoutCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const tenantRows = await db.select({ idleTimeoutMinutes: schema.tenants.idleTimeoutMinutes })
    .from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  const value = tenantRows[0]?.idleTimeoutMinutes || 0;
  idleTimeoutCache.set(tenantId, { value, expiresAt: Date.now() + IDLE_TIMEOUT_CACHE_TTL_MS });
  return value;
}

  // Helper Auth Middleware
export async function authenticate(req: any, res: any, next: any) {
    const authHeader = req.headers.authorization;
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    if (!token && req.query?.token) {
      token = String(req.query.token);
    }
    if (!token) {
      return res.status(401).json({ error: 'Authorization token required' });
    }

    // Machine-to-machine callers (partner integrations) present a service
    // account key instead of a human-login JWT — recognizable by its fixed
    // prefix, so this never even attempts a JWT verify for one. No session
    // revocation check applies (there's no activeSessionId concept for a
    // key — revocation is `revokedAt` on the row itself, checked inside
    // verifyServiceAccountKey).
    if (looksLikeApiKey(token)) {
      const account = await verifyServiceAccountKey(token);
      if (!account) {
        return res.status(401).json({ error: 'Invalid or revoked API key' });
      }
      req.user = {
        userId: null,
        tenantId: account.tenantId,
        role: 'service_account',
        privileges: account.privileges,
        isServiceAccount: true,
        serviceAccountId: account.serviceAccountId,
      };
      return next();
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    // Only tokens that carry a sid (real login sessions) are subject to the
    // revocation check — short-lived special-purpose tokens (e.g. the
    // mustChangePassword tempReset token) never had one and are unaffected.
    if (decoded.sid) {
      try {
        // Two queries rather than a leftJoin: this codebase's `db` export
        // is a Proxy that falls back to a hand-rolled JSON-file query
        // engine (see db.ts) whenever Postgres isn't reachable, and that
        // fallback's QueryBuilder doesn't implement leftJoin — only the
        // real Drizzle instance does. A leftJoin here worked fine against
        // real Postgres but threw "leftJoin is not a function" and 500'd
        // every authenticated request the moment the app ran against the
        // JSON fallback, which is exactly the kind of thing local dev runs
        // into. Two plain select/where calls work against both backends.
        const rows = await db.select({
          activeSessionId: schema.users.activeSessionId,
          tenantId: schema.users.tenantId,
          lastActivityAt: schema.users.lastActivityAt,
        }).from(schema.users).where(eq(schema.users.id, decoded.userId));
        if (rows.length === 0 || rows[0].activeSessionId !== decoded.sid) {
          return res.status(401).json({ error: 'session_expired', message: 'Your session has ended. Please log in again.' });
        }

        // Idle-session timeout — tenant-configurable, 0 = disabled.
        // Independent of the JWT's own 24h expiry: this can log someone out
        // much sooner if they've simply been inactive.
        if (rows[0].tenantId) {
          const idleTimeoutMinutes = await getCachedIdleTimeoutMinutes(rows[0].tenantId);
          if (idleTimeoutMinutes > 0 && rows[0].lastActivityAt) {
            const idleMs = Date.now() - new Date(rows[0].lastActivityAt).getTime();
            if (idleMs > idleTimeoutMinutes * 60 * 1000) {
              await db.update(schema.users).set({ activeSessionId: null, sessionExpiresAt: null }).where(eq(schema.users.id, decoded.userId));
              return res.status(401).json({ error: 'session_expired', message: 'Your session ended due to inactivity. Please log in again.' });
            }
          }
          // Throttled heartbeat write — only touch the row if it's been a
          // while, so this doesn't become a write on every single request.
          const shouldTouch = !rows[0].lastActivityAt || (Date.now() - new Date(rows[0].lastActivityAt).getTime()) > 60000;
          if (shouldTouch) {
            db.update(schema.users).set({ lastActivityAt: new Date() }).where(eq(schema.users.id, decoded.userId)).catch(() => {});
          }
        }
      } catch (err: any) {
        return sendServerError(res, err, "authenticate middleware");
      }
    }
    req.user = decoded;
    next();
  }

// Structural role gate — use as router.get(path, authenticate, requireRole('super_admin'), handler).
// Previously super.routes.ts repeated `if (req.user.role !== 'super_admin') return res.status(403)...`
// inline at 14 separate handlers; a new route that forgot the line would
// be a full privilege-escalation bug with nothing to catch it. Centralizing
// the check into middleware makes it a structural property of the route
// registration instead of per-handler developer discipline.
export function requireRole(...allowedRoles: string[]) {
  return function (req: any, res: any, next: any) {
    if (!allowedRoles.includes(req.user?.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    next();
  };
}
