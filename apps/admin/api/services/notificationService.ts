import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../db';
import { getUsersWithPrivilege } from '../auth/rbac';
import { resolveEscalationAssignee } from './escalation';
import { renderNotificationTemplate } from './notificationTemplates';
import { notifyUser } from './notifications';
import { sendEmail } from '../../mail';
import { queue } from './queue';

// Single publish point every module calls instead of deciding recipients
// and calling sendEmail/notifyUser inline. `notify()` resolves recipients
// from a per-tenant policy row (notification_policies), falling back to a
// hardcoded default matching whatever that event already did before this
// service existed, then enqueues one delivery job per recipient per
// enabled channel — delivery itself happens async off the same Postgres
// job queue used elsewhere (services/queue), so a slow email provider
// never blocks the request that triggered the event.

export interface Recipient {
  id: number;
  name: string;
  email: string;
}

export interface NotifyContext {
  subjectUserId: number;
  subjectName: string;
  actorId?: number;
  data?: Record<string, any>;
}

interface DefaultPolicy {
  notifyEmployee: boolean;
  notifyManager: boolean;
  notifyHR: boolean;
  notifyAdmin: boolean;
  channels: string[];
  fallbackPrivileges: string | string[];
  // Optional — every hardcoded DEFAULT_POLICIES entry omits this (tenant-
  // wide HR, matching pre-existing behavior); only a saved
  // notification_policies row can turn it on.
  scopeHrToDepartment?: boolean;
}

// One row per known eventType — matches the recipient set that event's
// pre-existing inline sendEmail/notifyUser call already used, so enabling
// `unified_notifications` for a tenant with no custom policy rows changes
// nothing until they actually edit a policy.
const DEFAULT_POLICIES: Record<string, DefaultPolicy> = {
  attendance_auto_absent: { notifyEmployee: true, notifyManager: true, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: ['attendance.approve'] },
  attendance_missed_checkout: { notifyEmployee: true, notifyManager: true, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: ['attendance.approve'] },
  attendance_correction_requested: { notifyEmployee: false, notifyManager: true, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: ['attendance.approve'] },
  attendance_correction_decided: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  leave_requested: { notifyEmployee: false, notifyManager: true, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: ['leave.approve'] },
  leave_decided: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  payroll_generated: { notifyEmployee: false, notifyManager: false, notifyHR: true, notifyAdmin: true, channels: ['in_app', 'email'], fallbackPrivileges: ['payroll.manage'] },
  payroll_salary_changed: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  report_generation_completed: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  wfh_requested: { notifyEmployee: false, notifyManager: true, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: ['wfh.approve'] },
  wfh_decided: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  shift_assigned: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  shift_changed: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  shift_swap_requested: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  shift_swap_decided: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  leave_encashment_requested: { notifyEmployee: false, notifyManager: true, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: ['leave.approve'] },
  leave_encashment_decided: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  late_arrival_requested: { notifyEmployee: false, notifyManager: true, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: ['attendance.approve'] },
  late_arrival_decided: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  payroll_batch_calculated: { notifyEmployee: false, notifyManager: false, notifyHR: true, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: ['payroll.review.hr'] },
  payroll_batch_approved: { notifyEmployee: false, notifyManager: false, notifyHR: false, notifyAdmin: true, channels: ['in_app', 'email'], fallbackPrivileges: ['payroll.release'] },
  payroll_batch_released: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  salary_revised: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  bonus_added: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  loan_approved: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  reimbursement_approved: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  payroll_adjustment_created: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
};

export const DEFAULT_POLICY_EVENT_TYPES = Object.keys(DEFAULT_POLICIES);

