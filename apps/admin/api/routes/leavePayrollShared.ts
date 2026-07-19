import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../db';

export const DAY_MS = 24 * 60 * 60 * 1000;

export function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

export function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function diffDaysInclusive(startDate: string, endDate: string) {
  const start = parseDateOnly(startDate).getTime();
  const end = parseDateOnly(endDate).getTime();
  return Math.floor((end - start) / DAY_MS) + 1;
}

export function computeLeaveDays(startDate: string, endDate: string, halfDay: boolean) {
  const days = diffDaysInclusive(startDate, endDate);
  if (days <= 0) return 0;
  return halfDay && days === 1 ? 0.5 : days;
}

export function overlapDaysInMonth(startDate: string, endDate: string, year: number, month: number) {
  const monthStart = Date.UTC(year, month - 1, 1);
  const monthEnd = Date.UTC(year, month, 0);
  const start = parseDateOnly(startDate).getTime();
  const end = parseDateOnly(endDate).getTime();
  const overlapStart = Math.max(start, monthStart);
  const overlapEnd = Math.min(end, monthEnd);
  if (overlapEnd < overlapStart) return 0;
  return Math.floor((overlapEnd - overlapStart) / DAY_MS) + 1;
}

export function uniqueById<T extends { id: number }>(rows: T[]) {
  const seen = new Set<number>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

export function componentAnnualAmount(annualCtc: number, component: any) {
  if (component.calculationType === 'fixed_annual') return Number(component.value || 0);
  return annualCtc * (Number(component.value || 0) / 100);
}

export function buildPayrollSummary(profile: any, components: any[], settings: any, approvedLeaveDays: number, overtimeHours: number) {
  const annualCtc = Number(profile?.annualCtc || 0);
  const annualBreakdown = components.map((component) => {
    const annualAmount = componentAnnualAmount(annualCtc, component);
    return {
      ...component,
      annualAmount,
      monthlyAmount: annualAmount / 12,
    };
  });
  const annualEarnings = annualBreakdown.filter((c) => c.componentType === 'earning').reduce((sum, c) => sum + c.annualAmount, 0);
  const annualDeductions = annualBreakdown.filter((c) => c.componentType === 'deduction').reduce((sum, c) => sum + c.annualAmount, 0);
  const annualEmployer = annualBreakdown.filter((c) => c.componentType === 'employer_contribution').reduce((sum, c) => sum + c.annualAmount, 0);
  const monthlyGross = annualEarnings / 12;
  const monthlyDeductions = annualDeductions / 12;
  const monthlyBaseNet = monthlyGross - monthlyDeductions;
  const workingDays = Number(settings?.workingDaysPerMonth || 26);
  const maxPaidLeaveDays = Number(settings?.maxPaidLeaveDaysPerMonth || 0);
  const excessLeavePenaltyPercent = Number(settings?.excessLeavePenaltyPercent || 100) / 100;
  const chargeableLeaveDays = Math.max(0, approvedLeaveDays - maxPaidLeaveDays);
  const dailyRate = workingDays > 0 ? monthlyBaseNet / workingDays : 0;
  const leaveDeduction = dailyRate * chargeableLeaveDays * excessLeavePenaltyPercent;
  const overtimeRate = Number(profile?.overtimeHourlyRate ?? settings?.overtimeHourlyRate ?? 0);
  const overtimePay = overtimeHours * overtimeRate;
  const monthlyNet = monthlyBaseNet - leaveDeduction + overtimePay;

  return {
    annualCtc,
    annualEarnings,
    annualDeductions,
    annualEmployerContributions: annualEmployer,
    monthlyGross,
    monthlyDeductions,
    monthlyBaseNet,
    dailyRate,
    approvedLeaveDays,
    chargeableLeaveDays,
    leaveDeduction,
    overtimeHours,
    overtimeRate,
    overtimePay,
    monthlyNet,
    annualBreakdown,
  };
}

export async function getOrCreatePayrollSettings(tenantId: number) {
  const existing = await db.select().from(schema.payrollSettings).where(eq(schema.payrollSettings.tenantId, tenantId)).limit(1);
  if (existing.length > 0) return existing[0];
  const [inserted] = await db.insert(schema.payrollSettings).values({ tenantId }).returning();
  return inserted;
}

// Role-level default compensation template (roleCompensationDefaults +
// roleCompensationComponents) for a single role name, or null if the tenant
// hasn't configured one for that role yet. Components come back shaped
// exactly like employeeSalaryComponents rows, so buildPayrollSummary() works
// unmodified against either source.
export async function getRoleCompensationDefault(tenantId: number, roleName: string) {
  if (!roleName) return null;
  const rows = await db.select().from(schema.roleCompensationDefaults).where(
    and(eq(schema.roleCompensationDefaults.tenantId, tenantId), eq(schema.roleCompensationDefaults.roleName, roleName))
  ).limit(1);
  if (rows.length === 0) return null;
  const roleDefault = rows[0];
  const components = await db.select().from(schema.roleCompensationComponents)
    .where(eq(schema.roleCompensationComponents.roleDefaultId, roleDefault.id))
    .orderBy(schema.roleCompensationComponents.sortOrder);
  return { roleDefault, components };
}
