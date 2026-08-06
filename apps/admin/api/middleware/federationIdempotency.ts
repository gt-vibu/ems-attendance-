import crypto from 'crypto';
import { eq, and, gt } from 'drizzle-orm';
import { db, schema } from '../../db';
import { sendServerError } from '../utils/errors';

const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, per the plan

function hashRequest(method: string, path: string, body: unknown): string {
  return crypto.createHash('sha256').update(`${method}\n${path}\n${JSON.stringify(body ?? {})}`).digest('hex');
}

// Every POST/PUT/PATCH under /v1/federation/* runs through this: replaying
// the same Idempotency-Key with an identical request body returns the
// original stored response instead of re-executing the handler; replaying
// it with a different body is refused outright. A second request racing an
// in-flight first one (no responseStatus recorded yet) is refused too,
// rather than letting both proceed and risk a duplicate side effect.
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
        return res.status(409).json({ error: 'A request with this Idempotency-Key is already being processed.', code: 'IDEMPOTENCY_KEY_IN_PROGRESS' });
      }
      return res.status(existing.responseStatus).json(existing.responseBody);
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
      // Unique-constraint race: two concurrent requests with the exact same
      // key both passed the SELECT above before either inserted. Whichever
      // loses this race is treated as "already in progress" — safe default,
      // never lets a duplicate write through.
      return res.status(409).json({ error: 'A request with this Idempotency-Key is already being processed.', code: 'IDEMPOTENCY_KEY_IN_PROGRESS' });
    }

    // Capture the handler's eventual response body/status and persist it
    // against this key before it goes out, so a replay of the same key
    // returns exactly what the original caller received.
    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      db.update(schema.federationIdempotencyKeys)
        .set({ responseStatus: res.statusCode, responseBody: body })
        .where(eq(schema.federationIdempotencyKeys.id, rowId))
        .catch(() => undefined); // best effort — a failed write here must never break the response already being sent
      return originalJson(body);
    };

    next();
  })().catch((err) => sendServerError(res, err, 'federationIdempotency'));
}
