import { eq, and, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { getUsersWithPrivilege, isPlatformFeatureAllowed } from '../auth/rbac';
import { resolveEscalationAssignee } from './escalation';
import { renderNotificationTemplate } from './notificationTemplates';
import { notifyUser } from './notifications';
import { sendEmail, sendDailySummaryEmail } from '../../mail';
import { queue } from './queue';
import { tenantParts, tenantDateKey } from './tenantTime';

// Which of the four fixed recipient categories a given resolved recipient
// came from — determines whose *Mode (employeeMode/managerMode/...) applies
// to them. A user resolved via more than one category (e.g. a manager who
// is also tenant_admin) keeps only the first category found, in the same
// employee->manager->HR->admin priority order resolveRecipients already
// checks in — that's the more permissive (most likely 'immediate') category
// in every DEFAULT_POLICIES entry today, so this doesn't newly suppress
// anyone relative to pre-existing behavior.
type RecipientCategory = 'employee' | 'manager' | 'hr' | 'admin' | 'fallback';

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

type DeliveryMode = 'immediate' | 'digest' | 'none';
type Priority = 'critical' | 'high' | 'medium' | 'low' | 'silent';

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
  // Per-recipient delivery mode + priority tier — see schema.ts
  // notificationPolicies comment. Every DEFAULT_POLICIES entry that omits
  // these gets 'immediate'/'medium', i.e. today's exact behavior.
  employeeMode?: DeliveryMode;
  managerMode?: DeliveryMode;
  hrMode?: DeliveryMode;
  adminMode?: DeliveryMode;
  priority?: Priority;
}

// One row per known eventType — matches the recipient set that event's
// pre-existing inline sendEmail/notifyUser call already used, so enabling
// `unified_notifications` for a tenant with no custom policy rows changes
// nothing until they actually edit a policy.
const DEFAULT_POLICIES: Record<string, DefaultPolicy> = {
  // --- Type B: informational/high-volume — batched into the manager's
  // daily digest by default instead of firing one email per occurrence.
  // The employee themself still gets it immediately (they need to know
  // right away to file a correction), only the manager copy is deferred.
  attendance_auto_absent: { notifyEmployee: true, notifyManager: true, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: ['attendance.approve'], managerMode: 'digest', priority: 'low' },
  attendance_missed_checkout: { notifyEmployee: true, notifyManager: true, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: ['attendance.approve'], managerMode: 'digest', priority: 'low' },
  // --- Type A: action required — always immediate, high priority.
  attendance_correction_requested: { notifyEmployee: false, notifyManager: true, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: ['attendance.approve'], priority: 'high' },
  attendance_correction_decided: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  leave_requested: { notifyEmployee: false, notifyManager: true, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: ['leave.approve'], priority: 'high' },
  leave_decided: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  payroll_generated: { notifyEmployee: false, notifyManager: false, notifyHR: true, notifyAdmin: true, channels: ['in_app', 'email'], fallbackPrivileges: ['payroll.manage'] },
  payroll_salary_changed: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  report_generation_completed: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  wfh_requested: { notifyEmployee: false, notifyManager: true, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: ['wfh.approve'], priority: 'high' },
  wfh_decided: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  shift_assigned: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  shift_changed: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  shift_swap_requested: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  shift_swap_decided: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  // Team membership is a "my team" workspace belonging to whoever adds the
  // member (see teams.routes.ts), so the added employee is the only
  // recipient that needs resolving here — the team lead is the caller and
  // already knows.
  team_member_added: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  // notifyManager here resolves via the subject's OWN managerId — teams.routes.ts
  // sets that to the new manager BEFORE calling notify(), so this one entry
  // reaches both the employee and their newly assigned manager.
  manager_assigned: { notifyEmployee: true, notifyManager: true, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  leave_encashment_requested: { notifyEmployee: false, notifyManager: true, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: ['leave.approve'], priority: 'high' },
  leave_encashment_decided: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  late_arrival_requested: { notifyEmployee: false, notifyManager: true, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: ['attendance.approve'], priority: 'high' },
  late_arrival_decided: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  payroll_batch_calculated: { notifyEmployee: false, notifyManager: false, notifyHR: true, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: ['payroll.review.hr'], priority: 'high' },
  payroll_batch_approved: { notifyEmployee: false, notifyManager: false, notifyHR: false, notifyAdmin: true, channels: ['in_app', 'email'], fallbackPrivileges: ['payroll.release'], priority: 'high' },
  payroll_batch_released: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  salary_revised: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  bonus_added: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  loan_approved: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  reimbursement_approved: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  payroll_adjustment_created: { notifyEmployee: true, notifyManager: false, notifyHR: false, notifyAdmin: false, channels: ['in_app', 'email'], fallbackPrivileges: [] },
  // Fired by registerNotificationDeliveryHandler itself when a delivery
  // exhausts all queue retries — always immediate + critical so a dead
  // email provider surfaces as its own alert instead of vanishing into
  // notification_log. See §6 of the digest-layer plan.
  notification_delivery_failed: { notifyEmployee: false, notifyManager: false, notifyHR: false, notifyAdmin: true, channels: ['in_app', 'email'], fallbackPrivileges: [], priority: 'critical' },
  // Fired by registerPayrollBatchCalculationHandler (payrollBatchCalculation.ts)
  // when a batch calculation job exhausts all queue retries — a payroll run
  // silently failing is exactly the "nobody finds out until payday" gap a
  // critical, always-immediate alert exists to close.
  payroll_batch_calculation_failed: { notifyEmployee: false, notifyManager: false, notifyHR: false, notifyAdmin: true, channels: ['in_app', 'email'], fallbackPrivileges: [], priority: 'critical' },
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
    employeeMode: ((row as any).employeeMode as DeliveryMode) || 'immediate',
    managerMode: ((row as any).managerMode as DeliveryMode) || 'immediate',
    hrMode: ((row as any).hrMode as DeliveryMode) || 'immediate',
    adminMode: ((row as any).adminMode as DeliveryMode) || 'immediate',
    priority: ((row as any).priority as Priority) || 'medium',
  };
}

