import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

// Real PDF/Excel exporters for the Reports & Analytics module. Previously
// these rendered raw row/summary object keys verbatim (e.g. "totalGross",
// "monthYear") — this file now takes an explicit label map for both the
// table columns and the summary fields (the same shape the wizard's
// REPORT_TYPE_CONFIG already produces client-side), applies the selected
// theme's colors, and lays out a branded header/footer so the exported file
// reads as a company report, not a database dump. A scheduled delivery, an
// on-demand download, and an emailed export all go through this same
// builder, so they never disagree.

export interface ReportColumnMeta {
  key: string;
  label: string;
  format?: 'hours' | 'currency' | 'boolean';
}

export interface ReportSummaryFieldMeta {
  key: string;
  label: string;
  format?: 'hours' | 'currency' | 'percentage';
}

export interface ReportExportMeta {
  title: string;
  tenantName: string;
  tenantAddress?: string | null;
  logoUrl?: string | null;
  generatedByName: string;
  generatedByEmail: string;
  generatedAt: Date;
  timezone: string;
  filtersDescription: string; // human-readable summary, e.g. "Jul 1 - Jul 30, 2026 · Department: Sales"
  filterChips?: { label: string; value: string }[]; // e.g. [{label:'Department',value:'All'}] — rendered as a chip row (Weekly Grid layout only)
  themeId?: string;
  layoutId?: string; // 'standard' | 'executive'
  signatureLine?: string | null;
  showWatermark?: boolean;
  pageSize?: 'A4' | 'Letter';
  orientation?: 'auto' | 'portrait' | 'landscape';
}

interface ThemeColors {
  headerHex: string;
  accentHex: string;
  tableHeaderHex: string;
  watermark: string;
}

// Mirrors apps/admin/src/components/reports/reportMetadata.ts's
// ENHANCED_REPORT_THEMES by id — kept as plain hex constants here rather
// than a shared import, since the frontend file isn't part of the API
// build and five colors per theme isn't worth a shared package.
const THEME_COLORS: Record<string, ThemeColors> = {
  executive_indigo: { headerHex: '#3730a3', accentHex: '#4f46e5', tableHeaderHex: '#4f46e5', watermark: 'CONFIDENTIAL EXECUTIVE BRIEF' },
  clean_slate: { headerHex: '#0f172a', accentHex: '#0f172a', tableHeaderHex: '#334155', watermark: 'INTERNAL HR AUDIT' },
  emerald_finance: { headerHex: '#065f46', accentHex: '#059669', tableHeaderHex: '#059669', watermark: 'APPROVED PAYROLL DOCUMENT' },
  amber_amber: { headerHex: '#78350f', accentHex: '#d97706', tableHeaderHex: '#d97706', watermark: 'OPERATIONAL REPORT' },
  rose_compliance: { headerHex: '#881337', accentHex: '#e11d48', tableHeaderHex: '#e11d48', watermark: 'STRICTLY CONFIDENTIAL SECURITY AUDIT' },
};

function resolveTheme(themeId?: string): ThemeColors {
  return THEME_COLORS[themeId || ''] || THEME_COLORS.executive_indigo;
}

function formatValue(val: any, format?: 'hours' | 'currency' | 'boolean' | 'percentage'): string {
  if (val === undefined || val === null || val === '') return 'N/A';
  if (format === 'boolean') return val ? 'Yes' : 'No';
  if (format === 'hours') return `${val} hrs`;
  if (format === 'currency') return `$${Number(val).toLocaleString()}`;
  if (format === 'percentage') return `${val}%`;
  return String(val);
}

// Mirrors formatValue.ts's statusBadgeStyle (dot color only — pdfkit has no
// cheap equivalent to an HTML rounded pill, so the PDF renders the same
// status as bold colored text instead of a badge shape).
const STATUS_COLORS: Record<string, string> = {
  present: '#059669', approved: '#059669',
  absent: '#e11d48', 'absent (lop)': '#e11d48', rejected: '#e11d48',
  late: '#d97706', pending: '#d97706', 'half day': '#d97706',
  'on leave (paid)': '#9333ea', 'on leave (unpaid)': '#9333ea',
  wfh: '#2563eb',
};
function statusColor(val: string): string | null {
  return STATUS_COLORS[String(val || '').toLowerCase().trim()] || null;
}

async function fetchLogoBuffer(url?: string | null): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch {
    return null; // a broken/unreachable logo URL never blocks the export — header just falls back to text
  }
}

export async function buildReportExcel(
  rows: any[],
  summary: Record<string, any>,
  meta: ReportExportMeta,
  columns: ReportColumnMeta[],
  summaryFields: ReportSummaryFieldMeta[],
): Promise<Buffer> {
  const theme = resolveTheme(meta.themeId);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = meta.generatedByName || meta.generatedByEmail;
  workbook.created = meta.generatedAt;

  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [{ width: 28 }, { width: 40 }];

  const logoBuffer = await fetchLogoBuffer(meta.logoUrl);
  let titleRowIndex = 1;
  if (logoBuffer) {
    const imageId = workbook.addImage({ buffer: logoBuffer as any, extension: 'png' });
    summarySheet.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: 120, height: 40 } });
    summarySheet.addRow([]);
    summarySheet.addRow([]);
    titleRowIndex = 3;
  }
  const titleRow = summarySheet.addRow([meta.title]);
  titleRow.font = { bold: true, size: 14, color: { argb: theme.accentHex.replace('#', 'FF') } };
  summarySheet.addRow([meta.tenantName]);
  if (meta.tenantAddress) summarySheet.addRow([meta.tenantAddress]);
  summarySheet.addRow([`Generated by ${meta.generatedByName || meta.generatedByEmail} on ${meta.generatedAt.toLocaleString()} (${meta.timezone})`]);
  summarySheet.addRow([`Filters: ${meta.filtersDescription}`]);
  summarySheet.addRow([]);
  const summaryHeaderRow = summarySheet.addRow(['Metric', 'Value']);
  summaryHeaderRow.font = { bold: true };
  summaryHeaderRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.tableHeaderHex.replace('#', 'FF') } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  });
  for (const field of summaryFields) {
    summarySheet.addRow([field.label, formatValue(summary?.[field.key], field.format)]);
  }
  if (meta.signatureLine) {
    summarySheet.addRow([]);
    summarySheet.addRow([meta.signatureLine]);
  }

  const dataSheet = workbook.addWorksheet('Data');
  if (rows.length > 0 && columns.length > 0) {
    dataSheet.columns = columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, Math.min(30, c.label.length + 4)) }));
    const headerRow = dataSheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.tableHeaderHex.replace('#', 'FF') } };
    });
    for (const row of rows) {
      const formatted: Record<string, any> = {};
      for (const c of columns) formatted[c.key] = c.format ? formatValue(row[c.key], c.format) : (row[c.key] ?? '-');
      dataSheet.addRow(formatted);
    }
  } else {
    dataSheet.addRow(['No data for the selected filters.']);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

const PAGE_MARGIN = 40;
const ROW_HEIGHT = 16;
const HEADER_BAND_HEIGHT = 64;

// Text-code equivalent of the HTML preview's emoji status icons — pdfkit
// has no cheap way to render colored emoji glyphs consistently across
// platforms, so the PDF uses short color-coded codes (P/L/A/LV) instead.
// WO ("no row for this date") is the same approximation the preview makes:
// resolveMonthStatuses already drops 'future'/'not_applicable' days before
// they reach the report row set, so a missing cell reads as Weekly Off.
function weeklyGridCode(status?: string): { code: string; hex: string } {
  const s = (status || '').toLowerCase();
  if (s.includes('half')) return { code: 'H', hex: '#d97706' };
  if (s.includes('late')) return { code: 'L', hex: '#d97706' };
  if (s.includes('leave')) return { code: 'LV', hex: '#2563eb' };
  if (s.includes('absent')) return { code: 'A', hex: '#e11d48' };
  if (s.includes('present') || s.includes('wfh')) return { code: 'P', hex: '#059669' };
  return { code: '-', hex: '#94a3b8' };
}

function drawWeeklyGridTable(doc: any, rows: any[], columns: ReportColumnMeta[], pageWidth: number, marginLeft: number, theme: { tableHeaderHex: string; accentHex: string }) {
  const employees = new Map<string, { employeeId: string | number; employeeName: string; department: string }>();
  const dateSet = new Set<string>();
  const cellMap = new Map<string, any>();
  for (const row of rows) {
    const key = String(row.employeeId ?? row.employeeName ?? '?');
    if (!employees.has(key)) employees.set(key, { employeeId: row.employeeId ?? '-', employeeName: row.employeeName || 'Employee', department: row.department || 'General' });
    if (row.date) { dateSet.add(row.date); cellMap.set(`${key}|${row.date}`, row); }
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
      workingHours += r.rawHours ?? (Number(r.workingHours) || 0);
    }
    return { key, ...v, present, absent, late, leave, workingHours };
  });

  const showStatus = columns.some((c) => c.key === 'status' || c.key === 'presentDays');
  const showLate = columns.some((c) => c.key === 'lateMins' || c.key === 'lateCount');
  const showHrs = columns.some((c) => c.key === 'workingHours');

  const fixedCols = [
    { label: '#', w: 20 }, { label: 'ID', w: 44 }, { label: 'Name', w: 90 }, { label: 'Dept', w: 70 },
  ];
  const summaryCols: { key: string; label: string; w: number }[] = [];
  if (showStatus) {
    summaryCols.push({ key: 'present', label: 'Pres', w: 32 });
    summaryCols.push({ key: 'absent', label: 'Abs', w: 32 });
  }
  if (showLate) {
    summaryCols.push({ key: 'late', label: 'Late', w: 32 });
  }
  if (showStatus) {
    summaryCols.push({ key: 'leave', label: 'Lv', w: 28 });
  }
  if (showHrs) {
    summaryCols.push({ key: 'workingHours', label: 'Hrs', w: 34 });
  }

  const fixedW = fixedCols.reduce((n, c) => n + c.w, 0) + summaryCols.reduce((n, c) => n + c.w, 0);
  const dateColW = Math.max(20, (pageWidth - fixedW) / Math.max(dates.length, 1));

  const headerRow = (y: number) => {
    doc.rect(marginLeft, y, pageWidth, ROW_HEIGHT).fill(theme.tableHeaderHex);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(6.5);
    let x = marginLeft;
    for (const c of fixedCols) { doc.text(c.label, x + 2, y + 4, { width: c.w - 4, ellipsis: true }); x += c.w; }
    for (const d of dates) { doc.text(new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }), x + 1, y + 4, { width: dateColW - 2, align: 'center', ellipsis: true }); x += dateColW; }
    for (const c of summaryCols) { doc.text(c.label, x + 1, y + 4, { width: c.w - 2, align: 'center', ellipsis: true }); x += c.w; }
  };

  let y = doc.y;
  headerRow(y);
  y += ROW_HEIGHT;
  doc.font('Helvetica').fontSize(6.5);

  empList.forEach((e, i) => {
    if (y + ROW_HEIGHT > doc.page.height - PAGE_MARGIN - 60) {
      doc.addPage();
      y = PAGE_MARGIN;
      headerRow(y);
      y += ROW_HEIGHT;
      doc.font('Helvetica').fontSize(6.5);
    }
    if (i % 2 === 1) doc.rect(marginLeft, y, pageWidth, ROW_HEIGHT).fill('#f8fafc');
    let x = marginLeft;
    doc.fillColor('#334155');
    doc.text(String(i + 1), x + 2, y + 4, { width: fixedCols[0].w - 4 }); x += fixedCols[0].w;
    doc.text(String(e.employeeId), x + 2, y + 4, { width: fixedCols[1].w - 4, ellipsis: true }); x += fixedCols[1].w;
    doc.text(e.employeeName, x + 2, y + 4, { width: fixedCols[2].w - 4, ellipsis: true }); x += fixedCols[2].w;
    doc.text(e.department, x + 2, y + 4, { width: fixedCols[3].w - 4, ellipsis: true }); x += fixedCols[3].w;
    for (const d of dates) {
      const r = cellMap.get(`${e.key}|${d}`);
      const { code, hex } = r ? weeklyGridCode(r.status) : { code: 'WO', hex: '#94a3b8' };
      doc.fillColor(hex).font('Helvetica-Bold').text(code, x + 1, y + 4, { width: dateColW - 2, align: 'center' });
      doc.font('Helvetica');
      x += dateColW;
    }
    doc.fillColor('#334155');
    for (const sc of summaryCols) {
      const val = sc.key === 'workingHours' ? `${Math.round(e.workingHours * 10) / 10}h` : String((e as any)[sc.key]);
      doc.text(val, x + 1, y + 4, { width: sc.w - 2, align: 'center' });
      x += sc.w;
    }
    y += ROW_HEIGHT;
  });

  // TOTAL row
  const grand = empList.reduce((acc, e) => ({
    present: acc.present + e.present, absent: acc.absent + e.absent, late: acc.late + e.late, leave: acc.leave + e.leave, workingHours: acc.workingHours + e.workingHours,
  }), { present: 0, absent: 0, late: 0, leave: 0, workingHours: 0 });
  doc.rect(marginLeft, y, pageWidth, ROW_HEIGHT).fill('#ecfdf5');
  doc.fillColor('#065f46').font('Helvetica-Bold').fontSize(7);
  let x = marginLeft;
  doc.text('TOTAL', x + 2, y + 4, { width: fixedCols[0].w + fixedCols[1].w + fixedCols[2].w + fixedCols[3].w - 4 });
  x += fixedCols[0].w + fixedCols[1].w + fixedCols[2].w + fixedCols[3].w;
  for (const d of dates) {
    const dayPresent = empList.reduce((n, e) => (cellMap.get(`${e.key}|${d}`) && !(cellMap.get(`${e.key}|${d}`).status || '').toLowerCase().includes('absent') ? n + 1 : n), 0);
    doc.text(String(dayPresent), x + 1, y + 4, { width: dateColW - 2, align: 'center' });
    x += dateColW;
  }
  for (const sc of summaryCols) {
    const val = sc.key === 'workingHours' ? `${Math.round(grand.workingHours * 10) / 10}h` : String((grand as any)[sc.key]);
    doc.text(val, x + 1, y + 4, { width: sc.w - 2, align: 'center' });
    x += sc.w;
  }
  doc.y = y + ROW_HEIGHT + 6;
  doc.x = marginLeft;
}

