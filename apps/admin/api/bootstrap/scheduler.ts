import crypto from 'crypto';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db, schema, tryAcquireSchedulerLeadership } from '../../db';
import { logger } from '../../logger';
import { reverseGeocode } from '../../geocoding.js';
import { sendEmail, sendPasswordResetEmail, sendAttendanceCorrectionEmail, sendBreakViolationAlert, sendManagerEscalationEmail, sendLateArrivalApprovalRequestEmail, sendLateArrivalDecisionEmail, sendLowAttendanceAlertEmail, sendBreakLocationViolationEmail, sendWfhApprovalRequestEmail, sendWfhDecisionEmail, sendWfhLocationChangeRequestEmail, sendWfhLocationChangeDecisionEmail, sendAutoAbsentAlertEmail } from '../../mail.js';
import { haversineMeters, resolveActiveIp } from '../services/geo';
import { computeAttendancePercent, getHierarchyAlertRecipients } from '../services/attendanceStats';
import { logToAuditLedger } from '../services/audit';
import { dispatchWebhookEvent } from '../services/webhooks';
import { raiseAttendanceAlert } from '../services/alerts';
import { resolveNextEscalation } from '../services/escalation';
import { notifyUser, notifyUsers } from '../services/notifications';
import { queue } from '../services/queue';
import { isPlatformFeatureAllowed } from '../auth/rbac';
import { getEffectiveShift } from '../services/shiftOverrides';
import { resolveEffectivePolicy } from '../services/attendancePolicy';
import { resolveApprovers } from '../services/approvalRouting';
import { localDateKey } from '../services/dateUtils';
import { tenantDateKey, tenantParts } from '../services/tenantTime';
import { registerReportSchedulerHandler, enqueueDueReportSchedules } from '../services/reportScheduler';

