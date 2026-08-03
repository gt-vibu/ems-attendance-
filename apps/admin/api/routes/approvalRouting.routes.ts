import { Router } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege, isPlatformFeatureAllowedForTenant } from '../auth/rbac';
import { DEFAULT_POLICY_EVENT_TYPES, notify, retryNotificationLogEntry } from '../services/notificationService';
import { logToAuditLedger } from '../services/audit';

export const router = Router();

const CATEGORIES = ['leave', 'attendance_correction', 'wfh', 'missed_checkout', 'late_arrival'];
const SCOPE_TYPES = ['all', 'department', 'branch', 'team'];
const APPROVER_TYPES = ['role', 'specific_user', 'reporting_manager'];

async function requireRoutingFeature(req: any, res: any): Promise<boolean> {
  if (!await hasPrivilege(req.user, 'approval_routing.manage')) {
    res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    return false;
  }
  if (!await isPlatformFeatureAllowedForTenant(req.user.tenantId, 'notification_routing')) {
    res.status(403).json({ error: 'Configurable Approval Routing is not included in your organization\'s plan.' });
    return false;
  }
  return true;
}

router.get('/api/tenant/approval-routing', authenticate, async (req: any, res: any) => {
  try {
    if (!await requireRoutingFeature(req, res)) return;
    const rules = await db.select().from(schema.approvalRoutingRules)
      .where(eq(schema.approvalRoutingRules.tenantId, req.user.tenantId));
    res.json({ rules });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/tenant/approval-routing', authenticate, async (req: any, res: any) => {
  try {
    if (!await requireRoutingFeature(req, res)) return;
    const { category, scopeType, scopeId, scopeValue, approverType, approverValue, priority } = req.body || {};
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category.' });
    if (!SCOPE_TYPES.includes(scopeType)) return res.status(400).json({ error: 'Invalid scopeType.' });
    if (!APPROVER_TYPES.includes(approverType)) return res.status(400).json({ error: 'Invalid approverType.' });
    if (approverType !== 'reporting_manager' && !approverValue) {
      return res.status(400).json({ error: 'approverValue is required unless approverType is "reporting_manager".' });
    }

    const [created] = await db.insert(schema.approvalRoutingRules).values({
      tenantId: req.user.tenantId,
      category,
      scopeType,
      scopeId: scopeId ?? null,
      scopeValue: scopeValue || null,
      approverType,
      approverValue: approverType === 'reporting_manager' ? null : String(approverValue),
      priority: Number.isFinite(priority) ? priority : 0,
    }).returning();

    await logToAuditLedger({
      tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name,
      action: 'APPROVAL_ROUTING_RULE_CREATED', details: { ruleId: created.id, category, scopeType, approverType },
    });

    res.json({ rule: created });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/tenant/approval-routing/:id', authenticate, async (req: any, res: any) => {
  try {
    if (!await requireRoutingFeature(req, res)) return;
    const ruleId = parseInt(req.params.id, 10);
    const rows = await db.select().from(schema.approvalRoutingRules).where(eq(schema.approvalRoutingRules.id, ruleId)).limit(1);
    if (rows.length === 0 || rows[0].tenantId !== req.user.tenantId) {
      return res.status(404).json({ error: 'Routing rule not found.' });
    }
    await db.delete(schema.approvalRoutingRules).where(eq(schema.approvalRoutingRules.id, ruleId));
    await logToAuditLedger({
      tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name,
      action: 'APPROVAL_ROUTING_RULE_DELETED', details: { ruleId },
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Notification content overrides — gated the same as Notification Policies
// (notification_policies.manage + unified_notifications), not Approval
// Routing: templates are edited from the Notification Policies screen's
// Templates tab, not the routing screen, so requiring a separate
// approval_routing.manage privilege here meant anyone who could manage
// notification policies still couldn't reach templates. requireNotification-
// PoliciesFeature is defined further down in this file.
router.get('/api/tenant/notification-templates', authenticate, async (req: any, res: any) => {
  try {
    if (!await requireNotificationPoliciesFeature(req, res)) return;
    const templates = await db.select().from(schema.notificationTemplates)
      .where(eq(schema.notificationTemplates.tenantId, req.user.tenantId));
    res.json({ templates });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/api/tenant/notification-templates', authenticate, async (req: any, res: any) => {
  try {
    if (!await requireNotificationPoliciesFeature(req, res)) return;
    const { eventType, channel, subject, body } = req.body || {};
    if (!eventType || !body) return res.status(400).json({ error: 'eventType and body are required.' });
    const resolvedChannel = channel || 'email';

    const existing = await db.select().from(schema.notificationTemplates).where(
      and(
        eq(schema.notificationTemplates.tenantId, req.user.tenantId),
        eq(schema.notificationTemplates.eventType, eventType),
        eq(schema.notificationTemplates.channel, resolvedChannel),
      )
    ).limit(1);

    let saved;
    if (existing.length > 0) {
      [saved] = await db.update(schema.notificationTemplates)
        .set({ subject: subject || null, body })
        .where(eq(schema.notificationTemplates.id, existing[0].id))
        .returning();
    } else {
      [saved] = await db.insert(schema.notificationTemplates).values({
        tenantId: req.user.tenantId, eventType, channel: resolvedChannel, subject: subject || null, body,
      }).returning();
    }

    await logToAuditLedger({
      tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name,
      action: 'NOTIFICATION_TEMPLATE_SAVED', details: { eventType, channel: resolvedChannel },
    });

    res.json({ template: saved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Notification policies (Unified Notification Service, see
// services/notificationService.ts) — separate feature gate
// ('unified_notifications') and privilege from the routing/templates
// above, since a tenant may want the recipient-policy matrix without
// opting into the whole approval-routing engine.
async function requireNotificationPoliciesFeature(req: any, res: any): Promise<boolean> {
  if (!await hasPrivilege(req.user, 'notification_policies.manage')) {
    res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    return false;
  }
  if (!await isPlatformFeatureAllowedForTenant(req.user.tenantId, 'unified_notifications')) {
    res.status(403).json({ error: 'Unified Notification Policies is not included in your organization\'s plan.' });
    return false;
  }
  return true;
}

router.get('/api/tenant/notification-policies', authenticate, async (req: any, res: any) => {
  try {
    if (!await requireNotificationPoliciesFeature(req, res)) return;
    const rows = await db.select().from(schema.notificationPolicies).where(eq(schema.notificationPolicies.tenantId, req.user.tenantId));
    res.json({ policies: rows, eventTypes: DEFAULT_POLICY_EVENT_TYPES });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/api/tenant/notification-policies', authenticate, async (req: any, res: any) => {
  try {
    if (!await requireNotificationPoliciesFeature(req, res)) return;
    const { eventType, notifyEmployee, notifyManager, notifyHR, notifyAdmin, channels, scopeHrToDepartment, employeeMode, managerMode, hrMode, adminMode, priority } = req.body || {};
    if (!eventType) return res.status(400).json({ error: 'eventType is required.' });
    const resolvedChannels = Array.isArray(channels) && channels.length > 0 ? channels : ['in_app', 'email'];
    const MODES = ['immediate', 'digest', 'none'];
    const PRIORITIES = ['critical', 'high', 'medium', 'low', 'silent'];
    const resolvedMode = (v: any) => (MODES.includes(v) ? v : 'immediate');
    const resolvedPriority = PRIORITIES.includes(priority) ? priority : 'medium';

    const existing = await db.select().from(schema.notificationPolicies).where(
      and(eq(schema.notificationPolicies.tenantId, req.user.tenantId), eq(schema.notificationPolicies.eventType, eventType))
    ).limit(1);

    const values = {
      notifyEmployee: !!notifyEmployee, notifyManager: !!notifyManager, notifyHR: !!notifyHR, notifyAdmin: !!notifyAdmin,
      channels: resolvedChannels, scopeHrToDepartment: !!scopeHrToDepartment,
      employeeMode: resolvedMode(employeeMode), managerMode: resolvedMode(managerMode), hrMode: resolvedMode(hrMode), adminMode: resolvedMode(adminMode),
      priority: resolvedPriority,
    };

    let saved;
    if (existing.length > 0) {
      [saved] = await db.update(schema.notificationPolicies)
        .set(values)
        .where(eq(schema.notificationPolicies.id, existing[0].id))
        .returning();
    } else {
      [saved] = await db.insert(schema.notificationPolicies).values({
        tenantId: req.user.tenantId, eventType, ...values,
      }).returning();
    }

    await logToAuditLedger({
      tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name,
      action: 'NOTIFICATION_POLICY_SAVED', details: { eventType },
    });

    res.json({ policy: saved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Notification History — real Sent/Failed rows written by
// registerNotificationDeliveryHandler (notificationService.ts) as each
// delivery actually happens. Most recent 100 for the tenant.
router.get('/api/tenant/notification-log', authenticate, async (req: any, res: any) => {
  try {
    if (!await requireNotificationPoliciesFeature(req, res)) return;
    const rows = await db.select({
      id: schema.notificationLog.id,
      eventType: schema.notificationLog.eventType,
      channel: schema.notificationLog.channel,
      status: schema.notificationLog.status,
      error: schema.notificationLog.error,
      attempts: schema.notificationLog.attempts,
      createdAt: schema.notificationLog.createdAt,
      recipientName: schema.users.name,
    }).from(schema.notificationLog)
      .leftJoin(schema.users, eq(schema.notificationLog.recipientUserId, schema.users.id))
      .where(eq(schema.notificationLog.tenantId, req.user.tenantId))
      .orderBy(desc(schema.notificationLog.createdAt))
      .limit(100);
    res.json({ entries: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Re-sends a specific failed delivery exactly as originally attempted (see
// retryNotificationLogEntry in notificationService.ts) — surfaced as a
// "Retry now" action next to failed rows in the History tab.
router.post('/api/tenant/notification-log/:id/retry', authenticate, async (req: any, res: any) => {
  try {
    if (!await requireNotificationPoliciesFeature(req, res)) return;
    const logId = parseInt(req.params.id, 10);
    const rows = await db.select().from(schema.notificationLog).where(
      and(eq(schema.notificationLog.id, logId), eq(schema.notificationLog.tenantId, req.user.tenantId)),
    ).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Notification log entry not found.' });
    if (rows[0].status !== 'failed') return res.status(400).json({ error: 'Only failed deliveries can be retried.' });
    await retryNotificationLogEntry(logId, req.user.tenantId);
    await logToAuditLedger({
      tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name,
      action: 'NOTIFICATION_DELIVERY_RETRIED', details: { logId },
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Fires a real notify() call for the given event type, scoped ONLY to the
// clicking admin (regardless of that event's actual configured recipients),
// using synthetic placeholder data — lets an admin verify a policy/template
// renders sensibly before enabling it broadly, without notifying anyone
// else. Deliberately bypasses resolveRecipients() the same way
// notifyDirectRecipient does, for the same reason: the caller already knows
// exactly who should receive this (themself).
router.post('/api/tenant/notifications/test', authenticate, async (req: any, res: any) => {
  try {
    if (!await requireNotificationPoliciesFeature(req, res)) return;
    const { eventType } = req.body || {};
    if (!eventType) return res.status(400).json({ error: 'eventType is required.' });
    await notify(req.user.tenantId, eventType, {
      subjectUserId: req.user.userId,
      subjectName: req.user.name,
      data: { test: true, note: 'This is a test notification triggered from the Notification Center.' },
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Digest subscriptions — admin-configurable "who gets the rollup, how
// often" (see notification_digest_subscriptions in schema.ts). Recipients
// support both role defaults and arbitrary named employees:
// [{type:'role', role:'manager'|'HR'|'tenant_admin'} | {type:'user', userId}]
const DIGEST_TYPES = ['manager_daily', 'manager_weekly', 'hr_daily', 'hr_weekly', 'executive_daily', 'executive_weekly'];

router.get('/api/tenant/notification-digest-subscriptions', authenticate, async (req: any, res: any) => {
  try {
    if (!await requireNotificationPoliciesFeature(req, res)) return;
    const rows = await db.select().from(schema.notificationDigestSubscriptions).where(eq(schema.notificationDigestSubscriptions.tenantId, req.user.tenantId));
    res.json({ subscriptions: rows, digestTypes: DIGEST_TYPES });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/api/tenant/notification-digest-subscriptions/:id', authenticate, async (req: any, res: any) => {
  try {
    if (!await requireNotificationPoliciesFeature(req, res)) return;
    const id = parseInt(req.params.id, 10);
    const existingRows = await db.select().from(schema.notificationDigestSubscriptions).where(eq(schema.notificationDigestSubscriptions.id, id)).limit(1);
    if (existingRows.length === 0 || existingRows[0].tenantId !== req.user.tenantId) return res.status(404).json({ error: 'Digest subscription not found.' });

    const { frequency, timeOfDay, dayOfWeek, recipients, active } = req.body || {};
    const resolvedFrequency = frequency === 'weekly' ? 'weekly' : 'daily';
    const resolvedRecipients = Array.isArray(recipients) ? recipients.filter((r: any) =>
      (r?.type === 'role' && typeof r.role === 'string') || (r?.type === 'user' && Number.isFinite(r.userId))
    ) : existingRows[0].recipients;

    const [saved] = await db.update(schema.notificationDigestSubscriptions).set({
      frequency: resolvedFrequency,
      timeOfDay: timeOfDay || existingRows[0].timeOfDay,
      dayOfWeek: resolvedFrequency === 'weekly' ? (Number.isFinite(dayOfWeek) ? dayOfWeek : (existingRows[0].dayOfWeek ?? 1)) : null,
      recipients: resolvedRecipients,
      active: active === undefined ? existingRows[0].active : !!active,
    }).where(eq(schema.notificationDigestSubscriptions.id, id)).returning();

    await logToAuditLedger({
      tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name,
      action: 'NOTIFICATION_DIGEST_SUBSCRIPTION_SAVED', details: { id, digestType: existingRows[0].digestType },
    });

    res.json({ subscription: saved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Recipient Groups — reusable {employee/manager/HR/admin, channels} presets
// (see notificationRecipientGroups in schema.ts for why applying a group is
// a one-time copy into notification_policies, not a live reference).
router.get('/api/tenant/notification-recipient-groups', authenticate, async (req: any, res: any) => {
  try {
    if (!await requireNotificationPoliciesFeature(req, res)) return;
    const groups = await db.select().from(schema.notificationRecipientGroups).where(eq(schema.notificationRecipientGroups.tenantId, req.user.tenantId));
    res.json({ groups });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/tenant/notification-recipient-groups', authenticate, async (req: any, res: any) => {
  try {
    if (!await requireNotificationPoliciesFeature(req, res)) return;
    const { name, notifyEmployee, notifyManager, notifyHR, notifyAdmin, channels } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required.' });
    const resolvedChannels = Array.isArray(channels) && channels.length > 0 ? channels : ['in_app', 'email'];
    const [created] = await db.insert(schema.notificationRecipientGroups).values({
      tenantId: req.user.tenantId, name: String(name).trim(),
      notifyEmployee: !!notifyEmployee, notifyManager: !!notifyManager, notifyHR: !!notifyHR, notifyAdmin: !!notifyAdmin,
      channels: resolvedChannels,
    }).returning();
    await logToAuditLedger({
      tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name,
      action: 'NOTIFICATION_RECIPIENT_GROUP_CREATED', details: { groupId: created.id, name: created.name },
    });
    res.json({ group: created });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/tenant/notification-recipient-groups/:id', authenticate, async (req: any, res: any) => {
  try {
    if (!await requireNotificationPoliciesFeature(req, res)) return;
    const id = parseInt(req.params.id, 10);
    const rows = await db.select().from(schema.notificationRecipientGroups).where(eq(schema.notificationRecipientGroups.id, id)).limit(1);
    if (rows.length === 0 || rows[0].tenantId !== req.user.tenantId) return res.status(404).json({ error: 'Recipient group not found.' });
    await db.delete(schema.notificationRecipientGroups).where(eq(schema.notificationRecipientGroups.id, id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Applies a saved group's recipient/channel settings to one or more event
// types in one request — the "avoid repeating the same configuration
// across dozens of notification types" ask. Reuses the exact upsert logic
// PUT /api/tenant/notification-policies already has, just looped.
router.post('/api/tenant/notification-recipient-groups/:id/apply', authenticate, async (req: any, res: any) => {
  try {
    if (!await requireNotificationPoliciesFeature(req, res)) return;
    const id = parseInt(req.params.id, 10);
    const eventTypes: string[] = Array.isArray(req.body?.eventTypes) ? req.body.eventTypes : [];
    if (eventTypes.length === 0) return res.status(400).json({ error: 'eventTypes must be a non-empty array.' });
    const groupRows = await db.select().from(schema.notificationRecipientGroups).where(eq(schema.notificationRecipientGroups.id, id)).limit(1);
    if (groupRows.length === 0 || groupRows[0].tenantId !== req.user.tenantId) return res.status(404).json({ error: 'Recipient group not found.' });
    const group = groupRows[0];

    for (const eventType of eventTypes) {
      const existing = await db.select().from(schema.notificationPolicies).where(
        and(eq(schema.notificationPolicies.tenantId, req.user.tenantId), eq(schema.notificationPolicies.eventType, eventType))
      ).limit(1);
      const values = {
        notifyEmployee: group.notifyEmployee, notifyManager: group.notifyManager, notifyHR: group.notifyHR, notifyAdmin: group.notifyAdmin,
        channels: group.channels,
      };
      if (existing.length > 0) {
        await db.update(schema.notificationPolicies).set(values).where(eq(schema.notificationPolicies.id, existing[0].id));
      } else {
        await db.insert(schema.notificationPolicies).values({ tenantId: req.user.tenantId, eventType, ...values });
      }
    }

    await logToAuditLedger({
      tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name,
      action: 'NOTIFICATION_RECIPIENT_GROUP_APPLIED', details: { groupId: id, groupName: group.name, eventTypes },
    });

    res.json({ success: true, appliedTo: eventTypes.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
