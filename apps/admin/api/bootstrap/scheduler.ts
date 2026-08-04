import crypto from 'crypto';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db, schema, tryAcquireSchedulerLeadership } from '../../db';
import { logger } from '../../logger';
import { reverseGeocode } from '../../geocoding.js';
import { sendPasswordResetEmail, sendAttendanceCorrectionEmail, sendBreakViolationAlert, sendManagerEscalationEmail, sendLateArrivalApprovalRequestEmail, sendLateArrivalDecisionEmail, sendLowAttendanceAlertEmail, sendBreakLocationViolationEmail, sendWfhApprovalRequestEmail, sendWfhDecisionEmail, sendWfhLocationChangeRequestEmail, sendWfhLocationChangeDecisionEmail, sendAutoAbsentAlertEmail } from '../../mail.js';
import { haversineMeters, resolveActiveIp } from '../services/geo';
import { computeAttendancePercent, getHierarchyAlertRecipients } from '../services/attendanceStats';
import { logToAuditLedger } from '../services/audit';
import { dispatchWebhookEvent } from '../services/webhooks';
import { raiseAttendanceAlert } from '../services/alerts';
import { resolveNextEscalation, resolveEscalationAssignee } from '../services/escalation';
import { notifyUser, notifyUsers } from '../services/notifications';
import { queue } from '../services/queue';
import { isPlatformFeatureAllowed } from '../auth/rbac';
import { getEffectiveShift } from '../services/shiftOverrides';
import { resolveEffectivePolicy } from '../services/attendancePolicy';
import { resolveApprovers } from '../services/approvalRouting';
import { tenantDateKey, tenantParts, tenantStartOfDay, tenantDateTime, tenantDateLabel } from '../services/tenantTime';
import { registerReportSchedulerHandler, enqueueDueReportSchedules } from '../services/reportScheduler';
import { notify, notifyDirectRecipient, registerNotificationDeliveryHandler } from '../services/notificationService';
import { dispatchDueDigests } from '../services/digestDispatcher';
import { registerPayrollBatchCalculationHandler } from '../services/payrollBatchCalculation';
import { processPresenceAutoCheckout } from '../services/presenceEngine';