// Attendance-percentage → status badge — same three tiers as
// attendanceStatusBadge in ReportPreview.tsx, rendered as colored text
// since pdfkit has no cheap pill/chip primitive.
function attendanceStatusBadgeHex(pct: number): { label: string; hex: string } {
  if (pct >= 95) return { label: 'Excellent', hex: '#059669' };
  if (pct >= 80) return { label: 'Good', hex: '#d97706' };
  return { label: 'Needs Attention', hex: '#e11d48' };
}

// Mirrors ReportPreview.tsx's attendanceExec computation and section order
// exactly — insights and department analytics BEFORE the detailed employee
// table, employees grouped by department, only summary columns (no daily
// grid — that's the separate Weekly Grid/Attendance Register layout) — so
// the PDF reads as the same document the Designer screen showed, not a
// data dump. This layout intentionally does not try to fit every row on
// one page; it lets pdfkit paginate naturally per department.
function drawAttendanceExecutiveSummary(doc: any, rows: any[], columns: ReportColumnMeta[], pageWidth: number, marginLeft: number, theme: { tableHeaderHex: string; accentHex: string }) {
  const employees = new Map<string, { employeeId: string | number; employeeName: string; department: string; designation?: string }>();
  for (const row of rows) {
    const key = String(row.employeeId ?? row.employeeName ?? '?');
    if (!employees.has(key)) employees.set(key, { employeeId: row.employeeId ?? '-', employeeName: row.employeeName || 'Employee', department: row.department || 'General', designation: row.designation });
  }
  const empList = Array.from(employees.entries()).map(([key, v]) => {
    const empRows = rows.filter((r) => String(r.employeeId ?? r.employeeName ?? '?') === key);
    let present = 0, absent = 0, late = 0, halfDay = 0, leave = 0, workingHours = 0, overtimeHours = 0;
    const hasAggregated = empRows.some((r) => r.presentDays !== undefined || r.hoursLogged !== undefined || r.attendancePct !== undefined);

    if (hasAggregated) {
      for (const r of empRows) {
        present += Number(r.presentDays ?? r.present ?? 0);
        absent += Number(r.absentDays ?? r.absent ?? 0);
        leave += Number(r.leaveDays ?? r.leave ?? 0);
        late += Number(r.lateDays ?? r.lateMins ?? 0);
        workingHours += Number(r.hoursLogged ?? r.workingHours ?? 0);
        overtimeHours += Number(r.overtimeHours ?? 0);
      }
      const firstRow = empRows[0] || {};
      let attendancePct = 0;
      if (firstRow.attendancePct !== undefined) {
        const rawPct = String(firstRow.attendancePct).replace('%', '');
        attendancePct = parseFloat(rawPct) || 0;
      } else {
        const totalDays = present + absent + leave + late + halfDay;
        attendancePct = totalDays > 0 ? Math.round(((present + late + halfDay) / totalDays) * 100) : 0;
      }
      return { key, ...v, present, absent, late, halfDay, leave, workingHours, overtimeHours, attendancePct };
    }

    for (const r of empRows) {
      const s = (r.status || '').toLowerCase();
      if (s.includes('half')) halfDay += 1;
      else if (s.includes('late')) late += 1;
      else if (s.includes('leave')) leave += 1;
      else if (s.includes('absent')) absent += 1;
      else if (s.includes('present') || s.includes('wfh')) present += 1;
      workingHours += Number(r.workingHours) || 0;
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
  const departments = Array.from(deptMap.entries())
    .map(([department, d]) => ({ department, ...d, pct: d.totalDays > 0 ? Math.round((d.present / d.totalDays) * 100) : 0 }))
    .sort((a, b) => b.pct - a.pct);

  const grand = empList.reduce((acc, e) => ({ present: acc.present + e.present, absent: acc.absent + e.absent, late: acc.late + e.late, leave: acc.leave + e.leave, halfDay: acc.halfDay + e.halfDay }), { present: 0, absent: 0, late: 0, leave: 0, halfDay: 0 });
  const totalDays = grand.present + grand.absent + grand.leave + grand.late + grand.halfDay;
  const grandPct = totalDays > 0 ? Math.round(((grand.present + grand.late + grand.halfDay) / totalDays) * 100) : 0;
  const belowThreshold = empList.filter((e) => e.attendancePct < 80);
  const withOvertime = empList.filter((e) => e.overtimeHours > 0);
  const frequentLeave = [...empList].filter((e) => e.leave > 0).sort((a, b) => b.leave - a.leave);

  const insights: string[] = [`Overall attendance across ${empList.length} employee${empList.length === 1 ? '' : 's'} is ${grandPct}%.`];
  if (departments.length > 1) insights.push(`${departments[0].department} has the highest attendance at ${departments[0].pct}%.`);
  if (belowThreshold.length > 0) insights.push(`${belowThreshold.length} employee${belowThreshold.length === 1 ? '' : 's'} below 80% attendance — needs attention.`);
  if (withOvertime.length > 0) insights.push(`${withOvertime.length} employee${withOvertime.length === 1 ? '' : 's'} logged overtime this period.`);
  if (frequentLeave.length > 0) insights.push(`${frequentLeave[0].employeeName} took the most leave days (${frequentLeave[0].leave}).`);
  if (grand.late > 0) insights.push(`${grand.late} late day${grand.late === 1 ? '' : 's'} recorded across all employees.`);

  // KPI row — identical metric set and column-gating as the preview's
  // attendanceExec cards: unchecking "Overtime" in the sidebar's Columns
  // list must remove the Overtime card here too, not just on screen.
  const showHrsCol = columns.some((c) => c.key === 'workingHours');
  const showOtCol = columns.some((c) => c.key === 'overtimeHours');
  const showLateCol = columns.some((c) => c.key === 'lateMins');
  const kpis: { label: string; value: string }[] = [
    { label: 'Employees', value: String(empList.length) },
    { label: 'Present', value: String(grand.present) },
    { label: 'Absent', value: String(grand.absent) },
    { label: 'Leave', value: String(grand.leave) },
  ];
  if (showLateCol) kpis.push({ label: 'Late', value: String(grand.late) });
  if (showHrsCol) kpis.push({ label: 'Working Hours', value: `${Math.round(empList.reduce((n, e) => n + e.workingHours, 0) * 10) / 10}h` });
  if (showOtCol) kpis.push({ label: 'Overtime', value: `${Math.round(empList.reduce((n, e) => n + e.overtimeHours, 0) * 10) / 10}h` });
  kpis.push({ label: 'Attendance Score', value: `${grandPct}%` });

  doc.fontSize(10).fillColor('#0f172a').font('Helvetica-Bold').text('Summary');
  doc.moveDown(0.2);
  const kpiCardW = (pageWidth - 12 * 3) / 4;
  const kpiCardH = 34;
  let kcx = marginLeft, kcy = doc.y;
  kpis.forEach((k, i) => {
    if (i > 0 && i % 4 === 0) { kcx = marginLeft; kcy += kpiCardH + 8; }
    doc.rect(kcx, kcy, kpiCardW, kpiCardH).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.fillColor('#64748b').font('Helvetica').fontSize(6.5).text(k.label.toUpperCase(), kcx + 6, kcy + 5, { width: kpiCardW - 12 });
    doc.fillColor(theme.accentHex).font('Helvetica-Bold').fontSize(12).text(k.value, kcx + 6, kcy + 16, { width: kpiCardW - 12 });
    kcx += kpiCardW + 12;
  });
  doc.y = kcy + kpiCardH + 14;
  doc.x = marginLeft;

  // Key Insights — before any table, so the reader gets the takeaways first.
  doc.fontSize(9).fillColor('#0f172a').font('Helvetica-Bold').text('Key Insights');
  doc.moveDown(0.2);
  doc.fontSize(8).font('Helvetica').fillColor('#475569');
  insights.forEach((line) => doc.text(`•  ${line}`));
  doc.moveDown(0.6);

  // Attendance by Department — a bar per department, not just a table.
  doc.fontSize(9).fillColor('#0f172a').font('Helvetica-Bold').text('Attendance by Department');
  doc.moveDown(0.2);
  const barW = pageWidth - 90;
  departments.forEach((d) => {
    const y0 = doc.y;
    doc.fontSize(7.5).font('Helvetica').fillColor('#475569').text(d.department, marginLeft, y0, { width: 80, ellipsis: true });
    doc.rect(marginLeft + 85, y0 + 1, barW, 7).fill('#f1f5f9');
    doc.rect(marginLeft + 85, y0 + 1, barW * Math.min(d.pct, 100) / 100, 7).fill(theme.accentHex);
    doc.fontSize(7.5).fillColor('#334155').text(`${d.pct}%`, marginLeft + 85 + barW + 4, y0 + 1, { width: 30 });
    doc.y = y0 + 11;
  });
  doc.moveDown(0.4);
  doc.x = marginLeft;

  // Department Summary table
  doc.fontSize(9).fillColor('#0f172a').font('Helvetica-Bold').text('Department Summary');
  doc.moveDown(0.2);
  let y = doc.y;
  const deptColW = pageWidth / 5;
  doc.rect(marginLeft, y, pageWidth, ROW_HEIGHT).fill(theme.tableHeaderHex);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7);
  ['Department', 'Employees', 'Present', 'Absent', 'Attn %'].forEach((h, i) => doc.text(h, marginLeft + i * deptColW + 2, y + 4, { width: deptColW - 4, align: i === 0 ? 'left' : 'center' }));
  y += ROW_HEIGHT;
  doc.font('Helvetica').fontSize(7).fillColor('#334155');
  departments.forEach((d, i) => {
    if (i % 2 === 1) doc.rect(marginLeft, y, pageWidth, ROW_HEIGHT).fill('#f8fafc');
    [d.department, String(d.employees), String(d.present), String(d.absent), `${d.pct}%`].forEach((v, ci) => doc.text(v, marginLeft + ci * deptColW + 2, y + 4, { width: deptColW - 4, align: ci === 0 ? 'left' : 'center', ellipsis: true }));
    y += ROW_HEIGHT;
  });
  doc.y = y + 10; doc.x = marginLeft;

  // Employee Summary — grouped by department, trimmed columns, status badge.
  doc.fontSize(9).fillColor('#0f172a').font('Helvetica-Bold').text('Employee Summary');
  doc.moveDown(0.2);
  const showStatusColPdf = columns.some((c) => c.key === 'status');
  const empCols = [
    { key: 'employeeId', label: 'ID', w: 45 }, { key: 'employeeName', label: 'Name', w: 95 }, { key: 'designation', label: 'Designation', w: 90 },
    ...(showStatusColPdf ? [{ key: 'present', label: 'Pres', w: 32 }, { key: 'absent', label: 'Abs', w: 32 }, { key: 'leave', label: 'Lv', w: 28 }] : []),
    ...(showHrsCol ? [{ key: 'workingHours', label: 'Hrs', w: 30 }] : []),
    ...(showStatusColPdf ? [{ key: 'attendancePct', label: 'Attn%', w: 34 }, { key: 'status', label: 'Status', w: 70 }] : []),
  ];
  const totalColW = empCols.reduce((n, c) => n + c.w, 0);
  const scale = pageWidth / totalColW;
  const drawEmpHeader = (yy: number) => {
    doc.rect(marginLeft, yy, pageWidth, ROW_HEIGHT).fill(theme.tableHeaderHex);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7);
    let x = marginLeft;
    for (const c of empCols) { doc.text(c.label, x + 2, yy + 4, { width: c.w * scale - 4, align: ['employeeId', 'employeeName', 'designation'].includes(c.key) ? 'left' : 'center' }); x += c.w * scale; }
  };

  for (const dept of departments) {
    const deptEmployees = empList.filter((e) => e.department === dept.department);
    if (doc.y + ROW_HEIGHT * 3 > doc.page.height - PAGE_MARGIN - 20) { doc.addPage(); doc.y = PAGE_MARGIN; }
    doc.rect(marginLeft, doc.y, pageWidth, 16).fill(theme.accentHex);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5).text(`${dept.department} (${deptEmployees.length})`, marginLeft + 4, doc.y + 4);
    doc.y += 16;
    y = doc.y;
    drawEmpHeader(y); y += ROW_HEIGHT;
    doc.font('Helvetica').fontSize(7);
    deptEmployees.forEach((e, i) => {
      if (y + ROW_HEIGHT > doc.page.height - PAGE_MARGIN - 20) { doc.addPage(); y = PAGE_MARGIN; drawEmpHeader(y); y += ROW_HEIGHT; doc.font('Helvetica').fontSize(7); }
      if (i % 2 === 1) doc.rect(marginLeft, y, pageWidth, ROW_HEIGHT).fill('#f8fafc');
      const badge = attendanceStatusBadgeHex(e.attendancePct);
      const valByKey: Record<string, string | number> = { employeeId: e.employeeId, employeeName: e.employeeName, designation: e.designation || '-', present: e.present, absent: e.absent, leave: e.leave, workingHours: Math.round(e.workingHours * 10) / 10, attendancePct: `${e.attendancePct}%` };
      // The 'status' badge column (if present) is always last and drawn in
      // its accent color instead of plain text — everything else is drawn
      // as text first.
      const textCols = showStatusColPdf ? empCols.slice(0, -1) : empCols;
      let x = marginLeft;
      doc.fillColor('#334155');
      textCols.forEach((c) => {
        doc.text(String(valByKey[c.key]), x + 2, y + 4, { width: c.w * scale - 4, align: ['employeeId', 'employeeName', 'designation'].includes(c.key) ? 'left' : 'center', ellipsis: true });
        x += c.w * scale;
      });
      if (showStatusColPdf) {
        doc.fillColor(badge.hex).font('Helvetica-Bold').text(badge.label, x + 2, y + 4, { width: empCols[empCols.length - 1].w * scale - 4, align: 'center', ellipsis: true });
        doc.font('Helvetica');
      }
      y += ROW_HEIGHT;
    });
    doc.y = y + 8;
    doc.x = marginLeft;
  }
}

