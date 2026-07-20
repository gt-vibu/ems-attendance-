import rateLimit from 'express-rate-limit';
import Redis from 'ioredis';
import { RedisStore } from 'rate-limit-redis';
import { verifyToken } from '../../jwt';
import { logger } from '../../logger';

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

// express-rate-limit's default store is an in-process Map — correct counts
// on one instance, but each replica behind a load balancer counts
// independently once you scale horizontally, so the configured limits get
// silently multiplied by however many instances are running. When REDIS_URL
// is set, every instance shares one counter via Redis instead, so the limit
// means what it says regardless of replica count. Falls back to the
// in-memory default (unset REDIS_URL) for local dev / single-instance
// deployments, where this doesn't matter and adding a Redis dependency
// would just be friction.
// A single shared connection reused by both limiters below — no reason to
// open two Redis connections for one process.
let sharedRedisClient: InstanceType<typeof Redis> | null = null;
function getSharedRedisClient(): InstanceType<typeof Redis> | null {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;
  if (!sharedRedisClient) {
    sharedRedisClient = new Redis(redisUrl, {
      // Don't crash the whole app if Redis is briefly unreachable — a rate
      // limiter degrading is far less bad than an unhandled connection
      // error taking every user down over a rate-limiting dependency.
      maxRetriesPerRequest: 2,
      lazyConnect: true,
    });
    sharedRedisClient.on('error', (err: Error) => {
      logger.warn('[rateLimit] Redis connection error — shared rate limiting degraded', { err: err.message });
    });
  }
  return sharedRedisClient;
}

function buildSharedStore(prefix: string) {
  const client = getSharedRedisClient();
  if (!client) return undefined; // REDIS_URL unset — express-rate-limit's in-memory default applies
  return new RedisStore({
    prefix: `smart-teams:ratelimit:${prefix}:`,
    sendCommand: (...args: string[]) => client.call(...(args as [string, ...string[]])) as any,
  });
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
    store: buildSharedStore('general'),
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
    store: buildSharedStore('auth'),
  });
