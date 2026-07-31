import { eq, and, desc } from 'drizzle-orm';
import { db, schema } from '../../db';
import { queue } from './queue';
import { logToAuditLedger } from './audit';
import { prorateForJoinOrExit, prorateForRevision } from './payrollProration';
import { notify } from './notificationService';
import { isPlatformFeatureAllowed } from '../auth/rbac';
import {
  buildPayrollSummary,
  getOrCreatePayrollSettings,
  getRoleCompensationDefault,
  splitLeaveDaysForPayroll,
  resolveOvertimeHours,
  resolveAttendanceDrivenInputs,
} from '../routes/leavePayrollShared';

// Runs the actual per-employee calculation loop for a Payroll Batch (P1),
// off the request thread — enqueued via the same Postgres-backed job queue
// every other background task in this app already uses (services/queue),
// so a 1,000+ employee tenant's calculate action doesn't block an HTTP
// request for minutes. Reuses the EXACT same buildPayrollSummary/leave-
// split/overtime/attendance-driven pipeline the pre-existing lazy
// per-employee route already used — no parallel calculation logic — plus
// the dedicated proration engine for mid-month join/exit.
interface CalculateBatchJobPayload {
  batchId: number;
  actorId: number;
  actorName: string;
}

export function registerPayrollBatchCalculationHandler() {
  queue.registerHandler('calculate_payroll_batch', async (payload: CalculateBatchJobPayload) => {
    await calculatePayrollBatch(payload.batchId, payload.actorId, payload.actorName);
  });
}

