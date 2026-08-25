export interface TdsCalculationInput {
  paymentDate: string; // 'YYYY-MM-DD'
  annualCtc: number;
  monthlyGross: number;
  basicMonthly: number;
  regime: 'new_regime' | 'old_regime';
  isSeniorCitizen?: boolean;
  isSuperSeniorCitizen?: boolean;
  declarations?: {
    section80c?: number;
    section80d?: number;
    section80ccd1b?: number;
    hraRentPaid?: number;
    isMetroCity?: boolean;
    homeLoanInterest24b?: number;
    otherIncome?: number;
    previousEmployerIncome?: number;
    previousEmployerTds?: number;
    proofStatus?: string;
  };
  ruleParameters?: Record<string, any>;
}

export interface TdsCalculationResult {
  taxYear: string;
  taxLawVersion: string;
  legalReference: string;
  regimeUsed: 'new_regime' | 'old_regime';
  annualGrossIncome: number;
  totalExemptionsAndDeductions: number;
  taxableAnnualIncome: number;
  grossAnnualTax: number;
  section87aRebate: number;
  surchargeAmount: number;
  marginalRelief: number;
  cessAmount: number;
  totalAnnualTaxLiability: number;
  monthlyTdsDeduction: number;
  explanation: {
    lawVersion: string;
    standardDeduction: number;
    hraExemption: number;
    section80cDeduction: number;
    section80dDeduction: number;
    otherDeductions: number;
    taxableIncome: number;
    slabTaxBreakdown: Array<{ bracket: string; amount: number; tax: number }>;
    rebateApplied: number;
    cess: number;
  };
}

export function resolveTaxLawVersion(paymentDate: string) {
  const dateStr = String(paymentDate || '').slice(0, 10);
  if (dateStr >= '2026-04-01') {
    return {
      taxYear: '2026-2027',
      assessmentYear: '2027-2028',
      taxLawVersion: 'ITA_2025_SECTION_392_AY2026_27',
      legalReference: 'Section 392(1) of the Income Tax Act, 2025 (AY 2026-27)',
    };
  }
  return {
    taxYear: '2025-2026',
    assessmentYear: '2026-2027',
    taxLawVersion: 'ITA_1961_FY2025_26',
    legalReference: 'Section 192 of the Income Tax Act, 1961 (FY 2025-26)',
  };
}

function computeSlabTax(taxableAmount: number, slabs: Array<{ upTo: number | null; ratePercent: number }>) {
  if (!Array.isArray(slabs) || slabs.length === 0 || taxableAmount <= 0) {
    return { totalTax: 0, breakdown: [] };
  }
  let totalTax = 0;
  let lastUpTo = 0;
  const breakdown: Array<{ bracket: string; amount: number; tax: number }> = [];

  for (const slab of slabs) {
    const upTo = slab.upTo == null ? Infinity : Number(slab.upTo);
    const bracketAmount = Math.max(0, Math.min(taxableAmount, upTo) - lastUpTo);
    const tax = bracketAmount * (Number(slab.ratePercent || 0) / 100);
    if (bracketAmount > 0) {
      breakdown.push({
        bracket: slab.upTo == null ? `> ₹${lastUpTo.toLocaleString('en-IN')}` : `₹${lastUpTo.toLocaleString('en-IN')} - ₹${upTo.toLocaleString('en-IN')} (${slab.ratePercent}%)`,
        amount: bracketAmount,
        tax,
      });
    }
    totalTax += tax;
    lastUpTo = upTo;
    if (taxableAmount <= upTo) break;
  }
  return { totalTax, breakdown };
}

export function computeHraExemption(basicMonthly: number, annualHraReceived: number, rentPaidAnnual: number, isMetro: boolean): number {
  if (rentPaidAnnual <= 0 || annualHraReceived <= 0) return 0;
  const annualBasic = basicMonthly * 12;
  const excessRentOverTenPercentBasic = Math.max(0, rentPaidAnnual - annualBasic * 0.10);
  const basicPercentageCap = isMetro ? annualBasic * 0.50 : annualBasic * 0.40;
  return Math.max(0, Math.min(annualHraReceived, excessRentOverTenPercentBasic, basicPercentageCap));
}

