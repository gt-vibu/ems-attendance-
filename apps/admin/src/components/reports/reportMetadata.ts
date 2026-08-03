import { ReactNode } from 'react';

export type FieldDataType = 'string' | 'number' | 'currency' | 'percentage' | 'datetime' | 'badge' | 'status';
export type AggregationType = 'sum' | 'avg' | 'count' | 'min' | 'max' | 'none';

export interface ReportFieldMetadata {
  id: string;
  label: string;
  category: 'employee' | 'attendance' | 'leave' | 'payroll' | 'compliance' | 'performance';
  dataType: FieldDataType;
  permission?: string;
  aggregation?: AggregationType;
  sortable?: boolean;
  filterable?: boolean;
  groupable?: boolean;
  defaultWidth?: number;
  exportable?: boolean;
  visibleByDefault?: boolean;
  description?: string;
}

export interface ReportSectionConfig {
  id: string;
  type: 'header' | 'kpi_cards' | 'chart_analytics' | 'dept_comparison' | 'data_table' | 'compliance_alerts' | 'payroll_summary' | 'signature_block' | 'audit_footer';
  title: string;
  description: string;
  enabled: boolean;
  order: number;
}

export interface KpiMetricConfig {
  id: string;
  title: string;
  valueKey: string;
  format: 'number' | 'currency' | 'percentage' | 'hours';
  enabled: boolean;
  iconName: string;
  trend?: string;
  color: string;
}

export interface BusinessTemplatePreset {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  selectedFields: string[];
  enabledSections: string[];
  theme: string;
  defaultDateRange: string;
  badge?: string;
}

export interface ReportSnapshot {
  id: string;
  version: string;
  reportName: string;
  category: string;
  generatedBy: string;
  generatedAt: string;
  recordCount: number;
  hash: string;
  confidentiality: 'Public' | 'Internal' | 'Confidential' | 'Strictly Secret';
  filters: Record<string, any>;
  sections: string[];
  fields: string[];
  snapshotData: any[];
  digitalSignature: string;
}

// Drives the Reports wizard (ReportsPage.tsx): selecting a report type
// swaps which columns/summary fields are shown, structurally (not by
// convention) — a type's `columns` list is the only source the column
// checklist and preview table read from, so a payroll field can never leak
// into an attendance report. Column `key`s match the exact row field names
// buildReportData() (api/services/reportData.ts) already returns for that
// type — see buildAttendanceReport/buildLeaveReport/buildPayrollReport.
export interface WizardColumn {
  key: string;
  label: string;
  default: boolean;
  format?: 'hours' | 'currency' | 'boolean';
  group?: string; // sidebar column-picker grouping, e.g. 'Employee Info' | 'Attendance' | 'Verification' | 'Other'
}

export interface WizardSummaryField {
  key: string; // reads reportData.summary[key]
  label: string;
  format?: 'hours' | 'currency' | 'percentage';
}

export interface ReportTypeConfig {
  id: string;
  label: string;
  backendType: string; // filters.type sent to /api/reports/data
  description: string;
  requiresPrivilege?: string; // e.g. 'payroll.read'
  comingSoon?: boolean;
  toggleFilters?: Array<{ key: 'wfhOnly' | 'lateOnly' | 'overtimeOnly' | 'exceptionsOnly'; label: string }>;
  columns: WizardColumn[];
  summaryFields: WizardSummaryField[];
}

