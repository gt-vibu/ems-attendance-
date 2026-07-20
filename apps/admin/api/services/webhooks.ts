import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../db';
import { logger } from '../../logger';

// Event names a subscription can request. Kept as a fixed list (rather than
// "any string") so a typo in a subscription's `events` array fails loudly at
// creation time instead of silently never firing.
export const WEBHOOK_EVENTS = [
  'attendance.checked_in',
  'attendance.checked_out',
  'leave.requested',
  'leave.approved',
  'leave.rejected',
  'payroll.run_completed',
] as const;
export type WebhookEvent = typeof WEBHOOK_EVENTS[number];

// Fire-and-forget dispatch to every active subscription in the tenant that
// asked for this event. Deliberately does not await/block the caller's own
// request-response cycle on a third party's server responding — a slow or
// dead partner endpoint must never make attendance/leave/payroll actions
// feel slow or fail. Delivery failures are recorded on the subscription row
// for visibility, not retried (no queue infra here yet) — see
// api/routes/webhooks.routes.ts's list endpoint for surfacing failures.
export function dispatchWebhookEvent(tenantId: number, event: WebhookEvent, payload: Record<string, any>): void {
  db.select().from(schema.webhookSubscriptions).where(
    and(eq(schema.webhookSubscriptions.tenantId, tenantId), eq(schema.webhookSubscriptions.isActive, true))
  ).then((subs: any[]) => {
    const targets = subs.filter((s) => Array.isArray(s.events) && s.events.includes(event));
    for (const sub of targets) {
      deliverOne(sub, event, payload).catch((err) => {
        logger.warn('[webhooks] delivery failed', { subscriptionId: sub.id, event, err: err?.message });
      });
    }
  }).catch((err: any) => {
    logger.warn('[webhooks] subscription lookup failed', { tenantId, event, err: err?.message });
  });
}

async function deliverOne(sub: any, event: WebhookEvent, payload: Record<string, any>) {
  const body = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() });
  const signature = crypto.createHmac('sha256', sub.signingSecret).update(body).digest('hex');

  let status: 'success' | 'failed' = 'failed';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(sub.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Verify with: hex(HMAC-SHA256(signingSecret, rawRequestBody)) —
        // documented in openapi.ts under the webhooks section.
        'X-SmartTeams-Signature': signature,
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    status = res.ok ? 'success' : 'failed';
  } finally {
    try {
      await db.update(schema.webhookSubscriptions)
        .set({ lastDeliveryAt: new Date(), lastDeliveryStatus: status })
        .where(eq(schema.webhookSubscriptions.id, sub.id));
    } catch { /* best effort */ }
  }
}
