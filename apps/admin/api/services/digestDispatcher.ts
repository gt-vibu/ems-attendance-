// Rolls up 'digest'-mode notifications (see notificationPolicies' *Mode
// columns in notificationService.ts) into one summary per recipient,
// instead of the per-event immediate delivery notify() uses for
// 'immediate'-mode recipients. Two distinct mechanisms, because they answer
// different questions:
//
//  - Manager/HR digests are a per-recipient ROLLUP of events that already
//    happened and were queued by notify() (notification_digest_queue) — "5
//    absences happened for Engineering's manager today."
//  - Executive digests are a live AGGREGATE computed fresh at dispatch time
//    (extends the org-wide counts the old fixed 7pm job computed) — "521
//    present, 14 absent, org-wide" — not sourced from the queue at all,
//    since an org-wide summary isn't naturally "per-recipient" the way a
//    manager's own team's rollup is.
//
// Both paths send through queue.enqueue('deliver_notification', ...) rather
// than calling sendEmail()/notifyUser() directly, so digest delivery gets
// the exact same retry-on-failure behavior immediate notifications already
// have for free from the existing queue processor (services/queue).
import { eq, and, lte, sql, inArray, ne } from 'drizzle-orm';
import { db, schema } from '../../db';
import { queue } from './queue';
import { tenantStartOfDay, tenantDateKey } from './tenantTime';

type DigestRecipientSpec = { type: 'role'; role: string } | { type: 'user'; userId: number };

// Tenant-timezone-aware — a tenant in a different zone than the server
// process gets their digest at the time they actually configured (their own
// local 09:00), not the server's. Walks forward day by day (capped at 8, a
// safety bound — a correct weekly target is always found within 7) using
// tenantStartOfDay() as the anchor for that tenant-local calendar day, since
// Date's own setHours() only ever operates in the SERVER's zone.
function computeNextDigestRunAt(tenant: { timezone?: string | null } | null, sub: { frequency: string; timeOfDay: string; dayOfWeek: number | null }): Date {
  const [hh, mm] = (sub.timeOfDay || '09:00').split(':').map(Number);
  const offsetMs = ((hh || 9) * 60 + (mm || 0)) * 60000;
  const now = new Date();
  let cursor = now;
  for (let i = 0; i < 8; i++) {
    const dayStart = tenantStartOfDay(tenant, cursor);
    const candidate = new Date(dayStart.getTime() + offsetMs);
    const dayMatches = sub.frequency !== 'weekly' || (() => {
      const dateKey = tenantDateKey(tenant, cursor);
      const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
      return weekday === (sub.dayOfWeek ?? 1);
    })();
    if (dayMatches && candidate > now) return candidate;
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  // Unreachable in practice (a matching weekday is always found within 7
  // days) — safety fallback so this can never return a stale past date.
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

async function resolveDigestRecipients(tenantId: number, specs: DigestRecipientSpec[]) {
  const map = new Map<number, { id: number; name: string; email: string }>();
  for (const spec of specs) {
    if (spec.type === 'role') {
      const rows = await db.select().from(schema.users).where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.role, spec.role)));
      for (const u of rows) map.set(u.id, { id: u.id, name: u.name, email: u.email });
    } else if (spec.type === 'user') {
      const rows = await db.select().from(schema.users).where(eq(schema.users.id, spec.userId)).limit(1);
      if (rows[0]) map.set(rows[0].id, { id: rows[0].id, name: rows[0].name, email: rows[0].email });
    }
  }
  return [...map.values()];
}

interface StructuredDigestExtra {
  tenantName: string;
  periodLabel: 'Daily' | 'Weekly';
  stats: {
    totalEmployees: number;
    present: number;
    absent: number;
    lateArrivals: number;
    pendingLeaveRequests: number;
    pendingAttendanceCorrections: number;
    policyViolations: number;
  };
}

async function enqueueDigestDelivery(
  tenantId: number,
  digestType: string,
  recipient: { id: number; name: string; email: string },
  subject: string,
  body: string,
  structuredExtra?: StructuredDigestExtra,
) {
  for (const channel of ['email', 'in_app']) {
    await queue.enqueue('deliver_notification', {
      tenantId,
      userId: recipient.id,
      userName: recipient.name,
      userEmail: recipient.email,
      channel,
      eventType: `digest_${digestType}`,
      subjectName: recipient.name,
      // __digestStats is only ever set for the executive/org-wide digest
      // (the one with real numeric stats) and only consumed for the email
      // channel — see notificationService.ts's deliver_notification handler,
      // which renders it through mail.ts's sendDailySummaryEmail() instead
      // of the generic `<p>${body}</p>` wrap. in_app keeps using the plain
      // `body` text either way (the notification feed already renders that
      // fine, per the existing "Daily Summary" list items).
      data: structuredExtra ? { __prerendered: true, subject, body, __digestStats: structuredExtra } : { __prerendered: true, subject, body },
    }, { tenantId });
  }
}

