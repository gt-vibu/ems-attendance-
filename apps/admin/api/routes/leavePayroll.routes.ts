import { Router } from 'express';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { getScopedBranchIds, getUsersWithPrivilege, hasPrivilege } from '../auth/rbac';
import { STARTER_LEAVE_POLICIES } from '../auth/starterLeavePolicies';
import { sendLeaveApprovalRequestEmail, sendLeaveDecisionEmail } from '../../mail.js';
import { notifyUser, notifyUsers } from '../services/notifications';

export const router = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function diffDaysInclusive(startDate: string, endDate: string) {
  const start = parseDateOnly(startDate).getTime();
  const end = parseDateOnly(endDate).getTime();
  return Math.floor((end - start) / DAY_MS) + 1;
}

function computeLeaveDays(startDate: string, endDate: string, halfDay: boolean) {
  const days = diffDaysInclusive(startDate, endDate);
  if (days <= 0) return 0;
  return halfDay && days === 1 ? 0.5 : days;
}

function overlapDaysInMonth(startDate: string, endDate: string, year: number, month: number) {
  const monthStart = Date.UTC(year, month - 1, 1);
  const monthEnd = Date.UTC(year, month, 0);
  const start = parseDateOnly(startDate).getTime();
  const end = parseDateOnly(endDate).getTime();
  const overlapStart = Math.max(start, monthStart);
  const overlapEnd = Math.min(end, monthEnd);
  if (overlapEnd < overlapStart) return 0;
  return Math.floor((overlapEnd - overlapStart) / DAY_MS) + 1;
}

