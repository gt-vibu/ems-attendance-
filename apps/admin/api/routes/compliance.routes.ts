import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../db';
import { seedStatutoryCatalogIfMissing } from '../services/statutoryCatalog';
import { validatePayrollCompliance } from '../services/complianceValidation';
import { resolveStatutoryRules } from '../services/complianceResolver';
import { logToAuditLedger } from '../services/audit';

export const complianceRouter = Router();

// 1. GET /api/tenant/compliance/rules — Read-only catalog of system statutory rules
complianceRouter.get('/rules', async (req: any, res: any) => {
  try {
    await seedStatutoryCatalogIfMissing();
    const catalogs = await db.select().from(schema.statutoryRuleCatalog);
    const versions = await db.select().from(schema.statutoryRuleVersions).where(eq(schema.statutoryRuleVersions.status, 'active'));

    const ruleMap = catalogs.map((cat) => ({
      ...cat,
      activeVersions: versions.filter((v) => v.ruleCode === cat.ruleCode && v.jurisdiction === cat.jurisdiction),
    }));

    return res.json({ success: true, rules: ruleMap });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to fetch statutory rules catalog.' });
  }
});

// 2. GET /api/tenant/compliance/company-policy — Fetch Layer B Company Payroll Policy
complianceRouter.get('/company-policy', async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId;
    let policy = (await db.select().from(schema.companyPayrollPolicies).where(eq(schema.companyPayrollPolicies.tenantId, tenantId)).limit(1))[0];

    if (!policy) {
      const [inserted] = await db.insert(schema.companyPayrollPolicies).values({
        tenantId,
        pfCappingStrategy: 'cap_at_statutory_ceiling',
        epsCappingStrategy: 'cap_at_statutory_ceiling',
        defaultTaxRegime: 'new_regime',
        branchStateMappings: [],
        statutoryValidationStatus: 'valid',
        effectiveFrom: '2026-04-01',
      }).returning();
      policy = inserted;
    }

    return res.json({ success: true, policy });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to fetch company payroll policy.' });
  }
});

// 3. POST /api/tenant/compliance/company-policy — Save Layer B Company Payroll Policy
complianceRouter.post('/company-policy', async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId;
    const { pfCappingStrategy, epsCappingStrategy, defaultTaxRegime, branchStateMappings, effectiveFrom } = req.body;

    const existing = (await db.select().from(schema.companyPayrollPolicies).where(eq(schema.companyPayrollPolicies.tenantId, tenantId)).limit(1))[0];

    let savedPolicy;
    if (existing) {
      const [updated] = await db.update(schema.companyPayrollPolicies).set({
        pfCappingStrategy: pfCappingStrategy ?? existing.pfCappingStrategy,
        epsCappingStrategy: epsCappingStrategy ?? existing.epsCappingStrategy,
        defaultTaxRegime: defaultTaxRegime ?? existing.defaultTaxRegime,
        branchStateMappings: branchStateMappings ?? existing.branchStateMappings,
        effectiveFrom: effectiveFrom ?? existing.effectiveFrom,
        updatedAt: new Date(),
      }).where(eq(schema.companyPayrollPolicies.id, existing.id)).returning();
      savedPolicy = updated;
    } else {
      const [inserted] = await db.insert(schema.companyPayrollPolicies).values({
        tenantId,
        pfCappingStrategy: pfCappingStrategy || 'cap_at_statutory_ceiling',
        epsCappingStrategy: epsCappingStrategy || 'cap_at_statutory_ceiling',
        defaultTaxRegime: defaultTaxRegime || 'new_regime',
        branchStateMappings: branchStateMappings || [],
        effectiveFrom: effectiveFrom || '2026-04-01',
      }).returning();
      savedPolicy = inserted;
    }

    await logToAuditLedger({
      tenantId,
      actorId: req.user.id,
      actorName: req.user.name || 'Tenant Admin',
      action: 'UPDATE_COMPANY_PAYROLL_POLICY',
      details: { policyId: savedPolicy.id, pfCappingStrategy, defaultTaxRegime },
    });

    return res.json({ success: true, policy: savedPolicy });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to save company payroll policy.' });
  }
});

// 4. GET /api/tenant/compliance/employee-profile/:userId — Fetch Employee Statutory Profile
complianceRouter.get('/employee-profile/:userId', async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId;
    const userId = Number(req.params.userId);

    const profile = (await db.select().from(schema.employeeStatutoryProfiles).where(
      and(eq(schema.employeeStatutoryProfiles.tenantId, tenantId), eq(schema.employeeStatutoryProfiles.userId, userId))
    ).limit(1))[0] || null;

    return res.json({ success: true, profile });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to fetch employee statutory profile.' });
  }
});