export const REPORT_TYPE_CONFIG: ReportTypeConfig[] = [
  {
    id: 'attendance',
    label: 'Attendance',
    backendType: 'attendance',
    description: 'Daily check-in/check-out, status, hours and late minutes per employee.',
    toggleFilters: [
      { key: 'wfhOnly', label: 'WFH Only' },
      { key: 'lateOnly', label: 'Late Only' },
      { key: 'exceptionsOnly', label: 'Exceptions Only' },
    ],
    columns: [
      { key: 'employeeId', label: 'ID', default: true, group: 'Employee Info' },
      { key: 'employeeName', label: 'Employee Name', default: true, group: 'Employee Info' },
      { key: 'designation', label: 'Designation', default: true, group: 'Employee Info' },
      { key: 'department', label: 'Department', default: true, group: 'Employee Info' },
      { key: 'present', label: 'Present (Days)', default: true, group: 'Attendance' },
      { key: 'absent', label: 'Absent (Days)', default: true, group: 'Attendance' },
      { key: 'leave', label: 'Leave (Days)', default: true, group: 'Attendance' },
      { key: 'workingHours', label: 'Hours Logged', default: true, format: 'hours', group: 'Attendance' },
      { key: 'attendancePct', label: 'Attendance %', default: true, group: 'Attendance' },
      { key: 'status', label: 'Status', default: true, group: 'Attendance' },
      { key: 'date', label: 'Date', default: false, group: 'Attendance' },
      { key: 'checkIn', label: 'Check In', default: false, group: 'Attendance' },
      { key: 'checkOut', label: 'Check Out', default: false, group: 'Attendance' },
      { key: 'lateMins', label: 'Late (mins)', default: false, group: 'Attendance' },
      { key: 'overtimeHours', label: 'Overtime', default: false, format: 'hours', group: 'Attendance' },
      { key: 'isWfh', label: 'WFH', default: false, format: 'boolean', group: 'Verification' },
      { key: 'verificationMode', label: 'Attendance Mode', default: false, group: 'Verification' },
      { key: 'approvalStatus', label: 'Approval Status', default: false, group: 'Other' },
      { key: 'notes', label: 'Notes', default: false, group: 'Other' },
    ],
    summaryFields: [
      { key: 'totalEmployees', label: 'Total Employees' },
      { key: 'presentCount', label: 'Present' },
      { key: 'absentCount', label: 'Absent' },
      { key: 'lateCount', label: 'Late' },
      { key: 'halfDayCount', label: 'Half Day' },
      { key: 'totalHours', label: 'Total Hours', format: 'hours' },
      { key: 'overtimeHours', label: 'Overtime', format: 'hours' },
    ],
  },
  {
    id: 'leave',
    label: 'Leave',
    backendType: 'leave',
    description: 'Leave requests, approvals and balances for the selected period.',
    columns: [
      { key: 'employeeName', label: 'Employee', default: true, group: 'Employee Info' },
      { key: 'department', label: 'Department', default: true, group: 'Employee Info' },
      { key: 'leaveType', label: 'Leave Type', default: true, group: 'Leave' },
      { key: 'startDate', label: 'Start Date', default: true, group: 'Leave' },
      { key: 'endDate', label: 'End Date', default: true, group: 'Leave' },
      { key: 'daysCount', label: 'Days', default: true, group: 'Leave' },
      { key: 'status', label: 'Status', default: true, group: 'Leave' },
      { key: 'reason', label: 'Reason', default: false, group: 'Other' },
      { key: 'appliedOn', label: 'Applied On', default: false, group: 'Other' },
    ],
    summaryFields: [
      { key: 'totalLeaves', label: 'Applied' },
      { key: 'approvedCount', label: 'Approved' },
      { key: 'rejectedCount', label: 'Rejected' },
      { key: 'pendingCount', label: 'Pending' },
      { key: 'totalDays', label: 'Total Days' },
    ],
  },
  {
    id: 'payroll',
    label: 'Payroll',
    backendType: 'payroll',
    description: 'Processed payroll runs: gross, deductions and net pay per employee.',
    requiresPrivilege: 'payroll.read',
    columns: [
      { key: 'employeeName', label: 'Employee', default: true, group: 'Employee Info' },
      { key: 'department', label: 'Department', default: true, group: 'Employee Info' },
      { key: 'monthYear', label: 'Period', default: true, group: 'Payroll' },
      { key: 'grossSalary', label: 'Gross', default: true, format: 'currency', group: 'Payroll' },
      { key: 'deductions', label: 'Deductions', default: true, format: 'currency', group: 'Payroll' },
      { key: 'netSalary', label: 'Net Salary', default: true, format: 'currency', group: 'Payroll' },
      { key: 'lopDays', label: 'LOP Days', default: false, group: 'Payroll' },
      { key: 'pfAmount', label: 'PF', default: false, format: 'currency', group: 'Payroll' },
      { key: 'esiAmount', label: 'ESI', default: false, format: 'currency', group: 'Payroll' },
      { key: 'taxAmount', label: 'Tax (TDS)', default: false, format: 'currency', group: 'Payroll' },
      { key: 'loanRecovery', label: 'Loan/Advance Recovery', default: false, format: 'currency', group: 'Payroll' },
      { key: 'bonusPaid', label: 'Bonus/Reimbursement', default: false, format: 'currency', group: 'Payroll' },
      { key: 'status', label: 'Status', default: false, group: 'Other' },
    ],
    summaryFields: [
      { key: 'processedCount', label: 'Payslips' },
      { key: 'totalGross', label: 'Total Gross', format: 'currency' },
      { key: 'totalDeductions', label: 'Total Deductions', format: 'currency' },
      { key: 'totalPayout', label: 'Total Net Payout', format: 'currency' },
      { key: 'avgSalary', label: 'Avg. Salary', format: 'currency' },
    ],
  },
  {
    id: 'overtime',
    label: 'Shift & Overtime',
    backendType: 'overtime',
    description: 'Overtime hours and late arrivals, same attendance data filtered to what needs review.',
    toggleFilters: [
      { key: 'overtimeOnly', label: 'Overtime Only' },
      { key: 'lateOnly', label: 'Late Only' },
    ],
    columns: [
      { key: 'employeeName', label: 'Employee', default: true, group: 'Employee Info' },
      { key: 'department', label: 'Department', default: true, group: 'Employee Info' },
      { key: 'date', label: 'Date', default: true, group: 'Attendance' },
      { key: 'checkIn', label: 'Check In', default: true, group: 'Attendance' },
      { key: 'checkOut', label: 'Check Out', default: true, group: 'Attendance' },
      { key: 'workingHours', label: 'Working Hours', default: true, format: 'hours', group: 'Attendance' },
      { key: 'overtimeHours', label: 'Overtime', default: true, format: 'hours', group: 'Attendance' },
      { key: 'lateMins', label: 'Late (mins)', default: true, group: 'Attendance' },
    ],
    summaryFields: [
      { key: 'totalHours', label: 'Total Hours', format: 'hours' },
      { key: 'overtimeHours', label: 'Total Overtime', format: 'hours' },
      { key: 'lateCount', label: 'Late Instances' },
    ],
  },
  {
    id: 'consolidated',
    label: 'Consolidated (Attendance + Leave + Payroll)',
    backendType: 'consolidated',
    description: 'One employee-level report merging Attendance, Leave, and Payroll — pick any combination of the three modules.',
    columns: [
      { key: 'employeeId', label: 'Employee ID', default: true, group: 'Employee Info' },
      { key: 'employeeName', label: 'Employee Name', default: true, group: 'Employee Info' },
      { key: 'department', label: 'Department', default: true, group: 'Employee Info' },
      { key: 'designation', label: 'Designation', default: true, group: 'Employee Info' },
      { key: 'attendancePct', label: 'Attendance %', default: true, group: 'Attendance' },
      { key: 'presentDays', label: 'Present Days', default: true, group: 'Attendance' },
      { key: 'lateCount', label: 'Late Count', default: false, group: 'Attendance' },
      { key: 'workingHours', label: 'Working Hours', default: false, format: 'hours', group: 'Attendance' },
      { key: 'overtimeHours', label: 'Overtime', default: false, format: 'hours', group: 'Attendance' },
      { key: 'leaveTaken', label: 'Leave Taken', default: true, group: 'Leave' },
      { key: 'grossPay', label: 'Gross Pay', default: true, format: 'currency', group: 'Payroll' },
      { key: 'deductions', label: 'Deductions', default: true, format: 'currency', group: 'Payroll' },
      { key: 'netPay', label: 'Net Pay', default: true, format: 'currency', group: 'Payroll' },
      { key: 'payrollStatus', label: 'Payroll Status', default: false, group: 'Payroll' },
    ],
    summaryFields: [
      { key: 'totalEmployees', label: 'Total Employees' },
      { key: 'presentCount', label: 'Present' },
      { key: 'absentCount', label: 'Absent' },
      { key: 'leaveTakenTotal', label: 'Leave Taken' },
      { key: 'totalGross', label: 'Gross Pay', format: 'currency' },
      { key: 'totalDeductions', label: 'Deductions', format: 'currency' },
      { key: 'totalPayout', label: 'Net Pay', format: 'currency' },
    ],
  },
  {
    id: 'compliance',
    label: 'Compliance',
    backendType: 'compliance',
    description: 'Not available yet — no compliance data model exists in this system yet.',
    comingSoon: true,
    columns: [],
    summaryFields: [],
  },
];

