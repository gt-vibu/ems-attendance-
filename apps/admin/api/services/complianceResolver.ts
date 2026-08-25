import { db, schema } from '../../db';
import { eq, and, lte, gte, or, isNull } from 'drizzle-orm';
import { computeTdsForEmployee, resolveTaxLawVersion } from './tdsEngine';

export interface StatutoryResolutionInput {
  tenantId: number;
  userId: number;
  payrollPeriod: { year: number; month: number };
  paymentDate: string; // 'YYYY-MM-DD'
  workLocationState?: string; // e.g. 'IN-KA', 'IN-MH', 'IN-TN', 'IN-TG', 'IN-WB', 'IN-GJ', 'IN-DL'
  monthlyGross: number;
  basicMonthly: number;
  annualCtc?: number;
  esiCoveredAtPeriodStart?: boolean; // ESIC Regulation 31 continuity flag
}

export interface ResolvedRuleInfo {
  ruleCode: string;
  jurisdiction: string;
  version: number;
  effectiveFrom: string;
  legalReference: string;
  authority: string;
  parameters: Record<string, any>;
}

export interface ValidationIssue {
  severity: 'WARNING' | 'BLOCKING_ERROR';
  code: string;
  message: string;
  module: string;
}

export interface StatutoryResolutionResult {
  paymentDate: string;
  taxYear: string;
  taxLawVersion: string;
  legalReference: string;
  workLocationState: string;
  epfRule: ResolvedRuleInfo | null;
  esiRule: ResolvedRuleInfo | null;
  ptRule: ResolvedRuleInfo | null;
  tdsRule: ResolvedRuleInfo | null;
  derivedEligibility: {
    epfEligible: boolean;
    esiEligible: boolean;
    ptApplicable: boolean;
    overridesApplied: string[];
  };
  calculations: {
    basicMonthly: number;
    pfWageBase: number;
    pfEmployeeDeduction: number;
    pfEmployerContribution: number;
    pfEmployerEpsContribution: number;
    pfEmployerEdliContribution: number;
    esiWageBase: number;
    esiEmployeeDeduction: number;
    esiEmployerContribution: number;
    professionalTaxDeduction: number;
    tdsDeduction: number;
    totalEmployeeStatutoryDeductions: number;
    totalEmployerStatutoryContributions: number;
  };
  tdsExplanation: any;
  validationIssues: ValidationIssue[];
}

import { SEEDED_STATUTORY_RULES } from './statutoryCatalog';

export async function resolveEffectiveRuleVersion(ruleCode: string, jurisdiction: string, paymentDate: string): Promise<ResolvedRuleInfo | null> {
  try {
    const rows = await db.select().from(schema.statutoryRuleVersions).where(
      and(
        eq(schema.statutoryRuleVersions.ruleCode, ruleCode),
        eq(schema.statutoryRuleVersions.jurisdiction, jurisdiction),
        eq(schema.statutoryRuleVersions.status, 'active'),
        lte(schema.statutoryRuleVersions.effectiveFrom, paymentDate),
        or(isNull(schema.statutoryRuleVersions.effectiveTo), gte(schema.statutoryRuleVersions.effectiveTo, paymentDate))
      )
    ).orderBy(schema.statutoryRuleVersions.version).limit(1);

    if (rows.length > 0) {
      const row = rows[0];
      return {
        ruleCode: row.ruleCode,
        jurisdiction: row.jurisdiction,
        version: row.version,
        effectiveFrom: row.effectiveFrom,
        legalReference: row.legalReference,
        authority: row.authority,
        parameters: row.parameters as Record<string, any>,
      };
    }
  } catch (err) {
    // DB table unseeded or offline in unit tests; fallback to system catalog below
  }

  // Fallback to in-memory System Statutory Rules Catalog
  const seed = SEEDED_STATUTORY_RULES.find(
    (s) => s.ruleCode === ruleCode && s.jurisdiction === jurisdiction && s.effectiveFrom <= paymentDate && (!s.effectiveTo || s.effectiveTo >= paymentDate)
  );

  if (!seed) return null;

  return {
    ruleCode: seed.ruleCode,
    jurisdiction: seed.jurisdiction,
    version: seed.version,
    effectiveFrom: seed.effectiveFrom,
    legalReference: seed.legalReference,
    authority: seed.authority,
    parameters: seed.parameters as Record<string, any>,
  };
}

