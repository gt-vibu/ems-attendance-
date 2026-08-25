import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateSalaryAdvanceEligibility,
  createSalaryAdvanceRequest,
  approveSalaryAdvance,
  rejectSalaryAdvance,
  disburseSalaryAdvance,
  cancelSalaryAdvance,
  generateRecoveryScheduleRecords,
  roundMoney,
  formatMoneyStr,
  parsePolicyNumbers,
} from './api/services/salaryAdvanceService';
import { db, schema } from './db';
import { eq, and } from 'drizzle-orm';
import { calculatePayrollBatch, finalizePayrollBatchFinancials } from './api/services/payrollBatchCalculation';

describe('Salary Advances & Payroll Integration Module', { concurrency: false }, () => {
  const BASE_TENANT_ID = 9990;

  const setupTenantAndEmployee = async (scenarioIndex: number, monthsTenure = 12, annualCtc = 1200000) => {
    const tenantId = 9100 + scenarioIndex * 10;
    const userId = 9100 + scenarioIndex * 10 + 1;
    const joinDate = new Date();
    joinDate.setMonth(joinDate.getMonth() - monthsTenure);

    await db.delete(schema.salaryAdvanceRecoveries).where(eq(schema.salaryAdvanceRecoveries.tenantId, tenantId));
    await db.delete(schema.salaryAdvances).where(eq(schema.salaryAdvances.tenantId, tenantId));
    await db.delete(schema.payrollAdvances).where(eq(schema.payrollAdvances.tenantId, tenantId));
    await db.delete(schema.payrollRuns).where(eq(schema.payrollRuns.tenantId, tenantId));
    await db.delete(schema.payrollBatches).where(eq(schema.payrollBatches.tenantId, tenantId));
    await db.delete(schema.payrollLedgerEntries).where(eq(schema.payrollLedgerEntries.tenantId, tenantId));
    await db.delete(schema.employeeCompensationProfiles).where(eq(schema.employeeCompensationProfiles.tenantId, tenantId));
    await db.delete(schema.users).where(eq(schema.users.tenantId, tenantId));
    await db.delete(schema.payrollSettings).where(eq(schema.payrollSettings.tenantId, tenantId));
    await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));

    await db.insert(schema.tenants).values({
      id: tenantId,
      name: `Test Tenant ${tenantId}`,
      adminUid: `admin-${tenantId}`,
      status: 'active',
    });

    await db.insert(schema.payrollSettings).values({
      tenantId,
      salaryAdvanceEnabled: true,
      advanceCalculationBasis: 'net_salary',
      advanceMaxAmount: '50000.00',
      advanceMaxPercentage: '50.00',
      advanceMinTenureMonths: 3,
      advanceMaxActiveCount: 1,
      advanceAllowMultiple: false,
      advanceDefaultRecoveryMethod: 'full_next_payroll',
      advanceMaxInstallments: 6,
      advanceMinRecoveryAmount: '1000.00',
      advanceEmployeeCanRequest: true,
      advanceAdminCanAssign: true,
      advanceApprovalRequired: true,
      advancePayrollCutoffDay: 20,
    });

    await db.insert(schema.users).values({
      id: userId,
      tenantId,
      name: `Test Employee ${userId}`,
      email: `emp${userId}@example.com`,
      passwordHash: 'dummyhash',
      role: 'employee',
      employeeStatus: 'active',
      dateOfJoining: joinDate.toISOString().slice(0, 10),
    });

    await db.insert(schema.employeeCompensationProfiles).values({
      tenantId,
      userId,
      annualCtc,
      monthlyGross: annualCtc / 12,
      monthlyBasic: (annualCtc / 12) * 0.5,
      effectiveFrom: '2025-01-01',
      status: 'active',
    });

    return { tenantId, userId };
  };

  it('1. Evaluates eligibility and available limit accurately based on net salary basis', { concurrency: false }, async () => {
    const { tenantId, userId } = await setupTenantAndEmployee(1, 12, 1200000);

    const res = await evaluateSalaryAdvanceEligibility(tenantId, userId);
    assert.equal(res.eligible, true);
    assert.equal(res.reasons.length, 0);
    assert.ok(res.availableAdvance > 0);
    // Net basis: CTC 12L -> ~100k gross -> 85k net -> 50% = 42,500 capped under 50,000 policy max
    assert.equal(res.availableAdvance, 42500);
    assert.equal(res.currentOutstanding, 0);
    assert.equal(res.activeAdvancesCount, 0);
  });

  it('2. Enforces minimum tenure policy rejection', { concurrency: false }, async () => {
    const { tenantId, userId } = await setupTenantAndEmployee(2, 1, 1200000); // 1 month tenure

    const res = await evaluateSalaryAdvanceEligibility(tenantId, userId, 5000);
    assert.equal(res.eligible, false);
    assert.ok(res.reasons.some((r) => r.includes('Minimum employee tenure requirement')));
  });

  it('3. Generates discrete, exact recovery schedule without floating point drift across installments', { concurrency: false }, () => {
    const schedule = generateRecoveryScheduleRecords({
      advanceId: 101,
      tenantId: 9991,
      userId: 9901,
      totalAmount: 10000, // 10000 / 3 = 3333.3333333333335
      installments: 3,
      startYear: 2026,
      startMonth: 9,
    });

    assert.equal(schedule.length, 3);
    assert.equal(schedule[0].scheduledAmount, '3333.34'); // Absorbs 1-cent division remainder
    assert.equal(schedule[1].scheduledAmount, '3333.33');
    assert.equal(schedule[2].scheduledAmount, '3333.33');
    const totalScheduled = schedule.reduce((sum, item) => sum + Number(item.scheduledAmount), 0);
    assert.equal(totalScheduled, 10000);
  });

  it('4. Handles calendar rollover in multi-month installment schedules', { concurrency: false }, () => {
    const schedule = generateRecoveryScheduleRecords({
      advanceId: 102,
      tenantId: 9991,
      userId: 9901,
      totalAmount: 12000,
      installments: 4,
      startYear: 2026,
      startMonth: 11, // Nov 2026, Dec 2026, Jan 2027, Feb 2027
    });

    assert.equal(schedule.length, 4);
    assert.deepEqual(
      schedule.map((s) => ({ year: s.scheduledYear, month: s.scheduledMonth })),
      [
        { year: 2026, month: 11 },
        { year: 2026, month: 12 },
        { year: 2027, month: 1 },
        { year: 2027, month: 2 },
      ]
    );
  });

  it('5. Full lifecycle: Request -> Approval -> Disbursement -> Recovery generation', { concurrency: false }, async () => {
    const { tenantId, userId } = await setupTenantAndEmployee(5, 12, 1200000);

    // 1. Employee creates request for ₹30,000 in 3 installments starting Sep 2026
    const advance = await createSalaryAdvanceRequest({
      tenantId,
      userId,
      requestedAmount: 30000,
      reason: 'Home renovation',
      recoveryMethod: 'multiple_installments',
      recoveryInstallments: 3,
      startYear: 2026,
      startMonth: 9,
      requestedByUserId: userId,
    });

    assert.ok(advance.id);
    assert.equal(advance.status, 'pending_approval');
    assert.equal(advance.requestedAmount, '30000.00');

    // 2. Approver approves the advance
    const approved = await approveSalaryAdvance({
      advanceId: advance.id,
      tenantId,
      approverUserId: 1,
      approvedAmount: 30000,
      remarks: 'Approved as per policy',
    });
    assert.equal(approved.status, 'approved');
    assert.equal(approved.approvedAmount, '30000.00');

    // 3. Finance disburses the advance with reference
    const disbursed = await disburseSalaryAdvance({
      advanceId: advance.id,
      tenantId,
      disburserUserId: 1,
      disbursedAmount: 30000,
      disbursementMethod: 'bank_transfer',
      disbursementReference: 'UTR9988776655',
    });
    assert.equal(disbursed.status, 'disbursed');
    assert.equal(disbursed.outstandingAmount, '30000.00');

    // 4. Verify recovery schedule records were committed
    const recoveries = await db.select().from(schema.salaryAdvanceRecoveries).where(eq(schema.salaryAdvanceRecoveries.advanceId, advance.id));
    assert.equal(recoveries.length, 3);
    assert.equal(recoveries[0].status, 'scheduled');
    assert.equal(recoveries[0].scheduledAmount, '10000.00');
  });

  it('6. Rejection lifecycle: moves to rejected status with reason recorded', { concurrency: false }, async () => {
    const { tenantId, userId } = await setupTenantAndEmployee(6, 12, 1200000);

    const advance = await createSalaryAdvanceRequest({
      tenantId,
      userId,
      requestedAmount: 20000,
      reason: 'Personal expense',
      recoveryMethod: 'full_next_payroll',
      startYear: 2026,
      startMonth: 9,
      requestedByUserId: userId,
    });

    const rejected = await rejectSalaryAdvance({
      advanceId: advance.id,
      tenantId,
      rejecterUserId: 1,
      reason: 'Inadequate monthly balance projection',
    });

    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.rejectionReason, 'Inadequate monthly balance projection');
  });

  it('7. Cancellation lifecycle: employee can cancel own pending request', { concurrency: false }, async () => {
    const { tenantId, userId } = await setupTenantAndEmployee(7, 12, 1200000);

    const advance = await createSalaryAdvanceRequest({
      tenantId,
      userId,
      requestedAmount: 15000,
      reason: 'Medical buffer',
      recoveryMethod: 'full_next_payroll',
      startYear: 2026,
      startMonth: 9,
      requestedByUserId: userId,
    });

    const cancelled = await cancelSalaryAdvance({
      advanceId: advance.id,
      tenantId,
      actorUserId: userId,
      reason: 'No longer needed',
    });

    assert.equal(cancelled.status, 'cancelled');
  });  it('8. Deep Integration: Batch calculation previews recovery, finalization commits recovery and ledger entry', { concurrency: false }, async () => {
    const { tenantId, userId } = await setupTenantAndEmployee(8, 12, 1200000);

    // 1. Create and disburse advance of 20,000 for Sep 2026 & Oct 2026 (10,000 each)
    const adv = await createSalaryAdvanceRequest({
      tenantId,
      userId,
      requestedAmount: 20000,
      reason: 'Education fees',
      recoveryMethod: 'multiple_installments',
      recoveryInstallments: 2,
      startYear: 2026,
      startMonth: 9,
      requestedByUserId: userId,
    });

    await approveSalaryAdvance({
      advanceId: adv.id,
      tenantId,
      approverUserId: 1,
    });

    await disburseSalaryAdvance({
      advanceId: adv.id,
      tenantId,
      disburserUserId: 1,
      disbursedAmount: 20000,
    });

    // 2. Create Payroll Batch for September 2026
    const [batch] = await db.insert(schema.payrollBatches).values({
      id: tenantId + 500,
      tenantId,
      year: 2026,
      month: 9,
      status: 'draft',
      calculatedAt: null,
    }).returning();

    // 3. Run Calculation for batch
    await calculatePayrollBatch(batch.id, tenantId, 'Admin');

    // Verify preview line item exists in calculated payrollRuns
    const runs = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.batchId, batch.id));
    assert.ok(runs.length >= 1);
    const empRun = runs.find((r: any) => (r.userId || r.user_id) === userId);
    assert.ok(empRun);

    const breakdown = Array.isArray(empRun.breakdown) ? empRun.breakdown : [];
    const advanceLine = breakdown.find((b: any) => b.type === 'advance_recovery' && b.salaryAdvanceId === adv.id);
    assert.ok(advanceLine);
    assert.equal(advanceLine.amount, -10000);

    // Before finalization, recovery row is still 'scheduled'
    const preRec = await db.select().from(schema.salaryAdvanceRecoveries).where(and(
      eq(schema.salaryAdvanceRecoveries.advanceId, adv.id),
      eq(schema.salaryAdvanceRecoveries.scheduledMonth, 9),
    ));
    assert.equal(preRec[0].status, 'scheduled');

    // 4. Finalize Batch Financials
    await finalizePayrollBatchFinancials(batch.id);

    // Verify recovery row is now 'recovered'
    const postRec = await db.select().from(schema.salaryAdvanceRecoveries).where(and(
      eq(schema.salaryAdvanceRecoveries.advanceId, adv.id),
      eq(schema.salaryAdvanceRecoveries.scheduledMonth, 9),
    ));
    assert.equal(postRec[0].status, 'recovered');
    assert.equal(postRec[0].recoveredAmount, '10000.00');

    // Verify parent advance is now 'partially_recovered' with outstanding 10,000
    const [updatedAdv] = await db.select().from(schema.salaryAdvances).where(eq(schema.salaryAdvances.id, adv.id));
    assert.equal(updatedAdv.status, 'partially_recovered');
    assert.equal(updatedAdv.recoveredAmount, '10000.00');
    assert.equal(updatedAdv.outstandingAmount, '10000.00');

    // Verify immutable ledger entry was posted
    const ledger = await db.select().from(schema.payrollLedgerEntries).where(and(
      eq(schema.payrollLedgerEntries.tenantId, tenantId),
      eq(schema.payrollLedgerEntries.batchId, batch.id),
      eq(schema.payrollLedgerEntries.entryType, 'advance_recovery'),
    ));
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].sourceTable, 'salary_advances');
    assert.equal(ledger[0].sourceId, adv.id);
    assert.equal(Number(ledger[0].amount), -10000);
  });

  it('9. Exact Next-Month Scenario: Request 18 Aug -> Disburse 18 Aug -> Aug Payroll unaffected -> Sep Payroll recovers 10,000 & Closes Advance', { concurrency: false }, async () => {
    const { tenantId, userId } = await setupTenantAndEmployee(9, 12, 1200000);

    // 1. Employee requests ₹10,000 on 18 Aug 2026, targeting recovery starting in September 2026
    const adv = await createSalaryAdvanceRequest({
      tenantId,
      userId,
      requestedAmount: 10000,
      reason: 'Medical expense',
      recoveryMethod: 'full_next_payroll',
      recoveryInstallments: 1,
      startYear: 2026,
      startMonth: 9,
      requestedByUserId: userId,
    });

    await approveSalaryAdvance({
      advanceId: adv.id,
      tenantId,
      approverUserId: 1,
      approvedAmount: 10000,
    });

    await disburseSalaryAdvance({
      advanceId: adv.id,
      tenantId,
      disburserUserId: 1,
      disbursedAmount: 10000,
      disbursementMethod: 'bank_transfer',
      disbursementReference: 'UTR-AUG-18-9999',
    });

    // Verify disbursement created an asset ledger entry for +₹10,000
    const disbLedger = await db.select().from(schema.payrollLedgerEntries).where(and(
      eq(schema.payrollLedgerEntries.tenantId, tenantId),
      eq(schema.payrollLedgerEntries.sourceId, adv.id),
      eq(schema.payrollLedgerEntries.entryType, 'advance_disbursement'),
    ));
    assert.equal(disbLedger.length, 1);
    assert.equal(Number(disbLedger[0].amount), 10000);

    // 2. Run August 2026 Payroll Batch (Current Month Payroll)
    const [augBatch] = await db.insert(schema.payrollBatches).values({
      id: tenantId + 501,
      tenantId,
      year: 2026,
      month: 8,
      status: 'draft',
    }).returning();

    await calculatePayrollBatch(augBatch.id, tenantId, 'Admin');

    // Verify August payroll has ZERO advance deductions for this advance
    const [augRun] = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.batchId, augBatch.id));
    const augBreakdown = Array.isArray(augRun.breakdown) ? augRun.breakdown : [];
    const augAdvDeduction = augBreakdown.find((b: any) => b.salaryAdvanceId === adv.id);
    assert.equal(augAdvDeduction, undefined);

    await finalizePayrollBatchFinancials(augBatch.id);

    // Advance remains in 'disbursed' status with full 10,000 outstanding after August payroll
    const [advPostAug] = await db.select().from(schema.salaryAdvances).where(eq(schema.salaryAdvances.id, adv.id));
    assert.equal(advPostAug.status, 'disbursed');
    assert.equal(advPostAug.outstandingAmount, '10000.00');

    // 3. Run September 2026 Payroll Batch (Next Month Payroll)
    const [sepBatch] = await db.insert(schema.payrollBatches).values({
      id: tenantId + 502,
      tenantId,
      year: 2026,
      month: 9,
      status: 'draft',
    }).returning();

    await calculatePayrollBatch(sepBatch.id, tenantId, 'Admin');

    // Verify September payroll deducted exactly ₹10,000
    const [sepRun] = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.batchId, sepBatch.id));
    const sepBreakdown = Array.isArray(sepRun.breakdown) ? sepRun.breakdown : [];
    const sepAdvDeduction = sepBreakdown.find((b: any) => b.salaryAdvanceId === adv.id);
    assert.ok(sepAdvDeduction);
    assert.equal(sepAdvDeduction.amount, -10000);

    // 4. Finalize September 2026 Payroll Batch
    await finalizePayrollBatchFinancials(sepBatch.id);

    // Verify advance is now completely 'closed' with 0 outstanding
    const [advPostSep] = await db.select().from(schema.salaryAdvances).where(eq(schema.salaryAdvances.id, adv.id));
    assert.equal(advPostSep.status, 'closed');
    assert.equal(advPostSep.outstandingAmount, '0.00');
    assert.equal(advPostSep.recoveredAmount, '10000.00');

    // Verify ledger has clean double-entry clearing: +10,000 disbursement and -10,000 recovery
    const allAdvLedgers = await db.select().from(schema.payrollLedgerEntries).where(and(
      eq(schema.payrollLedgerEntries.tenantId, tenantId),
      eq(schema.payrollLedgerEntries.sourceId, adv.id),
    ));
    assert.equal(allAdvLedgers.length, 2);
    const netLedgerBalance = allAdvLedgers.reduce((sum, entry) => sum + Number(entry.amount), 0);
    assert.equal(netLedgerBalance, 0); // Net asset/liability offset is exactly zero
  });

  it('10. Recalculation Idempotency: Multiple calculatePayrollBatch runs do not double deductions or mutate recovery status', { concurrency: false }, async () => {
    const { tenantId, userId } = await setupTenantAndEmployee(10, 12, 1200000);

    const adv = await createSalaryAdvanceRequest({
      tenantId,
      userId,
      requestedAmount: 15000,
      reason: 'Home repairs',
      recoveryMethod: 'full_next_payroll',
      startYear: 2026,
      startMonth: 9,
      requestedByUserId: userId,
    });

    await approveSalaryAdvance({ advanceId: adv.id, tenantId, approverUserId: 1 });
    await disburseSalaryAdvance({ advanceId: adv.id, tenantId, disburserUserId: 1, disbursedAmount: 15000 });

    const [batch] = await db.insert(schema.payrollBatches).values({
      id: tenantId + 500,
      tenantId,
      year: 2026,
      month: 9,
      status: 'draft',
    }).returning();

    // Recalculate 5 times consecutively in draft mode
    for (let i = 0; i < 5; i++) {
      await calculatePayrollBatch(batch.id, tenantId, 'Admin');
    }

    const runs = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.batchId, batch.id));
    assert.equal(runs.length, 1);
    const breakdown = Array.isArray(runs[0].breakdown) ? runs[0].breakdown : [];
    const advanceRecoveries = breakdown.filter((b: any) => b.salaryAdvanceId === adv.id);
    // Must be exactly 1 deduction line item of -15,000, never duplicated
    assert.equal(advanceRecoveries.length, 1);
    assert.equal(advanceRecoveries[0].amount, -15000);

    // Scheduled recovery must still be in 'scheduled' status
    const recoveries = await db.select().from(schema.salaryAdvanceRecoveries).where(eq(schema.salaryAdvanceRecoveries.advanceId, adv.id));
    assert.equal(recoveries.length, 1);
    assert.equal(recoveries[0].status, 'scheduled');
  });

  it('11. Immutability & Re-finalization Guard: Closed advance and finalized batch cannot be modified or double-applied', { concurrency: false }, async () => {
    const { tenantId, userId } = await setupTenantAndEmployee(11, 12, 1200000);

    const adv = await createSalaryAdvanceRequest({
      tenantId,
      userId,
      requestedAmount: 10000,
      reason: 'Certification fees',
      recoveryMethod: 'full_next_payroll',
      startYear: 2026,
      startMonth: 9,
      requestedByUserId: userId,
    });

    await approveSalaryAdvance({ advanceId: adv.id, tenantId, approverUserId: 1 });
    await disburseSalaryAdvance({ advanceId: adv.id, tenantId, disburserUserId: 1, disbursedAmount: 10000 });

    const [batch] = await db.insert(schema.payrollBatches).values({
      id: tenantId + 500,
      tenantId,
      year: 2026,
      month: 9,
      status: 'draft',
    }).returning();

    await calculatePayrollBatch(batch.id, tenantId, 'Admin');
    await finalizePayrollBatchFinancials(batch.id);

    // 1. Re-running finalization on already finalized batch exits idempotently without adding duplicate ledger rows
    await finalizePayrollBatchFinancials(batch.id);

    const ledgerEntries = await db.select().from(schema.payrollLedgerEntries).where(and(
      eq(schema.payrollLedgerEntries.tenantId, tenantId),
      eq(schema.payrollLedgerEntries.batchId, batch.id),
      eq(schema.payrollLedgerEntries.entryType, 'advance_recovery'),
    ));
    assert.equal(ledgerEntries.length, 1);

    // 2. Attempting to cancel a closed/disbursed advance throws an error
    await assert.rejects(
      async () => {
        await cancelSalaryAdvance({
          advanceId: adv.id,
          tenantId,
          actorUserId: userId,
          reason: 'Try cancelling after finalization',
        });
      },
      /Disbursed advances cannot be cancelled directly|Cannot cancel advance/
    );
  });
});