// 5. POST /api/tenant/compliance/employee-profile/:userId — Save Employee Statutory Profile
complianceRouter.post('/employee-profile/:userId', async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId;
    const userId = Number(req.params.userId);
    const { pan, uan, pfNumber, esiIpNumber, workLocationState, isSeniorCitizen, isSuperSeniorCitizen } = req.body;

    const existing = (await db.select().from(schema.employeeStatutoryProfiles).where(
      and(eq(schema.employeeStatutoryProfiles.tenantId, tenantId), eq(schema.employeeStatutoryProfiles.userId, userId))
    ).limit(1))[0];

    let savedProfile;
    if (existing) {
      const [updated] = await db.update(schema.employeeStatutoryProfiles).set({
        pan: pan ?? existing.pan,
        uan: uan ?? existing.uan,
        pfNumber: pfNumber ?? existing.pfNumber,
        esiIpNumber: esiIpNumber ?? existing.esiIpNumber,
        workLocationState: workLocationState ?? existing.workLocationState,
        isSeniorCitizen: isSeniorCitizen ?? existing.isSeniorCitizen,
        isSuperSeniorCitizen: isSuperSeniorCitizen ?? existing.isSuperSeniorCitizen,
        updatedAt: new Date(),
      }).where(eq(schema.employeeStatutoryProfiles.id, existing.id)).returning();
      savedProfile = updated;
    } else {
      const [inserted] = await db.insert(schema.employeeStatutoryProfiles).values({
        tenantId,
        userId,
        pan,
        uan,
        pfNumber,
        esiIpNumber,
        workLocationState: workLocationState || 'IN-KA',
        isSeniorCitizen: !!isSeniorCitizen,
        isSuperSeniorCitizen: !!isSuperSeniorCitizen,
      }).returning();
      savedProfile = inserted;
    }

    return res.json({ success: true, profile: savedProfile });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to save employee statutory profile.' });
  }
});

// 6. GET & POST /api/tenant/compliance/bank-account/:userId — Employee Bank Details
complianceRouter.get('/bank-account/:userId', async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId;
    const userId = Number(req.params.userId);

    const bankAccount = (await db.select().from(schema.employeeBankAccounts).where(
      and(eq(schema.employeeBankAccounts.tenantId, tenantId), eq(schema.employeeBankAccounts.userId, userId))
    ).limit(1))[0] || null;

    return res.json({ success: true, bankAccount });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to fetch bank account details.' });
  }
});

complianceRouter.post('/bank-account/:userId', async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId;
    const userId = Number(req.params.userId);
    const { bankName, accountNumber, ifscCode, accountType } = req.body;

    if (!bankName || !accountNumber || !ifscCode) {
      return res.status(400).json({ success: false, error: 'Bank Name, Account Number, and IFSC code are required.' });
    }

    const masked = accountNumber.length > 4 ? `XXXX-XXXX-${accountNumber.slice(-4)}` : accountNumber;
    const existing = (await db.select().from(schema.employeeBankAccounts).where(
      and(eq(schema.employeeBankAccounts.tenantId, tenantId), eq(schema.employeeBankAccounts.userId, userId))
    ).limit(1))[0];

    let savedAccount;
    if (existing) {
      const [updated] = await db.update(schema.employeeBankAccounts).set({
        bankName,
        accountNumber,
        accountNumberMasked: masked,
        ifscCode,
        accountType: accountType || 'savings',
        updatedAt: new Date(),
      }).where(eq(schema.employeeBankAccounts.id, existing.id)).returning();
      savedAccount = updated;
    } else {
      const [inserted] = await db.insert(schema.employeeBankAccounts).values({
        tenantId,
        userId,
        bankName,
        accountNumber,
        accountNumberMasked: masked,
        ifscCode,
        accountType: accountType || 'savings',
        isPrimary: true,
      }).returning();
      savedAccount = inserted;
    }

    return res.json({ success: true, bankAccount: savedAccount });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to save bank account details.' });
  }
});

// 7. GET & POST /api/tenant/compliance/tax-declarations/:userId — Tax Declarations
complianceRouter.get('/tax-declarations/:userId', async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId;
    const userId = Number(req.params.userId);
    const financialYear = (req.query.financialYear as string) || '2026-2027';

    const declaration = (await db.select().from(schema.employeeTaxDeclarations).where(
      and(
        eq(schema.employeeTaxDeclarations.tenantId, tenantId),
        eq(schema.employeeTaxDeclarations.userId, userId),
        eq(schema.employeeTaxDeclarations.financialYear, financialYear)
      )
    ).limit(1))[0] || null;

    return res.json({ success: true, declaration });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to fetch tax declaration.' });
  }
});