function uniqueById<T extends { id: number }>(rows: T[]) {
  const seen = new Set<number>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function componentAnnualAmount(annualCtc: number, component: any) {
  if (component.calculationType === 'fixed_annual') return Number(component.value || 0);
  return annualCtc * (Number(component.value || 0) / 100);
}

function buildPayrollSummary(profile: any, components: any[], settings: any, approvedLeaveDays: number, overtimeHours: number) {
  const annualCtc = Number(profile?.annualCtc || 0);
  const annualBreakdown = components.map((component) => {
    const annualAmount = componentAnnualAmount(annualCtc, component);
    return {
      ...component,
      annualAmount,
      monthlyAmount: annualAmount / 12,
    };
  });
  const annualEarnings = annualBreakdown.filter((c) => c.componentType === 'earning').reduce((sum, c) => sum + c.annualAmount, 0);
  const annualDeductions = annualBreakdown.filter((c) => c.componentType === 'deduction').reduce((sum, c) => sum + c.annualAmount, 0);
  const annualEmployer = annualBreakdown.filter((c) => c.componentType === 'employer_contribution').reduce((sum, c) => sum + c.annualAmount, 0);
  const monthlyGross = annualEarnings / 12;
  const monthlyDeductions = annualDeductions / 12;
  const monthlyBaseNet = monthlyGross - monthlyDeductions;
  const workingDays = Number(settings?.workingDaysPerMonth || 26);
  const maxPaidLeaveDays = Number(settings?.maxPaidLeaveDaysPerMonth || 0);
  const excessLeavePenaltyPercent = Number(settings?.excessLeavePenaltyPercent || 100) / 100;
  const chargeableLeaveDays = Math.max(0, approvedLeaveDays - maxPaidLeaveDays);
  const dailyRate = workingDays > 0 ? monthlyBaseNet / workingDays : 0;
  const leaveDeduction = dailyRate * chargeableLeaveDays * excessLeavePenaltyPercent;
  const overtimeRate = Number(profile?.overtimeHourlyRate ?? settings?.overtimeHourlyRate ?? 0);
  const overtimePay = overtimeHours * overtimeRate;
  const monthlyNet = monthlyBaseNet - leaveDeduction + overtimePay;

  return {
    annualCtc,
    annualEarnings,
    annualDeductions,
    annualEmployerContributions: annualEmployer,
    monthlyGross,
    monthlyDeductions,
    monthlyBaseNet,
    dailyRate,
    approvedLeaveDays,
    chargeableLeaveDays,
    leaveDeduction,
    overtimeHours,
    overtimeRate,
    overtimePay,
    monthlyNet,
    annualBreakdown,
  };
}

async function getOrCreatePayrollSettings(tenantId: number) {
  const existing = await db.select().from(schema.payrollSettings).where(eq(schema.payrollSettings.tenantId, tenantId)).limit(1);
  if (existing.length > 0) return existing[0];
  const [inserted] = await db.insert(schema.payrollSettings).values({ tenantId }).returning();
  return inserted;
}

// Role-level default compensation template (roleCompensationDefaults +
// roleCompensationComponents) for a single role name, or null if the tenant
// hasn't configured one for that role yet. Components come back shaped
// exactly like employeeSalaryComponents rows, so buildPayrollSummary() works
// unmodified against either source.
async function getRoleCompensationDefault(tenantId: number, roleName: string) {
  if (!roleName) return null;
  const rows = await db.select().from(schema.roleCompensationDefaults).where(
    and(eq(schema.roleCompensationDefaults.tenantId, tenantId), eq(schema.roleCompensationDefaults.roleName, roleName))
  ).limit(1);
  if (rows.length === 0) return null;
  const roleDefault = rows[0];
  const components = await db.select().from(schema.roleCompensationComponents)
    .where(eq(schema.roleCompensationComponents.roleDefaultId, roleDefault.id))
    .orderBy(schema.roleCompensationComponents.sortOrder);
  return { roleDefault, components };
}

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

    res.json({ success: true, request: inserted });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/payroll/mine', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;
    const now = new Date();
    const year = Number(req.query.year || now.getUTCFullYear());
    const month = Number(req.query.month || (now.getUTCMonth() + 1));

    const [settings, profileRows, requests, components, userRows] = await Promise.all([
      getOrCreatePayrollSettings(tenantId),
      db.select().from(schema.employeeCompensationProfiles).where(and(eq(schema.employeeCompensationProfiles.tenantId, tenantId), eq(schema.employeeCompensationProfiles.userId, userId), eq(schema.employeeCompensationProfiles.status, 'active'))).orderBy(desc(schema.employeeCompensationProfiles.id)).limit(1),
      db.select().from(schema.leaveRequests).where(and(eq(schema.leaveRequests.tenantId, tenantId), eq(schema.leaveRequests.userId, userId), eq(schema.leaveRequests.status, 'approved'))),
      db.select().from(schema.employeeSalaryComponents).where(and(eq(schema.employeeSalaryComponents.tenantId, tenantId), eq(schema.employeeSalaryComponents.userId, userId))).orderBy(schema.employeeSalaryComponents.sortOrder),
      db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1),
    ]);

    let profile: any = profileRows[0] || null;
    let effectiveComponents = components;
    let source: 'individual' | 'role_default' | 'none' = profile ? 'individual' : 'none';

    // No individual override — fall back to this employee's role default
    // template (if the tenant has configured one) rather than reporting no
    // pay at all. Their real effective pay is the role default's numbers.
    if (!profile) {
      const roleName = userRows[0]?.role || '';
      const roleDefault = await getRoleCompensationDefault(tenantId, roleName);
      if (roleDefault) {
        profile = { annualCtc: roleDefault.roleDefault.annualCtc, overtimeHourlyRate: null, effectiveFrom: null, status: 'active' };
        effectiveComponents = roleDefault.components;
        source = 'role_default';
      }
    }

    if (!profile) return res.json({ profile: null, components: [], summary: null, settings, source: 'none' });

    const approvedLeaveDays = requests.reduce((sum: number, request: any) => sum + overlapDaysInMonth(request.startDate, request.endDate, year, month), 0);
    const summary = buildPayrollSummary(profile, effectiveComponents, settings, approvedLeaveDays, 0);
    res.json({ profile, components: effectiveComponents, summary, settings, period: { year, month }, source });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Payslip history — one real, permanent snapshot per (employee, year, month),
