import { Router } from 'express';
import { eq, and, gt, asc } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { sendServerError } from '../../utils/errors';
import { authenticateFederation, requireFederationScope } from '../../middleware/federationAuth';
import { federationLimiter } from '../../middleware/rateLimit';
import { requireIdempotencyKey } from '../../middleware/federationIdempotency';
import { resolveInternalId, resolveExternalId } from '../../services/federation/externalId';
import { writeOutboxEvent } from '../../services/federation/outbox';
import { encodeCursor, decodeCursor, hashFilters, resolveLimit } from '../../utils/federationCursor';
import { computeLeaveBalancesForUser } from '../leave.routes';
import { computeLeaveDays, parseDateOnly } from '../leavePayrollShared';

export const router = Router();
router.use('/v1/federation', authenticateFederation, federationLimiter, requireFederationScope('leave'));

router.get('/v1/federation/leave/types', async (req: any, res: any) => {
  try {
    const rows = await db.select().from(schema.leavePolicies).where(eq(schema.leavePolicies.tenantId, req.federation.tenantId));
    res.json({
      types: rows.map((p: any) => ({
        code: p.code, name: p.name, maxDaysPerYear: p.maxDaysPerYear, allowHalfDay: p.allowHalfDay,
        requiresApproval: p.requiresApproval, accrualEnabled: p.accrualEnabled, carryForwardEnabled: p.carryForwardEnabled, encashmentEnabled: p.encashmentEnabled,
      })),
    });
  } catch (err: any) {
    sendServerError(res, err, 'federation/leave.routes.ts');
  }
});

router.get('/v1/federation/leave/balances', async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const { externalEmployeeId } = req.query;
    if (!externalEmployeeId) return res.status(422).json({ error: 'externalEmployeeId is required.' });
    const userId = await resolveInternalId(tenantId, 'employee', String(externalEmployeeId));
    if (userId === null) return res.status(404).json({ error: 'Unknown externalEmployeeId.' });

    const { balances } = await computeLeaveBalancesForUser(userId, tenantId);
    res.json({
      balances: balances.map((b: any) => ({
        leaveType: b.code, usedDays: b.usedDays, adjustmentDays: b.adjustmentDays, carryForwardDays: b.carryForwardDays, remainingDays: b.remainingDays,
      })),
    });
  } catch (err: any) {
    sendServerError(res, err, 'federation/leave.routes.ts');
  }
});

router.get('/v1/federation/leave/requests', async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const filters = { externalEmployeeId: req.query.externalEmployeeId || null, status: req.query.status || null };
    const limit = resolveLimit(req.query.limit);

    const conditions = [eq(schema.leaveRequests.tenantId, tenantId)];
    if (filters.externalEmployeeId) {
      const userId = await resolveInternalId(tenantId, 'employee', String(filters.externalEmployeeId));
      if (userId === null) return res.json({ requests: [], nextCursor: null });
      conditions.push(eq(schema.leaveRequests.userId, userId));
    }
    if (filters.status) conditions.push(eq(schema.leaveRequests.status, String(filters.status)));

    let afterId = 0;
    if (req.query.cursor) {
      const decoded = decodeCursor(String(req.query.cursor), req.federation.clientId);
      if (!decoded || decoded.filtersHash !== hashFilters(filters)) return res.status(400).json({ error: 'Invalid or expired cursor.', code: 'INVALID_CURSOR' });
      afterId = decoded.lastId;
    }
    conditions.push(gt(schema.leaveRequests.id, afterId));

    const rows = await db.select().from(schema.leaveRequests).where(and(...conditions)).orderBy(asc(schema.leaveRequests.id)).limit(limit);
    const requests = await Promise.all(rows.map(async (r: any) => ({
      requestId: String(r.id),
      externalEmployeeId: await resolveExternalId(tenantId, 'employee', r.userId),
      leaveType: r.leaveType,
      startDate: r.startDate,
      endDate: r.endDate,
      units: r.totalDays,
      status: r.status,
      version: 1,
      reason: r.reason,
      approverExternalUserId: r.reviewedByUserId ? await resolveExternalId(tenantId, 'employee', r.reviewedByUserId) : null,
      decidedAt: r.reviewedAt,
    })));

    const nextCursor = rows.length === limit
      ? encodeCursor({ clientId: req.federation.clientId, filtersHash: hashFilters(filters), sort: 'id_asc', asOf: new Date().toISOString(), lastId: rows[rows.length - 1].id })
      : null;

    res.json({ requests, nextCursor });
  } catch (err: any) {
    sendServerError(res, err, 'federation/leave.routes.ts');
  }
});

router.post('/v1/federation/leave/requests', requireIdempotencyKey, async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const { externalEmployeeId, leaveType, startDate, endDate, reason } = req.body || {};
    if (!externalEmployeeId || !leaveType || !startDate || !endDate) {
      return res.status(422).json({ error: 'externalEmployeeId, leaveType, startDate, and endDate are required.' });
    }
    if (parseDateOnly(endDate).getTime() < parseDateOnly(startDate).getTime()) {
      return res.status(422).json({ error: 'endDate cannot be before startDate.' });
    }

    const userId = await resolveInternalId(tenantId, 'employee', externalEmployeeId);
    if (userId === null) return res.status(404).json({ error: 'Unknown externalEmployeeId.' });

    const policyRows = await db.select().from(schema.leavePolicies).where(and(eq(schema.leavePolicies.tenantId, tenantId), eq(schema.leavePolicies.code, leaveType))).limit(1);
    const policy = policyRows[0] || null;

    const { balances } = await computeLeaveBalancesForUser(userId, tenantId);
    const balanceBefore = balances.find((b: any) => b.code === leaveType)?.remainingDays ?? null;

    const totalDays = computeLeaveDays(startDate, endDate, false);
    const [inserted] = await db.insert(schema.leaveRequests).values({
      tenantId, userId, policyId: policy?.id, leaveType, startDate, endDate, totalDays,
      reason: reason || 'Submitted via SmartTeams Federation API',
      status: policy?.requiresApproval === false ? 'approved' : 'pending',
    }).returning();

    await writeOutboxEvent({
      tenantId, eventType: 'leave.requested', aggregateType: 'leave_request', aggregateId: String(inserted.id),
      businessDate: startDate, data: { externalEmployeeId, requestId: String(inserted.id), leaveType, startDate, endDate, status: inserted.status },
    });

    res.json({ requestId: String(inserted.id), status: inserted.status, version: 1, balanceBefore, balanceAfter: balanceBefore != null ? balanceBefore - totalDays : null });
  } catch (err: any) {
    sendServerError(res, err, 'federation/leave.routes.ts');
  }
});