// Employee Attendance Summary layout: one row per employee, flat, no KPI
// cards or department grouping — what HR actually downloads most, per the
// enterprise-report design review.
function drawEmployeeSummaryTable(doc: any, rows: any[], columns: ReportColumnMeta[], pageWidth: number, marginLeft: number, theme: { tableHeaderHex: string; accentHex: string }) {
  const showLate = columns.some((c) => c.key === 'lateMins');
  const showHrs = columns.some((c) => c.key === 'workingHours');
  const showStatus = columns.some((c) => c.key === 'status');
  const employees = new Map<string, { employeeId: string | number; employeeName: string; department: string }>();
  for (const row of rows) {
    const key = String(row.employeeId ?? row.employeeName ?? '?');
    if (!employees.has(key)) employees.set(key, { employeeId: row.employeeId ?? '-', employeeName: row.employeeName || 'Employee', department: row.department || 'General' });
  }
  const empList = Array.from(employees.entries()).map(([key, v]) => {
    const empRows = rows.filter((r) => String(r.employeeId ?? r.employeeName ?? '?') === key);
    let present = 0, absent = 0, late = 0, halfDay = 0, leave = 0, workingHours = 0;
    const hasAggregated = empRows.some((r) => r.presentDays !== undefined || r.hoursLogged !== undefined || r.attendancePct !== undefined);

    if (hasAggregated) {
      for (const r of empRows) {
        present += Number(r.presentDays ?? r.present ?? 0);
        absent += Number(r.absentDays ?? r.absent ?? 0);
        leave += Number(r.leaveDays ?? r.leave ?? 0);
        late += Number(r.lateDays ?? r.lateMins ?? 0);
        workingHours += Number(r.hoursLogged ?? r.workingHours ?? 0);
      }
      const firstRow = empRows[0] || {};
      let attendancePct = 0;
      if (firstRow.attendancePct !== undefined) {
        const rawPct = String(firstRow.attendancePct).replace('%', '');
        attendancePct = parseFloat(rawPct) || 0;
      } else {
        const totalDays = present + absent + leave + late + halfDay;
        attendancePct = totalDays > 0 ? Math.round(((present + late + halfDay) / totalDays) * 100) : 0;
      }
      return { key, ...v, present, absent, late, leave, workingHours, attendancePct };
    }

    for (const r of empRows) {
      const s = (r.status || '').toLowerCase();
      if (s.includes('half')) halfDay += 1;
      else if (s.includes('late')) late += 1;
      else if (s.includes('leave')) leave += 1;
      else if (s.includes('absent')) absent += 1;
      else if (s.includes('present') || s.includes('wfh')) present += 1;
      workingHours += Number(r.workingHours) || 0;
    }
    const totalDays = present + absent + leave + late + halfDay;
    const attendancePct = totalDays > 0 ? Math.round(((present + late + halfDay) / totalDays) * 100) : 0;
    return { key, ...v, present, absent, late, leave, workingHours, attendancePct };
  }).sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  const cols = [
    { key: 'id', label: '#', w: 20 }, { key: 'employeeId', label: 'ID', w: 45 }, { key: 'employeeName', label: 'Name', w: 100 }, { key: 'department', label: 'Dept', w: 80 },
    ...(showStatus ? [{ key: 'attendancePct', label: 'Attn%', w: 40 }, { key: 'present', label: 'Pres', w: 34 }, { key: 'absent', label: 'Abs', w: 34 }, { key: 'leave', label: 'Lv', w: 30 }] : []),
    ...(showLate ? [{ key: 'late', label: 'Late', w: 30 }] : []),
    ...(showHrs ? [{ key: 'workingHours', label: 'Hrs', w: 36 }] : []),
  ];
  const totalColW = cols.reduce((n, c) => n + c.w, 0);
  const scale = pageWidth / totalColW;
  const leftAlign = new Set(['id', 'employeeId', 'employeeName', 'department']);
  const drawHeader = (yy: number) => {
    doc.rect(marginLeft, yy, pageWidth, ROW_HEIGHT).fill(theme.tableHeaderHex);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5);
    let x = marginLeft;
    for (const c of cols) { doc.text(c.label, x + 2, yy + 4, { width: c.w * scale - 4, align: leftAlign.has(c.key) ? 'left' : 'center' }); x += c.w * scale; }
  };
  let y = doc.y;
  drawHeader(y); y += ROW_HEIGHT;
  doc.font('Helvetica').fontSize(7.5);
  empList.forEach((e, i) => {
    if (y + ROW_HEIGHT > doc.page.height - PAGE_MARGIN - 20) { doc.addPage(); y = PAGE_MARGIN; drawHeader(y); y += ROW_HEIGHT; doc.font('Helvetica').fontSize(7.5); }
    if (i % 2 === 1) doc.rect(marginLeft, y, pageWidth, ROW_HEIGHT).fill('#f8fafc');
    doc.fillColor('#334155');
    const valByKey: Record<string, string | number> = { id: i + 1, employeeId: e.employeeId, employeeName: e.employeeName, department: e.department, attendancePct: `${e.attendancePct}%`, present: e.present, absent: e.absent, leave: e.leave, late: e.late, workingHours: `${Math.round(e.workingHours * 10) / 10}h` };
    let x = marginLeft;
    cols.forEach((c) => { doc.text(String(valByKey[c.key]), x + 2, y + 4, { width: c.w * scale - 4, align: leftAlign.has(c.key) ? 'left' : 'center', ellipsis: true }); x += c.w * scale; });
    y += ROW_HEIGHT;
  });
  const grand = empList.reduce((acc, e) => ({ present: acc.present + e.present, absent: acc.absent + e.absent, leave: acc.leave + e.leave, late: acc.late + e.late, workingHours: acc.workingHours + e.workingHours }), { present: 0, absent: 0, leave: 0, late: 0, workingHours: 0 });
  const totalDays = empList.reduce((n, e) => n + e.present + e.absent + e.leave + e.late, 0);
  const grandPct = totalDays > 0 ? Math.round((grand.present / totalDays) * 100) : 0;
  doc.rect(marginLeft, y, pageWidth, ROW_HEIGHT).fill('#f1f5f9');
  doc.font('Helvetica-Bold').fillColor('#0f172a');
  const totByKey: Record<string, string | number> = { id: '', employeeId: '', employeeName: '', department: 'TOTAL', attendancePct: `${grandPct}%`, present: grand.present, absent: grand.absent, leave: grand.leave, late: grand.late, workingHours: `${Math.round(grand.workingHours * 10) / 10}h` };
  const totVals: (string | number)[] = cols.map((c) => totByKey[c.key]);
  let x = marginLeft;
  cols.forEach((c, ci) => { doc.text(String(totVals[ci]), x + 2, y + 4, { width: c.w * scale - 4, align: leftAlign.has(c.key) ? 'left' : 'center', ellipsis: true }); x += c.w * scale; });
  doc.y = y + ROW_HEIGHT + 6;
  doc.x = marginLeft;
}