complianceRouter.post('/tax-declarations/:userId', async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId;
    const userId = Number(req.params.userId);
    const {
      financialYear = '2026-2027',
      regime = 'new_regime',
      section80c = 0,
      section80d = 0,
      section80ccd1b = 0,
      hraRentPaid = 0,
      isMetroCity = false,
      homeLoanInterest24b = 0,
      otherIncome = 0,
      previousEmployerIncome = 0,
      previousEmployerTds = 0,
    } = req.body;

    const existing = (await db.select().from(schema.employeeTaxDeclarations).where(
      and(
        eq(schema.employeeTaxDeclarations.tenantId, tenantId),
        eq(schema.employeeTaxDeclarations.userId, userId),
        eq(schema.employeeTaxDeclarations.financialYear, financialYear)
      )
    ).limit(1))[0];

    let savedDeclaration;
    if (existing) {
      const [updated] = await db.update(schema.employeeTaxDeclarations).set({
        regime,
        section80c: Number(section80c || 0),
        section80d: Number(section80d || 0),
        section80ccd1b: Number(section80ccd1b || 0),
        hraRentPaid: Number(hraRentPaid || 0),
        isMetroCity: !!isMetroCity,
        homeLoanInterest24b: Number(homeLoanInterest24b || 0),
        otherIncome: Number(otherIncome || 0),
        previousEmployerIncome: Number(previousEmployerIncome || 0),
        previousEmployerTds: Number(previousEmployerTds || 0),
        proofStatus: 'submitted',
        updatedAt: new Date(),
      }).where(eq(schema.employeeTaxDeclarations.id, existing.id)).returning();
      savedDeclaration = updated;
    } else {
      const [inserted] = await db.insert(schema.employeeTaxDeclarations).values({
        tenantId,
        userId,
        financialYear,
        regime,
        section80c: Number(section80c || 0),
        section80d: Number(section80d || 0),
        section80ccd1b: Number(section80ccd1b || 0),
        hraRentPaid: Number(hraRentPaid || 0),
        isMetroCity: !!isMetroCity,
        homeLoanInterest24b: Number(homeLoanInterest24b || 0),
        otherIncome: Number(otherIncome || 0),
        previousEmployerIncome: Number(previousEmployerIncome || 0),
        previousEmployerTds: Number(previousEmployerTds || 0),
        proofStatus: 'submitted',
      }).returning();
      savedDeclaration = inserted;
    }

    return res.json({ success: true, declaration: savedDeclaration });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to submit tax declaration.' });
  }
});

// 8. POST /api/tenant/compliance/tax-declarations/:id/verify — HR Proof Verification
complianceRouter.post('/tax-declarations/:id/verify', async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId;
    const declId = Number(req.params.id);
    const { status } = req.body; // 'verified' | 'rejected'

    const [updated] = await db.update(schema.employeeTaxDeclarations).set({
      proofStatus: status || 'verified',
      verifiedByUserId: req.user.id,
      verifiedAt: new Date(),
      updatedAt: new Date(),
    }).where(
      and(eq(schema.employeeTaxDeclarations.id, declId), eq(schema.employeeTaxDeclarations.tenantId, tenantId))
    ).returning();

    return res.json({ success: true, declaration: updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to verify tax declaration.' });
  }
});

// 9. POST /api/tenant/compliance/overrides — Manual Eligibility Overrides with Audit Logging
complianceRouter.post('/overrides', async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId;
    const { userId, statutoryModule, overrideType, reason, supportingDocumentRef, effectiveFrom, effectiveTo } = req.body;

    if (!userId || !statutoryModule || !overrideType || !reason || !effectiveFrom) {
      return res.status(400).json({ success: false, error: 'userId, statutoryModule, overrideType, reason, and effectiveFrom are mandatory.' });
    }

    const [inserted] = await db.insert(schema.employeeStatutoryOverrides).values({
      tenantId,
      userId: Number(userId),
      statutoryModule,
      overrideType,
      reason,
      supportingDocumentRef: supportingDocumentRef || null,
      approvedByUserId: req.user.id,
      effectiveFrom,
      effectiveTo: effectiveTo || null,
    }).returning();

    await logToAuditLedger({
      tenantId,
      actorId: req.user.id,
      actorName: req.user.name || 'Tenant Admin',
      action: 'STATUTORY_ELIGIBILITY_OVERRIDE_CREATED',
      details: { overrideId: inserted.id, userId, statutoryModule, overrideType, reason },
    });

    return res.json({ success: true, override: inserted });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to create statutory override.' });
  }
});

// 10. POST /api/tenant/compliance/validate-payroll — Pre-Payroll Audit Scanner
complianceRouter.post('/validate-payroll', async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId;
    const { year, month, employeeIds } = req.body;

    if (!year || !month) {
      return res.status(400).json({ success: false, error: 'year and month are required.' });
    }

    const report = await validatePayrollCompliance(tenantId, Number(year), Number(month), employeeIds);
    return res.json({ success: true, report });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to run pre-payroll compliance validation.' });
  }
});
