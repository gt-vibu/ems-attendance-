import crypto from 'crypto';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db, schema } from '../../db';
import { logger } from '../../logger';

export async function logToAuditLedger(params: {
  tenantId: number | null;
  actorId: number | null;
  actorName: string;
  action: string;
  ipAddress?: string;
  deviceInfo?: string;
  details?: any;
  // Correlates every log line written during one HTTP request — optional
  // and additive; existing call sites that don't pass it are unaffected
  // (column is nullable). Populate from req.requestId (see
  // middleware/requestId.ts) where a request object is in scope.
  requestId?: string | null;
}) {
  try {
    // 1. Get the last hash in the ledger for THIS tenant (matching ledger.routes.ts verification query)
    const lastLogsQuery = params.tenantId !== null && params.tenantId !== undefined
      ? db.select().from(schema.auditLedger).where(eq(schema.auditLedger.tenantId, params.tenantId)).orderBy(desc(schema.auditLedger.id)).limit(1)
      : db.select().from(schema.auditLedger).orderBy(desc(schema.auditLedger.id)).limit(1);

    const lastLogs = await lastLogsQuery;

    const prevHash = lastLogs.length > 0 ? lastLogs[0].hash : 'GENESIS';
    const timestamp = new Date();

    // 2. Compute current hash: SHA-256(prevHash + timestamp + action + actorName + canonicalDetails)
    const detailsObj = (params.details && typeof params.details === 'object' && Object.keys(params.details).length > 0) ? params.details : null;
    const detailsStr = detailsObj ? JSON.stringify(detailsObj) : '';
    const rawPayload = `${prevHash}|${timestamp.toISOString()}|${params.action}|${params.actorName}|${detailsStr}`;
    const currentHash = crypto.createHash('sha256').update(rawPayload).digest('hex');

    // 3. Insert into audit_ledger table
    await db.insert(schema.auditLedger).values({
      timestamp,
      tenantId: params.tenantId,
      actorId: params.actorId,
      actorName: params.actorName,
      action: params.action,
      ipAddress: params.ipAddress || null,
      deviceInfo: params.deviceInfo || null,
      details: params.details || {},
      hash: currentHash,
      requestId: params.requestId || null,
    });
  } catch (err) {
    console.error('Failed to write to audit ledger:', err);
  }
}
