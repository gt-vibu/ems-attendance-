import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../db';
import { computeEmployeeEarnings } from '../services/earnings';
import { computeAttendanceDrivenPayrollInputs } from '../services/attendanceDayStatus';
import { isPlatformFeatureAllowed } from '../auth/rbac';

export const DAY_MS = 24 * 60 * 60 * 1000;

// Statutory-rate fallback defaults (India) — used only when a tenant's
// payroll_settings row has the corresponding field unset. Every one of
// these is independently tenant-editable (see payroll.routes.ts's
// POST /api/tenant/payroll/settings); these are just the values assumed
// until a tenant explicitly configures their own. Pulled out to one place
// specifically so a compliance review has a single spot to audit every
// hardcoded statutory number in the payroll engine, rather than finding
// them scattered as inline `?? 12` / `|| 21000` literals throughout
// computeStatutoryDeductions() and computePayrollSummary() below.
export const STATUTORY_DEFAULTS = {
  /** % of monthly gross treated as "basic wage" when no explicit Basic salary component exists. */
  BASIC_PERCENT_OF_GROSS: 50,
  /** Provident Fund — employee & employer contribution rate, and the wage ceiling it's capped at. */
  PF_EMPLOYEE_RATE_PERCENT: 12,
  PF_EMPLOYER_RATE_PERCENT: 12,
  PF_WAGE_CEILING: 15000,
  /** Employee State Insurance — only applies at/below the wage ceiling. */
  ESI_EMPLOYEE_RATE_PERCENT: 0.75,
  ESI_EMPLOYER_RATE_PERCENT: 3.25,
  ESI_WAGE_CEILING: 21000,
  /** TDS — standard deduction subtracted from annual CTC before slab tax is applied. */
  TDS_STANDARD_DEDUCTION: 50000,
} as const;

/** Working days assumed per calendar month when a tenant hasn't set workingDaysPerMonth. */
export const DEFAULT_WORKING_DAYS_PER_MONTH = 26;

export function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

/**
 * Resolve a human federation actor only while their employee record is active.
 * Federation credentials are machine credentials; this live lookup prevents
 * a stale assertion from retaining administrative power after suspension or
 * termination.
 */
export async function resolveActiveEmployeeId(tenantId: number, userId: number): Promise<number | null> {
  const row = (await db.select({ id: schema.users.id, employeeStatus: schema.users.employeeStatus })
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), eq(schema.users.tenantId, tenantId)))
    .limit(1))[0];
  return row?.employeeStatus === 'active' ? row.id : null;
}

