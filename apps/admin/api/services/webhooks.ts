import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../db';
import { logger } from '../../logger';

// SSRF guard: a tenant-configured webhook URL is attacker-controlled input
// from the server's point of view — without this, any tenant admin could
// register a URL pointing at the cloud metadata endpoint (169.254.169.254),
// localhost, or an internal-only service, and every subsequent event
// (payroll run completed, leave approved, etc.) would make this server POST
// to it. Checked both at subscription-creation time (webhooks.routes.ts) and
// again here at dispatch time (defense in depth against DNS rebinding —
// a hostname that resolved to a public IP at creation time could be
// re-pointed at an internal IP by the time an event fires).
function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 0) return true; // "this" network
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1') return true; // loopback
    if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true; // link-local / unique-local
    if (lower.startsWith('::ffff:')) return isPrivateOrReservedIp(lower.slice(7)); // IPv4-mapped
    return false;
  }
  return true; // not a recognizable literal IP — reject rather than guess
}

export async function assertWebhookUrlIsSafe(rawUrl: string): Promise<void> {
  const parsed = new URL(rawUrl);
  if (parsed.hostname === 'localhost') throw new Error('Webhook URL may not target localhost.');
  let addresses: string[];
  try {
    const results = await dns.lookup(parsed.hostname, { all: true });
    addresses = results.map((r) => r.address);
  } catch {
    throw new Error('Webhook URL hostname could not be resolved.');
  }
  if (addresses.length === 0 || addresses.some(isPrivateOrReservedIp)) {
    throw new Error('Webhook URL resolves to a private, loopback, or link-local address, which is not allowed.');
  }
}

// Event names a subscription can request. Kept as a fixed list (rather than
// "any string") so a typo in a subscription's `events` array fails loudly at
// creation time instead of silently never firing.
export const WEBHOOK_EVENTS = [
  'attendance.checked_in',
  'attendance.checked_out',
  'attendance.correction_resolved',
  'attendance.break_violation',
  'attendance.edited',
  'leave.requested',
  'leave.approved',
  'leave.rejected',
  'leave.amended',
  'payroll.run_completed',
  'employee.terminated',
  'shift.swap_approved',
  'ticket.raised',
  'ticket.resolved',
  'ticket.escalated',
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
    await assertWebhookUrlIsSafe(sub.url);
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