const GENERIC_FALLBACK: DefaultPolicy = { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app'], fallbackPrivileges: [] };

async function loadPolicy(tenantId: number, eventType: string): Promise<DefaultPolicy & { channels: string[] }> {
  const rows = await db.select().from(schema.notificationPolicies).where(
    and(eq(schema.notificationPolicies.tenantId, tenantId), eq(schema.notificationPolicies.eventType, eventType)),
  ).limit(1);
  const row = rows[0];
  const fallback = DEFAULT_POLICIES[eventType] || GENERIC_FALLBACK;
  if (!row) return fallback;
  return {
    notifyEmployee: row.notifyEmployee,
    notifyManager: row.notifyManager,
    notifyHR: row.notifyHR,
    notifyAdmin: row.notifyAdmin,
    channels: Array.isArray(row.channels) ? (row.channels as string[]) : fallback.channels,
    fallbackPrivileges: fallback.fallbackPrivileges,
    scopeHrToDepartment: !!(row as any).scopeHrToDepartment,
  };
}

async function resolveRecipients(tenantId: number, policy: DefaultPolicy, ctx: NotifyContext): Promise<Recipient[]> {
  const recipients = new Map<number, Recipient>();

  if (policy.notifyEmployee) {
    const rows = await db.select().from(schema.users).where(eq(schema.users.id, ctx.subjectUserId)).limit(1);
    const u = rows[0];
    if (u) recipients.set(u.id, { id: u.id, name: u.name, email: u.email });
  }
  if (policy.notifyManager) {
    try {
      const manager = await resolveEscalationAssignee(tenantId, ctx.subjectUserId, 0);
      recipients.set(manager.userId, { id: manager.userId, name: manager.name, email: manager.email });
    } catch {
      // no manager configured for this employee — skip, don't fall back to admin fan-out silently
    }
  }
  if (policy.notifyHR) {
    let hrUsers = await getUsersWithPrivilege(tenantId, 'leave.approve');
    // Org-aware routing: "Engineering HR" only, not every HR-privileged
    // user tenant-wide — opt-in per policy (default off, tenant-wide HR
    // unchanged for anyone who hasn't turned this on).
    if (policy.scopeHrToDepartment) {
      const subjectRows = await db.select({ department: schema.users.department }).from(schema.users).where(eq(schema.users.id, ctx.subjectUserId)).limit(1);
      const subjectDept = subjectRows[0]?.department;
      if (subjectDept) {
        const scoped = hrUsers.filter((u: any) => u.department === subjectDept);
        // If no HR user happens to belong to this exact department, falling
        // back to the full HR list is safer than silently notifying nobody.
        if (scoped.length > 0) hrUsers = scoped;
      }
    }
    for (const u of hrUsers) recipients.set(u.id, { id: u.id, name: u.name, email: u.email });
  }
  if (policy.notifyAdmin) {
    const admins = await db.select().from(schema.users).where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.role, 'tenant_admin')));
    for (const u of admins) recipients.set(u.id, { id: u.id, name: u.name, email: u.email });
  }
  if (recipients.size === 0 && policy.fallbackPrivileges) {
    const fallbackUsers = await getUsersWithPrivilege(tenantId, policy.fallbackPrivileges);
    for (const u of fallbackUsers) recipients.set(u.id, { id: u.id, name: u.name, email: u.email });
  }
  return [...recipients.values()];
}

export async function notify(tenantId: number, eventType: string, ctx: NotifyContext): Promise<void> {
  const policy = await loadPolicy(tenantId, eventType);
  const recipients = await resolveRecipients(tenantId, policy, ctx);
  for (const recipient of recipients) {
    for (const channel of policy.channels) {
      await queue.enqueue('deliver_notification', {
        tenantId,
        userId: recipient.id,
        userName: recipient.name,
        userEmail: recipient.email,
        channel,
        eventType,
        subjectName: ctx.subjectName,
        data: ctx.data || {},
      }, { tenantId });
    }
  }
}

// Default subject/body used when a tenant has no custom notification_templates
// row for this eventType/channel — kept generic since this handler serves
// every event type; a module wanting richer, typed email copy (e.g. the
// existing sendAutoAbsentAlertEmail) can still call that function directly
// instead of relying on this generic renderer.
function defaultCopy(eventType: string, subjectName: string, data: Record<string, any>): { subject: string; body: string } {
  const readable = eventType.replace(/_/g, ' ');
  return {
    subject: `Notification: ${readable}`,
    body: `${subjectName}: ${readable}.${data && Object.keys(data).length ? ' ' + JSON.stringify(data) : ''}`,
  };
}

export function registerNotificationDeliveryHandler() {
  queue.registerHandler('deliver_notification', async (payload: any) => {
    const { userId, userName, userEmail, channel, eventType, subjectName, data, tenantId } = payload;
    try {
      const { subject, body } = await renderNotificationTemplate(tenantId, eventType, channel, defaultCopy(eventType, subjectName, data || {}), {
        subjectName,
        ...Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)])),
      });
      if (channel === 'in_app') {
        await notifyUser(userId, subject, body);
      } else if (channel === 'email' && userEmail) {
        await sendEmail({ to: userEmail, subject, text: body, html: `<p>${body}</p>` });
      }
      await db.insert(schema.notificationLog).values({
        tenantId, eventType, recipientUserId: userId, channel, status: 'sent',
      }).catch(() => undefined); // logging failure must never fail the actual delivery
    } catch (err: any) {
      await db.insert(schema.notificationLog).values({
        tenantId, eventType, recipientUserId: userId, channel, status: 'failed', error: err?.message?.slice(0, 500) || 'Unknown error',
      }).catch(() => undefined);
      throw err; // let the queue's own retry logic still handle the actual failure
    }
  });
}
