import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeFinalSettlement } from './api/routes/leavePayrollShared.ts';

// Pure-function coverage for the settlement math extracted out of
// payrollExtras.routes.ts's /settlements/generate handler this audit round
// (see leavePayrollShared.ts's computeFinalSettlement doc comment) — this
// is exactly the kind of business logic the production-readiness audit
// flagged as untested. No DB/network required: every input is a plain
// number/string, matching the style of the other *.test.ts files in this
// package (pure-function unit tests via node:test, no integration/DB
// layer — a live Postgres isn't available in this environment to safely
// test the transaction/concurrency-guard fixes made alongside this).
describe('computeFinalSettlement', () => {
  test('sums remaining salary + leave encashment + bonus, then subtracts recoveries', () => {
    const result = computeFinalSettlement({
      dailyRate: 1000,
      lastWorkingDate: '2026-03-15',
      encashableLeaveDays: 5,
      pendingBonusAmount: 2000,
      loanAdvanceRecoveryAmount: 3000,
      noticePeriodRecoveryAmount: 1000,
    });

    // remainingSalaryAmount = dailyRate * daysWorkedInExitMonth (the "15" from the date)
    assert.equal(result.daysWorkedInExitMonth, 15);
    assert.equal(result.remainingSalaryAmount, 15000);
    assert.equal(result.leaveEncashmentAmount, 5000);
    assert.equal(result.grossSettlement, 15000 + 5000 + 2000); // 22000
    assert.equal(result.netSettlement, 22000 - 1000 - 3000); // 18000
  });

  test('a missing noticePeriodRecoveryAmount defaults to 0, not NaN', () => {
    const result = computeFinalSettlement({
      dailyRate: 500,
      lastWorkingDate: '2026-01-10',
      encashableLeaveDays: 0,
      pendingBonusAmount: 0,
      loanAdvanceRecoveryAmount: 0,
      noticePeriodRecoveryAmount: undefined as any,
    });
    assert.equal(result.noticeRecovery, 0);
    assert.equal(Number.isNaN(result.netSettlement), false);
    assert.equal(result.netSettlement, 5000); // 10 days * 500
  });

  test('breakdown array has one entry per component, signed correctly (recoveries negative)', () => {
    const result = computeFinalSettlement({
      dailyRate: 800,
      lastWorkingDate: '2026-06-20',
      encashableLeaveDays: 3,
      pendingBonusAmount: 1500,
      loanAdvanceRecoveryAmount: 500,
      noticePeriodRecoveryAmount: 200,
    });
    const byType = Object.fromEntries(result.breakdown.map((b: any) => [b.type, b.amount]));
    assert.equal(byType.remaining_salary, 800 * 20);
    assert.equal(byType.leave_encashment, 800 * 3);
    assert.equal(byType.pending_bonus, 1500);
    assert.equal(byType.notice_period_recovery, -200);
    assert.equal(byType.loan_advance_recovery, -500);
  });

  test('net settlement can be negative when recoveries exceed earnings (no floor applied here — caller/UI must handle)', () => {
    const result = computeFinalSettlement({
      dailyRate: 100,
      lastWorkingDate: '2026-02-02',
      encashableLeaveDays: 0,
      pendingBonusAmount: 0,
      loanAdvanceRecoveryAmount: 5000,
      noticePeriodRecoveryAmount: 0,
    });
    // 2 days worked * 100 = 200 gross, minus 5000 recovery = deeply negative.
    assert.ok(result.netSettlement < 0);
  });
});
