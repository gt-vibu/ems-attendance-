import { Router } from 'express';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { getScopedBranchIds, getUsersWithPrivilege, hasPrivilege } from '../auth/rbac';
import { STARTER_LEAVE_POLICIES } from '../auth/starterLeavePolicies';
import { sendLeaveApprovalRequestEmail, sendLeaveDecisionEmail } from '../../mail.js';
import { parseDateOnly, toDateOnly, computeLeaveDays, uniqueById, getOrCreatePayrollSettings, getEffectiveDailyRate } from './leavePayrollShared';
import { dispatchWebhookEvent } from '../services/webhooks';
import { notifyUser, notifyUsers } from '../services/notifications';
import { amendLeaveRequest } from '../services/recordEdits';

export const router = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

// Shared by /api/leave/mine (self-service) and the admin-facing
// per-employee lookup below — one leave-balance calculation, not two.
async function computeLeaveBalancesForUser(userId: number, tenantId: number) {
  const [policies, requests, adjustments] = await Promise.all([
    db.select().from(schema.leavePolicies).where(eq(schema.leavePolicies.tenantId, tenantId)).orderBy(schema.leavePolicies.name),
    db.select().from(schema.leaveRequests).where(eq(schema.leaveRequests.userId, userId)).orderBy(desc(schema.leaveRequests.createdAt)),
    db.select().from(schema.leaveBalanceAdjustments).where(eq(schema.leaveBalanceAdjustments.userId, userId)),
  ]);

  const now = new Date();
  const year = now.getUTCFullYear();
  // Months "unlocked" so far this year for accrual purposes — the 1st of
  // the current month counts as already accrued (Jan = 1, not 0), same
  // convention as most payroll/accrual engines.
  const monthsElapsed = now.getUTCMonth() + 1;

  // Approved days used, grouped by (year, leaveType) in one pass — used
  // both for this year's balance and, when carryForwardEnabled, last
  // year's ending balance. `requests` already covers every year for this
  // user (no date filter on the query above), so no extra fetch is needed.
  const approvedByYearType: Record<number, Record<string, number>> = {};
  for (const request of requests as any[]) {
    if (request.status !== 'approved') continue;
    const requestYear = parseDateOnly(request.startDate).getUTCFullYear();
    const bucket = approvedByYearType[requestYear] || (approvedByYearType[requestYear] = {});
    bucket[request.leaveType] = (bucket[request.leaveType] || 0) + Number(request.totalDays || 0);
  }
  const approvedByType = approvedByYearType[year] || {};
  const prevYearApprovedByType = approvedByYearType[year - 1] || {};

  const adjustmentsByType = adjustments.reduce((acc: Record<string, number>, adj: any) => {
    acc[adj.leaveType] = (acc[adj.leaveType] || 0) + Number(adj.adjustmentDays || 0);
    return acc;
  }, {});

  const balances = policies.map((policy: any) => {
    const used = approvedByType[policy.code] || approvedByType[policy.name] || 0;
    const adjustment = adjustmentsByType[policy.code] || adjustmentsByType[policy.name] || 0;
    const annualMax = Number(policy.maxDaysPerYear || 0);

    // Accrual: the full annual entitlement isn't available on Jan 1 —
    // only 1/12th per completed month, capped at the annual max (so by
    // December the two calculations agree exactly).
    const availableThisYear = policy.accrualEnabled
      ? Math.min(annualMax, (annualMax / 12) * monthsElapsed)
      : annualMax;

    // Carry-forward: one year back only (no chained/compounding
    // carry-forward), capped at maxCarryForwardDays. Last year is always
    // treated as fully accrued for this purpose since it already ended.
    let carryForwardDays = 0;
    if (policy.carryForwardEnabled) {
      const prevUsed = prevYearApprovedByType[policy.code] || prevYearApprovedByType[policy.name] || 0;
      const prevRemaining = Math.max(0, annualMax - prevUsed);
      carryForwardDays = Math.min(prevRemaining, Number(policy.maxCarryForwardDays || 0));
    }

    const maxDays = availableThisYear + carryForwardDays;
    return {
      ...policy,
      usedDays: used,
      adjustmentDays: adjustment,
      carryForwardDays,
      remainingDays: Math.max(0, maxDays + adjustment - used),
    };
  });

  return { policies, balances, requests };
}

