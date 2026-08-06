import { eq, and, desc, lt, or, sql, inArray } from 'drizzle-orm';
import { db, schema } from '../../db';
import { queue } from './queue';
import { logToAuditLedger } from './audit';
import { prorateForJoinOrExit, prorateForRevision } from './payrollProration';
import { notify } from './notificationService';
import { getHolidaysForEmployee } from './holidayScope';
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

// Matches backgroundJobs.maxAttempts' schema default (3) — see the same
// caveat in notificationService.ts's DELIVER_NOTIFICATION_MAX_ATTEMPTS:
// the queue's JobMeta only exposes the attempt count, not the cap the job
// was enqueued with, so this only stays accurate as long as nothing calls
// queue.enqueue('calculate_payroll_batch', ..., { maxAttempts: <other> }).
const CALCULATE_BATCH_MAX_ATTEMPTS = 3;

function hasStartedByPeriod(row: { startYear: number; startMonth: number }, year: number, month: number) {
  return row.startYear < year || (row.startYear === year && row.startMonth <= month);
}

function tenantWeekendDays(tenant: any): string[] {
  if (Array.isArray(tenant?.weekendConfig)) return tenant.weekendConfig;
  if (typeof tenant?.weekendConfig === 'string') {
    try { return JSON.parse(tenant.weekendConfig); } catch { return ['Saturday', 'Sunday']; }
  }
  return ['Saturday', 'Sunday'];
}

