import React from 'react';
import { Users, CheckCircle2, XCircle, Clock, Star, ShieldCheck, Building2, Mail, Phone } from 'lucide-react';
import { ENHANCED_REPORT_THEMES } from './reportMetadata';
import { formatCell, formatSummary, statusBadgeStyle, type CellFormat, type SummaryFormat } from './formatValue';

export interface ReportPreviewColumn {
  key: string;
  label: string;
  format?: CellFormat;
}

export interface ReportPreviewSummaryField {
  key: string;
  label: string;
  format?: SummaryFormat;
}

export interface ReportPreviewMeta {
  title: string;
  tenantName: string;
  tenantAddress?: string | null;
  logoUrl?: string | null;
  generatedByName: string;
  generatedAt: Date;
  timezone: string;
  filtersDescription: string;
  signatureLine?: string | null;
  showWatermark?: boolean;
  /** e.g. "Jul 1 - Jul 30, 2026" — shown as its own header line, separate from the raw filter description. */
  periodLabel?: string;
  /** e.g. "Entire Company", "Sales Department", "Rahul Kumar" — who this report covers. */
  scopeLabel?: string;
  reportTypeLabel?: string;
  employeeCount?: number;
  themeLabel?: string;
  layoutLabel?: string;
  /** Chip row (Department/Location/Status etc.) — rendered by the Weekly Grid layout, mirroring the sample's filter-summary row. */
  filterChips?: { label: string; value: string }[];
}

export type ReportLayoutId = 'standard' | 'executive' | 'compact' | 'detailed' | 'register' | 'weekly_grid' | 'employee_summary';

// Attendance-percentage → status badge, used by the Executive Summary
// layout's employee table — lets a reader classify a row at a glance
// instead of doing the present/absent math themselves.
export function attendanceStatusBadge(pct: number): { label: string; emoji: string; bg: string; text: string; hex: string } {
  if (pct >= 95) return { label: 'Excellent', emoji: '🟢', bg: 'bg-emerald-50', text: 'text-emerald-700', hex: '#059669' };
  if (pct >= 80) return { label: 'Good', emoji: '🟡', bg: 'bg-amber-50', text: 'text-amber-700', hex: '#d97706' };
  return { label: 'Needs Attention', emoji: '🔴', bg: 'bg-rose-50', text: 'text-rose-700', hex: '#e11d48' };
}

// Maps a row's resolved attendance status to the icon/label the GreenLeaf-
// style weekly grid uses. A day with no row at all (resolveMonthStatuses
// filters out 'future'/'not_applicable' entries before they ever reach the
// report row set) is treated as Weekly Off — an approximation, since the
// grid has no separate holiday-calendar signal to draw on.
function weeklyGridStatusIcon(status?: string): { icon: string; label: string; cls: string } {
  const s = (status || '').toLowerCase();
  if (s.includes('half')) return { icon: '🟡', label: 'Half Day', cls: 'text-amber-500' };
  if (s.includes('late')) return { icon: '⏰', label: 'Late', cls: 'text-amber-500' };
  if (s.includes('leave')) return { icon: '🔵', label: 'On Leave', cls: 'text-blue-500' };
  if (s.includes('absent')) return { icon: '❌', label: 'Absent', cls: 'text-rose-500' };
  if (s.includes('present') || s.includes('wfh')) return { icon: '✅', label: 'Present', cls: 'text-emerald-600' };
  return { icon: '–', label: status || 'N/A', cls: 'text-slate-300' };
}

interface ReportPreviewProps {
  themeId: string;
  layoutId: ReportLayoutId;
  meta: ReportPreviewMeta;
  columns: ReportPreviewColumn[];
  rows: any[];
  summary: Record<string, any>;
  summaryFields: ReportPreviewSummaryField[];
  /** Row field to group by for the Register layout — defaults to 'department'. */
  registerGroupKey?: string;
  /** Adds a Department Totals breakdown below the main totals. */
  showDepartmentTotals?: boolean;
}

// Sums whichever selected columns are actually numeric (currency/hours
// format, or a plain number field like daysCount/lateMins) per department —
// generic across report types rather than a per-type mapping, since every
// row already carries `department` and the exact numeric columns vary by
// type. Non-numeric columns just aren't included in the breakdown.
function computeDepartmentTotals(rows: any[], columns: ReportPreviewColumn[]) {
  const numericCols = columns.filter((c) => c.format === 'hours' || c.format === 'currency' || (rows[0] && typeof rows[0][c.key] === 'number'));
  const groups = new Map<string, { count: number; sums: Record<string, number> }>();
  for (const row of rows) {
    const dept = row.department || 'General';
    if (!groups.has(dept)) groups.set(dept, { count: 0, sums: Object.fromEntries(numericCols.map((c) => [c.key, 0])) });
    const g = groups.get(dept)!;
    g.count += 1;
    for (const c of numericCols) {
      const val = parseFloat(row[c.key]);
      if (!isNaN(val)) g.sums[c.key] += val;
    }
  }
  return { numericCols, groups: Array.from(groups.entries()).map(([department, v]) => ({ department, ...v })) };
}

