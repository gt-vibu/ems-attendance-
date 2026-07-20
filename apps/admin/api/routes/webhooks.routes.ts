import { Router } from 'express';
import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { WEBHOOK_EVENTS } from '../services/webhooks';

export const router = Router();

function canManageWebhooks(user: any): boolean {
  return user?.role === 'tenant_admin' || user?.role === 'super_admin';
}

router.get('/api/tenant/webhooks', authenticate, async (req: any, res: any) => {
  try {
    if (!canManageWebhooks(req.user)) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const rows = await db.select().from(schema.webhookSubscriptions).where(eq(schema.webhookSubscriptions.tenantId, req.user.tenantId));
    res.json({
      webhooks: rows.map((r: any) => ({
        id: r.id,
        url: r.url,
        events: r.events,
        isActive: r.isActive,
        lastDeliveryAt: r.lastDeliveryAt,
        lastDeliveryStatus: r.lastDeliveryStatus,
        createdAt: r.createdAt,
        // signingSecret intentionally omitted — only returned once, at creation.
      })),
      availableEvents: WEBHOOK_EVENTS,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/tenant/webhooks', authenticate, async (req: any, res: any) => {
  try {
    if (!canManageWebhooks(req.user)) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const { url, events } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url is required' });
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ error: 'url must be a valid absolute URL' });
    }
    if (parsed.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
      return res.status(400).json({ error: 'url must use https in production' });
    }
    if (!Array.isArray(events) || events.length === 0 || events.some((e: string) => !WEBHOOK_EVENTS.includes(e as any))) {
      return res.status(400).json({ error: `events must be a non-empty array from: ${WEBHOOK_EVENTS.join(', ')}` });
    }

    const signingSecret = crypto.randomBytes(24).toString('base64url');
    const [created] = await db.insert(schema.webhookSubscriptions).values({
      tenantId: req.user.tenantId,
      url,
      events,
      signingSecret,
      createdByUserId: req.user.userId,
    }).returning();

    res.status(201).json({
      webhook: { id: created.id, url: created.url, events: created.events, isActive: created.isActive, createdAt: created.createdAt },
      // Shown once — the receiving app needs this to verify the
      // X-SmartTeams-Signature header on each delivery.
      signingSecret,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/tenant/webhooks/:id', authenticate, async (req: any, res: any) => {
  try {
    if (!canManageWebhooks(req.user)) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const id = Number(req.params.id);
    const rows = await db.select().from(schema.webhookSubscriptions).where(
      and(eq(schema.webhookSubscriptions.id, id), eq(schema.webhookSubscriptions.tenantId, req.user.tenantId))
    ).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Webhook subscription not found' });

    await db.delete(schema.webhookSubscriptions).where(eq(schema.webhookSubscriptions.id, id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