export function runBackgroundScheduler() {
  console.log('Background Scheduler initialized.');
  
  // Track runs to prevent duplicate triggers within the same minute
  // Per-tenant (not a single global string) — "11:00 AM" means 11:00 in
  // EACH tenant's own configured timezone (tenants.timezone), which can
  // differ from the server's clock and from each other.
  const lastAbsenteesRun = new Map<number, string>();
  const lastCheckoutRun = new Map<number, string>();
  const lastAttendanceCheckRun = new Map<number, string>();
  const lastArchivalRun = new Map<number, string>();
  // Missed-checkout verification (Phase 5) runs every minute per-user
  // (each has a different shiftEnd+grace trigger time), not once at a
  // fixed hour — this dedupes so a user isn't processed twice in one day.
  // Cleared at midnight below.
  let missedCheckoutProcessed = new Set<string>();
  let lastReportScheduleCheck = '';
  let lastDigestDispatchCheck = '';

  // Register the queue job handler that actually executes a scheduled
  // report (see services/reportScheduler.ts) — must happen before the poll
  // loop below starts picking up jobs.
  registerReportSchedulerHandler();
  registerNotificationDeliveryHandler();
  registerPayrollBatchCalculationHandler();

  // 0. Background job queue poll (services/queue) — runs only on this
  // (leader) instance, same guarantee every other job in this function
  // already relies on, so queued jobs are never double-processed across a
  // multi-replica deployment. Short cadence relative to the once-a-minute
  // jobs below since queued work (email sends, recalculations) is meant to
  // feel "background," not "batch."
  setInterval(async () => {
    try {
      await queue.pollOnce();
    } catch (err) {
      logger.error('scheduler: queue poll failed', { error: (err as any)?.message });
    }
  }, 5000);

  // 1. Break overstay scanner (runs every minute)
  setInterval(async () => {
    try {
      const activeBreaks = await db.select({
        id: schema.breakSessions.id,
        startTime: schema.breakSessions.startTime,
        userId: schema.breakSessions.userId,
        userName: schema.users.name,
        userEmail: schema.users.email,
        tenantId: schema.users.tenantId
      })
      .from(schema.breakSessions)
      .innerJoin(schema.users, eq(schema.breakSessions.userId, schema.users.id))
      .where(eq(schema.breakSessions.status, 'active'));

      for (const brk of activeBreaks) {
        const start = new Date(brk.startTime).getTime();
        const elapsedMins = (Date.now() - start) / 60000;
        
        // Fetch tenant policy configuration
        const tenantList = await db.select().from(schema.tenants).where(eq(schema.tenants.id, brk.tenantId || 1));
        const budget = tenantList.length > 0 ? (tenantList[0].dailyBreakBudgetMins || 60) : 60;
        
        if (elapsedMins > budget) {
          // Break budget exceeded! Auto-end it with completed status
          await db.update(schema.breakSessions)
            .set({
              endTime: new Date(),
              status: 'completed'
            })
            .where(eq(schema.breakSessions.id, brk.id));
            
          // Log to cryptographic audit ledger
          await logToAuditLedger({
            tenantId: brk.tenantId,
            actorId: brk.userId,
            actorName: brk.userName,
            action: 'BREAK_VIOLATION',
            details: { elapsedMins: Math.round(elapsedMins), allowedLimit: budget, autoCompleted: true }
          });

          if (brk.tenantId) {
            dispatchWebhookEvent(brk.tenantId, 'attendance.break_violation', { userId: brk.userId, userName: brk.userName, elapsedMins: Math.round(elapsedMins), allowedLimit: budget });
          }

          // Send alerts
          await sendBreakViolationAlert(brk.userEmail, brk.userName, tenantDateLabel(tenantList[0]), Math.round(elapsedMins), budget);
          
          // Get Tenant Admin to escalate
          const admins = await db.select().from(schema.users).where(
            and(
              eq(schema.users.tenantId, brk.tenantId || 1),
              eq(schema.users.role, 'tenant_admin')
            )
          );
          if (admins.length > 0) {
            await sendManagerEscalationEmail(
              admins[0].email,
              admins[0].name,
              brk.userName,
              'Break Overstay Violation',
              `${brk.userName} went on break but did not return in time. The break was auto-ended at ${Math.round(elapsedMins)} minutes (Limit: ${budget} mins).`
            );
          }
        }
      }
    } catch (err) {
      console.error('Error in break monitor job:', err);
    }
  }, 60000);

  // 2. Daily Cron Tasks (Checked every minute)
  setInterval(async () => {
    try {
      const now = new Date();
      const currentHour = now.getHours();
      const currentMin = now.getMinutes();
      const todayKey = now.toDateString();

      if (currentHour === 0 && currentMin === 0) {
        missedCheckoutProcessed = new Set<string>();
      }

      // --- Scheduled report deliveries (services/reportScheduler.ts) —
      // checked once a minute, same cadence as everything else here; the
      // schedule's own nextRunAt is what actually gates whether anything
      // is due, this is just how often we look. ---
      const thisMinuteKey = `${todayKey}:${currentHour}:${currentMin}`;
      if (lastReportScheduleCheck !== thisMinuteKey) {
        lastReportScheduleCheck = thisMinuteKey;
        try {
          await enqueueDueReportSchedules();
        } catch (err) {
          logger.error('scheduler: report schedule check failed', { error: (err as any)?.message });
        }
      }

      // --- Notification digest dispatch (services/digestDispatcher.ts) —
      // same once-a-minute cadence + nextRunAt-driven due check as the
      // report schedules above, so admin-configured digest send times just
      // work without a dedicated fixed-hour branch per possible time. ---
      if (lastDigestDispatchCheck !== thisMinuteKey) {
        lastDigestDispatchCheck = thisMinuteKey;
        try {
          await dispatchDueDigests();
        } catch (err) {
          logger.error('scheduler: digest dispatch failed', { error: (err as any)?.message });
        }
      }

      // --- Auto-mark absentees (at 11:00 AM in EACH tenant's own timezone) ---
      // Previously gated by the SERVER's clock (`currentHour === 11`) for
      // every tenant at once, and never told anyone it happened — an
      // employee (or their manager) had no way to find out short of
      // noticing a gap in the attendance report days later. Both fixed
      // here: the trigger now checks 11:00 in the tenant's own configured
      // timezone (tenants.timezone), and marking someone absent now raises
      // an in-app alert (routed via the same manager -> GM -> tenant_admin
      // escalation missed-checkout already uses) plus an email to both the
      // employee and that assignee.
      {
        const tenantsList = await db.select().from(schema.tenants);
        for (const tenant of tenantsList) {
          const tParts = tenantParts(tenant, now);
          const tTodayKey = tenantDateKey(tenant, now);
          if (!(tParts.hour === 11 && tParts.minute === 0 && lastAbsenteesRun.get(tenant.id) !== tTodayKey)) continue;
          lastAbsenteesRun.set(tenant.id, tTodayKey);
          console.log(`Running Auto-Mark Absentees Job for tenant ${tenant.id}...`);

          const employees = await db.select().from(schema.users).where(
            and(
              eq(schema.users.tenantId, tenant.id),
              eq(schema.users.role, 'employee')
            )
          );

          // Tenant-local "today," matching the tTodayKey this job's own
          // trigger just computed above — server-local midnight here
          // previously disagreed with that by the tenant's UTC offset,
          // meaning a late-evening check-in near midnight could count (or
          // fail to count) toward the wrong calendar day's absence check.
          const todayStart = tenantStartOfDay(tenant, now);

          for (const emp of employees) {
            if (emp.employeeStatus && emp.employeeStatus !== 'active') continue;

            // Check if employee has an approved check-in log today
            const logs = await db.select().from(schema.attendanceLogs).where(
              and(
                eq(schema.attendanceLogs.userId, emp.id),
                eq(schema.attendanceLogs.status, 'approved'),
                sql`created_at >= ${todayStart}`
              )
            );

            if (logs.length === 0) {
              // Create auto-absent log
              await db.insert(schema.attendanceLogs).values({
                userId: emp.id,
                tenantId: tenant.id,
                status: 'rejected',
                type: 'absent',
                reason: 'Auto-marked absent: No clock-in detected by 11:00 AM'
              });

              await logToAuditLedger({
                tenantId: tenant.id,
                actorId: emp.id,
                actorName: emp.name,
                action: 'AUTO_MARK_ABSENT',
                details: { info: 'No clock-in detected by 11:00 AM' }
              });

              const alert = await raiseAttendanceAlert({
                tenantId: tenant.id,
                userId: emp.id,
                type: 'auto_marked_absent',
                message: `${emp.name} was auto-marked Absent — no check-in detected by 11:00 AM.`,
              });

              if (isPlatformFeatureAllowed(tenant, 'unified_notifications')) {
                await notify(tenant.id, 'attendance_auto_absent', { subjectUserId: emp.id, subjectName: emp.name, data: { date: tTodayKey } }).catch(() => undefined);
              } else {
                if (emp.email) {
                  await sendAutoAbsentAlertEmail(emp.email, emp.name, emp.name, tTodayKey, true).catch(() => undefined);
                }
                if (alert?.currentAssigneeUserId) {
                  const assigneeRows = await db.select().from(schema.users).where(eq(schema.users.id, alert.currentAssigneeUserId)).limit(1);
                  const assignee = assigneeRows[0];
                  if (assignee?.email) {
                    await sendAutoAbsentAlertEmail(assignee.email, assignee.name, emp.name, tTodayKey, false).catch(() => undefined);
                  }
                }
              }
            }
          }
        }
      }

      // --- Presence Engine & Auto-Checkout Policy loop (runs every minute) ---
      try {
        const allTenants = await db.select().from(schema.tenants);
        for (const t of allTenants) {
          if (t.status === 'active') {
            await processPresenceAutoCheckout(t.id).catch((err) => logger.error(`presence process error for tenant ${t.id}:`, err));
          }
        }
      } catch (err) {
        logger.error('Presence Engine scheduler loop error:', err);
      }

      // --- Missed-checkout verification (Phase 5) — per-user shiftEnd +
      // checkoutGraceMins, only for tenants with 'missed_checkout_
      // verification' enabled. Runs every minute (each user's trigger time
      // differs), unlike the legacy fixed-23:59 job below, which still
      // handles every other tenant completely unchanged. ---
      {
        const verifyTenants = (await db.select().from(schema.tenants)).filter((t: any) => isPlatformFeatureAllowed(t, 'missed_checkout_verification'));
        for (const tenant of verifyTenants) {
          const graceMins = tenant.checkoutGraceMins ?? 15;
          const todayStart = tenantStartOfDay(tenant, now);
          const tTodayKeyVerify = tenantDateKey(tenant, now);

          const activeCheckIns = await db.execute(sql`
            WITH latest_logs AS (
              SELECT DISTINCT ON (user_id) *
              FROM attendance_logs
              WHERE tenant_id = ${tenant.id} AND created_at >= ${todayStart} AND status = 'approved'
              ORDER BY user_id, id DESC
            )
            SELECT l.*, u.name as user_name, u.branch_id, u.employee_status,
                   u.last_heartbeat_lat, u.last_heartbeat_lng, u.last_heartbeat_at
            FROM latest_logs l
            JOIN users u ON l.user_id = u.id
            WHERE l.type = 'check_in'
          `);

          for (const row of (activeCheckIns.rows || activeCheckIns) as any[]) {
            if (row.employee_status && row.employee_status !== 'active') continue;
            const dedupeKey = `${row.user_id}:${tTodayKeyVerify}`;
            if (missedCheckoutProcessed.has(dedupeKey)) continue;

            const branch = row.branch_id ? (await db.select().from(schema.branches).where(eq(schema.branches.id, row.branch_id)).limit(1))[0] || null : null;
            // Tenant-local date key for shift lookup — server-local
            // localDateKey(now) inside this tenant-timezone-gated job could
            // resolve to the wrong calendar day's shift for a non-UTC
            // tenant near a day boundary.
            const shift = await getEffectiveShift(tenant.id, row.user_id as number, tTodayKeyVerify);
            const policy = resolveEffectivePolicy(tenant, branch, shift);
            const [endH, endM] = policy.shiftEndStr.split(':').map(Number);
            // Tenant-local shift-end-of-day, not the shift's hour/minute
            // glued onto the SERVER's current calendar day.
            const shiftEndToday = tenantDateTime(tenant, tTodayKeyVerify, endH || 18, endM || 0);
            const triggerAt = new Date(shiftEndToday.getTime() + graceMins * 60000);
            if (now < triggerAt) continue;

            missedCheckoutProcessed.add(dedupeKey);

            const heartbeatIsFromToday = row.last_heartbeat_at && tenantDateKey(tenant, new Date(row.last_heartbeat_at as any)) === tTodayKeyVerify;
            let outsideOffice = false;
            if (heartbeatIsFromToday && tenant.locationLat && tenant.locationLng) {
              const distance = haversineMeters(row.last_heartbeat_lat as number, row.last_heartbeat_lng as number, tenant.locationLat, tenant.locationLng);
              outsideOffice = distance > (tenant.locationRadiusMeters || 100);
            }

            // Never later than shiftEnd when unverified — this is the
            // overtime-inflation fix: no positive evidence of continued
            // presence means no time past shift end gets counted as worked.
            const checkoutAt = outsideOffice && row.last_heartbeat_at ? new Date(row.last_heartbeat_at as any) : shiftEndToday;
            const reason = outsideOffice
              ? 'Auto check-out: Verified outside office premises after shift end + grace period'
              : `Missed checkout: Could not verify departure ${graceMins} minute(s) after shift end — pending manager review`;

            await db.insert(schema.attendanceLogs).values({
              userId: row.user_id,
              tenantId: tenant.id,
              status: 'approved',
              type: 'check_out',
              checkoutAt,
              createdAt: checkoutAt,
              reason,
              pendingVerification: !outsideOffice,
            });

            await logToAuditLedger({
              tenantId: tenant.id,
              actorId: row.user_id,
              actorName: row.user_name,
              action: 'CHECK_OUT',
              details: { info: reason, verified: outsideOffice },
            });

            if (!outsideOffice) {
              await raiseAttendanceAlert({
                tenantId: tenant.id as number,
                userId: row.user_id as number,
                type: 'auto_checkout_unverified',
                message: `${row.user_name} missed checkout and their departure couldn't be verified ${graceMins} minute(s) after shift end. Their attendance is Pending Checkout Verification.`,
              });
              if (isPlatformFeatureAllowed(tenant, 'unified_notifications')) {
                await notify(tenant.id, 'attendance_missed_checkout', { subjectUserId: row.user_id as number, subjectName: row.user_name as string, data: { graceMins } }).catch(() => undefined);
              } else {
                const approvers = await resolveApprovers(tenant.id, 'missed_checkout', row.user_id as number, ['attendance.approve', 'attendance.edit']);
                if (approvers.length > 0) {
                  await notifyUsers(approvers.map((a: any) => a.id), 'Missed checkout — verification needed', `${row.user_name} did not check out and their departure couldn't be confirmed. Review and resolve via Attendance > Edit Record.`);
                }
              }
            }
          }
        }
      }

      // --- Auto-checkout (at 11:59 PM in EACH tenant's own timezone) — for
      // tenants that haven't enabled missed_checkout_verification above.
      // Previously gated by the SERVER's fixed 23:59 clock for every tenant
      // in one shared query — the same bug class already fixed for the
      // auto-mark-absentees/low-attendance jobs above, migrated here too:
      // trigger time, "today" query boundary, and heartbeat-freshness check
      // are now all resolved in each tenant's own configured timezone. ---
      {
        const legacyCheckoutTenants = (await db.select().from(schema.tenants)).filter((t: any) => !isPlatformFeatureAllowed(t, 'missed_checkout_verification'));
        for (const tenant of legacyCheckoutTenants) {
          const tParts = tenantParts(tenant, now);
          const tTodayKey = tenantDateKey(tenant, now);
          if (!(tParts.hour === 23 && tParts.minute === 59 && lastCheckoutRun.get(tenant.id) !== tTodayKey)) continue;
          lastCheckoutRun.set(tenant.id, tTodayKey);
          console.log(`Running Auto-Checkout Job for tenant ${tenant.id}...`);
          const todayStart = tenantStartOfDay(tenant, now);

          // Fetch users whose last approved attendance status today is
          // check_in, along with their last GPS heartbeat and their
          // tenant's geofence — used below to guess whether they're
          // actually still on-premises (the server can't reach a closed
          // browser tab for a live GPS read at this point).
          const activeCheckIns = await db.execute(sql`
            WITH latest_logs AS (
              SELECT DISTINCT ON (user_id) *
              FROM attendance_logs
              WHERE tenant_id = ${tenant.id} AND created_at >= ${todayStart} AND status = 'approved'
              ORDER BY user_id, id DESC
            )
            SELECT l.*, u.name as user_name, u.email as user_email,
                   u.last_heartbeat_lat, u.last_heartbeat_lng, u.last_heartbeat_at
            FROM latest_logs l
            JOIN users u ON l.user_id = u.id
            WHERE l.type = 'check_in'
          `);

          const rows = activeCheckIns.rows || activeCheckIns;
          for (const row of rows) {
            const heartbeatIsFromToday = row.last_heartbeat_at && tenantDateKey(tenant, new Date(row.last_heartbeat_at as any)) === tTodayKey;

            let outsideOffice = false;
            if (heartbeatIsFromToday && tenant.locationLat && tenant.locationLng) {
              const distance = haversineMeters(row.last_heartbeat_lat as number, row.last_heartbeat_lng as number, tenant.locationLat, tenant.locationLng);
              const radius = tenant.locationRadiusMeters || 100;
              outsideOffice = distance > radius;
            }

            const reason = outsideOffice
              ? 'Auto check-out: Detected outside office premises at end-of-day'
              : 'Auto check-out: System triggered at end-of-day — location could not be confirmed as outside the office';

            await db.insert(schema.attendanceLogs).values({
              userId: row.user_id,
              tenantId: tenant.id,
              status: 'approved',
              type: 'check_out',
              reason,
              // Previously always omitted here, so this day silently
              // resolved to plain 'present' in attendanceDayStatus.ts
              // regardless of whether departure was ever actually
              // confirmed — the in-app alert below existed, but nothing on
              // the record itself reflected the uncertainty, unlike the
              // newer missed_checkout_verification path (Phase 5, above)
              // which already sets this. Setting it here too means an
              // unconfirmed legacy auto-checkout now resolves to
              // 'pending_checkout_verification' instead of a false
              // "present", and shows up for review the same way the newer
              // job's uncertain cases do.
              pendingVerification: !outsideOffice,
            });

            await logToAuditLedger({
              tenantId: tenant.id,
              actorId: row.user_id,
              actorName: row.user_name,
              action: 'CHECK_OUT',
              details: { info: reason }
            });

            // Couldn't confirm they'd actually left — flag it for a
            // manager to review rather than silently trusting the guess.
            if (!outsideOffice) {
              await raiseAttendanceAlert({
                tenantId: tenant.id,
                userId: row.user_id as number,
                type: 'auto_checkout_unverified',
                message: `${row.user_name} was auto-checked-out at end-of-day, but their location couldn't be confirmed as outside the office. Please review.`,
              });
              if (isPlatformFeatureAllowed(tenant, 'unified_notifications')) {
                await notify(tenant.id, 'attendance_missed_checkout', { subjectUserId: row.user_id as number, subjectName: row.user_name as string, data: {} }).catch(() => undefined);
              }
            }
          }
        }
      }

      // Daily Attendance Summary at a fixed 7pm server-clock time, emailed
      // only to admins[0], used to live here. Superseded by the
      // 'executive_daily' notification_digest_subscriptions row every
      // tenant is seeded with (bootstrap/database.ts) — same present/
      // absent/late/violations counts plus leave + pending-corrections,
      // dispatched via dispatchDueDigests() above to every configured
      // recipient (all tenant_admins by default, extendable to named
      // employees via the Notification Center UI), not just the first one.

      // --- Low-Attendance Alerts (at 8:30 PM in EACH tenant's own timezone)
      // — previously gated by the SERVER's clock for every tenant at once
      // (the same bug class the auto-mark-absentees job above was already
      // fixed for); migrated to the identical per-tenant tenantParts()
      // pattern so a tenant's alert fires at their own local 8:30 PM. ---
      {
        const tenantsList = await db.select().from(schema.tenants);

        for (const tenant of tenantsList) {
          const tParts = tenantParts(tenant, now);
          const tTodayKey = tenantDateKey(tenant, now);
          if (!(tParts.hour === 20 && tParts.minute === 30 && lastAttendanceCheckRun.get(tenant.id) !== tTodayKey)) continue;
          lastAttendanceCheckRun.set(tenant.id, tTodayKey);
          console.log(`Running Low-Attendance Alert Job for tenant ${tenant.id}...`);

          const threshold = tenant.minAttendancePercent ?? 75;
          const monitoredUsers = await db.select().from(schema.users).where(
            and(
              eq(schema.users.tenantId, tenant.id),
              sql`role IN ('employee', 'manager', 'HR', 'GM')`
            )
          );

          for (const u of monitoredUsers) {
            const { percentage } = await computeAttendancePercent(u.id, tenant);
            if (percentage >= threshold) continue;

            await logToAuditLedger({
              tenantId: tenant.id,
              actorId: u.id,
              actorName: u.name,
              action: 'LOW_ATTENDANCE_DETECTED',
              details: { percentage, threshold }
            });

            await raiseAttendanceAlert({
              tenantId: tenant.id,
              userId: u.id,
              type: 'low_attendance',
              message: `${u.name} (${u.role}) is at ${percentage}% attendance this month, below the required minimum of ${threshold}%.`,
            });

            await sendLowAttendanceAlertEmail(u.email, u.name, u.name, u.role, percentage, threshold, true);

            const recipients = await getHierarchyAlertRecipients(tenant.id, u.role, u.id);
            for (const recipient of recipients) {
              await sendLowAttendanceAlertEmail(recipient.email, recipient.name, u.name, u.role, percentage, threshold, false);
            }
          }
        }
      }

      // --- Attendance log archival (1st of the month, 2:00 AM) ---
      // Moves rows older than each tenant's own attendanceRetentionMonths
      // (0 = disabled — most tenants never run this) from the hot
      // attendance_logs table into attendance_logs_archive, unmodified.
      // Insert-then-delete against the same cutoff, not a single
      // move-in-place statement, so an interrupted run is safe to resume —
      // ON CONFLICT DO NOTHING means re-running never double-inserts, and
      // the delete only ever removes rows already confirmed archived.
      // Tenant-local "1st of month, 2 AM" trigger + tenant-local retention
      // cutoff — previously gated by the SERVER's calendar/clock for every
      // tenant at once, so "1st of month" could fire on the wrong tenant-
      // local day, and the retention cutoff itself was computed from the
      // server's own current date, not the tenant's.
      {
        const tenantsList = await db.select().from(schema.tenants);
        for (const tenant of tenantsList) {
          const tParts = tenantParts(tenant, now);
          const archivalMonthKey = tenantDateKey(tenant, now).slice(0, 7);
          if (!(tParts.day === 1 && tParts.hour === 2 && tParts.minute === 0 && lastArchivalRun.get(tenant.id) !== archivalMonthKey)) continue;
          lastArchivalRun.set(tenant.id, archivalMonthKey);
          console.log(`Running Attendance Log Archival Job for tenant ${tenant.id}...`);

          const months = tenant.attendanceRetentionMonths || 0;
          if (months <= 0) continue;
          const [tYear, tMonth] = tenantDateKey(tenant, now).split('-').map(Number);
          let cutoffYear = tYear;
          let cutoffMonth = tMonth - months;
          while (cutoffMonth <= 0) { cutoffMonth += 12; cutoffYear -= 1; }
          const cutoff = tenantDateTime(tenant, `${cutoffYear}-${String(cutoffMonth).padStart(2, '0')}-01`, 0, 0);

          try {
            await db.execute(sql`
              INSERT INTO attendance_logs_archive (id, user_id, tenant_id, status, type, client_timestamp, device, location_lat, location_lng, reason, explanation, attendance_mode, home_lat, home_lng, distance_from_home_meters, wfh_reason, checkout_at, worked_minutes, branch_id, created_at)
              SELECT id, user_id, tenant_id, status, type, client_timestamp, device, location_lat, location_lng, reason, explanation, attendance_mode, home_lat, home_lng, distance_from_home_meters, wfh_reason, checkout_at, worked_minutes, branch_id, created_at
              FROM attendance_logs
              WHERE tenant_id = ${tenant.id} AND created_at < ${cutoff}
              ON CONFLICT (id) DO NOTHING
            `);
            await db.execute(sql`
              DELETE FROM attendance_logs WHERE tenant_id = ${tenant.id} AND created_at < ${cutoff}
            `);
          } catch (archiveErr) {
            console.error(`Error archiving attendance logs for tenant ${tenant.id}:`, archiveErr);
          }
        }
      }
    } catch (err) {
      console.error('Error in daily schedule job:', err);
    }
  }, 60000);

  // 3. Ticket / alert 24h auto-escalation — checked every minute, no
  // day-boundary dedupe needed: escalating resets lastAssignedAt to now, so
  // the same row naturally stops matching this query for another 24h.
  // Walks escalationLevel forward exactly one step (manager -> GM ->
  // tenant_admin) per timeout, same as a manual "Escalate" action, so a
  // ticket/alert that keeps getting ignored eventually always lands on
  // tenant_admin (the permanent backstop).
  setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const staleTickets = await db.select().from(schema.tickets).where(
        and(eq(schema.tickets.status, 'open'), sql`${schema.tickets.lastAssignedAt} < ${cutoff}`)
      );
      for (const ticket of staleTickets) {
        const next = await resolveNextEscalation(ticket.tenantId, ticket.raisedByUserId, ticket.escalationLevel as 0 | 1 | 2);
        if (!next) continue; // already at tenant_admin — nowhere further to go, leave it for a human to notice
        await db.insert(schema.ticketEscalations).values({
          ticketId: ticket.id, fromUserId: ticket.currentAssigneeUserId, toUserId: next.userId,
          fromLevel: ticket.escalationLevel, toLevel: next.level, reason: 'auto_24h_timeout',
        });
        await db.update(schema.tickets).set({ escalationLevel: next.level, currentAssigneeUserId: next.userId, lastAssignedAt: new Date(), updatedAt: new Date() }).where(eq(schema.tickets.id, ticket.id));
        await logToAuditLedger({ tenantId: ticket.tenantId, actorId: null, actorName: 'System (24h auto-escalation)', action: 'TICKET_AUTO_ESCALATED', details: { ticketId: ticket.id, toLevel: next.level, toUserId: next.userId } });
        dispatchWebhookEvent(ticket.tenantId, 'ticket.escalated', { ticketId: ticket.id, toLevel: next.level, toUserId: next.userId, auto: true });
        await notifyDirectRecipient(ticket.tenantId, 'ticket_escalated', { id: next.userId, name: next.name, email: next.email },
          `Ticket auto-escalated to you: ${ticket.subject}`,
          `This ${ticket.priority} priority ticket wasn't actioned within 24 hours, so it was automatically escalated to you.`).catch(() => undefined);
      }

      const staleAlerts = await db.select().from(schema.attendanceAlerts).where(
        and(eq(schema.attendanceAlerts.status, 'pending'), sql`${schema.attendanceAlerts.lastAssignedAt} < ${cutoff}`)
      );
      for (const alert of staleAlerts) {
        const next = await resolveNextEscalation(alert.tenantId, alert.userId, alert.escalationLevel as 0 | 1 | 2);
        if (!next) continue;
        await db.update(schema.attendanceAlerts).set({ escalationLevel: next.level, currentAssigneeUserId: next.userId, lastAssignedAt: new Date() }).where(eq(schema.attendanceAlerts.id, alert.id));
        await logToAuditLedger({ tenantId: alert.tenantId, actorId: null, actorName: 'System (24h auto-escalation)', action: 'ALERT_AUTO_ESCALATED', details: { alertId: alert.id, type: alert.type, toLevel: next.level, toUserId: next.userId } });
        await notifyDirectRecipient(alert.tenantId, 'attendance_alert_escalated', { id: next.userId, name: next.name, email: next.email },
          `Alert auto-escalated to you`,
          `An unresolved ${alert.type.replace(/_/g, ' ')} alert wasn't actioned within 24 hours, so it was automatically escalated to you.`).catch(() => undefined);
      }
    } catch (err) {
      console.error('Error in ticket/alert auto-escalation job:', err);
    }
  }, 60000);

  // 4. Leave request 24h auto-escalation — same manager -> GM -> tenant_admin
  // walk as tickets/alerts above, applied to approvals sitting unactioned.
  // Escalating resets lastEscalatedAt so the same row naturally stops
  // matching for another 24h; a request created and never escalated has
  // lastEscalatedAt=null, so it's compared against createdAt instead.
  setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const staleLeave = await db.select().from(schema.leaveRequests).where(
        and(
          eq(schema.leaveRequests.status, 'pending'),
          sql`COALESCE(${schema.leaveRequests.lastEscalatedAt}, ${schema.leaveRequests.createdAt}) < ${cutoff}`,
        )
      );
      for (const req of staleLeave) {
        const next = await resolveNextEscalation(req.tenantId, req.userId, req.escalationLevel as 0 | 1 | 2);
        if (!next) continue; // already at tenant_admin — nowhere further to go
        const previousAssignee = req.escalationLevel > 0 ? await resolveEscalationAssignee(req.tenantId, req.userId, req.escalationLevel as 0 | 1 | 2).catch(() => null) : null;
        await db.update(schema.leaveRequests).set({ escalationLevel: next.level, lastEscalatedAt: new Date() }).where(eq(schema.leaveRequests.id, req.id));
        await db.insert(schema.leaveEscalationHistory).values({
          leaveRequestId: req.id, fromUserId: previousAssignee?.userId ?? null, toUserId: next.userId,
          fromLevel: req.escalationLevel, toLevel: next.level, reason: 'auto_24h_timeout',
        });
        await logToAuditLedger({ tenantId: req.tenantId, actorId: null, actorName: 'System (24h auto-escalation)', action: 'LEAVE_REQUEST_AUTO_ESCALATED', details: { leaveRequestId: req.id, toLevel: next.level, toUserId: next.userId } });
        await notifyDirectRecipient(req.tenantId, 'leave_request_escalated', { id: next.userId, name: next.name, email: next.email },
          `Leave request auto-escalated to you`,
          `A pending leave request wasn't actioned within 24 hours, so it was automatically escalated to you.`).catch(() => undefined);
      }
    } catch (err) {
      console.error('Error in leave request auto-escalation job:', err);
    }
  }, 60000);

  // 5. Delegation auto-expiry — purely cosmetic for audit history (the
  // actual access grant already stops working the instant endDate passes,
  // since hasActiveDelegatedPrivilege checks the date range live). This
  // just flips status so the delegations list doesn't show a stale
  // "active" badge on something that no longer grants anything.
  setInterval(async () => {
    try {
      // Per-tenant "today" — endDate is a tenant-entered business date, so
      // comparing it against a single UTC "today" for every tenant at once
      // could flip a delegation to 'expired' up to ~a day early/late for
      // any tenant not on UTC. Cosmetic-only (per the comment above — the
      // real access check is live-date-range based), but worth getting
      // right since the badge is what admins actually look at.
      const tenantsList = await db.select({ id: schema.tenants.id, timezone: schema.tenants.timezone }).from(schema.tenants);
      for (const tenant of tenantsList) {
        const today = tenantDateKey(tenant, new Date());
        await db.update(schema.delegations)
          .set({ status: 'expired' })
          .where(and(eq(schema.delegations.tenantId, tenant.id), eq(schema.delegations.status, 'active'), sql`${schema.delegations.endDate} < ${today}`));
      }
    } catch (err) {
      console.error('Error in delegation auto-expiry job:', err);
    }
  }, 3600000);
}

// Start the background scheduler only on the instance that wins leadership, so
// that when the app is scaled to multiple replicas the scheduled jobs (break
// scans, daily crons, alert emails) run exactly once across the fleet rather
// than redundantly on every replica. Followers stand by and periodically retry
// so leadership fails over automatically if the current leader goes away. On
// the single-instance JSON fallback, leadership is granted immediately.
export async function startSchedulerWithLeadership() {
  const tryBecomeLeader = async (): Promise<boolean> => {
    const isLeader = await tryAcquireSchedulerLeadership();
    if (isLeader) {
      logger.info('scheduler: acquired leadership — starting background jobs on this instance');
      runBackgroundScheduler();
    }
    return isLeader;
  };

  if (await tryBecomeLeader()) return;

  logger.info('scheduler: another instance is the leader — standing by as follower');
  const retry = setInterval(async () => {
    if (await tryBecomeLeader()) clearInterval(retry);
  }, 30000);
}
