import { eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { verifyToken } from '../../jwt';

  // Helper Auth Middleware
export async function authenticate(req: any, res: any, next: any) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization token required' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    // Only tokens that carry a sid (real login sessions) are subject to the
    // revocation check — short-lived special-purpose tokens (e.g. the
    // mustChangePassword tempReset token) never had one and are unaffected.
    if (decoded.sid) {
      try {
        const rows = await db.select({ activeSessionId: schema.users.activeSessionId })
          .from(schema.users).where(eq(schema.users.id, decoded.userId));
        if (rows.length === 0 || rows[0].activeSessionId !== decoded.sid) {
          return res.status(401).json({ error: 'session_expired', message: 'Your session has ended. Please log in again.' });
        }
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }
    req.user = decoded;
    next();
  }
