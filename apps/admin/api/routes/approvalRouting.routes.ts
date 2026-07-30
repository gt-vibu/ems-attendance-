import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege, isPlatformFeatureAllowedForTenant } from '../auth/rbac';
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

// Notification content overrides — same feature/privilege gate as routing,
// since both live on the same admin screen (Phase 9).
router.get('/api/tenant/notification-templates', authenticate, async (req: any, res: any) => {
  try {
    if (!await requireRoutingFeature(req, res)) return;
    const templates = await db.select().from(schema.notificationTemplates)
      .where(eq(schema.notificationTemplates.tenantId, req.user.tenantId));
    res.json({ templates });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/api/tenant/notification-templates', authenticate, async (req: any, res: any) => {
  try {
    if (!await requireRoutingFeature(req, res)) return;
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