// Enterprise Metadata-Driven Field Catalog
export const REPORT_FIELDS_METADATA: ReportFieldMetadata[] = [
  // Employee Info
  { id: 'employeeCode', label: 'Employee ID', category: 'employee', dataType: 'string', sortable: true, filterable: true, visibleByDefault: true, defaultWidth: 110 },
  { id: 'employeeName', label: 'Employee Name', category: 'employee', dataType: 'string', sortable: true, filterable: true, visibleByDefault: true, defaultWidth: 180 },
  { id: 'department', label: 'Department', category: 'employee', dataType: 'string', sortable: true, filterable: true, groupable: true, visibleByDefault: true, defaultWidth: 150 },
  { id: 'designation', label: 'Designation / Role', category: 'employee', dataType: 'string', sortable: true, filterable: true, groupable: true, visibleByDefault: true, defaultWidth: 160 },
  { id: 'branchName', label: 'Branch / Office Location', category: 'employee', dataType: 'string', sortable: true, filterable: true, groupable: true, visibleByDefault: true, defaultWidth: 150 },

  // Attendance Metrics
  { id: 'checkInTime', label: 'Check-In Timestamp', category: 'attendance', dataType: 'datetime', sortable: true, filterable: true, visibleByDefault: true, defaultWidth: 160 },
  { id: 'checkOutTime', label: 'Check-Out Timestamp', category: 'attendance', dataType: 'datetime', sortable: true, filterable: true, visibleByDefault: true, defaultWidth: 160 },
  { id: 'workingHours', label: 'Net Working Hours', category: 'attendance', dataType: 'number', aggregation: 'avg', sortable: true, filterable: true, visibleByDefault: true, defaultWidth: 140 },
  { id: 'lateMinutes', label: 'Late Arrival (Mins)', category: 'attendance', dataType: 'number', aggregation: 'sum', sortable: true, filterable: true, visibleByDefault: true, defaultWidth: 130 },
  { id: 'earlyDepartureMins', label: 'Early Departure (Mins)', category: 'attendance', dataType: 'number', aggregation: 'sum', sortable: true, filterable: true, defaultWidth: 140 },
  { id: 'attendanceStatus', label: 'Attendance Status', category: 'attendance', dataType: 'badge', sortable: true, filterable: true, groupable: true, visibleByDefault: true, defaultWidth: 130 },
  { id: 'verificationMode', label: 'Auth Mode (Face/QR/GPS)', category: 'attendance', dataType: 'string', sortable: true, filterable: true, groupable: true, defaultWidth: 150 },

  // Overtime & Shifts
  { id: 'overtimeHours', label: 'Approved Overtime (Hrs)', category: 'attendance', dataType: 'number', aggregation: 'sum', sortable: true, filterable: true, visibleByDefault: true, defaultWidth: 150 },
  { id: 'shiftName', label: 'Assigned Shift', category: 'attendance', dataType: 'string', sortable: true, filterable: true, groupable: true, defaultWidth: 140 },

  // Leave & Absence
  { id: 'leaveType', label: 'Leave Type / Reason', category: 'leave', dataType: 'string', sortable: true, filterable: true, groupable: true, defaultWidth: 140 },
  { id: 'leaveDays', label: 'Leave Duration (Days)', category: 'leave', dataType: 'number', aggregation: 'sum', sortable: true, filterable: true, defaultWidth: 140 },

  // Payroll (RBAC Restricted)
  { id: 'basicSalary', label: 'Basic Salary ($)', category: 'payroll', dataType: 'currency', permission: 'payroll.read', aggregation: 'sum', sortable: true, filterable: true, defaultWidth: 140 },
  { id: 'allowances', label: 'Total Allowances ($)', category: 'payroll', dataType: 'currency', permission: 'payroll.read', aggregation: 'sum', sortable: true, filterable: true, defaultWidth: 140 },
  { id: 'deductions', label: 'Statutory Deductions ($)', category: 'payroll', dataType: 'currency', permission: 'payroll.read', aggregation: 'sum', sortable: true, filterable: true, defaultWidth: 150 },
  { id: 'netPayable', label: 'Net Payable Amount ($)', category: 'payroll', dataType: 'currency', permission: 'payroll.read', aggregation: 'sum', sortable: true, filterable: true, visibleByDefault: true, defaultWidth: 160 },

  // Compliance & Security
  { id: 'geofenceViolation', label: 'Geofence Exit Alert', category: 'compliance', dataType: 'badge', sortable: true, filterable: true, groupable: true, defaultWidth: 140 },
  { id: 'ipAddress', label: 'Source Device IP', category: 'compliance', dataType: 'string', filterable: true, defaultWidth: 140 },
  { id: 'supervisorApproval', label: 'Manager Approval Status', category: 'compliance', dataType: 'badge', sortable: true, filterable: true, visibleByDefault: true, defaultWidth: 160 }
];

