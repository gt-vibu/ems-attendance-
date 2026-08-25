import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTaxLawVersion, computeTdsForEmployee, computeHraExemption } from './api/services/tdsEngine.ts';
import { resolveStatutoryRules } from './api/services/complianceResolver.ts';

describe('TDS Engine & Date-Driven Tax Law Resolver', () => {
  test('Payment Date April 2026+ resolves to Income Tax Act, 2025 Section 392(1) (AY 2026-27)', () => {
    const info = resolveTaxLawVersion('2026-04-15');
    assert.equal(info.taxYear, '2026-2027');
    assert.equal(info.taxLawVersion, 'ITA_2025_SECTION_392_AY2026_27');
    assert.ok(info.legalReference.includes('Section 392(1) of the Income Tax Act, 2025'));
  });

  test('Payment Date before April 2026 resolves to Income Tax Act, 1961 (FY 2025-26)', () => {
    const info = resolveTaxLawVersion('2025-12-15');
    assert.equal(info.taxYear, '2025-2026');
    assert.equal(info.taxLawVersion, 'ITA_1961_FY2025_26');
    assert.ok(info.legalReference.includes('Income Tax Act, 1961'));
  });

  test('ITA 2025 Section 392(1) New Regime Slab & Sec 87A Rebate Math (Income <= 12L has zero net tax)', () => {
    // Annual CTC = 1,100,000 (11 Lakhs). Standard Deduction = 75,000 -> Taxable = 1,025,000
    // Slabs AY26-27: 0-4L (0%), 4-8L (5% of 4L = 20k), 8-12L (10% of 2.25L = 22.5k) -> Total raw tax = 42,500
    // Section 87A rebate for taxable <= 12L = min(raw tax, 60,000) = 42,500 -> Net tax = 0
    const result = computeTdsForEmployee({
      paymentDate: '2026-05-01',
      annualCtc: 1100000,
      monthlyGross: 1100000 / 12,
      basicMonthly: (1100000 / 12) * 0.5,
      regime: 'new_regime',
    });

    assert.equal(result.taxLawVersion, 'ITA_2025_SECTION_392_AY2026_27');
    assert.equal(Math.round(result.taxableAnnualIncome), 1025000);
    assert.equal(Math.round(result.section87aRebate), 42500);
    assert.equal(result.totalAnnualTaxLiability, 0);
    assert.equal(result.monthlyTdsDeduction, 0);
  });

  test('ITA 2025 Section 392(1) New Regime Slab 25% (Income between 20L and 24L)', () => {
    // Annual CTC = 2,275,000 (22.75 Lakhs). Standard Deduction = 75,000 -> Taxable = 22,00,000 (22 Lakhs)
    // Slabs:
    // 0 - 4L (0%) = 0
    // 4L - 8L (5% of 4L) = 20,000
    // 8L - 12L (10% of 4L) = 40,000
    // 12L - 16L (15% of 4L) = 60,000
    // 16L - 20L (20% of 4L) = 80,000
    // 20L - 22L (25% of 2L) = 50,000
    // Raw Tax = 20k + 40k + 60k + 80k + 50k = 250,000
    // 4% Cess = 10,000 -> Total Tax = 260,000
    const result = computeTdsForEmployee({
      paymentDate: '2026-06-01',
      annualCtc: 2275000,
      monthlyGross: 2275000 / 12,
      basicMonthly: (2275000 / 12) * 0.5,
      regime: 'new_regime',
    });

    assert.equal(Math.round(result.taxableAnnualIncome), 2200000);
    assert.equal(Math.round(result.grossAnnualTax), 250000);
    assert.equal(Math.round(result.cessAmount), 10000);
    assert.equal(result.totalAnnualTaxLiability, 260000);
  });

  test('ITA 2025 Section 392(1) New Regime for High Income (> 24L, 30% slab)', () => {
    // Annual CTC = 3,075,000 (30.75 Lakhs). Standard Deduction = 75,000 -> Taxable = 30,00,000 (30 Lakhs)
    // Slabs:
    // 0-4L (0) = 0
    // 4-8L (5%) = 20,000
    // 8-12L (10%) = 40,000
    // 12-16L (15%) = 60,000
    // 16-20L (20%) = 80,000
    // 20-24L (25% of 4L) = 100,000
    // >24L (30% of 6L) = 180,000
    // Raw Tax = 20k + 40k + 60k + 80k + 100k + 180k = 480,000
    // 4% Cess = 19,200 -> Total Tax = 499,200
    const result = computeTdsForEmployee({
      paymentDate: '2026-06-01',
      annualCtc: 3075000,
      monthlyGross: 3075000 / 12,
      basicMonthly: (3075000 / 12) * 0.5,
      regime: 'new_regime',
    });

    assert.equal(Math.round(result.taxableAnnualIncome), 3000000);
    assert.equal(Math.round(result.grossAnnualTax), 480000);
    assert.equal(Math.round(result.cessAmount), 19200);
    assert.equal(result.totalAnnualTaxLiability, 499200);
  });

  test('HRA Exemption Calculation (Old Regime)', () => {
    // Basic = 50,000/mo (600,000 annual). Annual HRA Received = 300,000. Rent Paid = 240,000 (20k/mo). Metro = true.
    // 1) Actual HRA = 300,000
    // 2) 50% Basic (Metro) = 300,000
    // 3) Rent - 10% Basic = 240,000 - 60,000 = 180,000
    // Least of (300k, 300k, 180k) = 180,000
    const hraExemption = computeHraExemption(50000, 300000, 240000, true);
    assert.equal(hraExemption, 180000);
  });
});

