import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../db';

// Per-tenant notification content override — a tenant with no row for
// (eventType, channel) gets the caller-supplied default subject/body
// unchanged (today's hardcoded strings, passed in as defaults by whichever
// send*Email/notifyUser call site this is used from in Phase 2's cutover).
// This file is build-only in Phase 0c: nothing calls it yet.

function interpolate(template: string, placeholders: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in placeholders ? placeholders[key] : match));
}

export interface RenderedNotification {
  subject: string;
  body: string;
}

export async function renderNotificationTemplate(
  tenantId: number,
  eventType: string,
  channel: string,
  defaults: { subject: string; body: string },
  placeholders: Record<string, string> = {},
): Promise<RenderedNotification> {
  const rows = await db.select().from(schema.notificationTemplates).where(
    and(
      eq(schema.notificationTemplates.tenantId, tenantId),
      eq(schema.notificationTemplates.eventType, eventType),
      eq(schema.notificationTemplates.channel, channel),
    )
  ).limit(1);
  const template = rows[0];
  const subject = template?.subject || defaults.subject;
  const body = template?.body || defaults.body;
  return { subject: interpolate(subject, placeholders), body: interpolate(body, placeholders) };
}