export function registerPayrollBatchCalculationHandler() {
  queue.registerHandler('calculate_payroll_batch', async (payload: CalculateBatchJobPayload, meta: any) => {
    try {
      await calculatePayrollBatch(payload.batchId, payload.actorId, payload.actorName);
    } catch (err: any) {
      // A payroll calculation that silently dies after 3 retries is exactly
      // the kind of "nobody finds out until payday" failure a Critical-tier
      // alert exists for — surfaced to tenant_admin via the same notify()
      // pipeline as everything else (priority: 'critical' in
      // notificationService.ts's DEFAULT_POLICIES bypasses digest/quiet-
      // hours entirely), not just a row in background_jobs.last_error that
      // nobody is watching.
      if ((meta?.attempts || 1) >= CALCULATE_BATCH_MAX_ATTEMPTS) {
        const batchRows = await db.select().from(schema.payrollBatches).where(eq(schema.payrollBatches.id, payload.batchId)).limit(1);
        const batch = batchRows[0];
        if (batch) {
          await notify(batch.tenantId, 'payroll_batch_calculation_failed', {
            subjectUserId: payload.actorId,
            subjectName: payload.actorName,
            data: { batchId: payload.batchId, year: batch.year, month: batch.month, error: err?.message?.slice(0, 300) },
          }).catch(() => undefined);
        }
      }
      throw err; // let the queue's own retry logic still handle the actual failure
    }
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

    const [requests, policies, holidays] = await Promise.all([
      db.select().from(schema.leaveRequests).where(and(eq(schema.leaveRequests.tenantId, tenantId), eq(schema.leaveRequests.userId, emp.id), eq(schema.leaveRequests.status, 'approved'))),
      db.select().from(schema.leavePolicies).where(eq(schema.leavePolicies.tenantId, tenantId)),
      getHolidaysForEmployee(tenantId, emp.id),
    ]);
    const leaveDays = splitLeaveDaysForPayroll(requests, policies, year, month, {
      weekendDays: tenantWeekendDays(tenantRow),
      holidayDates: new Set(holidays.map((holiday) => holiday.date)),
    });
    const overtimeHours = await resolveOvertimeHours(!!tenantRow?.overtimePayrollEnabled, emp.id, tenantId, year, month);
    const attendanceDriven = await resolveAttendanceDrivenInputs(tenantRow, emp.id, tenantId, year, month);
    const summary = buildPayrollSummary(profile, effectiveComponents, settings, leaveDays, overtimeHours, attendanceDriven, year, month);

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


    // Mid-month join/exit proration — dedicated engine, not embedded in
    // buildPayrollSummary. dateOfLeaving isn't a real column on `users`
    // today (only employeeStatus/terminationRequests track exits), so exit
    // proration activates once that data exists; join proration is real now.
    const proration = prorateForJoinOrExit(monthlyNet, year, month, emp.dateOfJoining, emp.dateOfExit);
    let finalNet = proration ? monthlyNet + proration.amount : monthlyNet;
    const breakdown: any[] = [...summary.annualBreakdown];
    if (revisionLine) breakdown.push(revisionLine);
    if (proration) breakdown.push({ type: 'proration', ...proration });

    // Loans/Advances/Bonuses/Reimbursements (P3/P4) — read-only inputs into
    // this month's net pay, never inlined into employeeSalaryComponents.
    const activeLoans = await db.select().from(schema.payrollLoans).where(and(
      eq(schema.payrollLoans.tenantId, tenantId),
      eq(schema.payrollLoans.userId, emp.id),
      eq(schema.payrollLoans.status, 'active'),
      or(lt(schema.payrollLoans.startYear, year), and(eq(schema.payrollLoans.startYear, year), sql`${schema.payrollLoans.startMonth} <= ${month}`))
    ));
    for (const loan of activeLoans) {
      if (!hasStartedByPeriod(loan, year, month)) continue;
      const recovery = Math.min(loan.emiAmount, loan.remainingBalance);
      if (recovery <= 0) continue;
      finalNet -= recovery;
      breakdown.push({ type: 'loan_recovery', loanId: loan.id, amount: -recovery, reason: `Loan EMI (#${loan.id})` });
    }

    const activeAdvances = await db.select().from(schema.payrollAdvances).where(and(
      eq(schema.payrollAdvances.tenantId, tenantId),
      eq(schema.payrollAdvances.userId, emp.id),
      eq(schema.payrollAdvances.status, 'active'),
      or(lt(schema.payrollAdvances.startYear, year), and(eq(schema.payrollAdvances.startYear, year), sql`${schema.payrollAdvances.startMonth} <= ${month}`))
    ));
    for (const advance of activeAdvances) {
      if (!hasStartedByPeriod(advance, year, month)) continue;
      const recovery = Math.min(advance.recoveryPerMonth, advance.remainingBalance);
      if (recovery <= 0) continue;
      finalNet -= recovery;
      breakdown.push({ type: 'advance_recovery', advanceId: advance.id, amount: -recovery, reason: `Advance recovery (#${advance.id})` });
    }

    const approvedBonuses = await db.select().from(schema.payrollBonuses).where(and(eq(schema.payrollBonuses.tenantId, tenantId), eq(schema.payrollBonuses.userId, emp.id), eq(schema.payrollBonuses.status, 'approved')));
    for (const bonus of approvedBonuses) {
      finalNet += bonus.amount;
      breakdown.push({ type: 'bonus', bonusId: bonus.id, amount: bonus.amount, reason: `${bonus.type} bonus` });
    }

    const approvedReimbursements = await db.select().from(schema.payrollReimbursements).where(and(eq(schema.payrollReimbursements.tenantId, tenantId), eq(schema.payrollReimbursements.userId, emp.id), eq(schema.payrollReimbursements.status, 'approved')));
    for (const reimb of approvedReimbursements) {
      finalNet += reimb.amount;
      breakdown.push({ type: 'reimbursement', reimbursementId: reimb.id, amount: reimb.amount, reason: `${reimb.category} reimbursement` });
    }

    const [lineItem] = await db.insert(schema.payrollRuns).values({
      tenantId, userId: emp.id, profileId: profile.id ?? null, year, month, batchId: batch.id,
      workingDays: summary.workingDays,
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
      set: {
        profileId: profile.id ?? null,
        batchId: batch.id,
        workingDays: summary.workingDays,
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
      },
    }).returning();

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

export async function finalizePayrollBatchFinancials(batchId: number) {
  // Read-only pre-fetch OUTSIDE the transaction: at 1k-10k employees, doing
  // one SELECT per loan/advance reference from inside the transaction (as
  // this used to) held row locks for the entire duration of that scan,
  // which is exactly the lock-contention risk the audit flagged about this
  // being "one large unchunked transaction." Splitting the finalization
  // itself into multiple transactions would break the atomicity guarantee
  // that matters most here (a batch must finalize completely or not at
  // all — a half-applied payroll close is a much worse failure mode than
  // a slow one), so instead this shortens the transaction's actual
  // critical section: everything that only needs to be *read* now happens
  // before the transaction opens, and the transaction itself is just the
  // computed writes.
  const preBatch = await db.select().from(schema.payrollBatches).where(eq(schema.payrollBatches.id, batchId)).limit(1);
  if (!preBatch[0]) throw new Error('Payroll batch not found.');
  const preExistingLedger = await db.select({ id: schema.payrollLedgerEntries.id }).from(schema.payrollLedgerEntries).where(eq(schema.payrollLedgerEntries.batchId, batchId)).limit(1);
  if (preExistingLedger.length > 0) return;
  const preLineItems = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.batchId, batchId));
  if (preLineItems.length === 0) throw new Error('Cannot release a payroll batch with no calculated line items.');

  const referencedLoanIds = new Set<number>();
  const referencedAdvanceIds = new Set<number>();
  for (const lineItem of preLineItems as any[]) {
    const breakdown = Array.isArray(lineItem.breakdown) ? lineItem.breakdown : [];
    for (const line of breakdown) {
      if (line.loanId) referencedLoanIds.add(Number(line.loanId));
      if (line.advanceId) referencedAdvanceIds.add(Number(line.advanceId));
    }
  }
  const [preLoans, preAdvances] = await Promise.all([
    referencedLoanIds.size > 0 ? db.select().from(schema.payrollLoans).where(inArray(schema.payrollLoans.id, [...referencedLoanIds])) : Promise.resolve([]),
    referencedAdvanceIds.size > 0 ? db.select().from(schema.payrollAdvances).where(inArray(schema.payrollAdvances.id, [...referencedAdvanceIds])) : Promise.resolve([]),
  ]);
  const loanById = new Map<number, any>(preLoans.map((l: any) => [l.id, l]));
  const advanceById = new Map<number, any>(preAdvances.map((a: any) => [a.id, a]));

  await db.transaction(async (tx: any) => {
    // Re-check inside the transaction — a concurrent finalize could have
    // landed between the pre-fetch above and this transaction opening.
    const batchRows = await tx.select().from(schema.payrollBatches).where(eq(schema.payrollBatches.id, batchId)).limit(1);
    const batch = batchRows[0];
    if (!batch) throw new Error('Payroll batch not found.');

    const existingLedgerRows = await tx.select({ id: schema.payrollLedgerEntries.id }).from(schema.payrollLedgerEntries).where(eq(schema.payrollLedgerEntries.batchId, batchId)).limit(1);
    if (existingLedgerRows.length > 0) return;

    const lineItems = await tx.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.batchId, batchId));
    if (lineItems.length === 0) throw new Error('Cannot release a payroll batch with no calculated line items.');

    const ledgerRows: Array<typeof schema.payrollLedgerEntries.$inferInsert> = [];
    for (const lineItem of lineItems as any[]) {
      const breakdown = Array.isArray(lineItem.breakdown) ? lineItem.breakdown : [];
      const variableTotal = breakdown
        .filter((line: any) => line.type && line.type !== 'proration' && typeof line.amount === 'number')
        .reduce((sum: number, line: any) => sum + Number(line.amount || 0), 0);
      const salaryAmount = Number(lineItem.netPay || 0) - variableTotal;

      ledgerRows.push({
        tenantId: batch.tenantId,
        userId: lineItem.userId,
        batchId,
        payrollRunId: lineItem.id,
        entryType: 'salary',
        amount: salaryAmount,
        year: batch.year,
        month: batch.month,
      });

      for (const line of breakdown) {
        if (!line.type || line.type === 'proration' || typeof line.amount !== 'number') continue;
        const sourceTable = line.loanId ? 'payroll_loans'
          : line.advanceId ? 'payroll_advances'
            : line.bonusId ? 'payroll_bonuses'
              : line.reimbursementId ? 'payroll_reimbursements'
                : null;
        const sourceId = line.loanId || line.advanceId || line.bonusId || line.reimbursementId || null;

        ledgerRows.push({
          tenantId: batch.tenantId,
          userId: lineItem.userId,
          batchId,
          payrollRunId: lineItem.id,
          entryType: line.type,
          sourceTable,
          sourceId,
          amount: Number(line.amount),
          year: batch.year,
          month: batch.month,
        });

        // Loan/advance rows were pre-fetched in bulk before the transaction
        // opened (see finalizePayrollBatchFinancials above) instead of one
        // SELECT per reference here — this was the main contributor to how
        // long this transaction held row locks at scale. The in-memory map
        // is updated after each deduction so a loan/advance referenced more
        // than once within the same batch (shouldn't normally happen, but
        // isn't structurally prevented) still deducts correctly in sequence
        // rather than against a stale balance.
        if (line.loanId) {
          const loan = loanById.get(Number(line.loanId));
          if (loan?.status === 'active') {
            const newBalance = Math.max(0, Number(loan.remainingBalance || 0) - Math.abs(Number(line.amount || 0)));
            const newStatus = newBalance <= 0.01 ? 'closed' : 'active';
            await tx.update(schema.payrollLoans).set({ remainingBalance: newBalance, status: newStatus }).where(eq(schema.payrollLoans.id, loan.id));
            loanById.set(loan.id, { ...loan, remainingBalance: newBalance, status: newStatus });
          }
        }
        if (line.advanceId) {
          const advance = advanceById.get(Number(line.advanceId));
          if (advance?.status === 'active') {
            const newBalance = Math.max(0, Number(advance.remainingBalance || 0) - Math.abs(Number(line.amount || 0)));
            const newStatus = newBalance <= 0.01 ? 'closed' : 'active';
            await tx.update(schema.payrollAdvances).set({ remainingBalance: newBalance, status: newStatus }).where(eq(schema.payrollAdvances.id, advance.id));
            advanceById.set(advance.id, { ...advance, remainingBalance: newBalance, status: newStatus });
          }
        }
        if (line.bonusId) {
          await tx.update(schema.payrollBonuses).set({ status: 'paid', payrollBatchId: batchId }).where(and(eq(schema.payrollBonuses.id, Number(line.bonusId)), eq(schema.payrollBonuses.status, 'approved')));
        }
        if (line.reimbursementId) {
          await tx.update(schema.payrollReimbursements).set({ status: 'paid', payrollBatchId: batchId }).where(and(eq(schema.payrollReimbursements.id, Number(line.reimbursementId)), eq(schema.payrollReimbursements.status, 'approved')));
        }
      }
    }

    if (ledgerRows.length > 0) await tx.insert(schema.payrollLedgerEntries).values(ledgerRows);
  });
}
