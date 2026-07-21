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

// `totalDays` (optional) is the leave request's own day count — pass it to
// get half-day-aware scaling: a single-day half-day request has
// totalDays=0.5 against a 1-day calendar span, so the overlap is scaled by
// 0.5 instead of counting as a full day. Omitting it keeps the old
// whole-calendar-day behavior (still correct for every non-half-day
// request, where totalDays already equals the full inclusive day count).
export function overlapDaysInMonth(startDate: string, endDate: string, year: number, month: number, totalDays?: number) {
  const monthStart = Date.UTC(year, month - 1, 1);
  const monthEnd = Date.UTC(year, month, 0);
  const start = parseDateOnly(startDate).getTime();
  const end = parseDateOnly(endDate).getTime();
  const overlapStart = Math.max(start, monthStart);
  const overlapEnd = Math.min(end, monthEnd);
  if (overlapEnd < overlapStart) return 0;
  const overlapCalendarDays = Math.floor((overlapEnd - overlapStart) / DAY_MS) + 1;
  if (totalDays == null) return overlapCalendarDays;
  const fullDays = diffDaysInclusive(startDate, endDate);
  const ratio = fullDays > 0 ? totalDays / fullDays : 1;
  return overlapCalendarDays * ratio;
}

// How much of one day of this leave type actually reduces pay — 0 for a
// fully paid policy (e.g. Paternity Leave), 100 for fully unpaid (e.g.
// Leave Without Pay), or anything configured in between. Falls back to
// fully chargeable (100) when there's no matching policy — a request from
// before policies existed, or one whose policy was since deleted — same
// "assume unpaid unless told otherwise" default the field itself uses.
export function policyDeductionPercent(policy: { defaultDeductionPercent?: number | null } | null | undefined): number {
  return policy ? Number(policy.defaultDeductionPercent ?? 100) : 100;
}

export interface LeaveDaysSplit {
  totalDays: number; // every approved leave day this month, any type — for display
  paidDays: number; // days from a 0%-deduction policy — free, subject to the monthly quota below
  chargeableDays: number; // days already weighted by their policy's deduction % (half-day-aware)
}

export const NO_LEAVE_DAYS: LeaveDaysSplit = { totalDays: 0, paidDays: 0, chargeableDays: 0 };

