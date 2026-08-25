import { Router } from 'express';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db, schema } from '../../db';
import { sendServerError } from '../utils/errors';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege } from '../auth/rbac';
import {
  evaluateSalaryAdvanceEligibility,
  createSalaryAdvanceRequest,
  approveSalaryAdvance,
  rejectSalaryAdvance,
  disburseSalaryAdvance,
  cancelSalaryAdvance,
  parsePolicyNumbers,
  roundMoney,
  formatMoneyStr,
} from '../services/salaryAdvanceService';
import { getOrCreatePayrollSettings } from './leavePayrollShared';
import { logToAuditLedger } from '../services/audit';

export const router = Router();

function parsePagination(req: any, defaultLimit = 100, maxLimit = 1000) {
  const limit = Math.min(maxLimit, Math.max(1, Number(req.query.limit) || defaultLimit));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  return { limit, offset };
}

// ---------------------------------------------------------------------------
// 1. Eligibility & Available Advance Calculation
// ---------------------------------------------------------------------------
router.get('/api/tenant/payroll/salary-advances/eligibility', authenticate, async (req: any, res: any) => {
  try {
    let targetUserId = req.user.userId;
    if (req.query.userId && Number(req.query.userId) !== req.user.userId) {
      const canViewOthers = await hasPrivilege(req.user, 'salary_advance.view') ||
        await hasPrivilege(req.user, 'salary_advance.approve') ||
        await hasPrivilege(req.user, 'salary_advance.assign') ||
        await hasPrivilege(req.user, 'payroll.read') ||
        await hasPrivilege(req.user, 'payroll.manage');
      if (!canViewOthers) {
        return res.status(403).json({ error: 'Access denied: cannot query eligibility for another employee.' });
      }
      targetUserId = Number(req.query.userId);
    }

    const requestedAmount = req.query.amount ? Number(req.query.amount) : undefined;
    const recoveryMonths = req.query.recoveryMonths ? Number(req.query.recoveryMonths) : undefined;
    const targetYear = req.query.targetYear ? Number(req.query.targetYear) : undefined;
    const targetMonth = req.query.targetMonth ? Number(req.query.targetMonth) : undefined;

    const result = await evaluateSalaryAdvanceEligibility(
      req.user.tenantId,
      targetUserId,
      requestedAmount,
      recoveryMonths,
      targetYear,
      targetMonth,
    );

    res.json(result);
  } catch (err: any) {
    sendServerError(res, err, 'salaryAdvance.routes.ts:eligibility');
  }
});

// ---------------------------------------------------------------------------
// 2. Employee Self-Service Advance Request
// ---------------------------------------------------------------------------
router.post('/api/tenant/payroll/salary-advances/request', authenticate, async (req: any, res: any) => {
  try {
    const { requestedAmount, reason, remarks, recoveryMethod, recoveryInstallments, startYear, startMonth } = req.body || {};

    if (!requestedAmount || Number(requestedAmount) <= 0) {
      return res.status(400).json({ error: 'A valid positive requestedAmount is required.' });
    }
    if (!startYear || !startMonth) {
      return res.status(400).json({ error: 'startYear and startMonth are required for scheduled recovery.' });
    }

    const advance = await createSalaryAdvanceRequest({
      tenantId: req.user.tenantId,
      userId: req.user.userId,
      requestedAmount: Number(requestedAmount),
      reason,
      remarks,
      recoveryMethod,
      recoveryInstallments: Number(recoveryInstallments) || 1,
      startYear: Number(startYear),
      startMonth: Number(startMonth),
      requestedByUserId: req.user.userId,
      origin: 'EMPLOYEE_REQUEST',
    });

    res.status(201).json({ advance });
  } catch (err: any) {
    if (err.message && err.message.startsWith('Ineligible for salary advance')) {
      return res.status(422).json({ error: err.message });
    }
    sendServerError(res, err, 'salaryAdvance.routes.ts:request');
  }
});