// Attendance Register layout: one section per employee (header + their own
// date rows + a per-employee summary), never the employee name repeated on
// every day-row — the exact "looks like raw database data" pattern this
// replaces. columns already excludes employeeName/department/designation
// via the caller so each section's table only shows date-level fields.
function drawAttendanceRegister(doc: any, rows: any[], columns: ReportColumnMeta[], pageWidth: number, marginLeft: number, theme: { tableHeaderHex: string; accentHex: string }) {
  const dateCols = columns.filter((c) => !['employeeName', 'department', 'designation'].includes(c.key));
  const byEmployee = new Map<string, { employeeId: any; employeeName: string; department: string; designation?: string; empRows: any[] }>();
  for (const row of rows) {
    const key = String(row.employeeId ?? row.employeeName ?? '?');
    if (!byEmployee.has(key)) byEmployee.set(key, { employeeId: row.employeeId, employeeName: row.employeeName || 'Employee', department: row.department, designation: row.designation, empRows: [] });
    byEmployee.get(key)!.empRows.push(row);
  }
  const groups = Array.from(byEmployee.values()).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  const colW = pageWidth / Math.max(dateCols.length, 1);

  for (const g of groups) {
    if (doc.y + 40 > doc.page.height - PAGE_MARGIN - 20) { doc.addPage(); doc.y = PAGE_MARGIN; }
    doc.rect(marginLeft, doc.y, pageWidth, 26).fill(theme.accentHex);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text(g.employeeName, marginLeft + 6, doc.y + 4);
    doc.fontSize(7).font('Helvetica').text([g.department, g.designation, g.employeeId ? `ID ${g.employeeId}` : null].filter(Boolean).join(' · '), marginLeft + 6, doc.y + 15);
    doc.y += 26;

    let y = doc.y;
    const drawHeader = (yy: number) => {
      doc.rect(marginLeft, yy, pageWidth, ROW_HEIGHT).fill('#f1f5f9');
      doc.fillColor('#475569').font('Helvetica-Bold').fontSize(7);
      let x = marginLeft;
      for (const c of dateCols) { doc.text(c.label, x + 2, yy + 4, { width: colW - 4, ellipsis: true }); x += colW; }
    };
    drawHeader(y); y += ROW_HEIGHT;
    doc.font('Helvetica').fontSize(7);
    g.empRows.forEach((row, i) => {
      if (y + ROW_HEIGHT > doc.page.height - PAGE_MARGIN - 20) { doc.addPage(); y = PAGE_MARGIN; drawHeader(y); y += ROW_HEIGHT; doc.font('Helvetica').fontSize(7); }
      if (i % 2 === 1) doc.rect(marginLeft, y, pageWidth, ROW_HEIGHT).fill('#f8fafc');
      doc.fillColor('#334155');
      let x = marginLeft;
      for (const c of dateCols) {
        const val = formatValue(row[c.key], c.format);
        const color = c.key === 'status' ? statusColor(val) : null;
        doc.fillColor(color || '#334155').font(color ? 'Helvetica-Bold' : 'Helvetica');
        doc.text(val, x + 2, y + 4, { width: colW - 4, ellipsis: true });
        x += colW;
      }
      doc.font('Helvetica');
      y += ROW_HEIGHT;
    });

    const present = g.empRows.filter((r) => (r.status || '').toLowerCase().includes('present')).length;
    const absent = g.empRows.filter((r) => (r.status || '').toLowerCase().includes('absent')).length;
    const leave = g.empRows.filter((r) => (r.status || '').toLowerCase().includes('leave')).length;
    const late = g.empRows.filter((r) => (r.status || '').toLowerCase().includes('late')).length;
    const hours = g.empRows.reduce((n, r) => n + (Number(r.workingHours) || 0), 0);
    doc.rect(marginLeft, y, pageWidth, ROW_HEIGHT).fill('#f8fafc');
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#334155');
    doc.text(`Present: ${present}   Absent: ${absent}   Leave: ${leave}   Late: ${late}   Working Hours: ${Math.round(hours * 10) / 10}h`, marginLeft + 4, y + 4);
    doc.y = y + ROW_HEIGHT + 10;
    doc.x = marginLeft;
  }
}