// Rolls up pending notification_digest_queue rows for recipients whose role
// is in `roleFilter` — the queue rows already know exactly who was resolved
// as a digest-mode manager/HR recipient at notify()-time, so this just
// groups what's already there rather than re-deriving recipients itself.
async function dispatchPerRecipientDigest(tenantId: number, digestType: string, roleFilter: string[]) {
  const rows = await db.select({
    id: schema.notificationDigestQueue.id,
    recipientUserId: schema.notificationDigestQueue.recipientUserId,
    eventType: schema.notificationDigestQueue.eventType,
    occurrenceCount: schema.notificationDigestQueue.occurrenceCount,
    sampleSubjectNames: schema.notificationDigestQueue.sampleSubjectNames,
    recipientName: schema.users.name,
    recipientEmail: schema.users.email,
  })
    .from(schema.notificationDigestQueue)
    .innerJoin(schema.users, eq(schema.users.id, schema.notificationDigestQueue.recipientUserId))
    .where(and(
      eq(schema.notificationDigestQueue.tenantId, tenantId),
      eq(schema.notificationDigestQueue.consumed, false),
      inArray(schema.users.role, roleFilter),
    ));
  if (!rows.length) return;

  const byRecipient = new Map<number, typeof rows>();
  for (const row of rows) {
    if (!byRecipient.has(row.recipientUserId)) byRecipient.set(row.recipientUserId, []);
    byRecipient.get(row.recipientUserId)!.push(row);
  }

  for (const [recipientId, items] of byRecipient) {
    const first = items[0];
    const totalOccurrences = items.reduce((sum, i) => sum + Number(i.occurrenceCount), 0);
    const lines = items.map((i) => {
      const label = String(i.eventType).replace(/_/g, ' ');
      const names: string[] = Array.isArray(i.sampleSubjectNames) ? (i.sampleSubjectNames as string[]) : [];
      const namesText = names.length ? ` — ${names.join(', ')}${Number(i.occurrenceCount) > names.length ? ' and others' : ''}` : '';
      return `${label}: ${i.occurrenceCount}${namesText}`;
    });
    const subject = `Daily Summary — ${totalOccurrences} update${totalOccurrences === 1 ? '' : 's'}`;
    const body = lines.join('\n');
    await enqueueDigestDelivery(tenantId, digestType, { id: recipientId, name: first.recipientName, email: first.recipientEmail }, subject, body);
    const ids = items.map((i) => i.id);
    await db.update(schema.notificationDigestQueue).set({ consumed: true }).where(inArray(schema.notificationDigestQueue.id, ids));
  }
}