export async function resolveStatutoryRules(input: StatutoryResolutionInput): Promise<StatutoryResolutionResult> {
  const paymentDate = input.paymentDate || `${input.payrollPeriod.year}-${String(input.payrollPeriod.month).padStart(2, '0')}-01`;
  const lawInfo = resolveTaxLawVersion(paymentDate);
  const validationIssues: ValidationIssue[] = [];

  // Fetch Company Policy & Employee Profile & Declarations & Overrides
  const [policyRows, profileRows, declarationRows, overrideRows] = await Promise.all([
    db.select().from(schema.companyPayrollPolicies).where(eq(schema.companyPayrollPolicies.tenantId, input.tenantId)).limit(1),
    db.select().from(schema.employeeStatutoryProfiles).where(and(eq(schema.employeeStatutoryProfiles.tenantId, input.tenantId), eq(schema.employeeStatutoryProfiles.userId, input.userId))).limit(1),
    db.select().from(schema.employeeTaxDeclarations).where(and(eq(schema.employeeTaxDeclarations.tenantId, input.tenantId), eq(schema.employeeTaxDeclarations.userId, input.userId), eq(schema.employeeTaxDeclarations.financialYear, lawInfo.taxYear))).limit(1),
    db.select().from(schema.employeeStatutoryOverrides).where(and(eq(schema.employeeStatutoryOverrides.tenantId, input.tenantId), eq(schema.employeeStatutoryOverrides.userId, input.userId))),
  ]);

  const companyPolicy = policyRows[0] || {
    pfCappingStrategy: 'cap_at_statutory_ceiling',
    epsCappingStrategy: 'cap_at_statutory_ceiling',
    defaultTaxRegime: 'new_regime',
    branchStateMappings: [],
  };

  const empProfile = profileRows[0] || null;
  const empDecl = declarationRows[0] || null;

  const stateCode = input.workLocationState || empProfile?.workLocationState || 'IN-KA';

  if (!empProfile) {
    validationIssues.push({
      severity: 'WARNING',
      code: 'MISSING_STATUTORY_PROFILE',
      module: 'profile',
      message: `Employee #${input.userId} has no statutory profile. Work location defaulting to ${stateCode}.`,
    });
  } else if (!empProfile.pan) {
    validationIssues.push({
      severity: 'WARNING',
      code: 'MISSING_PAN',
      module: 'tds',
      message: `Employee #${input.userId} is missing a PAN number (higher TDS deduction may apply if enforced).`,
    });
  }

  const activeOverrides = overrideRows.filter((o) => o.effectiveFrom <= paymentDate && (!o.effectiveTo || o.effectiveTo >= paymentDate));
  const overridesApplied: string[] = [];

  // 1. Resolve EPF Rule
  const epfRule = await resolveEffectiveRuleVersion('IN_EPF', 'IN-NATIONAL', paymentDate);
  let epfEligible = false;
  let pfEmployeeDeduction = 0;
  let pfEmployerContribution = 0;
  let pfEmployerEpsContribution = 0;
  let pfEmployerEdliContribution = 0;
  let pfWageBase = 0;

  if (epfRule) {
    const params = epfRule.parameters;
    const epfOverride = activeOverrides.find((o) => o.statutoryModule === 'epf');

    if (epfOverride) {
      epfEligible = epfOverride.overrideType === 'force_eligible';
      overridesApplied.push(`EPF: ${epfOverride.overrideType} (${epfOverride.reason})`);
    } else {
      // System Derived Eligibility: Eligible by default unless explicitly opted out
      epfEligible = empProfile?.isPfEligible !== false;
    }

    if (epfEligible) {
      const basicCeiling = Number(params.basicWageCeilingMonthly || 15000);
      pfWageBase = companyPolicy.pfCappingStrategy === 'actual_basic'
        ? input.basicMonthly
        : Math.min(input.basicMonthly, basicCeiling);

      const empRate = Number(params.employeeRatePercent || 12) / 100;
      pfEmployeeDeduction = Math.round(pfWageBase * empRate);

      const epsCap = Number(params.employerEpsMaxCapMonthly || 1250);
      const epsBase = Math.min(input.basicMonthly, basicCeiling);
      const rawEps = Math.round(epsBase * (Number(params.employerEpsRatePercent || 8.33) / 100));
      pfEmployerEpsContribution = Math.min(rawEps, epsCap);

      const totalEmployerEpfAndEps = Math.round(pfWageBase * empRate);
      pfEmployerContribution = Math.max(0, totalEmployerEpfAndEps - pfEmployerEpsContribution);

      const edliRate = Number(params.edliRatePercent || 0.5) / 100;
      pfEmployerEdliContribution = Math.round(Math.min(input.basicMonthly, basicCeiling) * edliRate);
    }
  }

  // 2. Resolve ESI Rule
  const esiRule = await resolveEffectiveRuleVersion('IN_ESI', 'IN-NATIONAL', paymentDate);
  let esiEligible = false;
  let esiEmployeeDeduction = 0;
  let esiEmployerContribution = 0;
  let esiWageBase = 0;

  if (esiRule) {
    const params = esiRule.parameters;
    const esiOverride = activeOverrides.find((o) => o.statutoryModule === 'esi');

    if (esiOverride) {
      esiEligible = esiOverride.overrideType === 'force_eligible';
      overridesApplied.push(`ESI: ${esiOverride.overrideType} (${esiOverride.reason})`);
    } else {
      // System Derived Eligibility & ESIC Contribution Period Continuity Rule
      const esiCeiling = Number(params.wageCeilingMonthly || 21000);
      const isStartMonthOfContributionPeriod = input.payrollPeriod.month === 4 || input.payrollPeriod.month === 10;

      let wasCoveredAtStart = !!input.esiCoveredAtPeriodStart;

      if (!wasCoveredAtStart && !isStartMonthOfContributionPeriod && input.tenantId && input.userId) {
        try {
          const startMonth = (input.payrollPeriod.month >= 4 && input.payrollPeriod.month <= 9) ? 4 : 10;
          const startYear = (input.payrollPeriod.month < 4 && startMonth === 10) ? input.payrollPeriod.year - 1 : input.payrollPeriod.year;

          const priorRuns = await db.select().from(schema.payrollRuns).where(
            and(
              eq(schema.payrollRuns.tenantId, input.tenantId),
              eq(schema.payrollRuns.userId, input.userId),
              eq(schema.payrollRuns.year, startYear),
              eq(schema.payrollRuns.month, startMonth)
            )
          ).limit(1);

          if (priorRuns.length > 0 && priorRuns[0].statutorySnapshot) {
            const snap = priorRuns[0].statutorySnapshot as any;
            if (snap?.derivedEligibility?.esiEligible || snap?.calculations?.esiEmployeeDeduction > 0) {
              wasCoveredAtStart = true;
            }
          }
        } catch (err) {
          // Fallback if DB query unavailable
        }
      }

      if (input.monthlyGross <= esiCeiling) {
        esiEligible = true;
      } else if (!isStartMonthOfContributionPeriod && wasCoveredAtStart) {
        // ESIC Continuity Rule (Section 46 / Reg 31): Employee covered at start of contribution period
        // (Apr-Sep or Oct-Mar) remains covered until end of period even if gross wage exceeds ₹21,000.
        esiEligible = true;
        overridesApplied.push(`ESI: Contribution Period Continuity Rule Applied (Covered at period start, wage ₹${input.monthlyGross} crossed ₹21,000 ceiling in month ${input.payrollPeriod.month})`);
      } else {
        esiEligible = false;
      }
    }

    if (esiEligible) {
      esiWageBase = input.monthlyGross;
      esiEmployeeDeduction = Math.round(esiWageBase * (Number(params.employeeRatePercent || 0.75) / 100));
      esiEmployerContribution = Math.round(esiWageBase * (Number(params.employerRatePercent || 3.25) / 100));
    }
  }

  // 3. Resolve Professional Tax Rule
  const ptRule = await resolveEffectiveRuleVersion('IN_PT', stateCode, paymentDate);
  let ptApplicable = false;
  let professionalTaxDeduction = 0;

  if (!ptRule) {
    if (stateCode !== 'IN-DL') {
      validationIssues.push({
        severity: 'WARNING',
        code: 'UNSUPPORTED_PT_JURISDICTION',
        module: 'pt',
        message: `No active Professional Tax rule found for state '${stateCode}'. Professional tax skipped.`,
      });
    }
  } else {
    const ptOverride = activeOverrides.find((o) => o.statutoryModule === 'pt');
    if (ptOverride) {
      ptApplicable = ptOverride.overrideType === 'force_eligible';
      overridesApplied.push(`PT: ${ptOverride.overrideType} (${ptOverride.reason})`);
    } else {
      ptApplicable = !ptRule.parameters.isExempt;
    }

    const slabs = (ptRule.parameters.slabs || (empProfile?.gender === 'female' ? ptRule.parameters.slabsFemale : ptRule.parameters.slabsMale) || ptRule.parameters.slabsMale || ptRule.parameters.slabsFemale) as Array<{ minGross: number; maxGross: number | null; amount: number; februaryAmount?: number }>;

    if (ptApplicable && slabs) {
      const currentMonth = input.payrollPeriod.month;
      const match = slabs.find((s) => input.monthlyGross >= Number(s.minGross || 0) && (s.maxGross == null || input.monthlyGross <= Number(s.maxGross)));

      if (match) {
        professionalTaxDeduction = (currentMonth === 2 && match.februaryAmount != null)
          ? Number(match.februaryAmount)
          : Number(match.amount || 0);

        if (ptRule.parameters.isHalfYearlySlabProratedMonthly) {
          professionalTaxDeduction = Math.round(professionalTaxDeduction / 6);
        }
      }
    }
  }

  // 4. Resolve TDS Rule & Calculation
  const tdsRule = await resolveEffectiveRuleVersion('IN_TDS', 'IN-NATIONAL', paymentDate);
  const selectedRegime = empDecl?.regime || (companyPolicy.defaultTaxRegime as any) || 'new_regime';

  const tdsResult = computeTdsForEmployee({
    paymentDate,
    annualCtc: input.annualCtc || (input.monthlyGross * 12),
    monthlyGross: input.monthlyGross,
    basicMonthly: input.basicMonthly,
    regime: selectedRegime,
    isSeniorCitizen: !!empProfile?.isSeniorCitizen,
    isSuperSeniorCitizen: !!empProfile?.isSuperSeniorCitizen,
    declarations: empDecl ? {
      section80c: empDecl.section80c,
      section80d: empDecl.section80d,
      section80ccd1b: empDecl.section80ccd1b,
      hraRentPaid: empDecl.hraRentPaid,
      isMetroCity: empDecl.isMetroCity,
      homeLoanInterest24b: empDecl.homeLoanInterest24b,
      otherIncome: empDecl.otherIncome,
      previousEmployerIncome: empDecl.previousEmployerIncome,
      previousEmployerTds: empDecl.previousEmployerTds,
      proofStatus: empDecl.proofStatus,
    } : undefined,
    ruleParameters: tdsRule?.parameters,
  });

  const totalEmployeeStatutoryDeductions = pfEmployeeDeduction + esiEmployeeDeduction + professionalTaxDeduction + tdsResult.monthlyTdsDeduction;
  const totalEmployerStatutoryContributions = pfEmployerContribution + pfEmployerEpsContribution + pfEmployerEdliContribution + esiEmployerContribution;

  return {
    paymentDate,
    taxYear: lawInfo.taxYear,
    taxLawVersion: tdsResult.taxLawVersion,
    legalReference: tdsResult.legalReference,
    workLocationState: stateCode,
    epfRule,
    esiRule,
    ptRule,
    tdsRule,
    derivedEligibility: {
      epfEligible,
      esiEligible,
      ptApplicable,
      overridesApplied,
    },
    calculations: {
      basicMonthly: input.basicMonthly,
      pfWageBase,
      pfEmployeeDeduction,
      pfEmployerContribution,
      pfEmployerEpsContribution,
      pfEmployerEdliContribution,
      esiWageBase,
      esiEmployeeDeduction,
      esiEmployerContribution,
      professionalTaxDeduction,
      tdsDeduction: tdsResult.monthlyTdsDeduction,
      totalEmployeeStatutoryDeductions,
      totalEmployerStatutoryContributions,
    },
    tdsExplanation: tdsResult.explanation,
    validationIssues,
  };
}