interface ResolvedRecipient extends Recipient {
  category: RecipientCategory;
}

async function resolveRecipients(tenantId: number, policy: DefaultPolicy, ctx: NotifyContext): Promise<ResolvedRecipient[]> {
  const recipients = new Map<number, ResolvedRecipient>();
  const add = (u: { id: number; name: string; email: string }, category: RecipientCategory) => {
    if (!recipients.has(u.id)) recipients.set(u.id, { id: u.id, name: u.name, email: u.email, category });
  };

  if (policy.notifyEmployee) {
    const rows = await db.select().from(schema.users).where(eq(schema.users.id, ctx.subjectUserId)).limit(1);
    const u = rows[0];
    if (u) add(u, 'employee');
  }
  if (policy.notifyManager) {
    try {
      const manager = await resolveEscalationAssignee(tenantId, ctx.subjectUserId, 0);
      add({ id: manager.userId, name: manager.name, email: manager.email }, 'manager');
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
    for (const u of hrUsers) add(u, 'hr');
  }
  if (policy.notifyAdmin) {
    const admins = await db.select().from(schema.users).where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.role, 'tenant_admin')));
    for (const u of admins) add(u, 'admin');
  }
  if (recipients.size === 0 && policy.fallbackPrivileges) {
    const fallbackUsers = await getUsersWithPrivilege(tenantId, policy.fallbackPrivileges);
    for (const u of fallbackUsers) add(u, 'fallback');
  }
  return [...recipients.values()];
}

function modeForCategory(policy: DefaultPolicy, category: RecipientCategory): DeliveryMode {
  switch (category) {
    case 'employee': return policy.employeeMode || 'immediate';
    case 'manager': return policy.managerMode || 'immediate';
    case 'hr': return policy.hrMode || 'immediate';
    case 'admin': return policy.adminMode || 'immediate';
    default: return 'immediate'; // fallback-privilege recipients always immediate — they exist specifically so nobody silently gets nothing
  }
}