export function runBackgroundScheduler() {
  console.log('Background Scheduler initialized.');
  
  // Track runs to prevent duplicate triggers within the same minute
  // Per-tenant (not a single global string) — "11:00 AM" means 11:00 in
  // EACH tenant's own configured timezone (tenants.timezone), which can
  // differ from the server's clock and from each other.
  const lastAbsenteesRun = new Map<number, string>();
  let lastCheckoutRun = '';
  let lastSummaryRun = '';
  let lastAttendanceCheckRun = '';
  let lastArchivalRun = '';
  // Missed-checkout verification (Phase 5) runs every minute per-user
  // (each has a different shiftEnd+grace trigger time), not once at a
  // fixed hour — this dedupes so a user isn't processed twice in one day.
  // Cleared at midnight below.
  let missedCheckoutProcessed = new Set<string>();
  let lastReportScheduleCheck = '';

  // Register the queue job handler that actually executes a scheduled
  // report (see services/reportScheduler.ts) — must happen before the poll
  // loop below starts picking up jobs.
  registerReportSchedulerHandler();

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
          await sendBreakViolationAlert(brk.userEmail, brk.userName, new Date().toLocaleDateString(), Math.round(elapsedMins), budget);
          
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

          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);

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

      // --- Missed-checkout verification (Phase 5) — per-user shiftEnd +
      // checkoutGraceMins, only for tenants with 'missed_checkout_
      // verification' enabled. Runs every minute (each user's trigger time
      // differs), unlike the legacy fixed-23:59 job below, which still
      // handles every other tenant completely unchanged. ---
      {
        const verifyTenants = (await db.select().from(schema.tenants)).filter((t: any) => isPlatformFeatureAllowed(t, 'missed_checkout_verification'));
        for (const tenant of verifyTenants) {
          const graceMins = tenant.checkoutGraceMins ?? 15;
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);

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
            const dedupeKey = `${row.user_id}:${todayKey}`;
            if (missedCheckoutProcessed.has(dedupeKey)) continue;

            const branch = row.branch_id ? (await db.select().from(schema.branches).where(eq(schema.branches.id, row.branch_id)).limit(1))[0] || null : null;
            const shift = await getEffectiveShift(tenant.id, row.user_id as number, localDateKey(now));
            const policy = resolveEffectivePolicy(tenant, branch, shift);
            const [endH, endM] = policy.shiftEndStr.split(':').map(Number);
            const shiftEndToday = new Date();
            shiftEndToday.setHours(endH || 18, endM || 0, 0, 0);
            const triggerAt = new Date(shiftEndToday.getTime() + graceMins * 60000);
            if (now < triggerAt) continue;

            missedCheckoutProcessed.add(dedupeKey);

            const heartbeatIsFromToday = row.last_heartbeat_at && new Date(row.last_heartbeat_at as any).toDateString() === todayKey;
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
              const approvers = await resolveApprovers(tenant.id, 'missed_checkout', row.user_id as number, ['attendance.approve', 'attendance.edit']);
              if (approvers.length > 0) {
                await notifyUsers(approvers.map((a: any) => a.id), 'Missed checkout — verification needed', `${row.user_name} did not check out and their departure couldn't be confirmed. Review and resolve via Attendance > Edit Record.`);
              }
            }
          }
        }
      }

      // --- Auto-checkout (at 11:59 PM daily) — unchanged for tenants that
      // haven't enabled missed_checkout_verification above. ---
      if (currentHour === 23 && currentMin === 59 && lastCheckoutRun !== todayKey) {
        lastCheckoutRun = todayKey;
        console.log('Running Auto-Checkout Job...');
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // Fetch users whose last approved attendance status today is
        // check_in, along with their last GPS heartbeat and their tenant's
        // geofence — used below to guess whether they're actually still
        // on-premises (the server can't reach a closed browser tab for a
        // live GPS read at this point).
        const activeCheckIns = await db.execute(sql`
          WITH latest_logs AS (
            SELECT DISTINCT ON (user_id) *
            FROM attendance_logs
            WHERE created_at >= ${todayStart} AND status = 'approved'
            ORDER BY user_id, id DESC
          )
          SELECT l.*, u.name as user_name, u.email as user_email,
                 u.last_heartbeat_lat, u.last_heartbeat_lng, u.last_heartbeat_at,
                 t.location_lat as tenant_lat, t.location_lng as tenant_lng, t.location_radius_meters as tenant_radius
          FROM latest_logs l
          JOIN users u ON l.user_id = u.id
          JOIN tenants t ON l.tenant_id = t.id
          WHERE l.type = 'check_in'
        `);

        const rows = activeCheckIns.rows || activeCheckIns;
        for (const row of rows) {
          const heartbeatIsFromToday = row.last_heartbeat_at && new Date(row.last_heartbeat_at as any).toDateString() === todayKey;

          let outsideOffice = false;
          if (heartbeatIsFromToday && row.tenant_lat && row.tenant_lng) {
            const distance = haversineMeters(row.last_heartbeat_lat as number, row.last_heartbeat_lng as number, row.tenant_lat as number, row.tenant_lng as number);
            const radius = (row.tenant_radius as number) || 100;
            outsideOffice = distance > radius;
          }

          const reason = outsideOffice
            ? 'Auto check-out: Detected outside office premises at end-of-day'
            : 'Auto check-out: System triggered at end-of-day (location unavailable or still on-premises)';

          await db.insert(schema.attendanceLogs).values({
            userId: row.user_id,
            tenantId: row.tenant_id,
            status: 'approved',
            type: 'check_out',
            reason
          });

          await logToAuditLedger({
            tenantId: row.tenant_id,
            actorId: row.user_id,
            actorName: row.user_name,
            action: 'CHECK_OUT',
            details: { info: reason }
          });

          // Couldn't confirm they'd actually left — flag it for a manager
          // to review rather than silently trusting the guess.
          if (!outsideOffice) {
            await raiseAttendanceAlert({
              tenantId: row.tenant_id as number,
              userId: row.user_id as number,
              type: 'auto_checkout_unverified',
              message: `${row.user_name} was auto-checked-out at end-of-day, but their location couldn't be confirmed as outside the office. Please review.`,
            });
          }
        }
      }

      // --- Daily Attendance Summaries (at 7:00 PM) ---
      if (currentHour === 19 && currentMin === 0 && lastSummaryRun !== todayKey) {
        lastSummaryRun = todayKey;
        console.log('Running Daily Summaries Job...');
        const tenantsList = await db.select().from(schema.tenants);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        for (const tenant of tenantsList) {
          const admins = await db.select().from(schema.users).where(
            and(
              eq(schema.users.tenantId, tenant.id),
              eq(schema.users.role, 'tenant_admin')
            )
          );
          if (admins.length === 0) continue;

          const totalEmployees = await db.select().from(schema.users).where(
            and(
              eq(schema.users.tenantId, tenant.id),
              eq(schema.users.role, 'employee')
            )
          );

          const checkedIn = await db.execute(sql`
            SELECT COUNT(DISTINCT user_id) as count 
            FROM attendance_logs 
            WHERE tenant_id = ${tenant.id} AND created_at >= ${todayStart} AND status = 'approved' AND type = 'check_in'
          `);

          const late = await db.execute(sql`
            SELECT COUNT(DISTINCT user_id) as count 
            FROM attendance_logs 
            WHERE tenant_id = ${tenant.id} AND created_at >= ${todayStart} AND status = 'approved' AND type = 'check_in' AND reason LIKE '%Late Arrival%'
          `);

          const violations = await db.select().from(schema.auditLedger).where(
            and(
              eq(schema.auditLedger.tenantId, tenant.id),
              sql`timestamp >= ${todayStart}`,
              sql`action IN ('FRAUD_CLOCK_MANIPULATION', 'BREAK_VIOLATION', 'FRAUD_GEOFENCE_BYPASS', 'FRAUD_NETWORK_BYPASS')`
            )
          );

          const checkInCount = checkedIn.rows ? checkedIn.rows[0].count : checkedIn[0].count;
          const lateCount = late.rows ? late.rows[0].count : late[0].count;
          const absentCount = totalEmployees.length - Number(checkInCount);

          await sendEmail({
            to: admins[0].email,
            subject: `Smart Teams Daily Summary: ${tenant.name}`,
            text: `Daily Summary for ${tenant.name} (${new Date().toLocaleDateString()}):\n\nTotal Employees: ${totalEmployees.length}\nPresent: ${checkInCount}\nLate Arrivals: ${lateCount}\nAbsent: ${absentCount}\nPolicy Violations today: ${violations.length}\n\nBest Regards,\nSmart Teams Security Engine`,
            html: `
              <div style="font-family: sans-serif; padding: 20px; color: #1E293B;">
                <h2>Daily Summary for ${tenant.name}</h2>
                <p>Date: <strong>${new Date().toLocaleDateString()}</strong></p>
                <ul>
                  <li>Total Employees: <strong>${totalEmployees.length}</strong></li>
                  <li>Present: <strong>${checkInCount}</strong></li>
                  <li>Late Arrivals: <strong>${lateCount}</strong></li>
                  <li>Absent: <strong>${absentCount}</strong></li>
                  <li>Policy Violations Today: <strong style="color:#EF4444;">${violations.length}</strong></li>
                </ul>
                <p>Please check the administrator audit ledger for detail entries.</p>
              </div>
            `
          });
        }
      }

      // --- Low-Attendance Alerts (at 8:30 PM daily) ---
      if (currentHour === 20 && currentMin === 30 && lastAttendanceCheckRun !== todayKey) {
        lastAttendanceCheckRun = todayKey;
        console.log('Running Low-Attendance Alert Job...');
        const tenantsList = await db.select().from(schema.tenants);

        for (const tenant of tenantsList) {
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
      const archivalMonthKey = `${now.getFullYear()}-${now.getMonth()}`;
      if (now.getDate() === 1 && currentHour === 2 && currentMin === 0 && lastArchivalRun !== archivalMonthKey) {
        lastArchivalRun = archivalMonthKey;
        console.log('Running Attendance Log Archival Job...');
        const tenantsList = await db.select().from(schema.tenants);
        for (const tenant of tenantsList) {
          const months = tenant.attendanceRetentionMonths || 0;
          if (months <= 0) continue;
          const cutoff = new Date();
          cutoff.setMonth(cutoff.getMonth() - months);

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
        await notifyUser(next.userId, `Ticket auto-escalated to you: ${ticket.subject}`, `This ${ticket.priority} priority ticket wasn't actioned within 24 hours, so it was automatically escalated to you.`);
      }

      const staleAlerts = await db.select().from(schema.attendanceAlerts).where(
        and(eq(schema.attendanceAlerts.status, 'pending'), sql`${schema.attendanceAlerts.lastAssignedAt} < ${cutoff}`)
      );
      for (const alert of staleAlerts) {
        const next = await resolveNextEscalation(alert.tenantId, alert.userId, alert.escalationLevel as 0 | 1 | 2);
        if (!next) continue;
        await db.update(schema.attendanceAlerts).set({ escalationLevel: next.level, currentAssigneeUserId: next.userId, lastAssignedAt: new Date() }).where(eq(schema.attendanceAlerts.id, alert.id));
        await logToAuditLedger({ tenantId: alert.tenantId, actorId: null, actorName: 'System (24h auto-escalation)', action: 'ALERT_AUTO_ESCALATED', details: { alertId: alert.id, type: alert.type, toLevel: next.level, toUserId: next.userId } });
        await notifyUser(next.userId, `Alert auto-escalated to you`, `An unresolved ${alert.type.replace(/_/g, ' ')} alert wasn't actioned within 24 hours, so it was automatically escalated to you.`);
      }
    } catch (err) {
      console.error('Error in ticket/alert auto-escalation job:', err);
    }
  }, 60000);
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
