import rateLimit from 'express-rate-limit';
import { verifyToken } from '../../jwt';

  // Rate-limit key helper: prefer the authenticated user (from the bearer
  // token) over raw IP wherever possible. This app's whole premise is many
  // employees checking in from the SAME office network — several tenants
  // already rely on comparing everyone's public IP against one configured
  // office IP (see Wi-Fi verification below) — so keying by IP alone would
  // throttle an entire office as one client during a shift-start rush,
  // rather than throttling the one misbehaving caller. Falls back to IP
  // only when there's no token to read yet (e.g. the login attempt itself).
export function userAwareRateLimitKey(req: any): string {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const decoded = verifyToken(authHeader.slice(7));
      if (decoded?.userId) return `user:${decoded.userId}`;
    }
    return `ip:${req.ip}`;
  }

  // Generous general-purpose limiter — a safety net against abuse/DoS
  // without getting in the way of normal use (e.g. dashboards polling data,
  // or many different employees behind one office IP all checking in
  // around the same time).
export const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userAwareRateLimitKey,
  });

  // Tight limiter specifically for authentication endpoints — brute-forcing
  // a password is exactly the attack this needs to slow down. Keyed by
  // IP + the specific email/account being attempted (not IP alone): this
  // still slows down someone hammering ONE account, without also locking
  // out every other employee logging into their OWN account from the same
  // office network at the same time (e.g. shift-start login rush) — a
  // pure per-IP key would do exactly that, since there's no bearer token
  // yet at the login step for userAwareRateLimitKey to key off of.
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many attempts. Please wait 15 minutes and try again.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => `${req.ip}:${(req.body?.email || '').toLowerCase()}`,
  });