// Leave Executive Summary — mirrors ReportPreview.tsx's leaveExec
// computation exactly (same applied/approved/pending/rejected classification
// and leave-type/department rollups) so the PDF matches the Designer screen.
function drawLeaveExecutiveSummary(doc: any, rows: any[], pageWidth: number, marginLeft: number, theme: { tableHeaderHex: string; accentHex: string }) {
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
  }).sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  const deptMap = new Map<string, { employees: number; applied: number; approved: number; totalDays: number }>();
  for (const e of empList) {
    if (!deptMap.has(e.department)) deptMap.set(e.department, { employees: 0, applied: 0, approved: 0, totalDays: 0 });
    const d = deptMap.get(e.department)!;
    d.employees += 1; d.applied += e.applied; d.approved += e.approved; d.totalDays += e.totalDays;
  }
  const departments = Array.from(deptMap.entries()).map(([department, d]) => ({ department, ...d })).sort((a, b) => b.totalDays - a.totalDays);

  const typeMap = new Map<string, { count: number; days: number }>();
  for (const row of rows) {
    const t = row.leaveType || 'Leave';
    if (!typeMap.has(t)) typeMap.set(t, { count: 0, days: 0 });
    const v = typeMap.get(t)!;
    v.count += 1; v.days += Number(row.daysCount) || 0;
  }
  const leaveTypes = Array.from(typeMap.entries()).map(([type, v]) => ({ type, ...v })).sort((a, b) => b.days - a.days);

  const grand = empList.reduce((acc, e) => ({ applied: acc.applied + e.applied, approved: acc.approved + e.approved, pending: acc.pending + e.pending, rejected: acc.rejected + e.rejected, totalDays: acc.totalDays + e.totalDays }), { applied: 0, approved: 0, pending: 0, rejected: 0, totalDays: 0 });

  const frequentTaker = [...empList].sort((a, b) => b.totalDays - a.totalDays)[0];
  const insights: string[] = [`${grand.applied} leave request${grand.applied === 1 ? '' : 's'} across ${empList.length} employee${empList.length === 1 ? '' : 's'}, totaling ${grand.totalDays} day${grand.totalDays === 1 ? '' : 's'}.`];
  if (grand.pending > 0) insights.push(`${grand.pending} request${grand.pending === 1 ? '' : 's'} still pending approval.`);
  if (leaveTypes.length > 0) insights.push(`${leaveTypes[0].type} is the most-used leave type (${leaveTypes[0].days} days).`);
  if (departments.length > 1) insights.push(`${departments[0].department} has taken the most leave (${departments[0].totalDays} days).`);
  if (frequentTaker && frequentTaker.totalDays > 0) insights.push(`${frequentTaker.employeeName} took the most leave days (${frequentTaker.totalDays}).`);

  // KPI row
  const kpis: { label: string; value: string }[] = [
    { label: 'Total Requests', value: String(grand.applied) }, { label: 'Approved', value: String(grand.approved) },
    { label: 'Pending', value: String(grand.pending) }, { label: 'Rejected', value: String(grand.rejected) }, { label: 'Total Days', value: String(grand.totalDays) },
  ];
  doc.fontSize(10).fillColor('#0f172a').font('Helvetica-Bold').text('Summary');
  doc.moveDown(0.2);
  const kpiCardW = (pageWidth - 12 * 4) / 5;
  const kpiCardH = 34;
  let kcx = marginLeft, kcy = doc.y;
  kpis.forEach((k) => {
    doc.rect(kcx, kcy, kpiCardW, kpiCardH).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.fillColor('#64748b').font('Helvetica').fontSize(6.5).text(k.label.toUpperCase(), kcx + 6, kcy + 5, { width: kpiCardW - 12 });
    doc.fillColor(theme.accentHex).font('Helvetica-Bold').fontSize(12).text(k.value, kcx + 6, kcy + 16, { width: kpiCardW - 12 });
    kcx += kpiCardW + 12;
  });
  doc.y = kcy + kpiCardH + 14;
  doc.x = marginLeft;

  // Key Insights
  doc.fontSize(9).fillColor('#0f172a').font('Helvetica-Bold').text('Key Insights');
  doc.moveDown(0.2);
  doc.fontSize(8).font('Helvetica').fillColor('#475569');
  insights.forEach((line) => doc.text(`•  ${line}`));
  doc.moveDown(0.6);

  // Leave Type Breakdown
  doc.fontSize(9).fillColor('#0f172a').font('Helvetica-Bold').text('Leave Type Breakdown');
  doc.moveDown(0.2);
  const maxDays = Math.max(...leaveTypes.map((t) => t.days), 1);
  const barW = pageWidth - 130;
  leaveTypes.forEach((t) => {
    const y0 = doc.y;
    doc.fontSize(7.5).font('Helvetica').fillColor('#475569').text(t.type, marginLeft, y0, { width: 90, ellipsis: true });
    doc.rect(marginLeft + 95, y0 + 1, barW, 7).fill('#f1f5f9');
    doc.rect(marginLeft + 95, y0 + 1, barW * (t.days / maxDays), 7).fill(theme.accentHex);
    doc.fontSize(7.5).fillColor('#334155').text(`${t.days}d (${t.count})`, marginLeft + 95 + barW + 4, y0 + 1, { width: 40 });
    doc.y = y0 + 11;
  });
  doc.moveDown(0.4);
  doc.x = marginLeft;

  // Department Summary
  doc.fontSize(9).fillColor('#0f172a').font('Helvetica-Bold').text('Department Summary');
  doc.moveDown(0.2);
  let y = doc.y;
  const deptColW = pageWidth / 4;
  doc.rect(marginLeft, y, pageWidth, ROW_HEIGHT).fill(theme.tableHeaderHex);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7);
  ['Department', 'Employees', 'Applied', 'Total Days'].forEach((h, i) => doc.text(h, marginLeft + i * deptColW + 2, y + 4, { width: deptColW - 4, align: i === 0 ? 'left' : 'center' }));
  y += ROW_HEIGHT;
  doc.font('Helvetica').fontSize(7).fillColor('#334155');
  departments.forEach((d, i) => {
    if (i % 2 === 1) doc.rect(marginLeft, y, pageWidth, ROW_HEIGHT).fill('#f8fafc');
    [d.department, String(d.employees), String(d.applied), String(d.totalDays)].forEach((v, ci) => doc.text(v, marginLeft + ci * deptColW + 2, y + 4, { width: deptColW - 4, align: ci === 0 ? 'left' : 'center', ellipsis: true }));
    y += ROW_HEIGHT;
  });
  doc.y = y + 10; doc.x = marginLeft;

  // Employee Summary
  doc.fontSize(9).fillColor('#0f172a').font('Helvetica-Bold').text('Employee Summary');
  doc.moveDown(0.2);
  const empCols = [
    { key: 'employeeId', label: 'ID', w: 40 }, { key: 'employeeName', label: 'Name', w: 100 }, { key: 'department', label: 'Dept', w: 80 },
    { key: 'applied', label: 'Applied', w: 45 }, { key: 'approved', label: 'Appr', w: 40 }, { key: 'pending', label: 'Pend', w: 40 }, { key: 'rejected', label: 'Rej', w: 40 }, { key: 'totalDays', label: 'Days', w: 40 },
  ];
  const totalColW = empCols.reduce((n, c) => n + c.w, 0);
  const scale = pageWidth / totalColW;
  const leftAlign = new Set(['employeeId', 'employeeName', 'department']);
  const drawHeader = (yy: number) => {
    doc.rect(marginLeft, yy, pageWidth, ROW_HEIGHT).fill(theme.tableHeaderHex);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7);
    let x = marginLeft;
    for (const c of empCols) { doc.text(c.label, x + 2, yy + 4, { width: c.w * scale - 4, align: leftAlign.has(c.key) ? 'left' : 'center' }); x += c.w * scale; }
  };
  y = doc.y;
  drawHeader(y); y += ROW_HEIGHT;
  doc.font('Helvetica').fontSize(7);
  empList.forEach((e, i) => {
    if (y + ROW_HEIGHT > doc.page.height - PAGE_MARGIN - 20) { doc.addPage(); y = PAGE_MARGIN; drawHeader(y); y += ROW_HEIGHT; doc.font('Helvetica').fontSize(7); }
    if (i % 2 === 1) doc.rect(marginLeft, y, pageWidth, ROW_HEIGHT).fill('#f8fafc');
    doc.fillColor('#334155');
    const valByKey: Record<string, string | number> = { employeeId: e.employeeId, employeeName: e.employeeName, department: e.department, applied: e.applied, approved: e.approved, pending: e.pending, rejected: e.rejected, totalDays: e.totalDays };
    let x = marginLeft;
    empCols.forEach((c) => { doc.text(String(valByKey[c.key]), x + 2, y + 4, { width: c.w * scale - 4, align: leftAlign.has(c.key) ? 'left' : 'center', ellipsis: true }); x += c.w * scale; });
    y += ROW_HEIGHT;
  });
  doc.y = y + 8;
  doc.x = marginLeft;
}