describe('Statutory Compliance Engine Resolution & Edge Cases', () => {
  test('EPF EPS cap (₹1,250) and EDLI math for basic wage > 15,000', async () => {
    // Basic Monthly = 30,000. Under default capping strategy (cap at ₹15,000):
    // Employee PF = 15,000 * 12% = 1,800
    // Employer EPS = min(15,000 * 8.33%, 1250) = 1,250
    // Employer EPF = 1,800 - 1,250 = 550
    // Employer EDLI = 15,000 * 0.5% = 75
    const res = await resolveStatutoryRules({
      tenantId: 1,
      userId: 9999,
      payrollPeriod: { year: 2026, month: 4 },
      paymentDate: '2026-04-15',
      workLocationState: 'IN-KA',
      monthlyGross: 60000,
      basicMonthly: 30000,
    });

    assert.equal(res.calculations.pfEmployeeDeduction, 1800);
    assert.equal(res.calculations.pfEmployerEpsContribution, 1250);
    assert.equal(res.calculations.pfEmployerContribution, 550);
    assert.equal(res.calculations.pfEmployerEdliContribution, 75);
  });

  test('ESIC Regulation 31 — Contribution Period Continuity Rule (Apr-Sep)', async () => {
    // Scenario:
    // 1) April (Start of Apr-Sep Contribution Period): Gross = ₹20,000 (≤ ₹21k) -> ESI Eligible
    const aprilRes = await resolveStatutoryRules({
      tenantId: 1,
      userId: 9999,
      payrollPeriod: { year: 2026, month: 4 },
      paymentDate: '2026-04-30',
      monthlyGross: 20000,
      basicMonthly: 10000,
    });
    assert.equal(aprilRes.derivedEligibility.esiEligible, true);
    assert.equal(aprilRes.calculations.esiEmployeeDeduction, 150); // 0.75% of 20,000

    // 2) June (Mid Contribution Period): Gross increases to ₹22,000 (> ₹21k).
    // ESIC Regulation 31: Because employee was covered at start of period (April),
    // they REMAIN covered until 30th September and deductions continue on full gross (22,000 * 0.75% = 165).
    const juneRes = await resolveStatutoryRules({
      tenantId: 1,
      userId: 9999,
      payrollPeriod: { year: 2026, month: 6 },
      paymentDate: '2026-06-30',
      monthlyGross: 22000,
      basicMonthly: 11000,
      esiCoveredAtPeriodStart: true, // Covered in April
    });
    assert.equal(juneRes.derivedEligibility.esiEligible, true);
    assert.equal(juneRes.calculations.esiEmployeeDeduction, 165); // 0.75% of 22,000
    assert.ok(juneRes.derivedEligibility.overridesApplied.some((o) => o.includes('Contribution Period Continuity Rule')));

    // 3) October (Start of Next Contribution Period): Gross = ₹22,000 (> ₹21k).
    // New contribution period starts; eligibility re-evaluated based on ceiling -> Exempt.
    const octRes = await resolveStatutoryRules({
      tenantId: 1,
      userId: 9999,
      payrollPeriod: { year: 2026, month: 10 },
      paymentDate: '2026-10-31',
      monthlyGross: 22000,
      basicMonthly: 11000,
      esiCoveredAtPeriodStart: false,
    });
    assert.equal(octRes.derivedEligibility.esiEligible, false);
    assert.equal(octRes.calculations.esiEmployeeDeduction, 0);
  });

  test('Maharashtra Professional Tax February ₹300 top slab vs regular month ₹200 slab', async () => {
    // Non-February (April 2026)
    const aprilRes = await resolveStatutoryRules({
      tenantId: 1,
      userId: 9999,
      payrollPeriod: { year: 2026, month: 4 },
      paymentDate: '2026-04-15',
      workLocationState: 'IN-MH',
      monthlyGross: 30000,
      basicMonthly: 15000,
    });
    assert.equal(aprilRes.calculations.professionalTaxDeduction, 200);

    // February (February 2027)
    const febRes = await resolveStatutoryRules({
      tenantId: 1,
      userId: 9999,
      payrollPeriod: { year: 2027, month: 2 },
      paymentDate: '2027-02-15',
      workLocationState: 'IN-MH',
      monthlyGross: 30000,
      basicMonthly: 15000,
    });
    assert.equal(febRes.calculations.professionalTaxDeduction, 300);
  });

  test('Unsupported State Jurisdiction returns ptRule: null and emits WARNING (never defaults to Karnataka)', async () => {
    const res = await resolveStatutoryRules({
      tenantId: 1,
      userId: 9999,
      payrollPeriod: { year: 2026, month: 4 },
      paymentDate: '2026-04-15',
      workLocationState: 'IN-XY', // Unsupported jurisdiction code
      monthlyGross: 30000,
      basicMonthly: 15000,
    });

    assert.equal(res.ptRule, null);
    assert.equal(res.calculations.professionalTaxDeduction, 0);
    const ptWarning = res.validationIssues.find((i) => i.code === 'UNSUPPORTED_PT_JURISDICTION');
    assert.ok(ptWarning);
    assert.ok(ptWarning.message.includes('IN-XY'));
  });
});