// ---------------------------------------------------------------------------
// 3. Admin Direct Assignment
// ---------------------------------------------------------------------------
router.post('/api/tenant/payroll/salary-advances/assign', authenticate, async (req: any, res: any) => {
  try {
    const canAssign = await hasPrivilege(req.user, 'salary_advance.assign') ||
      await hasPrivilege(req.user, 'payroll.loans.manage') ||
      await hasPrivilege(req.user, 'payroll.manage');
    if (!canAssign) {
      return res.status(403).json({ error: 'Access denied: privilege salary_advance.assign required.' });
    }

    const { userId, amount, reason, remarks, recoveryMethod, recoveryInstallments, startYear, startMonth, autoApprove } = req.body || {};

    if (!userId || !amount || Number(amount) <= 0 || !startYear || !startMonth) {
      return res.status(400).json({ error: 'userId, positive amount, startYear, and startMonth are required.' });
    }

    const advance = await createSalaryAdvanceRequest({
      tenantId: req.user.tenantId,
      userId: Number(userId),
      requestedAmount: Number(amount),
      reason,
      remarks,
      recoveryMethod,
      recoveryInstallments: Number(recoveryInstallments) || 1,
      startYear: Number(startYear),
      startMonth: Number(startMonth),
      requestedByUserId: req.user.userId,
      origin: 'ADMIN_ASSIGNED',
    });

    let finalAdvance = advance;
    if (autoApprove) {
      finalAdvance = await approveSalaryAdvance({
        advanceId: advance.id,
        tenantId: req.user.tenantId,
        approverUserId: req.user.userId,
        approvedAmount: Number(amount),
        remarks: 'Auto-approved during administrative assignment.',
      });
    }

    res.status(201).json({ advance: finalAdvance });
  } catch (err: any) {
    if (err.message && err.message.startsWith('Ineligible for salary advance')) {
      return res.status(422).json({ error: err.message });
    }
    sendServerError(res, err, 'salaryAdvance.routes.ts:assign');
  }
});

// ---------------------------------------------------------------------------
// 4. List Advances with Filters & Metrics
// ---------------------------------------------------------------------------
router.get('/api/tenant/payroll/salary-advances', authenticate, async (req: any, res: any) => {
  try {
    const canViewAll = await hasPrivilege(req.user, 'salary_advance.view') ||
      await hasPrivilege(req.user, 'payroll.read') ||
      await hasPrivilege(req.user, 'payroll.manage') ||
      req.user.role === 'tenant_admin' ||
      req.user.role === 'super_admin';

    const { limit, offset } = parsePagination(req);
    const { status, origin, userId, startYear, startMonth, search } = req.query || {};

    const conditions = [eq(schema.salaryAdvances.tenantId, req.user.tenantId)];

    if (!canViewAll) {
      // Non-privileged users can only view their own
      conditions.push(eq(schema.salaryAdvances.userId, req.user.userId));
    } else if (userId) {
      conditions.push(eq(schema.salaryAdvances.userId, Number(userId)));
    }

    if (status && status !== 'all') {
      conditions.push(eq(schema.salaryAdvances.status, String(status)));
    }
    if (origin && origin !== 'all') {
      conditions.push(eq(schema.salaryAdvances.origin, String(origin)));
    }
    if (startYear) {
      conditions.push(eq(schema.salaryAdvances.startRecoveryYear, Number(startYear)));
    }
    if (startMonth) {
      conditions.push(eq(schema.salaryAdvances.startRecoveryMonth, Number(startMonth)));
    }

    const rows = await db.select().from(schema.salaryAdvances)
      .where(and(...conditions))
      .orderBy(desc(schema.salaryAdvances.createdAt))
      .limit(limit)
      .offset(offset);

    // Attach employee info to rows
    const userIds: number[] = Array.from(new Set(rows.map((r: any) => Number(r.userId))));
    const usersMap = new Map<number, any>();
    if (userIds.length > 0) {
      const userRows = await db.select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        department: schema.users.department,
        designation: schema.users.designation,
        uid: schema.users.uid,
      }).from(schema.users).where(inArray(schema.users.id, userIds));
      for (const u of userRows) usersMap.set(u.id, u);
    }

    const enriched = rows.map((r: any) => ({
      ...r,
      employee: usersMap.get(r.userId) || { name: `User #${r.userId}`, email: '' },
    }));

    // Filter by text search if provided
    let finalAdvances = enriched;
    if (search && typeof search === 'string' && search.trim()) {
      const s = search.toLowerCase().trim();
      finalAdvances = enriched.filter((a: any) =>
        a.employee?.name?.toLowerCase().includes(s) ||
        a.employee?.email?.toLowerCase().includes(s) ||
        a.reason?.toLowerCase().includes(s) ||
        String(a.id).includes(s)
      );
    }

    // Tenant-level KPI metrics summary
    const allTenantAdvances = await db.select().from(schema.salaryAdvances).where(eq(schema.salaryAdvances.tenantId, req.user.tenantId));
    let pendingCount = 0;
    let approvedCount = 0;
    let disbursedCount = 0;
    let totalOutstanding = 0;
    let closedCount = 0;

    for (const a of allTenantAdvances) {
      if (a.status === 'pending_approval') pendingCount++;
      if (a.status === 'approved') approvedCount++;
      if (a.status === 'disbursed' || a.status === 'partially_recovered') {
        disbursedCount++;
        totalOutstanding += Number(a.outstandingAmount || 0);
      }
      if (a.status === 'closed' || a.status === 'fully_recovered') closedCount++;
    }

    res.json({
      advances: finalAdvances,
      metrics: {
        pendingCount,
        approvedCount,
        disbursedCount,
        totalOutstanding: roundMoney(totalOutstanding),
        closedCount,
        totalCount: allTenantAdvances.length,
      },
      pagination: { limit, offset, returned: finalAdvances.length },
    });
  } catch (err: any) {
    sendServerError(res, err, 'salaryAdvance.routes.ts:list');
  }
});

