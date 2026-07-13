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
}) {
  try {
    // 1. Get the last hash in the ledger
    const lastLogs = await db.select()
      .from(schema.auditLedger)
      .orderBy(desc(schema.auditLedger.id))
      .limit(1);
    
    const prevHash = lastLogs.length > 0 ? lastLogs[0].hash : 'GENESIS';
    const timestamp = new Date();
    
    // 2. Compute current hash: SHA-256(prevHash + timestamp + action + actorName + JSON.stringify(details))
    const detailsStr = params.details ? JSON.stringify(params.details) : '';
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
      hash: currentHash
    });
  } catch (err) {
    console.error('Failed to write to audit ledger:', err);
  }
}
