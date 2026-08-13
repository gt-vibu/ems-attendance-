import { Router } from 'express';
import { eq, and, gt, asc, inArray } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { sendServerError } from '../../utils/errors';
import { authenticateFederation, requireFederationScope, resolveFederationTenantContext } from '../../middleware/federationAuth';
import { federationLimiter } from '../../middleware/rateLimit';
import { requireIdempotencyKey } from '../../middleware/federationIdempotency';
import { resolveInternalId, resolveExternalId } from '../../services/federation/externalId';
import { resolveBranchFilter, validateEmployeeBranchMembership } from '../../services/federation/branchScope';

// Leave events aren't branch-scoped by their own nature, but BlizBooks
// still needs externalBranchId in the envelope for outlet routing — this
// resolves it from whichever branch the affected employee is currently
// assigned to, same source the attendance/employee routes already use.
async function employeeExternalBranchId(tenantId: number, userId: number): Promise<string | null> {
  const row = (await db.select({ branchId: schema.users.branchId }).from(schema.users).where(eq(schema.users.id, userId)).limit(1))[0];
  return row?.branchId ? resolveExternalId(tenantId, 'branch', row.branchId) : null;
}
import { writeOutboxEvent } from '../../services/federation/outbox';
import { encodeCursor, decodeCursor, hashFilters, resolveLimit } from '../../utils/federationCursor';
import { computeLeaveBalancesForUser } from '../leave.routes';
import { computeLeaveDays, parseDateOnly } from '../leavePayrollShared';

export const router = Router();
router.use('/v1/federation/leave', authenticateFederation, federationLimiter, requireFederationScope('leave'));

router.get('/v1/federation/leave/types', resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const rows = await db.select().from(schema.leavePolicies).where(eq(schema.leavePolicies.tenantId, req.federation.tenantId));
    res.json({
      types: rows.map((p: any) => ({
        code: p.code, name: p.name, maxDaysPerYear: p.maxDaysPerYear, allowHalfDay: p.allowHalfDay,
        requiresApproval: p.requiresApproval, medicalOnlyNoAdvanceNoticeDays: p.medicalOnlyNoAdvanceNoticeDays,
        defaultDeductionPercent: p.defaultDeductionPercent, accrualEnabled: p.accrualEnabled,
        carryForwardEnabled: p.carryForwardEnabled, maxCarryForwardDays: p.maxCarryForwardDays,
        encashmentEnabled: p.encashmentEnabled,
      })),
    });
  } catch (err: any) {
    sendServerError(res, err, 'federation/leave.routes.ts');
  }
});

