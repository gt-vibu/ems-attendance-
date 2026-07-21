import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { isPushConfigured } from '../services/push';

export const router = Router();

// Self-service — no privilege required, exactly like registering a
// WebAuthn device: subscribing to push is something every user does for
// themselves, not something an admin grants.
router.get('/api/push/vapid-public-key', authenticate, async (req: any, res: any) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '', configured: isPushConfigured() });
});

router.post('/api/push/subscribe', authenticate, async (req: any, res: any) => {
  try {
    const { endpoint, keys } = req.body?.subscription || req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'A valid PushSubscription (endpoint + keys.p256dh + keys.auth) is required.' });
    }
    const existing = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, endpoint)).limit(1);
    if (existing.length > 0) {
      // Same browser re-subscribing (e.g. after a permission reset) —
      // reassign to the current user rather than erroring on the unique
      // endpoint constraint.
      await db.update(schema.pushSubscriptions).set({
        userId: req.user.userId, tenantId: req.user.tenantId, p256dhKey: keys.p256dh, authKey: keys.auth,
        userAgent: req.headers['user-agent'] || null,
      }).where(eq(schema.pushSubscriptions.id, existing[0].id));
    } else {
      await db.insert(schema.pushSubscriptions).values({
        userId: req.user.userId, tenantId: req.user.tenantId, endpoint, p256dhKey: keys.p256dh, authKey: keys.auth,
        userAgent: req.headers['user-agent'] || null,
      });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/push/unsubscribe', authenticate, async (req: any, res: any) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });
    await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, endpoint));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
