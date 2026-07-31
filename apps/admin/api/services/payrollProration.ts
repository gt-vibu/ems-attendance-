import { buildPayrollSummary, type LeaveDaysSplit, type AttendanceDrivenInputs } from '../routes/leavePayrollShared';

// Dedicated proration engine — kept OUT of buildPayrollSummary deliberately
// (per the explicit instruction: a dedicated engine, not logic embedded in
// payroll calculation). Every function here returns a traceable
// {days, amount, reason} line so a payslip can show exactly why a number
// was prorated, not just a final blended figure.

export interface ProrationLine {
  days: number;
  totalDaysInPeriod: number;
  factor: number; // days / totalDaysInPeriod
  amount: number; // signed adjustment to monthlyNet (negative = deduction for unworked days)
  reason: string;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function parseDateOnly(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

// Mid-month join or exit — charges only for the calendar days the employee
// was actually active within the period, proportional to the month's total
// days (a simple, standard, auditable "calendar-day proration" — not a
// working-days-only proration, since off-days/holidays inside an active
// employment span are still paid days).
export function prorateForJoinOrExit(monthlyNet: number, year: number, month: number, dateOfJoining?: string | null, dateOfLeaving?: string | null): ProrationLine | null {
  const totalDays = daysInMonth(year, month);
  const periodStart = new Date(year, month - 1, 1);
  const periodEnd = new Date(year, month - 1, totalDays);

  let activeStart = periodStart;
  let activeEnd = periodEnd;
  let reasonParts: string[] = [];

  if (dateOfJoining) {
    const joinDate = parseDateOnly(dateOfJoining);
    if (joinDate > periodStart && joinDate <= periodEnd) {
      activeStart = joinDate;
      reasonParts.push(`joined ${dateOfJoining}`);
    }
  }
  if (dateOfLeaving) {
    const leaveDate = parseDateOnly(dateOfLeaving);
    if (leaveDate >= periodStart && leaveDate < periodEnd) {
      activeEnd = leaveDate;
      reasonParts.push(`exited ${dateOfLeaving}`);
    }
  }

  if (activeStart <= periodStart && activeEnd >= periodEnd) return null; // fully active month, nothing to prorate

  const activeDays = Math.max(0, Math.round((activeEnd.getTime() - activeStart.getTime()) / 86400000) + 1);
  const factor = totalDays > 0 ? activeDays / totalDays : 1;
  const proratedNet = monthlyNet * factor;

  return {
    days: activeDays,
    totalDaysInPeriod: totalDays,
    factor,
    amount: proratedNet - monthlyNet, // negative
    reason: `Prorated for ${activeDays}/${totalDays} active days (${reasonParts.join(', ') || 'partial month'})`,
  };
}

export interface RevisionSegment {
  profile: any;
  components: any[];
}

// Salary revision (or promotion) effective mid-month: computes the OLD
// profile's payroll for the days before the effective date and the NEW
// profile's payroll for the days from the effective date onward, then
// blends them — not a flat "average the two CTCs" shortcut. Both segments
// share the same leave/overtime/attendance inputs for the month (leave and
// attendance don't split by salary-effective-date, only pay rate does).
export function prorateForRevision(
  before: RevisionSegment,
  after: RevisionSegment,
  settings: any,
  leaveDays: LeaveDaysSplit,
  overtimeHours: number,
  attendanceDriven: AttendanceDrivenInputs | null | undefined,
  year: number,
  month: number,
  effectiveDate: string,
): { monthlyNet: number; monthlyGross: number; breakdown: any[]; proration: ProrationLine } {
  const totalDays = daysInMonth(year, month);
  const effDate = parseDateOnly(effectiveDate);
  const periodStart = new Date(year, month - 1, 1);
  const daysBefore = Math.max(0, Math.min(totalDays, Math.round((effDate.getTime() - periodStart.getTime()) / 86400000)));
  const daysAfter = totalDays - daysBefore;

  const beforeSummary = buildPayrollSummary(before.profile, before.components, settings, leaveDays, overtimeHours, attendanceDriven);
  const afterSummary = buildPayrollSummary(after.profile, after.components, settings, leaveDays, overtimeHours, attendanceDriven);

  const factorBefore = daysBefore / totalDays;
  const factorAfter = daysAfter / totalDays;
  const monthlyNet = beforeSummary.monthlyNet * factorBefore + afterSummary.monthlyNet * factorAfter;
  const monthlyGross = beforeSummary.monthlyGross * factorBefore + afterSummary.monthlyGross * factorAfter;

  return {
    monthlyNet,
    monthlyGross,
    breakdown: [
      { segment: 'before_revision', days: daysBefore, netPay: beforeSummary.monthlyNet, components: beforeSummary.annualBreakdown },
      { segment: 'after_revision', days: daysAfter, netPay: afterSummary.monthlyNet, components: afterSummary.annualBreakdown },
    ],
    proration: {
      days: totalDays,
      totalDaysInPeriod: totalDays,
      factor: 1,
      amount: monthlyNet - afterSummary.monthlyNet,
      reason: `Salary revision effective ${effectiveDate}: ${daysBefore} day(s) at previous rate, ${daysAfter} day(s) at revised rate`,
    },
  };
}

// Leave-Without-Pay proration is already handled inside buildPayrollSummary
// via leaveDays.chargeableDays / attendanceDriven.unpaidAbsenceDays — no
// separate function needed here; documented so it isn't mistaken for a gap.