export async function calculatePayrollBatch(batchId: number, actorId: number, actorName: string): Promise<void> {
  const batchRows = await db.select().from(schema.payrollBatches).where(eq(schema.payrollBatches.id, batchId)).limit(1);
  const batch = batchRows[0];
  if (!batch) return;

  const { year, month, tenantId } = batch;
  const [settings, tenantRows] = await Promise.all([
    getOrCreatePayrollSettings(tenantId),
    db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1),
  ]);
  const tenantRow = tenantRows[0];
  const employees = (await db.select().from(schema.users).where(eq(schema.users.tenantId, tenantId)))
    .filter((u: any) => u.role !== 'tenant_admin' && u.role !== 'super_admin' && u.employeeStatus !== 'terminated');

  let totalGross = 0, totalNet = 0, calculatedCount = 0;
  for (const emp of employees) {
    const profileRows = await db.select().from(schema.employeeCompensationProfiles).where(and(eq(schema.employeeCompensationProfiles.tenantId, tenantId), eq(schema.employeeCompensationProfiles.userId, emp.id), eq(schema.employeeCompensationProfiles.status, 'active'))).orderBy(desc(schema.employeeCompensationProfiles.id)).limit(1);
    let profile: any = profileRows[0] || null;
    let effectiveComponents = profile
      ? await db.select().from(schema.employeeSalaryComponents).where(and(eq(schema.employeeSalaryComponents.tenantId, tenantId), eq(schema.employeeSalaryComponents.userId, emp.id))).orderBy(schema.employeeSalaryComponents.sortOrder)
      : [];
    if (!profile) {
      const roleDefault = await getRoleCompensationDefault(tenantId, emp.role || '');
      if (!roleDefault) continue; // surfaced as a blocking exception already; skip rather than crash the batch
      profile = { annualCtc: roleDefault.roleDefault.annualCtc, overtimeHourlyRate: null, effectiveFrom: null, status: 'active' };
      effectiveComponents = roleDefault.components;
    }

    const [requests, policies] = await Promise.all([
      db.select().from(schema.leaveRequests).where(and(eq(schema.leaveRequests.tenantId, tenantId), eq(schema.leaveRequests.userId, emp.id), eq(schema.leaveRequests.status, 'approved'))),
      db.select().from(schema.leavePolicies).where(eq(schema.leavePolicies.tenantId, tenantId)),
    ]);
    const leaveDays = splitLeaveDaysForPayroll(requests, policies, year, month);
    const overtimeHours = await resolveOvertimeHours(!!tenantRow?.overtimePayrollEnabled, emp.id, tenantId, year, month);
    const attendanceDriven = await resolveAttendanceDrivenInputs(tenantRow, emp.id, tenantId, year, month);
    const summary = buildPayrollSummary(profile, effectiveComponents, settings, leaveDays, overtimeHours, attendanceDriven);

    // Salary revision effective mid-month — dedicated proration engine
    // (prorateForRevision), previously built but never called: buildPayrollSummary
    // above applies the CURRENT profile for the whole month, so without this
    // check a mid-month revision would silently apply retroactively to
    // days that were actually worked under the old rate.
    // compensationHistory (existing table, written on every profile save)
    // already has the exact before/after snapshot needed — no new tracking.
    let monthlyGross = summary.monthlyGross;
    let monthlyNet = summary.monthlyNet;
    let revisionLine: any = null;
    {
      const totalDaysThisMonth = new Date(year, month, 0).getDate();
      const periodStartStr = `${year}-${String(month).padStart(2, '0')}-01`;
      const periodEndStr = `${year}-${String(month).padStart(2, '0')}-${String(totalDaysThisMonth).padStart(2, '0')}`;
      const historyRows = await db.select().from(schema.compensationHistory).where(and(eq(schema.compensationHistory.tenantId, tenantId), eq(schema.compensationHistory.userId, emp.id))).orderBy(desc(schema.compensationHistory.createdAt));
      const revision = historyRows.find((r: any) => r.previousAnnualCtc != null && r.effectiveFrom && r.effectiveFrom >= periodStartStr && r.effectiveFrom <= periodEndStr);
      if (revision) {
        const beforeProfile = { annualCtc: revision.previousAnnualCtc, overtimeHourlyRate: profile.overtimeHourlyRate, effectiveFrom: null, status: 'active' };
        const beforeComponents = Array.isArray(revision.previousComponents) ? revision.previousComponents : [];
        const blend = prorateForRevision(
          { profile: beforeProfile, components: beforeComponents },
          { profile, components: effectiveComponents },
          settings, leaveDays, overtimeHours, attendanceDriven, year, month, revision.effectiveFrom,
        );
        monthlyGross = blend.monthlyGross;
        monthlyNet = blend.monthlyNet;
        revisionLine = { type: 'salary_revision_blend', ...blend.proration, segments: blend.breakdown };
      }
    }

    // Mid-month join/exit proration — dedicated engine, not embedded in
    // buildPayrollSummary. dateOfLeaving isn't a real column on `users`
    // today (only employeeStatus/terminationRequests track exits), so exit
    // proration activates once that data exists; join proration is real now.
    const proration = prorateForJoinOrExit(monthlyNet, year, month, emp.dateOfJoining, null);
    let finalNet = proration ? monthlyNet + proration.amount : monthlyNet;
    const breakdown: any[] = [...summary.annualBreakdown];
    if (revisionLine) breakdown.push(revisionLine);
    if (proration) breakdown.push({ type: 'proration', ...proration });

    // Loans/Advances/Bonuses/Reimbursements (P3/P4) — read-only inputs into
    // this month's net pay, never inlined into employeeSalaryComponents.
    // Recovery/payout amounts are capped at the remaining balance and the
    // source record is updated in the same pass so a loan/advance closes
    // itself out and a bonus/reimbursement is marked paid exactly once.
    const activeLoans = await db.select().from(schema.payrollLoans).where(and(eq(schema.payrollLoans.tenantId, tenantId), eq(schema.payrollLoans.userId, emp.id), eq(schema.payrollLoans.status, 'active')));
    for (const loan of activeLoans) {
      const recovery = Math.min(loan.emiAmount, loan.remainingBalance);
      if (recovery <= 0) continue;
      finalNet -= recovery;
      breakdown.push({ type: 'loan_recovery', loanId: loan.id, amount: -recovery, reason: `Loan EMI (#${loan.id})` });
      const newBalance = loan.remainingBalance - recovery;
      await db.update(schema.payrollLoans).set({ remainingBalance: newBalance, status: newBalance <= 0.01 ? 'closed' : 'active' }).where(eq(schema.payrollLoans.id, loan.id));
    }

    const activeAdvances = await db.select().from(schema.payrollAdvances).where(and(eq(schema.payrollAdvances.tenantId, tenantId), eq(schema.payrollAdvances.userId, emp.id), eq(schema.payrollAdvances.status, 'active')));
    for (const advance of activeAdvances) {
      const recovery = Math.min(advance.recoveryPerMonth, advance.remainingBalance);
      if (recovery <= 0) continue;
      finalNet -= recovery;
      breakdown.push({ type: 'advance_recovery', advanceId: advance.id, amount: -recovery, reason: `Advance recovery (#${advance.id})` });
      const newBalance = advance.remainingBalance - recovery;
      await db.update(schema.payrollAdvances).set({ remainingBalance: newBalance, status: newBalance <= 0.01 ? 'closed' : 'active' }).where(eq(schema.payrollAdvances.id, advance.id));
    }

    const approvedBonuses = await db.select().from(schema.payrollBonuses).where(and(eq(schema.payrollBonuses.tenantId, tenantId), eq(schema.payrollBonuses.userId, emp.id), eq(schema.payrollBonuses.status, 'approved')));
    for (const bonus of approvedBonuses) {
      finalNet += bonus.amount;
      breakdown.push({ type: 'bonus', bonusId: bonus.id, amount: bonus.amount, reason: `${bonus.type} bonus` });
      await db.update(schema.payrollBonuses).set({ status: 'paid', payrollBatchId: batch.id }).where(eq(schema.payrollBonuses.id, bonus.id));
    }

    const approvedReimbursements = await db.select().from(schema.payrollReimbursements).where(and(eq(schema.payrollReimbursements.tenantId, tenantId), eq(schema.payrollReimbursements.userId, emp.id), eq(schema.payrollReimbursements.status, 'approved')));
    for (const reimb of approvedReimbursements) {
      finalNet += reimb.amount;
      breakdown.push({ type: 'reimbursement', reimbursementId: reimb.id, amount: reimb.amount, reason: `${reimb.category} reimbursement` });
      await db.update(schema.payrollReimbursements).set({ status: 'paid', payrollBatchId: batch.id }).where(eq(schema.payrollReimbursements.id, reimb.id));
    }

    const [lineItem] = await db.insert(schema.payrollRuns).values({
      tenantId, userId: emp.id, profileId: profile.id ?? null, year, month, batchId: batch.id,
      workingDays: attendanceDriven ? attendanceDriven.workingDays : Number(settings?.workingDaysPerMonth || 26),
      approvedLeaveDays: leaveDays.totalDays,
      unpaidAbsenceDays: summary.unpaidAbsenceDays,
      lopDeduction: summary.lopDeduction,
      overtimeHours,
      grossPay: monthlyGross,
      leaveDeduction: summary.leaveDeduction,
      overtimePay: summary.overtimePay,
      netPay: finalNet,
      breakdown,
      status: 'generated',
      version: 1,
    }).onConflictDoUpdate({
      target: [schema.payrollRuns.userId, schema.payrollRuns.year, schema.payrollRuns.month, schema.payrollRuns.version],
      set: { batchId: batch.id, grossPay: monthlyGross, netPay: finalNet, breakdown },
    }).returning();

    // Financial Ledger (P6) — one append-only row per finalized line item,
    // read by Reports/reconciliation instead of joining 5 tables. Written
    // here, never used to drive the calculation above.
    const ledgerRows: any[] = [
      { tenantId, userId: emp.id, batchId: batch.id, payrollRunId: lineItem.id, entryType: 'salary', amount: monthlyNet, year, month },
    ];
    for (const line of breakdown) {
      if (line.type && line.type !== 'proration' && typeof line.amount === 'number') {
        ledgerRows.push({
          tenantId, userId: emp.id, batchId: batch.id, payrollRunId: lineItem.id, entryType: line.type,
          sourceTable: line.loanId ? 'payroll_loans' : line.advanceId ? 'payroll_advances' : line.bonusId ? 'payroll_bonuses' : line.reimbursementId ? 'payroll_reimbursements' : null,
          sourceId: line.loanId || line.advanceId || line.bonusId || line.reimbursementId || null,
          amount: line.amount, year, month,
        });
      }
    }
    if (ledgerRows.length > 0) await db.insert(schema.payrollLedgerEntries).values(ledgerRows);

    totalGross += lineItem.grossPay;
    totalNet += lineItem.netPay;
    calculatedCount += 1;
  }

  await db.update(schema.payrollBatches).set({
    status: 'calculated', employeeCount: calculatedCount, totalGross, totalNet, calculatedAt: new Date(),
  }).where(eq(schema.payrollBatches.id, batch.id));

  await logToAuditLedger({ tenantId, actorId, actorName, action: 'PAYROLL_BATCH_CALCULATED', details: { batchId: batch.id, employeeCount: calculatedCount, totalGross, totalNet } });

  if (isPlatformFeatureAllowed(tenantRow, 'unified_notifications')) {
    await notify(tenantId, 'payroll_batch_calculated', {
      subjectUserId: actorId, subjectName: actorName,
      data: { batchId: batch.id, year, month, employeeCount: calculatedCount, totalNet },
    }).catch(() => undefined);
  }
}