// Payroll Executive Summary — mirrors ReportPreview.tsx's payrollExec
// computation (gross/net/deductions/pf/esi/tax per employee and per
// department) so the PDF matches the Designer screen. Currency uses the
// same '$'-prefixed convention formatValue() already applies elsewhere.
function fmtMoney(n: number): string { return `$${Math.round(n).toLocaleString()}`; }

function drawPayrollExecutiveSummary(doc: any, rows: any[], pageWidth: number, marginLeft: number, theme: { tableHeaderHex: string; accentHex: string }) {
  const empList = rows.map((r) => ({
    key: String(r.employeeId ?? r.employeeName ?? '?'), employeeId: r.employeeId ?? '-', employeeName: r.employeeName || 'Employee',
    department: r.department || 'General', gross: Number(r.grossSalary) || 0, net: Number(r.netSalary) || 0, deductions: Number(r.deductions) || 0,
    pf: Number(r.pfAmount) || 0, esi: Number(r.esiAmount) || 0, tax: Number(r.taxAmount) || 0,
  })).sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  const deptMap = new Map<string, { employees: number; gross: number; net: number; deductions: number }>();
  for (const e of empList) {
    if (!deptMap.has(e.department)) deptMap.set(e.department, { employees: 0, gross: 0, net: 0, deductions: 0 });
    const d = deptMap.get(e.department)!;
    d.employees += 1; d.gross += e.gross; d.net += e.net; d.deductions += e.deductions;
  }
  const departments = Array.from(deptMap.entries()).map(([department, d]) => ({ department, ...d })).sort((a, b) => b.gross - a.gross);

  const grand = empList.reduce((acc, e) => ({ gross: acc.gross + e.gross, net: acc.net + e.net, deductions: acc.deductions + e.deductions, pf: acc.pf + e.pf, esi: acc.esi + e.esi, tax: acc.tax + e.tax }), { gross: 0, net: 0, deductions: 0, pf: 0, esi: 0, tax: 0 });
  const employerContribution = grand.pf + grand.esi;
  const avgSalary = empList.length > 0 ? grand.net / empList.length : 0;
  const highestPaid = [...empList].sort((a, b) => b.net - a.net)[0];

  const insights: string[] = [`${empList.length} employee${empList.length === 1 ? '' : 's'} processed, totaling ${fmtMoney(grand.gross)} gross / ${fmtMoney(grand.net)} net.`];
  if (departments[0]) insights.push(`${departments[0].department} has the highest payroll cost (${fmtMoney(departments[0].gross)}).`);
  if (employerContribution > 0) insights.push(`Total employer contribution (PF + ESI): ${fmtMoney(employerContribution)}.`);
  insights.push(`Average net pay: ${fmtMoney(avgSalary)}.`);
  if (highestPaid) insights.push(`${highestPaid.employeeName} has the highest net pay (${fmtMoney(highestPaid.net)}).`);

  // KPI row
  const kpis: { label: string; value: string }[] = [
    { label: 'Employees', value: String(empList.length) }, { label: 'Total Gross', value: fmtMoney(grand.gross) },
    { label: 'Total Deductions', value: fmtMoney(grand.deductions) }, { label: 'Total Net Pay', value: fmtMoney(grand.net) },
    { label: 'Employer PF', value: fmtMoney(grand.pf) }, { label: 'Employer ESI', value: fmtMoney(grand.esi) },
    { label: 'Tax (TDS)', value: fmtMoney(grand.tax) }, { label: 'Avg. Net Salary', value: fmtMoney(avgSalary) },
  ];
  doc.fontSize(10).fillColor('#0f172a').font('Helvetica-Bold').text('Summary');
  doc.moveDown(0.2);
  const kpiCardW = (pageWidth - 12 * 3) / 4;
  const kpiCardH = 34;
  let kcx = marginLeft, kcy = doc.y;
  kpis.forEach((k, i) => {
    if (i > 0 && i % 4 === 0) { kcx = marginLeft; kcy += kpiCardH + 8; }
    doc.rect(kcx, kcy, kpiCardW, kpiCardH).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.fillColor('#64748b').font('Helvetica').fontSize(6.5).text(k.label.toUpperCase(), kcx + 6, kcy + 5, { width: kpiCardW - 12 });
    doc.fillColor(theme.accentHex).font('Helvetica-Bold').fontSize(11).text(k.value, kcx + 6, kcy + 16, { width: kpiCardW - 12 });
    kcx += kpiCardW + 12;
  });
  doc.y = kcy + kpiCardH + 14;
  doc.x = marginLeft;

  // Key Insights
  doc.fontSize(9).fillColor('#0f172a').font('Helvetica-Bold').text('Key Insights');
  doc.moveDown(0.2);
  doc.fontSize(8).font('Helvetica').fillColor('#475569');
  insights.forEach((line) => doc.text(`•  ${line}`));
  doc.moveDown(0.6);

  // Payroll by Department bars
  doc.fontSize(9).fillColor('#0f172a').font('Helvetica-Bold').text('Payroll by Department');
  doc.moveDown(0.2);
  const maxGross = Math.max(...departments.map((d) => d.gross), 1);
  const barW = pageWidth - 150;
  departments.forEach((d) => {
    const y0 = doc.y;
    doc.fontSize(7.5).font('Helvetica').fillColor('#475569').text(d.department, marginLeft, y0, { width: 90, ellipsis: true });
    doc.rect(marginLeft + 95, y0 + 1, barW, 7).fill('#f1f5f9');
    doc.rect(marginLeft + 95, y0 + 1, barW * (d.gross / maxGross), 7).fill(theme.accentHex);
    doc.fontSize(7.5).fillColor('#334155').text(fmtMoney(d.gross), marginLeft + 95 + barW + 4, y0 + 1, { width: 55 });
    doc.y = y0 + 11;
  });
  doc.moveDown(0.4);
  doc.x = marginLeft;

  // Department Payroll Summary table
  doc.fontSize(9).fillColor('#0f172a').font('Helvetica-Bold').text('Department Payroll Summary');
  doc.moveDown(0.2);
  let y = doc.y;
  const deptColW = pageWidth / 5;
  doc.rect(marginLeft, y, pageWidth, ROW_HEIGHT).fill(theme.tableHeaderHex);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7);
  ['Department', 'Employees', 'Gross Pay', 'Deductions', 'Net Pay'].forEach((h, i) => doc.text(h, marginLeft + i * deptColW + 2, y + 4, { width: deptColW - 4, align: i === 0 ? 'left' : 'center' }));
  y += ROW_HEIGHT;
  doc.font('Helvetica').fontSize(7).fillColor('#334155');
  departments.forEach((d, i) => {
    if (i % 2 === 1) doc.rect(marginLeft, y, pageWidth, ROW_HEIGHT).fill('#f8fafc');
    [d.department, String(d.employees), fmtMoney(d.gross), fmtMoney(d.deductions), fmtMoney(d.net)].forEach((v, ci) => doc.text(v, marginLeft + ci * deptColW + 2, y + 4, { width: deptColW - 4, align: ci === 0 ? 'left' : 'center', ellipsis: true }));
    y += ROW_HEIGHT;
  });
  doc.y = y + 10; doc.x = marginLeft;

  // Employee Payroll Summary table
  doc.fontSize(9).fillColor('#0f172a').font('Helvetica-Bold').text('Employee Payroll Summary');
  doc.moveDown(0.2);
  const empCols = [
    { key: 'employeeId', label: 'ID', w: 40 }, { key: 'employeeName', label: 'Name', w: 90 }, { key: 'department', label: 'Dept', w: 65 },
    { key: 'gross', label: 'Gross', w: 50 }, { key: 'deductions', label: 'Deduct.', w: 50 }, { key: 'pf', label: 'PF', w: 40 }, { key: 'esi', label: 'ESI', w: 40 }, { key: 'tax', label: 'Tax', w: 40 }, { key: 'net', label: 'Net Pay', w: 55 },
  ];
  const totalColW = empCols.reduce((n, c) => n + c.w, 0);
  const scale = pageWidth / totalColW;
  const leftAlign = new Set(['employeeId', 'employeeName', 'department']);
  const drawHeader = (yy: number) => {
    doc.rect(marginLeft, yy, pageWidth, ROW_HEIGHT).fill(theme.tableHeaderHex);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7);
    let x = marginLeft;
    for (const c of empCols) { doc.text(c.label, x + 2, yy + 4, { width: c.w * scale - 4, align: leftAlign.has(c.key) ? 'left' : 'center' }); x += c.w * scale; }
  };
  y = doc.y;
  drawHeader(y); y += ROW_HEIGHT;
  doc.font('Helvetica').fontSize(7);
  empList.forEach((e, i) => {
    if (y + ROW_HEIGHT > doc.page.height - PAGE_MARGIN - 20) { doc.addPage(); y = PAGE_MARGIN; drawHeader(y); y += ROW_HEIGHT; doc.font('Helvetica').fontSize(7); }
    if (i % 2 === 1) doc.rect(marginLeft, y, pageWidth, ROW_HEIGHT).fill('#f8fafc');
    doc.fillColor('#334155');
    const valByKey: Record<string, string | number> = { employeeId: e.employeeId, employeeName: e.employeeName, department: e.department, gross: fmtMoney(e.gross), deductions: fmtMoney(e.deductions), pf: fmtMoney(e.pf), esi: fmtMoney(e.esi), tax: fmtMoney(e.tax), net: fmtMoney(e.net) };
    let x = marginLeft;
    empCols.forEach((c) => { doc.text(String(valByKey[c.key]), x + 2, y + 4, { width: c.w * scale - 4, align: leftAlign.has(c.key) ? 'left' : 'center', ellipsis: true }); x += c.w * scale; });
    y += ROW_HEIGHT;
  });
  doc.y = y + 8;
  doc.x = marginLeft;
}