async function isWithinTenantQuietHours(tenantId: number): Promise<boolean> {
  const rows = await db.select({ timezone: schema.tenants.timezone, quietHoursStart: (schema.tenants as any).quietHoursStart, quietHoursEnd: (schema.tenants as any).quietHoursEnd })
    .from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  const tenant = rows[0] as any;
  if (!tenant?.quietHoursStart || !tenant?.quietHoursEnd) return false;
  const { hour, minute } = tenantParts(tenant);
  const nowMins = hour * 60 + minute;
  const [startH, startM] = String(tenant.quietHoursStart).split(':').map(Number);
  const [endH, endM] = String(tenant.quietHoursEnd).split(':').map(Number);
  const startMins = startH * 60 + startM;
  const endMins = endH * 60 + endM;
  // Overnight window (e.g. 21:00 -> 08:00) wraps past midnight; a same-day
  // window (e.g. 13:00 -> 14:00) does not — handle both.
  if (startMins <= endMins) return nowMins >= startMins && nowMins < endMins;
  return nowMins >= startMins || nowMins < endMins;
}

async function enqueueDigest(tenantId: number, recipientUserId: number, eventType: string, subjectName: string, data: Record<string, any>) {
  const rows = await db.select({ timezone: schema.tenants.timezone }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  const bucketDate = tenantDateKey(rows[0] || null);
  await db.execute(sql`
    INSERT INTO notification_digest_queue (tenant_id, recipient_user_id, event_type, digest_bucket_date, occurrence_count, sample_subject_names, data)
    VALUES (${tenantId}, ${recipientUserId}, ${eventType}, ${bucketDate}, 1, ${JSON.stringify([subjectName])}::jsonb, ${JSON.stringify(data || {})}::jsonb)
    ON CONFLICT (tenant_id, recipient_user_id, event_type, digest_bucket_date)
    DO UPDATE SET
      occurrence_count = notification_digest_queue.occurrence_count + 1,
      sample_subject_names = CASE
        WHEN jsonb_array_length(notification_digest_queue.sample_subject_names) < 8
          THEN notification_digest_queue.sample_subject_names || ${JSON.stringify([subjectName])}::jsonb
        ELSE notification_digest_queue.sample_subject_names
      END
  `);
}

export async function notify(tenantId: number, eventType: string, ctx: NotifyContext): Promise<void> {
  const policy = await loadPolicy(tenantId, eventType);
  const recipients = await resolveRecipients(tenantId, policy, ctx);
  const priority = policy.priority || 'medium';
  // Critical events never wait on quiet hours — computed once per notify()
  // call rather than per recipient, since it's the same tenant clock for
  // everyone in this batch.
  const inQuietHours = priority !== 'critical' ? await isWithinTenantQuietHours(tenantId) : false;

  for (const recipient of recipients) {
    // 'critical' priority forces immediate delivery regardless of the
    // recipient category's configured mode — a payroll-failure-style alert
    // must never sit in a digest queue waiting for 9am.
    const mode: DeliveryMode = priority === 'critical' ? 'immediate' : modeForCategory(policy, recipient.category);
    if (mode === 'none') continue;

    if (mode === 'digest' || (mode === 'immediate' && inQuietHours)) {
      await enqueueDigest(tenantId, recipient.id, eventType, ctx.subjectName, ctx.data || {});
      continue;
    }

    // Per-employee channel opt-out intersected with the policy's configured
    // channels — 'silent' priority forces in_app-only regardless of either.
    const recipientRows = await db.select({ notificationChannelPrefs: (schema.users as any).notificationChannelPrefs })
      .from(schema.users).where(eq(schema.users.id, recipient.id)).limit(1);
    const prefs = (recipientRows[0] as any)?.notificationChannelPrefs || { email: true, in_app: true };
    const allowedChannels = priority === 'silent'
      ? ['in_app']
      : policy.channels.filter((c) => c !== 'email' || prefs.email !== false).filter((c) => c !== 'in_app' || prefs.in_app !== false);

    for (const channel of allowedChannels) {
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

// Shared by every route that needs to notify one specific person about one
// event and doesn't already know whether the tenant has the unified
// notification policy engine ('unified_notifications' platform feature)
// turned on. Previously hand-rolled near-identically (fetch tenant row,
// branch on isPlatformFeatureAllowed) in at least 8 route files — this is
// the one place that logic should live. Falls back to the plain
// notifyUser() single-notification path when the tenant hasn't opted into
// unified_notifications.
export async function notifyOrFallback(
  tenantId: number,
  eventType: string,
  subjectUserId: number,
  subjectName: string,
  data: Record<string, any>,
  fallbackTitle: string,
  fallbackMessage: string,
): Promise<void> {
  await notifyOrFallbackCustom(tenantId, eventType, subjectUserId, subjectName, data, () => notifyUser(subjectUserId, fallbackTitle, fallbackMessage));
}

// Same unified_notifications branch as notifyOrFallback() above, but for
// call sites whose "off" fallback needs to be something richer than a
// generic in-app notification — e.g. a specifically-templated email
// (sendLeaveDecisionEmail, sendLeaveApprovalRequestEmail) with real
// leaveType/date/etc. content, which notifyUser()'s plain title/message
// can't express. Without this, those call sites had no way to reuse the
// shared "fetch tenant row, check the feature flag" logic without either
// duplicating it by hand (the original problem) or silently downgrading
// their fallback to a bare in-app notification (a real feature regression
// for tenants that haven't opted into unified_notifications).
export async function notifyOrFallbackCustom(
  tenantId: number,
  eventType: string,
  subjectUserId: number,
  subjectName: string,
  data: Record<string, any>,
  fallbackFn: () => Promise<any>,
): Promise<void> {
  const tenantRow = (await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1))[0];
  if (isPlatformFeatureAllowed(tenantRow as any, 'unified_notifications')) {
    await notify(tenantId, eventType, { subjectUserId, subjectName, data }).catch(() => undefined);
  } else {
    await fallbackFn().catch(() => undefined);
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

// deliver_notification's own maxAttempts isn't visible to the handler (the
// queue's JobMeta only exposes the attempt count, not the cap it enqueued
// with) — this mirrors backgroundJobs.maxAttempts' schema default of 3, so
// "this was the last attempt" below is accurate as long as nothing calls
// queue.enqueue('deliver_notification', ..., { maxAttempts: <other value> }),
// which nothing in this codebase does today.
const DELIVER_NOTIFICATION_MAX_ATTEMPTS = 3;

export function registerNotificationDeliveryHandler() {
  queue.registerHandler('deliver_notification', async (payload: any, meta: any) => {
    const { userId, userName, userEmail, channel, eventType, subjectName, data, tenantId } = payload;
    try {
      // Digest dispatch (services/digestDispatcher.ts) pre-renders its own
      // multi-item summary text — running it back through the single-event
      // template renderer would produce nonsense ("subjectName: digest
      // manager daily. {...}"), so a pre-rendered payload skips that step
      // entirely and is used as-is.
      const { subject, body } = data?.__prerendered
        ? { subject: data.subject, body: data.body }
        : await renderNotificationTemplate(tenantId, eventType, channel, defaultCopy(eventType, subjectName, data || {}), {
            subjectName,
            ...Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)])),
          });
      if (channel === 'in_app') {
        await notifyUser(userId, subject, body);
      } else if (channel === 'email' && userEmail) {
        // Structured daily/weekly summary digests (digestDispatcher.ts's
        // dispatchExecutiveDigest) render through a real HTML stat-grid
        // template instead of the generic `<p>${body}</p>` wrap every other
        // notification uses — see mail.ts's sendDailySummaryEmail.
        if (data?.__digestStats) {
          const { tenantName, periodLabel, stats } = data.__digestStats;
          await sendDailySummaryEmail(userEmail, userName || subjectName, tenantName, periodLabel, stats);
        } else {
          await sendEmail({ to: userEmail, subject, text: body, html: `<p>${body}</p>` });
        }
      }
      await db.insert(schema.notificationLog).values({
        tenantId, eventType, recipientUserId: userId, channel, status: 'sent', attempts: meta?.attempts || 1, subjectName, data: data || {},
      } as any).catch(() => undefined); // logging failure must never fail the actual delivery
    } catch (err: any) {
      await db.insert(schema.notificationLog).values({
        tenantId, eventType, recipientUserId: userId, channel, status: 'failed', error: err?.message?.slice(0, 500) || 'Unknown error', attempts: meta?.attempts || 1, subjectName, data: data || {},
      } as any).catch(() => undefined);
      // Once this event type's own delivery keeps failing (e.g. a dead
      // SendGrid key), surface it as its own critical alert to tenant_admin
      // instead of letting it vanish silently into notification_log after
      // the queue gives up retrying — but never for the alert event itself,
      // or a permanently-broken provider would recurse into an infinite
      // chain of failed delivery-failure notifications.
      if ((meta?.attempts || 1) >= DELIVER_NOTIFICATION_MAX_ATTEMPTS && eventType !== 'notification_delivery_failed') {
        await notify(tenantId, 'notification_delivery_failed', {
          subjectUserId: userId,
          subjectName: userName,
          data: { originalEventType: eventType, channel, error: err?.message?.slice(0, 300) },
        }).catch(() => undefined);
      }
      throw err; // let the queue's own retry logic still handle the actual failure
    }
  });
}

// For call sites that have ALREADY resolved exactly who should be notified
// (e.g. the ticket/alert/leave 24h auto-escalation walk in
// bootstrap/scheduler.ts, which computes the next escalation assignee
// itself via resolveEscalationAssignee) — sends straight to that recipient
// on both channels through the same queue + notification_log pipeline
// everything else uses, instead of a side-channel notifyUser()-only call
// that never shows up in the Notification Center's History tab. Skips
// resolveRecipients()/policy lookup entirely since there's nothing to
// resolve — the caller already knows who.
export async function notifyDirectRecipient(tenantId: number, eventType: string, recipient: { id: number; name: string; email: string }, subject: string, body: string): Promise<void> {
  for (const channel of ['in_app', 'email']) {
    await queue.enqueue('deliver_notification', {
      tenantId,
      userId: recipient.id,
      userName: recipient.name,
      userEmail: recipient.email,
      channel,
      eventType,
      subjectName: recipient.name,
      data: { __prerendered: true, subject, body },
    }, { tenantId });
  }
}

// Re-enqueues a specific notification_log row's original delivery exactly
// as it was first attempted — used by the History tab's "Retry now" button.
// Only failed rows should be passed in (the caller/route enforces this);
// re-sending an already-'sent' row would double-notify the recipient.
export async function retryNotificationLogEntry(logId: number, tenantId: number): Promise<void> {
  const rows = await db.select().from(schema.notificationLog).where(
    and(eq(schema.notificationLog.id, logId), eq(schema.notificationLog.tenantId, tenantId)),
  ).limit(1);
  const row = rows[0] as any;
  if (!row) throw new Error('Notification log entry not found');
  const recipientRows = row.recipientUserId
    ? await db.select().from(schema.users).where(eq(schema.users.id, row.recipientUserId)).limit(1)
    : [];
  const recipient = recipientRows[0];
  await queue.enqueue('deliver_notification', {
    tenantId,
    userId: row.recipientUserId,
    userName: recipient?.name || row.subjectName || 'User',
    userEmail: recipient?.email,
    channel: row.channel,
    eventType: row.eventType,
    subjectName: row.subjectName || recipient?.name || '',
    data: row.data || {},
  }, { tenantId });
}