// taken the first time this route is called for that period. Never
// backfilled for past periods and never overwritten after creation, so a
// later raise/component change can't silently rewrite what a past payslip
// said. This is deliberately NOT the same computation path repeated forever
// live like /mine — it's a point-in-time record.
router.get('/api/payroll/history', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;

    const [settings, profileRows, requests, components, userRows] = await Promise.all([
      getOrCreatePayrollSettings(tenantId),
      db.select().from(schema.employeeCompensationProfiles).where(and(eq(schema.employeeCompensationProfiles.tenantId, tenantId), eq(schema.employeeCompensationProfiles.userId, userId), eq(schema.employeeCompensationProfiles.status, 'active'))).orderBy(desc(schema.employeeCompensationProfiles.id)).limit(1),
      db.select().from(schema.leaveRequests).where(and(eq(schema.leaveRequests.tenantId, tenantId), eq(schema.leaveRequests.userId, userId), eq(schema.leaveRequests.status, 'approved'))),
      db.select().from(schema.employeeSalaryComponents).where(and(eq(schema.employeeSalaryComponents.tenantId, tenantId), eq(schema.employeeSalaryComponents.userId, userId))).orderBy(schema.employeeSalaryComponents.sortOrder),
      db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1),
    ]);

    let profile: any = profileRows[0] || null;
    let effectiveComponents = components;

    if (!profile) {
      const roleName = userRows[0]?.role || '';
      const roleDefault = await getRoleCompensationDefault(tenantId, roleName);
      if (roleDefault) {
        profile = { annualCtc: roleDefault.roleDefault.annualCtc, overtimeHourlyRate: null, effectiveFrom: null, status: 'active' };
        effectiveComponents = roleDefault.components;
      }
    }

    // Only snapshot the current period if there's an actual pay structure to
    // snapshot — an employee with no CTC configured at all has nothing real
    // to record yet.
    if (profile) {
      const approvedLeaveDays = requests.reduce((sum: number, request: any) => sum + overlapDaysInMonth(request.startDate, request.endDate, year, month), 0);
      const summary = buildPayrollSummary(profile, effectiveComponents, settings, approvedLeaveDays, 0);
      await db.insert(schema.payrollRuns).values({
        tenantId,
        userId,
        profileId: profile.id ?? null,
        year,
        month,
        workingDays: Number(settings?.workingDaysPerMonth || 26),
        approvedLeaveDays,
        overtimeHours: 0,
        grossPay: summary.monthlyGross,
        leaveDeduction: summary.leaveDeduction,
        overtimePay: summary.overtimePay,
        netPay: summary.monthlyNet,
        breakdown: summary.annualBreakdown,
        status: 'generated',
      }).onConflictDoNothing({ target: [schema.payrollRuns.userId, schema.payrollRuns.year, schema.payrollRuns.month] });
    }

    const history = await db.select().from(schema.payrollRuns)
      .where(and(eq(schema.payrollRuns.tenantId, tenantId), eq(schema.payrollRuns.userId, userId)))
      .orderBy(desc(schema.payrollRuns.year), desc(schema.payrollRuns.month));

    res.json({ history });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/payroll/history/:runId/pdf', authenticate, async (req: any, res: any) => {
  try {
    const runId = Number(req.params.runId);
    const [run] = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.id, runId)).limit(1);
    if (!run || run.userId !== req.user.userId) {
      return res.status(404).json({ error: 'Payslip not found.' });
    }
    const [userRow] = await db.select().from(schema.users).where(eq(schema.users.id, run.userId)).limit(1);

    const monthLabel = new Date(Date.UTC(run.year, run.month - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payslip-${run.year}-${String(run.month).padStart(2, '0')}.pdf"`);

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    doc.fontSize(18).text('Payslip', { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor('#555').text(monthLabel);
    doc.moveDown(1);
    doc.fillColor('#000').fontSize(11);
    doc.text(`Employee: ${userRow?.name || userRow?.email || 'Employee'}`);
    if (userRow?.email) doc.text(`Email: ${userRow.email}`);
    doc.moveDown(1);

    doc.fontSize(13).text('Earnings & Deductions');
    doc.moveDown(0.5);
    const breakdown: any[] = Array.isArray(run.breakdown) ? run.breakdown : [];
    doc.fontSize(10);
    breakdown.forEach((component: any) => {
      const monthly = Number(component.monthlyAmount || 0);
      const sign = component.componentType === 'deduction' ? '-' : '';
      doc.text(`${component.componentName || 'Component'}  (${component.componentType})`, { continued: true });
      doc.text(`  ${sign}${monthly.toFixed(2)}`, { align: 'right' });
    });
    if (run.leaveDeduction > 0) {
      doc.text('Unpaid Leave Deduction', { continued: true });
      doc.text(`  -${Number(run.leaveDeduction).toFixed(2)}`, { align: 'right' });
    }

    doc.moveDown(1);
    doc.fontSize(12).text(`Gross Pay: ${Number(run.grossPay).toFixed(2)}`);
    doc.text(`Net Pay: ${Number(run.netPay).toFixed(2)}`);
    doc.moveDown(1.5);
    doc.fontSize(8).fillColor('#888').text(`Generated ${new Date(run.createdAt).toLocaleString()} — this reflects the pay structure recorded at the time this payslip was first generated.`);

    doc.end();
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

router.get('/api/tenant/payroll/settings', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.read')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const settings = await getOrCreatePayrollSettings(req.user.tenantId);
    res.json({ settings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/tenant/payroll/settings', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.manage')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const current = await getOrCreatePayrollSettings(req.user.tenantId);
    const patch = {
      workingDaysPerMonth: Number(req.body?.workingDaysPerMonth || current.workingDaysPerMonth),
      maxPaidLeaveDaysPerMonth: Number(req.body?.maxPaidLeaveDaysPerMonth ?? current.maxPaidLeaveDaysPerMonth),
      excessLeavePenaltyPercent: Number(req.body?.excessLeavePenaltyPercent ?? current.excessLeavePenaltyPercent),
      overtimeHourlyRate: Number(req.body?.overtimeHourlyRate ?? current.overtimeHourlyRate),
      optionalHolidayLimit: Number(req.body?.optionalHolidayLimit ?? current.optionalHolidayLimit),
      holidayCountryCode: req.body?.holidayCountryCode || current.holidayCountryCode,
      holidayRegionCode: req.body?.holidayRegionCode ?? current.holidayRegionCode,
      updatedAt: new Date(),
    };
    const [updated] = await db.update(schema.payrollSettings).set(patch).where(eq(schema.payrollSettings.id, current.id)).returning();
    res.json({ success: true, settings: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/tenant/payroll/employee/:userId', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.manage')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const userId = Number(req.params.userId);
    const employeeRows = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (employeeRows.length === 0 || employeeRows[0].tenantId !== req.user.tenantId) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const existing = await db.select().from(schema.employeeCompensationProfiles).where(and(eq(schema.employeeCompensationProfiles.userId, userId), eq(schema.employeeCompensationProfiles.tenantId, req.user.tenantId), eq(schema.employeeCompensationProfiles.status, 'active'))).limit(1);
    const payload = {
      tenantId: req.user.tenantId,
      userId,
      annualCtc: Number(req.body?.annualCtc || 0),
      overtimeHourlyRate: req.body?.overtimeHourlyRate != null ? Number(req.body.overtimeHourlyRate) : null,
      effectiveFrom: req.body?.effectiveFrom || toDateOnly(new Date()),
      status: 'active',
      updatedAt: new Date(),
    };

    let profile: any;
    if (existing.length > 0) {
      [profile] = await db.update(schema.employeeCompensationProfiles).set(payload).where(eq(schema.employeeCompensationProfiles.id, existing[0].id)).returning();
      await db.delete(schema.employeeSalaryComponents).where(eq(schema.employeeSalaryComponents.profileId, profile.id));
    } else {
      [profile] = await db.insert(schema.employeeCompensationProfiles).values(payload).returning();
    }

    const components = Array.isArray(req.body?.components) ? req.body.components : [];
    const sanitized = components
      .filter((component: any) => component?.componentName && component?.value != null)
      .map((component: any, index: number) => ({
        tenantId: req.user.tenantId,
        userId,
        profileId: profile.id,
        componentName: String(component.componentName),
        componentType: String(component.componentType || 'earning'),
        calculationType: String(component.calculationType || 'percent_of_ctc'),
        value: Number(component.value || 0),
        sortOrder: index,
      }));
    if (sanitized.length > 0) await db.insert(schema.employeeSalaryComponents).values(sanitized);

    const freshComponents = await db.select().from(schema.employeeSalaryComponents).where(eq(schema.employeeSalaryComponents.profileId, profile.id)).orderBy(schema.employeeSalaryComponents.sortOrder);
    await notifyUser(userId, 'Your salary has been updated', `Your compensation has been updated, effective ${payload.effectiveFrom}. Check Payroll for the new breakdown.`);
    res.json({ success: true, profile, components: freshComponents });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/tenant/payroll/employee/:userId', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.read') && !await hasPrivilege(req.user, 'employee.read')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const userId = Number(req.params.userId);
    const year = Number(req.query.year || new Date().getUTCFullYear());
    const month = Number(req.query.month || (new Date().getUTCMonth() + 1));
    const employeeRows = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (employeeRows.length === 0 || employeeRows[0].tenantId !== req.user.tenantId) {
      return res.status(404).json({ error: 'Employee not found.' });
    }
    const employee = employeeRows[0];
    // Month window used to scope attendanceRows so an admin can page through
    // an arbitrary employee's calendar (including past months) instead of
    // only ever seeing their most recent ~15 days of check-ins/outs.
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1));
    const [settings, profileRows, components, leaveRows, attendanceRows] = await Promise.all([
      getOrCreatePayrollSettings(req.user.tenantId),
      db.select().from(schema.employeeCompensationProfiles).where(and(eq(schema.employeeCompensationProfiles.tenantId, req.user.tenantId), eq(schema.employeeCompensationProfiles.userId, userId), eq(schema.employeeCompensationProfiles.status, 'active'))).orderBy(desc(schema.employeeCompensationProfiles.id)).limit(1),
      db.select().from(schema.employeeSalaryComponents).where(and(eq(schema.employeeSalaryComponents.tenantId, req.user.tenantId), eq(schema.employeeSalaryComponents.userId, userId))).orderBy(schema.employeeSalaryComponents.sortOrder),
      db.select().from(schema.leaveRequests).where(and(eq(schema.leaveRequests.tenantId, req.user.tenantId), eq(schema.leaveRequests.userId, userId), eq(schema.leaveRequests.status, 'approved'))),
      db.select().from(schema.attendanceLogs).where(and(eq(schema.attendanceLogs.tenantId, req.user.tenantId), eq(schema.attendanceLogs.userId, userId), gte(schema.attendanceLogs.createdAt, monthStart), lte(schema.attendanceLogs.createdAt, monthEnd))).orderBy(schema.attendanceLogs.createdAt),
    ]);
    let profile: any = profileRows[0] || null;
    let effectiveComponents = components;
    let source: 'individual' | 'role_default' | 'none' = profile ? 'individual' : 'none';

    if (!profile) {
      const roleDefault = await getRoleCompensationDefault(req.user.tenantId, employee.role);
      if (roleDefault) {
        profile = { annualCtc: roleDefault.roleDefault.annualCtc, overtimeHourlyRate: null, effectiveFrom: null, status: 'active' };
        effectiveComponents = roleDefault.components;
        source = 'role_default';
      }
    }

    const approvedLeaveDays = leaveRows.reduce((sum: number, request: any) => sum + overlapDaysInMonth(request.startDate, request.endDate, year, month), 0);
    const summary = profile ? buildPayrollSummary(profile, effectiveComponents, settings, approvedLeaveDays, 0) : null;
    res.json({ employee, profile, components: effectiveComponents, summary, settings, leaveRows, attendanceRows, period: { year, month }, source });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/tenant/payroll/overview', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.read') && !await hasPrivilege(req.user, 'reports.view')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const tenantId = req.user.tenantId;
    const year = Number(req.query.year || new Date().getUTCFullYear());
    const month = Number(req.query.month || (new Date().getUTCMonth() + 1));
    const scopedBranchIds = await getScopedBranchIds(req.user);
    const users = scopedBranchIds === null
      ? await db.select().from(schema.users).where(and(eq(schema.users.tenantId, tenantId), sql`role != 'tenant_admin'`))
      : await db.select().from(schema.users).where(and(eq(schema.users.tenantId, tenantId), sql`role != 'tenant_admin'`, inArray(schema.users.branchId, scopedBranchIds)));
    const userIds = users.map((user: any) => user.id);
    const [settings, profiles, components, leaveRows] = await Promise.all([
      getOrCreatePayrollSettings(tenantId),
      userIds.length > 0 ? db.select().from(schema.employeeCompensationProfiles).where(and(eq(schema.employeeCompensationProfiles.tenantId, tenantId), inArray(schema.employeeCompensationProfiles.userId, userIds), eq(schema.employeeCompensationProfiles.status, 'active'))) : [],
      userIds.length > 0 ? db.select().from(schema.employeeSalaryComponents).where(and(eq(schema.employeeSalaryComponents.tenantId, tenantId), inArray(schema.employeeSalaryComponents.userId, userIds))) : [],
      userIds.length > 0 ? db.select().from(schema.leaveRequests).where(and(eq(schema.leaveRequests.tenantId, tenantId), inArray(schema.leaveRequests.userId, userIds), eq(schema.leaveRequests.status, 'approved'))) : [],
    ]);
    const componentsByUser = new Map<number, any[]>();
    components.forEach((component: any) => {
      const list = componentsByUser.get(component.userId) || [];
      list.push(component);
      componentsByUser.set(component.userId, list);
    });
    const leaveByUser = new Map<number, number>();
    leaveRows.forEach((request: any) => {
      leaveByUser.set(request.userId, (leaveByUser.get(request.userId) || 0) + overlapDaysInMonth(request.startDate, request.endDate, year, month));
    });

    const individualRows = profiles.map((profile: any) => {
      const user = users.find((row: any) => row.id === profile.userId);
      const summary = buildPayrollSummary(profile, componentsByUser.get(profile.userId) || [], settings, leaveByUser.get(profile.userId) || 0, 0);
      return {
        userId: profile.userId,
        name: user?.name || 'Unknown',
        role: user?.role || '',
        department: user?.department || 'Unassigned',
        annualCtc: summary.annualCtc,
        monthlyGross: summary.monthlyGross,
        monthlyNet: summary.monthlyNet,
        leaveDeduction: summary.leaveDeduction,
        annualBreakdown: summary.annualBreakdown,
        source: 'individual' as const,
      };
    });

    // Employees with no individual override but whose role has a configured
    // default template DO have real pay in effect — batch-resolve role
    // defaults for every distinct role among those users instead of an N+1
    // per-employee lookup.
    const coveredUserIds = new Set(profiles.map((p: any) => p.userId));
    const usersWithoutProfile = users.filter((u: any) => !coveredUserIds.has(u.id));
    const rolesNeeded: string[] = Array.from(new Set(usersWithoutProfile.map((u: any) => u.role).filter(Boolean)));
    const roleDefaultRows = rolesNeeded.length > 0
      ? await db.select().from(schema.roleCompensationDefaults).where(and(eq(schema.roleCompensationDefaults.tenantId, tenantId), inArray(schema.roleCompensationDefaults.roleName, rolesNeeded)))
      : [];
    const roleDefaultIds = roleDefaultRows.map((r: any) => r.id);
    const roleComponentRows = roleDefaultIds.length > 0
      ? await db.select().from(schema.roleCompensationComponents).where(inArray(schema.roleCompensationComponents.roleDefaultId, roleDefaultIds)).orderBy(schema.roleCompensationComponents.sortOrder)
      : [];
    const roleComponentsByDefaultId = new Map<number, any[]>();
    roleComponentRows.forEach((c: any) => {
      const list = roleComponentsByDefaultId.get(c.roleDefaultId) || [];
      list.push(c);
      roleComponentsByDefaultId.set(c.roleDefaultId, list);
    });
    const roleDefaultByRoleName = new Map<string, any>(roleDefaultRows.map((r: any) => [r.roleName, r]));

    const roleDefaultCoveredRows = usersWithoutProfile
      .map((user: any) => {
        const roleDefault = roleDefaultByRoleName.get(user.role);
        if (!roleDefault) return null;
        const summary = buildPayrollSummary({ annualCtc: roleDefault.annualCtc }, roleComponentsByDefaultId.get(roleDefault.id) || [], settings, leaveByUser.get(user.id) || 0, 0);
        return {
          userId: user.id,
          name: user.name || 'Unknown',
          role: user.role || '',
          department: user.department || 'Unassigned',
          annualCtc: summary.annualCtc,
          monthlyGross: summary.monthlyGross,
          monthlyNet: summary.monthlyNet,
          leaveDeduction: summary.leaveDeduction,
          annualBreakdown: summary.annualBreakdown,
          source: 'role_default' as const,
        };
      })
      .filter((row: any): row is NonNullable<typeof row> => row !== null);

    const profileRows = [...individualRows, ...roleDefaultCoveredRows];

    const totals = profileRows.reduce((acc: any, row: any) => {
      acc.totalAnnualCtc += row.annualCtc;
      acc.totalMonthlyGross += row.monthlyGross;
      acc.totalMonthlyNet += row.monthlyNet;
      acc.totalLeaveDeduction += row.leaveDeduction;
      row.annualBreakdown.forEach((component: any) => {
        const current = acc.componentTotals[component.componentName] || { annual: 0, monthly: 0, type: component.componentType };
        current.annual += component.annualAmount;
        current.monthly += component.monthlyAmount;
        acc.componentTotals[component.componentName] = current;
      });
      const roleBucket = acc.byRole[row.role] || { annualCtc: 0, monthlyGross: 0, monthlyNet: 0, employees: 0 };
      roleBucket.annualCtc += row.annualCtc;
      roleBucket.monthlyGross += row.monthlyGross;
      roleBucket.monthlyNet += row.monthlyNet;
      roleBucket.employees += 1;
      acc.byRole[row.role] = roleBucket;
      const deptBucket = acc.byDepartment[row.department] || { annualCtc: 0, monthlyGross: 0, monthlyNet: 0, employees: 0 };
      deptBucket.annualCtc += row.annualCtc;
      deptBucket.monthlyGross += row.monthlyGross;
      deptBucket.monthlyNet += row.monthlyNet;
      deptBucket.employees += 1;
      acc.byDepartment[row.department] = deptBucket;
      return acc;
    }, {
      totalAnnualCtc: 0,
      totalMonthlyGross: 0,
      totalMonthlyNet: 0,
      totalLeaveDeduction: 0,
      componentTotals: {} as Record<string, any>,
      byRole: {} as Record<string, any>,
      byDepartment: {} as Record<string, any>,
    });

    res.json({
      settings,
      totals,
      employees: profileRows,
      period: { year, month },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Role-level default compensation templates — lets an admin set salary
// structure ONCE per role ("every Employee gets this package") instead of
// walking every single hire through the individual wizard. An individual's
// own employeeCompensationProfiles row (set via the wizard) always wins
// over this when present; this is purely the shared fallback.
router.get('/api/tenant/payroll/role-defaults', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.manage')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const tenantId = req.user.tenantId;
    const [settings, defaults, tenantUsers, roleDefaultNameRows] = await Promise.all([
      getOrCreatePayrollSettings(tenantId),
      db.select().from(schema.roleCompensationDefaults).where(eq(schema.roleCompensationDefaults.tenantId, tenantId)).orderBy(schema.roleCompensationDefaults.roleName),
      db.select({ id: schema.users.id, role: schema.users.role }).from(schema.users).where(and(eq(schema.users.tenantId, tenantId), sql`role NOT IN ('tenant_admin', 'super_admin')`)),
      db.select({ roleName: schema.rolePrivilegeDefaults.roleName }).from(schema.rolePrivilegeDefaults).where(eq(schema.rolePrivilegeDefaults.tenantId, tenantId)),
    ]);

    const defaultIds = defaults.map((d: any) => d.id);
    const componentRows = defaultIds.length > 0
      ? await db.select().from(schema.roleCompensationComponents).where(inArray(schema.roleCompensationComponents.roleDefaultId, defaultIds)).orderBy(schema.roleCompensationComponents.sortOrder)
      : [];
    const componentsByDefaultId = new Map<number, any[]>();
    componentRows.forEach((c: any) => {
      const list = componentsByDefaultId.get(c.roleDefaultId) || [];
      list.push(c);
      componentsByDefaultId.set(c.roleDefaultId, list);
    });

    // Which employees of each role already have their own individual
    // override — used to compute "N of M employees on the standard package".
    const overrideRows = tenantUsers.length > 0
      ? await db.select({ userId: schema.employeeCompensationProfiles.userId }).from(schema.employeeCompensationProfiles).where(and(eq(schema.employeeCompensationProfiles.tenantId, tenantId), inArray(schema.employeeCompensationProfiles.userId, tenantUsers.map((u: any) => u.id)), eq(schema.employeeCompensationProfiles.status, 'active')))
      : [];
    const overriddenUserIds = new Set(overrideRows.map((o: any) => o.userId));
    const employeeCountByRole = new Map<string, number>();
    const overrideCountByRole = new Map<string, number>();
    tenantUsers.forEach((u: any) => {
      employeeCountByRole.set(u.role, (employeeCountByRole.get(u.role) || 0) + 1);
      if (overriddenUserIds.has(u.id)) overrideCountByRole.set(u.role, (overrideCountByRole.get(u.role) || 0) + 1);
    });

    const roleDefaults = defaults.map((d: any) => {
      const comps = componentsByDefaultId.get(d.id) || [];
      const summary = buildPayrollSummary({ annualCtc: d.annualCtc }, comps, settings, 0, 0);
      return {
        ...d,
        components: comps,
        summary,
        employeeCount: employeeCountByRole.get(d.roleName) || 0,
        overrideCount: overrideCountByRole.get(d.roleName) || 0,
      };
    });

    // Every real role name present in this tenant — from actual users.role
    // values and from role_privilege_defaults rows — so the frontend can
    // render a card even for a role that has no template configured yet.
    const roleNames = Array.from(new Set([
      ...tenantUsers.map((u: any) => u.role),
      ...roleDefaultNameRows.map((r: any) => r.roleName),
    ].filter(Boolean))).sort();

    res.json({ roleDefaults, roles: roleNames });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/tenant/payroll/role-defaults/:roleName', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.manage')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const tenantId = req.user.tenantId;
    const roleName = String(req.params.roleName || '').trim();
    if (!roleName) return res.status(400).json({ error: 'roleName is required.' });
    const annualCtc = Number(req.body?.annualCtc || 0);
    if (annualCtc <= 0) return res.status(400).json({ error: 'annualCtc must be greater than zero.' });

    const existing = await db.select().from(schema.roleCompensationDefaults).where(and(eq(schema.roleCompensationDefaults.tenantId, tenantId), eq(schema.roleCompensationDefaults.roleName, roleName))).limit(1);
    let roleDefault: any;
    if (existing.length > 0) {
      [roleDefault] = await db.update(schema.roleCompensationDefaults).set({ annualCtc, updatedAt: new Date() }).where(eq(schema.roleCompensationDefaults.id, existing[0].id)).returning();
      await db.delete(schema.roleCompensationComponents).where(eq(schema.roleCompensationComponents.roleDefaultId, roleDefault.id));
    } else {
      [roleDefault] = await db.insert(schema.roleCompensationDefaults).values({ tenantId, roleName, annualCtc }).returning();
    }

    const components = Array.isArray(req.body?.components) ? req.body.components : [];
    const sanitized = components
      .filter((component: any) => component?.componentName && component?.value != null)
      .map((component: any, index: number) => ({
        tenantId,
        roleDefaultId: roleDefault.id,
        componentName: String(component.componentName),
        componentType: String(component.componentType || 'earning'),
        calculationType: String(component.calculationType || 'percent_of_ctc'),
        value: Number(component.value || 0),
        sortOrder: index,
      }));
    if (sanitized.length > 0) await db.insert(schema.roleCompensationComponents).values(sanitized);

    const freshComponents = await db.select().from(schema.roleCompensationComponents).where(eq(schema.roleCompensationComponents.roleDefaultId, roleDefault.id)).orderBy(schema.roleCompensationComponents.sortOrder);

    // Notify everyone currently INHERITING this default (same role, no
    // individual employeeCompensationProfiles override) — their effective
    // pay just changed. Anyone with a personal override is unaffected and
    // must not be notified.
    const roleUsers = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.role, roleName)));
    const roleUserIds = roleUsers.map((u: any) => u.id);
    let inheritingUserIds: number[] = [];
    if (roleUserIds.length > 0) {
      const overrides = await db.select({ userId: schema.employeeCompensationProfiles.userId }).from(schema.employeeCompensationProfiles).where(and(eq(schema.employeeCompensationProfiles.tenantId, tenantId), inArray(schema.employeeCompensationProfiles.userId, roleUserIds), eq(schema.employeeCompensationProfiles.status, 'active')));
      const overriddenIds = new Set(overrides.map((o: any) => o.userId));
      inheritingUserIds = roleUserIds.filter((id: number) => !overriddenIds.has(id));
    }
    await notifyUsers(inheritingUserIds, 'Your salary structure has been updated', `The standard ${roleName} compensation package has changed. Check Payroll for your new breakdown.`);

    res.json({ success: true, roleDefault, components: freshComponents });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/tenant/payroll/role-defaults/:roleName', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.manage')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const tenantId = req.user.tenantId;
    const roleName = String(req.params.roleName || '').trim();
    const existing = await db.select().from(schema.roleCompensationDefaults).where(and(eq(schema.roleCompensationDefaults.tenantId, tenantId), eq(schema.roleCompensationDefaults.roleName, roleName))).limit(1);
    if (existing.length === 0) return res.status(404).json({ error: 'No default template configured for this role.' });
    await db.delete(schema.roleCompensationComponents).where(eq(schema.roleCompensationComponents.roleDefaultId, existing[0].id));
    await db.delete(schema.roleCompensationDefaults).where(eq(schema.roleCompensationDefaults.id, existing[0].id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/tenant/holidays/optional', authenticate, async (req: any, res: any) => {
  try {
    const [settings, holidays, choices] = await Promise.all([
      getOrCreatePayrollSettings(req.user.tenantId),
      db.select().from(schema.holidays).where(eq(schema.holidays.tenantId, req.user.tenantId)).orderBy(schema.holidays.date),
      db.select().from(schema.optionalHolidayChoices).where(eq(schema.optionalHolidayChoices.userId, req.user.userId)),
    ]);
    const selectedHolidayIds = new Set(choices.map((choice: any) => choice.holidayId));
    res.json({
      limit: settings.optionalHolidayLimit,
      holidays: holidays.map((holiday: any) => ({ ...holiday, selected: selectedHolidayIds.has(holiday.id) })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/tenant/holidays/optional', authenticate, async (req: any, res: any) => {
  try {
    const settings = await getOrCreatePayrollSettings(req.user.tenantId);
    const holidayIds: number[] = Array.isArray(req.body?.holidayIds) ? Array.from(new Set(req.body.holidayIds.map((id: any) => Number(id)).filter(Boolean))) : [];
    if (holidayIds.length > settings.optionalHolidayLimit) {
      return res.status(400).json({ error: `You can only select up to ${settings.optionalHolidayLimit} optional holidays.` });
    }
    if (holidayIds.length > 0) {
      const validHolidays = await db.select({ id: schema.holidays.id }).from(schema.holidays).where(
        and(
          eq(schema.holidays.tenantId, req.user.tenantId),
          inArray(schema.holidays.id, holidayIds),
        )
      );
      if (validHolidays.length !== holidayIds.length) {
        return res.status(400).json({ error: 'One or more selected holidays are invalid.' });
      }
    }
    await db.delete(schema.optionalHolidayChoices).where(eq(schema.optionalHolidayChoices.userId, req.user.userId));
    if (holidayIds.length > 0) {
      await db.insert(schema.optionalHolidayChoices).values(
        holidayIds.map((holidayId: number) => ({
          tenantId: req.user.tenantId,
          userId: req.user.userId,
          holidayId,
        }))
      );
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/tenant/holidays/import-public', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'holiday.manage')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const settings = await getOrCreatePayrollSettings(req.user.tenantId);
    const year = Number(req.body?.year || new Date().getUTCFullYear());
    const countryCode = String(req.body?.countryCode || settings.holidayCountryCode || 'IN');
    const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`);
    if (!response.ok) {
      return res.status(502).json({ error: 'Failed to fetch public holidays from upstream source.' });
    }
    const holidays = await response.json() as Array<any>;
    const existing = await db.select().from(schema.holidays).where(eq(schema.holidays.tenantId, req.user.tenantId));
    const existingKeys = new Set(existing.map((holiday: any) => `${holiday.date}:${holiday.name}`));
    const values = holidays
      .map((holiday) => ({
        tenantId: req.user.tenantId,
        date: holiday.date,
        name: holiday.localName || holiday.name,
      }))
      .filter((holiday) => !existingKeys.has(`${holiday.date}:${holiday.name}`));
    if (values.length > 0) await db.insert(schema.holidays).values(values);
    res.json({ success: true, imported: values.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