// Hotel-side policy configuration remains protected twice: the federation
// client needs the leave scope here, and BlizBooks requires its dedicated
// hr.leaves.configure permission before this route is called. The external
// actor is mandatory so every policy write is attributable to a real person,
// never only to a machine credential.
router.put('/v1/federation/leave/types/:code', requireIdempotencyKey, resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const code = String(req.params.code || '').trim().toUpperCase();
    const {
      name,
      maxDaysPerYear,
      allowHalfDay,
      requiresApproval,
      medicalOnlyNoAdvanceNoticeDays,
      defaultDeductionPercent,
      accrualEnabled,
      carryForwardEnabled,
      maxCarryForwardDays,
      encashmentEnabled,
      requestedByExternalUserId,
    } = req.body || {};

    if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(code)) {
      return res.status(422).json({ error: 'code must contain 2-32 letters, numbers, underscores, or hyphens.' });
    }
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
      return res.status(422).json({ error: 'name must contain 2-80 characters.' });
    }
    if (!requestedByExternalUserId) {
      return res.status(422).json({ error: 'requestedByExternalUserId is required.' });
    }
    const actorUserId = await resolveInternalId(tenantId, 'employee', String(requestedByExternalUserId));
    if (actorUserId === null) return res.status(404).json({ error: 'Unknown requestedByExternalUserId.' });

    const numberWithin = (value: unknown, min: number, max: number, fallback: number) => {
      if (value === undefined || value === null || value === '') return fallback;
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric >= min && numeric <= max ? numeric : null;
    };
    const annualDays = numberWithin(maxDaysPerYear, 0, 366, 12);
    const medicalDays = numberWithin(medicalOnlyNoAdvanceNoticeDays, 0, 366, 0);
    const deduction = numberWithin(defaultDeductionPercent, 0, 100, 100);
    const carryDays = numberWithin(maxCarryForwardDays, 0, 366, 0);
    if ([annualDays, medicalDays, deduction, carryDays].some((value) => value === null)) {
      return res.status(422).json({ error: 'One or more numeric policy values are outside the allowed range.' });
    }

    const values = {
      tenantId,
      name: name.trim(),
      code,
      maxDaysPerYear: annualDays!,
      allowHalfDay: allowHalfDay !== false,
      requiresApproval: requiresApproval !== false,
      medicalOnlyNoAdvanceNoticeDays: medicalDays!,
      defaultDeductionPercent: deduction!,
      accrualEnabled: accrualEnabled === true,
      carryForwardEnabled: carryForwardEnabled === true,
      maxCarryForwardDays: carryDays!,
      encashmentEnabled: encashmentEnabled === true,
    };
    const existing = (await db.select().from(schema.leavePolicies).where(and(
      eq(schema.leavePolicies.tenantId, tenantId),
      eq(schema.leavePolicies.code, code),
    )).limit(1))[0];

    const saved = await db.transaction(async (tx: any) => {
      const [policy] = existing
        ? await tx.update(schema.leavePolicies).set(values).where(eq(schema.leavePolicies.id, existing.id)).returning()
        : await tx.insert(schema.leavePolicies).values(values).returning();
      await writeOutboxEvent({
        tenantId,
        eventType: existing ? 'leave.policy.updated' : 'leave.policy.created',
        aggregateType: 'leave_policy',
        aggregateId: String(policy.id),
        data: { code, name: policy.name, requestedByExternalUserId, requestedByUserId: actorUserId },
      }, tx);
      return policy;
    });

    res.json({
      code: saved.code,
      name: saved.name,
      maxDaysPerYear: saved.maxDaysPerYear,
      allowHalfDay: saved.allowHalfDay,
      requiresApproval: saved.requiresApproval,
      medicalOnlyNoAdvanceNoticeDays: saved.medicalOnlyNoAdvanceNoticeDays,
      defaultDeductionPercent: saved.defaultDeductionPercent,
      accrualEnabled: saved.accrualEnabled,
      carryForwardEnabled: saved.carryForwardEnabled,
      maxCarryForwardDays: saved.maxCarryForwardDays,
      encashmentEnabled: saved.encashmentEnabled,
    });
  } catch (err: any) {
    sendServerError(res, err, 'federation/leave.routes.ts');
  }
});

