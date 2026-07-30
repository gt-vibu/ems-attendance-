import { eq, and, gte, lte, inArray, desc, or } from 'drizzle-orm';
import { db, schema } from '../../db';
import { hasPrivilege } from '../auth/rbac';
import { resolveMonthStatuses, type DayStatus } from './attendanceDayStatus';
import { tenantDateKey } from './tenantTime';

// Shared data layer for the Reports & Analytics module (apps/admin/src/
// pages/ReportsPage.tsx) — used by both the live GET /api/reports/data
// endpoint and the scheduled-report job handler (reportScheduler.ts), so a
// scheduled CSV export and the on-screen report are always built from the
// exact same query, never two parallel (and potentially disagreeing)
// implementations.
//
// Every field name here is checked against packages/database/src/schema.ts
// directly — the previous version of this module (from an external tool)
// invented field names (emp.firstName/lastName, log.checkInTime/
// totalHours/isWfh, payrollRun.grossSalary/monthYear) that don't exist in
// this schema at all, so every report silently rendered blank/undefined
// values. Attendance status/KPIs are sourced from resolveMonthStatuses()
// (attendanceDayStatus.ts) — the same canonical resolver every other
// attendance view in this app uses — rather than re-deriving status here,
// which is exactly the bug class (inconsistent parallel status logic) this
// session already fixed once in the calendar components.

export interface ReportFilters {
  type: string; // 'attendance' | 'executive' | 'overtime' | 'compliance' | 'wfh' | 'leave' | 'payroll' | 'employee'
  startDate?: string; // 'YYYY-MM-DD', defaults to today (tenant-local) if omitted
  endDate?: string; // 'YYYY-MM-DD', defaults to today (tenant-local) if omitted
  department?: string;
  branchId?: number | null;
  employeeId?: number | null;
  status?: string;
  search?: string;
  wfhOnly?: boolean;
  lateOnly?: boolean;
  overtimeOnly?: boolean;
  // "Only Issues" quick filter — late, absent, pending-checkout-verification,
  // or a regularized (i.e. was flagged and corrected) day. Present-and-clean
  // days are excluded so a manager can scan just what needs attention
  // instead of the whole roster.
  exceptionsOnly?: boolean;
}

const EXCEPTION_STATUSES: DayStatus[] = ['late', 'absent_pending_review', 'lop', 'pending_checkout_verification', 'regularized'];

const STATUS_LABELS: Record<DayStatus, string> = {
  not_applicable: 'N/A',
  pending_checkout_verification: 'Pending Checkout',
  business_travel: 'Business Travel',
  regularized: 'Regularized',
  late: 'Late',
  half_day: 'Half Day',
  present: 'Present',
  holiday: 'Holiday',
  paid_leave: 'On Leave (Paid)',
  unpaid_leave: 'On Leave (Unpaid)',
  future: 'Upcoming',
  weekend: 'Weekend',
  not_yet_evaluated: 'In Progress',
  absent_pending_review: 'Absent',
  lop: 'Absent (LOP)',
};

