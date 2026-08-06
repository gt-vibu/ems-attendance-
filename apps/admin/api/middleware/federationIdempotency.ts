import crypto from 'crypto';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { db, schema } from '../../db';
import { sendServerError } from '../utils/errors';
import { logger } from '../../logger';

const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, per the plan
// A row claimed but never finalized (responseStatus still null) past this
// age is treated as abandoned — the original request crashed, timed out,
// or the process died mid-handler — rather than permanently blocking every
// retry with 409 IDEMPOTENCY_KEY_IN_PROGRESS for up to the full 7-day
// retention window. 2 minutes is generously past this app's own p99
// federation write latency (see the load-testing session's numbers), so a
// still-genuinely-in-flight request is never falsely reclaimed.
const IN_PROGRESS_STALE_MS = 2 * 60 * 1000;

function hashRequest(method: string, path: string, body: unknown): string {
  return crypto.createHash('sha256').update(`${method}\n${path}\n${JSON.stringify(body ?? {})}`).digest('hex');
}

// Every POST/PUT/PATCH under /v1/federation/* runs through this: replaying
// the same Idempotency-Key with an identical request body returns the
// original stored response instead of re-executing the handler; replaying
// it with a different body is refused outright. A second request racing an
// in-flight first one (no responseStatus recorded yet, and not yet stale)
// is refused too, rather than letting both proceed and risk a duplicate
// side effect.
export function requireIdempotencyKey(req: any, res: any, next: any) {
  const idempotencyKey = req.header('Idempotency-Key');
  const correlationId = req.header('X-Correlation-ID');
  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Idempotency-Key header is required for this operation.', code: 'IDEMPOTENCY_KEY_REQUIRED' });
  }
  if (!correlationId) {
    return res.status(400).json({ error: 'X-Correlation-ID header is required for this operation.', code: 'CORRELATION_ID_REQUIRED' });
  }
  req.correlationId = correlationId;

  (async () => {
    const requestHash = hashRequest(req.method, req.originalUrl || req.url, req.body);
    const clientId: string = req.federation?.clientId;

    const existingRows = await db.select().from(schema.federationIdempotencyKeys).where(
      and(
        eq(schema.federationIdempotencyKeys.clientId, clientId),
        eq(schema.federationIdempotencyKeys.idempotencyKey, idempotencyKey),
        gt(schema.federationIdempotencyKeys.expiresAt, new Date()),
      )
    ).limit(1);

    if (existingRows.length > 0) {
      const existing = existingRows[0];
      if (existing.requestHash !== requestHash) {
        return res.status(409).json({ error: 'This Idempotency-Key was already used with a different request.', code: 'IDEMPOTENCY_KEY_REUSED' });
      }
      if (existing.responseStatus == null) {
        const ageMs = Date.now() - new Date(existing.createdAt as any).getTime();
        if (ageMs < IN_PROGRESS_STALE_MS) {
          return res.status(409).json({ error: 'A request with this Idempotency-Key is already being processed.', code: 'IDEMPOTENCY_KEY_IN_PROGRESS' });
        }
        // Stale — the original attempt never finished (crash/timeout).
        // Reclaim by deleting the abandoned row and falling through to the
        // normal "no existing row" claim path below, so this retry gets a
        // genuine attempt instead of being blocked forever. Safe: nothing
        // partial was left behind by the original attempt, because the
        // route handlers this middleware guards wrap their domain write +
        // outbox write + this row's own finalize in one db.transaction()
        // (see routes/federation/*.routes.ts) — a crash mid-handler rolls
        // that transaction back entirely, so there's nothing to reconcile,
        // only a safe-to-retry gap to close.
        await db.delete(schema.federationIdempotencyKeys).where(
          and(eq(schema.federationIdempotencyKeys.id, existing.id), isNull(schema.federationIdempotencyKeys.responseStatus)),
        ).catch(() => undefined);
        logger.warn('[federation] reclaimed stale in-progress idempotency key', { clientId, idempotencyKey, ageMs });
      } else {
        return res.status(existing.responseStatus).json(existing.responseBody);
      }
    }

    let rowId: number;
    try {
      const [inserted] = await db.insert(schema.federationIdempotencyKeys).values({
        tenantId: req.federation.tenantId,
        clientId,
        idempotencyKey,
        requestHash,
        method: req.method,
        path: req.originalUrl || req.url,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_MS),
      }).returning({ id: schema.federationIdempotencyKeys.id });
      rowId = inserted.id;
    } catch (err: any) {
      // A genuine unique-constraint violation on (clientId, idempotencyKey)
      // means two concurrent requests with the exact same key both passed
      // the SELECT above before either inserted — whichever loses this race
      // is safely treated as "already in progress", never letting a
      // duplicate write through. Any OTHER insert failure (e.g. a schema
      // mismatch) is a real bug and must not be masked as the same 409 —
      // that previously made a genuine server error indistinguishable from
      // a normal concurrency race (caught while wiring up platform-scoped
      // federation clients: a NOT NULL tenant_id column silently turned
      // every first-ever request into a false "already in progress").
      const isUniqueViolation = err?.code === '23505' || /unique/i.test(String(err?.cause?.message || err?.message || ''));
      if (!isUniqueViolation) {
        logger.warn('[federation] idempotency key claim failed unexpectedly (not a race)', { clientId, idempotencyKey, error: err?.cause?.message || err?.message });
        return sendServerError(res, err, 'federationIdempotency');
      }
      return res.status(409).json({ error: 'A request with this Idempotency-Key is already being processed.', code: 'IDEMPOTENCY_KEY_IN_PROGRESS' });
    }
    req.idempotencyRowId = rowId;

    // Capture the handler's eventual response body/status and persist it
    // against this key BEFORE the response actually goes out — previously
    // this was fire-and-forget (`.catch(() => undefined)` with no await),
    // which meant a client could receive its 200 and immediately retry
    // with the same key before the persistence write landed, hitting the
    // "still in progress" branch above for a request that had, in fact,
    // already succeeded. Awaiting here closes that race; a slower
    // persistence write now delays the response by that same amount
    // rather than risking the inconsistency.
    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      const finalize = (async () => {
        try {
          await db.update(schema.federationIdempotencyKeys)
            .set({ responseStatus: res.statusCode, responseBody: body })
            .where(eq(schema.federationIdempotencyKeys.id, rowId));
        } catch (err: any) {
          // A failed finalize write must never crash the response already
          // computed — the row simply stays reclaimable via the staleness
          // path above on the next retry.
          logger.warn('[federation] failed to finalize idempotency record', { rowId, error: err?.message });
        }
        return originalJson(body);
      })();
      return finalize as any;
    };

    next();
  })().catch((err) => sendServerError(res, err, 'federationIdempotency'));
}