// ---------------------------------------------------------------------------
// 5. Employee Self-Service: My Advances
// ---------------------------------------------------------------------------
router.get('/api/tenant/payroll/salary-advances/my', authenticate, async (req: any, res: any) => {
  try {
    const rows = await db.select().from(schema.salaryAdvances)
      .where(and(eq(schema.salaryAdvances.tenantId, req.user.tenantId), eq(schema.salaryAdvances.userId, req.user.userId)))
      .orderBy(desc(schema.salaryAdvances.createdAt));

    const advanceIds = rows.map((r: any) => r.id);
    let allRecoveries: any[] = [];
    if (advanceIds.length > 0) {
      allRecoveries = await db.select().from(schema.salaryAdvanceRecoveries)
        .where(inArray(schema.salaryAdvanceRecoveries.advanceId, advanceIds))
        .orderBy(schema.salaryAdvanceRecoveries.scheduledYear, schema.salaryAdvanceRecoveries.scheduledMonth);
    }

    const recoveriesByAdvanceId = new Map<number, any[]>();
    for (const rec of allRecoveries) {
      const list = recoveriesByAdvanceId.get(rec.advanceId) || [];
      list.push(rec);
      recoveriesByAdvanceId.set(rec.advanceId, list);
    }

    const result = rows.map((r: any) => ({
      ...r,
      schedule: recoveriesByAdvanceId.get(r.id) || [],
    }));

    res.json({ advances: result });
  } catch (err: any) {
    sendServerError(res, err, 'salaryAdvance.routes.ts:my');
  }
});

// ---------------------------------------------------------------------------
// 6. Get Single Advance Details & Schedule
// ---------------------------------------------------------------------------
router.get('/api/tenant/payroll/salary-advances/:id', authenticate, async (req: any, res: any) => {
  try {
    const advanceId = Number(req.params.id);
    const rows = await db.select().from(schema.salaryAdvances)
      .where(and(eq(schema.salaryAdvances.id, advanceId), eq(schema.salaryAdvances.tenantId, req.user.tenantId)))
      .limit(1);

    if (rows.length === 0) return res.status(404).json({ error: 'Salary advance not found.' });
    const advance = rows[0];

    const canView = advance.userId === req.user.userId ||
      await hasPrivilege(req.user, 'salary_advance.view') ||
      await hasPrivilege(req.user, 'payroll.read') ||
      await hasPrivilege(req.user, 'payroll.manage');
    if (!canView) return res.status(403).json({ error: 'Access denied.' });

    const schedule = await db.select().from(schema.salaryAdvanceRecoveries)
      .where(eq(schema.salaryAdvanceRecoveries.advanceId, advance.id))
      .orderBy(schema.salaryAdvanceRecoveries.scheduledYear, schema.salaryAdvanceRecoveries.scheduledMonth);

    const empRows = await db.select().from(schema.users).where(eq(schema.users.id, advance.userId)).limit(1);

    res.json({
      advance: {
        ...advance,
        employee: empRows[0] || null,
        schedule,
      },
    });
  } catch (err: any) {
    sendServerError(res, err, 'salaryAdvance.routes.ts:getOne');
  }
});

