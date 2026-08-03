import { eq, and, gte, lte, lt } from 'drizzle-orm';
import { db, schema } from '../../db';
import { getHolidaysForEmployee } from './holidayScope';
import { tenantDateKey, tenantParts } from './tenantTime';
import { getEffectiveShift } from './shiftOverrides';
import { resolveEffectivePolicy } from './attendancePolicy';

// The canonical answer to "what was this user's status on this date" —
// every consumer (calendar UI, payroll, freeze sweep, notifications) should
// call this instead of re-deriving status with its own slightly-different
// logic, which is exactly the bug class fixed earlier this session
// (EmployeeDetailPanel.tsx vs AttendanceTimeline.tsx disagreeing on "was
// this day present or absent"). See the roadmap plan, Phase 0b, for the
// full design rationale — this is a single typed function, deliberately
// NOT a rules engine.
export type DayStatus =
  | 'not_applicable'        // employee inactive/terminated — not counted at all
  | 'pending_checkout_verification'
  | 'business_travel'
  | 'regularized'           // an approved attendance correction produced this day's record
  | 'late'
  | 'half_day'
  | 'present'
  | 'holiday'
  | 'paid_leave'
  | 'unpaid_leave'
  | 'future'
  | 'weekend'
  | 'not_yet_evaluated'     // TODAY, active employee, no check-in yet, but shift end + grace period hasn't passed — NOT an absence yet
  | 'absent_pending_review' // past date (or today past shift end+grace), active employee, nothing else matched, month not frozen
  | 'lop';                  // same as above, but the month IS frozen (attendance_freeze_periods) — Loss of Pay, the only place payroll (Phase 6) should ever source an unpaid-absence day from

export interface DayStatusEntry {
  status: DayStatus;
  attendanceLogId?: number;
  correctionId?: number;
  leaveRequestId?: number;
  holidayName?: string;
}

interface MonthInputs {
  tenantId: number;
  userId: number;
  employeeStatus: string | null;
  dateOfJoining: string | null;
  dateOfExit: string | null;
  weekendConfig: string[];
  todayKey: string;
  logsByDate: Map<string, any>; // keyed by local date, one representative check_in row per day
  correctionsByDate: Map<string, any>; // approved corrections, keyed by requestedDate
  leaveRangesByPolicy: Array<{ start: string; end: string; halfDay: boolean; deductionPercent: number; leaveRequestId: number }>;
  holidayByDate: Map<string, string>;
  isFrozen: boolean;
  // Only meaningful for dateKey === todayKey — whether shift end + grace
  // period has passed yet in the TENANT's timezone, per the roadmap's
  // "don't mark absent while the workday is still in progress" rule.
  todayCutoffReached: boolean;
}

function dayOfWeekName(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(y, m - 1, d).getDay()];
}

