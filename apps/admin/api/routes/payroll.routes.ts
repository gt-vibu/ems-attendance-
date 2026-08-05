import { Router } from 'express';
import { and, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { getScopedBranchIds, hasPrivilege, isPlatformFeatureAllowed } from '../auth/rbac';
import { notifyUser, notifyUsers } from '../services/notifications';
import { notify } from '../services/notificationService';
import {
  buildPayrollSummary,
  getOrCreatePayrollSettings,
  getRoleCompensationDefault,
  computeCompensationDiff,
  splitLeaveDaysForPayroll,
  NO_LEAVE_DAYS,
  resolveOvertimeHours,
  resolveAttendanceDrivenInputs,
} from './leavePayrollShared';
import { computeEmployeeEarnings } from '../services/earnings';
import { resolveMonthStatuses, computeAttendanceDrivenPayrollInputs } from '../services/attendanceDayStatus';
import type { AttendanceDrivenInputs } from './leavePayrollShared';
import { logToAuditLedger } from '../services/audit';
import { scanBatchExceptions, validateBatchForApproval, checkCalendarGate, getPendingAdjustmentsForBatch } from '../services/payrollBatch';
import { finalizePayrollBatchFinancials } from '../services/payrollBatchCalculation';
import { queue } from '../services/queue';
import { tenantParts, tenantDateKey, tenantDateTime } from '../services/tenantTime';
import { getHolidaysForEmployee } from '../services/holidayScope';

export const router = Router();

function tenantWeekendDays(tenant: any): string[] {
  if (Array.isArray(tenant?.weekendConfig)) return tenant.weekendConfig;
  if (typeof tenant?.weekendConfig === 'string') {
    try { return JSON.parse(tenant.weekendConfig); } catch { return ['Saturday', 'Sunday']; }
  }
  return ['Saturday', 'Sunday'];
}

async function leaveCalendarOptions(tenant: any, tenantId: number, userId: number) {
  const holidays = await getHolidaysForEmployee(tenantId, userId);
  return {
    weekendDays: tenantWeekendDays(tenant),
    holidayDates: new Set(holidays.map((holiday) => holiday.date)),
  };
}

router.get('/api/payroll/mine', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;
    const now = new Date();

    const [settings, profileRows, requests, policies, components, userRows, tenantRows] = await Promise.all([
      getOrCreatePayrollSettings(tenantId),
      db.select().from(schema.employeeCompensationProfiles).where(and(eq(schema.employeeCompensationProfiles.tenantId, tenantId), eq(schema.employeeCompensationProfiles.userId, userId), eq(schema.employeeCompensationProfiles.status, 'active'))).orderBy(desc(schema.employeeCompensationProfiles.id)).limit(1),
      db.select().from(schema.leaveRequests).where(and(eq(schema.leaveRequests.tenantId, tenantId), eq(schema.leaveRequests.userId, userId), eq(schema.leaveRequests.status, 'approved'))),
      db.select().from(schema.leavePolicies).where(eq(schema.leavePolicies.tenantId, tenantId)),
      db.select().from(schema.employeeSalaryComponents).where(and(eq(schema.employeeSalaryComponents.tenantId, tenantId), eq(schema.employeeSalaryComponents.userId, userId))).orderBy(schema.employeeSalaryComponents.sortOrder),
      db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1),
      db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1),
    ]);

    // Tenant-local "what period is it right now" default — a non-UTC
    // tenant near a month/year boundary used to get defaulted to the
    // wrong period here (server UTC getters).
    const tParts = tenantParts(tenantRows[0] || null, now);
    const year = Number(req.query.year || tParts.year);
    const month = Number(req.query.month || tParts.month);

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

    const leaveDays = splitLeaveDaysForPayroll(requests, policies, year, month, await leaveCalendarOptions(tenantRows[0], tenantId, userId));
    const overtimeHours = await resolveOvertimeHours(!!tenantRows[0]?.overtimePayrollEnabled, userId, tenantId, year, month);
    const attendanceDriven = await resolveAttendanceDrivenInputs(tenantRows[0], userId, tenantId, year, month);
    const summary = buildPayrollSummary(profile, effectiveComponents, settings, leaveDays, overtimeHours, attendanceDriven);
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
// PURE READ-ONLY endpoint: Returns recorded payroll snapshots for the authenticated user.
// Performs ZERO calculations and ZERO database inserts/mutations.
router.get('/api/payroll/history', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;

    const history = await db.select().from(schema.payrollRuns)
      .where(and(eq(schema.payrollRuns.tenantId, tenantId), eq(schema.payrollRuns.userId, userId)))
      .orderBy(desc(schema.payrollRuns.year), desc(schema.payrollRuns.month));

    res.json({ history });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Dedicated HR / Admin Payroll Processing Engine: Allows HR to explicitly calculate
// and snapshot payroll runs for any target pay period (e.g. July 2026, August 2026).
router.post('/api/tenant/payroll/process', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.manage')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges to process payroll.' });
    }

    const tenantId = req.user.tenantId;
    const { year, month, userId: targetUserId } = req.body || {};

    if (!year || !month) {
      return res.status(400).json({ error: 'year and month are required (e.g. { year: 2026, month: 7 }).' });
    }

    // Determine target users (either single user or all employees in tenant)
    const targetUsers = targetUserId
      ? await db.select().from(schema.users).where(and(eq(schema.users.id, Number(targetUserId)), eq(schema.users.tenantId, tenantId)))
      : await db.select().from(schema.users).where(eq(schema.users.tenantId, tenantId));

    const settings = await getOrCreatePayrollSettings(tenantId);
    const [tenantRows, policies] = await Promise.all([
      db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1),
      db.select().from(schema.leavePolicies).where(eq(schema.leavePolicies.tenantId, tenantId)),
    ]);

    let processedCount = 0;

    for (const u of targetUsers) {
      // Skip if locked run already exists for this period
      const existingLocked = await db.select().from(schema.payrollRuns).where(and(
        eq(schema.payrollRuns.tenantId, tenantId),
        eq(schema.payrollRuns.userId, u.id),
        eq(schema.payrollRuns.year, Number(year)),
        eq(schema.payrollRuns.month, Number(month)),
        eq(schema.payrollRuns.status, 'locked')
      )).limit(1);

      if (existingLocked.length > 0) continue;

      const profileRows = await db.select().from(schema.employeeCompensationProfiles).where(and(
        eq(schema.employeeCompensationProfiles.tenantId, tenantId),
        eq(schema.employeeCompensationProfiles.userId, u.id),
        eq(schema.employeeCompensationProfiles.status, 'active')
      )).orderBy(desc(schema.employeeCompensationProfiles.id)).limit(1);

      const components = await db.select().from(schema.employeeSalaryComponents).where(and(
        eq(schema.employeeSalaryComponents.tenantId, tenantId),
        eq(schema.employeeSalaryComponents.userId, u.id)
      )).orderBy(schema.employeeSalaryComponents.sortOrder);

      const requests = await db.select().from(schema.leaveRequests).where(and(
        eq(schema.leaveRequests.tenantId, tenantId),
        eq(schema.leaveRequests.userId, u.id),
        eq(schema.leaveRequests.status, 'approved')
      ));

      let profile: any = profileRows[0] || null;
      let effectiveComponents = components;

      if (!profile) {
        const roleDefault = await getRoleCompensationDefault(tenantId, u.role || '');
        if (roleDefault) {
          profile = { annualCtc: roleDefault.roleDefault.annualCtc, overtimeHourlyRate: null, effectiveFrom: null, status: 'active' };
          effectiveComponents = roleDefault.components;
        }
      }

      if (profile) {
        const leaveDays = splitLeaveDaysForPayroll(requests, policies, Number(year), Number(month), await leaveCalendarOptions(tenantRows[0], tenantId, u.id));
        const overtimeHours = await resolveOvertimeHours(!!tenantRows[0]?.overtimePayrollEnabled, u.id, tenantId, Number(year), Number(month));
        const attendanceDriven = await resolveAttendanceDrivenInputs(tenantRows[0], u.id, tenantId, Number(year), Number(month));
        const summary = buildPayrollSummary(profile, effectiveComponents, settings, leaveDays, overtimeHours, attendanceDriven, Number(year), Number(month));

        await db.insert(schema.payrollRuns).values({
          tenantId,
          userId: u.id,
          profileId: profile.id ?? null,
          year: Number(year),
          month: Number(month),
          workingDays: summary.workingDays,
          approvedLeaveDays: leaveDays.totalDays,
          unpaidAbsenceDays: summary.unpaidAbsenceDays,
          lopDeduction: summary.lopDeduction,
          overtimeHours,
          grossPay: summary.monthlyGross,
          leaveDeduction: summary.leaveDeduction,
          overtimePay: summary.overtimePay,
          netPay: summary.monthlyNet,
          breakdown: summary.annualBreakdown,
          status: 'generated',
          version: 1,
        }).onConflictDoNothing({ target: [schema.payrollRuns.userId, schema.payrollRuns.year, schema.payrollRuns.month, schema.payrollRuns.version] });

        processedCount++;
      }
    }

    res.json({ success: true, processedCount, year: Number(year), month: Number(month) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Locks a generated payroll run — one-way, per the roadmap's "never
// silently modify historical payroll" principle. There is deliberately no
// unlock endpoint: a mistaken lock is corrected by issuing a Payroll
// Adjustment, same as any other post-lock change would be.
router.post('/api/tenant/payroll/:runId/lock', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.lock')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const runId = Number(req.params.runId);
    const locked = await db.transaction(async (tx: any) => {
      const [run] = await tx.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.id, runId)).limit(1);
      if (!run || run.tenantId !== req.user.tenantId) {
        return { notFound: true } as const;
      }
      if (run.status === 'locked') {
        return { alreadyLocked: true } as const;
      }
      // Guard the UPDATE itself on status='generated' so a concurrent lock
      // request racing this one is a no-op instead of a double-apply — the
      // SELECT above is just for the friendly error message, not the safety.
      const result = await tx.update(schema.payrollRuns)
        .set({ status: 'locked' })
        .where(and(eq(schema.payrollRuns.id, runId), eq(schema.payrollRuns.status, run.status)))
        .returning({ id: schema.payrollRuns.id });
      if (result.length === 0) {
        return { alreadyLocked: true } as const;
      }
      return { ok: true } as const;
    });
    if ('notFound' in locked && locked.notFound) {
      return res.status(404).json({ error: 'Payroll run not found.' });
    }
    if ('alreadyLocked' in locked && locked.alreadyLocked) {
      return res.status(400).json({ error: 'This payroll run is already locked.' });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Pending adjustments for an employee (or, with payroll.read, the whole
// tenant) — created automatically when an attendance correction is
// approved against a date inside an already-locked payroll run (see
// review.routes.ts). HR applies each one explicitly rather than it
// silently folding into a future number.
router.get('/api/tenant/payroll/adjustments', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.read') && !await hasPrivilege(req.user, 'payroll.manage')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const DEFAULT_LIST_LIMIT = 500;
    const MAX_LIST_LIMIT = 2000;
    const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, Number(req.query.limit) || DEFAULT_LIST_LIMIT));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const rows = await db.select().from(schema.payrollAdjustments)
      .where(eq(schema.payrollAdjustments.tenantId, req.user.tenantId))
      .orderBy(desc(schema.payrollAdjustments.createdAt))
      .limit(limit)
      .offset(offset);
    // Batched name lookup instead of one query per row (N+1) — a single
    // IN(...) query for every distinct userId on this page.
    const userIds: number[] = Array.from(new Set<number>(rows.map((r: any) => r.userId as number)));
    const nameRows = userIds.length > 0
      ? await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, userIds))
      : [];
    const nameById = new Map(nameRows.map((u: any) => [u.id, u.name]));
    const withNames = rows.map((r: any) => ({ ...r, userName: nameById.get(r.userId) || 'Unknown' }));
    res.json({ adjustments: withNames, pagination: { limit, offset, returned: rows.length } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Marks an adjustment resolved — either "fold it into the next payroll
// cycle" (the actual folding happens the next time /api/payroll/history
// generates a run for that employee, which should read pending adjustments
// for the prior period — left as a manual reconciliation step for now
// rather than an automatic silent fold, consistent with "HR resolves it
// explicitly") or a standalone acknowledgement that it was paid out another
// way (an off-cycle adjustment payslip, handled outside this system).
router.post('/api/tenant/payroll/adjustments/:id/apply', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.manage')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const id = Number(req.params.id);
    const applyToNextCycle = !!req.body?.applyToNextCycle;

    const outcome = await db.transaction(async (tx: any) => {
      const [adjustment] = await tx.select().from(schema.payrollAdjustments).where(eq(schema.payrollAdjustments.id, id)).limit(1);
      if (!adjustment || adjustment.tenantId !== req.user.tenantId) {
        return { notFound: true } as const;
      }
      if (adjustment.status === 'applied') {
        return { alreadyApplied: true } as const;
      }
      // Guard the UPDATE on status='pending' so a concurrent apply request
      // for the same adjustment can't both pass the check above and both
      // insert a superseding payroll run version below.
      const claimed = await tx.update(schema.payrollAdjustments).set({
        status: 'applied',
        appliedToNextCycle: applyToNextCycle,
        appliedAt: new Date(),
      }).where(and(eq(schema.payrollAdjustments.id, id), eq(schema.payrollAdjustments.status, adjustment.status)))
        .returning({ id: schema.payrollAdjustments.id });
      if (claimed.length === 0) {
        return { alreadyApplied: true } as const;
      }

      // Versioned Payslips: applying an adjustment against an already-
      // released/locked period never overwrites the original payslip row —
      // it inserts a new version pointing back at the one it supersedes, so
      // both the original and the revised payslip stay downloadable (see
      // GET /api/payroll/history/:runId/pdf, which is keyed by runId and
      // therefore already works unchanged for either version). Skipped
      // entirely when applyToNextCycle is true — that path intentionally
      // folds into the NEXT period's calculation instead of revising this one.
      if (!applyToNextCycle) {
        const latestVersions = await tx.select().from(schema.payrollRuns)
          .where(eq(schema.payrollRuns.id, adjustment.payrollRunId))
          .limit(1);
        const originalRun = latestVersions[0];
        if (originalRun) {
          const allVersions = await tx.select().from(schema.payrollRuns).where(
            and(eq(schema.payrollRuns.userId, originalRun.userId), eq(schema.payrollRuns.year, originalRun.year), eq(schema.payrollRuns.month, originalRun.month))
          ).orderBy(desc(schema.payrollRuns.version));
          const latest = allVersions[0] || originalRun;
          const newBreakdown = [...(Array.isArray(latest.breakdown) ? latest.breakdown : []), { type: 'adjustment', amount: adjustment.amountDelta, reason: adjustment.reason }];
          await tx.insert(schema.payrollRuns).values({
            tenantId: latest.tenantId, userId: latest.userId, profileId: latest.profileId, year: latest.year, month: latest.month,
            batchId: latest.batchId, version: latest.version + 1, supersedesRunId: latest.id,
            workingDays: latest.workingDays, approvedLeaveDays: latest.approvedLeaveDays, unpaidAbsenceDays: latest.unpaidAbsenceDays,
            lopDeduction: latest.lopDeduction, overtimeHours: latest.overtimeHours, grossPay: latest.grossPay,
            leaveDeduction: latest.leaveDeduction, overtimePay: latest.overtimePay,
            netPay: latest.netPay + adjustment.amountDelta, breakdown: newBreakdown, status: latest.status,
          });
        }
      }

      return { ok: true, adjustment } as const;
    });

    if ('notFound' in outcome && outcome.notFound) {
      return res.status(404).json({ error: 'Adjustment not found.' });
    }
    if ('alreadyApplied' in outcome && outcome.alreadyApplied) {
      return res.status(400).json({ error: 'This adjustment has already been applied.' });
    }
    const adjustment = outcome.adjustment;

    await logToAuditLedger({
      tenantId: req.user.tenantId,
      actorId: req.user.userId,
      actorName: req.user.name,
      action: 'PAYROLL_ADJUSTMENT_APPLIED',
      details: { adjustmentId: id, subjectUserId: adjustment.userId, amountDelta: adjustment.amountDelta, applyToNextCycle },
    });

    const employeeRowsAdj = await db.select().from(schema.users).where(eq(schema.users.id, adjustment.userId)).limit(1);
    if (employeeRowsAdj.length > 0) {
      const tenantRowAdj = (await db.select().from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId)).limit(1))[0];
      if (isPlatformFeatureAllowed(tenantRowAdj, 'unified_notifications')) {
        await notify(req.user.tenantId, 'payroll_salary_changed', {
          subjectUserId: adjustment.userId,
          subjectName: employeeRowsAdj[0].name,
          data: { amountDelta: adjustment.amountDelta, applyToNextCycle, reason: 'Payroll adjustment applied' },
        }).catch(() => undefined);
      } else {
        await notifyUser(adjustment.userId, 'Payroll adjustment applied', `A payroll adjustment of ${adjustment.amountDelta} has been applied to your record${applyToNextCycle ? ' and will be reflected in your next payroll cycle' : ''}.`);
      }
    }

    res.json({ success: true });
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
      lopCalculationPolicy: ['fixed_26', 'calendar_days', 'working_days'].includes(req.body?.lopCalculationPolicy) ? req.body.lopCalculationPolicy : (current.lopCalculationPolicy || 'fixed_26'),
      monthlySalaryBasis: ['30_days', 'actual_calendar_days', 'working_days'].includes(req.body?.monthlySalaryBasis) ? req.body.monthlySalaryBasis : (current.monthlySalaryBasis || 'actual_calendar_days'),
      includePaidHolidays: req.body?.includePaidHolidays !== undefined ? !!req.body.includePaidHolidays : (current.includePaidHolidays ?? true),
      includePaidWeekends: req.body?.includePaidWeekends !== undefined ? !!req.body.includePaidWeekends : (current.includePaidWeekends ?? true),
      includeApprovedPaidLeave: req.body?.includeApprovedPaidLeave !== undefined ? !!req.body.includeApprovedPaidLeave : (current.includeApprovedPaidLeave ?? true),
      maxPaidLeaveDaysPerMonth: Number(req.body?.maxPaidLeaveDaysPerMonth ?? current.maxPaidLeaveDaysPerMonth),
      excessLeavePenaltyPercent: Number(req.body?.excessLeavePenaltyPercent ?? current.excessLeavePenaltyPercent),
      overtimeHourlyRate: Number(req.body?.overtimeHourlyRate ?? current.overtimeHourlyRate),
      optionalHolidayLimit: Number(req.body?.optionalHolidayLimit ?? current.optionalHolidayLimit),
      holidayCountryCode: req.body?.holidayCountryCode || current.holidayCountryCode,
      holidayRegionCode: req.body?.holidayRegionCode ?? current.holidayRegionCode,
      // --- Statutory compliance ---
      statutoryComplianceEnabled: req.body?.statutoryComplianceEnabled !== undefined ? !!req.body.statutoryComplianceEnabled : current.statutoryComplianceEnabled,
      pfEnabled: req.body?.pfEnabled !== undefined ? !!req.body.pfEnabled : current.pfEnabled,
      pfEmployeeRatePercent: Number(req.body?.pfEmployeeRatePercent ?? current.pfEmployeeRatePercent),
      pfEmployerRatePercent: Number(req.body?.pfEmployerRatePercent ?? current.pfEmployerRatePercent),
      pfWageCeiling: Number(req.body?.pfWageCeiling ?? current.pfWageCeiling),
      esiEnabled: req.body?.esiEnabled !== undefined ? !!req.body.esiEnabled : current.esiEnabled,
      esiEmployeeRatePercent: Number(req.body?.esiEmployeeRatePercent ?? current.esiEmployeeRatePercent),
      esiEmployerRatePercent: Number(req.body?.esiEmployerRatePercent ?? current.esiEmployerRatePercent),
      esiWageCeiling: Number(req.body?.esiWageCeiling ?? current.esiWageCeiling),
      professionalTaxEnabled: req.body?.professionalTaxEnabled !== undefined ? !!req.body.professionalTaxEnabled : current.professionalTaxEnabled,
      professionalTaxSlabs: Array.isArray(req.body?.professionalTaxSlabs) ? req.body.professionalTaxSlabs : current.professionalTaxSlabs,
      tdsEnabled: req.body?.tdsEnabled !== undefined ? !!req.body.tdsEnabled : current.tdsEnabled,
      incomeTaxSlabs: Array.isArray(req.body?.incomeTaxSlabs) ? req.body.incomeTaxSlabs : current.incomeTaxSlabs,
      tdsStandardDeduction: Number(req.body?.tdsStandardDeduction ?? current.tdsStandardDeduction),
      statutoryBasicPercentOfGross: Number(req.body?.statutoryBasicPercentOfGross ?? current.statutoryBasicPercentOfGross),
      blockPayrollReleaseOnPendingAdjustments: req.body?.blockPayrollReleaseOnPendingAdjustments !== undefined ? !!req.body.blockPayrollReleaseOnPendingAdjustments : current.blockPayrollReleaseOnPendingAdjustments,
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
    // SEGREGATION OF DUTIES: a delegated 'payroll.manage' grant (e.g. a
    // manager) must never let its holder set their OWN pay — tenant_admin/
    // super_admin are the org's own ultimate authority and are exempt, same
    // as every other unrestricted-role carve-out in this codebase.
    if (userId === req.user.userId && req.user.role !== 'tenant_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Access denied: You cannot set up your own payroll. Ask a tenant admin or another payroll manager to configure it.' });
    }
    const employeeRows = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (employeeRows.length === 0 || employeeRows[0].tenantId !== req.user.tenantId) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const existing = await db.select().from(schema.employeeCompensationProfiles).where(and(eq(schema.employeeCompensationProfiles.userId, userId), eq(schema.employeeCompensationProfiles.tenantId, req.user.tenantId), eq(schema.employeeCompensationProfiles.status, 'active'))).limit(1);
    // Snapshot the OLD state before anything is overwritten — the save
    // below deletes the old component rows outright, so this is the only
    // chance to capture what they were for compensation_history.
    const previousProfile = existing[0] || null;
    const previousComponents = previousProfile
      ? await db.select().from(schema.employeeSalaryComponents).where(eq(schema.employeeSalaryComponents.profileId, previousProfile.id)).orderBy(schema.employeeSalaryComponents.sortOrder)
      : [];

    // Tenant-local "today" default — this value later drives mid-month
    // salary-revision proration boundary math (payrollBatchCalculation.ts),
    // so a server-UTC "today" here could misclassify which pay period a
    // revision belongs to for a non-UTC tenant.
    const tenantRowEff = req.body?.effectiveFrom ? null : (await db.select({ timezone: schema.tenants.timezone }).from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId)).limit(1))[0] || null;
    const payload = {
      tenantId: req.user.tenantId,
      userId,
      annualCtc: Number(req.body?.annualCtc || 0),
      overtimeHourlyRate: req.body?.overtimeHourlyRate != null ? Number(req.body.overtimeHourlyRate) : null,
      effectiveFrom: req.body?.effectiveFrom || tenantDateKey(tenantRowEff),
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

    const fieldChanges = computeCompensationDiff(previousProfile, previousComponents, profile, freshComponents);
    await db.insert(schema.compensationHistory).values({
      tenantId: req.user.tenantId,
      userId,
      changedByUserId: req.user.userId,
      effectiveFrom: payload.effectiveFrom,
      previousAnnualCtc: previousProfile?.annualCtc ?? null,
      newAnnualCtc: profile.annualCtc,
      previousComponents: previousComponents,
      newComponents: freshComponents,
      fieldChanges,
    });

    const tenantForNotify = (await db.select().from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId)).limit(1))[0];
    if (isPlatformFeatureAllowed(tenantForNotify, 'unified_notifications')) {
      await notify(req.user.tenantId, 'payroll_salary_changed', {
        subjectUserId: userId,
        subjectName: employeeRows[0].name,
        data: { effectiveFrom: payload.effectiveFrom },
      }).catch(() => undefined);
    } else {
      await notifyUser(userId, 'Your salary has been updated', `Your compensation has been updated, effective ${payload.effectiveFrom}. Check Payroll for the new breakdown.`);
    }
    res.json({ success: true, profile, components: freshComponents });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Shared by both history endpoints below (admin-viewing-any-employee and
// employee-viewing-their-own) so the response shape can never drift between
// the two — same query, same fields, just a different caller/target pairing
// and privilege check at each route.
async function buildCompensationHistoryResponse(tenantId: number, userId: number) {
  const employeeRows = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (employeeRows.length === 0 || employeeRows[0].tenantId !== tenantId) {
    return null;
  }

  const rows = await db.select().from(schema.compensationHistory)
    .where(and(eq(schema.compensationHistory.tenantId, tenantId), eq(schema.compensationHistory.userId, userId)))
    .orderBy(desc(schema.compensationHistory.createdAt));

  const changedByIds: number[] = Array.from(new Set(rows.map((r: any) => r.changedByUserId).filter((id: any): id is number => !!id)));
  const changedByUsers = changedByIds.length > 0
    ? await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, changedByIds))
    : [];
  const changedByName = new Map(changedByUsers.map((u: any) => [u.id, u.name || u.email]));

  return {
    employee: { id: employeeRows[0].id, name: employeeRows[0].name, email: employeeRows[0].email, role: employeeRows[0].role },
    history: rows.map((r: any) => ({
      id: r.id,
      changedAt: r.createdAt,
      changedByName: changedByName.get(r.changedByUserId) || 'System',
      effectiveFrom: r.effectiveFrom,
      previousAnnualCtc: r.previousAnnualCtc,
      newAnnualCtc: r.newAnnualCtc,
      fieldChanges: r.fieldChanges,
      isFirstSetup: r.previousAnnualCtc === null,
    })),
  };
}