export function toDateOnly(value: Date) {
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, '0');
  const d = String(value.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function diffDaysInclusive(startDate: string, endDate: string) {
  const start = parseDateOnly(startDate).getTime();
  const end = parseDateOnly(endDate).getTime();
  return Math.floor((end - start) / DAY_MS) + 1;
}

export interface LeaveCalendarOptions {
  weekendDays?: string[];
  holidayDates?: Set<string>;
}

function dayNameForDateKey(dateKey: string) {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${dateKey}T12:00:00Z`).getUTCDay()];
}

function isLeaveCountedDate(dateKey: string, options?: LeaveCalendarOptions) {
  if (options?.holidayDates?.has(dateKey)) return false;
  if (options?.weekendDays?.includes(dayNameForDateKey(dateKey))) return false;
  return true;
}

export function computeLeaveDays(startDate: string, endDate: string, halfDay: boolean, options?: LeaveCalendarOptions) {
  if (!options) {
    const days = diffDaysInclusive(startDate, endDate);
    if (days <= 0) return 0;
    return halfDay && days === 1 ? 0.5 : days;
  }
  const start = parseDateOnly(startDate).getTime();
  const end = parseDateOnly(endDate).getTime();
  if (end < start) return 0;
  let days = 0;
  for (let ms = start; ms <= end; ms += DAY_MS) {
    const dateKey = toDateOnly(new Date(ms));
    if (isLeaveCountedDate(dateKey, options)) days += 1;
  }
  if (days <= 0) return 0;
  return halfDay && days === 1 ? 0.5 : days;
}

// `totalDays` (optional) is the leave request's own day count — pass it to
// get half-day-aware scaling: a single-day half-day request has
// totalDays=0.5 against a 1-day calendar span, so the overlap is scaled by
// 0.5 instead of counting as a full day. Omitting it keeps the old
// whole-calendar-day behavior (still correct for every non-half-day
// request, where totalDays already equals the full inclusive day count).
export function overlapDaysInMonth(startDate: string, endDate: string, year: number, month: number, totalDays?: number, options?: LeaveCalendarOptions) {
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
  const overlapStartKey = startDate > monthStart ? startDate : monthStart;
  const overlapEndKey = endDate < monthEnd ? endDate : monthEnd;
  if (overlapEndKey < overlapStartKey) return 0;
  if (options) {
    const overlapCountedDays = computeLeaveDays(overlapStartKey, overlapEndKey, false, options);
    if (totalDays == null) return overlapCountedDays;
    const fullCountedDays = computeLeaveDays(startDate, endDate, false, options);
    const ratio = fullCountedDays > 0 ? totalDays / fullCountedDays : 1;
    return overlapCountedDays * ratio;
  }
  const overlapStart = parseDateOnly(overlapStartKey).getTime();
  const overlapEnd = parseDateOnly(overlapEndKey).getTime();
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
  options?: LeaveCalendarOptions,
): LeaveDaysSplit {
  const policyById = new Map(policies.map((p) => [p.id, p]));
  let totalDays = 0;
  let paidDays = 0;
  let chargeableDays = 0;
  for (const request of requests) {
    const daysInMonth = overlapDaysInMonth(request.startDate, request.endDate, year, month, request.totalDays, options);
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
    : monthlyGross * (Number(settings.statutoryBasicPercentOfGross ?? STATUTORY_DEFAULTS.BASIC_PERCENT_OF_GROSS) / 100);

  let pfEmployeeDeduction = 0, pfEmployerContribution = 0;
  if (settings.pfEnabled) {
    const pfWage = Math.min(basicMonthly, Number(settings.pfWageCeiling || STATUTORY_DEFAULTS.PF_WAGE_CEILING));
    pfEmployeeDeduction = pfWage * (Number(settings.pfEmployeeRatePercent ?? STATUTORY_DEFAULTS.PF_EMPLOYEE_RATE_PERCENT) / 100);
    pfEmployerContribution = pfWage * (Number(settings.pfEmployerRatePercent ?? STATUTORY_DEFAULTS.PF_EMPLOYER_RATE_PERCENT) / 100);
  }

  let esiEmployeeDeduction = 0, esiEmployerContribution = 0;
  if (settings.esiEnabled && monthlyGross <= Number(settings.esiWageCeiling || STATUTORY_DEFAULTS.ESI_WAGE_CEILING)) {
    esiEmployeeDeduction = monthlyGross * (Number(settings.esiEmployeeRatePercent ?? STATUTORY_DEFAULTS.ESI_EMPLOYEE_RATE_PERCENT) / 100);
    esiEmployerContribution = monthlyGross * (Number(settings.esiEmployerRatePercent ?? STATUTORY_DEFAULTS.ESI_EMPLOYER_RATE_PERCENT) / 100);
  }

  const professionalTaxDeduction = settings.professionalTaxEnabled
    ? computeProfessionalTax(monthlyGross, settings.professionalTaxSlabs || [])
    : 0;

  let tdsDeduction = 0;
  if (settings.tdsEnabled) {
    const taxableAnnualIncome = Math.max(0, annualCtc - Number(settings.tdsStandardDeduction || STATUTORY_DEFAULTS.TDS_STANDARD_DEDUCTION));
    const annualTax = computeSlabTax(taxableAnnualIncome, settings.incomeTaxSlabs || []);
    tdsDeduction = annualTax / 12;
  }

  return {
    basicMonthly, pfEmployeeDeduction, pfEmployerContribution, esiEmployeeDeduction, esiEmployerContribution,
    professionalTaxDeduction, tdsDeduction,
    totalEmployeeStatutory: pfEmployeeDeduction + esiEmployeeDeduction + professionalTaxDeduction + tdsDeduction,
  };
}

// Passed only when the tenant has opted into 'payroll_attendance_driven'
// (Phase 6 of the roadmap) — replaces the flat settings.workingDaysPerMonth
// divisor with a calendar-derived count for this specific employee/period,
// and adds a Loss-of-Pay deduction sourced only from finalized (frozen,
// still-unresolved) absences. Omitted entirely, buildPayrollSummary behaves
// exactly as it always has — this is additive, not a replacement.
export interface AttendanceDrivenInputs {
  workingDays: number;
  unpaidAbsenceDays: number;
}

// Real overtime is computed day-by-day from actual worked minutes (see
// services/earnings.ts) — expensive relative to a flat 0, so it only runs
// at all once a tenant admin has explicitly opted in via
// tenant.overtimePayrollEnabled (default false). Shared by every payroll
// calculation path (lazy per-employee, and the batch calculator) so they
// can never silently diverge.
export async function resolveOvertimeHours(overtimePayrollEnabled: boolean, userId: number, tenantId: number, year: number, month: number): Promise<number> {
  if (!overtimePayrollEnabled) return 0;
  const earnings = await computeEmployeeEarnings(userId, tenantId, year, month);
  return earnings.summary?.totalOvertimeHours || 0;
}

// Attendance-driven payroll (Phase 6) — same opt-in shape as overtime
// above: every payroll number stays byte-for-byte identical to before this
// feature existed unless the tenant explicitly enabled
// 'payroll_attendance_driven'.
export async function resolveAttendanceDrivenInputs(tenant: any, userId: number, tenantId: number, year: number, month: number): Promise<AttendanceDrivenInputs | null> {
  if (!isPlatformFeatureAllowed(tenant, 'payroll_attendance_driven')) return null;
  return computeAttendanceDrivenPayrollInputs(tenantId, userId, year, month);
}

export function buildPayrollSummary(profile: any, components: any[], settings: any, leaveDays: LeaveDaysSplit, overtimeHours: number, attendanceDriven?: AttendanceDrivenInputs | null, year?: number, month?: number) {
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
  
  // Policy-driven LOP daily salary divisor resolution
  // fixed_26: fixed workingDaysPerMonth (default 26)
  // calendar_days: total days in the period month (28..31)
  // working_days: actual working days in month excluding weekends/holidays
  const policy = settings?.lopCalculationPolicy || 'fixed_26';
  let workingDays = Number(settings?.workingDaysPerMonth || DEFAULT_WORKING_DAYS_PER_MONTH);
  if (policy === 'calendar_days' && year && month) {
    workingDays = new Date(year, month, 0).getDate();
  } else if (policy === 'working_days' && attendanceDriven?.workingDays) {
    workingDays = attendanceDriven.workingDays;
  }

  const maxPaidLeaveDays = Number(settings?.maxPaidLeaveDaysPerMonth || 0);
  const excessLeavePenaltyPercent = Number(settings?.excessLeavePenaltyPercent || 100) / 100;
  const excessPaidDays = Math.max(0, leaveDays.paidDays - maxPaidLeaveDays);
  const chargeableLeaveDays = leaveDays.chargeableDays + excessPaidDays * excessLeavePenaltyPercent;
  const dailyRate = workingDays > 0 ? monthlyBaseNet / workingDays : 0;
  const leaveDeduction = dailyRate * chargeableLeaveDays;
  // Loss of Pay — only ever sourced from finalized (frozen) absences, never
  // a raw unresolved one; see computeAttendanceDrivenPayrollInputs. Zero
  // when attendanceDriven wasn't passed (the default, unchanged behavior).
  const unpaidAbsenceDays = attendanceDriven?.unpaidAbsenceDays ?? 0;
  const lopDeduction = dailyRate * unpaidAbsenceDays;
  const overtimeRate = Number(profile?.overtimeHourlyRate ?? settings?.overtimeHourlyRate ?? 0);
  const overtimePay = overtimeHours * overtimeRate;
  const earnedGross = Math.max(0, Math.round((monthlyGross - leaveDeduction - lopDeduction) * 100) / 100);
  // Floored at 0, same as earnedGross above — a month with heavy LOP/leave
  // deduction should never produce a negative pre-statutory figure that
  // then feeds a negative statutory base downstream.
  const preStatutoryNet = Math.max(0, Math.round((monthlyBaseNet - leaveDeduction - lopDeduction + overtimePay) * 100) / 100);

  // Statutory deductions come out of pre-statutory net — they reduce actual
  // take-home pay, same as leave deductions do, so monthlyNet below is the
  // real final figure an employee receives, not a subtotal. Floored at 0:
  // an employee should never be issued a payslip showing they owe the
  // company money — a shortfall like that is a recovery/loan matter to
  // handle explicitly, not something the payslip figure itself goes negative for.
  const statutory = computeStatutoryDeductions(monthlyGross, annualCtc, annualBreakdown, settings);
  const monthlyNet = Math.max(0, Math.round((preStatutoryNet - statutory.totalEmployeeStatutory) * 100) / 100);

  return {
    annualCtc,
    annualEarnings,
    annualDeductions,
    annualEmployerContributions: annualEmployer,
    monthlyGross,
    earnedGross,
    monthlyDeductions,
    monthlyBaseNet,
    workingDays,
    dailyRate,
    approvedLeaveDays: leaveDays.totalDays,
    chargeableLeaveDays,
    leaveDeduction,
    unpaidAbsenceDays,
    lopDeduction,
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

export interface FinalSettlementInputs {
  dailyRate: number;
  lastWorkingDate: string; // YYYY-MM-DD
  encashableLeaveDays: number;
  pendingBonusAmount: number;
  loanAdvanceRecoveryAmount: number;
  noticePeriodRecoveryAmount: number;
}

// Pure calculation, split out of the settlement-generation route handler
// (previously ~40 lines of math inline in payrollExtras.routes.ts) so it
// can be unit tested and read independently of the HTTP/persistence
// concerns around it. All inputs are pre-fetched by the caller — this
// function does no DB access itself.
export function computeFinalSettlement(inputs: FinalSettlementInputs) {
  const { dailyRate, lastWorkingDate, encashableLeaveDays, pendingBonusAmount, loanAdvanceRecoveryAmount, noticePeriodRecoveryAmount } = inputs;
  const [, , d] = lastWorkingDate.split('-').map(Number);
  const daysWorkedInExitMonth = d;
  const remainingSalaryAmount = dailyRate * daysWorkedInExitMonth;
  const leaveEncashmentAmount = dailyRate * encashableLeaveDays;
  const noticeRecovery = Number(noticePeriodRecoveryAmount) || 0;
  const grossSettlement = remainingSalaryAmount + leaveEncashmentAmount + pendingBonusAmount;
  const netSettlement = grossSettlement - noticeRecovery - loanAdvanceRecoveryAmount;

  return {
    daysWorkedInExitMonth,
    remainingSalaryAmount,
    leaveEncashmentAmount,
    noticeRecovery,
    grossSettlement,
    netSettlement,
    breakdown: [
      { type: 'remaining_salary', amount: remainingSalaryAmount, days: daysWorkedInExitMonth },
      { type: 'leave_encashment', amount: leaveEncashmentAmount, days: encashableLeaveDays },
      { type: 'pending_bonus', amount: pendingBonusAmount },
      { type: 'notice_period_recovery', amount: -noticeRecovery },
      { type: 'loan_advance_recovery', amount: -loanAdvanceRecoveryAmount },
    ],
  };
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