router.get('/api/leave/mine', authenticate, async (req: any, res: any) => {
  try {
    const userId = req.user.userId;
    const tenantId = req.user.tenantId;
    const [{ policies, balances, requests }, holidayChoices, payrollSettings] = await Promise.all([
      computeLeaveBalancesForUser(userId, tenantId),
      db.select().from(schema.optionalHolidayChoices).where(eq(schema.optionalHolidayChoices.userId, userId)),
      getOrCreatePayrollSettings(tenantId),
    ]);

    res.json({
      policies,
      balances,
      requests,
      optionalHolidayLimit: payrollSettings.optionalHolidayLimit,
      selectedOptionalHolidayCount: holidayChoices.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin/manager lookup of another employee's leave balance — backs the
// Employee Directory detail modal's "Leave Days Remaining" field. Gated the
// same way as the employee directory itself (employee.read/reports.view),
// not a new feature-catalog key.
router.get('/api/tenant/employees/:id/leave-balance', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'employee.read') && !await hasPrivilege(req.user, 'reports.view')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const employeeId = parseInt(req.params.id, 10);
    const employeeRows = await db.select().from(schema.users).where(eq(schema.users.id, employeeId)).limit(1);
    if (employeeRows.length === 0 || employeeRows[0].tenantId !== req.user.tenantId) {
      return res.status(404).json({ error: 'Employee not found.' });
    }
    const scopedBranchIds = await getScopedBranchIds(req.user);
    if (scopedBranchIds !== null && employeeRows[0].branchId && !scopedBranchIds.includes(employeeRows[0].branchId)) {
      return res.status(403).json({ error: 'Access denied: You are not scoped to this employee\'s branch.' });
    }
    const { balances } = await computeLeaveBalancesForUser(employeeId, req.user.tenantId);
    const remainingDays = balances.reduce((sum: number, b: any) => sum + Number(b.remainingDays || 0), 0);
    res.json({ balances, remainingDays });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/leave/requests', authenticate, async (req: any, res: any) => {
  try {
    const { policyId, leaveType, startDate, endDate, reason, medicalCause, halfDay } = req.body || {};
    if (!leaveType || !startDate || !endDate || !reason) {
      return res.status(400).json({ error: 'leaveType, startDate, endDate, and reason are required.' });
    }
    if (parseDateOnly(endDate).getTime() < parseDateOnly(startDate).getTime()) {
      return res.status(400).json({ error: 'End date cannot be before start date.' });
    }
    const totalDays = computeLeaveDays(startDate, endDate, !!halfDay);
    if (totalDays <= 0) return res.status(400).json({ error: 'Invalid leave date range.' });

    const userRows = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId)).limit(1);
    if (userRows.length === 0) return res.status(404).json({ error: 'User not found.' });
    const user = userRows[0];

    const policyRows = policyId
      ? await db.select().from(schema.leavePolicies).where(eq(schema.leavePolicies.id, Number(policyId))).limit(1)
      : await db.select().from(schema.leavePolicies).where(and(eq(schema.leavePolicies.tenantId, req.user.tenantId), eq(schema.leavePolicies.code, leaveType))).limit(1);
    const policy = policyRows[0] || null;
    if (policy && policy.tenantId !== req.user.tenantId) {
      return res.status(403).json({ error: 'Invalid leave policy selected.' });
    }
    if (policy && !policy.allowHalfDay && halfDay) {
      return res.status(400).json({ error: `${policy.name} does not allow half-day requests.` });
    }
    if (policy?.medicalOnlyNoAdvanceNoticeDays && !medicalCause) {
      const daysUntilStart = Math.floor((parseDateOnly(startDate).getTime() - parseDateOnly(toDateOnly(new Date())).getTime()) / DAY_MS);
      if (daysUntilStart < Number(policy.medicalOnlyNoAdvanceNoticeDays || 0)) {
        return res.status(400).json({ error: `${policy.name} requires a medical reason for short-notice requests.` });
      }
    }

    const overlappingRequests = await db.select().from(schema.leaveRequests).where(
      and(
        eq(schema.leaveRequests.tenantId, req.user.tenantId),
        eq(schema.leaveRequests.userId, req.user.userId),
        sql`${schema.leaveRequests.status} in ('pending', 'approved')`,
        sql`NOT (${schema.leaveRequests.endDate} < ${startDate} OR ${schema.leaveRequests.startDate} > ${endDate})`
      )
    );
    if (overlappingRequests.length > 0) {
      return res.status(400).json({ error: 'You already have a pending or approved leave request in this date range.' });
    }

    const [inserted] = await db.insert(schema.leaveRequests).values({
      tenantId: req.user.tenantId,
      userId: req.user.userId,
      policyId: policy?.id,
      leaveType,
      startDate,
      endDate,
      totalDays,
      medicalCause: !!medicalCause,
      reason,
      status: policy?.requiresApproval === false ? 'approved' : 'pending',
    }).returning();

    const approvers = uniqueById([
      ...(await getUsersWithPrivilege(req.user.tenantId, 'leave.approve')),
      ...(await getUsersWithPrivilege(req.user.tenantId, 'attendance.approve')),
    ]).filter((approver: any) => approver.id !== req.user.userId);

    await Promise.all(approvers.map((approver: any) =>
      sendLeaveApprovalRequestEmail(
        approver.email,
        approver.name || 'Approver',
        user.name,
        leaveType,
        startDate,
        endDate,
        totalDays,
        reason,
      ).catch(() => undefined)
    ));

    dispatchWebhookEvent(req.user.tenantId, 'leave.requested', {
      requestId: inserted.id,
      userId: req.user.userId,
      leaveType,
      startDate,
      endDate,
      totalDays,
      status: inserted.status,
    });

    res.json({ success: true, request: inserted });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/tenant/leave/policies', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'leave.read')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const policies = await db.select().from(schema.leavePolicies).where(eq(schema.leavePolicies.tenantId, req.user.tenantId)).orderBy(schema.leavePolicies.name);
    res.json({ policies });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/tenant/leave/policies', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'leave.approve')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const { name, code, maxDaysPerYear, allowHalfDay, requiresApproval, medicalOnlyNoAdvanceNoticeDays, defaultDeductionPercent, accrualEnabled, carryForwardEnabled, maxCarryForwardDays, encashmentEnabled } = req.body || {};
    if (!name || !code) return res.status(400).json({ error: 'name and code are required.' });
    const [policy] = await db.insert(schema.leavePolicies).values({
      tenantId: req.user.tenantId,
      name,
      code,
      maxDaysPerYear: Number(maxDaysPerYear || 0),
      allowHalfDay: allowHalfDay !== false,
      requiresApproval: requiresApproval !== false,
      medicalOnlyNoAdvanceNoticeDays: Number(medicalOnlyNoAdvanceNoticeDays || 0),
      defaultDeductionPercent: Number(defaultDeductionPercent || 100),
      accrualEnabled: !!accrualEnabled,
      carryForwardEnabled: !!carryForwardEnabled,
      maxCarryForwardDays: Number(maxCarryForwardDays || 0),
      encashmentEnabled: !!encashmentEnabled,
    }).returning();
    res.json({ success: true, policy });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// One-time convenience seed for a tenant with zero configured leave
// policies — inserts the standard leave-type catalog (Casual, Sick, Earned,
// LWP, Paternity, Sabbatical) so a fresh Leave Management screen isn't a
// single empty card. Refuses to run if the tenant already has any policy,
// so it can never silently duplicate or overwrite real configuration —
// every row it creates is a normal, fully editable/deletable policy
// afterward, same as one created through the form.
router.post('/api/tenant/leave/policies/seed-defaults', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'leave.approve')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    // Only add the standard types this tenant doesn't already have (matched
    // by code) — lets a tenant that already created one or two policies
    // top up the rest of the starter set, instead of being blocked entirely
    // just because it isn't starting from zero.
    const existing = await db.select().from(schema.leavePolicies).where(eq(schema.leavePolicies.tenantId, req.user.tenantId));
    const existingCodes = new Set(existing.map((p) => p.code));
    const toAdd = STARTER_LEAVE_POLICIES.filter((p) => !existingCodes.has(p.code));
    if (toAdd.length === 0) {
      return res.status(400).json({ error: 'This tenant already has all the standard leave types configured.' });
    }
    const policies = await db.insert(schema.leavePolicies).values(
      toAdd.map((p) => ({
        tenantId: req.user.tenantId,
        name: p.name,
        code: p.code,
        maxDaysPerYear: p.maxDaysPerYear,
        allowHalfDay: p.allowHalfDay,
        requiresApproval: p.requiresApproval,
        defaultDeductionPercent: p.defaultDeductionPercent,
      }))
    ).returning();
    res.json({ success: true, policies });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/tenant/leave/requests', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'leave.approve') && !await hasPrivilege(req.user, 'leave.read')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const scopedBranchIds = await getScopedBranchIds(req.user);
    const users = scopedBranchIds === null
      ? await db.select().from(schema.users).where(eq(schema.users.tenantId, req.user.tenantId))
      : await db.select().from(schema.users).where(and(eq(schema.users.tenantId, req.user.tenantId), inArray(schema.users.branchId, scopedBranchIds)));
    const userById = new Map(users.map((user: any) => [user.id, user]));
    const requests = (await db.select().from(schema.leaveRequests).where(eq(schema.leaveRequests.tenantId, req.user.tenantId)).orderBy(desc(schema.leaveRequests.createdAt)))
      .filter((request: any) => userById.has(request.userId))
      .map((request: any) => {
        const employee: any = userById.get(request.userId);
        return {
          ...request,
          employeeName: employee?.name || 'Unknown',
          employeeEmail: employee?.email || '',
          role: employee?.role || '',
          department: employee?.department || '',
        };
      });
    res.json({ requests });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/tenant/leave/requests/action', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'leave.approve')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const { requestId, action, comment } = req.body || {};
    if (!requestId || !['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'requestId and valid action are required.' });
    const requestRows = await db.select().from(schema.leaveRequests).where(eq(schema.leaveRequests.id, Number(requestId))).limit(1);
    if (requestRows.length === 0) return res.status(404).json({ error: 'Leave request not found.' });
    const leaveRequest = requestRows[0];
    const [updated] = await db.update(schema.leaveRequests).set({
      status: action === 'approve' ? 'approved' : 'rejected',
      reviewedByUserId: req.user.userId,
      reviewerComment: comment || null,
      reviewedAt: new Date(),
    }).where(eq(schema.leaveRequests.id, leaveRequest.id)).returning();
    const employeeRows = await db.select().from(schema.users).where(eq(schema.users.id, leaveRequest.userId)).limit(1);
    if (employeeRows.length > 0) {
      const employee = employeeRows[0];
      await sendLeaveDecisionEmail(employee.email, employee.name, leaveRequest.leaveType, leaveRequest.startDate, leaveRequest.endDate, action === 'approve' ? 'approved' : 'rejected', comment).catch(() => undefined);
    }
    dispatchWebhookEvent(req.user.tenantId, action === 'approve' ? 'leave.approved' : 'leave.rejected', {
      requestId: updated.id,
      userId: leaveRequest.userId,
      leaveType: leaveRequest.leaveType,
      startDate: leaveRequest.startDate,
      endDate: leaveRequest.endDate,
      comment: comment || null,
    });
    res.json({ success: true, request: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk approve/reject — same gating and per-request effect as the single
// action above, just looped so a manager clearing a backlog of pending
// requests doesn't have to click through them one at a time. One shared
// comment applies to every request in the batch; requests already decided
// or belonging to another tenant are skipped (reported, not silently
// dropped) rather than failing the whole batch.
router.post('/api/tenant/leave/requests/bulk-action', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'leave.approve')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const { requestIds, action, comment } = req.body || {};
    if (!Array.isArray(requestIds) || requestIds.length === 0 || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'requestIds (non-empty array) and a valid action are required.' });
    }
    if (requestIds.length > 200) {
      return res.status(400).json({ error: 'A single batch is limited to 200 requests.' });
    }

    const results: Array<{ requestId: number; success: boolean; error?: string }> = [];
    for (const rawId of requestIds) {
      const requestId = Number(rawId);
      try {
        const requestRows = await db.select().from(schema.leaveRequests).where(eq(schema.leaveRequests.id, requestId)).limit(1);
        if (requestRows.length === 0) throw new Error('not found');
        const leaveRequest = requestRows[0];
        if (leaveRequest.tenantId !== req.user.tenantId) throw new Error('not in your organization');
        if (leaveRequest.status !== 'pending') throw new Error('already decided');

        const [updated] = await db.update(schema.leaveRequests).set({
          status: action === 'approve' ? 'approved' : 'rejected',
          reviewedByUserId: req.user.userId,
          reviewerComment: comment || null,
          reviewedAt: new Date(),
        }).where(eq(schema.leaveRequests.id, leaveRequest.id)).returning();

        const employeeRows = await db.select().from(schema.users).where(eq(schema.users.id, leaveRequest.userId)).limit(1);
        if (employeeRows.length > 0) {
          const employee = employeeRows[0];
          await sendLeaveDecisionEmail(employee.email, employee.name, leaveRequest.leaveType, leaveRequest.startDate, leaveRequest.endDate, action === 'approve' ? 'approved' : 'rejected', comment).catch(() => undefined);
        }
        dispatchWebhookEvent(req.user.tenantId, action === 'approve' ? 'leave.approved' : 'leave.rejected', {
          requestId: updated.id, userId: leaveRequest.userId, leaveType: leaveRequest.leaveType,
          startDate: leaveRequest.startDate, endDate: leaveRequest.endDate, comment: comment || null, viaBulkAction: true,
        });
        results.push({ requestId, success: true });
      } catch (rowErr: any) {
        results.push({ requestId, success: false, error: rowErr.message || 'Unknown error' });
      }
    }

    res.json({ success: true, results, updated: results.filter((r) => r.success).length, failed: results.filter((r) => !r.success).length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Amend an ALREADY-DECIDED leave request — gated by the delegable
// 'leave.edit' privilege (distinct from 'leave.approve', which only covers
// the initial pending decision). Same underlying amendLeaveRequest() call a
// ticket resolution uses internally (see tickets.routes.ts), so a fix made
// directly and a fix made via resolving a leave_dispute ticket behave
// identically and both reconcile into payroll immediately.
router.patch('/api/tenant/leave/requests/:id/amend', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'leave.edit')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const requestId = Number(req.params.id);
    const { newStatus, startDate, endDate, leaveType, reason } = req.body || {};
    if (newStatus !== undefined && !['approved', 'rejected'].includes(newStatus)) {
      return res.status(400).json({ error: "newStatus must be 'approved' or 'rejected' if provided." });
    }
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'reason is required — this is appended to the request\'s permanent review history.' });
    }

    const existingRows = await db.select().from(schema.leaveRequests).where(and(eq(schema.leaveRequests.id, requestId), eq(schema.leaveRequests.tenantId, req.user.tenantId))).limit(1);
    if (existingRows.length === 0) return res.status(404).json({ error: 'Leave request not found.' });

    await amendLeaveRequest({
      tenantId: req.user.tenantId,
      leaveRequestId: requestId,
      newStatus,
      startDate,
      endDate,
      leaveType,
      editedByUserId: req.user.userId,
      editedByName: req.user.name,
      reason: String(reason).trim(),
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
    });

    const [updated] = await db.select().from(schema.leaveRequests).where(eq(schema.leaveRequests.id, requestId)).limit(1);
    res.json({ success: true, request: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/tenant/leave/adjustments', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'leave.read') && !await hasPrivilege(req.user, 'leave.approve')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const tenantId = req.user.tenantId;
    const scopedBranchIds = await getScopedBranchIds(req.user);

    // Fetch users for filtering branch
    const users = scopedBranchIds === null
      ? await db.select().from(schema.users).where(eq(schema.users.tenantId, tenantId))
      : await db.select().from(schema.users).where(and(eq(schema.users.tenantId, tenantId), inArray(schema.users.branchId, scopedBranchIds)));
    const userById = new Map<number, any>(users.map((u: any) => [u.id, u]));

    const adjustments = await db.select().from(schema.leaveBalanceAdjustments)
      .where(eq(schema.leaveBalanceAdjustments.tenantId, tenantId))
      .orderBy(desc(schema.leaveBalanceAdjustments.createdAt));

    const enriched = adjustments
      .filter((a: any) => userById.has(a.userId))
      .map((a: any) => {
        const employee = userById.get(a.userId);
        const actor = userById.get(a.adjustedByUserId);
        return {
          ...a,
          employeeName: employee?.name || 'Unknown',
          employeeEmail: employee?.email || '',
          adjustedByName: actor?.name || 'System',
        };
      });

    res.json({ adjustments: enriched });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/tenant/leave/adjustments', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'leave.approve')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const { userId, leaveType, adjustmentDays, reason } = req.body || {};
    if (!userId || !leaveType || adjustmentDays == null || !reason) {
      return res.status(400).json({ error: 'userId, leaveType, adjustmentDays, and reason are required.' });
    }

    const tenantId = req.user.tenantId;

    // Verify employee exists and belongs to tenant
    const employeeRows = await db.select().from(schema.users).where(eq(schema.users.id, Number(userId))).limit(1);
    if (employeeRows.length === 0 || employeeRows[0].tenantId !== tenantId) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const [adjustment] = await db.insert(schema.leaveBalanceAdjustments).values({
      tenantId,
      userId: Number(userId),
      leaveType,
      adjustmentDays: Number(adjustmentDays),
      reason,
      adjustedByUserId: req.user.userId,
    }).returning();

    res.json({ success: true, adjustment });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================================
// LEAVE ENCASHMENT — convert unused days of an encashment-enabled leave
// type into pay. Days are deducted from the balance via the same
// leaveBalanceAdjustments table used for HR corrections above (a negative
// adjustment), and ratePerDay/amount are snapshotted from that month's
// payroll daily rate the moment the request is approved — a later CTC
// change never silently rewrites an already-approved encashment, same
// non-retroactive principle payrollRuns already follows.
// ==========================================================

router.post('/api/leave/encashment', authenticate, async (req: any, res: any) => {
  try {
    const { policyId, days, reason } = req.body || {};
    const daysNum = Number(days);
    if (!policyId || !daysNum || daysNum <= 0) {
      return res.status(400).json({ error: 'policyId and a positive number of days are required.' });
    }

    const policyRows = await db.select().from(schema.leavePolicies).where(eq(schema.leavePolicies.id, Number(policyId))).limit(1);
    if (policyRows.length === 0 || policyRows[0].tenantId !== req.user.tenantId) {
      return res.status(404).json({ error: 'Leave policy not found.' });
    }
    const policy = policyRows[0];
    if (!policy.encashmentEnabled) {
      return res.status(400).json({ error: `${policy.name} does not allow encashment.` });
    }

    const { balances } = await computeLeaveBalancesForUser(req.user.userId, req.user.tenantId);
    const balance = balances.find((b: any) => b.id === policy.id);
    if (!balance || balance.remainingDays < daysNum) {
      return res.status(400).json({ error: `Not enough remaining ${policy.name} balance to encash ${daysNum} day(s).` });
    }

    const [request] = await db.insert(schema.leaveEncashmentRequests).values({
      tenantId: req.user.tenantId,
      userId: req.user.userId,
      policyId: policy.id,
      leaveType: policy.code,
      days: daysNum,
      reason: reason || null,
    }).returning();

    const userRows = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId)).limit(1);
    const approvers = uniqueById(await getUsersWithPrivilege(req.user.tenantId, 'leave.approve')).filter((a: any) => a.id !== req.user.userId);
    await notifyUsers(approvers.map((a: any) => a.id), 'Leave encashment request', `${userRows[0]?.name || 'An employee'} requested to encash ${daysNum} day(s) of ${policy.name}.`);

    res.json({ success: true, request });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/tenant/leave/encashment-requests', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'leave.approve')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const tenantId = req.user.tenantId;
    const rows = await db.select().from(schema.leaveEncashmentRequests).where(eq(schema.leaveEncashmentRequests.tenantId, tenantId)).orderBy(desc(schema.leaveEncashmentRequests.createdAt));
    const users = await db.select().from(schema.users).where(eq(schema.users.tenantId, tenantId));
    const userById = new Map<number, any>(users.map((u: any) => [u.id, u]));
    res.json({
      requests: rows.map((r: any) => ({ ...r, employeeName: userById.get(r.userId)?.name || 'Unknown' })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/tenant/leave/encashment-requests/action', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'leave.approve')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const { requestId, action } = req.body || {};
    if (!requestId || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'requestId and a valid action (approve|reject) are required.' });
    }

    const rows = await db.select().from(schema.leaveEncashmentRequests).where(eq(schema.leaveEncashmentRequests.id, Number(requestId))).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Encashment request not found.' });
    const request = rows[0];
    if (request.tenantId !== req.user.tenantId) return res.status(403).json({ error: 'Access denied.' });
    if (request.status !== 'pending') return res.status(400).json({ error: 'This request has already been reviewed.' });

    let ratePerDay: number | null = null;
    let amount: number | null = null;

    if (action === 'approve') {
      ratePerDay = await getEffectiveDailyRate(req.user.tenantId, request.userId);
      amount = ratePerDay * Number(request.days);

      await db.insert(schema.leaveBalanceAdjustments).values({
        tenantId: req.user.tenantId,
        userId: request.userId,
        leaveType: request.leaveType,
        adjustmentDays: -Number(request.days),
        reason: `Encashed ${request.days} day(s) (request #${request.id})`,
        adjustedByUserId: req.user.userId,
      });
    }

    const [updated] = await db.update(schema.leaveEncashmentRequests).set({
      status: action === 'approve' ? 'approved' : 'rejected',
      ratePerDay, amount,
      reviewedByUserId: req.user.userId,
      reviewedAt: new Date(),
    }).where(eq(schema.leaveEncashmentRequests.id, request.id)).returning();

    const employeeRows = await db.select().from(schema.users).where(eq(schema.users.id, request.userId)).limit(1);
    if (employeeRows.length > 0) {
      const employee = employeeRows[0];
      const message = action === 'approve'
        ? `Your encashment of ${request.days} day(s) was approved — ₹${Math.round(amount || 0).toLocaleString()} will be included in your next payroll review.`
        : 'Your leave encashment request was rejected.';
      await notifyUser(employee.id, `Encashment ${action === 'approve' ? 'approved' : 'rejected'}`, message);
    }

    res.json({ success: true, request: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
