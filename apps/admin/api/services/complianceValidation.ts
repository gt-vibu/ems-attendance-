import { db, schema } from '../../db';
import { eq, and, inArray } from 'drizzle-orm';
import { resolveStatutoryRules, ValidationIssue } from './complianceResolver';

export interface PrePayrollValidationResult {
  tenantId: number;
  year: number;
  month: number;
  overallStatus: 'VALID' | 'WARNING' | 'BLOCKING_ERROR';
  totalEmployeesAudited: number;
  blockingErrorCount: number;
  warningCount: number;
  employeeIssues: Array<{
    userId: number;
    userName: string;
    issues: ValidationIssue[];
  }>;
}

export async function validatePayrollCompliance(
  tenantId: number,
  year: number,
  month: number,
  employeeIds?: number[]
): Promise<PrePayrollValidationResult> {
  const paymentDate = `${year}-${String(month).padStart(2, '0')}-01`;

  // Fetch employees
  let employeeQuery = db.select().from(schema.users).where(and(eq(schema.users.tenantId, tenantId)));
  const allEmployees = await employeeQuery;
  const targetEmployees = allEmployees.filter((u) => {
    if (u.role === 'tenant_admin' || u.role === 'super_admin' || u.employeeStatus === 'terminated') return false;
    if (employeeIds && employeeIds.length > 0 && !employeeIds.includes(u.id)) return false;
    return true;
  });

  const employeeIssues: Array<{ userId: number; userName: string; issues: ValidationIssue[] }> = [];
  let blockingErrorCount = 0;
  let warningCount = 0;

  for (const emp of targetEmployees) {
    const issues: ValidationIssue[] = [];

    // Fetch compensation profile to estimate gross/basic
    const profileRows = await db.select().from(schema.employeeCompensationProfiles).where(and(eq(schema.employeeCompensationProfiles.tenantId, tenantId), eq(schema.employeeCompensationProfiles.userId, emp.id), eq(schema.employeeCompensationProfiles.status, 'active'))).limit(1);
    const profile = profileRows[0];

    const monthlyGross = profile ? profile.annualCtc / 12 : 0;
    const basicMonthly = monthlyGross * 0.5;

    // Check bank account
    const bankAccount = (await db.select().from(schema.employeeBankAccounts).where(and(eq(schema.employeeBankAccounts.tenantId, tenantId), eq(schema.employeeBankAccounts.userId, emp.id))).limit(1))[0];
    if (!bankAccount) {
      issues.push({
        severity: 'WARNING',
        code: 'MISSING_BANK_ACCOUNT',
        module: 'bank',
        message: `Employee ${emp.name} (#${emp.id}) is missing bank account details.`,
      });
      warningCount++;
    }

    // Run resolver compliance audit
    const resolution = await resolveStatutoryRules({
      tenantId,
      userId: emp.id,
      payrollPeriod: { year, month },
      paymentDate,
      monthlyGross,
      basicMonthly,
    });

    for (const issue of resolution.validationIssues) {
      issues.push(issue);
      if (issue.severity === 'BLOCKING_ERROR') blockingErrorCount++;
      if (issue.severity === 'WARNING') warningCount++;
    }

    if (issues.length > 0) {
      employeeIssues.push({
        userId: emp.id,
        userName: emp.name,
        issues,
      });
    }
  }

  const overallStatus = blockingErrorCount > 0 ? 'BLOCKING_ERROR' : warningCount > 0 ? 'WARNING' : 'VALID';

  return {
    tenantId,
    year,
    month,
    overallStatus,
    totalEmployeesAudited: targetEmployees.length,
    blockingErrorCount,
    warningCount,
    employeeIssues,
  };
}
