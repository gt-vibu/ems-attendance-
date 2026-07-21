import { eq, and, gte, lte } from 'drizzle-orm';
import { db, schema } from '../../db';
import { logToAuditLedger } from './audit';
import { dispatchWebhookEvent } from './webhooks';
import { computeLeaveDays } from '../routes/leavePayrollShared';

// Shared, reusable mutation logic for "someone with the right privilege
// directly corrects a record after the fact." Used by both the standalone
// edit endpoints (attendance.routes.ts PATCH /api/tenant/attendance-logs/:id
// equivalent, leave.routes.ts amend endpoint) AND ticket resolution
// (tickets.routes.ts) — one implementation, so a fix made via a ticket and a
// fix made directly always behave identically and reconcile the same way
// with payroll/attendance-%% (both of which query attendance_logs/
// leave_requests fresh on every read — there is no cache to invalidate).

function dateRangeForDay(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(`${date}T23:59:59.999Z`);
  return { start, end };
}

export interface EditAttendanceParams {
  tenantId: number;
  targetUserId: number;
  date: string; // 'YYYY-MM-DD'
  newStatus: 'present' | 'absent';
  checkInTime?: string; // 'HH:MM', only used when newStatus='present' and no existing log for the day
  checkOutTime?: string; // 'HH:MM'
  editedByUserId: number;
  editedByName: string;
  reason: string;
  ticketId?: number;
  ipAddress: string;
  deviceInfo: string;
}

// Flips a day between present/absent. "Absent" in this app is a COMPUTED
// state (no non-rejected check-in row for the day), not a stored row — see
// computeEmployeeEarnings/computeAttendancePercent, both of which look for
// `type: 'check_in', status !== 'rejected'` (earnings) or `status ===
// 'approved'` (attendance %). So: marking a day PRESENT that has no log
// means inserting one; marking a day ABSENT that has a log means rejecting
// it, not deleting it (deleting would erase the audit trail of what
// actually happened).
export async function editAttendanceDay(params: EditAttendanceParams) {
  const { tenantId, targetUserId, date, newStatus, checkInTime, checkOutTime, editedByUserId, editedByName, reason, ticketId, ipAddress, deviceInfo } = params;
  const { start, end } = dateRangeForDay(date);

  const existingLogs = await db.select().from(schema.attendanceLogs).where(
    and(eq(schema.attendanceLogs.userId, targetUserId), eq(schema.attendanceLogs.tenantId, tenantId), gte(schema.attendanceLogs.createdAt, start), lte(schema.attendanceLogs.createdAt, end))
  );
  const existingCheckIn = existingLogs.find((l: any) => l.type === 'check_in');
  const existingCheckOut = existingLogs.find((l: any) => l.type === 'check_out');

  let resultLogId: number;

  if (newStatus === 'absent') {
    if (!existingCheckIn) {
      // Already computes as absent (no log at all) — nothing to change.
      resultLogId = 0;
    } else {
      await db.update(schema.attendanceLogs).set({ status: 'rejected', explanation: reason }).where(eq(schema.attendanceLogs.id, existingCheckIn.id));
      if (existingCheckOut) {
        await db.update(schema.attendanceLogs).set({ status: 'rejected' }).where(eq(schema.attendanceLogs.id, existingCheckOut.id));
      }
      resultLogId = existingCheckIn.id;
    }
  } else {
    const userRows = await db.select().from(schema.users).where(eq(schema.users.id, targetUserId)).limit(1);
    const branchId = userRows[0]?.branchId ?? null;

    if (existingCheckIn) {
      await db.update(schema.attendanceLogs).set({ status: 'approved', explanation: reason }).where(eq(schema.attendanceLogs.id, existingCheckIn.id));
      resultLogId = existingCheckIn.id;
      if (checkOutTime) {
        const checkoutAt = new Date(`${date}T${checkOutTime}:00.000Z`);
        if (existingCheckOut) {
          await db.update(schema.attendanceLogs).set({ status: 'approved', checkoutAt, createdAt: checkoutAt }).where(eq(schema.attendanceLogs.id, existingCheckOut.id));
        } else {
          await db.insert(schema.attendanceLogs).values({
            userId: targetUserId, tenantId, status: 'approved', type: 'check_out',
            createdAt: checkoutAt, checkoutAt, branchId, attendanceMode: 'office',
            reason: 'Recorded via administrative correction', explanation: reason,
          });
        }
      }
    } else {
      const checkInAt = new Date(`${date}T${checkInTime || '09:00'}:00.000Z`);
      const [inserted] = await db.insert(schema.attendanceLogs).values({
        userId: targetUserId, tenantId, status: 'approved', type: 'check_in',
        createdAt: checkInAt, branchId, attendanceMode: 'office',
        reason: 'Recorded via administrative correction', explanation: reason,
      }).returning();
      resultLogId = inserted.id;
      if (checkOutTime) {
        const checkoutAt = new Date(`${date}T${checkOutTime}:00.000Z`);
        await db.insert(schema.attendanceLogs).values({
          userId: targetUserId, tenantId, status: 'approved', type: 'check_out',
          createdAt: checkoutAt, checkoutAt, branchId, attendanceMode: 'office',
          reason: 'Recorded via administrative correction', explanation: reason,
        });
      }
    }
  }

  await logToAuditLedger({
    tenantId, actorId: editedByUserId, actorName: editedByName,
    action: 'ATTENDANCE_LOG_EDITED', ipAddress, deviceInfo,
    details: { targetUserId, date, newStatus, checkInTime: checkInTime || null, checkOutTime: checkOutTime || null, reason, ticketId: ticketId || null },
  });
  dispatchWebhookEvent(tenantId, 'attendance.edited', { targetUserId, date, newStatus, editedByUserId, ticketId: ticketId || null });

  return { logId: resultLogId };
}

