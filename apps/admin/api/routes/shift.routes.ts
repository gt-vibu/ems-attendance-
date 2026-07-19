import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege } from '../auth/rbac';
import { logToAuditLedger } from '../services/audit';

export const router = Router();

// Any authenticated tenant user can list a branch's shifts — needed for
// onboarding dropdowns (picking which shift a new hire belongs to).
router.get('/api/branches/:branchId/shifts', authenticate, async (req: any, res: any) => {
  try {
    const branchId = parseInt(req.params.branchId, 10);
    const branchRows = await db.select().from(schema.branches).where(eq(schema.branches.id, branchId));
    if (branchRows.length === 0) return res.status(404).json({ error: 'Branch not found' });
    if (branchRows[0].tenantId !== req.user.tenantId) {
      return res.status(403).json({ error: 'Access denied: This branch does not belong to your organization.' });
    }
    const shiftList = await db.select().from(schema.shifts)
      .where(and(eq(schema.shifts.branchId, branchId), eq(schema.shifts.status, 'active')));
    res.json({ shifts: shiftList });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/branches/:branchId/shifts', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'shift.manage')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const branchId = parseInt(req.params.branchId, 10);
    const branchRows = await db.select().from(schema.branches).where(eq(schema.branches.id, branchId));
    if (branchRows.length === 0) return res.status(404).json({ error: 'Branch not found' });
    if (branchRows[0].tenantId !== req.user.tenantId) {
      return res.status(403).json({ error: 'Access denied: This branch does not belong to your organization.' });
    }

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

    res.json({ success: true, shift });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/api/shifts/:id', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'shift.manage')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const shiftId = parseInt(req.params.id, 10);
    const shiftRows = await db.select().from(schema.shifts).where(eq(schema.shifts.id, shiftId));
    if (shiftRows.length === 0) return res.status(404).json({ error: 'Shift not found' });
    if (shiftRows[0].tenantId !== req.user.tenantId) {
      return res.status(403).json({ error: 'Access denied: This shift does not belong to your organization.' });
    }

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

    res.json({ success: true, shift: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
