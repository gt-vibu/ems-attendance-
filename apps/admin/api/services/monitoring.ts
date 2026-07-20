// Error monitoring — a thin wrapper around @sentry/node, entirely opt-in via
// SENTRY_DSN. Unset (the default), every function here is a no-op and this
// file adds nothing to runtime behavior; the existing structured logger
// (logger.ts) remains the source of truth either way. Set SENTRY_DSN to
// additionally forward exceptions to Sentry for alerting/aggregation across
// instances — useful once you're running more than the one process you're
// SSH'd into watching logs on.
import * as Sentry from '@sentry/node';
import { logger } from '../../logger';

const dsn = process.env.SENTRY_DSN;
let initialized = false;

export function initMonitoring() {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    // Errors only, no perf/tracing overhead — this app doesn't need
    // distributed tracing to be useful, just "what broke and where."
    tracesSampleRate: 0,
  });
  initialized = true;
  logger.info('[monitoring] Sentry initialized', { environment: process.env.NODE_ENV || 'development' });
}

export function captureException(err: unknown, context?: Record<string, unknown>) {
  logger.error(err instanceof Error ? err.message : String(err), { stack: err instanceof Error ? err.stack : undefined, ...context });
  if (initialized) {
    Sentry.captureException(err, context ? { extra: context } : undefined);
  }
}
