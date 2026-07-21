import { Router } from 'express';
import { eq, and, or, desc } from 'drizzle-orm';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege, getUsersWithPrivilege } from '../auth/rbac';
import { getEffectiveShiftId } from '../services/shiftOverrides';
import { logToAuditLedger } from '../services/audit';
import { notifyUser, notifyUsers } from '../services/notifications';
import { dispatchWebhookEvent } from '../services/webhooks';

export const router = Router();

// STEP 1 — requester proposes swapping their shift on a specific date with
// a colleague. Snapshots both people's effective shift for that date right
// away so the eventual approval step doesn't have to re-derive it (and so
// a later, unrelated shift change to either person doesn't retroactively
// change what this specific swap means).
router.post('/api/tenant/shift-swap', authenticate, async (req: any, res: any) => {
  try {
    const { targetUserId, swapDate, reason } = req.body || {};
    if (!targetUserId || !swapDate) {
      return res.status(400).json({ error: 'targetUserId and swapDate are required.' });
    }
    if (Number(targetUserId) === req.user.userId) {
      return res.status(400).json({ error: 'You cannot swap a shift with yourself.' });
    }

    const tenantId = req.user.tenantId;
    const targetRows = await db.select().from(schema.users).where(eq(schema.users.id, Number(targetUserId))).limit(1);
    if (targetRows.length === 0 || targetRows[0].tenantId !== tenantId) {
      return res.status(404).json({ error: 'Colleague not found.' });
    }
    const target = targetRows[0];

    const [requesterShiftId, targetShiftId] = await Promise.all([
      getEffectiveShiftId(tenantId, req.user.userId, swapDate),
      getEffectiveShiftId(tenantId, target.id, swapDate),
    ]);
    if (!requesterShiftId || !targetShiftId) {
      return res.status(400).json({ error: 'Both employees need an assigned shift on that date to swap.' });
    }
    if (requesterShiftId === targetShiftId) {
      return res.status(400).json({ error: 'You already have the same shift on that date — nothing to swap.' });
    }

    const [request] = await db.insert(schema.shiftSwapRequests).values({
      tenantId,
      requesterId: req.user.userId,
      targetUserId: target.id,
      swapDate,
      requesterShiftId,
      targetShiftId,
      reason: reason || null,
    }).returning();

    await notifyUser(target.id, 'Shift swap request', `${req.user.name} wants to swap shifts with you on ${swapDate}.`);

    res.json({ success: true, request });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Everything involving the caller — either side of the swap.
router.get('/api/tenant/shift-swap/mine', authenticate, async (req: any, res: any) => {
  try {
    const rows = await db.select().from(schema.shiftSwapRequests).where(
      and(
        eq(schema.shiftSwapRequests.tenantId, req.user.tenantId),
        or(eq(schema.shiftSwapRequests.requesterId, req.user.userId), eq(schema.shiftSwapRequests.targetUserId, req.user.userId))
      )
    ).orderBy(desc(schema.shiftSwapRequests.createdAt));

    const userIds = [...new Set(rows.flatMap((r) => [r.requesterId, r.targetUserId]))];
    const users = userIds.length > 0 ? await db.select().from(schema.users).where(eq(schema.users.tenantId, req.user.tenantId)) : [];
    const userById = new Map<number, any>(users.map((u: any) => [u.id, u]));
    const shifts = await db.select().from(schema.shifts).where(eq(schema.shifts.tenantId, req.user.tenantId));
    const shiftById = new Map<number, any>(shifts.map((s: any) => [s.id, s]));

    res.json({
      requests: rows.map((r) => ({
        ...r,
        requesterName: userById.get(r.requesterId)?.name || 'Unknown',
        targetName: userById.get(r.targetUserId)?.name || 'Unknown',
        requesterShiftName: r.requesterShiftId ? shiftById.get(r.requesterShiftId)?.name : null,
        targetShiftName: r.targetShiftId ? shiftById.get(r.targetShiftId)?.name : null,
        isRequester: r.requesterId === req.user.userId,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// STEP 2 — the named colleague accepts or declines. Only they can respond;
// a decline ends the request without ever reaching an approver.
router.post('/api/tenant/shift-swap/:id/respond', authenticate, async (req: any, res: any) => {
  try {
    const { action } = req.body || {};
    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ error: 'A valid action (accept|decline) is required.' });
    }
    const rows = await db.select().from(schema.shiftSwapRequests).where(eq(schema.shiftSwapRequests.id, Number(req.params.id))).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Shift swap request not found.' });
    const request = rows[0];
    if (request.tenantId !== req.user.tenantId || request.targetUserId !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    if (request.status !== 'pending_target') {
      return res.status(400).json({ error: 'This request has already moved past your response.' });
    }

    const nextStatus = action === 'accept' ? 'pending_approval' : 'declined';
    const [updated] = await db.update(schema.shiftSwapRequests).set({
      status: nextStatus,
      targetRespondedAt: new Date(),
    }).where(eq(schema.shiftSwapRequests.id, request.id)).returning();

    const requesterRows = await db.select().from(schema.users).where(eq(schema.users.id, request.requesterId)).limit(1);
    if (action === 'decline') {
      if (requesterRows.length > 0) {
        await notifyUser(requesterRows[0].id, 'Shift swap declined', `${req.user.name} declined your shift swap request for ${request.swapDate}.`);
      }
    } else {
      const approvers = await getUsersWithPrivilege(req.user.tenantId, 'shift.manage');
      await notifyUsers(approvers.map((a: any) => a.id), 'Shift swap awaiting approval', `${requesterRows[0]?.name || 'An employee'} and ${req.user.name} agreed to swap shifts on ${request.swapDate} — needs your approval.`);
    }

    res.json({ success: true, request: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// STEP 3 — approver queue (shift.manage, same privilege that already gates
// creating/editing shifts — shift assignment is a policy decision, not
// something to leave fully peer-to-peer).
router.get('/api/tenant/shift-swap/pending-approval', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'shift.manage')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const rows = await db.select().from(schema.shiftSwapRequests).where(
      and(eq(schema.shiftSwapRequests.tenantId, req.user.tenantId), eq(schema.shiftSwapRequests.status, 'pending_approval'))
    ).orderBy(desc(schema.shiftSwapRequests.createdAt));

    const userIds = [...new Set(rows.flatMap((r) => [r.requesterId, r.targetUserId]))];
    const users = userIds.length > 0 ? await db.select().from(schema.users).where(eq(schema.users.tenantId, req.user.tenantId)) : [];
    const userById = new Map<number, any>(users.map((u: any) => [u.id, u]));
    const shifts = await db.select().from(schema.shifts).where(eq(schema.shifts.tenantId, req.user.tenantId));
    const shiftById = new Map<number, any>(shifts.map((s: any) => [s.id, s]));

    res.json({
      requests: rows.map((r) => ({
        ...r,
        requesterName: userById.get(r.requesterId)?.name || 'Unknown',
        targetName: userById.get(r.targetUserId)?.name || 'Unknown',
        requesterShiftName: r.requesterShiftId ? shiftById.get(r.requesterShiftId)?.name : null,
        targetShiftName: r.targetShiftId ? shiftById.get(r.targetShiftId)?.name : null,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/tenant/shift-swap/:id/action', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'shift.manage')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const { action } = req.body || {};
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'A valid action (approve|reject) is required.' });
    }
    const rows = await db.select().from(schema.shiftSwapRequests).where(eq(schema.shiftSwapRequests.id, Number(req.params.id))).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Shift swap request not found.' });
    const request = rows[0];
    if (request.tenantId !== req.user.tenantId) return res.status(403).json({ error: 'Access denied.' });
    if (request.status !== 'pending_approval') return res.status(400).json({ error: 'This request is not awaiting approval.' });

    if (action === 'approve') {
      // Each person gets the OTHER person's original shift, for just that
      // one day — exactly what shiftOverrides already exists for.
      await db.insert(schema.shiftOverrides).values([
        { tenantId: request.tenantId, userId: request.requesterId, shiftId: request.targetShiftId!, startDate: request.swapDate, endDate: request.swapDate, reason: `Shift swap approved (request #${request.id})`, createdBy: req.user.userId },
        { tenantId: request.tenantId, userId: request.targetUserId, shiftId: request.requesterShiftId!, startDate: request.swapDate, endDate: request.swapDate, reason: `Shift swap approved (request #${request.id})`, createdBy: req.user.userId },
      ]);
    }

    const [updated] = await db.update(schema.shiftSwapRequests).set({
      status: action === 'approve' ? 'approved' : 'rejected',
      reviewedByUserId: req.user.userId,
      reviewedAt: new Date(),
    }).where(eq(schema.shiftSwapRequests.id, request.id)).returning();

    await logToAuditLedger({
      tenantId: request.tenantId, actorId: req.user.userId, actorName: req.user.name,
      action: action === 'approve' ? 'SHIFT_SWAP_APPROVED' : 'SHIFT_SWAP_REJECTED',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
      details: { requestId: request.id, requesterId: request.requesterId, targetUserId: request.targetUserId, swapDate: request.swapDate }
    });

    const message = action === 'approve'
      ? `Your shift swap for ${request.swapDate} was approved.`
      : `Your shift swap for ${request.swapDate} was rejected.`;
    await notifyUsers([request.requesterId, request.targetUserId], `Shift swap ${action === 'approve' ? 'approved' : 'rejected'}`, message);
    if (action === 'approve') {
      dispatchWebhookEvent(request.tenantId, 'shift.swap_approved', { requestId: request.id, requesterId: request.requesterId, targetUserId: request.targetUserId, swapDate: request.swapDate });
    }

    res.json({ success: true, request: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
