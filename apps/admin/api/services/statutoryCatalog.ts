import { db, schema } from '../../db';
import { eq, and } from 'drizzle-orm';

export interface RuleParameterSeed {
  ruleCode: string;
  name: string;
  category: 'epf' | 'esi' | 'pt' | 'tds';
  jurisdiction: string;
  version: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  parameters: Record<string, any>;
  eligibilityRules: Record<string, any>;
  calculationFormula: string;
  legalReference: string;
  authority: string;
  notificationNumber?: string;
  sourceUrl?: string;
}

export const SEEDED_STATUTORY_RULES: RuleParameterSeed[] = [
  // --- EPF / Provident Fund ---
  {
    ruleCode: 'IN_EPF',
    name: 'Employees Provident Fund & Miscellaneous Provisions Act, 1952',
    category: 'epf',
    jurisdiction: 'IN-NATIONAL',
    version: 1,
    effectiveFrom: '2020-04-01',
    effectiveTo: null,
    parameters: {
      employeeRatePercent: 12,
      employerEpfRatePercent: 3.67,
      employerEpsRatePercent: 8.33,
      employerEpsMaxCapMonthly: 1250,
      edliRatePercent: 0.5,
      adminFeeRatePercent: 0.5,
      basicWageCeilingMonthly: 15000,
      allowVoluntaryHigherPf: true,
    },
    eligibilityRules: {
      mandatoryWageCeiling: 15000,
      includedEmploymentTypes: ['full_time', 'part_time', 'contract'],
    },
    calculationFormula: 'Basic <= 15000 ? Basic * 12% : (Capped ? 15000 * 12% : Basic * 12%)',
    legalReference: 'EPF & MP Act 1952 Section 6 / CBT Notifications',
    authority: 'Employees Provident Fund Organisation (EPFO)',
    sourceUrl: 'https://www.epfindia.gov.in',
  },

  // --- ESI / Employee State Insurance ---
  {
    ruleCode: 'IN_ESI',
    name: 'Employees State Insurance Act, 1948',
    category: 'esi',
    jurisdiction: 'IN-NATIONAL',
    version: 1,
    effectiveFrom: '2019-07-01',
    effectiveTo: null,
    parameters: {
      employeeRatePercent: 0.75,
      employerRatePercent: 3.25,
      wageCeilingMonthly: 21000,
      disabilityWageCeilingMonthly: 25000,
    },
    eligibilityRules: {
      grossWageCeiling: 21000,
      contributionPeriodMonths: 6, // Apr-Sep, Oct-Mar
    },
    calculationFormula: 'Gross <= 21000 ? Gross * 0.75% (Employee) & Gross * 3.25% (Employer) : 0',
    legalReference: 'ESI Act 1948 / Rule 50 & Gazette Notification S.O. 2300(E)',
    authority: 'Employees State Insurance Corporation (ESIC)',
    sourceUrl: 'https://esic.gov.in',
  },

  // --- Professional Tax — Karnataka (IN-KA) ---
  {
    ruleCode: 'IN_PT',
    name: 'Karnataka Tax on Professions, Trades, Callings and Employments Act, 1976',
    category: 'pt',
    jurisdiction: 'IN-KA',
    version: 1,
    effectiveFrom: '2023-04-01',
    effectiveTo: null,
    parameters: {
      slabs: [
        { minGross: 0, maxGross: 24999, amount: 0 },
        { minGross: 25000, maxGross: null, amount: 200 },
      ],
    },
    eligibilityRules: {
      stateCode: 'IN-KA',
    },
    calculationFormula: 'Gross >= 25000 ? 200 : 0',
    legalReference: 'Karnataka Act No. 15 of 2023 / PT Amendment Act',
    authority: 'Government of Karnataka — Commercial Taxes Department',
  },

  // --- Professional Tax — Maharashtra (IN-MH) ---
  {
    ruleCode: 'IN_PT',
    name: 'Maharashtra State Tax on Professions, Trades, Callings and Employments Act, 1975',
    category: 'pt',
    jurisdiction: 'IN-MH',
    version: 1,
    effectiveFrom: '2023-04-01',
    effectiveTo: null,
    parameters: {
      slabsMale: [
        { minGross: 0, maxGross: 7500, amount: 0 },
        { minGross: 7501, maxGross: 10000, amount: 175 },
        { minGross: 10001, maxGross: null, amount: 200, februaryAmount: 300 },
      ],
      slabsFemale: [
        { minGross: 0, maxGross: 25000, amount: 0 },
        { minGross: 25001, maxGross: null, amount: 200, februaryAmount: 300 },
      ],
    },
    eligibilityRules: {
      stateCode: 'IN-MH',
    },
    calculationFormula: 'Slab lookup based on gross wage and gender (February has ₹300 for top slab)',
    legalReference: 'Maharashtra PT Act 1975 / Amendment 2023',
    authority: 'Government of Maharashtra — GST Department',
  },

  // --- Professional Tax — Tamil Nadu (IN-TN) ---
  {
    ruleCode: 'IN_PT',
    name: 'Tamil Nadu Town Panchayats, Municipalities and Municipal Corporations PT Rules',
    category: 'pt',
    jurisdiction: 'IN-TN',
    version: 1,
    effectiveFrom: '2022-04-01',
    effectiveTo: null,
    parameters: {
      slabs: [
        { minGross: 0, maxGross: 21000, amount: 0 },
        { minGross: 21001, maxGross: 30000, amount: 100 },
        { minGross: 30001, maxGross: 45000, amount: 235 },
        { minGross: 45001, maxGross: 60000, amount: 510 },
        { minGross: 60001, maxGross: 75000, amount: 760 },
        { minGross: 75001, maxGross: null, amount: 1095 },
      ],
      isHalfYearlySlabProratedMonthly: true,
    },
    eligibilityRules: {
      stateCode: 'IN-TN',
    },
    calculationFormula: 'Half-yearly PT slab amount divided by 6 for monthly deduction',
    legalReference: 'Tamil Nadu Municipal Laws Amendment Act 2022',
    authority: 'Government of Tamil Nadu — Commercial Taxes',
  },

  // --- Professional Tax — Telangana (IN-TG) ---
  {
    ruleCode: 'IN_PT',
    name: 'Telangana Tax on Professions, Trades, Callings and Employments Act',
    category: 'pt',
    jurisdiction: 'IN-TG',
    version: 1,
    effectiveFrom: '2020-04-01',
    effectiveTo: null,
    parameters: {
      slabs: [
        { minGross: 0, maxGross: 15000, amount: 0 },
        { minGross: 15001, maxGross: 20000, amount: 150 },
        { minGross: 20001, maxGross: null, amount: 200 },
      ],
    },
    eligibilityRules: {
      stateCode: 'IN-TG',
    },
    calculationFormula: 'Gross <= 15000 ? 0 : (Gross <= 20000 ? 150 : 200)',
    legalReference: 'Telangana PT Act / Commercial Taxes Notification',
    authority: 'Government of Telangana — Commercial Taxes Department',
  },

  // --- Professional Tax — West Bengal (IN-WB) ---
  {
    ruleCode: 'IN_PT',
    name: 'West Bengal State Tax on Professions, Trades, Callings and Employments Act, 1979',
    category: 'pt',
    jurisdiction: 'IN-WB',
    version: 1,
    effectiveFrom: '2020-04-01',
    effectiveTo: null,
    parameters: {
      slabs: [
        { minGross: 0, maxGross: 10000, amount: 0 },
        { minGross: 10001, maxGross: 15000, amount: 110 },
        { minGross: 15001, maxGross: 25000, amount: 130 },
        { minGross: 25001, maxGross: 40000, amount: 150 },
        { minGross: 40001, maxGross: null, amount: 200 },
      ],
    },
    eligibilityRules: {
      stateCode: 'IN-WB',
    },
    calculationFormula: 'Slab lookup based on monthly gross salary',
    legalReference: 'West Bengal PT Act 1979 / Directorate of Commercial Taxes',
    authority: 'Government of West Bengal — Commercial Taxes',
  },

  // --- Professional Tax — Gujarat (IN-GJ) ---
  {
    ruleCode: 'IN_PT',
    name: 'Gujarat Panchayats, Municipalities, Municipal Corporations and State Tax on Professions Act',
    category: 'pt',
    jurisdiction: 'IN-GJ',
    version: 1,
    effectiveFrom: '2022-04-01',
    effectiveTo: null,
    parameters: {
      slabs: [
        { minGross: 0, maxGross: 12000, amount: 0 },
        { minGross: 12001, maxGross: null, amount: 200 },
      ],
    },
    eligibilityRules: {
      stateCode: 'IN-GJ',
    },
    calculationFormula: 'Gross > 12000 ? 200 : 0',
    legalReference: 'Gujarat PT Amendment Notification 2022',
    authority: 'Government of Gujarat — Commercial Tax Department',
  },

  // --- Professional Tax — Delhi (IN-DL) (No PT in Delhi) ---
  {
    ruleCode: 'IN_PT',
    name: 'Delhi Professional Tax Exemption Regulation',
    category: 'pt',
    jurisdiction: 'IN-DL',
    version: 1,
    effectiveFrom: '2020-04-01',
    effectiveTo: null,
    parameters: {
      slabs: [{ minGross: 0, maxGross: null, amount: 0 }],
      isExempt: true,
    },
    eligibilityRules: {
      stateCode: 'IN-DL',
    },
    calculationFormula: '0 (Delhi does not levy Professional Tax on salary)',
    legalReference: 'Government of NCT of Delhi / Delhi Labour Regulations',
    authority: 'Government of NCT of Delhi',
  },

  // --- TDS — Tax Year 2026-27 (Income Tax Act, 2025 Section 392(1)) ---
  {
    ruleCode: 'IN_TDS',
    name: 'Income Tax Act, 2025 — Section 392(1) Salary TDS (AY 2026-27)',
    category: 'tds',
    jurisdiction: 'IN-NATIONAL',
    version: 2,
    effectiveFrom: '2026-04-01',
    effectiveTo: null,
    parameters: {
      taxLawVersion: 'ITA_2025_SECTION_392_AY2026_27',
      financialYear: '2026-2027',
      assessmentYear: '2027-2028',
      standardDeductionNewRegime: 75000,
      standardDeductionOldRegime: 50000,
      rebate87aLimitNewRegime: 1200000,
      rebate87aMaxAmountNewRegime: 60000,
      rebate87aLimitOldRegime: 500000,
      rebate87aMaxAmountOldRegime: 12500,
      cessPercent: 4,
      newRegimeSlabs: [
        { upTo: 400000, ratePercent: 0 },
        { upTo: 800000, ratePercent: 5 },
        { upTo: 1200000, ratePercent: 10 },
        { upTo: 1600000, ratePercent: 15 },
        { upTo: 2000000, ratePercent: 20 },
        { upTo: 2400000, ratePercent: 25 },
        { upTo: null, ratePercent: 30 },
      ],
      oldRegimeSlabs: [
        { upTo: 250000, ratePercent: 0 },
        { upTo: 500000, ratePercent: 5 },
        { upTo: 1000000, ratePercent: 20 },
        { upTo: null, ratePercent: 30 },
      ],
      seniorCitizenOldRegimeSlabs: [
        { upTo: 300000, ratePercent: 0 },
        { upTo: 500000, ratePercent: 5 },
        { upTo: 1000000, ratePercent: 20 },
        { upTo: null, ratePercent: 30 },
      ],
      surchargeSlabs: [
        { minNetIncome: 5000000, maxNetIncome: 10000000, surchargePercent: 10 },
        { minNetIncome: 10000000, maxNetIncome: 20000000, surchargePercent: 15 },
        { minNetIncome: 20000000, maxNetIncome: null, surchargePercent: 25 },
      ],
      section80cMaxLimit: 150000,
      section80dSelfMaxLimit: 25000,
      section80dSeniorParentsMaxLimit: 50000,
      section80ccd1bNpsLimit: 50000,
      section24bHomeLoanInterestLimit: 200000,
    },
    eligibilityRules: {
      appliesToPaymentDateFrom: '2026-04-01',
    },
    calculationFormula: 'Annualized Taxable Income -> Regime Slabs -> Section 87A Rebate -> Surcharge & Marginal Relief -> 4% Cess -> Divided by 12',
    legalReference: 'Section 392(1) of the Income Tax Act, 2025 / Salaried Individuals AY 2026-27',
    authority: 'Income Tax Department — Central Board of Direct Taxes (CBDT)',
    sourceUrl: 'https://www.incometax.gov.in',
  },

  // --- TDS — Historical FY 2025-26 (Income Tax Act, 1961) ---
  {
    ruleCode: 'IN_TDS',
    name: 'Income Tax Act, 1961 — Section 192 Salary TDS (FY 2025-26)',
    category: 'tds',
    jurisdiction: 'IN-NATIONAL',
    version: 1,
    effectiveFrom: '2025-04-01',
    effectiveTo: '2026-03-31',
    parameters: {
      taxLawVersion: 'ITA_1961_FY2025_26',
      financialYear: '2025-2026',
      assessmentYear: '2026-2027',
      standardDeductionNewRegime: 75000,
      standardDeductionOldRegime: 50000,
      rebate87aLimitNewRegime: 700000,
      rebate87aMaxAmountNewRegime: 25000,
      rebate87aLimitOldRegime: 500000,
      rebate87aMaxAmountOldRegime: 12500,
      cessPercent: 4,
      newRegimeSlabs: [
        { upTo: 300000, ratePercent: 0 },
        { upTo: 700000, ratePercent: 5 },
        { upTo: 1000000, ratePercent: 10 },
        { upTo: 1200000, ratePercent: 15 },
        { upTo: 1500000, ratePercent: 20 },
        { upTo: null, ratePercent: 30 },
      ],
      oldRegimeSlabs: [
        { upTo: 250000, ratePercent: 0 },
        { upTo: 500000, ratePercent: 5 },
        { upTo: 1000000, ratePercent: 20 },
        { upTo: null, ratePercent: 30 },
      ],
      surchargeSlabs: [
        { minNetIncome: 5000000, maxNetIncome: 10000000, surchargePercent: 10 },
        { minNetIncome: 10000000, maxNetIncome: 20000000, surchargePercent: 15 },
        { minNetIncome: 20000000, maxNetIncome: null, surchargePercent: 25 },
      ],
      section80cMaxLimit: 150000,
      section80dSelfMaxLimit: 25000,
      section80ccd1bNpsLimit: 50000,
      section24bHomeLoanInterestLimit: 200000,
    },
    eligibilityRules: {
      appliesToPaymentDateFrom: '2025-04-01',
      appliesToPaymentDateTo: '2026-03-31',
    },
    calculationFormula: 'Annualized Taxable Income -> Regime Slabs -> Section 87A Rebate -> Surcharge -> 4% Cess -> / 12',
    legalReference: 'Section 192 of the Income Tax Act, 1961 (FY 2025-26)',
    authority: 'Income Tax Department — CBDT',
    sourceUrl: 'https://www.incometax.gov.in',
  },
];

