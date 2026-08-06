import { Router } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db, schema } from '../../db';
import { sendServerError } from '../utils/errors';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege } from '../auth/rbac';
import { logToAuditLedger } from '../services/audit';

export const router = Router();

// Any authenticated tenant user can list a branch's shifts — needed for
// onboarding dropdowns (picking which shift a new hire belongs to).
router.get('/api/branches/:branchId/shifts', authenticate, async (req: any, res: any) => {
  try {
    const branchId = parseInt(req.params.branchId, 10);
    const branchRows = await db.select().from(schema.branches).where(and(eq(schema.branches.id, branchId), eq(schema.branches.tenantId, req.user.tenantId)));
    if (branchRows.length === 0) return res.status(404).json({ error: 'Branch not found' });
    const shiftList = await db.select().from(schema.shifts)
      .where(and(eq(schema.shifts.branchId, branchId), eq(schema.shifts.status, 'active')));
    res.json({ shifts: shiftList });
  } catch (err: any) {
    sendServerError(res, err, "shift.routes.ts");
  }
});

router.post('/api/branches/:branchId/shifts', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'shift.manage')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const branchId = parseInt(req.params.branchId, 10);
    const branchRows = await db.select().from(schema.branches).where(and(eq(schema.branches.id, branchId), eq(schema.branches.tenantId, req.user.tenantId)));
    if (branchRows.length === 0) return res.status(404).json({ error: 'Branch not found' });

    const { name, checkInTime, checkOutTime, gracePeriodMins } = req.body;
    if (!name || !checkInTime || !checkOutTime) {
      return res.status(400).json({ error: 'name, checkInTime, and checkOutTime are required' });
    }

    const [shift] = await db.insert(schema.shifts).values({
      tenantId: req.user.tenantId,
      branchId,
      name,
      checkInTime,
      checkOutTime,
      gracePeriodMins: gracePeriodMins ?? null,
    }).returning();

    await logToAuditLedger({
      tenantId: req.user.tenantId,
      actorId: req.user.userId,
      actorName: req.user.name,
      action: 'SHIFT_CREATED',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
      details: { shiftId: shift.id, branchId, name },
    });
    await db.insert(schema.shiftHistory).values({
      shiftId: shift.id, tenantId: req.user.tenantId, action: 'created',
      previous: null,
      next: { name: shift.name, checkInTime: shift.checkInTime, checkOutTime: shift.checkOutTime, gracePeriodMins: shift.gracePeriodMins, status: shift.status },
      actorUserId: req.user.userId, actorName: req.user.name,
    });

    res.json({ success: true, shift });
  } catch (err: any) {
    sendServerError(res, err, "shift.routes.ts");
  }
});

router.patch('/api/shifts/:id', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'shift.manage')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const shiftId = parseInt(req.params.id, 10);
    const shiftRows = await db.select().from(schema.shifts).where(and(eq(schema.shifts.id, shiftId), eq(schema.shifts.tenantId, req.user.tenantId)));
    if (shiftRows.length === 0) return res.status(404).json({ error: 'Shift not found' });

    const before = shiftRows[0];
    const update: any = {};
    for (const field of ['name', 'checkInTime', 'checkOutTime', 'gracePeriodMins', 'status']) {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    }

    const [updated] = await db.update(schema.shifts).set(update).where(eq(schema.shifts.id, shiftId)).returning();

    await logToAuditLedger({
      tenantId: req.user.tenantId,
      actorId: req.user.userId,
      actorName: req.user.name,
      action: 'SHIFT_UPDATED',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
      details: { shiftId, changes: update },
    });
    await db.insert(schema.shiftHistory).values({
      shiftId,
      tenantId: req.user.tenantId,
      action: update.status && update.status !== before.status ? (update.status === 'active' ? 'reactivated' : 'deactivated') : 'updated',
      previous: { name: before.name, checkInTime: before.checkInTime, checkOutTime: before.checkOutTime, gracePeriodMins: before.gracePeriodMins, status: before.status },
      next: { name: updated.name, checkInTime: updated.checkInTime, checkOutTime: updated.checkOutTime, gracePeriodMins: updated.gracePeriodMins, status: updated.status },
      actorUserId: req.user.userId, actorName: req.user.name,
    });

    res.json({ success: true, shift: updated });
  } catch (err: any) {
    sendServerError(res, err, "shift.routes.ts");
  }
});

router.get('/api/shifts/:id/history', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'shift.manage')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const shiftId = parseInt(req.params.id, 10);
    const shiftRows = await db.select().from(schema.shifts).where(and(eq(schema.shifts.id, shiftId), eq(schema.shifts.tenantId, req.user.tenantId)));
    if (shiftRows.length === 0) return res.status(404).json({ error: 'Shift not found' });
    const history = await db.select().from(schema.shiftHistory)
      .where(and(eq(schema.shiftHistory.shiftId, shiftId), eq(schema.shiftHistory.tenantId, req.user.tenantId)))
      .orderBy(desc(schema.shiftHistory.createdAt));
    res.json({ history });
  } catch (err: any) {
    sendServerError(res, err, "shift.routes.ts");
  }
});