// Pre-configured Enterprise Business Templates
export const BUSINESS_TEMPLATES_PRESETS: BusinessTemplatePreset[] = [
  {
    id: 'tpl_exec_summary',
    name: 'Executive Leadership Briefing',
    category: 'Executive',
    description: 'High-level workforce health, total headcount metrics, presence trends, and payroll expenditure summary.',
    icon: 'BarChart2',
    selectedFields: ['employeeCode', 'employeeName', 'department', 'branchName', 'attendanceStatus', 'workingHours', 'netPayable'],
    enabledSections: ['header', 'kpi_cards', 'chart_analytics', 'dept_comparison', 'data_table', 'audit_footer'],
    theme: 'executive_indigo',
    defaultDateRange: 'this_month',
    badge: 'Popular'
  },
  {
    id: 'tpl_hr_monthly',
    name: 'HR Monthly Workforce Audit',
    category: 'HR & Operations',
    description: 'Comprehensive staff attendance ledger, tardiness tracking, and leave usage analysis for HR managers.',
    icon: 'Users',
    selectedFields: ['employeeCode', 'employeeName', 'department', 'designation', 'checkInTime', 'checkOutTime', 'workingHours', 'lateMinutes', 'attendanceStatus'],
    enabledSections: ['header', 'kpi_cards', 'data_table', 'compliance_alerts', 'audit_footer'],
    theme: 'clean_slate',
    defaultDateRange: 'last_30_days',
    badge: 'Standard'
  },
  {
    id: 'tpl_finance_payroll',
    name: 'Finance & Payroll Reconciliation',
    category: 'Finance',
    description: 'Audit-ready salary computation breakdown, overtime pay additions, and tax deduction statements.',
    icon: 'DollarSign',
    selectedFields: ['employeeCode', 'employeeName', 'department', 'basicSalary', 'allowances', 'deductions', 'overtimeHours', 'netPayable', 'supervisorApproval'],
    enabledSections: ['header', 'kpi_cards', 'payroll_summary', 'data_table', 'signature_block', 'audit_footer'],
    theme: 'emerald_finance',
    defaultDateRange: 'this_month',
    badge: 'Audit Ready'
  },
  {
    id: 'tpl_factory_shift',
    name: 'Factory & Shift Operations Ledger',
    category: 'Operations',
    description: 'Shift roster compliance, late check-in minutes, overtime distribution, and operational floor stats.',
    icon: 'Clock',
    selectedFields: ['employeeCode', 'employeeName', 'branchName', 'shiftName', 'checkInTime', 'checkOutTime', 'workingHours', 'overtimeHours', 'lateMinutes'],
    enabledSections: ['header', 'kpi_cards', 'chart_analytics', 'data_table', 'audit_footer'],
    theme: 'amber_amber',
    defaultDateRange: 'this_week',
    badge: 'Shift Operations'
  },
  {
    id: 'tpl_compliance_security',
    name: 'Compliance & Security Audit Log',
    category: 'Compliance',
    description: 'Geofence violation flags, unexpected IP addresses, supervisor approval trails, and biometric verification logs.',
    icon: 'ShieldAlert',
    selectedFields: ['employeeCode', 'employeeName', 'department', 'checkInTime', 'verificationMode', 'geofenceViolation', 'ipAddress', 'supervisorApproval'],
    enabledSections: ['header', 'compliance_alerts', 'data_table', 'signature_block', 'audit_footer'],
    theme: 'rose_compliance',
    defaultDateRange: 'this_month',
    badge: 'ISO 27001'
  }
];