// Consolidated Summary — rows already arrive pre-merged one-per-employee
// (buildConsolidatedReport, reportData.ts), so this mirrors
// ReportPreview.tsx's consolidatedExec: KPI row + department rollup gated
// by which module columns are present, then the full employee-level table.
function drawConsolidatedSummary(doc: any, rows: any[], columns: ReportColumnMeta[], pageWidth: number, marginLeft: number, theme: { tableHeaderHex: string; accentHex: string }) {
  const showAtt = columns.some((c) => c.key === 'attendancePct');
  const showLeave = columns.some((c) => c.key === 'leaveTaken');
  const showPayroll = columns.some((c) => c.key === 'netPay');

  const deptMap = new Map<string, { employees: number; present: number; leaveTaken: number; gross: number; net: number }>();
  for (const r of rows) {
    const dept = r.department || 'General';
    if (!deptMap.has(dept)) deptMap.set(dept, { employees: 0, present: 0, leaveTaken: 0, gross: 0, net: 0 });
    const d = deptMap.get(dept)!;
    d.employees += 1;
    if (r.presentDays != null) d.present += r.presentDays;
    if (r.leaveTaken != null) d.leaveTaken += r.leaveTaken;
    if (r.grossPay != null) d.gross += r.grossPay;
    if (r.netPay != null) d.net += r.netPay;
  }
  const departments = Array.from(deptMap.entries()).map(([department, d]) => ({ department, ...d })).sort((a, b) => b.employees - a.employees);

  const withAttPct = rows.filter((r) => typeof r.attendancePct === 'number');
  const avgAttendancePct = withAttPct.length > 0 ? Math.round(withAttPct.reduce((n, r) => n + r.attendancePct, 0) / withAttPct.length) : null;
  const totalLeaveTaken = rows.reduce((n, r) => n + (r.leaveTaken || 0), 0);
  const totalGross = rows.reduce((n, r) => n + (r.grossPay || 0), 0);
  const totalNet = rows.reduce((n, r) => n + (r.netPay || 0), 0);

  // KPI row
  const kpis: { label: string; value: string }[] = [{ label: 'Total Employees', value: String(rows.length) }];
  if (showAtt) kpis.push({ label: 'Avg. Attendance %', value: avgAttendancePct !== null ? `${avgAttendancePct}%` : 'N/A' });
  if (showLeave) kpis.push({ label: 'Leave Taken', value: String(totalLeaveTaken) });
  if (showPayroll) { kpis.push({ label: 'Gross Pay', value: fmtMoney(totalGross) }); kpis.push({ label: 'Net Pay', value: fmtMoney(totalNet) }); }

  doc.fontSize(10).fillColor('#0f172a').font('Helvetica-Bold').text('Overall Summary (All Departments)');
  doc.moveDown(0.2);
  const kpiCardW = (pageWidth - 12 * (kpis.length - 1)) / kpis.length;
  const kpiCardH = 34;
  let kcx = marginLeft;
  const kcy = doc.y;
  kpis.forEach((k) => {
    doc.rect(kcx, kcy, kpiCardW, kpiCardH).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.fillColor('#64748b').font('Helvetica').fontSize(6.5).text(k.label.toUpperCase(), kcx + 6, kcy + 5, { width: kpiCardW - 12 });
    doc.fillColor(theme.accentHex).font('Helvetica-Bold').fontSize(12).text(k.value, kcx + 6, kcy + 16, { width: kpiCardW - 12 });
    kcx += kpiCardW + 12;
  });
  doc.y = kcy + kpiCardH + 14;
  doc.x = marginLeft;

  // Department-Wise Consolidated Metrics
  doc.fontSize(9).fillColor('#0f172a').font('Helvetica-Bold').text('Department-Wise Consolidated Metrics');
  doc.moveDown(0.2);
  const deptCols = ['Department', 'Employees', ...(showAtt ? ['Present Days'] : []), ...(showLeave ? ['Leave Taken'] : []), ...(showPayroll ? ['Gross Pay', 'Net Pay'] : [])];
  let y = doc.y;
  const deptColW = pageWidth / deptCols.length;
  doc.rect(marginLeft, y, pageWidth, ROW_HEIGHT).fill(theme.tableHeaderHex);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7);
  deptCols.forEach((h, i) => doc.text(h, marginLeft + i * deptColW + 2, y + 4, { width: deptColW - 4, align: i === 0 ? 'left' : 'center' }));
  y += ROW_HEIGHT;
  doc.font('Helvetica').fontSize(7).fillColor('#334155');
  departments.forEach((d, i) => {
    if (i % 2 === 1) doc.rect(marginLeft, y, pageWidth, ROW_HEIGHT).fill('#f8fafc');
    const vals = [d.department, String(d.employees), ...(showAtt ? [String(d.present)] : []), ...(showLeave ? [String(d.leaveTaken)] : []), ...(showPayroll ? [fmtMoney(d.gross), fmtMoney(d.net)] : [])];
    vals.forEach((v, ci) => doc.text(v, marginLeft + ci * deptColW + 2, y + 4, { width: deptColW - 4, align: ci === 0 ? 'left' : 'center', ellipsis: true }));
    y += ROW_HEIGHT;
  });
  doc.y = y + 10; doc.x = marginLeft;

  // Employee-Level Consolidated Summary — every selected column, one row
  // per employee (rows already arrive pre-merged, no further pivoting).
  doc.fontSize(9).fillColor('#0f172a').font('Helvetica-Bold').text('Employee-Level Consolidated Summary');
  doc.moveDown(0.2);
  const colW = pageWidth / Math.max(columns.length, 1);
  const drawHeader = (yy: number) => {
    doc.rect(marginLeft, yy, pageWidth, ROW_HEIGHT).fill(theme.tableHeaderHex);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(6.5);
    let x = marginLeft;
    for (const c of columns) { doc.text(c.label, x + 2, yy + 4, { width: colW - 4, ellipsis: true }); x += colW; }
  };
  y = doc.y;
  drawHeader(y); y += ROW_HEIGHT;
  doc.font('Helvetica').fontSize(6.5);
  const sortedRows = [...rows].sort((a, b) => String(a.employeeName).localeCompare(String(b.employeeName)));
  sortedRows.forEach((row, i) => {
    if (y + ROW_HEIGHT > doc.page.height - PAGE_MARGIN - 20) { doc.addPage(); y = PAGE_MARGIN; drawHeader(y); y += ROW_HEIGHT; doc.font('Helvetica').fontSize(6.5); }
    if (i % 2 === 1) doc.rect(marginLeft, y, pageWidth, ROW_HEIGHT).fill('#f8fafc');
    doc.fillColor('#334155');
    let x = marginLeft;
    for (const c of columns) {
      doc.text(formatValue(row[c.key], c.format), x + 2, y + 4, { width: colW - 4, ellipsis: true });
      x += colW;
    }
    y += ROW_HEIGHT;
  });
  doc.y = y + 8;
  doc.x = marginLeft;
}

