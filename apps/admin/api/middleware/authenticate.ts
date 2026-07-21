import { eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { verifyToken } from '../../jwt';
import { looksLikeApiKey, verifyServiceAccountKey } from '../auth/serviceAccounts';

  // Helper Auth Middleware
export async function authenticate(req: any, res: any, next: any) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization token required' });
    }
    const token = authHeader.split(' ')[1];

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
          const tenantRows = await db.select({ idleTimeoutMinutes: schema.tenants.idleTimeoutMinutes })
            .from(schema.tenants).where(eq(schema.tenants.id, rows[0].tenantId)).limit(1);
          const idleTimeoutMinutes = tenantRows[0]?.idleTimeoutMinutes || 0;
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
        return res.status(500).json({ error: err.message });
      }
    }
    req.user = decoded;
    next();
  }