export interface ReportLayout {
  id: string;
  label: string;
  description: string;
}

// Wired into both the live preview (ReportPreview.tsx) and the server PDF/
// Excel builders (api/services/reportFileExport.ts) via the same
// themeId/layoutId query params, so switching one changes both identically.
export const REPORT_LAYOUTS: ReportLayout[] = [
  { id: 'standard', label: 'Standard Table', description: 'Branded header, data table, totals footer — the default.' },
  { id: 'executive', label: 'Executive Summary', description: 'KPI cards, charts, insights, and department summary before any table — for a CEO/HR-head-facing read.' },
  { id: 'employee_summary', label: 'Employee Attendance Summary', description: 'One row per employee — attendance %, present/absent/leave/late, working hours. What HR downloads most.' },
  { id: 'compact', label: 'Compact Register', description: 'Smaller rows, no summary cards — for printing long rosters.' },
  { id: 'detailed', label: 'Attendance Register', description: 'One section per employee with their own date-by-date rows and a per-employee summary — for auditors, not a flat repeated-name list.' },
  { id: 'register', label: 'Register', description: 'Grouped by pay component (payroll) or leave type (leave) instead of one flat table.' },
  { id: 'weekly_grid', label: 'Weekly Attendance Grid', description: 'One column per day with a status icon per employee, a TOTAL row, and a legend — attendance-type reports only.' },
];

