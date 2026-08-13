import { Router } from 'express';
import { eq, and, gt, asc, sql } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { sendServerError } from '../../utils/errors';
import { authenticateFederation, resolveFederationTenantContext } from '../../middleware/federationAuth';
import { federationLimiter } from '../../middleware/rateLimit';
import { requireIdempotencyKey } from '../../middleware/federationIdempotency';
import { buildCapabilities } from '../../services/federation/capabilities';
import { getOrCreateActiveKey, getNextKey, getRetiredKeys } from '../../services/federation/webhookSigning';
import { assertWebhookUrlIsSafe } from '../../services/webhooks';
import { encodeCursor, decodeCursor, hashFilters, resolveLimit } from '../../utils/federationCursor';
import { logger } from '../../../logger';

export const router = Router();

// Unauthenticated infra probes — deliberately mounted before
// authenticateFederation so a load balancer / orchestrator health check
// never needs a bearer token.
router.get('/v1/federation/health/live', (_req, res) => {
  res.json({ status: 'ok' });
});

router.get('/v1/federation/health/ready', async (_req, res) => {
  try {
    const result: any = await db.execute(sql`
      SELECT
        to_regclass('public.tenants') IS NOT NULL AS tenants_ready,
        to_regclass('public.federation_clients') IS NOT NULL AS clients_ready,
        to_regclass('public.federation_external_id_mappings') IS NOT NULL AS mappings_ready
    `);
    const row = result?.rows?.[0] ?? result?.[0];
    if (!row?.tenants_ready || !row?.clients_ready || !row?.mappings_ready) {
      throw new Error('Required federation schema is not available.');
    }
    res.json({ status: 'ready' });
  } catch (err: any) {
    logger.warn('[federation] readiness check failed', { error: err?.message });
    res.status(503).json({ status: 'not_ready' });
  }
});

router.use('/v1/federation', authenticateFederation, federationLimiter);

router.get('/v1/federation/capabilities', resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const result = await buildCapabilities(req.federation.tenantId);
    res.set('Cache-Control', `private, max-age=${result.cacheControlMaxAgeSeconds}`);
    res.json(result);
  } catch (err: any) {
    sendServerError(res, err, 'federation/platform.routes.ts');
  }
});

router.get('/v1/federation/webhook-signing-keys', async (_req: any, res: any) => {
  try {
    const [active, next, retired] = await Promise.all([getOrCreateActiveKey(), getNextKey(), getRetiredKeys()]);
    res.json({
      activeKey: { keyId: active.keyId, publicKey: active.publicKey, activatedAt: (active as any).activatedAt },
      nextKey: next ? { keyId: next.keyId, publicKey: next.publicKey } : null,
      retiredKeys: retired.map((k: any) => ({ keyId: k.keyId, publicKey: k.publicKey, retiredAt: k.retiredAt })),
    });
  } catch (err: any) {
    sendServerError(res, err, 'federation/platform.routes.ts');
  }
});

router.post('/v1/federation/webhook-subscriptions', requireIdempotencyKey, resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const { callbackUrl, eventTypes } = req.body || {};
    if (!callbackUrl || typeof callbackUrl !== 'string' || !callbackUrl.startsWith('https://')) {
      return res.status(422).json({ error: 'callbackUrl is required and must be an https:// URL.' });
    }
    try {
      await assertWebhookUrlIsSafe(callbackUrl);
    } catch (err: any) {
      return res.status(422).json({ error: err?.message || 'callbackUrl failed safety validation.' });
    }

    const existing = await db.select().from(schema.federationWebhookSubscriptions).where(eq(schema.federationWebhookSubscriptions.tenantId, req.federation.tenantId)).limit(1);
    const [active, next] = await Promise.all([getOrCreateActiveKey(), getNextKey()]);
    let saved;
    if (existing.length > 0) {
      [saved] = await db.update(schema.federationWebhookSubscriptions).set({
        callbackUrl, eventTypes: Array.isArray(eventTypes) ? eventTypes : null, isActive: true,
      }).where(eq(schema.federationWebhookSubscriptions.id, existing[0].id)).returning();
    } else {
      [saved] = await db.insert(schema.federationWebhookSubscriptions).values({
        tenantId: req.federation.tenantId, callbackUrl, eventTypes: Array.isArray(eventTypes) ? eventTypes : null,
      }).returning();
    }

    res.json({ subscriptionId: String(saved.id), activeKeyId: active.keyId, nextKeyId: next?.keyId ?? null });
  } catch (err: any) {
    sendServerError(res, err, 'federation/platform.routes.ts');
  }
});

// 90-day cursor-paged outbox replay feed — independent of live webhook
// delivery, for BlizBooks's daily/incident reconciliation job.
router.get('/v1/federation/events', resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const filters = { eventType: req.query.eventType || null };
    const limit = resolveLimit(req.query.limit);

    let afterId = 0;
    if (req.query.cursor) {
      const decoded = decodeCursor(String(req.query.cursor), req.federation.clientId);
      if (!decoded || decoded.filtersHash !== hashFilters(filters)) {
        return res.status(400).json({ error: 'Invalid or expired cursor.', code: 'INVALID_CURSOR' });
      }
      afterId = decoded.lastId;
    }

    const conditions = [eq(schema.federationWebhookOutbox.tenantId, tenantId), gt(schema.federationWebhookOutbox.id, afterId)];
    if (filters.eventType) conditions.push(eq(schema.federationWebhookOutbox.eventType, String(filters.eventType)));

    const rows = await db.select().from(schema.federationWebhookOutbox)
      .where(and(...conditions))
      .orderBy(asc(schema.federationWebhookOutbox.id))
      .limit(limit);

    const events = rows.map((row: any) => ({
      eventId: row.eventId,
      eventType: row.eventType,
      schemaVersion: row.schemaVersion,
      providerSequence: String(row.id),
      aggregate: { type: row.aggregateType, id: row.aggregateId, version: row.aggregateVersion },
      occurredAt: row.occurredAt,
      businessDate: row.businessDate,
      data: row.data,
    }));

    const nextCursor = rows.length === limit
      ? encodeCursor({ clientId: req.federation.clientId, filtersHash: hashFilters(filters), sort: 'id_asc', asOf: new Date().toISOString(), lastId: rows[rows.length - 1].id })
      : null;

    res.json({ events, nextCursor });
  } catch (err: any) {
    sendServerError(res, err, 'federation/platform.routes.ts');
  }
});

// Job status polling for any 202-Accepted async mutation (e.g. a large
// payroll batch calculation) — background_jobs is the existing generic
// queue table (services/queue/postgresQueue.ts); this exposes a
// read-only, tenant-scoped view of one row by id.
router.get('/v1/federation/jobs/:jobId', resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId)) return res.status(400).json({ error: 'jobId must be an integer.' });
    const rows = await db.select().from(schema.backgroundJobs).where(
      and(eq(schema.backgroundJobs.id, jobId), eq(schema.backgroundJobs.tenantId, req.federation.tenantId))
    ).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Job not found.' });
    const job = rows[0];
    const statusMap: Record<string, string> = { pending: 'queued', running: 'running', done: 'succeeded', failed: 'failed' };
    res.json({
      jobId: String(job.id),
      status: statusMap[job.status] || job.status,
      resultUrl: job.status === 'done' ? `/v1/federation/jobs/${job.id}/result` : undefined,
    });
  } catch (err: any) {
    sendServerError(res, err, 'federation/platform.routes.ts');
  }
});
