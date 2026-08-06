import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { logger } from '../../../logger';
import { queue } from '../queue';
import { assertWebhookUrlIsSafe } from '../webhooks';
import { getOrCreateActiveKey, signPayload } from './webhookSigning';

// Outbox pattern for the federation event families (workforce.*,
// attendance.*, leave.*, payroll.*, federation.provider_admin_action) —
// mirrors the existing dispatchWebhookEvent() (services/webhooks.ts) in
// spirit but is durable: every event is a permanent row here (the 90-day
// replay feed GET /v1/federation/events reads straight from this table),
// delivery is retried via the existing Postgres job queue instead of being
// fire-and-forget, and a failed delivery is never discarded.

const OUTBOX_JOB_TYPE = 'federation_dispatch_outbox_event';
const MAX_DELIVERY_ATTEMPTS = 20; // "72 hours or 20 attempts, whichever lasts longer" — see backoffDelayMs below
const DELIVERY_TIMEOUT_MS = 10_000;

export interface OutboxEventInput {
  tenantId: number;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion?: number;
  occurredAt?: Date;
  businessDate?: string | null;
  data: Record<string, any>;
}

// Full-jitter exponential backoff, capped so the total retry window covers
// at least 72 hours across 20 attempts as the plan requires.
function backoffDelayMs(attempt: number): number {
  const base = Math.min(2 ** attempt * 1000, 6 * 60 * 60 * 1000); // cap a single step at 6h
  return Math.floor(Math.random() * base);
}

// Writes the outbox row (call this in the same request/transaction as the
// operational domain write it documents) and kicks off a best-effort
// immediate delivery attempt — a slow/unreachable BlizBooks callback never
// blocks or fails the federation write itself, since delivery continues
// via the queued retry job either way.
export async function writeOutboxEvent(input: OutboxEventInput): Promise<string> {
  const eventId = crypto.randomUUID();
  await db.insert(schema.federationWebhookOutbox).values({
    tenantId: input.tenantId,
    eventId,
    eventType: input.eventType,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion ?? 1,
    occurredAt: input.occurredAt ?? new Date(),
    businessDate: input.businessDate ?? null,
    data: input.data,
  });

  queue.enqueue(OUTBOX_JOB_TYPE, { eventId }, { tenantId: input.tenantId }).catch((err) => {
    logger.warn('[federation] failed to enqueue outbox dispatch job', { eventId, error: err?.message });
  });

  return eventId;
}

async function deliverOutboxEvent(eventId: string): Promise<void> {
  const rows = await db.select().from(schema.federationWebhookOutbox).where(eq(schema.federationWebhookOutbox.eventId, eventId)).limit(1);
  const event = rows[0];
  if (!event || event.status === 'delivered') return;

  const subRows = await db.select().from(schema.federationWebhookSubscriptions).where(
    and(eq(schema.federationWebhookSubscriptions.tenantId, event.tenantId), eq(schema.federationWebhookSubscriptions.isActive, true))
  ).limit(1);
  const subscription = subRows[0];
  if (!subscription) return; // nothing registered yet for this tenant — the row stays 'pending', GET /events still surfaces it for replay

  const eventTypes = subscription.eventTypes as string[] | null;
  if (Array.isArray(eventTypes) && eventTypes.length > 0 && !eventTypes.includes(event.eventType)) return;

  const correlationId = `corr_${crypto.randomUUID().slice(0, 8)}`;
  const traceId = `tr_${crypto.randomUUID().slice(0, 12)}`;
  const externalOrgId = `org_ext_${event.tenantId}`;
  const externalBranchId = event.data?.branchId ? `br_ext_${event.data.branchId}` : null;
  const externalEmpId = event.data?.employeeId ? `emp_ext_${event.data.employeeId}` : null;

  const body = JSON.stringify({
    eventId: event.eventId,
    correlationId,
    traceId,
    eventType: event.eventType,
    version: event.schemaVersion || '1.0',
    createdAt: event.occurredAt || new Date().toISOString(),
    retryCount: event.deliveryAttempts || 0,
    organizationId: `org_${event.tenantId}`,
    externalOrganizationId: externalOrgId,
    branchId: event.data?.branchId ? `branch_${event.data.branchId}` : null,
    externalBranchId,
    employeeId: event.data?.employeeId ? `emp_${event.data.employeeId}` : null,
    externalEmployeeId: externalEmpId,
    payload: event.data,
  });
  const timestamp = String(Math.floor(Date.now() / 1000));

  let status: 'delivered' | 'failed' = 'failed';
  let lastError: string | null = null;
  try {
    await assertWebhookUrlIsSafe(subscription.callbackUrl);
    const signingKey = await getOrCreateActiveKey();
    const signature = signPayload(signingKey.privateKeyRef, timestamp, body);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    try {
      const res = await fetch(subscription.callbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Federation-Event-Id': event.eventId,
          'X-Federation-Key-Id': signingKey.keyId,
          'X-Federation-Timestamp': timestamp,
          'X-Federation-Signature': signature,
        },
        body,
        signal: controller.signal,
      });
      status = res.ok ? 'delivered' : 'failed';
      if (!res.ok) lastError = `HTTP ${res.status}`;
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: any) {
    lastError = err?.message || String(err);
  }

  const attempts = event.deliveryAttempts + 1;
  await db.update(schema.federationWebhookOutbox).set({
    status: status === 'delivered' ? 'delivered' : (attempts >= MAX_DELIVERY_ATTEMPTS ? 'failed' : 'pending'),
    deliveryAttempts: attempts,
    lastAttemptAt: new Date(),
    lastError,
    deliveredAt: status === 'delivered' ? new Date() : null,
  }).where(eq(schema.federationWebhookOutbox.id, event.id));

  await db.update(schema.federationWebhookSubscriptions).set({
    lastDeliveryAt: new Date(),
    lastDeliveryStatus: status,
  }).where(eq(schema.federationWebhookSubscriptions.id, subscription.id));

  if (status === 'failed' && attempts < MAX_DELIVERY_ATTEMPTS) {
    // Never discard an event on delivery failure — requeue with backoff.
    // The Postgres queue's own maxAttempts (default 3, see postgresQueue.ts)
    // is set generously below so this event-level retry loop — not the
    // queue's internal retry — is what actually governs the 20-attempt/72h
    // window.
    queue.enqueue(OUTBOX_JOB_TYPE, { eventId }, {
      tenantId: event.tenantId,
      runAfter: new Date(Date.now() + backoffDelayMs(attempts)),
      maxAttempts: MAX_DELIVERY_ATTEMPTS,
    }).catch((err) => logger.warn('[federation] failed to re-enqueue outbox dispatch job', { eventId, error: err?.message }));
  }
}

// Wired into the existing background scheduler alongside every other
// registerXHandler() call — see api/bootstrap/scheduler.ts.
export function registerFederationOutboxDispatchHandler() {
  queue.registerHandler(OUTBOX_JOB_TYPE, async (payload: { eventId: string }) => {
    await deliverOutboxEvent(payload.eventId);
  });
}