// Every recorded compensation change for one employee — CTC, and each
// salary component (Basic/HRA/PF/allowances/deductions) added, removed, or
// changed in value — newest first. Same read privilege as the profile
// itself (payroll.read/employee.read); an employee with zero history (never
// had their pay set, or only ever set once with nothing to diff against)
// still gets a 200 with an empty array — the frontend renders that as "no
// changes recorded" rather than treating it as an error.
router.get('/api/tenant/payroll/employee/:userId/history', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.read') && !await hasPrivilege(req.user, 'employee.read')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const userId = Number(req.params.userId);
    const result = await buildCompensationHistoryResponse(req.user.tenantId, userId);
    if (!result) return res.status(404).json({ error: 'Employee not found.' });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Self-service counterpart — every employee (any role) can see their OWN
// compensation change history, same "mine" pattern as /api/payroll/mine and
// /api/earnings/mine: no privilege check beyond being authenticated, since
// the target is always the caller's own userId, never anyone else's.
router.get('/api/payroll/compensation-history/mine', authenticate, async (req: any, res: any) => {
  try {
    const result = await buildCompensationHistoryResponse(req.user.tenantId, req.user.userId);
    if (!result) return res.status(404).json({ error: 'User not found.' });
    res.json(result);
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
    const tenantRowEarly = (await db.select().from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId)).limit(1))[0] || null;
    const tPartsEarly = tenantParts(tenantRowEarly, new Date());
    const year = Number(req.query.year || tPartsEarly.year);
    const month = Number(req.query.month || tPartsEarly.month);
    const employeeRows = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (employeeRows.length === 0 || employeeRows[0].tenantId !== req.user.tenantId) {
      return res.status(404).json({ error: 'Employee not found.' });
    }
    const employee = employeeRows[0];
    // Month window used to scope attendanceRows so an admin can page through
    // an arbitrary employee's calendar (including past months) instead of
    // only ever seeing their most recent ~15 days of check-ins/outs.
    // Tenant-local calendar-month boundaries — a naive Date.UTC() window
    // disagrees with tenantDateKey()-based day bucketing (used everywhere
    // a log's "which day is this" is decided, e.g. attendanceDayStatus.ts)
    // by the tenant's UTC offset.
    const monthStart = tenantDateTime(tenantRowEarly, `${year}-${String(month).padStart(2, '0')}-01`, 0, 0);
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextMonthYear = month === 12 ? year + 1 : year;
    const monthEnd = tenantDateTime(tenantRowEarly, `${nextMonthYear}-${String(nextMonth).padStart(2, '0')}-01`, 0, 0);
    const [settings, profileRows, components, leaveRows, policies, attendanceRows] = await Promise.all([
      getOrCreatePayrollSettings(req.user.tenantId),
      db.select().from(schema.employeeCompensationProfiles).where(and(eq(schema.employeeCompensationProfiles.tenantId, req.user.tenantId), eq(schema.employeeCompensationProfiles.userId, userId), eq(schema.employeeCompensationProfiles.status, 'active'))).orderBy(desc(schema.employeeCompensationProfiles.id)).limit(1),
      db.select().from(schema.employeeSalaryComponents).where(and(eq(schema.employeeSalaryComponents.tenantId, req.user.tenantId), eq(schema.employeeSalaryComponents.userId, userId))).orderBy(schema.employeeSalaryComponents.sortOrder),
      db.select().from(schema.leaveRequests).where(and(eq(schema.leaveRequests.tenantId, req.user.tenantId), eq(schema.leaveRequests.userId, userId), eq(schema.leaveRequests.status, 'approved'))),
      db.select().from(schema.leavePolicies).where(eq(schema.leavePolicies.tenantId, req.user.tenantId)),
      db.select().from(schema.attendanceLogs).where(and(eq(schema.attendanceLogs.tenantId, req.user.tenantId), eq(schema.attendanceLogs.userId, userId), gte(schema.attendanceLogs.createdAt, monthStart), lt(schema.attendanceLogs.createdAt, monthEnd))).orderBy(schema.attendanceLogs.createdAt),
    ]);
    const tenantRows = [tenantRowEarly];
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

    const leaveDays = splitLeaveDaysForPayroll(leaveRows, policies, year, month, await leaveCalendarOptions(tenantRows[0], req.user.tenantId, userId));
    const overtimeHours = profile ? await resolveOvertimeHours(!!tenantRows[0]?.overtimePayrollEnabled, userId, req.user.tenantId, year, month) : 0;
    const attendanceDriven = profile ? await resolveAttendanceDrivenInputs(tenantRows[0], userId, req.user.tenantId, year, month) : null;
    const summary = profile ? buildPayrollSummary(profile, effectiveComponents, settings, leaveDays, overtimeHours, attendanceDriven) : null;
    // Canonical per-day status (services/attendanceDayStatus.ts) — the
    // single source of truth the calendar UI should render from instead of
    // re-deriving status client-side from attendanceRows/leaveRows/holidays
    // separately (see EmployeeDetailPanel.tsx, cut over to this in the same
    // change that added this field).
    const dayStatuses = Object.fromEntries(await resolveMonthStatuses(req.user.tenantId, userId, year, month));
    res.json({ employee, profile, components: effectiveComponents, summary, settings, leaveRows, attendanceRows, dayStatuses, period: { year, month }, source });
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
    const tenantRowOverview = (await db.select({ timezone: schema.tenants.timezone }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1))[0] || null;
    const tPartsOverview = tenantParts(tenantRowOverview, new Date());
    const year = Number(req.query.year || tPartsOverview.year);
    const month = Number(req.query.month || tPartsOverview.month);
    const scopedBranchIds = await getScopedBranchIds(req.user);
    const users = scopedBranchIds === null
      ? await db.select().from(schema.users).where(and(eq(schema.users.tenantId, tenantId), sql`role != 'tenant_admin'`))
      : await db.select().from(schema.users).where(and(eq(schema.users.tenantId, tenantId), sql`role != 'tenant_admin'`, inArray(schema.users.branchId, scopedBranchIds)));
    const userIds = users.map((user: any) => user.id);
    const [settings, profiles, components, leaveRows, policies] = await Promise.all([
      getOrCreatePayrollSettings(tenantId),
      userIds.length > 0 ? db.select().from(schema.employeeCompensationProfiles).where(and(eq(schema.employeeCompensationProfiles.tenantId, tenantId), inArray(schema.employeeCompensationProfiles.userId, userIds), eq(schema.employeeCompensationProfiles.status, 'active'))) : [],
      userIds.length > 0 ? db.select().from(schema.employeeSalaryComponents).where(and(eq(schema.employeeSalaryComponents.tenantId, tenantId), inArray(schema.employeeSalaryComponents.userId, userIds))) : [],
      userIds.length > 0 ? db.select().from(schema.leaveRequests).where(and(eq(schema.leaveRequests.tenantId, tenantId), inArray(schema.leaveRequests.userId, userIds), eq(schema.leaveRequests.status, 'approved'))) : [],
      db.select().from(schema.leavePolicies).where(eq(schema.leavePolicies.tenantId, tenantId)),
    ]);
    const componentsByUser = new Map<number, any[]>();
    components.forEach((component: any) => {
      const list = componentsByUser.get(component.userId) || [];
      list.push(component);
      componentsByUser.set(component.userId, list);
    });
    const leaveRequestsByUser = new Map<number, any[]>();
    leaveRows.forEach((request: any) => {
      const list = leaveRequestsByUser.get(request.userId) || [];
      list.push(request);
      leaveRequestsByUser.set(request.userId, list);
    });
    const leaveCalendarByUser = new Map<number, Awaited<ReturnType<typeof leaveCalendarOptions>>>();
    await Promise.all(userIds.map(async (userId: number) => {
      leaveCalendarByUser.set(userId, await leaveCalendarOptions(tenantRowOverview, tenantId, userId));
    }));
    const leaveDaysByUser = (userId: number) => splitLeaveDaysForPayroll(
      leaveRequestsByUser.get(userId) || [],
      policies,
      year,
      month,
      leaveCalendarByUser.get(userId)
    );

    const [overtimeHoursMap, attendanceDrivenMap] = await Promise.all([
      Promise.all(userIds.map(async (uId) => [uId, await resolveOvertimeHours(!!tenantRowOverview?.overtimePayrollEnabled, uId, tenantId, year, month)] as [number, number])),
      Promise.all(userIds.map(async (uId) => [uId, await resolveAttendanceDrivenInputs(tenantRowOverview, uId, tenantId, year, month)] as [number, AttendanceDrivenInputs | null])),
    ]);
    const overtimeByUser = new Map<number, number>(overtimeHoursMap);
    const attendanceDrivenByUser = new Map<number, AttendanceDrivenInputs | null>(attendanceDrivenMap);

    const individualRows = profiles.map((profile: any) => {
      const user = users.find((row: any) => row.id === profile.userId);
      const summary = buildPayrollSummary(
        profile,
        componentsByUser.get(profile.userId) || [],
        settings,
        leaveDaysByUser(profile.userId),
        overtimeByUser.get(profile.userId) || 0,
        attendanceDrivenByUser.get(profile.userId) || null,
        year,
        month
      );
      return {
        userId: profile.userId,
        employeeId: profile.userId,
        name: user?.name || 'Employee',
        employeeName: user?.name || 'Employee',
        email: user?.email || '',
        employeeEmail: user?.email || '',
        role: user?.role || '',
        department: user?.department || 'Unassigned',
        annualCtc: summary.annualCtc,
        monthlyGross: summary.monthlyGross,
        monthlyNet: summary.monthlyNet,
        leaveDeduction: summary.leaveDeduction,
        totalDeductions: summary.leaveDeduction,
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

    const roleDefaultCoveredRows: any[] = [];
    const unconfiguredRows: any[] = [];

    usersWithoutProfile.forEach((user: any) => {
      const roleDefault = roleDefaultByRoleName.get(user.role);
      const summary = buildPayrollSummary(
        { annualCtc: roleDefault ? roleDefault.annualCtc : 0 },
        roleDefault ? (roleComponentsByDefaultId.get(roleDefault.id) || []) : [],
        settings,
        leaveDaysByUser(user.id),
        overtimeByUser.get(user.id) || 0,
        attendanceDrivenByUser.get(user.id) || null,
        year,
        month
      );
      const row = {
        userId: user.id,
        employeeId: user.id,
        name: user.name || 'Employee',
        employeeName: user.name || 'Employee',
        email: user.email || '',
        employeeEmail: user.email || '',
        role: user.role || '',
        department: user.department || 'Unassigned',
        annualCtc: summary.annualCtc,
        monthlyGross: summary.monthlyGross,
        monthlyNet: summary.monthlyNet,
        leaveDeduction: summary.leaveDeduction,
        totalDeductions: summary.leaveDeduction,
        annualBreakdown: summary.annualBreakdown,
        source: roleDefault ? 'role_default' : 'unconfigured',
      };

      if (roleDefault) {
        roleDefaultCoveredRows.push(row);
      } else {
        unconfiguredRows.push(row);
      }
    });

    const profileRows = [...individualRows, ...roleDefaultCoveredRows, ...unconfiguredRows];

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
    // hasPrivilege() returns true unconditionally for super_admin (they can
    // do anything, everywhere) — but super_admin has no tenantId, and every
    // query below is scoped to one. Without this guard, tenantId is
    // undefined, Drizzle throws trying to bind it as a query parameter, and
    // the generic catch below turns that into an opaque 500 instead of a
    // clear "this is a tenant-scoped endpoint" error.
    if (!req.user.tenantId) {
      return res.status(400).json({ error: 'This endpoint is scoped to a single tenant — no tenant context for this account.' });
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
      const summary = buildPayrollSummary({ annualCtc: d.annualCtc }, comps, settings, NO_LEAVE_DAYS, 0);
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
    const tenantForRoleNotify = (await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1))[0];
    if (isPlatformFeatureAllowed(tenantForRoleNotify, 'unified_notifications')) {
      const inheritingUsers = inheritingUserIds.length > 0
        ? await db.select().from(schema.users).where(inArray(schema.users.id, inheritingUserIds))
        : [];
      await Promise.all(inheritingUsers.map((u: any) =>
        notify(tenantId, 'payroll_salary_changed', { subjectUserId: u.id, subjectName: u.name, data: { role: roleName } }).catch(() => undefined)
      ));
    } else {
      await notifyUsers(inheritingUserIds, 'Your salary structure has been updated', `The standard ${roleName} compensation package has changed. Check Payroll for your new breakdown.`);
    }

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

// ============================================================================
// Payroll Batches (P1) — a first-class Payroll Run for a whole employee
// population, gated behind the 'payroll_batches' platform feature. Every
// route below is additive: a tenant that hasn't opted in never sees these
// endpoints do anything, and the pre-existing lazy per-employee payrollRuns
// path (above) is completely untouched. See services/payrollBatch.ts for
// the Exception Center / Validation Engine / calendar-gating logic.
// ============================================================================

async function requireBatchFeature(req: any, res: any): Promise<boolean> {
  const tenantRow = (await db.select().from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId)).limit(1))[0];
  if (!isPlatformFeatureAllowed(tenantRow, 'payroll_batches')) {
    res.status(403).json({ error: 'Payroll Batches is not enabled for your organization.' });
    return false;
  }
  return true;
}

router.get('/api/tenant/payroll/calendar', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.read') && !await hasPrivilege(req.user, 'payroll.manage')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const rows = await db.select().from(schema.payrollCalendars).where(eq(schema.payrollCalendars.tenantId, req.user.tenantId)).orderBy(desc(schema.payrollCalendars.year), desc(schema.payrollCalendars.month));
    res.json({ calendars: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/tenant/payroll/calendar', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.calendar.manage')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const { year, month, attendanceFreezeDate, calculationDate, hrReviewDate, financeReviewDate, releaseDate, salaryCreditDate } = req.body || {};
    if (!year || !month) return res.status(400).json({ error: 'year and month are required.' });

    const existing = await db.select().from(schema.payrollCalendars).where(and(eq(schema.payrollCalendars.tenantId, req.user.tenantId), eq(schema.payrollCalendars.year, Number(year)), eq(schema.payrollCalendars.month, Number(month)))).limit(1);
    const payload = { attendanceFreezeDate, calculationDate, hrReviewDate, financeReviewDate, releaseDate, salaryCreditDate };
    let saved;
    if (existing.length > 0) {
      [saved] = await db.update(schema.payrollCalendars).set(payload).where(eq(schema.payrollCalendars.id, existing[0].id)).returning();
    } else {
      [saved] = await db.insert(schema.payrollCalendars).values({ tenantId: req.user.tenantId, year: Number(year), month: Number(month), ...payload }).returning();
    }
    res.json({ calendar: saved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/tenant/payroll/batches', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.read') && !await hasPrivilege(req.user, 'payroll.manage')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const rows = await db.select().from(schema.payrollBatches).where(eq(schema.payrollBatches.tenantId, req.user.tenantId)).orderBy(desc(schema.payrollBatches.year), desc(schema.payrollBatches.month));
    res.json({ batches: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/tenant/payroll/batches/:id/exceptions', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.read') && !await hasPrivilege(req.user, 'payroll.manage')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const rows = await db.select().from(schema.payrollBatches).where(eq(schema.payrollBatches.id, Number(req.params.id))).limit(1);
    if (rows.length === 0 || rows[0].tenantId !== req.user.tenantId) return res.status(404).json({ error: 'Batch not found.' });
    const exceptions = await scanBatchExceptions(req.user.tenantId, rows[0].year, rows[0].month);

    // Pending Payroll Adjustments (e.g. an attendance correction approved
    // against an already-locked prior period) are surfaced here explicitly
    // instead of living only on a separate screen HR might never check.
    // Whether this BLOCKS release or only warns is the tenant's own choice
    // (payroll_settings.blockPayrollReleaseOnPendingAdjustments) — the
    // exception itself is always shown either way.
    const pendingAdjustments = await getPendingAdjustmentsForBatch(rows[0].id);
    if (pendingAdjustments.length > 0) {
      const settings = await getOrCreatePayrollSettings(req.user.tenantId);
      exceptions.push({
        userId: 0, userName: 'Multiple', type: 'pending_adjustments',
        message: `${pendingAdjustments.length} payroll adjustment(s) are pending and have not been applied yet.`,
        blocking: !!settings?.blockPayrollReleaseOnPendingAdjustments,
      });
    }

    res.json({ exceptions, blockingCount: exceptions.filter((e) => e.blocking).length, pendingAdjustments: pendingAdjustments.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/tenant/payroll/batches', authenticate, async (req: any, res: any) => {
  try {
    if (!await requireBatchFeature(req, res)) return;
    if (!await hasPrivilege(req.user, 'payroll.batch.create')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const { year, month } = req.body || {};
    if (!year || !month) return res.status(400).json({ error: 'year and month are required.' });

    const existing = await db.select().from(schema.payrollBatches).where(and(eq(schema.payrollBatches.tenantId, req.user.tenantId), eq(schema.payrollBatches.year, Number(year)), eq(schema.payrollBatches.month, Number(month)))).limit(1);
    if (existing.length > 0) return res.status(400).json({ error: 'A payroll batch already exists for this period.' });

    const [batch] = await db.insert(schema.payrollBatches).values({
      tenantId: req.user.tenantId, year: Number(year), month: Number(month), createdByUserId: req.user.userId,
    }).returning();

    await logToAuditLedger({ tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name, action: 'PAYROLL_BATCH_CREATED', details: { batchId: batch.id, year, month } });
    res.json({ batch });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Calculates every eligible employee's payroll for the batch's period.
// P2: runs off the request thread via the existing Postgres-backed job
// queue (services/queue) instead of a synchronous loop, so a 1,000+
// employee tenant's calculate action returns immediately instead of
// blocking the HTTP request — see services/payrollBatchCalculation.ts for
// the actual loop (reuses buildPayrollSummary unchanged, plus the P2
// proration engine for mid-month joins).
router.post('/api/tenant/payroll/batches/:id/calculate', authenticate, async (req: any, res: any) => {
  try {
    if (!await requireBatchFeature(req, res)) return;
    if (!await hasPrivilege(req.user, 'payroll.batch.create')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const batchRows = await db.select().from(schema.payrollBatches).where(eq(schema.payrollBatches.id, Number(req.params.id))).limit(1);
    if (batchRows.length === 0 || batchRows[0].tenantId !== req.user.tenantId) return res.status(404).json({ error: 'Batch not found.' });
    const batch = batchRows[0];
    if (batch.status !== 'draft' && batch.status !== 'calculated') {
      return res.status(400).json({ error: `Cannot calculate a batch in status '${batch.status}'.` });
    }
    const gateMsg = await checkCalendarGate(req.user.tenantId, batch.year, batch.month, 'calculating');
    if (gateMsg) return res.status(400).json({ error: gateMsg });

    await db.update(schema.payrollBatches).set({ status: 'calculating' }).where(eq(schema.payrollBatches.id, batch.id));
    await queue.enqueue('calculate_payroll_batch', { batchId: batch.id, actorId: req.user.userId, actorName: req.user.name }, { tenantId: req.user.tenantId });

    res.json({ batch: { ...batch, status: 'calculating' }, queued: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// One shared handler for the remaining simple state transitions — each
// just checks the previous state, any calendar gate, records who/when, and
// moves forward. 'approve' and 'release' additionally run the Validation
// Engine and refuse to proceed on failure.
function makeTransitionRoute(opts: {
  path: string;
  fromStatus: string;
  toStatus: string;
  privilege: string;
  auditAction: string;
  reviewerField?: 'hrReviewedByUserId' | 'financeReviewedByUserId' | 'approvedByUserId' | 'releasedByUserId';
  reviewerAtField?: 'hrReviewedAt' | 'financeReviewedAt' | 'approvedAt' | 'releasedAt' | 'lockedAt';
  requireValidation?: boolean;
  notifyEvent?: string;
}) {
  router.post(`/api/tenant/payroll/batches/:id/${opts.path}`, authenticate, async (req: any, res: any) => {
    try {
      if (!await requireBatchFeature(req, res)) return;
      if (!await hasPrivilege(req.user, opts.privilege)) {
        return res.status(403).json({ error: 'Access denied.' });
      }
      const rows = await db.select().from(schema.payrollBatches).where(eq(schema.payrollBatches.id, Number(req.params.id))).limit(1);
      if (rows.length === 0 || rows[0].tenantId !== req.user.tenantId) return res.status(404).json({ error: 'Batch not found.' });
      const batch = rows[0];
      if (batch.status !== opts.fromStatus) {
        return res.status(400).json({ error: `This batch is in status '${batch.status}'; expected '${opts.fromStatus}' for this action.` });
      }
      const gateMsg = await checkCalendarGate(req.user.tenantId, batch.year, batch.month, opts.toStatus);
      if (gateMsg) return res.status(400).json({ error: gateMsg });

      if (opts.path === 'release') {
        const pendingAdjustments = await getPendingAdjustmentsForBatch(batch.id);
        if (pendingAdjustments.length > 0) {
          const settingsForRelease = await getOrCreatePayrollSettings(req.user.tenantId);
          if (settingsForRelease?.blockPayrollReleaseOnPendingAdjustments) {
            return res.status(400).json({ error: `Cannot release: ${pendingAdjustments.length} payroll adjustment(s) are still pending. Apply or dismiss them first, or disable "block release on pending adjustments" in Payroll Settings.` });
          }
        }
      }

      if (opts.requireValidation) {
        const validation = await validateBatchForApproval(batch);
        if (!validation.valid) {
          return res.status(400).json({ error: 'Batch failed validation.', failures: validation.failures });
        }
      }

      if (opts.path === 'release') {
        await finalizePayrollBatchFinancials(batch.id);
      }

      const updateSet: Record<string, any> = { status: opts.toStatus };
      if (opts.reviewerField) updateSet[opts.reviewerField] = req.user.userId;
      if (opts.reviewerAtField) updateSet[opts.reviewerAtField] = new Date();
      const [updated] = await db.update(schema.payrollBatches).set(updateSet).where(eq(schema.payrollBatches.id, batch.id)).returning();

      await logToAuditLedger({ tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name, action: opts.auditAction, details: { batchId: batch.id, fromStatus: opts.fromStatus, toStatus: opts.toStatus } });

      if (opts.notifyEvent) {
        const tenantRow = (await db.select().from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId)).limit(1))[0];
        if (isPlatformFeatureAllowed(tenantRow, 'unified_notifications')) {
          if (opts.notifyEvent === 'payroll_batch_released') {
            // Employee-facing — one notify() per employee whose payslip is now visible.
            const lineItems = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.batchId, batch.id));
            const employees = lineItems.length > 0 ? await db.select().from(schema.users).where(inArray(schema.users.id, lineItems.map((r: any) => r.userId))) : [];
            await Promise.all(employees.map((u: any) =>
              notify(req.user.tenantId, 'payroll_batch_released', { subjectUserId: u.id, subjectName: u.name, data: { batchId: batch.id, year: batch.year, month: batch.month } }).catch(() => undefined)
            ));
          } else {
            await notify(req.user.tenantId, opts.notifyEvent, { subjectUserId: req.user.userId, subjectName: req.user.name, data: { batchId: batch.id, year: batch.year, month: batch.month } }).catch(() => undefined);
          }
        }
      }

      res.json({ batch: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}

makeTransitionRoute({ path: 'submit-hr', fromStatus: 'calculated', toStatus: 'pending_hr_review', privilege: 'payroll.batch.create', auditAction: 'PAYROLL_BATCH_SUBMITTED_HR' });
makeTransitionRoute({ path: 'submit-finance', fromStatus: 'pending_hr_review', toStatus: 'pending_finance_review', privilege: 'payroll.review.hr', auditAction: 'PAYROLL_BATCH_SUBMITTED_FINANCE', reviewerField: 'hrReviewedByUserId', reviewerAtField: 'hrReviewedAt' });
makeTransitionRoute({ path: 'approve', fromStatus: 'pending_finance_review', toStatus: 'approved', privilege: 'payroll.review.finance', auditAction: 'PAYROLL_BATCH_APPROVED', reviewerField: 'financeReviewedByUserId', reviewerAtField: 'financeReviewedAt', requireValidation: true, notifyEvent: 'payroll_batch_approved' });
makeTransitionRoute({ path: 'generate-payslips', fromStatus: 'approved', toStatus: 'payslips_generated', privilege: 'payroll.approve', auditAction: 'PAYROLL_BATCH_PAYSLIPS_GENERATED', reviewerField: 'approvedByUserId', reviewerAtField: 'approvedAt' });
makeTransitionRoute({ path: 'release', fromStatus: 'payslips_generated', toStatus: 'released', privilege: 'payroll.release', auditAction: 'PAYROLL_BATCH_RELEASED', reviewerField: 'releasedByUserId', reviewerAtField: 'releasedAt', requireValidation: true, notifyEvent: 'payroll_batch_released' });
makeTransitionRoute({ path: 'lock', fromStatus: 'released', toStatus: 'locked', privilege: 'payroll.lock', auditAction: 'PAYROLL_BATCH_LOCKED', reviewerAtField: 'lockedAt' });
