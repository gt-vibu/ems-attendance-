import { Router } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege, getScopedBranchIds } from '../auth/rbac';
import { logToAuditLedger } from '../services/audit';
import { notifyUser } from '../services/notifications';

export const router = Router();

// Dated, TEMPORARY shift overrides for a single employee — additive
// alongside the existing PUT /api/tenant/employees/:id shiftId path (which
// remains the way to change a PERMANENT shift). Gated by the same
// 'shift.manage' privilege shift.routes.ts already uses for shift template
// management, since this is also shift-related administration.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function formatDateRange(startDate: string, endDate: string): string {
  return startDate === endDate ? `on ${startDate}` : `from ${startDate} to ${endDate}`;
}

async function loadScopedEmployee(req: any, res: any): Promise<any | null> {
  const employeeId = parseInt(req.params.id, 10);
  const tenantId = req.user.tenantId;

  const userRows = await db.select().from(schema.users).where(eq(schema.users.id, employeeId)).limit(1);
  if (userRows.length === 0) {
    res.status(404).json({ error: 'Employee not found.' });
    return null;
  }
  const employee = userRows[0];
  if (employee.tenantId !== tenantId) {
    res.status(403).json({ error: "Access denied: This employee belongs to another organization." });
    return null;
  }
  const scopedBranchIds = await getScopedBranchIds(req.user);
  if (scopedBranchIds !== null && employee.branchId && !scopedBranchIds.includes(employee.branchId)) {
    res.status(403).json({ error: "Access denied: You are not scoped to this employee's branch." });
    return null;
  }
  return employee;
}

// CREATE a temporary shift override
router.post('/api/tenant/employees/:id/shift-override', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'shift.manage')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }

    const employee = await loadScopedEmployee(req, res);
    if (!employee) return;

    const { shiftId, startDate, endDate, reason } = req.body;
    if (!shiftId || !startDate || !endDate) {
      return res.status(400).json({ error: 'shiftId, startDate, and endDate are required.' });
    }
    if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
      return res.status(400).json({ error: 'startDate and endDate must be YYYY-MM-DD.' });
    }
    if (startDate > endDate) {
      return res.status(400).json({ error: 'startDate cannot be after endDate.' });
    }

    const shiftRows = await db.select().from(schema.shifts).where(eq(schema.shifts.id, shiftId)).limit(1);
    if (shiftRows.length === 0 || shiftRows[0].tenantId !== req.user.tenantId) {
      return res.status(400).json({ error: 'Invalid shift ID.' });
    }
    const shift = shiftRows[0];

    const [inserted] = await db.insert(schema.shiftOverrides).values({
      tenantId: req.user.tenantId,
      userId: employee.id,
      shiftId,
      startDate,
      endDate,
      reason: reason || null,
      createdBy: req.user.userId,
    }).returning();

    await logToAuditLedger({
      tenantId: req.user.tenantId,
      actorId: req.user.userId,
      actorName: req.user.name,
      action: 'SHIFT_OVERRIDE_CREATED',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
      details: { employeeId: employee.id, overrideId: inserted.id, shiftId, startDate, endDate },
    });

    await notifyUser(
      employee.id,
      'Your shift has been temporarily changed',
      `Your shift has been temporarily changed to ${shift.name} ${formatDateRange(startDate, endDate)}.`
    );

    res.json({ success: true, override: inserted });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// LIST an employee's override history (past + upcoming) — viewable by
// whoever holds 'shift.manage', or by the employee themselves for their own id.
router.get('/api/tenant/employees/:id/shift-overrides', authenticate, async (req: any, res: any) => {
  try {
    const employeeId = parseInt(req.params.id, 10);
    const isSelf = req.user.userId === employeeId;
    if (!isSelf && !await hasPrivilege(req.user, 'shift.manage')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }

    const employee = await loadScopedEmployee(req, res);
    if (!employee) return;

    const overrides = await db.select().from(schema.shiftOverrides)
      .where(and(eq(schema.shiftOverrides.tenantId, req.user.tenantId), eq(schema.shiftOverrides.userId, employeeId)))
      .orderBy(desc(schema.shiftOverrides.startDate));

    const shiftIds = [...new Set(overrides.map((o: any) => o.shiftId))];
    const shiftsList = shiftIds.length > 0
      ? await db.select().from(schema.shifts).where(eq(schema.shifts.tenantId, req.user.tenantId))
      : [];
    const shiftMap = new Map<number, any>(shiftsList.map((s: any) => [s.id, s]));
    const todayDateStr = new Date().toISOString().slice(0, 10);

    res.json({
      overrides: overrides.map((o: any) => ({
        id: o.id,
        shiftId: o.shiftId,
        shiftName: shiftMap.get(o.shiftId)?.name || '',
        startDate: o.startDate,
        endDate: o.endDate,
        reason: o.reason || '',
        createdBy: o.createdBy,
        createdAt: o.createdAt,
        status: o.endDate < todayDateStr ? 'past' : (o.startDate > todayDateStr ? 'upcoming' : 'active'),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// CANCEL a not-yet-expired override (admin made a mistake) — reverts the
// employee to whatever shift would otherwise apply (another override, or
// their permanent shift) for the remaining dates.
router.delete('/api/tenant/employees/:id/shift-overrides/:overrideId', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'shift.manage')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }

    const employee = await loadScopedEmployee(req, res);
    if (!employee) return;

    const overrideId = parseInt(req.params.overrideId, 10);
    const overrideRows = await db.select().from(schema.shiftOverrides).where(eq(schema.shiftOverrides.id, overrideId)).limit(1);
    if (overrideRows.length === 0 || overrideRows[0].tenantId !== req.user.tenantId || overrideRows[0].userId !== employee.id) {
      return res.status(404).json({ error: 'Shift override not found.' });
    }
    const override = overrideRows[0];

    const todayDateStr = new Date().toISOString().slice(0, 10);
    if (override.endDate < todayDateStr) {
      return res.status(400).json({ error: 'This override has already expired and cannot be cancelled.' });
    }

    const shiftRows = await db.select().from(schema.shifts).where(eq(schema.shifts.id, override.shiftId)).limit(1);
    const shiftName = shiftRows[0]?.name || 'the assigned shift';

    await db.delete(schema.shiftOverrides).where(eq(schema.shiftOverrides.id, overrideId));

    await logToAuditLedger({
      tenantId: req.user.tenantId,
      actorId: req.user.userId,
      actorName: req.user.name,
      action: 'SHIFT_OVERRIDE_CANCELLED',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
      details: { employeeId: employee.id, overrideId, shiftId: override.shiftId, startDate: override.startDate, endDate: override.endDate },
    });

    await notifyUser(
      employee.id,
      'Your temporary shift change was cancelled',
      `Your temporary shift change to ${shiftName} ${formatDateRange(override.startDate, override.endDate)} has been cancelled. Your regular shift applies again.`
    );

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