// Live org-wide aggregate — extends the counts the old fixed 7pm job
// computed (present/absent/late/violations) with leave + pending
// corrections, sent to the subscription's configured recipients instead of
// the old hardcoded admins[0].
async function dispatchExecutiveDigest(tenantId: number, digestType: string, recipients: { id: number; name: string; email: string }[]) {
  if (!recipients.length) return;
  const tenantRows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  const tenant = tenantRows[0];
  if (!tenant) return;
  const dayStart = tenantStartOfDay(tenant);

  // BUG FIX: this previously filtered role = 'employee' literally, which
  // silently excluded every manager/HR/GM/custom-role person from the
  // headcount — a tenant whose staff mostly hold non-'employee' roles saw
  // "Total Employees: 0" (and, since absent = max(0, total - checkedIn),
  // "Absent: 0" too) despite having real, active people. Matches the same
  // "every clock-in-capable role except tenant_admin/super_admin" convention
  // computeAttendancePercent() and the payroll overview endpoint already use
  // elsewhere in this app, and excludes terminated employees the same way
  // payrollBatchCalculation.ts's employee loop does.
  const totalEmployees = await db.select().from(schema.users).where(and(
    eq(schema.users.tenantId, tenantId),
    sql`role NOT IN ('tenant_admin', 'super_admin')`,
    ne(schema.users.employeeStatus, 'terminated'),
  ));

  const checkedInResult = await db.execute(sql`
    SELECT COUNT(DISTINCT user_id) as count FROM attendance_logs
    WHERE tenant_id = ${tenantId} AND created_at >= ${dayStart} AND status = 'approved' AND type = 'check_in'
  `);
  // BUG FIX: was string-matching the human-readable `reason` column
  // ('%Late Arrival%'), which attendance.routes.ts's check-in flow doesn't
  // even always populate that way (WFH late arrivals use different reason
  // text entirely — see attendance.routes.ts's `reason` assignment). The
  // canonical signal is the isLate boolean column attendancePolicy.ts
  // writes on every check-in, specifically introduced to replace this exact
  // fragile-string-matching anti-pattern (see schema.ts's isLate comment).
  const lateResult = await db.execute(sql`
    SELECT COUNT(DISTINCT user_id) as count FROM attendance_logs
    WHERE tenant_id = ${tenantId} AND created_at >= ${dayStart} AND status = 'approved' AND type = 'check_in' AND is_late = true
  `);
  const pendingLeaveResult = await db.execute(sql`
    SELECT COUNT(*) as count FROM leave_requests WHERE tenant_id = ${tenantId} AND status = 'pending'
  `);
  const pendingCorrectionsResult = await db.execute(sql`
    SELECT COUNT(*) as count FROM attendance_corrections WHERE tenant_id = ${tenantId} AND status = 'pending'
  `).catch(() => ({ rows: [{ count: 0 }] }) as any);
  const violations = await db.select().from(schema.auditLedger).where(
    and(eq(schema.auditLedger.tenantId, tenantId), sql`timestamp >= ${dayStart}`, sql`action IN ('FRAUD_CLOCK_MANIPULATION', 'BREAK_VIOLATION', 'FRAUD_GEOFENCE_BYPASS', 'FRAUD_NETWORK_BYPASS')`),
  );

  const num = (r: any) => Number((r?.rows ? r.rows[0]?.count : r?.[0]?.count) || 0);
  const checkedIn = num(checkedInResult);
  const late = num(lateResult);
  const pendingLeave = num(pendingLeaveResult);
  const pendingCorrections = num(pendingCorrectionsResult);
  const absent = Math.max(0, totalEmployees.length - checkedIn);

  const periodLabel: 'Daily' | 'Weekly' = digestType === 'executive_weekly' ? 'Weekly' : 'Daily';
  const subject = `${periodLabel} Summary: ${tenant.name}`;
  const body = [
    `Total Employees: ${totalEmployees.length}`,
    `Present: ${checkedIn}`,
    `Absent: ${absent}`,
    `Late Arrivals: ${late}`,
    `Pending Leave Requests: ${pendingLeave}`,
    `Pending Attendance Corrections: ${pendingCorrections}`,
    `Policy Violations: ${violations.length}`,
  ].join('\n');
  const structuredExtra = {
    tenantName: tenant.name,
    periodLabel,
    stats: {
      totalEmployees: totalEmployees.length,
      present: checkedIn,
      absent,
      lateArrivals: late,
      pendingLeaveRequests: pendingLeave,
      pendingAttendanceCorrections: pendingCorrections,
      policyViolations: violations.length,
    },
  };

  for (const recipient of recipients) {
    await enqueueDigestDelivery(tenantId, digestType, recipient, subject, body, structuredExtra);
  }
}

// Called from the main scheduler tick (bootstrap/scheduler.ts), same slot
// as enqueueDueReportSchedules() — nextRunAt-driven due check, not fixed
// hour/min branches, so an admin-configured send time just works without
// new scheduler code for every possible time-of-day.
export async function dispatchDueDigests() {
  const due = await db.select().from(schema.notificationDigestSubscriptions).where(and(
    eq(schema.notificationDigestSubscriptions.active, true),
    lte(schema.notificationDigestSubscriptions.nextRunAt, new Date()),
  ));

  for (const sub of due) {
    const tenantRows = await db.select({ timezone: schema.tenants.timezone }).from(schema.tenants).where(eq(schema.tenants.id, sub.tenantId)).limit(1);
    await db.update(schema.notificationDigestSubscriptions).set({
      lastRunAt: new Date(),
      nextRunAt: computeNextDigestRunAt(tenantRows[0] || null, sub as any),
    }).where(eq(schema.notificationDigestSubscriptions.id, sub.id));

    try {
      if (sub.digestType.startsWith('manager_')) {
        await dispatchPerRecipientDigest(sub.tenantId, sub.digestType, ['manager', 'GM']);
      } else if (sub.digestType.startsWith('hr_')) {
        await dispatchPerRecipientDigest(sub.tenantId, sub.digestType, ['HR']);
      } else if (sub.digestType.startsWith('executive_')) {
        const specs = (Array.isArray(sub.recipients) ? sub.recipients : []) as DigestRecipientSpec[];
        const recipients = await resolveDigestRecipients(sub.tenantId, specs);
        await dispatchExecutiveDigest(sub.tenantId, sub.digestType, recipients);
      }
    } catch (err: any) {
      // One tenant's/subscription's failure (e.g. a malformed recipients
      // array) must never block every other tenant's digest from running
      // in the same tick.
      console.error(`[digestDispatcher] subscription ${sub.id} (tenant ${sub.tenantId}, type ${sub.digestType}) failed:`, err?.message || err);
    }
  }
}
