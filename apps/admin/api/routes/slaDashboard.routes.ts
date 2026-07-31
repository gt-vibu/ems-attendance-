import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege } from '../auth/rbac';

export const router = Router();

// Read-only aggregation of pending approvals sitting the longest, across the
// two request types that already carry a real created-at + pending status
// (leave requests, attendance corrections/late-arrival). Not a new approval
// mechanism — purely a "what's overdue" view over existing data.
const WARN_HOURS = 24;
const BREACH_HOURS = 48;

function ageBucket(createdAt: Date | null): 'ok' | 'warning' | 'breached' {
  if (!createdAt) return 'ok';
  const hours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
  if (hours >= BREACH_HOURS) return 'breached';
  if (hours >= WARN_HOURS) return 'warning';
  return 'ok';
}

router.get('/api/tenant/sla-dashboard', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId;
    if (!hasPrivilege(req.user, 'leave.approve') && !hasPrivilege(req.user, 'attendance.approve')) {
      return res.status(403).json({ error: 'Not permitted' });
    }

    const [pendingLeave, pendingAttendance] = await Promise.all([
      db.select({
        id: schema.leaveRequests.id,
        userId: schema.leaveRequests.userId,
        leaveType: schema.leaveRequests.leaveType,
        createdAt: schema.leaveRequests.createdAt,
      }).from(schema.leaveRequests)
        .where(and(eq(schema.leaveRequests.tenantId, tenantId), eq(schema.leaveRequests.status, 'pending'))),
      db.select({
        id: schema.attendanceLogs.id,
        userId: schema.attendanceLogs.userId,
        reason: schema.attendanceLogs.reason,
        isLate: schema.attendanceLogs.isLate,
        createdAt: schema.attendanceLogs.createdAt,
      }).from(schema.attendanceLogs)
        .where(and(eq(schema.attendanceLogs.tenantId, tenantId), eq(schema.attendanceLogs.status, 'pending'))),
    ]);

    const userIds = Array.from(new Set([
      ...pendingLeave.map(r => r.userId),
      ...pendingAttendance.map(r => r.userId),
    ]));
    const userRows = userIds.length
      ? await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users)
          .where(eq(schema.users.tenantId, tenantId))
      : [];
    const nameById = new Map(userRows.map(u => [u.id, u.name]));

    const items = [
      ...pendingLeave.map(r => ({
        id: `leave-${r.id}`,
        type: 'leave_request' as const,
        label: `${r.leaveType} leave`,
        userId: r.userId,
        userName: nameById.get(r.userId) || 'Unknown',
        createdAt: r.createdAt,
        ageHours: r.createdAt ? Math.round((Date.now() - r.createdAt.getTime()) / (1000 * 60 * 60)) : 0,
        bucket: ageBucket(r.createdAt as any),
      })),
      ...pendingAttendance.map(r => ({
        id: `attendance-${r.id}`,
        type: r.isLate ? 'late_arrival' as const : 'attendance_correction' as const,
        label: r.isLate ? 'Late arrival' : (r.reason || 'Attendance correction'),
        userId: r.userId,
        userName: nameById.get(r.userId) || 'Unknown',
        createdAt: r.createdAt,
        ageHours: r.createdAt ? Math.round((Date.now() - r.createdAt.getTime()) / (1000 * 60 * 60)) : 0,
        bucket: ageBucket(r.createdAt as any),
      })),
    ].sort((a, b) => b.ageHours - a.ageHours);

    const summary = {
      total: items.length,
      breached: items.filter(i => i.bucket === 'breached').length,
      warning: items.filter(i => i.bucket === 'warning').length,
      ok: items.filter(i => i.bucket === 'ok').length,
    };

    res.json({ summary, items, thresholds: { warnHours: WARN_HOURS, breachHours: BREACH_HOURS } });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load SLA dashboard' });
  }
});
