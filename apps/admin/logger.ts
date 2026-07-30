// Minimal, dependency-free structured logger.
//
// In production it emits one JSON object per line on stdout/stderr — the shape
// that hosted platforms (Railway, Render, Fly) and log pipelines (Datadog,
// Loki, CloudWatch) can parse and index without extra config. In development
// it prints compact, human-readable lines instead. Kept dependency-free on
// purpose: it adds nothing to the bundle and cannot break the build.
//
// This does NOT replace the existing console.* calls throughout the app; it's
// an additive layer used by the request-logging middleware and the process-
// level error handlers so operational logs are structured and queryable.

import crypto from 'crypto';

type Level = 'debug' | 'info' | 'warn' | 'error';

const isProd = process.env.NODE_ENV === 'production';

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (isProd) {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(meta || {}) });
    (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
  } else {
    const suffix = meta && Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`[${level}] ${msg}${suffix}`);
  }
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta),
};

// Express middleware: emits one structured record per HTTP request when the
// response finishes, with method, path, status code and latency in ms. Health
// checks are logged at debug level (suppressed in production) so liveness/
// readiness polling doesn't drown out real traffic. 5xx -> error, 4xx -> warn.
//
// Also stamps req.requestId — a per-request correlation id threaded through
// to audit_ledger.request_id (see services/audit.ts) wherever a call site
// passes it, so multiple audit rows from one request can be tied together.
// Not force-plumbed into every existing logToAuditLedger call (that's a
// large, low-value mechanical sweep for what's meant to be an optional,
// best-effort correlation field) — new/touched call sites can adopt it
// incrementally.
export function requestLogger(req: any, res: any, next: any) {
  req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
    const path = req.originalUrl || req.url;
    const meta = { method: req.method, path, status: res.statusCode, durMs, requestId: req.requestId };
    if (res.statusCode >= 500) logger.error('request', meta);
    else if (res.statusCode >= 400) logger.warn('request', meta);
    else if (typeof path === 'string' && path.startsWith('/api/health')) logger.debug('request', meta);
    else logger.info('request', meta);
  });
  next();
}