// Renders the SAME structure the server PDF/Excel builders produce
// (reportFileExport.ts) — branded header band, themed table, KPI cards for
// the Executive layout, watermark/signature — so what's on screen reads as
// "this is basically the export," not a generic HTML table. Not a literal
// pixel-for-pixel PDF renderer; a matching HTML render of the same content.
export const ReportPreview: React.FC<ReportPreviewProps> = ({ themeId, layoutId, meta, columns, rows, summary, summaryFields, registerGroupKey, showDepartmentTotals }) => {
  const theme = ENHANCED_REPORT_THEMES.find((t) => t.id === themeId) || ENHANCED_REPORT_THEMES[0];
  const previewRows = rows.slice(0, 50);
  const groupKey = registerGroupKey || (columns.some((c) => c.key === 'leaveType') ? 'leaveType' : 'department');

  const weeklyGrid = React.useMemo(() => {
    if (layoutId !== 'weekly_grid') return null;
    const employees = new Map<string, { employeeId: string | number; employeeName: string; department: string }>();
    const dateSet = new Set<string>();
    const cellMap = new Map<string, any>();
    for (const row of rows) {
      const key = String(row.employeeId ?? row.employeeName ?? '?');
      if (!employees.has(key)) employees.set(key, { employeeId: row.employeeId ?? '-', employeeName: row.employeeName || 'Employee', department: row.department || 'General' });
      if (row.date) {
        dateSet.add(row.date);
        cellMap.set(`${key}|${row.date}`, row);
      }
    }
    const dates = Array.from(dateSet).sort();
    const empList = Array.from(employees.entries()).map(([key, v]) => {
      let present = 0, absent = 0, late = 0, leave = 0, workingHours = 0;
      for (const d of dates) {
        const r = cellMap.get(`${key}|${d}`);
        if (!r) continue;
        const s = (r.status || '').toLowerCase();
        if (s.includes('late')) late += 1;
        else if (s.includes('leave')) leave += 1;
        else if (s.includes('absent')) absent += 1;
        else if (s.includes('present') || s.includes('half') || s.includes('wfh')) present += 1;
        const rawH = r.rawHours ?? (r.workingHours ? Number(r.workingHours) : null);
        if (rawH !== null && !isNaN(rawH)) {
          workingHours += rawH;
        } else if (s.includes('present') || s.includes('wfh') || s.includes('late')) {
          workingHours += s.includes('half') ? 4 : 8;
        }
      }
      return { key, ...v, present, absent, late, leave, workingHours };
    });
    const totals = dates.map((d) => empList.reduce((n, e) => (cellMap.get(`${e.key}|${d}`) ? n + ((cellMap.get(`${e.key}|${d}`).status || '').toLowerCase().includes('absent') ? 0 : 1) : n), 0));
    const grand = empList.reduce((acc, e) => ({
      present: acc.present + e.present, absent: acc.absent + e.absent, late: acc.late + e.late, leave: acc.leave + e.leave, workingHours: acc.workingHours + e.workingHours,
    }), { present: 0, absent: 0, late: 0, leave: 0, workingHours: 0 });
    return { employees: empList, dates, cellMap, totals, grand };
  }, [rows, layoutId]);

  // Executive Summary layout for attendance-shaped reports — an actual
  // report a CEO/auditor would read, not a data dump: KPI row → insights →
  // charts → department rollup → a trimmed, department-grouped employee
  // table with a status badge. Full day-by-day detail intentionally lives
  // in the separate Weekly Grid/Attendance Register layout, not here —
  // mixing "10-second executive read" with "31-column audit register" was
  // the core critique that drove this redesign. Computed client-side from
  // the same row set the Weekly Grid pivots, just aggregated differently.
  const isAttendanceShaped = (columns.some((c) => ['date', 'status', 'present', 'presentDays', 'workingHours', 'employeeId', 'attendancePct'].includes(c.key)) || meta.title?.toLowerCase().includes('attendance')) && rows.some((r) => r.employeeId !== undefined || r.employeeName !== undefined);
  const attendanceExec = React.useMemo(() => {
    if ((layoutId !== 'executive' && layoutId !== 'employee_summary') || !isAttendanceShaped) return null;
    const employees = new Map<string, { employeeId: string | number; employeeName: string; department: string; designation?: string }>();
    for (const row of rows) {
      const key = String(row.employeeId ?? row.employeeName ?? '?');
      if (!employees.has(key)) employees.set(key, { employeeId: row.employeeId ?? '-', employeeName: row.employeeName || 'Employee', department: row.department || 'General', designation: row.designation });
    }
    const empList = Array.from(employees.entries()).map(([key, v]) => {
      const empRows = rows.filter((r) => String(r.employeeId ?? r.employeeName ?? '?') === key);
      let present = 0, absent = 0, late = 0, halfDay = 0, leave = 0, workingHours = 0, overtimeHours = 0;
      for (const r of empRows) {
        const s = (r.status || '').toLowerCase();
        if (s.includes('half')) halfDay += 1;
        else if (s.includes('late')) late += 1;
        else if (s.includes('leave')) leave += 1;
        else if (s.includes('absent')) absent += 1;
        else if (s.includes('present') || s.includes('wfh')) present += 1;
        const rawH = r.rawHours ?? (r.workingHours ? Number(r.workingHours) : null);
        if (rawH !== null && !isNaN(rawH)) {
          workingHours += rawH;
        } else if (s.includes('present') || s.includes('wfh') || s.includes('late') || s.includes('half')) {
          workingHours += s.includes('half') ? 4 : 8;
        }
        overtimeHours += Number(r.overtimeHours) || 0;
      }
      const totalDays = present + absent + leave + late + halfDay;
      const attendancePct = totalDays > 0 ? Math.round(((present + late + halfDay) / totalDays) * 100) : 0;
      return { key, ...v, present, absent, late, halfDay, leave, workingHours, overtimeHours, attendancePct };
    });

    const deptMap = new Map<string, { employees: number; present: number; absent: number; leave: number; totalDays: number }>();
    for (const e of empList) {
      if (!deptMap.has(e.department)) deptMap.set(e.department, { employees: 0, present: 0, absent: 0, leave: 0, totalDays: 0 });
      const d = deptMap.get(e.department)!;
      d.employees += 1; d.present += e.present; d.absent += e.absent; d.leave += e.leave;
      d.totalDays += e.present + e.absent + e.leave + e.late + e.halfDay;
    }
    const departments = Array.from(deptMap.entries()).map(([department, d]) => ({
      department, ...d, pct: d.totalDays > 0 ? Math.round((d.present / d.totalDays) * 100) : 0,
    }));

    const grand = empList.reduce((acc, e) => ({
      present: acc.present + e.present, absent: acc.absent + e.absent, late: acc.late + e.late,
      halfDay: acc.halfDay + e.halfDay, leave: acc.leave + e.leave, workingHours: acc.workingHours + e.workingHours, overtimeHours: acc.overtimeHours + e.overtimeHours,
    }), { present: 0, absent: 0, late: 0, halfDay: 0, leave: 0, workingHours: 0, overtimeHours: 0 });
    const totalDays = grand.present + grand.absent + grand.leave + grand.late + grand.halfDay;
    const grandPct = totalDays > 0 ? Math.round(((grand.present + grand.late + grand.halfDay) / totalDays) * 100) : 0;

    const distribution = [
      { label: 'Present', value: grand.present, color: '#059669' },
      { label: 'Absent', value: grand.absent, color: '#e11d48' },
      { label: 'Leave', value: grand.leave, color: '#8b5cf6' },
      { label: 'Late', value: grand.late, color: '#d97706' },
      { label: 'Half Day', value: grand.halfDay, color: '#3b82f6' },
    ].filter((d) => d.value > 0);

    const sortedDepartments = [...departments].sort((a, b) => b.pct - a.pct);
    const belowThreshold = empList.filter((e) => e.attendancePct < 80);
    const withOvertime = empList.filter((e) => e.overtimeHours > 0);
    const frequentLeave = [...empList].filter((e) => e.leave > 0).sort((a, b) => b.leave - a.leave);

    const insights: string[] = [];
    insights.push(`Overall attendance across ${empList.length} employee${empList.length === 1 ? '' : 's'} is ${grandPct}%.`);
    if (sortedDepartments.length > 1) insights.push(`${sortedDepartments[0].department} has the highest attendance at ${sortedDepartments[0].pct}%.`);
    if (belowThreshold.length > 0) insights.push(`${belowThreshold.length} employee${belowThreshold.length === 1 ? '' : 's'} below 80% attendance — needs attention.`);
    if (withOvertime.length > 0) insights.push(`${withOvertime.length} employee${withOvertime.length === 1 ? '' : 's'} logged overtime this period.`);
    if (frequentLeave.length > 0) insights.push(`${frequentLeave[0].employeeName} took the most leave days (${frequentLeave[0].leave}).`);
    if (grand.late > 0) insights.push(`${grand.late} late day${grand.late === 1 ? '' : 's'} recorded across all employees.`);

    return { empList, departments: sortedDepartments, grand, grandPct, distribution, insights };
  }, [rows, layoutId, isAttendanceShaped]);

  // Leave Executive Summary — same design as the attendance one (KPIs →
  // charts/insights → department rollup → employee table), built from
  // buildLeaveReport's row shape (employeeId/employeeName/department/
  // leaveType/daysCount/status/appliedOn). 'columns' still gates which
  // metrics show, same discipline as the attendance layouts.
  const isLeaveShaped = columns.some((c) => c.key === 'leaveType' && rows.some((r) => r.leaveType));
  const leaveExec = React.useMemo(() => {
    if (layoutId !== 'executive' || !isLeaveShaped) return null;
    const employees = new Map<string, { employeeId: any; employeeName: string; department: string }>();
    for (const row of rows) {
      const key = String(row.employeeId ?? row.employeeName ?? '?');
      if (!employees.has(key)) employees.set(key, { employeeId: row.employeeId ?? '-', employeeName: row.employeeName || 'Employee', department: row.department || 'General' });
    }
    const empList = Array.from(employees.entries()).map(([key, v]) => {
      const empRows = rows.filter((r) => String(r.employeeId ?? r.employeeName ?? '?') === key);
      const applied = empRows.length;
      const approved = empRows.filter((r) => r.status === 'approved').length;
      const pending = empRows.filter((r) => r.status === 'pending').length;
      const rejected = empRows.filter((r) => r.status === 'rejected').length;
      const totalDays = empRows.reduce((n, r) => n + (Number(r.daysCount) || 0), 0);
      return { key, ...v, applied, approved, pending, rejected, totalDays };
    });

    const deptMap = new Map<string, { employees: number; applied: number; approved: number; totalDays: number }>();
    for (const e of empList) {
      if (!deptMap.has(e.department)) deptMap.set(e.department, { employees: 0, applied: 0, approved: 0, totalDays: 0 });
      const d = deptMap.get(e.department)!;
      d.employees += 1; d.applied += e.applied; d.approved += e.approved; d.totalDays += e.totalDays;
    }
    const departments = Array.from(deptMap.entries())
      .map(([department, d]) => ({ department, ...d }))
      .sort((a, b) => b.totalDays - a.totalDays);

    const typeMap = new Map<string, { count: number; days: number }>();
    for (const row of rows) {
      const t = row.leaveType || 'Leave';
      if (!typeMap.has(t)) typeMap.set(t, { count: 0, days: 0 });
      const v = typeMap.get(t)!;
      v.count += 1; v.days += Number(row.daysCount) || 0;
    }
    const leaveTypes = Array.from(typeMap.entries()).map(([type, v]) => ({ type, ...v })).sort((a, b) => b.days - a.days);

    const grand = empList.reduce((acc, e) => ({ applied: acc.applied + e.applied, approved: acc.approved + e.approved, pending: acc.pending + e.pending, rejected: acc.rejected + e.rejected, totalDays: acc.totalDays + e.totalDays }), { applied: 0, approved: 0, pending: 0, rejected: 0, totalDays: 0 });

    const distribution = [
      { label: 'Approved', value: grand.approved, color: '#059669' },
      { label: 'Pending', value: grand.pending, color: '#d97706' },
      { label: 'Rejected', value: grand.rejected, color: '#e11d48' },
    ].filter((d) => d.value > 0);

    const frequentTaker = [...empList].sort((a, b) => b.totalDays - a.totalDays)[0];
    const insights: string[] = [`${grand.applied} leave request${grand.applied === 1 ? '' : 's'} across ${empList.length} employee${empList.length === 1 ? '' : 's'}, totaling ${grand.totalDays} day${grand.totalDays === 1 ? '' : 's'}.`];
    if (grand.pending > 0) insights.push(`${grand.pending} request${grand.pending === 1 ? '' : 's'} still pending approval.`);
    if (leaveTypes.length > 0) insights.push(`${leaveTypes[0].type} is the most-used leave type (${leaveTypes[0].days} days).`);
    if (departments.length > 1) insights.push(`${departments[0].department} has taken the most leave (${departments[0].totalDays} days).`);
    if (frequentTaker && frequentTaker.totalDays > 0) insights.push(`${frequentTaker.employeeName} took the most leave days (${frequentTaker.totalDays}).`);

    return { empList, departments, leaveTypes, grand, distribution, insights };
  }, [rows, layoutId, isLeaveShaped]);

  // Payroll Executive Summary — same design as attendance/leave, built from
  // buildPayrollReport's row shape (grossSalary/netSalary/deductions/
  // pfAmount/esiAmount/taxAmount/status). Currency formatted with the same
  // '$'-prefixed convention formatCell/formatSummary already use elsewhere
  // in this file, so a number never renders two different ways.
  const fmtCurrency = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const isPayrollShaped = columns.some((c) => c.key === 'grossSalary' && rows.some((r) => r.grossSalary !== undefined));
  const payrollExec = React.useMemo(() => {
    if (layoutId !== 'executive' || !isPayrollShaped) return null;
    const empList = rows.map((r) => ({
      key: String(r.employeeId ?? r.employeeName ?? '?'), employeeId: r.employeeId ?? '-', employeeName: r.employeeName || 'Employee',
      department: r.department || 'General', gross: Number(r.grossSalary) || 0, net: Number(r.netSalary) || 0, deductions: Number(r.deductions) || 0,
      pf: Number(r.pfAmount) || 0, esi: Number(r.esiAmount) || 0, tax: Number(r.taxAmount) || 0, status: r.status || 'draft',
    }));

    const deptMap = new Map<string, { employees: number; gross: number; net: number; deductions: number }>();
    for (const e of empList) {
      if (!deptMap.has(e.department)) deptMap.set(e.department, { employees: 0, gross: 0, net: 0, deductions: 0 });
      const d = deptMap.get(e.department)!;
      d.employees += 1; d.gross += e.gross; d.net += e.net; d.deductions += e.deductions;
    }
    const departments = Array.from(deptMap.entries()).map(([department, d]) => ({ department, ...d })).sort((a, b) => b.gross - a.gross);

    const grand = empList.reduce((acc, e) => ({
      gross: acc.gross + e.gross, net: acc.net + e.net, deductions: acc.deductions + e.deductions, pf: acc.pf + e.pf, esi: acc.esi + e.esi, tax: acc.tax + e.tax,
    }), { gross: 0, net: 0, deductions: 0, pf: 0, esi: 0, tax: 0 });
    const employerContribution = grand.pf + grand.esi;

    const distribution = [
      { label: 'Net Pay', value: grand.net, color: '#059669' },
      { label: 'Deductions', value: grand.deductions, color: '#e11d48' },
      { label: 'Employer PF/ESI', value: employerContribution, color: '#8b5cf6' },
    ].filter((d) => d.value > 0);

    const highestPaidDept = departments[0];
    const avgSalary = empList.length > 0 ? grand.net / empList.length : 0;
    const highestPaid = [...empList].sort((a, b) => b.net - a.net)[0];
    const insights: string[] = [`${empList.length} employee${empList.length === 1 ? '' : 's'} processed, totaling ${fmtCurrency(grand.gross)} gross / ${fmtCurrency(grand.net)} net.`];
    if (highestPaidDept) insights.push(`${highestPaidDept.department} has the highest payroll cost (${fmtCurrency(highestPaidDept.gross)}).`);
    if (employerContribution > 0) insights.push(`Total employer contribution (PF + ESI): ${fmtCurrency(employerContribution)}.`);
    insights.push(`Average net pay: ${fmtCurrency(avgSalary)}.`);
    if (highestPaid) insights.push(`${highestPaid.employeeName} has the highest net pay (${fmtCurrency(highestPaid.net)}).`);

    return { empList, departments, grand, employerContribution, avgSalary, distribution, insights };
  }, [rows, layoutId, isPayrollShaped]);

  // Consolidated Executive Summary — rows already arrive pre-merged, one per
  // employee (buildConsolidatedReport in reportData.ts), so there's no
  // client-side aggregation step here, just KPI/department rollups gated by
  // which columns (= which modules) the tenant actually selected.
  const isConsolidatedShaped = columns.some((c) => c.key === 'attendancePct');
  const showAttCols = columns.some((c) => c.key === 'attendancePct');
  const showLeaveCols = columns.some((c) => c.key === 'leaveTaken');
  const showPayrollCols = columns.some((c) => c.key === 'netPay');
  const consolidatedExec = React.useMemo(() => {
    if (layoutId !== 'executive' || !isConsolidatedShaped) return null;
    const deptMap = new Map<string, { employees: number; present: number; leaveTaken: number; gross: number; net: number }>();
    for (const r of rows) {
      const dept = r.department || 'General';
      if (!deptMap.has(dept)) deptMap.set(dept, { employees: 0, present: 0, leaveTaken: 0, gross: 0, net: 0 });
      const d = deptMap.get(dept)!;
      d.employees += 1;
      if (r.presentDays !== null && r.presentDays !== undefined) d.present += r.presentDays;
      if (r.leaveTaken !== null && r.leaveTaken !== undefined) d.leaveTaken += r.leaveTaken;
      if (r.grossPay !== null && r.grossPay !== undefined) d.gross += r.grossPay;
      if (r.netPay !== null && r.netPay !== undefined) d.net += r.netPay;
    }
    const departments = Array.from(deptMap.entries()).map(([department, d]) => ({ department, ...d })).sort((a, b) => b.employees - a.employees);

    const withAttPct = rows.filter((r) => typeof r.attendancePct === 'number');
    const avgAttendancePct = withAttPct.length > 0 ? Math.round(withAttPct.reduce((n, r) => n + r.attendancePct, 0) / withAttPct.length) : null;
    const totalLeaveTaken = rows.reduce((n, r) => n + (r.leaveTaken || 0), 0);
    const totalGross = rows.reduce((n, r) => n + (r.grossPay || 0), 0);
    const totalNet = rows.reduce((n, r) => n + (r.netPay || 0), 0);
    const totalDeductions = rows.reduce((n, r) => n + (r.deductions || 0), 0);

    return { departments, avgAttendancePct, totalLeaveTaken, totalGross, totalNet, totalDeductions, employeeCount: rows.length };
  }, [rows, layoutId, isConsolidatedShaped]);

  const renderCell = (row: any, c: ReportPreviewColumn) => {
    const display = formatCell(row, c.key, c.format);
    const badge = (c.key === 'status' || c.key === 'approvalStatus') ? statusBadgeStyle(display) : null;
    if (badge) {
      return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${badge.bg} ${badge.text}`}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: badge.dot }} />
          {display}
        </span>
      );
    }
    return display;
  };

  const dataTable = (rowSet: any[], compact?: boolean) => (
    <table className="w-full text-left border-collapse text-xs">
      <thead>
        <tr className={`${theme.tableHeaderBg} ${theme.tableHeaderText} font-semibold uppercase tracking-wider`}>
          {columns.map((c) => <th key={c.key} className={compact ? 'p-1.5 whitespace-nowrap' : 'p-2.5 whitespace-nowrap'}>{c.label}</th>)}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rowSet.map((row, i) => (
          <tr key={row.id ?? i} className={i % 2 === 1 ? 'bg-slate-50/60' : ''}>
            {columns.map((c) => <td key={c.key} className={`${compact ? 'p-1.5 text-[11px]' : 'p-2.5'} text-slate-700 max-w-xs truncate`}>{renderCell(row, c)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="relative border border-slate-200 rounded-xl overflow-hidden shadow-xs bg-white">
      {meta.showWatermark && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center select-none"
          style={{ zIndex: 1 }}
        >
          <span className="text-4xl font-black text-slate-200/60 -rotate-[30deg] whitespace-nowrap">
            {theme.watermark}
          </span>
        </div>
      )}

      {/* Branded header — company identity, report title/subtitle, period,
          scope ("prepared for"), and who/when generated as its own
          secondary line rather than one crammed sentence. */}
      {/* Branded header matching user design: logo, company title, centered report header, right company info */}
      <div className="bg-white border-b border-slate-200 px-6 py-5 relative" style={{ zIndex: 2 }}>
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {meta.logoUrl ? (
              <img src={meta.logoUrl} alt="" className="w-11 h-11 rounded-xl object-contain shrink-0 border border-slate-200" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            ) : (
              <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-700 to-purple-600 p-2.5 text-white shadow-md flex items-center justify-center shrink-0">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
              </div>
            )}
            <div>
              <div className="text-base font-extrabold text-slate-900 tracking-tight flex items-center gap-1.5">
                {meta.tenantName || 'Smart Teams EMS'}
              </div>
              <div className="text-[11px] font-semibold text-slate-500">
                Enterprise Management Suite
              </div>
            </div>
          </div>

          <div className="text-center">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              {meta.title || 'Attendance Summary Report'}
            </h1>
            <div className="mt-1 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200 shadow-2xs">
              <span>📅</span> {meta.periodLabel || meta.filtersDescription || '01 Aug 2026 - 07 Aug 2026'}
            </div>
          </div>

          <div className="text-right text-xs space-y-0.5 text-slate-600 hidden md:block">
            <div className="font-bold text-slate-900 flex items-center justify-end gap-1.5">
              <span>🏢</span> Smart Teams Technologies Pvt. Ltd.
            </div>
            <div className="text-[11px] text-slate-500">Bangalore, Karnataka, India</div>
            <div className="text-[10px] text-slate-500 flex items-center justify-end gap-1">
              <span>✉️</span> contact@smartteams.com
            </div>
            <div className="text-[10px] text-slate-500 flex items-center justify-end gap-1">
              <span>📞</span> +91 80 1234 5678
            </div>
          </div>
        </div>
      </div>
      <div className="px-6 py-3 border-b border-slate-100 relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-[11px] text-slate-500" style={{ zIndex: 2 }}>
        <span>Prepared for: <span className="font-semibold text-slate-700">{meta.scopeLabel || 'Entire Company'}</span></span>
        <span>Generated by {meta.generatedByName} on {meta.generatedAt.toLocaleString()} ({meta.timezone})</span>
      </div>

      {layoutId === 'weekly_grid' && meta.filterChips && meta.filterChips.length > 0 && (
        <div className="px-6 py-2.5 border-b border-slate-100 relative flex flex-wrap items-center gap-x-6 gap-y-1 text-[11px]" style={{ zIndex: 2 }}>
          {meta.filterChips.map((c) => (
            <span key={c.label}>
              <span className="font-semibold" style={{ color: theme.accentColor }}>{c.label}:</span>{' '}
              <span className="text-slate-600">{c.value}</span>
            </span>
          ))}
        </div>
      )}

      {/* Report metadata strip — confirms the report matches what was
          configured, at a glance, before scrolling into the data. */}
      <div className="px-6 py-2.5 bg-slate-50/70 border-b border-slate-100 relative grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[10px]" style={{ zIndex: 2 }}>
        {meta.reportTypeLabel && <div><span className="text-slate-400 uppercase tracking-wider">Report</span><div className="font-semibold text-slate-700">{meta.reportTypeLabel}</div></div>}
        {meta.employeeCount !== undefined && <div><span className="text-slate-400 uppercase tracking-wider">Employees</span><div className="font-semibold text-slate-700">{meta.employeeCount}</div></div>}
        {meta.themeLabel && <div><span className="text-slate-400 uppercase tracking-wider">Theme</span><div className="font-semibold text-slate-700">{meta.themeLabel}</div></div>}
        {meta.layoutLabel && <div><span className="text-slate-400 uppercase tracking-wider">Layout</span><div className="font-semibold text-slate-700">{meta.layoutLabel}</div></div>}
      </div>

      {/* KPI cards before the table — every layout except Compact (which is
          intentionally dense-print-only) now gets the scannable card grid,
          not just Executive. */}
      {layoutId !== 'compact' && !attendanceExec && !leaveExec && !payrollExec && !consolidatedExec && summaryFields.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 relative" style={{ zIndex: 2 }}>
          {summaryFields.map((f) => (
            <div key={f.key} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{f.label}</div>
              <div className="text-lg font-bold" style={{ color: theme.accentColor }}>{formatSummary(summary?.[f.key], f.format)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Body — structurally different per layout, not just restyled */}
      <div className="overflow-x-auto relative" style={{ zIndex: 2 }}>
        {previewRows.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">No data for the selected filters.</div>
        ) : layoutId === 'executive' && attendanceExec ? (
          <div className="p-4 sm:p-6 space-y-6 bg-slate-50/40">
            {/* 1. Top Metric / KPI Cards (5 Cards in 1 Row) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                {
                  key: 'employeeName',
                  label: 'TOTAL EMPLOYEES',
                  value: attendanceExec.empList.length,
                  subtext: 'Active Employees',
                  icon: <Users className="w-5 h-5 text-indigo-600" />,
                  bg: 'bg-indigo-50',
                  accent: '#4F46E5',
                  show: columns.some((c) => ['employeeName', 'employeeId', 'department'].includes(c.key)),
                },
                {
                  key: 'present',
                  label: 'PRESENT',
                  value: attendanceExec.grand.present,
                  subtext: `${attendanceExec.grandPct}% of total`,
                  icon: <CheckCircle2 className="w-5 h-5 text-purple-600" />,
                  bg: 'bg-purple-50',
                  accent: '#7C3AED',
                  show: columns.some((c) => ['status', 'present', 'presentDays', 'date'].includes(c.key)),
                },
                {
                  key: 'absent',
                  label: 'ABSENT',
                  value: attendanceExec.grand.absent,
                  subtext: `${100 - attendanceExec.grandPct}% of total`,
                  icon: <XCircle className="w-5 h-5 text-purple-600" />,
                  bg: 'bg-purple-50',
                  accent: '#7C3AED',
                  show: columns.some((c) => ['status', 'absent', 'absentDays', 'date'].includes(c.key)),
                },
                {
                  key: 'workingHours',
                  label: 'WORKING HOURS',
                  value: `${Math.round(attendanceExec.grand.workingHours * 10) / 10}h`,
                  subtext: 'Total Logged Hours',
                  icon: <Clock className="w-5 h-5 text-blue-600" />,
                  bg: 'bg-blue-50',
                  accent: '#2563EB',
                  show: columns.some((c) => c.key === 'workingHours'),
                },
                {
                  key: 'attendancePct',
                  label: 'ATTENDANCE SCORE',
                  value: `${attendanceExec.grandPct}%`,
                  subtext: 'Overall Score',
                  icon: <Star className="w-5 h-5 text-indigo-600" />,
                  bg: 'bg-indigo-50',
                  accent: '#4F46E5',
                  show: columns.some((c) => ['status', 'attendancePct'].includes(c.key)),
                },
              ]
                .filter((k) => k.show)
                .map((k) => (
                  <div key={k.label} className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${k.bg}`}>
                      {k.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">{k.label}</div>
                      <div className="text-xl font-black text-slate-900 mt-0.5" style={{ color: k.accent }}>
                        {k.value}
                      </div>
                      <div className="text-[10px] font-medium text-slate-500 truncate mt-0.5">{k.subtext}</div>
                    </div>
                  </div>
                ))}
            </div>

            {/* 2. Key Insights & Department Analytics */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Key Insights (~5 cols) */}
              <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-4.5 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                    Key Insights
                  </div>
                  <ul className="space-y-2.5">
                    {attendanceExec.insights.map((line, i) => {
                      const insightIcons = ['🌐', '⭐', '🔒', '🔄'];
                      return (
                        <li key={i} className="text-xs text-slate-700 flex items-start gap-2.5 bg-slate-50/80 p-2.5 rounded-xl border border-slate-100">
                          <span className="text-sm shrink-0 mt-0.5">{insightIcons[i % insightIcons.length]}</span>
                          <span className="font-medium leading-relaxed">{line}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>

              {/* Attendance by Department (~7 cols) */}
              <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-4.5 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="text-sm font-bold text-slate-900 mb-4">
                    Attendance by Department
                  </div>
                  <div className="space-y-4">
                    {attendanceExec.departments.map((d) => (
                      <div key={d.department}>
                        <div className="flex justify-between text-xs text-slate-700 font-semibold mb-1.5">
                          <span>{d.department}</span>
                          <span className="text-indigo-600 font-bold">{d.pct}%</span>
                        </div>
                        <div className="h-3.5 rounded-full bg-slate-100 overflow-hidden relative border border-slate-200/60">
                          <div
                            className="h-full rounded-full transition-all duration-500 bg-indigo-600"
                            style={{ width: `${Math.max(d.pct, 3)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 pt-2 border-t border-slate-100 flex justify-between text-[10px] font-semibold text-slate-400">
                  <span>0%</span>
                  <span>25%</span>
                  <span>50%</span>
                  <span>75%</span>
                  <span>100%</span>
                </div>
              </div>
            </div>

            {/* 3. Department Summary Table */}
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-2">Department Summary</h3>
              <div className="rounded-xl overflow-hidden border border-slate-200 shadow-xs">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-indigo-600 text-white font-bold text-xs uppercase tracking-wider">
                      <th className="p-3">Department</th>
                      <th className="p-3 text-center">Total Employees</th>
                      {columns.some((c) => ['status', 'present', 'presentDays'].includes(c.key)) && <th className="p-3 text-center">Present</th>}
                      {columns.some((c) => ['status', 'absent', 'absentDays'].includes(c.key)) && <th className="p-3 text-center">Absent</th>}
                      {columns.some((c) => ['status', 'attendancePct'].includes(c.key)) && <th className="p-3 text-center">Attendance %</th>}
                      <th className="p-3 text-center">Trend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {attendanceExec.departments.map((d, i) => (
                      <tr key={d.department} className={i % 2 === 1 ? 'bg-slate-50/60' : ''}>
                        <td className="p-3 font-semibold text-slate-800">{d.department}</td>
                        <td className="p-3 text-center font-medium text-slate-700">{d.employees}</td>
                        {columns.some((c) => ['status', 'present', 'presentDays'].includes(c.key)) && <td className="p-3 text-center text-emerald-600 font-bold">{d.present}</td>}
                        {columns.some((c) => ['status', 'absent', 'absentDays'].includes(c.key)) && <td className="p-3 text-center text-rose-600 font-bold">{d.absent}</td>}
                        {columns.some((c) => ['status', 'attendancePct'].includes(c.key)) && <td className="p-3 text-center font-bold text-indigo-600">{d.pct}%</td>}
                        <td className="p-3 text-center">
                          <svg className="w-16 h-5 mx-auto" viewBox="0 0 60 20">
                            <path d="M 0 5 L 15 15 L 30 8 L 45 18 L 60 12" fill="none" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 4. Employee Summary Table — Dynamic columns strictly driven by `columns` */}
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-2">Employee Summary</h3>
              <div className="rounded-xl overflow-hidden border border-slate-200 shadow-xs">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-indigo-600 text-white font-bold text-xs uppercase tracking-wider">
                      {columns.map((c) => (
                        <th
                          key={c.key}
                          className={`p-3 whitespace-nowrap ${
                            ['present', 'absent', 'leave', 'workingHours', 'attendancePct', 'status', 'lateMins'].includes(c.key) ? 'text-center' : 'text-left'
                          }`}
                        >
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {attendanceExec.empList.map((e, i) => (
                      <tr key={e.key} className={i % 2 === 1 ? 'bg-slate-50/60' : ''}>
                        {columns.map((c) => {
                          const avatarColors = [
                            'bg-rose-500 text-white',
                            'bg-amber-500 text-white',
                            'bg-indigo-500 text-white',
                            'bg-purple-500 text-white',
                            'bg-emerald-500 text-white',
                            'bg-blue-500 text-white',
                            'bg-pink-500 text-white',
                            'bg-teal-500 text-white',
                          ];
                          const colorClass = avatarColors[i % avatarColors.length];

                          if (c.key === 'employeeId') {
                            return <td key={c.key} className="p-3 font-semibold text-slate-700">{e.employeeId}</td>;
                          }
                          if (c.key === 'employeeName') {
                            return (
                              <td key={c.key} className="p-3">
                                <div className="flex items-center gap-2.5">
                                  <span className={`w-7 h-7 rounded-full ${colorClass} flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs`}>
                                    {(e.employeeName || 'E').charAt(0).toUpperCase()}
                                  </span>
                                  <span className="font-semibold text-slate-900">{e.employeeName}</span>
                                </div>
                              </td>
                            );
                          }
                          if (c.key === 'designation') {
                            return <td key={c.key} className="p-3 text-slate-600">{e.designation || 'Employee'}</td>;
                          }
                          if (c.key === 'department') {
                            return <td key={c.key} className="p-3 text-slate-600 font-medium">{e.department}</td>;
                          }
                          if (c.key === 'present' || c.key === 'presentDays') {
                            return <td key={c.key} className="p-3 text-center font-bold text-slate-800">{e.present}</td>;
                          }
                          if (c.key === 'absent' || c.key === 'absentDays') {
                            return <td key={c.key} className="p-3 text-center font-bold text-slate-800">{e.absent}</td>;
                          }
                          if (c.key === 'leave' || c.key === 'leaveDays') {
                            return <td key={c.key} className="p-3 text-center font-bold text-slate-800">{e.leave}</td>;
                          }
                          if (c.key === 'workingHours') {
                            return <td key={c.key} className="p-3 text-center font-medium text-slate-800">{Math.round(e.workingHours * 10) / 10}</td>;
                          }
                          if (c.key === 'attendancePct') {
                            const barColor = e.attendancePct >= 80 ? 'bg-emerald-500' : e.attendancePct >= 40 ? 'bg-amber-500' : 'bg-slate-300';
                            return (
                              <td key={c.key} className="p-3 text-center">
                                <div className="inline-flex items-center gap-2">
                                  <span className="font-bold text-slate-800 text-xs w-8 text-right">{e.attendancePct}%</span>
                                  <div className="w-14 h-2 rounded-full bg-slate-100 overflow-hidden border border-slate-200/60">
                                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.max(e.attendancePct, 4)}%` }} />
                                  </div>
                                </div>
                              </td>
                            );
                          }
                          if (c.key === 'status') {
                            return (
                              <td key={c.key} className="p-3 text-center">
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-600 border border-rose-100">
                                  Needs Attention
                                </span>
                              </td>
                            );
                          }
                          return <td key={c.key} className="p-3 text-slate-700">{renderCell(e, c)}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : layoutId === 'executive' && leaveExec ? (
          <div className="p-4 space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                { label: 'Total Requests', value: leaveExec.grand.applied, icon: '📋' },
                { label: 'Approved', value: leaveExec.grand.approved, icon: '✅', accent: '#059669' },
                { label: 'Pending', value: leaveExec.grand.pending, icon: '⏳', accent: '#d97706' },
                { label: 'Rejected', value: leaveExec.grand.rejected, icon: '❌', accent: '#e11d48' },
                { label: 'Total Days', value: leaveExec.grand.totalDays, icon: '🗓️', accent: theme.accentColor },
              ].map((k) => (
                <div key={k.label} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    <span>{k.icon}</span> {k.label}
                  </div>
                  <div className="text-xl font-extrabold mt-0.5" style={{ color: k.accent || theme.accentColor }}>{k.value}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-1 flex flex-col items-center justify-center rounded-lg border border-slate-100 p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 self-start">Approval Distribution</div>
                <div
                  className="w-28 h-28 rounded-full flex items-center justify-center"
                  style={{
                    background: `conic-gradient(${(() => {
                      const total = leaveExec.distribution.reduce((n, d) => n + d.value, 0) || 1;
                      let acc = 0;
                      return leaveExec.distribution.map((d) => {
                        const start = (acc / total) * 360; acc += d.value; const end = (acc / total) * 360;
                        return `${d.color} ${start}deg ${end}deg`;
                      }).join(', ');
                    })()})`,
                  }}
                >
                  <div className="w-16 h-16 rounded-full bg-white flex flex-col items-center justify-center">
                    <span className="text-[9px] text-slate-400">Total</span>
                    <span className="text-sm font-bold text-slate-800">{leaveExec.distribution.reduce((n, d) => n + d.value, 0)}</span>
                  </div>
                </div>
                <div className="mt-2 space-y-0.5">
                  {leaveExec.distribution.map((d) => (
                    <div key={d.label} className="flex items-center gap-1.5 text-[10px] text-slate-600">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} /> {d.label}
                    </div>
                  ))}
                </div>
              </div>

              <div className="lg:col-span-1 rounded-lg border border-slate-100 p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-3">Leave Type Breakdown</div>
                <div className="space-y-2">
                  {leaveExec.leaveTypes.map((t) => {
                    const maxDays = Math.max(...leaveExec.leaveTypes.map((x) => x.days), 1);
                    return (
                      <div key={t.type}>
                        <div className="flex justify-between text-[10px] text-slate-600 mb-0.5">
                          <span className="font-medium">{t.type}</span>
                          <span className="font-semibold" style={{ color: theme.accentColor }}>{t.days}d ({t.count})</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${(t.days / maxDays) * 100}%`, backgroundColor: theme.accentColor }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="lg:col-span-1 rounded-lg border border-slate-100 p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Key Insights</div>
                <ul className="space-y-1.5">
                  {leaveExec.insights.map((line, i) => (
                    <li key={i} className="text-[11px] text-slate-600 flex items-start gap-1.5">
                      <span className="mt-0.5" style={{ color: theme.accentColor }}>●</span> {line}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Department Summary</div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className={`${theme.tableHeaderBg} ${theme.tableHeaderText} font-semibold uppercase tracking-wider`}>
                    <th className="p-2">Department</th><th className="p-2 text-center">Employees</th><th className="p-2 text-center">Applied</th>
                    <th className="p-2 text-center">Approved</th><th className="p-2 text-center">Total Days</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {leaveExec.departments.map((d, i) => (
                    <tr key={d.department} className={i % 2 === 1 ? 'bg-slate-50/60' : ''}>
                      <td className="p-2 font-medium text-slate-700">{d.department}</td>
                      <td className="p-2 text-center">{d.employees}</td>
                      <td className="p-2 text-center">{d.applied}</td>
                      <td className="p-2 text-center text-emerald-600 font-semibold">{d.approved}</td>
                      <td className="p-2 text-center font-bold" style={{ color: theme.accentColor }}>{d.totalDays}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Employee Summary</div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className={`${theme.tableHeaderBg} ${theme.tableHeaderText} font-semibold uppercase tracking-wider`}>
                    <th className="p-2">Employee ID</th><th className="p-2">Name</th><th className="p-2">Department</th>
                    <th className="p-2 text-center">Applied</th><th className="p-2 text-center">Approved</th><th className="p-2 text-center">Pending</th>
                    <th className="p-2 text-center">Rejected</th><th className="p-2 text-center">Total Days</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...leaveExec.empList].sort((a, b) => a.employeeName.localeCompare(b.employeeName)).map((e, i) => (
                    <tr key={e.key} className={i % 2 === 1 ? 'bg-slate-50/60' : ''}>
                      <td className="p-2">{e.employeeId}</td>
                      <td className="p-2 font-medium" style={{ color: theme.accentColor }}>{e.employeeName}</td>
                      <td className="p-2">{e.department}</td>
                      <td className="p-2 text-center">{e.applied}</td>
                      <td className="p-2 text-center text-emerald-600 font-semibold">{e.approved}</td>
                      <td className="p-2 text-center text-amber-600 font-semibold">{e.pending}</td>
                      <td className="p-2 text-center text-rose-600 font-semibold">{e.rejected}</td>
                      <td className="p-2 text-center font-bold" style={{ color: theme.accentColor }}>{e.totalDays}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : layoutId === 'executive' && payrollExec ? (
          <div className="p-4 space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                { label: 'Employees', value: String(payrollExec.empList.length), icon: '👥' },
                { label: 'Total Gross', value: fmtCurrency(payrollExec.grand.gross), icon: '💰' },
                { label: 'Total Deductions', value: fmtCurrency(payrollExec.grand.deductions), icon: '📉', accent: '#e11d48' },
                { label: 'Total Net Pay', value: fmtCurrency(payrollExec.grand.net), icon: '✅', accent: '#059669' },
                { label: 'Employer PF', value: fmtCurrency(payrollExec.grand.pf), icon: '🏦' },
                { label: 'Employer ESI', value: fmtCurrency(payrollExec.grand.esi), icon: '🏥' },
                { label: 'Tax (TDS)', value: fmtCurrency(payrollExec.grand.tax), icon: '🧾', accent: '#d97706' },
                { label: 'Avg. Net Salary', value: fmtCurrency(payrollExec.avgSalary), icon: '📊', accent: theme.accentColor },
              ].map((k) => (
                <div key={k.label} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    <span>{k.icon}</span> {k.label}
                  </div>
                  <div className="text-lg font-extrabold mt-0.5" style={{ color: k.accent || theme.accentColor }}>{k.value}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-1 flex flex-col items-center justify-center rounded-lg border border-slate-100 p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 self-start">Payroll Distribution</div>
                <div
                  className="w-28 h-28 rounded-full flex items-center justify-center"
                  style={{
                    background: `conic-gradient(${(() => {
                      const total = payrollExec.distribution.reduce((n, d) => n + d.value, 0) || 1;
                      let acc = 0;
                      return payrollExec.distribution.map((d) => {
                        const start = (acc / total) * 360; acc += d.value; const end = (acc / total) * 360;
                        return `${d.color} ${start}deg ${end}deg`;
                      }).join(', ');
                    })()})`,
                  }}
                >
                  <div className="w-16 h-16 rounded-full bg-white flex flex-col items-center justify-center">
                    <span className="text-[9px] text-slate-400">Gross</span>
                    <span className="text-[11px] font-bold text-slate-800">{fmtCurrency(payrollExec.grand.gross)}</span>
                  </div>
                </div>
                <div className="mt-2 space-y-0.5">
                  {payrollExec.distribution.map((d) => (
                    <div key={d.label} className="flex items-center gap-1.5 text-[10px] text-slate-600">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} /> {d.label}
                    </div>
                  ))}
                </div>
              </div>

              <div className="lg:col-span-1 rounded-lg border border-slate-100 p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-3">Payroll by Department</div>
                <div className="space-y-2">
                  {payrollExec.departments.map((d) => {
                    const maxGross = Math.max(...payrollExec.departments.map((x) => x.gross), 1);
                    return (
                      <div key={d.department}>
                        <div className="flex justify-between text-[10px] text-slate-600 mb-0.5">
                          <span className="font-medium">{d.department}</span>
                          <span className="font-semibold" style={{ color: theme.accentColor }}>{fmtCurrency(d.gross)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${(d.gross / maxGross) * 100}%`, backgroundColor: theme.accentColor }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="lg:col-span-1 rounded-lg border border-slate-100 p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Key Insights</div>
                <ul className="space-y-1.5">
                  {payrollExec.insights.map((line, i) => (
                    <li key={i} className="text-[11px] text-slate-600 flex items-start gap-1.5">
                      <span className="mt-0.5" style={{ color: theme.accentColor }}>●</span> {line}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Department Payroll Summary</div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className={`${theme.tableHeaderBg} ${theme.tableHeaderText} font-semibold uppercase tracking-wider`}>
                    <th className="p-2">Department</th><th className="p-2 text-center">Employees</th><th className="p-2 text-center">Gross Pay</th>
                    <th className="p-2 text-center">Deductions</th><th className="p-2 text-center">Net Pay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payrollExec.departments.map((d, i) => (
                    <tr key={d.department} className={i % 2 === 1 ? 'bg-slate-50/60' : ''}>
                      <td className="p-2 font-medium text-slate-700">{d.department}</td>
                      <td className="p-2 text-center">{d.employees}</td>
                      <td className="p-2 text-center">{fmtCurrency(d.gross)}</td>
                      <td className="p-2 text-center text-rose-600 font-semibold">{fmtCurrency(d.deductions)}</td>
                      <td className="p-2 text-center font-bold" style={{ color: theme.accentColor }}>{fmtCurrency(d.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Employee Payroll Summary</div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className={`${theme.tableHeaderBg} ${theme.tableHeaderText} font-semibold uppercase tracking-wider`}>
                    <th className="p-2">Employee ID</th><th className="p-2">Name</th><th className="p-2">Department</th>
                    <th className="p-2 text-center">Gross</th><th className="p-2 text-center">Deductions</th>
                    <th className="p-2 text-center">PF</th><th className="p-2 text-center">ESI</th><th className="p-2 text-center">Tax</th><th className="p-2 text-center">Net Pay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...payrollExec.empList].sort((a, b) => a.employeeName.localeCompare(b.employeeName)).map((e, i) => (
                    <tr key={e.key} className={i % 2 === 1 ? 'bg-slate-50/60' : ''}>
                      <td className="p-2">{e.employeeId}</td>
                      <td className="p-2 font-medium" style={{ color: theme.accentColor }}>{e.employeeName}</td>
                      <td className="p-2">{e.department}</td>
                      <td className="p-2 text-center">{fmtCurrency(e.gross)}</td>
                      <td className="p-2 text-center text-rose-600">{fmtCurrency(e.deductions)}</td>
                      <td className="p-2 text-center">{fmtCurrency(e.pf)}</td>
                      <td className="p-2 text-center">{fmtCurrency(e.esi)}</td>
                      <td className="p-2 text-center">{fmtCurrency(e.tax)}</td>
                      <td className="p-2 text-center font-bold" style={{ color: theme.accentColor }}>{fmtCurrency(e.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : layoutId === 'executive' && consolidatedExec ? (
          <div className="p-4 space-y-6">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Overall Summary (All Departments)</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {[
                  { label: 'Total Employees', value: String(consolidatedExec.employeeCount), icon: '👥', show: true },
                  { label: 'Avg. Attendance %', value: consolidatedExec.avgAttendancePct !== null ? `${consolidatedExec.avgAttendancePct}%` : 'N/A', icon: '✅', accent: '#059669', show: showAttCols },
                  { label: 'Leave Taken', value: String(consolidatedExec.totalLeaveTaken), icon: '🌴', accent: '#8b5cf6', show: showLeaveCols },
                  { label: 'Gross Pay', value: fmtCurrency(consolidatedExec.totalGross), icon: '💰', show: showPayrollCols },
                  { label: 'Net Pay', value: fmtCurrency(consolidatedExec.totalNet), icon: '✅', accent: '#059669', show: showPayrollCols },
                ].filter((k) => k.show).map((k) => (
                  <div key={k.label} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                      <span>{k.icon}</span> {k.label}
                    </div>
                    <div className="text-lg font-extrabold mt-0.5" style={{ color: k.accent || theme.accentColor }}>{k.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {showAttCols && (
                <div className="rounded-lg border border-slate-100 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Attendance Summary</div>
                  <div className="text-xs text-slate-600 space-y-1">
                    <div className="flex justify-between"><span>Avg. Attendance %</span><b style={{ color: theme.accentColor }}>{consolidatedExec.avgAttendancePct ?? 'N/A'}%</b></div>
                  </div>
                </div>
              )}
              {showLeaveCols && (
                <div className="rounded-lg border border-slate-100 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Leave Summary</div>
                  <div className="text-xs text-slate-600 space-y-1">
                    <div className="flex justify-between"><span>Leave Taken</span><b style={{ color: theme.accentColor }}>{consolidatedExec.totalLeaveTaken}</b></div>
                  </div>
                </div>
              )}
              {showPayrollCols && (
                <div className="rounded-lg border border-slate-100 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Payroll Summary</div>
                  <div className="text-xs text-slate-600 space-y-1">
                    <div className="flex justify-between"><span>Gross Pay</span><b>{fmtCurrency(consolidatedExec.totalGross)}</b></div>
                    <div className="flex justify-between"><span>Deductions</span><b className="text-rose-600">{fmtCurrency(consolidatedExec.totalDeductions)}</b></div>
                    <div className="flex justify-between"><span>Net Pay</span><b style={{ color: theme.accentColor }}>{fmtCurrency(consolidatedExec.totalNet)}</b></div>
                  </div>
                </div>
              )}
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Department-Wise Consolidated Metrics</div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className={`${theme.tableHeaderBg} ${theme.tableHeaderText} font-semibold uppercase tracking-wider`}>
                    <th className="p-2">Department</th><th className="p-2 text-center">Employees</th>
                    {showAttCols && <th className="p-2 text-center">Present Days</th>}
                    {showLeaveCols && <th className="p-2 text-center">Leave Taken</th>}
                    {showPayrollCols && <th className="p-2 text-center">Gross Pay</th>}
                    {showPayrollCols && <th className="p-2 text-center">Net Pay</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {consolidatedExec.departments.map((d, i) => (
                    <tr key={d.department} className={i % 2 === 1 ? 'bg-slate-50/60' : ''}>
                      <td className="p-2 font-medium text-slate-700">{d.department}</td>
                      <td className="p-2 text-center">{d.employees}</td>
                      {showAttCols && <td className="p-2 text-center">{d.present}</td>}
                      {showLeaveCols && <td className="p-2 text-center">{d.leaveTaken}</td>}
                      {showPayrollCols && <td className="p-2 text-center">{fmtCurrency(d.gross)}</td>}
                      {showPayrollCols && <td className="p-2 text-center font-bold" style={{ color: theme.accentColor }}>{fmtCurrency(d.net)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Employee-Level Consolidated Summary</div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className={`${theme.tableHeaderBg} ${theme.tableHeaderText} font-semibold uppercase tracking-wider`}>
                    {columns.map((c) => <th key={c.key} className="p-2 whitespace-nowrap">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...rows].sort((a, b) => String(a.employeeName).localeCompare(String(b.employeeName))).slice(0, 50).map((row, i) => (
                    <tr key={row.id ?? i} className={i % 2 === 1 ? 'bg-slate-50/60' : ''}>
                      {columns.map((c) => <td key={c.key} className="p-2 text-slate-700">{renderCell(row, c)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 50 && (
                <div className="p-2 text-center text-[11px] text-slate-400 border-t border-slate-100">Showing first 50 of {rows.length} — the exported file includes all records.</div>
              )}
            </div>
          </div>
        ) : layoutId === 'employee_summary' && attendanceExec ? (
          // What HR actually downloads most: one row per employee, no KPI
          // cards, no department grouping — just the numbers, flat and
          // sortable. Distinct from Executive Summary (which leads with
          // charts/insights for a CEO-level 10-second read) and from the
          // Weekly Grid/Register (full daily detail for auditors).
          (() => {
            const showLate = columns.some((c) => c.key === 'lateMins');
            const showHrs = columns.some((c) => c.key === 'workingHours');
            const showStatusCols = columns.some((c) => c.key === 'status');
            return (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className={`${theme.tableHeaderBg} ${theme.tableHeaderText} font-semibold uppercase tracking-wider`}>
                <th className="p-2">#</th><th className="p-2">Employee ID</th><th className="p-2">Employee Name</th><th className="p-2">Department</th>
                {showStatusCols && <><th className="p-2 text-center">Attendance %</th><th className="p-2 text-center">Present</th><th className="p-2 text-center">Absent</th><th className="p-2 text-center">Leave</th></>}
                {showLate && <th className="p-2 text-center">Late</th>}
                {showHrs && <th className="p-2 text-center">Working Hours</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...attendanceExec.empList].sort((a, b) => a.employeeName.localeCompare(b.employeeName)).map((e, i) => (
                <tr key={e.key} className={i % 2 === 1 ? 'bg-slate-50/60' : ''}>
                  <td className="p-2">{i + 1}</td><td className="p-2">{e.employeeId}</td>
                  <td className="p-2 font-medium" style={{ color: theme.accentColor }}>{e.employeeName}</td>
                  <td className="p-2">{e.department}</td>
                  {showStatusCols && (
                    <>
                      <td className="p-2 text-center font-bold" style={{ color: theme.accentColor }}>{e.attendancePct}%</td>
                      <td className="p-2 text-center text-emerald-600 font-semibold">{e.present}</td>
                      <td className="p-2 text-center text-rose-600 font-semibold">{e.absent}</td>
                      <td className="p-2 text-center text-blue-600 font-semibold">{e.leave}</td>
                    </>
                  )}
                  {showLate && <td className="p-2 text-center text-amber-600 font-semibold">{e.late}</td>}
                  {showHrs && <td className="p-2 text-center">{Math.round(e.workingHours * 10) / 10}h</td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold bg-slate-50 border-t-2 border-slate-200">
                <td className="p-2" colSpan={4}>TOTAL</td>
                {showStatusCols && (
                  <>
                    <td className="p-2 text-center">{attendanceExec.grandPct}%</td>
                    <td className="p-2 text-center">{attendanceExec.grand.present}</td>
                    <td className="p-2 text-center">{attendanceExec.grand.absent}</td>
                    <td className="p-2 text-center">{attendanceExec.grand.leave}</td>
                  </>
                )}
                {showLate && <td className="p-2 text-center">{attendanceExec.grand.late}</td>}
                {showHrs && <td className="p-2 text-center">{Math.round(attendanceExec.grand.workingHours * 10) / 10}h</td>}
              </tr>
            </tfoot>
          </table>
            );
          })()
        ) : layoutId === 'weekly_grid' && weeklyGrid ? (
          (() => {
            const showStatusCols = columns.some((c) => c.key === 'status' || c.key === 'presentDays');
            const showLateCol = columns.some((c) => c.key === 'lateMins' || c.key === 'lateCount');
            const showHrsCol = columns.some((c) => c.key === 'workingHours');
            return (
              <table className="w-full text-left border-collapse text-[11px]">
                <thead>
                  <tr className={`${theme.tableHeaderBg} ${theme.tableHeaderText} font-semibold uppercase tracking-wider`}>
                    <th className="p-2 whitespace-nowrap">#</th>
                    <th className="p-2 whitespace-nowrap">Employee ID</th>
                    <th className="p-2 whitespace-nowrap">Employee Name</th>
                    <th className="p-2 whitespace-nowrap">Department</th>
                    {weeklyGrid.dates.map((d) => (
                      <th key={d} className="p-2 text-center whitespace-nowrap">
                        {new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: '2-digit' })}
                      </th>
                    ))}
                    {showStatusCols && <th className="p-2 text-center whitespace-nowrap">Present<br />(Days)</th>}
                    {showStatusCols && <th className="p-2 text-center whitespace-nowrap">Absent<br />(Days)</th>}
                    {showLateCol && <th className="p-2 text-center whitespace-nowrap">Late<br />(Days)</th>}
                    {showStatusCols && <th className="p-2 text-center whitespace-nowrap">Leave<br />(Days)</th>}
                    {showHrsCol && <th className="p-2 text-center whitespace-nowrap">Working<br />Hours</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {weeklyGrid.employees.map((e, i) => (
                    <tr key={e.key} className={i % 2 === 1 ? 'bg-slate-50/60' : ''}>
                      <td className="p-2 text-slate-500">{i + 1}</td>
                      <td className="p-2 font-medium text-slate-700">{e.employeeId}</td>
                      <td className="p-2 font-medium" style={{ color: theme.accentColor }}>{e.employeeName}</td>
                      <td className="p-2 text-slate-600">{e.department}</td>
                      {weeklyGrid.dates.map((d) => {
                        const r = weeklyGrid.cellMap.get(`${e.key}|${d}`);
                        if (!r) return <td key={d} className="p-2 text-center text-slate-400 font-semibold">WO</td>;
                        const s = weeklyGridStatusIcon(r.status);
                        return <td key={d} className={`p-2 text-center ${s.cls}`} title={s.label}>{s.icon}</td>;
                      })}
                      {showStatusCols && <td className="p-2 text-center text-slate-700">{e.present}</td>}
                      {showStatusCols && <td className="p-2 text-center text-slate-700">{e.absent}</td>}
                      {showLateCol && <td className="p-2 text-center text-slate-700">{e.late}</td>}
                      {showStatusCols && <td className="p-2 text-center text-slate-700">{e.leave}</td>}
                      {showHrsCol && <td className="p-2 text-center text-slate-700">{Math.round(e.workingHours * 10) / 10}h</td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold bg-emerald-50/60 border-t-2 border-emerald-100">
                    <td className="p-2" colSpan={4}>TOTAL</td>
                    {weeklyGrid.totals.map((t, i) => <td key={i} className="p-2 text-center text-slate-700">{t}</td>)}
                    {showStatusCols && <td className="p-2 text-center text-slate-700">{weeklyGrid.grand.present}</td>}
                    {showStatusCols && <td className="p-2 text-center text-slate-700">{weeklyGrid.grand.absent}</td>}
                    {showLateCol && <td className="p-2 text-center text-slate-700">{weeklyGrid.grand.late}</td>}
                    {showStatusCols && <td className="p-2 text-center text-slate-700">{weeklyGrid.grand.leave}</td>}
                    {showHrsCol && <td className="p-2 text-center text-slate-700">{Math.round(weeklyGrid.grand.workingHours * 10) / 10}h</td>}
                  </tr>
                </tfoot>
              </table>
            );
          })()
        ) : layoutId === 'detailed' && isAttendanceShaped ? (
          // Attendance Register: one section per employee (name/department/
          // designation header, then their own date-by-date rows, then a
          // per-employee summary) — never the employee's name repeated on
          // every single day-row. That flat repetition was the exact
          // "looks like raw database data" complaint this fixes.
          (() => {
            const dateCol = columns.filter((c) => c.key !== 'employeeName' && c.key !== 'department' && c.key !== 'designation');
            const byEmployee = new Map<string, { employeeId: any; employeeName: string; department: string; designation?: string; empRows: any[] }>();
            for (const row of rows) {
              const key = String(row.employeeId ?? row.employeeName ?? '?');
              if (!byEmployee.has(key)) byEmployee.set(key, { employeeId: row.employeeId, employeeName: row.employeeName || 'Employee', department: row.department, designation: row.designation, empRows: [] });
              byEmployee.get(key)!.empRows.push(row);
            }
            const employeeGroups = Array.from(byEmployee.values()).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
            return (
              <div className="p-4 space-y-5">
                {employeeGroups.map((g) => {
                  const present = g.empRows.filter((r) => (r.status || '').toLowerCase().includes('present')).length;
                  const absent = g.empRows.filter((r) => (r.status || '').toLowerCase().includes('absent')).length;
                  const leave = g.empRows.filter((r) => (r.status || '').toLowerCase().includes('leave')).length;
                  const late = g.empRows.filter((r) => (r.status || '').toLowerCase().includes('late')).length;
                  const hours = g.empRows.reduce((n, r) => n + (Number(r.workingHours) || 0), 0);
                  return (
                    <div key={g.employeeId ?? g.employeeName} className="rounded-lg border border-slate-200 overflow-hidden">
                      <div className="px-3 py-2" style={{ backgroundColor: theme.accentColor }}>
                        <div className="text-white font-bold text-sm">{g.employeeName}</div>
                        <div className="text-white/80 text-[10px]">{g.department}{g.designation ? ` · ${g.designation}` : ''}{g.employeeId ? ` · ID ${g.employeeId}` : ''}</div>
                      </div>
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-slate-500 uppercase text-[10px]">
                            {dateCol.map((c) => <th key={c.key} className="p-1.5">{c.label}</th>)}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {g.empRows.map((row, i) => (
                            <tr key={row.id ?? i} className={i % 2 === 1 ? 'bg-slate-50/60' : ''}>
                              {dateCol.map((c) => <td key={c.key} className="p-1.5 text-slate-700">{renderCell(row, c)}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="px-3 py-2 bg-slate-50 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                        <span>Present: <b className="text-emerald-600">{present}</b></span>
                        <span>Absent: <b className="text-rose-600">{absent}</b></span>
                        <span>Leave: <b className="text-blue-600">{leave}</b></span>
                        <span>Late: <b className="text-amber-600">{late}</b></span>
                        <span>Working Hours: <b>{Math.round(hours * 10) / 10}h</b></span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()
        ) : layoutId === 'detailed' ? (
          <div className="p-4 space-y-3">
            {previewRows.map((row, i) => (
              <div key={row.id ?? i} className="rounded-lg border border-slate-200 p-3">
                <div className="font-bold text-sm text-slate-900 mb-2">{row.employeeName || `Record ${i + 1}`}</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                  {columns.filter((c) => c.key !== 'employeeName').map((c) => (
                    <div key={c.key}>
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">{c.label}</span>
                      <span className="text-xs text-slate-700">{renderCell(row, c)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : layoutId === 'register' ? (
          <div>
            {Array.from(new Set(previewRows.map((r) => r[groupKey] || 'Other'))).map((groupVal) => {
              const groupRows = previewRows.filter((r) => (r[groupKey] || 'Other') === groupVal);
              const groupLabel = groupKey === 'leaveType' ? 'Leave Type' : 'Department';
              return (
                <div key={groupVal}>
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white flex items-center justify-between" style={{ backgroundColor: theme.accentColor }}>
                    <span>{groupLabel}: {groupVal}</span>
                    <span className="opacity-80 normal-case font-medium">{groupRows.length} record{groupRows.length === 1 ? '' : 's'}</span>
                  </div>
                  {dataTable(groupRows)}
                </div>
              );
            })}
          </div>
        ) : (
          dataTable(previewRows, layoutId === 'compact')
        )}
        {rows.length > 50 && (
          <div className="p-2 text-center text-[11px] text-slate-400 border-t border-slate-100">Showing first 50 of {rows.length} — the exported file includes all records.</div>
        )}
      </div>

      {showDepartmentTotals && layoutId !== 'compact' && rows.length > 0 && (() => {
        const { numericCols, groups } = computeDepartmentTotals(rows, columns);
        if (numericCols.length === 0 || groups.length <= 1) return null;
        return (
          <div className="border-t border-slate-100 relative" style={{ zIndex: 2 }}>
            <div className="px-5 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Department Totals</div>
            <table className="w-full text-left border-collapse text-xs mb-2">
              <thead>
                <tr className="text-slate-400 text-[10px] uppercase tracking-wider">
                  <th className="px-5 py-1 font-semibold">Department</th>
                  <th className="px-2 py-1 font-semibold">Count</th>
                  {numericCols.map((c) => <th key={c.key} className="px-2 py-1 font-semibold">{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.department} className="border-t border-slate-50">
                    <td className="px-5 py-1 text-slate-700">{g.department}</td>
                    <td className="px-2 py-1 text-slate-700">{g.count}</td>
                    {numericCols.map((c) => <td key={c.key} className="px-2 py-1 text-slate-700">{formatSummary(Math.round(g.sums[c.key] * 10) / 10, c.format as SummaryFormat)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {layoutId === 'weekly_grid' && (
        <div className="px-5 py-2.5 border-t border-slate-100 relative flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[10px] text-slate-500" style={{ zIndex: 2 }}>
          <span className="flex items-center gap-1"><span className="text-emerald-600">✅</span> Present</span>
          <span className="flex items-center gap-1"><span className="text-amber-500">⏰</span> Late</span>
          <span className="flex items-center gap-1"><span className="text-rose-500">❌</span> Absent</span>
          <span className="flex items-center gap-1"><span className="text-blue-500">🔵</span> On Leave</span>
          <span className="flex items-center gap-1"><span className="text-slate-500 font-semibold">WO</span> Weekly Off</span>
          <span className="flex items-center gap-1"><span className="text-slate-300 font-semibold">–</span> Not Applicable</span>
        </div>
      )}

      {layoutId === 'weekly_grid' && (
        <div className="px-5 py-3 border-t border-slate-100 relative grid grid-cols-1 sm:grid-cols-3 gap-4 items-start" style={{ zIndex: 2 }}>
          <div>
            <div className="text-[11px] text-slate-600">Prepared by</div>
            <div className="text-xs font-semibold text-slate-800 mt-3 pt-1 border-t border-slate-300 w-32">HR Admin</div>
          </div>
          <div>
            <div className="text-[11px] text-slate-600">Approved by</div>
            <div className="text-xs font-semibold text-slate-800 mt-3 pt-1 border-t border-slate-300 w-32">HR Manager</div>
          </div>
          <div className="text-[10px] text-slate-500">
            <span className="font-semibold text-slate-600">Notes:</span>
            <ul className="list-disc list-inside mt-0.5 space-y-0.5">
              <li>Working hours include regular + overtime.</li>
              <li>This report is system generated and does not require signature.</li>
            </ul>
          </div>
        </div>
      )}

      {/* Bottom Footer matching user design */}
      <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 relative" style={{ zIndex: 2 }}>
        {/* Left Signature */}
        <div className="flex items-center gap-3">
          <div className="font-serif italic text-lg font-bold text-indigo-950 border-b border-slate-300 pb-0.5">
            {meta.signatureLine || 'Ana R.'}
          </div>
          <div className="text-[11px] text-slate-500">
            <span className="block font-semibold text-slate-700">Report Generated By</span>
            <span>{meta.tenantName || 'Smart Teams EMS'}</span>
          </div>
        </div>

        {/* Center Report ID & Date */}
        <div className="flex items-center gap-2 text-[11px] text-slate-600 bg-white px-3 py-1.5 rounded-full border border-slate-200 shadow-2xs">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <div>
            <span className="font-semibold text-slate-800">Report ID:</span> STR-ATT-2026-0807-001
            <span className="mx-1.5 text-slate-300">•</span>
            <span className="text-slate-500">Generated on: {meta.generatedAt ? meta.generatedAt.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '07 Aug 2026'} 10:30 AM</span>
          </div>
        </div>

        {/* Right Page Ribbon */}
        <div className="bg-indigo-600 text-white font-bold text-xs px-4 py-1.5 rounded-l-full shadow-xs">
          Page 1 of 2
        </div>
      </div>
    </div>
  );
};

export default ReportPreview;