// ---------------------------------------------------------------------------
// 7. Approve Advance
// ---------------------------------------------------------------------------
router.post('/api/tenant/payroll/salary-advances/:id/approve', authenticate, async (req: any, res: any) => {
  try {
    const canApprove = await hasPrivilege(req.user, 'salary_advance.approve') ||
      await hasPrivilege(req.user, 'payroll.loans.manage') ||
      await hasPrivilege(req.user, 'payroll.manage');
    if (!canApprove) return res.status(403).json({ error: 'Access denied: privilege salary_advance.approve required.' });

    const advanceId = Number(req.params.id);
    const { approvedAmount, remarks } = req.body || {};

    const updated = await approveSalaryAdvance({
      advanceId,
      tenantId: req.user.tenantId,
      approverUserId: req.user.userId,
      approvedAmount: approvedAmount !== undefined ? Number(approvedAmount) : undefined,
      remarks,
    });

    res.json({ advance: updated });
  } catch (err: any) {
    sendServerError(res, err, 'salaryAdvance.routes.ts:approve');
  }
});

// ---------------------------------------------------------------------------
// 8. Reject Advance
// ---------------------------------------------------------------------------
router.post('/api/tenant/payroll/salary-advances/:id/reject', authenticate, async (req: any, res: any) => {
  try {
    const canApprove = await hasPrivilege(req.user, 'salary_advance.approve') ||
      await hasPrivilege(req.user, 'payroll.loans.manage') ||
      await hasPrivilege(req.user, 'payroll.manage');
    if (!canApprove) return res.status(403).json({ error: 'Access denied: privilege salary_advance.approve required.' });

    const advanceId = Number(req.params.id);
    const { reason } = req.body || {};
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'A rejection reason is required.' });
    }

    const updated = await rejectSalaryAdvance({
      advanceId,
      tenantId: req.user.tenantId,
      rejecterUserId: req.user.userId,
      reason: String(reason).trim(),
    });

    res.json({ advance: updated });
  } catch (err: any) {
    sendServerError(res, err, 'salaryAdvance.routes.ts:reject');
  }
});

// ---------------------------------------------------------------------------
// 9. Disburse Advance
// ---------------------------------------------------------------------------
router.post('/api/tenant/payroll/salary-advances/:id/disburse', authenticate, async (req: any, res: any) => {
  try {
    const canDisburse = await hasPrivilege(req.user, 'salary_advance.disburse') ||
      await hasPrivilege(req.user, 'payroll.loans.manage') ||
      await hasPrivilege(req.user, 'payroll.manage');
    if (!canDisburse) return res.status(403).json({ error: 'Access denied: privilege salary_advance.disburse required.' });

    const advanceId = Number(req.params.id);
    const { disbursedAmount, disbursementMethod, disbursementReference, disbursementDate, bankDetailsSnapshot } = req.body || {};

    const updated = await disburseSalaryAdvance({
      advanceId,
      tenantId: req.user.tenantId,
      disburserUserId: req.user.userId,
      disbursedAmount: disbursedAmount !== undefined ? Number(disbursedAmount) : undefined,
      disbursementMethod,
      disbursementReference,
      disbursementDate,
      bankDetailsSnapshot,
    });

    res.json({ advance: updated });
  } catch (err: any) {
    sendServerError(res, err, 'salaryAdvance.routes.ts:disburse');
  }
});

// ---------------------------------------------------------------------------
// 10. Cancel Advance
// ---------------------------------------------------------------------------
router.post('/api/tenant/payroll/salary-advances/:id/cancel', authenticate, async (req: any, res: any) => {
  try {
    const advanceId = Number(req.params.id);
    const { reason } = req.body || {};

    const isAdmin = await hasPrivilege(req.user, 'salary_advance.cancel') ||
      await hasPrivilege(req.user, 'payroll.loans.manage') ||
      await hasPrivilege(req.user, 'payroll.manage');

    const updated = await cancelSalaryAdvance({
      advanceId,
      tenantId: req.user.tenantId,
      actorUserId: req.user.userId,
      reason,
      isAdmin,
    });

    res.json({ advance: updated });
  } catch (err: any) {
    sendServerError(res, err, 'salaryAdvance.routes.ts:cancel');
  }
});

