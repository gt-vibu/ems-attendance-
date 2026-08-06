import { logger } from '../../logger';

// Route handlers throughout the API were catching every error and doing
// `res.status(500).json({ error: err.message })` — which leaks raw internal
// error text (Postgres constraint names, stack-adjacent details, etc.)
// straight to the client. This logs the full error server-side (where it's
// actually useful for debugging) and returns a generic message to the
// caller instead. `context` is a short label (route name) for the log line.
export function sendServerError(res: any, err: any, context: string): void {
  logger.error(context, { error: err?.message, stack: err?.stack });
  res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
}
