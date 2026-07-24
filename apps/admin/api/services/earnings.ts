import { and, eq, desc, gte, lte } from 'drizzle-orm';
import { db, schema } from '../../db';
import { buildPayrollSummary, getOrCreatePayrollSettings, getRoleCompensationDefault, toDateOnly, diffDaysInclusive, policyDeductionPercent, NO_LEAVE_DAYS } from '../routes/leavePayrollShared';
import { resolveEffectivePolicy } from './attendancePolicy';

// Day-by-day earnings breakdown for the self-service Earnings page — the
// counterpart to /api/payroll/mine's monthly-only summary. Nothing here is a
// second source of truth for what an employee is actually paid: the monthly
// totals returned are produced by the exact same buildPayrollSummary()
// helper /api/payroll/mine uses, just fed the REAL per-day-computed
// approvedLeaveDays/overtimeHours instead of overtimeHours:0 — so the two
// endpoints' monthly numbers always reconcile.
//
// Two things this file introduces that don't exist anywhere else in the
// codebase yet, both clearly assumption-based since there's no existing
// definition to match:
// - Overtime hours: worked time beyond the tenant's configured shift length
//   on a day the employee actually checked in. Previously always hardcoded
//   to 0 (see payroll.routes.ts) — this is the first real computation of it.
// - Excess-break deduction: minutes over the tenant's dailyBreakBudgetMins
//   were previously only ever flagged as a violation/alert (see
//   bootstrap/scheduler.ts), never tied to pay. This charges them at the
//   same per-hour rate as overtime pays (`overtimeRate`), on the reasoning
//   that "an hour of your day" has one price whichever direction it moves —
//   there's no separate "penalty rate" defined anywhere to use instead.