async function loadMonthInputs(tenantId: number, userId: number, year: number, month: number): Promise<MonthInputs> {
  // Widened by a day on each side of the calendar month boundary so a log
  // near midnight never gets excluded just because the server's local
  // components (used only for this SQL range bound, not for bucketing —
  // see logsByDate below) don't exactly line up with the tenant's.
  const monthStart = new Date(year, month - 1, 1);
  monthStart.setDate(monthStart.getDate() - 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
  monthEnd.setDate(monthEnd.getDate() + 1);

  const [userRows, tenantRows, logs, corrections, leaveRequests, leavePolicies, holidays, freezeRows] = await Promise.all([
    db.select({ employeeStatus: schema.users.employeeStatus, branchId: schema.users.branchId, dateOfJoining: schema.users.dateOfJoining, dateOfExit: schema.users.dateOfExit }).from(schema.users).where(eq(schema.users.id, userId)).limit(1),
    db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1),
    db.select().from(schema.attendanceLogs).where(and(
      eq(schema.attendanceLogs.userId, userId),
      eq(schema.attendanceLogs.tenantId, tenantId),
      eq(schema.attendanceLogs.type, 'check_in'),
      gte(schema.attendanceLogs.createdAt, monthStart),
      lt(schema.attendanceLogs.createdAt, monthEnd),
    )),
    db.select().from(schema.attendanceCorrections).where(and(
      eq(schema.attendanceCorrections.userId, userId),
      eq(schema.attendanceCorrections.tenantId, tenantId),
      eq(schema.attendanceCorrections.status, 'approved'),
    )),
    db.select().from(schema.leaveRequests).where(and(
      eq(schema.leaveRequests.userId, userId),
      eq(schema.leaveRequests.tenantId, tenantId),
      eq(schema.leaveRequests.status, 'approved'),
    )),
    db.select().from(schema.leavePolicies).where(eq(schema.leavePolicies.tenantId, tenantId)),
    getHolidaysForEmployee(tenantId, userId),
    db.select().from(schema.attendanceFreezePeriods).where(and(
      eq(schema.attendanceFreezePeriods.tenantId, tenantId),
      eq(schema.attendanceFreezePeriods.year, year),
      eq(schema.attendanceFreezePeriods.month, month),
    )).limit(1),
  ]);

  const tenant = tenantRows[0] || null;

  const logsByDate = new Map<string, any>();
  for (const log of logs) {
    if (!log.createdAt) continue;
    // Tenant-timezone-aware bucketing — the same fix as todayKey below,
    // applied consistently to every date-keyed lookup this resolver builds.
    const key = tenantDateKey(tenant, new Date(log.createdAt));
    const existing = logsByDate.get(key);
    // Prefer approved over pending/rejected if more than one check_in landed on the same local day.
    if (!existing || (existing.status !== 'approved' && log.status === 'approved')) {
      logsByDate.set(key, log);
    }
  }

  const correctionsByDate = new Map<string, any>();
  for (const c of corrections) correctionsByDate.set(c.requestedDate, c);

  const policyByCode = new Map<string, any>(leavePolicies.map((p: any) => [p.code, p]));
  const policyByName = new Map<string, any>(leavePolicies.map((p: any) => [p.name, p]));
  const leaveRangesByPolicy = leaveRequests.map((r: any) => {
    const policy = policyByCode.get(r.leaveType) || policyByName.get(r.leaveType) || null;
    return {
      start: r.startDate,
      end: r.endDate,
      halfDay: Number(r.totalDays) === 0.5 && r.startDate === r.endDate,
      deductionPercent: policy ? Number(policy.defaultDeductionPercent ?? 100) : 100,
      leaveRequestId: r.id,
    };
  });

  const holidayByDate = new Map<string, string>();
  for (const h of holidays) holidayByDate.set(String(h.date).slice(0, 10), h.name);

  const weekendConfig: string[] = Array.isArray(tenant?.weekendConfig)
    ? tenant!.weekendConfig as string[]
    : (typeof tenant?.weekendConfig === 'string' ? JSON.parse(tenant!.weekendConfig as string) : ['Saturday', 'Sunday']);

  // Tenant-timezone-aware "today", NOT the server process's own local time
  // — see services/tenantTime.ts. This is the actual root cause of a real
  // pilot bug (a genuinely future date getting resolved as Absent): the
  // resolver used to compute "today" from the server's ambient clock,
  // which is only correct if the server happens to be running in the
  // tenant's own timezone.
  const todayKey = tenantDateKey(tenant, new Date());

  // Only relevant when this month includes today — whether shift end +
  // grace period has passed yet, so "no check-in recorded" for TODAY isn't
  // immediately treated as an absence while the workday is still ongoing.
  let todayCutoffReached = true;
  const todayInThisMonth = todayKey.startsWith(`${year}-${String(month).padStart(2, '0')}`);
  const empUser = userRows[0] || null;
  if (todayInThisMonth && (empUser?.employeeStatus ?? 'active') === 'active') {
    try {
      const branch = empUser?.branchId ? (await db.select().from(schema.branches).where(eq(schema.branches.id, empUser.branchId)).limit(1))[0] || null : null;
      const shift = await getEffectiveShift(tenantId, userId, todayKey);
      const policy = resolveEffectivePolicy(tenant, branch, shift);
      const graceMins = tenant?.checkoutGraceMins ?? 0; // reuse the same "don't jump the gun" allowance as missed-checkout
      const [endH, endM] = policy.shiftEndStr.split(':').map(Number);
      const cutoffMinutesOfDay = (endH || 0) * 60 + (endM || 0) + graceMins;
      const nowParts = tenantParts(tenant, new Date());
      const nowMinutesOfDay = nowParts.hour * 60 + nowParts.minute;
      todayCutoffReached = nowMinutesOfDay >= cutoffMinutesOfDay;
    } catch {
      // If shift resolution fails for any reason, fail safe toward the old
      // behavior (treat as evaluable) rather than silently hiding a real
      // absence forever.
      todayCutoffReached = true;
    }
  }

  const dateOfJoining = empUser?.dateOfJoining ? String(empUser.dateOfJoining).slice(0, 10) : null;
  const dateOfExit = empUser?.dateOfExit ? String(empUser.dateOfExit).slice(0, 10) : null;

  return {
    tenantId,
    userId,
    employeeStatus: empUser?.employeeStatus || 'active',
    dateOfJoining,
    dateOfExit,
    weekendConfig,
    todayKey,
    logsByDate,
    correctionsByDate,
    leaveRangesByPolicy,
    holidayByDate,
    isFrozen: freezeRows.length > 0,
    todayCutoffReached,
  };
}