export async function seedStatutoryCatalogIfMissing() {
  for (const item of SEEDED_STATUTORY_RULES) {
    let catalog = (await db.select().from(schema.statutoryRuleCatalog).where(
      and(
        eq(schema.statutoryRuleCatalog.ruleCode, item.ruleCode),
        eq(schema.statutoryRuleCatalog.jurisdiction, item.jurisdiction)
      )
    ).limit(1))[0];

    if (!catalog) {
      const [inserted] = await db.insert(schema.statutoryRuleCatalog).values({
        ruleCode: item.ruleCode,
        name: item.name,
        category: item.category,
        jurisdiction: item.jurisdiction,
        status: 'active',
      }).returning();
      catalog = inserted;
    }

    const existingVersion = (await db.select().from(schema.statutoryRuleVersions).where(
      and(
        eq(schema.statutoryRuleVersions.ruleCode, item.ruleCode),
        eq(schema.statutoryRuleVersions.jurisdiction, item.jurisdiction),
        eq(schema.statutoryRuleVersions.version, item.version)
      )
    ).limit(1))[0];

    if (!existingVersion) {
      await db.insert(schema.statutoryRuleVersions).values({
        catalogId: catalog.id,
        ruleCode: item.ruleCode,
        jurisdiction: item.jurisdiction,
        version: item.version,
        effectiveFrom: item.effectiveFrom,
        effectiveTo: item.effectiveTo ?? null,
        parameters: item.parameters,
        eligibilityRules: item.eligibilityRules,
        calculationFormula: item.calculationFormula,
        legalReference: item.legalReference,
        authority: item.authority,
        notificationNumber: item.notificationNumber ?? null,
        sourceUrl: item.sourceUrl ?? null,
        status: 'active',
      });
    }
  }
}