export interface DailyEarning {
  date: string; // YYYY-MM-DD
  status: 'present' | 'pending' | 'absent' | 'leave' | 'holiday' | 'weekend' | 'future';
  checkIn: string | null;
  checkOut: string | null;
  hoursWorked: number;
  regularHours: number;
  overtimeHours: number;
  overtimePay: number;
  breakMinutes: number;
  excessBreakMinutes: number;
  excessBreakDeduction: number;
  isHalfDay: boolean;
  isShortDay: boolean;
  isLeave: boolean;
  leaveType: string | null;
  leaveChargeable: boolean;
  basePay: number; // flat per-working-day share of monthlyBaseNet, 0 on non-working/absent/unpaid-leave days
  netPay: number; // basePay + overtimePay - excessBreakDeduction (present days), or -leaveDeduction (chargeable leave), or 0
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export async function computeEmployeeEarnings(userId: number, tenantId: number, year: number, month: number) {
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const totalDays = daysInMonth(year, month);
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(totalDays).padStart(2, '0')}`;
  const rangeStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const rangeEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59));

  const [tenantRows, settings, profileRows, components, userRows, logs, breaks, leaveRequests, leavePolicies, holidays] = await Promise.all([
    db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1),
    getOrCreatePayrollSettings(tenantId),
    db.select().from(schema.employeeCompensationProfiles).where(and(eq(schema.employeeCompensationProfiles.tenantId, tenantId), eq(schema.employeeCompensationProfiles.userId, userId), eq(schema.employeeCompensationProfiles.status, 'active'))).orderBy(desc(schema.employeeCompensationProfiles.id)).limit(1),
    db.select().from(schema.employeeSalaryComponents).where(and(eq(schema.employeeSalaryComponents.tenantId, tenantId), eq(schema.employeeSalaryComponents.userId, userId))),
    db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1),
    db.select().from(schema.attendanceLogs).where(and(eq(schema.attendanceLogs.userId, userId), gte(schema.attendanceLogs.createdAt, rangeStart), lte(schema.attendanceLogs.createdAt, rangeEnd))),
    db.select().from(schema.breakSessions).where(and(eq(schema.breakSessions.userId, userId), gte(schema.breakSessions.startTime, rangeStart), lte(schema.breakSessions.startTime, rangeEnd))),
    db.select().from(schema.leaveRequests).where(and(eq(schema.leaveRequests.tenantId, tenantId), eq(schema.leaveRequests.userId, userId), eq(schema.leaveRequests.status, 'approved'))),
    db.select().from(schema.leavePolicies).where(eq(schema.leavePolicies.tenantId, tenantId)),
    db.select().from(schema.holidays).where(eq(schema.holidays.tenantId, tenantId)),
  ]);

  const tenant = tenantRows[0] || {};
  let profile: any = profileRows[0] || null;
  let effectiveComponents = components;
  if (!profile) {
    const roleName = userRows[0]?.role || '';
    const roleDefault = await getRoleCompensationDefault(tenantId, roleName);
    if (roleDefault) {
      profile = { annualCtc: roleDefault.roleDefault.annualCtc, overtimeHourlyRate: null, effectiveFrom: null, status: 'active' };
      effectiveComponents = roleDefault.components;
    }
  }

  if (!profile) {
    return { days: [], summary: null, profile: null, period: { year, month } };
  }

  // Baseline figures independent of this month's actual leave/overtime —
  // used per-day below, then fed back into a second buildPayrollSummary()
  // call at the end with the real totals for the headline monthly numbers.
  const baseline = buildPayrollSummary(profile, effectiveComponents, settings, NO_LEAVE_DAYS, 0);

  // Resolves shift -> branch -> tenant the same way office/QR check-in do
  // (see services/attendancePolicy.ts) instead of only ever consulting
  // tenant.shiftStart/shiftEnd — an employee's actual assigned shift or
  // their branch's override now determines their regular-hours/overtime
  // split here too. Uses the user's PERMANENT shift/branch (not a
  // date-specific override) since this aggregates a whole month and a
  // per-day override lookup would mean one extra query per day.
  const employeeUser = userRows[0] || null;
  const branchRow = employeeUser?.branchId
    ? (await db.select().from(schema.branches).where(eq(schema.branches.id, employeeUser.branchId)))[0] || null
    : null;
  const shiftRow = employeeUser?.shiftId
    ? (await db.select().from(schema.shifts).where(eq(schema.shifts.id, employeeUser.shiftId)))[0] || null
    : null;
  const effectivePolicy = resolveEffectivePolicy(tenant, branchRow, shiftRow);
  const shiftHours = effectivePolicy.requiredWorkingMins / 60;
  const hourlyRate = shiftHours > 0 ? baseline.dailyRate / shiftHours : 0;
  const overtimeRate = baseline.overtimeRate || hourlyRate;
  const weekendDays: string[] = Array.isArray(tenant.weekendConfig) ? tenant.weekendConfig : ['Saturday', 'Sunday'];
  const maxPaidLeaveDays = Number(settings?.maxPaidLeaveDaysPerMonth || 0);
  const excessLeavePenaltyPercent = Number(settings?.excessLeavePenaltyPercent || 100) / 100;

  const holidayByDate = new Map<string, string>(holidays.map((h: any) => [String(h.date).slice(0, 10), h.name]));

  const policyById = new Map(leavePolicies.map((p: any) => [p.id, p]));

  // Approved-leave ranges expanded to a per-date lookup, in date order —
  // needed so "which leave days are chargeable" can be assigned
  // chronologically (first `maxPaidLeaveDaysPerMonth` days of PAID-type leave
  // in the month are free, the rest chargeable at excessLeavePenaltyPercent);
  // unpaid/partial-type leave is always chargeable at its own policy rate
  // regardless of the quota. dayFraction handles single-day half-day leave
  // (req.totalDays === 0.5 across a 1-calendar-day range).
  const leaveByDate = new Map<string, { leaveType: string; policyId: number | null; dayFraction: number }>();
  for (const req of leaveRequests) {
    const start = new Date(`${req.startDate}T00:00:00Z`);
    const end = new Date(`${req.endDate}T00:00:00Z`);
    const fullDays = diffDaysInclusive(req.startDate, req.endDate);
    const dayFraction = fullDays > 0 ? Number(req.totalDays) / fullDays : 1;
    for (let d = new Date(start); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
      const key = toDateOnly(d);
      if (key >= monthStart && key <= monthEnd) leaveByDate.set(key, { leaveType: req.leaveType, policyId: req.policyId ?? null, dayFraction });
    }
  }

  // Attendance logs grouped by calendar date (createdAt's date, matching how
  // /api/attendance/today and the checkout flow already key "today").
  const logsByDate = new Map<string, any[]>();
  for (const log of logs) {
    const key = toDateOnly(new Date(log.createdAt));
    if (!logsByDate.has(key)) logsByDate.set(key, []);
    logsByDate.get(key)!.push(log);
  }

  // Completed break minutes grouped by the calendar date the break started.
  const breakMinutesByDate = new Map<string, number>();
  for (const b of breaks) {
    if (b.status !== 'completed' || !b.endTime) continue;
    const key = toDateOnly(new Date(b.startTime));
    const mins = (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / 60000;
    breakMinutesByDate.set(key, (breakMinutesByDate.get(key) || 0) + Math.max(0, mins));
  }

  const todayKey = toDateOnly(new Date());
  const days: DailyEarning[] = [];
  let paidLeaveDaysSoFar = 0;
  let totalOvertimeHours = 0;
  let totalOvertimePay = 0;
  let totalExcessBreakMinutes = 0;
  let totalExcessBreakDeduction = 0;
  let totalApprovedLeaveDays = 0;
  let totalPaidLeaveDays = 0;
  let totalChargeableLeaveDays = 0;
  let totalHoursWorked = 0;
  let presentDays = 0;
  let absentDays = 0;

  for (let day = 1; day <= totalDays; day++) {
    const date = new Date(Date.UTC(year, month - 1, day));
    const dateKey = toDateOnly(date);
    const weekdayName = date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

    if (dateKey > todayKey) {
      days.push({ date: dateKey, status: 'future', checkIn: null, checkOut: null, hoursWorked: 0, regularHours: 0, overtimeHours: 0, overtimePay: 0, breakMinutes: 0, excessBreakMinutes: 0, excessBreakDeduction: 0, isHalfDay: false, isShortDay: false, isLeave: false, leaveType: null, leaveChargeable: false, basePay: 0, netPay: 0 });
      continue;
    }

    const leaveInfo = leaveByDate.get(dateKey) || null;
    const holidayName = holidayByDate.get(dateKey) || null;
    const isWeekend = weekendDays.includes(weekdayName);

    if (leaveInfo) {
      const { leaveType, policyId, dayFraction } = leaveInfo;
      const policy = policyId != null ? policyById.get(policyId) : undefined;
      const deductionPercent = policyDeductionPercent(policy as any);
      const isPaidType = deductionPercent <= 0;

      totalApprovedLeaveDays += dayFraction;

      let chargeable: boolean;
      let dayDeduction: number;
      if (isPaidType) {
        // Fully-paid leave type: free up to the tenant's monthly quota,
        // only the excess beyond quota is penalized.
        const beforeQuota = paidLeaveDaysSoFar;
        paidLeaveDaysSoFar += dayFraction;
        const excessFraction = Math.max(0, Math.min(dayFraction, paidLeaveDaysSoFar - maxPaidLeaveDays) - Math.max(0, beforeQuota - maxPaidLeaveDays));
        chargeable = excessFraction > 0;
        dayDeduction = baseline.dailyRate * excessFraction * excessLeavePenaltyPercent;
        totalPaidLeaveDays += dayFraction;
        totalChargeableLeaveDays += excessFraction * excessLeavePenaltyPercent;
      } else {
        // Unpaid/partial-type leave is always chargeable at its own
        // configured rate, regardless of the monthly paid-leave quota.
        const chargeableFraction = dayFraction * (deductionPercent / 100);
        chargeable = chargeableFraction > 0;
        dayDeduction = baseline.dailyRate * chargeableFraction;
        totalChargeableLeaveDays += chargeableFraction;
      }

      days.push({
        date: dateKey, status: 'leave', checkIn: null, checkOut: null, hoursWorked: 0, regularHours: 0, overtimeHours: 0, overtimePay: 0,
        breakMinutes: 0, excessBreakMinutes: 0, excessBreakDeduction: 0, isHalfDay: false, isShortDay: false, isLeave: true, leaveType, leaveChargeable: chargeable,
        basePay: chargeable ? 0 : baseline.dailyRate,
        netPay: chargeable ? -dayDeduction : baseline.dailyRate,
      });
      continue;
    }

    // Holiday/weekend are only the day's status when nothing else happened —
    // resolved AFTER checking for a real check-in, not before. An employee
    // who actually worked a weekend or holiday (overtime shift, on-call,
    // etc.) has real attendance data that must not be silently discarded
    // just because the calendar day is normally non-working.
    const dayLogs = (logsByDate.get(dateKey) || []).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const checkIn = dayLogs.find((l) => l.type === 'check_in' && l.status !== 'rejected');
    const checkOut = [...dayLogs].reverse().find((l) => l.type === 'check_out');

    if (!checkIn) {
      if (holidayName) {
        days.push({ date: dateKey, status: 'holiday', checkIn: null, checkOut: null, hoursWorked: 0, regularHours: 0, overtimeHours: 0, overtimePay: 0, breakMinutes: 0, excessBreakMinutes: 0, excessBreakDeduction: 0, isHalfDay: false, isShortDay: false, isLeave: false, leaveType: null, leaveChargeable: false, basePay: baseline.dailyRate, netPay: baseline.dailyRate });
        continue;
      }
      if (isWeekend) {
        days.push({ date: dateKey, status: 'weekend', checkIn: null, checkOut: null, hoursWorked: 0, regularHours: 0, overtimeHours: 0, overtimePay: 0, breakMinutes: 0, excessBreakMinutes: 0, excessBreakDeduction: 0, isHalfDay: false, isShortDay: false, isLeave: false, leaveType: null, leaveChargeable: false, basePay: 0, netPay: 0 });
        continue;
      }
      absentDays += 1;
      days.push({ date: dateKey, status: 'absent', checkIn: null, checkOut: null, hoursWorked: 0, regularHours: 0, overtimeHours: 0, overtimePay: 0, breakMinutes: 0, excessBreakMinutes: 0, excessBreakDeduction: 0, isHalfDay: false, isShortDay: false, isLeave: false, leaveType: null, leaveChargeable: false, basePay: 0, netPay: 0 });
      continue;
    }

    // Worked despite it being a weekend/holiday: every hour counts as
    // overtime (there was no "regular shift" expected that day), and — for
    // a holiday specifically — still receives the normal paid-holiday
    // baseline on top, so working it is never worth less than not working it.
    const workedNonScheduledDay = isWeekend || !!holidayName;

    const checkInTime = new Date(checkIn.createdAt);
    const checkOutTime = checkOut ? new Date(checkOut.createdAt) : (dateKey === todayKey ? new Date() : null);
    const breakMins = breakMinutesByDate.get(dateKey) || 0;
    const grossMins = checkOutTime ? (checkOutTime.getTime() - checkInTime.getTime()) / 60000 : 0;
    const hoursWorked = Math.max(0, (grossMins - breakMins) / 60);
    const regularHours = workedNonScheduledDay ? 0 : Math.min(hoursWorked, shiftHours);
    const overtimeHours = workedNonScheduledDay ? hoursWorked : Math.max(0, hoursWorked - shiftHours);
    const overtimePay = overtimeHours * overtimeRate;
    const budget = Number(tenant.dailyBreakBudgetMins ?? 60);
    const excessBreakMinutes = Math.max(0, breakMins - budget);
    const excessBreakDeduction = (excessBreakMinutes / 60) * hourlyRate;

    const isPending = checkIn.status === 'pending';
    // A scheduled working day pays its flat dailyRate baseline just for
    // showing up (matches how buildPayrollSummary treats every working day
    // uniformly, see leavePayrollShared.ts) — a non-scheduled day worked
    // has no such baseline to begin with, EXCEPT a holiday, which keeps its
    // normal paid-holiday baseline whether or not anyone worked it, plus
    // whatever overtime they additionally earned by actually working it.
    const basePay = isPending ? 0 : (workedNonScheduledDay ? (holidayName ? baseline.dailyRate : 0) : baseline.dailyRate);
    const netPay = basePay + overtimePay - excessBreakDeduction;
    const workedMinutesForDay = hoursWorked * 60;
    const isHalfDay = !workedNonScheduledDay && workedMinutesForDay < effectivePolicy.halfDayMins;
    const isShortDay = !workedNonScheduledDay && !isHalfDay && workedMinutesForDay < effectivePolicy.requiredWorkingMins;

    totalOvertimeHours += overtimeHours;
    totalOvertimePay += overtimePay;
    totalExcessBreakMinutes += excessBreakMinutes;
    totalExcessBreakDeduction += excessBreakDeduction;
    totalHoursWorked += hoursWorked;
    if (!isPending) presentDays += 1;

    days.push({
      date: dateKey,
      status: isPending ? 'pending' : 'present',
      checkIn: checkInTime.toISOString(),
      checkOut: checkOutTime ? checkOutTime.toISOString() : null,
      hoursWorked: Math.round(hoursWorked * 100) / 100,
      regularHours: Math.round(regularHours * 100) / 100,
      overtimeHours: Math.round(overtimeHours * 100) / 100,
      overtimePay: Math.round(overtimePay * 100) / 100,
      breakMinutes: Math.round(breakMins),
      excessBreakMinutes: Math.round(excessBreakMinutes),
      excessBreakDeduction: Math.round(excessBreakDeduction * 100) / 100,
      isHalfDay,
      isShortDay,
      isLeave: false,
      leaveType: null,
      leaveChargeable: false,
      basePay: Math.round(basePay * 100) / 100,
      netPay: Math.round(netPay * 100) / 100,
    });
  }

  // Final monthly summary — same buildPayrollSummary() call /api/payroll/mine
  // makes, now fed the real computed totals so the two endpoints agree.
  const leaveDaysSplit = { totalDays: totalApprovedLeaveDays, paidDays: totalPaidLeaveDays, chargeableDays: totalChargeableLeaveDays };
  const monthlySummary = buildPayrollSummary(profile, effectiveComponents, settings, leaveDaysSplit, totalOvertimeHours);

  return {
    period: { year, month },
    profile,
    settings,
    shiftHours,
    hourlyRate: Math.round(hourlyRate * 100) / 100,
    days,
    summary: {
      ...monthlySummary,
      presentDays,
      absentDays,
      leaveDays: totalApprovedLeaveDays,
      totalHoursWorked: Math.round(totalHoursWorked * 100) / 100,
      totalOvertimeHours: Math.round(totalOvertimeHours * 100) / 100,
      totalOvertimePay: Math.round(totalOvertimePay * 100) / 100,
      totalExcessBreakMinutes: Math.round(totalExcessBreakMinutes),
      totalExcessBreakDeduction: Math.round(totalExcessBreakDeduction * 100) / 100,
    },
  };
}
