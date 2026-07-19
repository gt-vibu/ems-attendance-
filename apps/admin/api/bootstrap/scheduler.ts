import crypto from 'crypto';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db, schema, tryAcquireSchedulerLeadership } from '../../db';
import { logger } from '../../logger';
import { reverseGeocode } from '../../geocoding.js';
import { sendEmail, sendPasswordResetEmail, sendAttendanceCorrectionEmail, sendBreakViolationAlert, sendManagerEscalationEmail, sendLateArrivalApprovalRequestEmail, sendLateArrivalDecisionEmail, sendLowAttendanceAlertEmail, sendBreakLocationViolationEmail, sendWfhApprovalRequestEmail, sendWfhDecisionEmail, sendWfhLocationChangeRequestEmail, sendWfhLocationChangeDecisionEmail } from '../../mail.js';
import { haversineMeters, resolveActiveIp } from '../services/geo';
import { computeAttendancePercent, getHierarchyAlertRecipients } from '../services/attendanceStats';
import { logToAuditLedger } from '../services/audit';

export function runBackgroundScheduler() {
  console.log('Background Scheduler initialized.');
  
  // Track runs to prevent duplicate triggers within the same minute
  let lastAbsenteesRun = '';
  let lastCheckoutRun = '';
  let lastSummaryRun = '';
  let lastAttendanceCheckRun = '';

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

      // --- Auto-mark absentees (at 11:00 AM daily) ---
      if (currentHour === 11 && currentMin === 0 && lastAbsenteesRun !== todayKey) {
        lastAbsenteesRun = todayKey;
        console.log('Running Auto-Mark Absentees Job...');
        const tenantsList = await db.select().from(schema.tenants);
        for (const tenant of tenantsList) {
          const employees = await db.select().from(schema.users).where(
            and(
              eq(schema.users.tenantId, tenant.id),
              eq(schema.users.role, 'employee')
            )
          );
          
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);

          for (const emp of employees) {
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
            }
          }
        }
      }

      // --- Auto-checkout (at 11:59 PM daily) ---
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
            await db.insert(schema.attendanceAlerts).values({
              tenantId: row.tenant_id as number,
              userId: row.user_id as number,
              type: 'auto_checkout_unverified',
              message: `${row.user_name} was auto-checked-out at end-of-day, but their location couldn't be confirmed as outside the office. Please review.`,
              status: 'pending'
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

            await db.insert(schema.attendanceAlerts).values({
              tenantId: tenant.id,
              userId: u.id,
              type: 'low_attendance',
              message: `${u.name} (${u.role}) is at ${percentage}% attendance this month, below the required minimum of ${threshold}%.`,
              status: 'pending'
            });

            await sendLowAttendanceAlertEmail(u.email, u.name, u.name, u.role, percentage, threshold, true);

            const recipients = await getHierarchyAlertRecipients(tenant.id, u.role, u.id);
            for (const recipient of recipients) {
              await sendLowAttendanceAlertEmail(recipient.email, recipient.name, u.name, u.role, percentage, threshold, false);
            }
          }
        }
      }
    } catch (err) {
      console.error('Error in daily schedule job:', err);
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