export async function buildReportPdf(
  rows: any[],
  summary: Record<string, any>,
  meta: ReportExportMeta,
  columns: ReportColumnMeta[],
  summaryFields: ReportSummaryFieldMeta[],
): Promise<Buffer> {
  const theme = resolveTheme(meta.themeId);
  const logoBuffer = await fetchLogoBuffer(meta.logoUrl);

  return new Promise((resolve, reject) => {
    const resolvedOrientation = meta.orientation && meta.orientation !== 'auto' ? meta.orientation : (columns.length > 6 ? 'landscape' : 'portrait');
    // bufferPages is required here: the watermark/footer loop below runs
    // AFTER all content is drawn and calls switchToPage() on every page.
    // Without buffering, pdfkit flushes early pages to the output stream as
    // soon as a later page starts, so switchToPage(0) throws once a report
    // spans more than a couple of pages — exactly what the Attendance
    // Register layout does (its addPage() calls happen once per employee).
    const doc = new PDFDocument({ margin: PAGE_MARGIN, size: meta.pageSize || 'A4', layout: resolvedOrientation, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - PAGE_MARGIN * 2;

    const drawBrandedHeader = () => {
      doc.rect(PAGE_MARGIN, PAGE_MARGIN, pageWidth, HEADER_BAND_HEIGHT).fill(theme.headerHex);
      let textX = PAGE_MARGIN + 14;
      if (logoBuffer) {
        try {
          doc.image(logoBuffer, PAGE_MARGIN + 10, PAGE_MARGIN + 10, { fit: [44, 44] });
          textX = PAGE_MARGIN + 66;
        } catch {
          // malformed image data — fall back to text-only header
        }
      }
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(15).text(meta.tenantName, textX, PAGE_MARGIN + 10, { width: pageWidth - (textX - PAGE_MARGIN) - 10 });
      doc.font('Helvetica').fontSize(10).text(meta.title, textX, PAGE_MARGIN + 30);
      if (meta.tenantAddress) doc.fontSize(8).text(meta.tenantAddress, textX, PAGE_MARGIN + 46);
      doc.y = PAGE_MARGIN + HEADER_BAND_HEIGHT + 12;
      doc.x = PAGE_MARGIN;

      doc.fontSize(8).font('Helvetica').fillColor('#64748b');
      doc.text(`Prepared for: ${meta.filtersDescription}`);
      doc.text(`Generated by ${meta.generatedByName || meta.generatedByEmail} on ${meta.generatedAt.toLocaleString()} (${meta.timezone})`);
      doc.moveDown(0.5);

      if (meta.layoutId === 'weekly_grid' && meta.filterChips && meta.filterChips.length > 0) {
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor(theme.accentHex);
        doc.text(meta.filterChips.map((c) => `${c.label}: ${c.value}`).join('     '));
        doc.moveDown(0.4);
      }
    };

    drawBrandedHeader();

    // Executive Summary draws its own column-gated KPI row (matching the
    // preview's attendanceExec cards exactly); Employee Attendance Summary
    // intentionally shows no cards at all (flat table only, per the preview).
    // Both skip this generic Totals-driven card block so the two KPI
    // sources never show two different metric sets for the same report.
    const isAttendanceShapedExport = columns.some((c) => c.key === 'date') && rows.some((r) => r.date);
    const isLeaveShapedExport = columns.some((c) => c.key === 'leaveType') && rows.some((r) => r.leaveType);
    const isPayrollShapedExport = columns.some((c) => c.key === 'grossSalary') && rows.some((r) => r.grossSalary !== undefined);
    const isConsolidatedShapedExport = columns.some((c) => c.key === 'attendancePct');
    const usesCustomKpiCards = (isAttendanceShapedExport && (meta.layoutId === 'executive' || meta.layoutId === 'employee_summary')) || ((isLeaveShapedExport || isPayrollShapedExport || isConsolidatedShapedExport) && meta.layoutId === 'executive');

    // KPI summary cards before the table — every layout except the
    // multi-line text fallback below (used only when there's nothing to
    // show as cards).
    if (!usesCustomKpiCards && summaryFields.length > 0) {
      doc.fontSize(10).fillColor('#0f172a').font('Helvetica-Bold').text('Summary');
      doc.moveDown(0.2);
      const cardW = (pageWidth - 12 * 2) / 3;
      const cardH = 36;
      let cx = PAGE_MARGIN;
      let cy = doc.y;
      summaryFields.forEach((f, i) => {
        if (i > 0 && i % 3 === 0) { cx = PAGE_MARGIN; cy += cardH + 8; }
        doc.rect(cx, cy, cardW, cardH).fillAndStroke('#f8fafc', '#e2e8f0');
        doc.fillColor('#64748b').font('Helvetica').fontSize(7).text(f.label.toUpperCase(), cx + 8, cy + 6, { width: cardW - 16 });
        doc.fillColor(theme.accentHex).font('Helvetica-Bold').fontSize(13).text(formatValue(summary?.[f.key], f.format), cx + 8, cy + 18, { width: cardW - 16 });
        cx += cardW + 12;
      });
      doc.y = cy + cardH + 16;
      doc.x = PAGE_MARGIN;
    }

    // Table
    if (rows.length === 0 || columns.length === 0) {
      doc.fontSize(10).fillColor('#64748b').text('No data for the selected filters.');
    } else if (meta.layoutId === 'weekly_grid') {
      drawWeeklyGridTable(doc, rows, columns, pageWidth, PAGE_MARGIN, theme);
    } else if (meta.layoutId === 'executive' && columns.some((c) => c.key === 'date') && rows.some((r) => r.date)) {
      drawAttendanceExecutiveSummary(doc, rows, columns, pageWidth, PAGE_MARGIN, theme);
    } else if (meta.layoutId === 'executive' && columns.some((c) => c.key === 'leaveType') && rows.some((r) => r.leaveType)) {
      drawLeaveExecutiveSummary(doc, rows, pageWidth, PAGE_MARGIN, theme);
    } else if (meta.layoutId === 'executive' && columns.some((c) => c.key === 'grossSalary') && rows.some((r) => r.grossSalary !== undefined)) {
      drawPayrollExecutiveSummary(doc, rows, pageWidth, PAGE_MARGIN, theme);
    } else if (meta.layoutId === 'executive' && columns.some((c) => c.key === 'attendancePct')) {
      drawConsolidatedSummary(doc, rows, columns, pageWidth, PAGE_MARGIN, theme);
    } else if (meta.layoutId === 'employee_summary' && columns.some((c) => c.key === 'date') && rows.some((r) => r.date)) {
      drawEmployeeSummaryTable(doc, rows, columns, pageWidth, PAGE_MARGIN, theme);
    } else if (meta.layoutId === 'detailed' && columns.some((c) => c.key === 'date') && rows.some((r) => r.date)) {
      drawAttendanceRegister(doc, rows, columns, pageWidth, PAGE_MARGIN, theme);
    } else {
      const colWidth = pageWidth / columns.length;

      const drawTableHeaderRow = (y: number) => {
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff');
        doc.rect(PAGE_MARGIN, y, pageWidth, ROW_HEIGHT).fill(theme.tableHeaderHex);
        doc.fillColor('#ffffff');
        columns.forEach((c, i) => {
          doc.text(c.label, PAGE_MARGIN + i * colWidth + 2, y + 4, { width: colWidth - 4, height: ROW_HEIGHT, ellipsis: true });
        });
      };

      let y = doc.y;
      drawTableHeaderRow(y);
      y += ROW_HEIGHT;

      doc.font('Helvetica').fontSize(8);
      rows.forEach((row, rowIdx) => {
        if (y + ROW_HEIGHT > doc.page.height - PAGE_MARGIN - 20) {
          doc.addPage();
          y = PAGE_MARGIN;
          drawTableHeaderRow(y);
          y += ROW_HEIGHT;
          doc.font('Helvetica').fontSize(8);
        }
        if (rowIdx % 2 === 1) {
          doc.rect(PAGE_MARGIN, y, pageWidth, ROW_HEIGHT).fill('#f8fafc');
        }
        columns.forEach((c, i) => {
          const displayVal = formatValue(row[c.key], c.format);
          const isStatusCol = c.key === 'status' || c.key === 'approvalStatus';
          const color = isStatusCol ? statusColor(displayVal) : null;
          doc.fillColor(color || '#0f172a').font(color ? 'Helvetica-Bold' : 'Helvetica');
          doc.text(displayVal, PAGE_MARGIN + i * colWidth + 2, y + 4, { width: colWidth - 4, height: ROW_HEIGHT, ellipsis: true });
        });
        doc.font('Helvetica');
        y += ROW_HEIGHT;
      });
      doc.y = y + 10;
      doc.x = PAGE_MARGIN;
    }

    if (meta.layoutId === 'weekly_grid' && rows.length > 0 && columns.length > 0) {
      if (doc.y + 50 > doc.page.height - PAGE_MARGIN - 20) { doc.addPage(); doc.y = PAGE_MARGIN; }
      doc.moveDown(0.8);
      doc.fontSize(7).font('Helvetica').fillColor('#64748b').text(
        'P = Present   L = Late   A = Absent   LV = On Leave   WO = Weekly Off   – = Not Applicable',
      );
      doc.moveDown(1);
      const colW = pageWidth / 3;
      const labelY = doc.y;
      doc.fontSize(8).fillColor('#334155');
      doc.text('Prepared by', PAGE_MARGIN, labelY, { width: colW });
      doc.text('Approved by', PAGE_MARGIN + colW, labelY, { width: colW });
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#0f172a');
      doc.text('HR Admin', PAGE_MARGIN, labelY + 22, { width: colW });
      doc.text('HR Manager', PAGE_MARGIN + colW, labelY + 22, { width: colW });
      doc.y = labelY + 40;
      doc.x = PAGE_MARGIN;
    }

    if (doc.y + 25 > doc.page.height - PAGE_MARGIN - 20) {
      doc.addPage();
      doc.y = PAGE_MARGIN;
    }

    if (meta.signatureLine) {
      doc.fontSize(9).fillColor('#334155').font('Helvetica').text(meta.signatureLine, PAGE_MARGIN, doc.y, { lineBreak: false });
    } else {
      doc.fontSize(8).fillColor('#94a3b8').font('Helvetica').text('Digitally generated — no signature required', PAGE_MARGIN, doc.y, { lineBreak: false });
    }

    // ── Remove blank trailing pages ──
    // PDFKit auto-creates pages when text() calls overflow a page boundary.
    // After all content is drawn, any page whose y cursor never advanced
    // past the top margin is an empty artifact. We detect these by
    // flipping through the buffer and removing blank trailing pages.
    // Since _pageBuffer is a PDFKit internal, we guard with a try/catch.
    try {
      const docAny = doc as any;
      const buf = docAny._pageBuffer;
      if (Array.isArray(buf) && buf.length > 1) {
        // We know the signature text just landed on the CURRENT page.
        // Find which index in the buffer that is.
        const currentPage = docAny.page;
        const currentIdx = buf.indexOf(currentPage);
        // Everything after currentIdx is a blank auto-page — remove it.
        if (currentIdx >= 0 && currentIdx < buf.length - 1) {
          buf.splice(currentIdx + 1);
        }
      }
    } catch {
      // If the internal API changed, just skip — we'll have blank pages
      // but won't crash the export.
    }

    // Watermark + page numbers + confidentiality footer on every page
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      if (meta.showWatermark) {
        doc.save();
        doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
        doc.fontSize(48).fillColor('#e2e8f0').opacity(0.35).font('Helvetica-Bold').text(
          theme.watermark, 0, doc.page.height / 2 - 24, { align: 'center', width: doc.page.width, lineBreak: false },
        );
        doc.opacity(1);
        doc.restore();
      }
      doc.fontSize(7).fillColor('#94a3b8').text(
        `Confidential — generated by ${meta.tenantName} via Smart Teams EMS · Page ${i + 1} of ${pageCount}`,
        PAGE_MARGIN,
        doc.page.height - PAGE_MARGIN + 10,
        { align: 'center', width: doc.page.width - PAGE_MARGIN * 2, lineBreak: false },
      );
    }

    doc.end();
  });
}
