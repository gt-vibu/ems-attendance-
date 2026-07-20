import { Router } from 'express';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { getScopedBranchIds, getUsersWithPrivilege, hasPrivilege } from '../auth/rbac';
import { STARTER_LEAVE_POLICIES } from '../auth/starterLeavePolicies';
import { sendLeaveApprovalRequestEmail, sendLeaveDecisionEmail } from '../../mail.js';
import { parseDateOnly, toDateOnly, computeLeaveDays, uniqueById, getOrCreatePayrollSettings } from './leavePayrollShared';
import { dispatchWebhookEvent } from '../services/webhooks';

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

  const year = new Date().getUTCFullYear();
  const approvedByType = requests
    .filter((r: any) => r.status === 'approved' && parseDateOnly(r.startDate).getUTCFullYear() === year)
    .reduce((acc: Record<string, number>, request: any) => {
      acc[request.leaveType] = (acc[request.leaveType] || 0) + Number(request.totalDays || 0);
      return acc;
    }, {});

  const adjustmentsByType = adjustments.reduce((acc: Record<string, number>, adj: any) => {
    acc[adj.leaveType] = (acc[adj.leaveType] || 0) + Number(adj.adjustmentDays || 0);
    return acc;
  }, {});

  const balances = policies.map((policy: any) => {
    const used = approvedByType[policy.code] || approvedByType[policy.name] || 0;
    const adjustment = adjustmentsByType[policy.code] || adjustmentsByType[policy.name] || 0;
    const maxDays = Number(policy.maxDaysPerYear || 0);
    return {
      ...policy,
      usedDays: used,
      adjustmentDays: adjustment,
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
    const { name, code, maxDaysPerYear, allowHalfDay, requiresApproval, medicalOnlyNoAdvanceNoticeDays, defaultDeductionPercent } = req.body || {};
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