// Same role/branch/privilege scoping every other tenant-wide endpoint in
// this app already uses (see getScopedBranchIds, rbac.ts) — who a caller is
// allowed to see reports ABOUT, not whether they can see the report at all
// (that's a separate hasPrivilege('reports.view'/'payroll.read') check at
// the route level). Returns null for "no restriction" (tenant admin/HR with
// broad access), otherwise the exact list of userIds in scope.
export async function getPermittedUserIds(user: any, tenantId: number): Promise<number[] | null> {
  const role = user.role;
  const requesterId = user.userId;

  if (role === 'tenant_admin' || role === 'super_admin') return null;

  if (await hasPrivilege(user, 'reports.view') || await hasPrivilege(user, 'employee.read')) {
    return null; // broad HR/GM-style access — same privilege other tenant-wide list endpoints already gate on
  }

  if (role === 'manager') {
    const reports = await db.select({ id: schema.users.id }).from(schema.users).where(
      and(
        eq(schema.users.tenantId, tenantId),
        or(eq(schema.users.managerId, requesterId), eq(schema.users.id, requesterId)),
      )
    );
    return reports.map((r: any) => r.id);
  }

  // Plain employee: their own records only.
  return [requesterId];
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function monthsInRange(start: Date, end: Date): Array<{ year: number; month: number }> {
  const months: Array<{ year: number; month: number }> = [];
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last) {
    months.push({ year: cursor.getFullYear(), month: cursor.getMonth() + 1 });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return months;
}

export async function buildReportData(tenantId: number, requestUser: any, filters: ReportFilters) {
  const permittedUserIds = await getPermittedUserIds(requestUser, tenantId);

  const allEmployees = await db.select().from(schema.users).where(eq(schema.users.tenantId, tenantId));
  const searchLower = (filters.search || '').toLowerCase().trim();
  const filteredEmployees = allEmployees.filter((emp: any) => {
    if (permittedUserIds !== null && !permittedUserIds.includes(emp.id)) return false;
    if (filters.department && filters.department !== 'ALL' && emp.department !== filters.department) return false;
    if (filters.branchId && emp.branchId !== filters.branchId) return false;
    if (filters.employeeId && emp.id !== filters.employeeId) return false;
    if (searchLower) {
      const haystack = `${emp.name || ''} ${emp.email || ''} ${emp.department || ''}`.toLowerCase();
      if (!haystack.includes(searchLower)) return false;
    }
    return true;
  });
  const employeeMap = new Map<number, any>(allEmployees.map((e: any) => [e.id, e]));
  const targetUserIds = filteredEmployees.map((e: any) => e.id);

  const emptyResult = {
    type: filters.type,
    summary: { totalEmployees: 0, presentCount: 0, absentCount: 0, lateCount: 0, wfhCount: 0, leaveCount: 0, totalHours: '0.0', overtimeHours: '0.0', attendancePct: 0 },
    rows: [] as any[],
    charts: { dailyTrend: [] as any[], departmentBreakdown: [] as any[] },
  };
  if (targetUserIds.length === 0) return emptyResult;

  const tenantRows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  const tenant = tenantRows[0] || null;

  const start = parseLocalDate(filters.startDate || tenantDateKey(tenant, new Date()));
  const end = parseLocalDate(filters.endDate || tenantDateKey(tenant, new Date()));
  const startKey = tenantDateKey(tenant, start);
  const endKey = tenantDateKey(tenant, end);

  if (filters.type === 'leave') return buildLeaveReport(tenantId, targetUserIds, employeeMap, filters, startKey, endKey);
  if (filters.type === 'payroll') return buildPayrollReport(tenantId, targetUserIds, employeeMap, requestUser);
  if (filters.type === 'employee') return buildEmployeeReport(filteredEmployees);

  // attendance / executive / overtime / compliance / wfh all share the same
  // underlying per-day data, just displayed/filtered differently.
  return buildAttendanceReport(tenant, tenantId, targetUserIds, employeeMap, filteredEmployees.length, filters, start, end, startKey, endKey);
}

async function buildAttendanceReport(
  tenant: any,
  tenantId: number,
  targetUserIds: number[],
  employeeMap: Map<number, any>,
  totalEmployees: number,
  filters: ReportFilters,
  start: Date,
  end: Date,
  startKey: string,
  endKey: string,
) {
  const months = monthsInRange(start, end);

  // Raw check-in/check-out logs for the range, bucketed by tenant-local
  // calendar day, so the table can show real times/late-minutes/overtime
  // alongside the resolver's canonical status for that day.
  const rangeStart = new Date(start); rangeStart.setDate(rangeStart.getDate() - 1);
  const rangeEnd = new Date(end); rangeEnd.setDate(rangeEnd.getDate() + 2);
  const logs = await db.select().from(schema.attendanceLogs).where(and(
    inArray(schema.attendanceLogs.userId, targetUserIds),
    inArray(schema.attendanceLogs.tenantId, [tenantId]),
    gte(schema.attendanceLogs.createdAt, rangeStart),
    lte(schema.attendanceLogs.createdAt, rangeEnd),
  ));
  const logsByUserDay = new Map<string, { checkIn?: any; checkOut?: any }>();
  for (const log of logs) {
    if (!log.createdAt || (log.type !== 'check_in' && log.type !== 'check_out')) continue;
    const dayKey = tenantDateKey(tenant, new Date(log.createdAt));
    const key = `${log.userId}:${dayKey}`;
    const entry = logsByUserDay.get(key) || {};
    if (log.type === 'check_in' && (!entry.checkIn || (entry.checkIn.status !== 'approved' && log.status === 'approved'))) entry.checkIn = log;
    if (log.type === 'check_out') entry.checkOut = log;
    logsByUserDay.set(key, entry);
  }

  const rows: any[] = [];
  const dailyMap = new Map<string, { present: number; late: number; wfh: number }>();
  const deptMap = new Map<string, { present: number; total: number; late: number }>();
  let presentCount = 0, lateCount = 0, wfhCount = 0, leaveCount = 0, holidayCount = 0, weekendCount = 0, absentCount = 0;
  let totalWorkedMinutes = 0, totalOvertimeMinutes = 0;

  for (const userId of targetUserIds) {
    const emp = employeeMap.get(userId);
    if (!emp) continue;
    const dept = emp.department || 'General';
    if (!deptMap.has(dept)) deptMap.set(dept, { present: 0, total: 0, late: 0 });
    deptMap.get(dept)!.total += 1;

    for (const { year, month } of months) {
      const statuses = await resolveMonthStatuses(tenantId, userId, year, month);
      for (const [dateKey, entry] of statuses) {
        if (dateKey < startKey || dateKey > endKey) continue;
        if (entry.status === 'future' || entry.status === 'not_applicable') continue;

        const logKey = `${userId}:${dateKey}`;
        const dayLogs = logsByUserDay.get(logKey);
        const isWfh = dayLogs?.checkIn?.attendanceMode === 'wfh';
        const lateMins = dayLogs?.checkIn?.lateByMinutes || 0;
        const overtimeMins = dayLogs?.checkIn?.overtimeMinutes || 0;
        const workedMinutes = dayLogs?.checkIn?.workedMinutes || 0;

        if (filters.status && filters.status !== 'ALL' && STATUS_LABELS[entry.status] !== filters.status) continue;
        if (filters.exceptionsOnly && !EXCEPTION_STATUSES.includes(entry.status)) continue;
        if (filters.wfhOnly && !isWfh) continue;
        if (filters.lateOnly && lateMins <= 0) continue;
        if (filters.overtimeOnly && overtimeMins <= 0) continue;

        const isPresent = entry.status === 'present' || entry.status === 'late' || entry.status === 'half_day' || entry.status === 'regularized' || entry.status === 'business_travel';
        if (isPresent) { presentCount++; deptMap.get(dept)!.present += 1; }
        if (entry.status === 'late') { lateCount++; deptMap.get(dept)!.late += 1; }
        if (isWfh) wfhCount++;
        if (entry.status === 'paid_leave' || entry.status === 'unpaid_leave') leaveCount++;
        if (entry.status === 'holiday') holidayCount++;
        if (entry.status === 'weekend') weekendCount++;
        if (entry.status === 'absent_pending_review' || entry.status === 'lop') absentCount++;
        totalWorkedMinutes += workedMinutes;
        totalOvertimeMinutes += overtimeMins;

        if (!dailyMap.has(dateKey)) dailyMap.set(dateKey, { present: 0, late: 0, wfh: 0 });
        const dayAgg = dailyMap.get(dateKey)!;
        if (isPresent) dayAgg.present += 1;
        if (entry.status === 'late') dayAgg.late += 1;
        if (isWfh) dayAgg.wfh += 1;

        rows.push({
          id: `${userId}-${dateKey}`,
          employeeId: userId,
          employeeName: emp.name || emp.email || 'Employee',
          department: dept,
          designation: emp.designation || emp.role || 'Staff',
          date: dateKey,
          rawDate: dateKey,
          status: STATUS_LABELS[entry.status],
          checkIn: dayLogs?.checkIn?.createdAt ? new Date(dayLogs.checkIn.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-',
          checkOut: dayLogs?.checkOut?.createdAt ? new Date(dayLogs.checkOut.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-',
          lateMins,
          workingHours: workedMinutes ? (workedMinutes / 60).toFixed(1) : null,
          rawHours: workedMinutes / 60,
          overtimeMins,
          overtimeHours: overtimeMins ? (overtimeMins / 60).toFixed(1) : null,
          isWfh,
          verificationMode: dayLogs?.checkIn?.device || (isWfh ? 'WFH' : 'Office'),
          approvalStatus: dayLogs?.checkIn?.status || null,
          location: dayLogs?.checkIn?.attendanceMode === 'wfh' ? 'Remote / Home' : 'Office Branch',
          notes: dayLogs?.checkIn?.explanation || dayLogs?.checkIn?.wfhReason || '-',
        });
      }
    }
  }

  const workingDaysConsidered = presentCount + absentCount + leaveCount; // excludes weekend/holiday, matches how attendance % reads elsewhere
  const attendancePct = workingDaysConsidered > 0 ? Math.round((presentCount / workingDaysConsidered) * 100) : 0;

  const departmentBreakdown = Array.from(deptMap.entries()).map(([department, d]) => ({
    department, present: d.present, total: d.total, late: d.late,
    pct: d.total > 0 ? Math.round((d.present / d.total) * 100) : 0,
  }));
  const dailyTrend = Array.from(dailyMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, ...v }));

  return {
    type: filters.type,
    summary: {
      totalEmployees,
      presentCount,
      absentCount,
      lateCount,
      wfhCount,
      leaveCount,
      totalHours: (totalWorkedMinutes / 60).toFixed(1),
      overtimeHours: (totalOvertimeMinutes / 60).toFixed(1),
      attendancePct,
    },
    rows,
    charts: { dailyTrend, departmentBreakdown },
  };
}

async function buildLeaveReport(tenantId: number, targetUserIds: number[], employeeMap: Map<number, any>, filters: ReportFilters, startKey: string, endKey: string) {
  const leaves = await db.select().from(schema.leaveRequests).where(and(
    inArray(schema.leaveRequests.userId, targetUserIds),
    inArray(schema.leaveRequests.tenantId, [tenantId]),
    gte(schema.leaveRequests.startDate, startKey),
    lte(schema.leaveRequests.endDate, endKey),
  )).orderBy(desc(schema.leaveRequests.createdAt));

  const rows = leaves.map((l: any) => {
    const emp = employeeMap.get(l.userId) || {};
    return {
      id: l.id,
      employeeId: l.userId,
      employeeName: emp.name || emp.email || 'Employee',
      department: emp.department || 'General',
      leaveType: l.leaveType || 'Leave',
      startDate: l.startDate,
      endDate: l.endDate,
      daysCount: Number(l.totalDays) || 0,
      status: l.status || 'pending',
      reason: l.reason || '-',
      appliedOn: l.createdAt ? new Date(l.createdAt).toLocaleDateString() : '-',
    };
  });

  const approved = rows.filter((r) => r.status === 'approved').length;
  const pending = rows.filter((r) => r.status === 'pending').length;
  const rejected = rows.filter((r) => r.status === 'rejected').length;

  return {
    type: 'leave',
    summary: {
      totalLeaves: rows.length,
      approvedCount: approved,
      pendingCount: pending,
      rejectedCount: rejected,
      totalDays: rows.reduce((acc, r) => acc + r.daysCount, 0),
    },
    rows,
    charts: {
      statusBreakdown: [
        { name: 'Approved', value: approved, color: '#10b981' },
        { name: 'Pending', value: pending, color: '#f59e0b' },
        { name: 'Rejected', value: rejected, color: '#ef4444' },
      ],
    },
  };
}

async function buildPayrollReport(tenantId: number, targetUserIds: number[], employeeMap: Map<number, any>, requestUser: any) {
  // Payroll data needs its OWN privilege gate, independent of the general
  // report-scoping above — 'reports.view'/'employee.read' governs which
  // EMPLOYEES you can see reports about, not whether salary figures are
  // visible at all. The previous version of this module had no such check
  // for the payroll report type.
  if (!(await hasPrivilege(requestUser, 'payroll.read'))) {
    const err: any = new Error('Access denied: payroll.read privilege required.');
    err.statusCode = 403;
    throw err;
  }

  const payrolls = await db.select().from(schema.payrollRuns).where(inArray(schema.payrollRuns.userId, targetUserIds)).orderBy(desc(schema.payrollRuns.year), desc(schema.payrollRuns.month));

  const rows = payrolls.map((p: any) => {
    const emp = employeeMap.get(p.userId) || {};
    return {
      id: p.id,
      employeeId: p.userId,
      employeeName: emp.name || emp.email || 'Employee',
      department: emp.department || 'General',
      monthYear: `${p.year}-${String(p.month).padStart(2, '0')}`,
      grossSalary: Number(p.grossPay) || 0,
      netSalary: Number(p.netPay) || 0,
      deductions: Number(p.leaveDeduction || 0) + Number(p.lopDeduction || 0),
      lopDays: Number(p.unpaidAbsenceDays) || 0,
      status: p.status || 'draft',
      processedOn: p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '-',
    };
  });

  const totalPayout = rows.reduce((acc, r) => acc + r.netSalary, 0);
  const totalGross = rows.reduce((acc, r) => acc + r.grossSalary, 0);
  const totalDeductions = rows.reduce((acc, r) => acc + r.deductions, 0);

  // Real trend from actual historical payroll_runs rows (grouped by
  // year/month across the selected employees), never a fabricated
  // multiplier — a payroll trend chart is exactly the kind of number an
  // auditor would sanity-check against source data.
  const byPeriod = new Map<string, { gross: number; net: number }>();
  for (const r of rows) {
    const agg = byPeriod.get(r.monthYear) || { gross: 0, net: 0 };
    agg.gross += r.grossSalary;
    agg.net += r.netSalary;
    byPeriod.set(r.monthYear, agg);
  }
  const payrollTrend = Array.from(byPeriod.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-6).map(([month, v]) => ({ month, gross: v.gross, net: v.net }));

  return {
    type: 'payroll',
    summary: {
      processedCount: rows.length,
      totalPayout,
      totalGross,
      totalDeductions,
      avgSalary: rows.length > 0 ? Math.round(totalPayout / rows.length) : 0,
    },
    rows,
    charts: { payrollTrend },
  };
}

function buildEmployeeReport(filteredEmployees: any[]) {
  const rows = filteredEmployees.map((emp: any) => ({
    id: emp.id,
    employeeId: emp.id,
    employeeName: emp.name || emp.email || 'Employee',
    email: emp.email,
    role: emp.role || 'employee',
    department: emp.department || 'General',
    designation: emp.designation || emp.role || 'Staff',
    status: emp.employeeStatus || 'active',
    kycStatus: emp.isKycCompleted ? 'Verified' : 'Pending',
    joinedDate: emp.dateOfJoining || (emp.createdAt ? new Date(emp.createdAt).toLocaleDateString() : '-'),
  }));
  return {
    type: 'employee',
    summary: { totalEmployees: rows.length },
    rows,
    charts: { departmentBreakdown: [] },
  };
}