// Splits one employee's approved leave requests for one payroll month into
// "paid" (this leave type doesn't reduce pay) vs "chargeable" (weighted by
// how much of a day's pay this leave type actually costs) — the piece that
// was missing before: every leave request used to count as an identical
// day regardless of which policy it was taken under, so "Paid Leave" and
// "Leave Without Pay" deducted salary identically. Half-day requests are
// correctly scaled to 0.5 via overlapDaysInMonth's totalDays param.
export function splitLeaveDaysForPayroll(
  requests: Array<{ startDate: string; endDate: string; totalDays: number; policyId: number | null }>,
  policies: Array<{ id: number; defaultDeductionPercent: number | null }>,
  year: number,
  month: number,
): LeaveDaysSplit {
  const policyById = new Map(policies.map((p) => [p.id, p]));
  let totalDays = 0;
  let paidDays = 0;
  let chargeableDays = 0;
  for (const request of requests) {
    const daysInMonth = overlapDaysInMonth(request.startDate, request.endDate, year, month, request.totalDays);
    if (daysInMonth <= 0) continue;
    totalDays += daysInMonth;
    const deductionPercent = policyDeductionPercent(request.policyId != null ? policyById.get(request.policyId) : undefined);
    if (deductionPercent <= 0) {
      paidDays += daysInMonth;
    } else {
      chargeableDays += daysInMonth * (deductionPercent / 100);
    }
  }
  return { totalDays, paidDays, chargeableDays };
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

// Marginal (bracket-by-bracket) slab tax — the standard way income tax
// slabs are meant to be read: each bracket's rate only applies to the
// portion of income that actually falls within it, not the whole amount.
function computeSlabTax(taxableAmount: number, slabs: Array<{ upTo: number | null; ratePercent: number }>): number {
  if (!Array.isArray(slabs) || slabs.length === 0 || taxableAmount <= 0) return 0;
  let tax = 0;
  let lastUpTo = 0;
  for (const slab of slabs) {
    const upTo = slab.upTo == null ? Infinity : Number(slab.upTo);
    const bracketAmount = Math.max(0, Math.min(taxableAmount, upTo) - lastUpTo);
    tax += bracketAmount * (Number(slab.ratePercent || 0) / 100);
    lastUpTo = upTo;
    if (taxableAmount <= upTo) break;
  }
  return tax;
}

function computeProfessionalTax(monthlyGross: number, slabs: Array<{ minGross: number; maxGross: number | null; amount: number }>): number {
  if (!Array.isArray(slabs)) return 0;
  const match = slabs.find((s) => monthlyGross >= Number(s.minGross || 0) && (s.maxGross == null || monthlyGross <= Number(s.maxGross)));
  return match ? Number(match.amount || 0) : 0;
}

export interface StatutoryDeductions {
  basicMonthly: number;
  pfEmployeeDeduction: number;
  pfEmployerContribution: number;
  esiEmployeeDeduction: number;
  esiEmployerContribution: number;
  professionalTaxDeduction: number;
  tdsDeduction: number;
  totalEmployeeStatutory: number;
}

const NO_STATUTORY: StatutoryDeductions = {
  basicMonthly: 0, pfEmployeeDeduction: 0, pfEmployerContribution: 0, esiEmployeeDeduction: 0,
  esiEmployerContribution: 0, professionalTaxDeduction: 0, tdsDeduction: 0, totalEmployeeStatutory: 0,
};

// PF/ESI/Professional-Tax/TDS — every piece independently toggleable via
// `settings` (see the schema comment on payrollSettings for the "simplified
// estimate, not a statutory-filing engine" caveat, especially for TDS).
// `annualBreakdown` is buildPayrollSummary's own per-component list — reused
// here to find a named "Basic" component before falling back to a % of
// gross, so a tenant that already models Basic/HRA/etc explicitly gets PF/
// ESI computed off their real basic wage, not an approximation.
export function computeStatutoryDeductions(monthlyGross: number, annualCtc: number, annualBreakdown: any[], settings: any): StatutoryDeductions {
  if (!settings?.statutoryComplianceEnabled) return NO_STATUTORY;

  const basicComponent = annualBreakdown.find((c) => String(c.componentName || '').trim().toLowerCase() === 'basic');
  const basicMonthly = basicComponent
    ? Number(basicComponent.monthlyAmount || 0)
    : monthlyGross * (Number(settings.statutoryBasicPercentOfGross ?? 50) / 100);

  let pfEmployeeDeduction = 0, pfEmployerContribution = 0;
  if (settings.pfEnabled) {
    const pfWage = Math.min(basicMonthly, Number(settings.pfWageCeiling || 15000));
    pfEmployeeDeduction = pfWage * (Number(settings.pfEmployeeRatePercent ?? 12) / 100);
    pfEmployerContribution = pfWage * (Number(settings.pfEmployerRatePercent ?? 12) / 100);
  }

  let esiEmployeeDeduction = 0, esiEmployerContribution = 0;
  if (settings.esiEnabled && monthlyGross <= Number(settings.esiWageCeiling || 21000)) {
    esiEmployeeDeduction = monthlyGross * (Number(settings.esiEmployeeRatePercent ?? 0.75) / 100);
    esiEmployerContribution = monthlyGross * (Number(settings.esiEmployerRatePercent ?? 3.25) / 100);
  }

  const professionalTaxDeduction = settings.professionalTaxEnabled
    ? computeProfessionalTax(monthlyGross, settings.professionalTaxSlabs || [])
    : 0;

  let tdsDeduction = 0;
  if (settings.tdsEnabled) {
    const taxableAnnualIncome = Math.max(0, annualCtc - Number(settings.tdsStandardDeduction || 50000));
    const annualTax = computeSlabTax(taxableAnnualIncome, settings.incomeTaxSlabs || []);
    tdsDeduction = annualTax / 12;
  }

  return {
    basicMonthly, pfEmployeeDeduction, pfEmployerContribution, esiEmployeeDeduction, esiEmployerContribution,
    professionalTaxDeduction, tdsDeduction,
    totalEmployeeStatutory: pfEmployeeDeduction + esiEmployeeDeduction + professionalTaxDeduction + tdsDeduction,
  };
}

export function buildPayrollSummary(profile: any, components: any[], settings: any, leaveDays: LeaveDaysSplit, overtimeHours: number) {
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
  // Paid-leave days (0%-deduction policies) are free up to this monthly
  // quota; only the excess beyond it is charged, at excessLeavePenaltyPercent
  // — e.g. "your first 2 casual-leave days a month don't cost anything, a
  // 3rd this month does." Chargeable-by-policy days (Leave Without Pay,
  // etc.) are never subject to this quota — they were never "paid" leave to
  // begin with, so they're deducted in full regardless of how many paid
  // days were also taken.
  const maxPaidLeaveDays = Number(settings?.maxPaidLeaveDaysPerMonth || 0);
  const excessLeavePenaltyPercent = Number(settings?.excessLeavePenaltyPercent || 100) / 100;
  const excessPaidDays = Math.max(0, leaveDays.paidDays - maxPaidLeaveDays);
  const chargeableLeaveDays = leaveDays.chargeableDays + excessPaidDays * excessLeavePenaltyPercent;
  const dailyRate = workingDays > 0 ? monthlyBaseNet / workingDays : 0;
  const leaveDeduction = dailyRate * chargeableLeaveDays;
  const overtimeRate = Number(profile?.overtimeHourlyRate ?? settings?.overtimeHourlyRate ?? 0);
  const overtimePay = overtimeHours * overtimeRate;
  const preStatutoryNet = monthlyBaseNet - leaveDeduction + overtimePay;

  // Statutory deductions come out of pre-statutory net — they reduce actual
  // take-home pay, same as leave deductions do, so monthlyNet below is the
  // real final figure an employee receives, not a subtotal.
  const statutory = computeStatutoryDeductions(monthlyGross, annualCtc, annualBreakdown, settings);
  const monthlyNet = preStatutoryNet - statutory.totalEmployeeStatutory;

  return {
    annualCtc,
    annualEarnings,
    annualDeductions,
    annualEmployerContributions: annualEmployer,
    monthlyGross,
    monthlyDeductions,
    monthlyBaseNet,
    dailyRate,
    approvedLeaveDays: leaveDays.totalDays,
    chargeableLeaveDays,
    leaveDeduction,
    overtimeHours,
    overtimeRate,
    overtimePay,
    preStatutoryNet,
    statutory,
    monthlyNet,
    annualBreakdown,
  };
}

// Computes a human-readable list of what changed between an employee's old
// and new compensation state, for compensation_history.fieldChanges — the
// history page renders this directly rather than diffing two raw snapshots
// itself. `oldProfile`/`oldComponents` are null on an employee's very first
// save (nothing to compare against yet); every field is then reported
// against `null` so the page can still show "what it was set to."
export function computeCompensationDiff(
  oldProfile: { annualCtc: number; overtimeHourlyRate: number | null } | null,
  oldComponents: Array<{ componentName: string; componentType: string; calculationType: string; value: number }>,
  newProfile: { annualCtc: number; overtimeHourlyRate: number | null },
  newComponents: Array<{ componentName: string; componentType: string; calculationType: string; value: number }>,
) {
  const changes: Array<{ field: string; oldValue: any; newValue: any }> = [];

  if (!oldProfile || oldProfile.annualCtc !== newProfile.annualCtc) {
    changes.push({ field: 'Annual CTC', oldValue: oldProfile?.annualCtc ?? null, newValue: newProfile.annualCtc });
  }
  if (!oldProfile || (oldProfile.overtimeHourlyRate ?? null) !== (newProfile.overtimeHourlyRate ?? null)) {
    changes.push({ field: 'Overtime Hourly Rate', oldValue: oldProfile?.overtimeHourlyRate ?? null, newValue: newProfile.overtimeHourlyRate ?? null });
  }

  const oldByName = new Map((oldComponents || []).map((c) => [c.componentName, c]));
  const newByName = new Map((newComponents || []).map((c) => [c.componentName, c]));

  for (const [name, oldComp] of oldByName) {
    if (!newByName.has(name)) {
      changes.push({ field: `${name} (removed)`, oldValue: oldComp.value, newValue: null });
    }
  }
  for (const [name, newComp] of newByName) {
    const oldComp = oldByName.get(name);
    if (!oldComp) {
      changes.push({ field: `${name} (added)`, oldValue: null, newValue: newComp.value });
    } else if (oldComp.value !== newComp.value || oldComp.calculationType !== newComp.calculationType) {
      changes.push({ field: name, oldValue: oldComp.value, newValue: newComp.value });
    }
  }

  return changes;
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
// The same individual-profile-else-role-default resolution GET
// /api/payroll/mine uses, reduced to just the daily rate — used to snapshot
// a leave-encashment amount at approval time (see
// terminations/leave.routes.ts's encashment action) without duplicating
// that resolution logic a third time.
export async function getEffectiveDailyRate(tenantId: number, userId: number): Promise<number> {
  const [settings, profileRows, components, userRows] = await Promise.all([
    getOrCreatePayrollSettings(tenantId),
    db.select().from(schema.employeeCompensationProfiles).where(and(eq(schema.employeeCompensationProfiles.tenantId, tenantId), eq(schema.employeeCompensationProfiles.userId, userId), eq(schema.employeeCompensationProfiles.status, 'active'))).orderBy(schema.employeeCompensationProfiles.id).limit(1),
    db.select().from(schema.employeeSalaryComponents).where(and(eq(schema.employeeSalaryComponents.tenantId, tenantId), eq(schema.employeeSalaryComponents.userId, userId))),
    db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1),
  ]);

  let profile: any = profileRows[0] || null;
  let effectiveComponents = components;
  if (!profile) {
    const roleDefault = await getRoleCompensationDefault(tenantId, userRows[0]?.role || '');
    if (roleDefault) {
      profile = { annualCtc: roleDefault.roleDefault.annualCtc, overtimeHourlyRate: null };
      effectiveComponents = roleDefault.components;
    }
  }
  if (!profile) return 0;

  const summary = buildPayrollSummary(profile, effectiveComponents, settings, NO_LEAVE_DAYS, 0);
  return summary.dailyRate;
}

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
