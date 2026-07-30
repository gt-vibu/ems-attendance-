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