// Rich Report Design Themes
export const ENHANCED_REPORT_THEMES = [
  {
    id: 'executive_indigo',
    name: 'Executive Indigo (Classic)',
    headerBg: 'bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900',
    headerText: 'text-white',
    accentColor: '#4f46e5',
    tableHeaderBg: 'bg-indigo-50/80',
    tableHeaderText: 'text-indigo-950',
    borderStyle: 'border-indigo-200',
    kpiCardBg: 'bg-white',
    chartPalette: ['#4f46e5', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'],
    watermark: 'CONFIDENTIAL EXECUTIVE BRIEF'
  },
  {
    id: 'clean_slate',
    name: 'Minimal Slate & Quartz',
    headerBg: 'bg-slate-900',
    headerText: 'text-slate-100',
    accentColor: '#0f172a',
    tableHeaderBg: 'bg-slate-100',
    tableHeaderText: 'text-slate-800',
    borderStyle: 'border-slate-200',
    kpiCardBg: 'bg-slate-50/60',
    chartPalette: ['#334155', '#64748b', '#0284c7', '#16a34a', '#dc2626'],
    watermark: 'INTERNAL HR AUDIT'
  },
  {
    id: 'emerald_finance',
    name: 'Emerald Finance & Audit',
    headerBg: 'bg-gradient-to-r from-emerald-900 via-teal-900 to-slate-900',
    headerText: 'text-emerald-50',
    accentColor: '#059669',
    tableHeaderBg: 'bg-emerald-50/80',
    tableHeaderText: 'text-emerald-950',
    borderStyle: 'border-emerald-200',
    kpiCardBg: 'bg-emerald-50/30',
    chartPalette: ['#059669', '#0284c7', '#8b5cf6', '#d97706', '#f43f5e'],
    watermark: 'APPROVED PAYROLL DOCUMENT'
  },
  {
    id: 'amber_amber',
    name: 'Amber Industrial Operations',
    headerBg: 'bg-gradient-to-r from-amber-900 via-stone-900 to-slate-900',
    headerText: 'text-amber-100',
    accentColor: '#d97706',
    tableHeaderBg: 'bg-amber-50',
    tableHeaderText: 'text-amber-950',
    borderStyle: 'border-amber-200',
    kpiCardBg: 'bg-white',
    chartPalette: ['#d97706', '#2563eb', '#059669', '#7c3aed', '#e11d48'],
    watermark: 'OPERATIONAL REPORT'
  },
  {
    id: 'rose_compliance',
    name: 'Rose Shield & Security',
    headerBg: 'bg-gradient-to-r from-rose-950 via-slate-900 to-zinc-900',
    headerText: 'text-rose-100',
    accentColor: '#e11d48',
    tableHeaderBg: 'bg-rose-50',
    tableHeaderText: 'text-rose-950',
    borderStyle: 'border-rose-200',
    kpiCardBg: 'bg-white',
    chartPalette: ['#e11d48', '#2563eb', '#10b981', '#f59e0b', '#6366f1'],
    watermark: 'STRICTLY CONFIDENTIAL SECURITY AUDIT'
  }
];
