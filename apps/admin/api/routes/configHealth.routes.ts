import { Router } from 'express';
import { eq, and, gte } from 'drizzle-orm';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege, isPlatformFeatureAllowedForTenant } from '../auth/rbac';

export const router = Router();

// Every check here reads real tables this codebase already has — no
// fabricated metrics. A check is either 'ok' (something exists / is
// configured) or 'warning' (missing, but not blocking) — nothing here is
// framed as an error, since an incomplete setup is expected mid-onboarding,
// not a bug. `tab` maps to wherever a tenant admin would go to fix it, so
// the frontend can render each row as a direct link.
interface HealthCheck {
  id: string;
  label: string;
  status: 'ok' | 'warning';
  message: string;
  tab: string;
}

router.get('/api/tenant/config-health', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'employee.read')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const tenantId = req.user.tenantId;
    const checks: HealthCheck[] = [];

    const [
      branchCount,
      employeeCount,
      leavePolicyCount,
      compensationProfileCount,
      holidayRows,
      notificationPolicyCount,
      notificationTemplateCount,
      approvalRoutingCount,
      payrollCalendarCount,
      payrollBatchesAllowed,
      unifiedNotificationsAllowed,
    ] = await Promise.all([
      db.select().from(schema.branches).where(eq(schema.branches.tenantId, tenantId)),
      db.select().from(schema.users).where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.employeeStatus, 'active'))),
      db.select().from(schema.leavePolicies).where(eq(schema.leavePolicies.tenantId, tenantId)),
      db.select({ userId: schema.employeeCompensationProfiles.userId }).from(schema.employeeCompensationProfiles).where(eq(schema.employeeCompensationProfiles.tenantId, tenantId)),
      db.select().from(schema.holidays).where(and(eq(schema.holidays.tenantId, tenantId), eq(schema.holidays.isArchived, false))),
      db.select().from(schema.notificationPolicies).where(eq(schema.notificationPolicies.tenantId, tenantId)),
      db.select().from(schema.notificationTemplates).where(eq(schema.notificationTemplates.tenantId, tenantId)),
      db.select().from(schema.approvalRoutingRules).where(eq(schema.approvalRoutingRules.tenantId, tenantId)),
      db.select().from(schema.payrollCalendars).where(eq(schema.payrollCalendars.tenantId, tenantId)),
      isPlatformFeatureAllowedForTenant(tenantId, 'payroll_batches'),
      isPlatformFeatureAllowedForTenant(tenantId, 'unified_notifications'),
    ]);

    checks.push({
      id: 'branches',
      label: 'Branches configured',
      status: branchCount.length > 0 ? 'ok' : 'warning',
      message: branchCount.length > 0 ? `${branchCount.length} branch${branchCount.length === 1 ? '' : 'es'} set up.` : 'No branches added yet — attendance geofencing/Wi-Fi rules have nothing to attach to.',
      tab: 'branches',
    });

    checks.push({
      id: 'leave_policies',
      label: 'Leave policies configured',
      status: leavePolicyCount.length > 0 ? 'ok' : 'warning',
      message: leavePolicyCount.length > 0 ? `${leavePolicyCount.length} leave type${leavePolicyCount.length === 1 ? '' : 's'} defined.` : 'No leave policies exist — employees have nothing to apply for.',
      tab: 'leave-management',
    });

    const employeesWithComp = new Set(compensationProfileCount.map((r: any) => r.userId));
    const employeesMissingComp = employeeCount.filter((e: any) => !employeesWithComp.has(e.id));
    checks.push({
      id: 'compensation',
      label: 'Payroll structures configured',
      status: employeeCount.length === 0 || employeesMissingComp.length === 0 ? 'ok' : 'warning',
      message: employeeCount.length === 0
        ? 'No active employees yet.'
        : employeesMissingComp.length === 0
          ? 'Every active employee has a compensation profile.'
          : `${employeesMissingComp.length} of ${employeeCount.length} active employee${employeeCount.length === 1 ? '' : 's'} have no compensation/CTC configured — their payroll will be skipped.`,
      tab: 'payroll',
    });

    const now = new Date();
    const nextYear = now.getFullYear() + 1;
    const hasNextYearHolidays = holidayRows.some((h: any) => String(h.date || '').startsWith(String(nextYear)));
    checks.push({
      id: 'holidays_next_year',
      label: `Holiday calendar for ${nextYear}`,
      status: hasNextYearHolidays ? 'ok' : 'warning',
      message: hasNextYearHolidays ? `Holidays already added for ${nextYear}.` : `No holidays added yet for ${nextYear} — add them before the year turns over.`,
      tab: 'leave-management',
    });

    checks.push({
      id: 'notification_policies',
      label: 'Notification policies customized',
      status: unifiedNotificationsAllowed ? (notificationPolicyCount.length > 0 ? 'ok' : 'warning') : 'ok',
      message: !unifiedNotificationsAllowed
        ? 'Unified Notifications isn\'t enabled for this tenant — every event uses its built-in default recipients.'
        : notificationPolicyCount.length > 0
          ? `${notificationPolicyCount.length} event${notificationPolicyCount.length === 1 ? '' : 's'} customized.`
          : 'Still using built-in defaults for every event — review who gets notified for absences, requests, and payroll.',
      tab: 'notification-policies',
    });

    checks.push({
      id: 'notification_templates',
      label: 'Message templates customized',
      status: notificationTemplateCount.length > 0 ? 'ok' : 'warning',
      message: notificationTemplateCount.length > 0 ? `${notificationTemplateCount.length} template${notificationTemplateCount.length === 1 ? '' : 's'} customized.` : 'Every notification still uses the generic built-in message — consider branding the ones employees see most.',
      tab: 'notification-policies',
    });

    checks.push({
      id: 'approval_routing',
      label: 'Approval routing configured',
      status: approvalRoutingCount.length > 0 ? 'ok' : 'warning',
      message: approvalRoutingCount.length > 0 ? `${approvalRoutingCount.length} routing rule${approvalRoutingCount.length === 1 ? '' : 's'} set up.` : 'No custom approval routing — requests fall back to whoever holds the relevant privilege tenant-wide.',
      tab: 'approval-routing',
    });

    if (payrollBatchesAllowed) {
      checks.push({
        id: 'payroll_calendar',
        label: 'Payroll calendar configured',
        status: payrollCalendarCount.length > 0 ? 'ok' : 'warning',
        message: payrollCalendarCount.length > 0 ? `${payrollCalendarCount.length} period${payrollCalendarCount.length === 1 ? '' : 's'} scheduled.` : 'Payroll Batches is enabled but no calendar dates are set — batch transitions have nothing to validate against.',
        tab: 'payroll',
      });
    }

    const okCount = checks.filter((c) => c.status === 'ok').length;
    const score = checks.length > 0 ? Math.round((okCount / checks.length) * 100) : 100;

    res.json({ score, checks });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