router.get('/v1/federation/leave/balances', resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const { externalEmployeeId, externalBranchId } = req.query;
    if (!externalEmployeeId) return res.status(422).json({ error: 'externalEmployeeId is required.' });
    const userId = await resolveInternalId(tenantId, 'employee', String(externalEmployeeId));
    if (userId === null) return res.status(404).json({ error: 'Unknown externalEmployeeId.' });
    if (!(await validateEmployeeBranchMembership(tenantId, userId, externalBranchId ? String(externalBranchId) : null, res))) return;

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

router.get('/v1/federation/leave/requests', resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const filters = { externalEmployeeId: req.query.externalEmployeeId || null, status: req.query.status || null, externalBranchId: req.query.externalBranchId || null };
    const limit = resolveLimit(req.query.limit);

    const conditions = [eq(schema.leaveRequests.tenantId, tenantId)];
    if (filters.externalEmployeeId) {
      const userId = await resolveInternalId(tenantId, 'employee', String(filters.externalEmployeeId));
      if (userId === null) return res.json({ requests: [], nextCursor: null });
      // Both filters given at once: the employee must actually belong to
      // the named branch, otherwise a caller could bypass branch scoping
      // entirely by supplying an out-of-branch externalEmployeeId.
      if (!(await validateEmployeeBranchMembership(tenantId, userId, filters.externalBranchId, res))) return;
      conditions.push(eq(schema.leaveRequests.userId, userId));
    } else if (filters.externalBranchId) {
      const branchFilter = await resolveBranchFilter(tenantId, filters.externalBranchId, res);
      if (branchFilter === null) return; // resolveBranchFilter already sent the 404
      if (branchFilter) {
        if (branchFilter.employeeIds.length === 0) return res.json({ requests: [], nextCursor: null });
        conditions.push(inArray(schema.leaveRequests.userId, branchFilter.employeeIds));
      }
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

router.post('/v1/federation/leave/requests', requireIdempotencyKey, resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const { externalEmployeeId, leaveType, startDate, endDate, reason, externalBranchId: requestedBranchId } = req.body || {};
    if (!externalEmployeeId || !leaveType || !startDate || !endDate) {
      return res.status(422).json({ error: 'externalEmployeeId, leaveType, startDate, and endDate are required.' });
    }
    if (parseDateOnly(endDate).getTime() < parseDateOnly(startDate).getTime()) {
      return res.status(422).json({ error: 'endDate cannot be before startDate.' });
    }

    const userId = await resolveInternalId(tenantId, 'employee', externalEmployeeId);
    if (userId === null) return res.status(404).json({ error: 'Unknown externalEmployeeId.' });
    if (!(await validateEmployeeBranchMembership(tenantId, userId, requestedBranchId, res))) return;

    const policyRows = await db.select().from(schema.leavePolicies).where(and(eq(schema.leavePolicies.tenantId, tenantId), eq(schema.leavePolicies.code, leaveType))).limit(1);
    const policy = policyRows[0] || null;

    const { balances } = await computeLeaveBalancesForUser(userId, tenantId);
    const balanceBefore = balances.find((b: any) => b.code === leaveType)?.remainingDays ?? null;

    const totalDays = computeLeaveDays(startDate, endDate, false);
    const externalBranchId = await employeeExternalBranchId(tenantId, userId);
    const inserted = await db.transaction(async (tx: any) => {
      const [ins] = await tx.insert(schema.leaveRequests).values({
        tenantId, userId, policyId: policy?.id, leaveType, startDate, endDate, totalDays,
        reason: reason || 'Submitted via SmartTeams Federation API',
        status: policy?.requiresApproval === false ? 'approved' : 'pending',
      }).returning();

      await writeOutboxEvent({
        tenantId, eventType: 'leave.requested', aggregateType: 'leave_request', aggregateId: String(ins.id),
        businessDate: startDate, externalBranchId, data: { externalEmployeeId, requestId: String(ins.id), leaveType, startDate, endDate, status: ins.status },
      }, tx);
      return ins;
    });

    res.json({ requestId: String(inserted.id), status: inserted.status, version: 1, balanceBefore, balanceAfter: balanceBefore != null ? balanceBefore - totalDays : null });
  } catch (err: any) {
    sendServerError(res, err, 'federation/leave.routes.ts');
  }
});

router.post('/v1/federation/leave/requests/:id/cancel', requireIdempotencyKey, resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const requestId = Number(req.params.id);
    const { externalBranchId: requestedBranchId } = req.body || {};
    const rows = await db.select().from(schema.leaveRequests).where(and(eq(schema.leaveRequests.id, requestId), eq(schema.leaveRequests.tenantId, tenantId))).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Leave request not found.' });
    if (!['pending', 'approved'].includes(rows[0].status)) return res.status(400).json({ error: 'This request can no longer be cancelled.' });
    if (!(await validateEmployeeBranchMembership(tenantId, rows[0].userId, requestedBranchId, res))) return;

    const externalBranchId = await employeeExternalBranchId(tenantId, rows[0].userId);
    const updated = await db.transaction(async (tx: any) => {
      const [upd] = await tx.update(schema.leaveRequests).set({ status: 'cancelled' }).where(eq(schema.leaveRequests.id, requestId)).returning();
      await writeOutboxEvent({
        tenantId, eventType: 'leave.cancelled', aggregateType: 'leave_request', aggregateId: String(requestId),
        externalBranchId, data: { requestId: String(requestId), status: upd.status },
      }, tx);
      return upd;
    });

    res.json({ requestId: String(requestId), status: updated.status });
  } catch (err: any) {
    sendServerError(res, err, 'federation/leave.routes.ts');
  }
});