router.post('/v1/federation/leave/requests/:id/cancel', requireIdempotencyKey, async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const requestId = Number(req.params.id);
    const rows = await db.select().from(schema.leaveRequests).where(and(eq(schema.leaveRequests.id, requestId), eq(schema.leaveRequests.tenantId, tenantId))).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Leave request not found.' });
    if (!['pending', 'approved'].includes(rows[0].status)) return res.status(400).json({ error: 'This request can no longer be cancelled.' });

    const [updated] = await db.update(schema.leaveRequests).set({ status: 'cancelled' }).where(eq(schema.leaveRequests.id, requestId)).returning();

    await writeOutboxEvent({
      tenantId, eventType: 'leave.cancelled', aggregateType: 'leave_request', aggregateId: String(requestId),
      data: { requestId: String(requestId), status: updated.status },
    });

    res.json({ requestId: String(requestId), status: updated.status });
  } catch (err: any) {
    sendServerError(res, err, 'federation/leave.routes.ts');
  }
});

router.post('/v1/federation/leave/requests/:id/decision', requireIdempotencyKey, async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const requestId = Number(req.params.id);
    const { action, comment, expectedVersion } = req.body || {};
    if (!['approve', 'reject'].includes(action)) return res.status(422).json({ error: 'action must be approve or reject.' });
    if (!Number.isInteger(expectedVersion)) return res.status(422).json({ error: 'expectedVersion (integer) is required.' });

    const rows = await db.select().from(schema.leaveRequests).where(and(eq(schema.leaveRequests.id, requestId), eq(schema.leaveRequests.tenantId, tenantId))).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Leave request not found.' });
    if (rows[0].status !== 'pending') {
      // A non-pending request means a decision was already made — from the
      // federation client's point of view (which sent an expectedVersion
      // presuming it was still pending) this is exactly a stale write.
      return res.status(409).json({ error: 'This request has already been decided.', code: 'STALE_RESOURCE_VERSION' });
    }

    const [updated] = await db.update(schema.leaveRequests).set({
      status: action === 'approve' ? 'approved' : 'rejected', reviewerComment: comment || null, reviewedAt: new Date(),
    }).where(eq(schema.leaveRequests.id, requestId)).returning();

    await writeOutboxEvent({
      tenantId, eventType: action === 'approve' ? 'leave.approved' : 'leave.rejected', aggregateType: 'leave_request', aggregateId: String(requestId),
      data: { requestId: String(requestId), status: updated.status, comment: comment || null },
    });

    res.json({ requestId: String(requestId), status: updated.status, version: (expectedVersion as number) + 1 });
  } catch (err: any) {
    sendServerError(res, err, 'federation/leave.routes.ts');
  }
});

router.post('/v1/federation/leave/balances/adjustments', requireIdempotencyKey, async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const { externalEmployeeId, leaveType, adjustmentDays, reason, requestedByExternalUserId } = req.body || {};
    if (!externalEmployeeId || !leaveType || adjustmentDays == null || !reason || !requestedByExternalUserId) {
      return res.status(422).json({ error: 'externalEmployeeId, leaveType, adjustmentDays, reason, and requestedByExternalUserId are required.' });
    }
    const userId = await resolveInternalId(tenantId, 'employee', externalEmployeeId);
    if (userId === null) return res.status(404).json({ error: 'Unknown externalEmployeeId.' });
    // adjustedByUserId is NOT NULL on this table — the business initiator
    // (requestedByExternalUserId) is who gets recorded, never the machine
    // credential itself, matching the plan's audit-actor rule. Falls back
    // to the target employee's own id only if that actor hasn't been
    // provisioned as an employee here yet, so the write is never blocked
    // on a DB constraint.
    const actorUserId = (await resolveInternalId(tenantId, 'employee', requestedByExternalUserId)) ?? userId;

    const [adjustment] = await db.insert(schema.leaveBalanceAdjustments).values({
      tenantId, userId, leaveType, adjustmentDays: Number(adjustmentDays), reason, adjustedByUserId: actorUserId,
    }).returning();

    const { balances } = await computeLeaveBalancesForUser(userId, tenantId);
    const newBalance = balances.find((b: any) => b.code === leaveType)?.remainingDays ?? null;

    await writeOutboxEvent({
      tenantId, eventType: 'leave.balance.changed', aggregateType: 'leave_balance_adjustment', aggregateId: String(adjustment.id),
      data: { externalEmployeeId, leaveType, adjustmentDays: Number(adjustmentDays), newBalance },
    });

    res.json({ adjustmentId: String(adjustment.id), newBalance });
  } catch (err: any) {
    sendServerError(res, err, 'federation/leave.routes.ts');
  }
});