export function computeTdsForEmployee(input: TdsCalculationInput): TdsCalculationResult {
  const lawInfo = resolveTaxLawVersion(input.paymentDate);
  const isAct2025 = lawInfo.taxLawVersion.startsWith('ITA_2025');

  const params = input.ruleParameters || {};
  const isNewRegime = input.regime === 'new_regime';

  const annualGross = (input.monthlyGross * 12) + Number(input.declarations?.otherIncome || 0) + Number(input.declarations?.previousEmployerIncome || 0);
  const annualBasic = input.basicMonthly * 12;
  const annualHra = Math.max(0, annualGross - annualBasic); // estimate annual HRA if component not split

  let standardDeduction = 0;
  let hraExemption = 0;
  let sec80c = 0;
  let sec80d = 0;
  let sec80ccd1b = 0;
  let sec24b = 0;

  if (isNewRegime) {
    standardDeduction = isAct2025
      ? Number(params.standardDeductionNewRegime ?? 75000)
      : Number(params.standardDeductionNewRegime ?? 75000);
  } else {
    standardDeduction = Number(params.standardDeductionOldRegime ?? 50000);
    
    // Deductions allowed only under Verified/Submitted Old Regime
    if (input.declarations) {
      const decl = input.declarations;
      hraExemption = computeHraExemption(input.basicMonthly, annualHra, Number(decl.hraRentPaid || 0), !!decl.isMetroCity);
      sec80c = Math.min(Number(decl.section80c || 0), Number(params.section80cMaxLimit ?? 150000));
      sec80d = Math.min(Number(decl.section80d || 0), Number(params.section80dSelfMaxLimit ?? 25000));
      sec80ccd1b = Math.min(Number(decl.section80ccd1b || 0), Number(params.section80ccd1bNpsLimit ?? 50000));
      sec24b = Math.min(Number(decl.homeLoanInterest24b || 0), Number(params.section24bHomeLoanInterestLimit ?? 200000));
    }
  }

  const totalDeductions = standardDeduction + hraExemption + sec80c + sec80d + sec80ccd1b + sec24b;
  const taxableAnnualIncome = Math.max(0, annualGross - totalDeductions);

  // Slabs resolution
  let slabs = isNewRegime
    ? (params.newRegimeSlabs || [
        { upTo: 400000, ratePercent: 0 },
        { upTo: 800000, ratePercent: 5 },
        { upTo: 1200000, ratePercent: 10 },
        { upTo: 1600000, ratePercent: 15 },
        { upTo: 2000000, ratePercent: 20 },
        { upTo: 2400000, ratePercent: 25 },
        { upTo: null, ratePercent: 30 },
      ])
    : (input.isSeniorCitizen && params.seniorCitizenOldRegimeSlabs ? params.seniorCitizenOldRegimeSlabs : (params.oldRegimeSlabs || [
        { upTo: 250000, ratePercent: 0 },
        { upTo: 500000, ratePercent: 5 },
        { upTo: 1000000, ratePercent: 20 },
        { upTo: null, ratePercent: 30 },
      ]));

  const { totalTax: rawSlabTax, breakdown } = computeSlabTax(taxableAnnualIncome, slabs);

  // Section 87A Rebate
  let rebate87a = 0;
  if (isNewRegime) {
    const rebateLimit = isAct2025 ? Number(params.rebate87aLimitNewRegime ?? 1200000) : Number(params.rebate87aLimitNewRegime ?? 700000);
    const maxRebate = isAct2025 ? Number(params.rebate87aMaxAmountNewRegime ?? 60000) : Number(params.rebate87aMaxAmountNewRegime ?? 25000);
    if (taxableAnnualIncome <= rebateLimit) {
      rebate87a = Math.min(rawSlabTax, maxRebate);
    }
  } else {
    const rebateLimit = Number(params.rebate87aLimitOldRegime ?? 500000);
    const maxRebate = Number(params.rebate87aMaxAmountOldRegime ?? 12500);
    if (taxableAnnualIncome <= rebateLimit) {
      rebate87a = Math.min(rawSlabTax, maxRebate);
    }
  }

  const taxAfterRebate = Math.max(0, rawSlabTax - rebate87a);

  // Surcharge
  let surchargeAmount = 0;
  const surchargeSlabs = params.surchargeSlabs || [
    { minNetIncome: 5000000, maxNetIncome: 10000000, surchargePercent: 10 },
    { minNetIncome: 10000000, maxNetIncome: 20000000, surchargePercent: 15 },
    { minNetIncome: 20000000, maxNetIncome: null, surchargePercent: 25 },
  ];
  const matchedSurcharge = surchargeSlabs.find((s: any) => taxableAnnualIncome > s.minNetIncome && (s.maxNetIncome == null || taxableAnnualIncome <= s.maxNetIncome));
  if (matchedSurcharge && taxAfterRebate > 0) {
    surchargeAmount = taxAfterRebate * (Number(matchedSurcharge.surchargePercent) / 100);
  }

  const cessPercent = Number(params.cessPercent ?? 4);
  const taxPlusSurcharge = taxAfterRebate + surchargeAmount;
  const cessAmount = taxPlusSurcharge * (cessPercent / 100);
  const totalAnnualTaxLiability = Math.round(taxPlusSurcharge + cessAmount);

  // Previous employer TDS adjustment
  const prevTds = Number(input.declarations?.previousEmployerTds || 0);
  const netAnnualTaxLiability = Math.max(0, totalAnnualTaxLiability - prevTds);
  const monthlyTdsDeduction = Math.round((netAnnualTaxLiability / 12) * 100) / 100;

  return {
    taxYear: lawInfo.taxYear,
    taxLawVersion: lawInfo.taxLawVersion,
    legalReference: lawInfo.legalReference,
    regimeUsed: input.regime,
    annualGrossIncome: annualGross,
    totalExemptionsAndDeductions: totalDeductions,
    taxableAnnualIncome,
    grossAnnualTax: rawSlabTax,
    section87aRebate: rebate87a,
    surchargeAmount,
    marginalRelief: 0,
    cessAmount,
    totalAnnualTaxLiability,
    monthlyTdsDeduction,
    explanation: {
      lawVersion: lawInfo.taxLawVersion,
      standardDeduction,
      hraExemption,
      section80cDeduction: sec80c,
      section80dDeduction: sec80d,
      otherDeductions: sec80ccd1b + sec24b,
      taxableIncome: taxableAnnualIncome,
      slabTaxBreakdown: breakdown,
      rebateApplied: rebate87a,
      cess: cessAmount,
    },
  };
}