function resolveFromInputs(inputs: MonthInputs, dateKey: string): DayStatusEntry {
  if (inputs.employeeStatus && inputs.employeeStatus !== 'active') {
    return { status: 'not_applicable' };
  }

  if (inputs.dateOfJoining && dateKey < inputs.dateOfJoining) {
    return { status: 'not_applicable' };
  }

  if (inputs.dateOfExit && dateKey > inputs.dateOfExit) {
    return { status: 'not_applicable' };
  }

  const log = inputs.logsByDate.get(dateKey);
  if (log && log.status === 'approved') {
    if (log.pendingVerification) {
      return { status: 'pending_checkout_verification', attendanceLogId: log.id };
    }
    const correction = inputs.correctionsByDate.get(dateKey);
    if (correction && correction.requestType === 'business_travel') {
      return { status: 'business_travel', attendanceLogId: log.id, correctionId: correction.id };
    }
    if (correction) {
      return { status: 'regularized', attendanceLogId: log.id, correctionId: correction.id };
    }
    if (log.isLate) return { status: 'late', attendanceLogId: log.id };
    if (log.isHalfDay) return { status: 'half_day', attendanceLogId: log.id };
    return { status: 'present', attendanceLogId: log.id };
  }

  const holidayName = inputs.holidayByDate.get(dateKey);
  if (holidayName) return { status: 'holiday', holidayName };

  const leave = inputs.leaveRangesByPolicy.find((r) => dateKey >= r.start && dateKey <= r.end);
  if (leave) {
    return { status: leave.deductionPercent <= 0 ? 'paid_leave' : 'unpaid_leave', leaveRequestId: leave.leaveRequestId };
  }

  // Past / Today / Future, explicitly — a future date is NEVER resolved as
  // present/late/half_day/absent/lop/pending_review/regularized, no matter
  // what falls through below. Checked before the weekend/absent fallback so
  // a future date can never reach them.
  if (dateKey > inputs.todayKey) return { status: 'future' };

  if (inputs.weekendConfig.includes(dayOfWeekName(dateKey))) return { status: 'weekend' };

  // Today, but the workday isn't over yet (shift end + grace period hasn't
  // passed in the tenant's timezone) — don't jump to Absent just because
  // nothing's been recorded yet this morning.
  if (dateKey === inputs.todayKey && !inputs.todayCutoffReached) {
    return { status: 'not_yet_evaluated' };
  }

  return { status: inputs.isFrozen ? 'lop' : 'absent_pending_review' };
}

// Whether a given date's month has been frozen for this tenant — used by
// the correction-request route to block/require-override regularization
// against a closed period (see the roadmap plan, Phase 3).
export async function isDateFrozen(tenantId: number, dateKey: string): Promise<boolean> {
  const [year, month] = dateKey.split('-').map(Number);
  const rows = await db.select({ id: schema.attendanceFreezePeriods.id }).from(schema.attendanceFreezePeriods).where(and(
    eq(schema.attendanceFreezePeriods.tenantId, tenantId),
    eq(schema.attendanceFreezePeriods.year, year),
    eq(schema.attendanceFreezePeriods.month, month),
  )).limit(1);
  return rows.length > 0;
}

// Takes an already-resolved 'YYYY-MM-DD' string, not a `Date` — this used
// to accept a `Date` and read it via its own local y/m/d components, which
// was only correct if the caller had specifically constructed it as
// `new Date(year, month-1, day)`; a caller meaning "today" as `new Date()`
// would silently get the SERVER's local calendar day instead of the
// tenant's (exactly the "Monday/Tuesday" bug class this session's audit was
// looking for — and exactly what employees.routes.ts's own "Today's Team"
// endpoint was doing before this fix). Taking a string instead of a `Date`
// removes the footgun at the type level: callers must resolve the tenant-
// local day themselves (via `tenantDateKey(tenant, ...)`) before calling in.
export async function resolveDayStatus(tenantId: number, userId: number, dateKey: string): Promise<DayStatusEntry> {
  const [year, month] = dateKey.split('-').map(Number);
  const inputs = await loadMonthInputs(tenantId, userId, year, month);
  return resolveFromInputs(inputs, dateKey);
}

// Attendance-driven payroll inputs (Phase 6) — calendar-derived working
// days (every day that isn't a weekend/holiday/future/not-applicable),
// and unpaid-absence days sourced ONLY from finalized 'lop' status
// (Phase 3's freeze), never from a raw, unresolved 'absent_pending_review'
// — this is the guardrail against docking pay before HR has had a chance
// to review/regularize a flagged day. Only called when a tenant has opted
// into 'payroll_attendance_driven'; buildPayrollSummary() falls back to
// the flat settings.workingDaysPerMonth constant otherwise.
export async function computeAttendanceDrivenPayrollInputs(tenantId: number, userId: number, year: number, month: number): Promise<{ workingDays: number; unpaidAbsenceDays: number }> {
  const statuses = await resolveMonthStatuses(tenantId, userId, year, month);
  let workingDays = 0;
  let unpaidAbsenceDays = 0;
  for (const entry of statuses.values()) {
    if (entry.status === 'weekend' || entry.status === 'holiday' || entry.status === 'not_applicable' || entry.status === 'future') continue;
    workingDays++;
    if (entry.status === 'lop') unpaidAbsenceDays++;
  }
  return { workingDays, unpaidAbsenceDays };
}

// Batched — one set of queries for the whole month instead of one resolve()
// call per day, for calendar views and payroll's calendar walk (Phase 6).
export async function resolveMonthStatuses(tenantId: number, userId: number, year: number, month: number): Promise<Map<string, DayStatusEntry>> {
  const inputs = await loadMonthInputs(tenantId, userId, year, month);
  const daysInMonth = new Date(year, month, 0).getDate();
  const result = new Map<string, DayStatusEntry>();
  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    result.set(dateKey, resolveFromInputs(inputs, dateKey));
  }
  return result;
}