export interface AmendLeaveParams {
  tenantId: number;
  leaveRequestId: number;
  newStatus?: 'approved' | 'rejected';
  startDate?: string;
  endDate?: string;
  leaveType?: string;
  editedByUserId: number;
  editedByName: string;
  reason: string;
  ticketId?: number;
  ipAddress: string;
  deviceInfo: string;
}

// Amends an already-decided leave request in place. Deliberately reuses the
// same row (not a new one) — leave balance/payroll math both read
// leaveRequests.status/startDate/endDate/totalDays live, so correcting this
// row is exactly what makes "the wrong dates got approved" or "this got
// rejected by mistake" flow through to payroll without a separate step.
export async function amendLeaveRequest(params: AmendLeaveParams) {
  const { tenantId, leaveRequestId, newStatus, startDate, endDate, leaveType, editedByUserId, editedByName, reason, ticketId, ipAddress, deviceInfo } = params;

  const rows = await db.select().from(schema.leaveRequests).where(and(eq(schema.leaveRequests.id, leaveRequestId), eq(schema.leaveRequests.tenantId, tenantId))).limit(1);
  if (rows.length === 0) throw new Error('Leave request not found.');
  const existing = rows[0];

  const finalStartDate = startDate || existing.startDate;
  const finalEndDate = endDate || existing.endDate;
  const halfDay = Number(existing.totalDays) === 0.5;
  const updates: any = {
    reviewerComment: `${existing.reviewerComment ? existing.reviewerComment + ' | ' : ''}Amended: ${reason}`,
  };
  if (newStatus) updates.status = newStatus;
  if (startDate) updates.startDate = startDate;
  if (endDate) updates.endDate = endDate;
  if (leaveType) updates.leaveType = leaveType;
  if (startDate || endDate) updates.totalDays = computeLeaveDays(finalStartDate, finalEndDate, halfDay);

  await db.update(schema.leaveRequests).set(updates).where(eq(schema.leaveRequests.id, leaveRequestId));

  await logToAuditLedger({
    tenantId, actorId: editedByUserId, actorName: editedByName,
    action: 'LEAVE_REQUEST_AMENDED', ipAddress, deviceInfo,
    details: { leaveRequestId, targetUserId: existing.userId, newStatus: newStatus || existing.status, startDate: finalStartDate, endDate: finalEndDate, leaveType: leaveType || existing.leaveType, reason, ticketId: ticketId || null },
  });
  dispatchWebhookEvent(tenantId, 'leave.amended', { leaveRequestId, targetUserId: existing.userId, editedByUserId, ticketId: ticketId || null });

  return { leaveRequestId };
}