router.post('/v1/federation/leave/requests/:id/decision', requireIdempotencyKey, resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const requestId = Number(req.params.id);
    const { action, comment, expectedVersion, decidedByExternalUserId, externalBranchId: requestedBranchId } = req.body || {};
    if (!['approve', 'reject'].includes(action)) return res.status(422).json({ error: 'action must be approve or reject.' });
    if (!Number.isInteger(expectedVersion)) return res.status(422).json({ error: 'expectedVersion (integer) is required.' });
    if (!decidedByExternalUserId) return res.status(422).json({ error: 'decidedByExternalUserId is required.' });

    const rows = await db.select().from(schema.leaveRequests).where(and(eq(schema.leaveRequests.id, requestId), eq(schema.leaveRequests.tenantId, tenantId))).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Leave request not found.' });
    const reviewerId = await resolveInternalId(tenantId, 'employee', String(decidedByExternalUserId));
    if (reviewerId === null) return res.status(404).json({ error: 'Unknown decidedByExternalUserId.' });
    if (reviewerId === rows[0].userId) return res.status(403).json({ error: 'Employees cannot decide their own leave request.' });
    if (rows[0].status !== 'pending') {
      // A non-pending request means a decision was already made — from the
      // federation client's point of view (which sent an expectedVersion
      // presuming it was still pending) this is exactly a stale write.
      return res.status(409).json({ error: 'This request has already been decided.', code: 'STALE_RESOURCE_VERSION' });
    }
    if (!(await validateEmployeeBranchMembership(tenantId, rows[0].userId, requestedBranchId, res))) return;

    const externalBranchId = await employeeExternalBranchId(tenantId, rows[0].userId);
    const updated = await db.transaction(async (tx: any) => {
      const [upd] = await tx.update(schema.leaveRequests).set({
        status: action === 'approve' ? 'approved' : 'rejected', reviewerComment: comment || null, reviewedAt: new Date(), reviewedByUserId: reviewerId,
      }).where(eq(schema.leaveRequests.id, requestId)).returning();

      await writeOutboxEvent({
        tenantId, eventType: action === 'approve' ? 'leave.approved' : 'leave.rejected', aggregateType: 'leave_request', aggregateId: String(requestId),
        externalBranchId, data: { requestId: String(requestId), status: upd.status, comment: comment || null },
      }, tx);
      return upd;
    });

    res.json({ requestId: String(requestId), status: updated.status, version: (expectedVersion as number) + 1 });
  } catch (err: any) {
    sendServerError(res, err, 'federation/leave.routes.ts');
  }
});

router.post('/v1/federation/leave/balances/adjustments', requireIdempotencyKey, resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const { externalEmployeeId, leaveType, adjustmentDays, reason, requestedByExternalUserId, externalBranchId: requestedBranchId } = req.body || {};
    if (!externalEmployeeId || !leaveType || adjustmentDays == null || !reason || !requestedByExternalUserId) {
      return res.status(422).json({ error: 'externalEmployeeId, leaveType, adjustmentDays, reason, and requestedByExternalUserId are required.' });
    }
    const userId = await resolveInternalId(tenantId, 'employee', externalEmployeeId);
    if (userId === null) return res.status(404).json({ error: 'Unknown externalEmployeeId.' });
    if (!(await validateEmployeeBranchMembership(tenantId, userId, requestedBranchId, res))) return;
    // adjustedByUserId is NOT NULL on this table — the business initiator
    // (requestedByExternalUserId) is who gets recorded, never the machine
    // credential itself, matching the plan's audit-actor rule. Falls back
    // to the target employee's own id only if that actor hasn't been
    // provisioned as an employee here yet, so the write is never blocked
    // on a DB constraint.
    const actorUserId = (await resolveInternalId(tenantId, 'employee', requestedByExternalUserId)) ?? userId;

    const externalBranchId = await employeeExternalBranchId(tenantId, userId);
    const adjustment = await db.transaction(async (tx: any) => {
      const [adj] = await tx.insert(schema.leaveBalanceAdjustments).values({
        tenantId, userId, leaveType, adjustmentDays: Number(adjustmentDays), reason, adjustedByUserId: actorUserId,
      }).returning();

      const { balances } = await computeLeaveBalancesForUser(userId, tenantId);
      const newBalance = balances.find((b: any) => b.code === leaveType)?.remainingDays ?? null;

      await writeOutboxEvent({
        tenantId, eventType: 'leave.balance.changed', aggregateType: 'leave_balance_adjustment', aggregateId: String(adj.id),
        externalBranchId, data: { externalEmployeeId, leaveType, adjustmentDays: Number(adjustmentDays), newBalance },
      }, tx);
      return adj;
    });

    const { balances: postBalances } = await computeLeaveBalancesForUser(userId, tenantId);
    const newBalance = postBalances.find((b: any) => b.code === leaveType)?.remainingDays ?? null;

    res.json({ adjustmentId: String(adjustment.id), newBalance });
  } catch (err: any) {
    sendServerError(res, err, 'federation/leave.routes.ts');
  }
});