// ---------------------------------------------------------------------------
// 11. Policy Settings (GET & PUT)
// ---------------------------------------------------------------------------
router.get('/api/tenant/payroll/salary-advances/policies', authenticate, async (req: any, res: any) => {
  try {
    const settings = await getOrCreatePayrollSettings(req.user.tenantId);
    res.json({ policy: parsePolicyNumbers(settings) });
  } catch (err: any) {
    sendServerError(res, err, 'salaryAdvance.routes.ts:getPolicies');
  }
});

router.put('/api/tenant/payroll/salary-advances/policies', authenticate, async (req: any, res: any) => {
  try {
    const canManagePolicy = await hasPrivilege(req.user, 'salary_advance.manage') ||
      await hasPrivilege(req.user, 'tenant.config.manage') ||
      await hasPrivilege(req.user, 'payroll.manage');
    if (!canManagePolicy) return res.status(403).json({ error: 'Access denied: privilege salary_advance.manage required.' });

    const body = req.body || {};
    const updates: any = { updatedAt: new Date() };

    if (body.salaryAdvanceEnabled !== undefined) updates.salaryAdvanceEnabled = Boolean(body.salaryAdvanceEnabled);
    if (body.advanceCalculationBasis !== undefined) updates.advanceCalculationBasis = String(body.advanceCalculationBasis);
    if (body.advanceMaxAmount !== undefined) updates.advanceMaxAmount = formatMoneyStr(body.advanceMaxAmount);
    if (body.advanceMaxPercentage !== undefined) updates.advanceMaxPercentage = formatMoneyStr(body.advanceMaxPercentage);
    if (body.advanceMinTenureMonths !== undefined) updates.advanceMinTenureMonths = Number(body.advanceMinTenureMonths);
    if (body.advanceMaxActiveCount !== undefined) updates.advanceMaxActiveCount = Number(body.advanceMaxActiveCount);
    if (body.advanceAllowMultiple !== undefined) updates.advanceAllowMultiple = Boolean(body.advanceAllowMultiple);
    if (body.advanceDefaultRecoveryMethod !== undefined) updates.advanceDefaultRecoveryMethod = String(body.advanceDefaultRecoveryMethod);
    if (body.advanceMaxInstallments !== undefined) updates.advanceMaxInstallments = Number(body.advanceMaxInstallments);
    if (body.advanceMinRecoveryAmount !== undefined) updates.advanceMinRecoveryAmount = formatMoneyStr(body.advanceMinRecoveryAmount);
    if (body.advanceEmployeeCanRequest !== undefined) updates.advanceEmployeeCanRequest = Boolean(body.advanceEmployeeCanRequest);
    if (body.advanceAdminCanAssign !== undefined) updates.advanceAdminCanAssign = Boolean(body.advanceAdminCanAssign);
    if (body.advanceApprovalRequired !== undefined) updates.advanceApprovalRequired = Boolean(body.advanceApprovalRequired);
    if (body.advancePayrollCutoffDay !== undefined) updates.advancePayrollCutoffDay = Number(body.advancePayrollCutoffDay);
    if (body.advanceApprovalThresholds !== undefined) updates.advanceApprovalThresholds = body.advanceApprovalThresholds;

    const [updated] = await db.update(schema.payrollSettings)
      .set(updates)
      .where(eq(schema.payrollSettings.tenantId, req.user.tenantId))
      .returning();

    await logToAuditLedger({
      tenantId: req.user.tenantId,
      actorId: req.user.userId,
      actorName: req.user.name,
      action: 'SALARY_ADVANCE_POLICY_UPDATED',
      details: updates,
    });

    res.json({ policy: parsePolicyNumbers(updated) });
  } catch (err: any) {
    sendServerError(res, err, 'salaryAdvance.routes.ts:updatePolicies');
  }
});
