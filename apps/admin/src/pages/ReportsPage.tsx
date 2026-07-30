import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { User } from '../lib/auth';
import { ReportsSidebar } from '../components/ReportsSidebar';
import {
  REPORT_FIELDS_METADATA,
  BUSINESS_TEMPLATES_PRESETS,
  ENHANCED_REPORT_THEMES,
  ReportSectionConfig,
  KpiMetricConfig,
  ReportSnapshot
} from '../components/reports/reportMetadata';
import { SectionBuilder } from '../components/reports/SectionBuilder';
import { KpiConfigurator } from '../components/reports/KpiConfigurator';
import { SnapshotVersionManager } from '../components/reports/SnapshotVersionManager';
import { ChartBuilderModal } from '../components/reports/ChartBuilderModal';
import { DrillDownModal } from '../components/reports/DrillDownModal';
import {
  FileText, Download, Mail, Calendar, Filter, Plus, Save, Clock, Users,
  Building2, TrendingUp, AlertTriangle, CheckCircle2, Search, Printer,
  Layers, RefreshCw, BarChart2, PieChart as PieIcon, Sliders, ChevronDown, Eye, X, ShieldAlert,
  ArrowUp, ArrowDown, Move, Check, Palette, Sparkles, Layout, Settings, FileSpreadsheet, Lock,
  History, DollarSign, ExternalLink, HelpCircle
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts';

interface ReportsPageProps {
  user: User;
  onLogout?: () => void;
  embedded?: boolean;
}

// All available report fields categorized for the Dynamic Report Designer
interface ReportField {
  id: string;
  label: string;
  category: 'employee' | 'attendance' | 'verification' | 'work' | 'leave' | 'payroll' | 'compliance';
  requiresPermission?: string;
  defaultVisible?: boolean;
}

const REPORT_FIELDS_CATALOG: ReportField[] = [
  // Employee Information
  { id: 'employeeId', label: 'Employee ID', category: 'employee', defaultVisible: true },
  { id: 'employeeName', label: 'Employee Name', category: 'employee', defaultVisible: true },
  { id: 'email', label: 'Email Address', category: 'employee' },
  { id: 'department', label: 'Department', category: 'employee', defaultVisible: true },
  { id: 'designation', label: 'Designation / Role', category: 'employee' },
  { id: 'branch', label: 'Branch / Location', category: 'employee' },
  { id: 'manager', label: 'Reporting Manager', category: 'employee' },

  // Attendance
  { id: 'date', label: 'Log Date / Period', category: 'attendance', defaultVisible: true },
  { id: 'checkIn', label: 'Check-In Time', category: 'attendance', defaultVisible: true },
  { id: 'checkOut', label: 'Check-Out Time', category: 'attendance', defaultVisible: true },
  { id: 'status', label: 'Attendance Status', category: 'attendance', defaultVisible: true },
  { id: 'workingHours', label: 'Total Working Hours', category: 'attendance', defaultVisible: true },
  { id: 'lateMins', label: 'Late Arrival (Minutes)', category: 'attendance' },
  { id: 'earlyDepartureMins', label: 'Early Departure (Mins)', category: 'attendance' },

  // Verification & Geofence
  { id: 'location', label: 'Verification Location / GPS', category: 'verification', defaultVisible: true },
  { id: 'verificationMode', label: 'Authentication Mode (Face/QR/GPS)', category: 'verification' },
  { id: 'wfhStatus', label: 'WFH / Remote Flag', category: 'verification' },

  // Work & Shift Information
  { id: 'shiftName', label: 'Assigned Shift Name', category: 'work' },
  { id: 'overtimeHours', label: 'Overtime Hours', category: 'work' },
  { id: 'breakDuration', label: 'Break Duration', category: 'work' },

  // Leave Information
  { id: 'leaveType', label: 'Leave Category / Type', category: 'leave' },
  { id: 'leaveBalance', label: 'Remaining Leave Balance', category: 'leave' },

  // Payroll (RBAC Restricted)
  { id: 'grossSalary', label: 'Gross Salary', category: 'payroll', requiresPermission: 'payroll.read' },
  { id: 'netSalary', label: 'Net Payable Salary', category: 'payroll', requiresPermission: 'payroll.read' },
  { id: 'deductions', label: 'Deductions & LOP', category: 'payroll', requiresPermission: 'payroll.read' },

  // Compliance & Audit
  { id: 'complianceAlerts', label: 'Violation / Policy Remarks', category: 'compliance' }
];

// Report Themes definition
const REPORT_THEMES = [
  { id: 'executive_blue', name: 'Executive Blue', headerBg: '#1e3a8a', headerText: '#ffffff', accentColor: '#2563eb', border: '#cbd5e1' },
  { id: 'modern_dark', name: 'Modern Dark', headerBg: '#0f172a', headerText: '#38bdf8', accentColor: '#0ea5e9', border: '#334155' },
  { id: 'hr_classic', name: 'HR Classic Slate', headerBg: '#334155', headerText: '#ffffff', accentColor: '#475569', border: '#e2e8f0' },
  { id: 'finance_green', name: 'Finance Emerald', headerBg: '#065f46', headerText: '#ffffff', accentColor: '#059669', border: '#a7f3d0' },
  { id: 'compliance_red', name: 'Compliance Red', headerBg: '#991b1b', headerText: '#ffffff', accentColor: '#dc2626', border: '#fca5a5' }
];

export default function ReportsPage({ user, embedded = false }: ReportsPageProps) {
  const token = localStorage.getItem('auth_token');
  const [searchParams, setSearchParams] = useSearchParams();

  // Real privilege check, not a hardcoded role list — 'org_admin'/
  // 'payroll_admin'/'hr_admin' aren't roles this app actually has (see
  // users.role in schema.ts). Same /api/tenant/my-privileges endpoint
  // RolePermissions.tsx already uses. This is a UI convenience only — the
  // server independently re-checks 'payroll.read' on every payroll report
  // request, so this can't be bypassed by forging the client state.
  const [myPrivileges, setMyPrivileges] = useState<string[] | 'ALL'>([]);
  useEffect(() => {
    fetch('/api/tenant/my-privileges', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setMyPrivileges(d.privileges ?? []))
      .catch(() => setMyPrivileges([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const hasPayrollPermission = myPrivileges === 'ALL' || myPrivileges.includes('payroll.read');

  // Active Category or View with persistence (URL query param -> localStorage -> default 'executive')
  const [activeCategory, setActiveCategory] = useState<string>(() => {
    const tabParam = searchParams.get('tab') || searchParams.get('category');
    const localTab = localStorage.getItem('reports_active_tab');
    const tab = tabParam || localTab || 'executive';
    if (tab === 'payroll' && !hasPayrollPermission) return 'executive';
    return tab;
  });

  const handleSelectCategory = (catId: string) => {
    if (catId === 'payroll' && !hasPayrollPermission) return;
    setActiveCategory(catId);
    localStorage.setItem('reports_active_tab', catId);
    setSearchParams({ tab: catId });
  };

  useEffect(() => {
    const tabParam = searchParams.get('tab') || searchParams.get('category');
    if (tabParam && tabParam !== activeCategory) {
      if (tabParam === 'payroll' && !hasPayrollPermission) {
        handleSelectCategory('executive');
      } else {
        setActiveCategory(tabParam);
        localStorage.setItem('reports_active_tab', tabParam);
      }
    }
  }, [searchParams, hasPayrollPermission]);

  // Authorization guard check
  if (!user || user.role === 'employee') {
    return (
      <div className="p-8 text-center bg-white rounded-xl border border-slate-200 shadow-xs max-w-lg mx-auto my-12">
        <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto mb-3" />
        <h2 className="text-xl font-bold text-slate-900">Access Restricted</h2>
        <p className="text-sm text-slate-500 mt-2 mb-4">
          You do not have authorization to view the Reports & Analytics Center. Please contact your system administrator or HR manager.
        </p>
      </div>
    );
  }

  // Filters
  const [datePreset, setDatePreset] = useState<string>('this_month');
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [department, setDepartment] = useState<string>('ALL');
  const [branchId, setBranchId] = useState<string>('ALL');
  const [status, setStatus] = useState<string>('ALL');
  const [search, setSearch] = useState<string>('');
  const [wfhOnly, setWfhOnly] = useState<boolean>(false);
  const [lateOnly, setLateOnly] = useState<boolean>(false);
  const [overtimeOnly, setOvertimeOnly] = useState<boolean>(false);

  // Data State
  const [reportData, setReportData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [departmentsList, setDepartmentsList] = useState<string[]>([]);
  const [branchesList, setBranchesList] = useState<any[]>([]);

  // REPORT DESIGNER & SECTION LAYOUT STATE
  const [designerOpen, setDesignerOpen] = useState<boolean>(false);
  const [selectedColumnIds, setSelectedColumnIds] = useState<string[]>([
    'employeeCode', 'employeeName', 'department', 'checkInTime', 'checkOutTime', 'workingHours', 'attendanceStatus'
  ]);
  const [selectedThemeId, setSelectedThemeId] = useState<string>('executive_indigo');
  const [showCoverPage, setShowCoverPage] = useState<boolean>(true);
  const [enableSmartHighlight, setEnableSmartHighlight] = useState<boolean>(true);
  const [includeBranding, setIncludeBranding] = useState<boolean>(true);
  const [companyName, setCompanyName] = useState<string>('SmartTeams Enterprise');

  // Section-Based Layout Blocks
  const [sectionsConfig, setSectionsConfig] = useState<ReportSectionConfig[]>([
    { id: 'sec_1', type: 'header', title: 'Executive Report Header', description: 'Company branding, date range, title, and metadata stamp', enabled: true, order: 1 },
    { id: 'sec_2', type: 'kpi_cards', title: 'Summary KPI Metrics', description: 'High-level card overview of workforce numbers and attendance rate', enabled: true, order: 2 },
    { id: 'sec_3', type: 'chart_analytics', title: 'Visual Analytics Charts', description: 'Attendance distribution and department comparison charts', enabled: true, order: 3 },
    { id: 'sec_4', type: 'data_table', title: 'Main Data Table', description: 'Detailed records table with selected dynamic columns', enabled: true, order: 4 },
    { id: 'sec_5', type: 'compliance_alerts', title: 'Compliance & Audit Flags', description: 'Highlight tardiness, geofence breaches, and pending approvals', enabled: true, order: 5 },
    { id: 'sec_6', type: 'payroll_summary', title: 'Payroll Expenditure Summary', description: 'Aggregated net pay and statutory deductions (Restricted)', enabled: hasPayrollPermission, order: 6 },
    { id: 'sec_7', type: 'signature_block', title: 'Digital Signatures & Approvals', description: 'HR Manager and Finance Controller sign-off box', enabled: false, order: 7 },
    { id: 'sec_8', type: 'audit_footer', title: 'Audit Footnote & Legal Stamps', description: 'Confidentiality notice, generator timestamp, and page numbers', enabled: true, order: 8 }
  ]);

  const showKpis = useMemo(() => sectionsConfig.find(s => s.type === 'kpi_cards')?.enabled ?? true, [sectionsConfig]);
  const showCharts = useMemo(() => sectionsConfig.find(s => s.type === 'chart_analytics')?.enabled ?? true, [sectionsConfig]);

  // Configurable Summary KPIs
  const [kpiMetrics, setKpiMetrics] = useState<KpiMetricConfig[]>([
    { id: 'kpi_attendance_rate', title: 'Attendance Rate', valueKey: 'attendanceRate', format: 'percentage', enabled: true, iconName: 'Users', color: 'indigo' },
    { id: 'kpi_present_count', title: 'Present Employees', valueKey: 'presentCount', format: 'number', enabled: true, iconName: 'Clock', color: 'emerald' },
    { id: 'kpi_late_rate', title: 'Late Arrival Rate', valueKey: 'lateRate', format: 'percentage', enabled: true, iconName: 'Clock', color: 'amber' },
    { id: 'kpi_overtime', title: 'Overtime Hours', valueKey: 'overtimeHours', format: 'hours', enabled: true, iconName: 'TrendingUp', color: 'blue' },
    { id: 'kpi_payroll', title: 'Est. Net Payroll', valueKey: 'totalNetPay', format: 'currency', enabled: hasPayrollPermission, iconName: 'DollarSign', color: 'purple' },
    { id: 'kpi_violations', title: 'Compliance Flags', valueKey: 'violationsCount', format: 'number', enabled: true, iconName: 'ShieldAlert', color: 'rose' }
  ]);

  // Snapshots & Versioning State
  const [reportSnapshots, setReportSnapshots] = useState<ReportSnapshot[]>([]);

  // Chart Builder Modal State
  const [chartModalOpen, setChartModalOpen] = useState<boolean>(false);
  const [customCharts, setCustomCharts] = useState<any[]>([]);

  // Toggle Section Visibility
  const handleToggleSection = (secId: string) => {
    setSectionsConfig(prev => prev.map(s => s.id === secId ? { ...s, enabled: !s.enabled } : s));
  };

  // Move Section Up/Down
  const handleMoveSection = (index: number, direction: 'up' | 'down') => {
    setSectionsConfig(prev => {
      const arr = [...prev];
      const targetIdx = direction === 'up' ? index - 1 : index + 1;
      if (targetIdx < 0 || targetIdx >= arr.length) return prev;
      const temp = arr[index];
      arr[index] = arr[targetIdx];
      arr[targetIdx] = temp;
      return arr.map((item, idx) => ({ ...item, order: idx + 1 }));
    });
  };

  // Toggle KPI Metric
  const handleToggleKpiMetric = (metricId: string) => {
    setKpiMetrics(prev => prev.map(m => m.id === metricId ? { ...m, enabled: !m.enabled } : m));
  };

  // Take Immutable Snapshot — the hash/signature are a real SHA-256 digest
  // of the actual snapshot content (Web Crypto, browser-native), not
  // Math.random(): a random value asserts nothing about the data it's
  // supposedly protecting, and labeling that "Digitally Signed" would be
  // actively misleading. This is a content hash (proves the data wasn't
  // altered after the snapshot was taken), not a private-key signature —
  // real server-side persistence + signing is a larger follow-up, not done
  // here; this snapshot list still only lives in this session's React state
  // and is lost on refresh, same as before.
  const handleTakeSnapshot = async (confidentiality: ReportSnapshot['confidentiality']) => {
    const versionNum = `v${1 + (reportSnapshots.length * 0.1).toFixed(1)}`;
    const recordCount = reportData?.rows?.length ?? 0;
    const snapshotData = reportData?.rows || [];
    const canonical = JSON.stringify({
      category: activeCategory,
      filters: { datePreset, startDate, endDate, department, branchId, status },
      fields: selectedColumnIds,
      snapshotData,
    });
    const digestBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    const hash = Array.from(new Uint8Array(digestBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
    const newSnapshot: ReportSnapshot = {
      id: `snap_${Date.now()}`,
      version: versionNum,
      reportName: `${activeCategory.toUpperCase()} Report Snapshot`,
      category: activeCategory,
      generatedBy: user.email || user.name || 'Admin',
      generatedAt: new Date().toLocaleString(),
      recordCount,
      hash,
      confidentiality,
      filters: { datePreset, startDate, endDate, department, branchId, status },
      sections: sectionsConfig.filter(s => s.enabled).map(s => s.title),
      fields: selectedColumnIds,
      snapshotData,
      digitalSignature: `SHA256:${hash.slice(0, 16).toUpperCase()}`
    };
    setReportSnapshots(prev => [newSnapshot, ...prev]);
  };

  // Apply Business Template Preset
  const handleApplyPreset = (preset: any) => {
    if (preset.selectedFields) setSelectedColumnIds(preset.selectedFields);
    if (preset.theme) setSelectedThemeId(preset.theme);
    if (preset.defaultDateRange) handleDatePresetChange(preset.defaultDateRange);
    setDesignerOpen(true);
  };

  // Saved Templates & Scheduled State
  const [savedTemplates, setSavedTemplates] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [saveModalOpen, setSaveModalOpen] = useState<boolean>(false);
  const [newTemplateName, setNewTemplateName] = useState<string>('');
  const [scheduleModalOpen, setScheduleModalOpen] = useState<boolean>(false);
  const [scheduleName, setScheduleName] = useState<string>('');
  const [scheduleFrequency, setScheduleFrequency] = useState<string>('Weekly (Mon 08:00)');
  const [scheduleRecipients, setScheduleRecipients] = useState<string>(user.email || '');

  // Email Modal State
  const [emailModalOpen, setEmailModalOpen] = useState<boolean>(false);
  const [emailTo, setEmailTo] = useState<string>(user.email || '');
  const [emailSending, setEmailSending] = useState<boolean>(false);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);

  // Drill Down Modal
  const [selectedRow, setSelectedRow] = useState<any | null>(null);

  // Filter accessible catalog fields based on RBAC using REPORT_FIELDS_METADATA
  const availableFields = useMemo(() => {
    return REPORT_FIELDS_METADATA.filter(field => {
      if (field.permission === 'payroll.read' && !hasPayrollPermission) return false;
      return true;
    });
  }, [hasPayrollPermission]);

  // Handle Date Presets
  const handleDatePresetChange = (preset: string) => {
    setDatePreset(preset);
    const now = new Date();
    if (preset === 'today') {
      const today = now.toISOString().split('T')[0];
      setStartDate(today);
      setEndDate(today);
    } else if (preset === 'this_week') {
      const first = now.getDate() - now.getDay();
      const firstDay = new Date(now.setDate(first)).toISOString().split('T')[0];
      const today = new Date().toISOString().split('T')[0];
      setStartDate(firstDay);
      setEndDate(today);
    } else if (preset === 'this_month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const today = new Date().toISOString().split('T')[0];
      setStartDate(firstDay);
      setEndDate(today);
    } else if (preset === 'last_month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];
      setStartDate(firstDay);
      setEndDate(lastDay);
    }
  };

  // Fetch data
  const fetchReportData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        type: activeCategory === 'builder' ? 'attendance' : activeCategory,
        startDate,
        endDate,
        department,
        branchId,
        status,
        search,
        wfh: String(wfhOnly),
        late: String(lateOnly),
        overtime: String(overtimeOnly)
      });

      const res = await fetch(`/api/reports/data?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        setReportData(data);
      }
    } catch (err) {
      console.error('Failed to fetch report data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch branches & templates
  useEffect(() => {
    fetch('/api/tenant/branches', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setBranchesList(d); })
      .catch(() => {});

    fetch('/api/reports/saved-templates', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (d.templates) setSavedTemplates(d.templates); })
      .catch(() => {});

    fetch('/api/reports/schedules', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (d.schedules) setSchedules(d.schedules); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchReportData();
  }, [activeCategory, startDate, endDate, department, branchId, status, wfhOnly, lateOnly, overtimeOnly]);

  // Extract unique departments from report rows
  useEffect(() => {
    if (reportData?.rows) {
      const depts = Array.from(new Set(reportData.rows.map((r: any) => r.department).filter(Boolean))) as string[];
      setDepartmentsList(depts);
    }
  }, [reportData]);

  // Column Reordering & Toggle Helpers
  const toggleColumn = (fieldId: string) => {
    setSelectedColumnIds(prev => {
      if (prev.includes(fieldId)) {
        return prev.filter(id => id !== fieldId);
      } else {
        return [...prev, fieldId];
      }
    });
  };

  const moveColumn = (index: number, direction: 'up' | 'down') => {
    const newCols = [...selectedColumnIds];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= newCols.length) return;
    const temp = newCols[index];
    newCols[index] = newCols[targetIdx];
    newCols[targetIdx] = temp;
    setSelectedColumnIds(newCols);
  };

  // Selected Theme Details
  const activeTheme = useMemo(() => {
    return REPORT_THEMES.find(t => t.id === selectedThemeId) || REPORT_THEMES[0];
  }, [selectedThemeId]);

  // Map Column ID to Display Value for a Row
  const getCellValue = (row: any, fieldId: string) => {
    switch (fieldId) {
      case 'employeeId': return row.employeeId || row.userId || '-';
      case 'employeeName': return row.employeeName || row.name || '-';
      case 'email': return row.email || '-';
      case 'department': return row.department || '-';
      case 'designation': return row.designation || '-';
      case 'branch': return row.branch || '-';
      case 'manager': return row.manager || '-';
      case 'date': return row.date || row.monthYear || '-';
      case 'checkIn': return row.checkIn || '-';
      case 'checkOut': return row.checkOut || '-';
      case 'status': return row.status || '-';
      case 'workingHours': return row.workingHours ? `${row.workingHours} hrs` : '-';
      case 'lateMins': return row.lateMins ? `${row.lateMins} mins` : '-';
      case 'earlyDepartureMins': return row.earlyDepartureMins ? `${row.earlyDepartureMins} mins` : '-';
      case 'location': return row.location || row.verificationMode || '-';
      case 'verificationMode': return row.verificationMode || 'GPS / Biometric';
      case 'wfhStatus': return row.wfh ? 'WFH / Remote' : 'On-Site';
      case 'shiftName': return row.shiftName || 'Standard Shift';
      case 'overtimeHours': return row.overtimeHours ? `${row.overtimeHours} hrs` : '0 hrs';
      case 'breakDuration': return row.breakDuration ? `${row.breakDuration} mins` : '-';
      case 'leaveType': return row.leaveType || '-';
      case 'leaveBalance': return row.leaveBalance ? `${row.leaveBalance} days` : '-';
      case 'grossSalary': return row.grossSalary ? `$${row.grossSalary}` : '-';
      case 'netSalary': return row.netSalary ? `$${row.netSalary}` : '-';
      case 'deductions': return row.deductions ? `$${row.deductions}` : '-';
      case 'complianceAlerts': return row.notes || (row.lateMins > 30 ? 'Late Arrival Exceeding Threshold' : 'Normal Policy Compliance');
      default: return row[fieldId] || '-';
    }
  };

  // Export CSV respecting Custom Columns & Ordering
  const exportCSV = () => {
    if (!reportData?.rows || reportData.rows.length === 0) return;
    const activeFields = selectedColumnIds.map(id => availableFields.find(f => f.id === id)).filter(Boolean) as ReportField[];
    const headers = activeFields.map(f => `"${f.label}"`).join(',');
    
    const rows = reportData.rows.map((row: any) =>
      activeFields.map(f => {
        const val = getCellValue(row, f.id);
        return `"${String(val ?? '').replace(/"/g, '""')}"`;
      }).join(',')
    );

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${companyName.replace(/\s+/g, '_')}_Report_${startDate}_to_${endDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export Printable / PDF View respecting Dynamic Themes, Cover Page, and Custom Columns
  const exportPDFPrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const activeFields = selectedColumnIds.map(id => availableFields.find(f => f.id === id)).filter(Boolean) as ReportField[];

    // Cover page HTML
    const coverPageHtml = showCoverPage ? `
      <div class="cover-page" style="page-break-after: always; height: 90vh; display: flex; flex-col; justify-content: space-between; border: 4px double ${activeTheme.headerBg}; padding: 40px; border-radius: 12px; background: #fafafa;">
        <div>
          <div style="font-size: 28px; font-weight: 800; color: ${activeTheme.headerBg}; margin-bottom: 8px;">
            ${companyName}
          </div>
          <div style="font-size: 14px; text-transform: uppercase; tracking: 2px; color: #64748b; font-weight: 600;">
            Enterprise Workforce & MIS Intelligence
          </div>
        </div>

        <div style="text-align: center; margin: 80px 0;">
          <h1 style="font-size: 36px; font-weight: 900; color: #0f172a; margin-bottom: 12px; text-transform: uppercase;">
            ${activeCategory.toUpperCase()} EXECUTIVE REPORT
          </h1>
          <p style="font-size: 16px; color: #475569; font-weight: 500;">
            Reporting Period: <strong>${startDate}</strong> to <strong>${endDate}</strong>
          </p>
        </div>

        <div style="display: flex; justify-content: space-between; border-top: 2px solid ${activeTheme.border}; padding-top: 20px; font-size: 12px; color: #64748b;">
          <div>
            <div><strong>Prepared For:</strong> Executive Board & HR Leadership</div>
            <div><strong>Generated By:</strong> ${user.email} (${user.role})</div>
          </div>
          <div style="text-align: right;">
            <div><strong>Date Generated:</strong> ${new Date().toLocaleString()}</div>
            <div style="color: #dc2626; font-weight: 700; margin-top: 4px;">STRICTLY CONFIDENTIAL</div>
          </div>
        </div>
      </div>
    ` : '';

    // KPI Summary
    const summaryHtml = (showKpis && reportData?.summary) ? `
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 25px;">
        <div style="background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid ${activeTheme.border}; border-left: 4px solid ${activeTheme.accentColor};">
          <div style="font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 700;">Total Workforce</div>
          <div style="font-size: 20px; font-weight: 800; color: #0f172a;">${reportData.summary.totalEmployees || 0}</div>
        </div>
        <div style="background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid ${activeTheme.border}; border-left: 4px solid #10b981;">
          <div style="font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 700;">Attendance Rate</div>
          <div style="font-size: 20px; font-weight: 800; color: #10b981;">${reportData.summary.attendancePct ?? 0}%</div>
        </div>
        <div style="background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid ${activeTheme.border}; border-left: 4px solid #3b82f6;">
          <div style="font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 700;">Working Duration</div>
          <div style="font-size: 20px; font-weight: 800; color: #3b82f6;">${reportData.summary.totalHours || 0} hrs</div>
        </div>
        <div style="background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid ${activeTheme.border}; border-left: 4px solid #f59e0b;">
          <div style="font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 700;">Overtime Accumulation</div>
          <div style="font-size: 20px; font-weight: 800; color: #f59e0b;">${reportData.summary.overtimeHours || 0} hrs</div>
        </div>
      </div>
    ` : '';

    // Headers
    const tableHeaders = activeFields.map(f => `<th style="padding: 10px 8px; font-weight: 700;">${f.label}</th>`).join('');

    // Rows with Smart Highlighting
    const rowsHtml = (reportData?.rows || []).map((r: any) => {
      const isLate = enableSmartHighlight && r.lateMins && r.lateMins > 20;
      const rowStyle = isLate ? 'background-color: #fef2f2;' : '';

      const cells = activeFields.map(f => {
        const val = getCellValue(r, f.id);
        return `<td style="padding: 8px; border-bottom: 1px solid #e2e8f0; ${rowStyle}">${val}</td>`;
      }).join('');

      return `<tr>${cells}</tr>`;
    }).join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>${companyName} - Report Export</title>
          <style>
            @page { size: A4 landscape; margin: 15mm; }
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 20px; color: #1e293b; position: relative; }
            .watermark { position: fixed; top: 40%; left: 25%; font-size: 70px; color: rgba(226, 232, 240, 0.4); transform: rotate(-30deg); font-weight: 900; pointer-events: none; z-index: -1; }
            .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid ${activeTheme.headerBg}; padding-bottom: 15px; margin-bottom: 20px; }
            .logo { font-size: 20px; font-weight: 800; color: ${activeTheme.headerBg}; }
            .meta { font-size: 11px; color: #64748b; text-align: right; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; text-align: left; margin-top: 15px; }
            th { background: ${activeTheme.headerBg}; color: ${activeTheme.headerText}; font-size: 10px; text-transform: uppercase; border-bottom: 2px solid ${activeTheme.border}; }
            .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between; }
          </style>
        </head>
        <body>
          <div class="watermark">CONFIDENTIAL</div>
          ${coverPageHtml}
          <div class="header">
            <div>
              <div class="logo">${companyName}</div>
              <div style="font-size: 13px; font-weight: 700; color: #475569; margin-top: 2px;">
                ${activeCategory.toUpperCase()} REPORT
              </div>
            </div>
            <div class="meta">
              <div><strong>Period:</strong> ${startDate} to ${endDate}</div>
              <div><strong>Generated By:</strong> ${user.email}</div>
              <div><strong>Generated On:</strong> ${new Date().toLocaleString()}</div>
            </div>
          </div>
          ${summaryHtml}
          <table>
            <thead>
              <tr>${tableHeaders}</tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <div class="footer">
            <div>${companyName} Management System — Operational Audit Report</div>
            <div>Page 1 of 1</div>
          </div>
          <script>
            window.onload = function() { window.print(); };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Send Email
  const handleEmailReport = async () => {
    setEmailSending(true);
    setEmailSuccess(null);
    try {
      const res = await fetch('/api/reports/export-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          recipientEmail: emailTo,
          reportTitle: `${companyName} - ${activeCategory.toUpperCase()} Report (${startDate} to ${endDate})`,
          summary: reportData?.summary || {}
        })
      });
      const d = await res.json();
      if (res.ok) {
        setEmailSuccess('Report successfully queued and emailed!');
        setTimeout(() => setEmailModalOpen(false), 2000);
      } else {
        setEmailSuccess('Error: ' + d.error);
      }
    } catch (err: any) {
      setEmailSuccess('Failed to send email: ' + err.message);
    } finally {
      setEmailSending(false);
    }
  };

  // Save Template
  const handleSaveTemplate = async () => {
    if (!newTemplateName.trim()) return;
    try {
      const res = await fetch('/api/reports/saved-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: newTemplateName,
          type: activeCategory,
          columns: selectedColumnIds,
          theme: selectedThemeId,
          filters: { department, branchId, status, wfhOnly, lateOnly, overtimeOnly }
        })
      });
      if (res.ok) {
        const d = await res.json();
        setSavedTemplates(prev => [d.template, ...prev]);
        setSaveModalOpen(false);
        setNewTemplateName('');
      }
    } catch (err) {
      console.error('Failed to save template:', err);
    }
  };

  // Schedule Report
  const handleScheduleReport = async () => {
    if (!scheduleName.trim() || !scheduleRecipients.trim()) return;
    try {
      const res = await fetch('/api/reports/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          reportName: scheduleName,
          frequency: scheduleFrequency,
          recipients: scheduleRecipients
        })
      });
      if (res.ok) {
        const d = await res.json();
        setSchedules(prev => [d.schedule, ...prev]);
        setScheduleModalOpen(false);
        setScheduleName('');
      }
    } catch (err) {
      console.error('Failed to schedule report:', err);
    }
  };

  const ANALYTICS_CATEGORIES = [
    { id: 'executive', label: 'Executive Dashboard', icon: BarChart2 },
    { id: 'attendance', label: 'Attendance Reports', icon: Clock },
    { id: 'leave', label: 'Leave Reports', icon: Calendar },
    { id: 'payroll', label: 'Payroll Reports', icon: FileText, requiresPermission: 'payroll.read' },
    { id: 'overtime', label: 'Shift & Overtime', icon: TrendingUp },
    { id: 'compliance', label: 'Compliance & Audit', icon: ShieldAlert }
  ].filter(c => !c.requiresPermission || hasPayrollPermission);

  const TOOLS_CATEGORIES = [
    { id: 'builder', label: 'Report Designer', icon: Sliders },
    { id: 'saved', label: 'Saved Templates', icon: Save },
    { id: 'schedules', label: 'Scheduled Delivery', icon: Mail }
  ];

  const CATEGORIES = [...ANALYTICS_CATEGORIES, ...TOOLS_CATEGORIES];

  return (
    <div className={`w-full ${embedded ? 'p-0' : 'p-6 max-w-7xl mx-auto'} font-sans text-slate-800`}>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
              <BarChart2 className="w-5 h-5" />
            </span>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Reports & Analytics Center
            </h1>
            <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
              {user.role}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Enterprise dynamic report designer, operational audit logs, and workforce intelligence.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setDesignerOpen(!designerOpen)}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition ${
              designerOpen
                ? 'bg-indigo-50 border border-indigo-300 text-indigo-700'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Sliders className="w-4 h-4 text-indigo-600" />
            {designerOpen ? 'Hide Designer' : 'Configure Report'}
          </button>
          <button
            onClick={() => setEmailModalOpen(true)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition"
          >
            <Mail className="w-4 h-4 text-slate-500" />
            Email Report
          </button>
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            Export CSV
          </button>
          <button
            onClick={exportPDFPrint}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition shadow-sm"
          >
            <Printer className="w-4 h-4" />
            Print / PDF Report
          </button>
        </div>
      </div>

      {/* Main Layout Grid with Sidebar Navigation */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Sidebar Navigation Component */}
        <ReportsSidebar
          activeCategory={activeCategory}
          onSelectCategory={handleSelectCategory}
          userRole={user.role}
          hasPayrollPermission={hasPayrollPermission}
        />

        {/* Centralized Main Area */}
        <main className="flex-1 min-w-0 w-full">

      {/* DYNAMIC REPORT DESIGNER PANEL (PULL-OUT / TOGGLE) */}
      {(designerOpen || activeCategory === 'builder') && (
        <div className="bg-slate-900 text-slate-100 rounded-2xl p-6 mb-6 shadow-2xl border border-slate-800 space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/30">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white tracking-tight">
                  Enterprise Report Designer & Block Builder
                </h2>
                <p className="text-xs text-slate-400">
                  Select business templates, customize dynamic field metadata, reorder sections, and configure KPIs.
                </p>
              </div>
            </div>
            <button
              onClick={() => setDesignerOpen(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition text-xs flex items-center gap-1"
            >
              <X className="w-4 h-4" /> Close Builder
            </button>
          </div>

          {/* 1. Business Template Presets Bar */}
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2.5 flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-indigo-400" />
              Pre-Configured Business Template Presets
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {BUSINESS_TEMPLATES_PRESETS.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => handleApplyPreset(tpl)}
                  className="p-3 rounded-xl bg-slate-800/90 border border-slate-700/80 hover:border-indigo-500 hover:bg-slate-800 text-left transition group space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                      {tpl.badge || tpl.category}
                    </span>
                    <Sparkles className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-400 transition" />
                  </div>
                  <h4 className="text-xs font-bold text-white group-hover:text-indigo-200 transition">
                    {tpl.name}
                  </h4>
                  <p className="text-[10px] text-slate-400 line-clamp-2">
                    {tpl.description}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* 2. Grid Columns: Field Selection, Column Reorder, Theme */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-2">
            {/* Column 1: Metadata-Driven Field Selector */}
            <div className="bg-slate-800/80 rounded-xl p-4 border border-slate-700/60">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-1.5">
                <Layout className="w-4 h-4 text-indigo-400" /> Select Report Columns
              </h3>

              <div className="space-y-3 max-h-72 overflow-y-auto pr-1 scrollbar-thin">
                {['employee', 'attendance', 'leave', 'payroll', 'compliance'].map((catKey) => {
                  const fields = availableFields.filter(f => f.category === catKey);
                  if (fields.length === 0) return null;

                  return (
                    <div key={catKey} className="space-y-1">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 border-b border-slate-700 pb-0.5 mb-1 flex items-center justify-between">
                        <span>{catKey.toUpperCase()} METADATA</span>
                      </div>
                      <div className="grid grid-cols-1 gap-1">
                        {fields.map(field => {
                          const isChecked = selectedColumnIds.includes(field.id);
                          return (
                            <label
                              key={field.id}
                              onClick={() => toggleColumn(field.id)}
                              className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition ${
                                isChecked
                                  ? 'bg-indigo-950/90 text-indigo-100 border border-indigo-500/50'
                                  : 'hover:bg-slate-700/50 text-slate-400'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span>{field.label}</span>
                                <span className="text-[9px] font-mono text-slate-500 bg-slate-900 px-1 rounded uppercase">
                                  {field.dataType}
                                </span>
                              </div>
                              {isChecked && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Column 2: Column Order & Position */}
            <div className="bg-slate-800/80 rounded-xl p-4 border border-slate-700/60">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-1.5">
                <Move className="w-4 h-4 text-emerald-400" /> Column Order ({selectedColumnIds.length})
              </h3>

              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1 scrollbar-thin">
                {selectedColumnIds.map((id, index) => {
                  const fieldObj = availableFields.find(f => f.id === id);
                  if (!fieldObj) return null;

                  return (
                    <div
                      key={id}
                      className="flex items-center justify-between bg-slate-900 border border-slate-700/80 px-3 py-1.5 rounded-lg text-xs text-slate-200"
                    >
                      <span className="font-medium text-slate-300">
                        {index + 1}. {fieldObj.label}
                      </span>

                      <div className="flex items-center gap-1">
                        <button
                          disabled={index === 0}
                          onClick={() => moveColumn(index, 'up')}
                          className="p-1 hover:bg-slate-800 rounded disabled:opacity-30 text-slate-400 hover:text-white"
                          title="Move Up"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          disabled={index === selectedColumnIds.length - 1}
                          onClick={() => moveColumn(index, 'down')}
                          className="p-1 hover:bg-slate-800 rounded disabled:opacity-30 text-slate-400 hover:text-white"
                          title="Move Down"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => toggleColumn(id)}
                          className="p-1 hover:bg-red-950 text-red-400 rounded ml-1"
                          title="Remove Column"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Column 3: Rich Theme & Options */}
            <div className="bg-slate-800/80 rounded-xl p-4 border border-slate-700/60 space-y-4">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-2 flex items-center gap-1.5">
                  <Palette className="w-4 h-4 text-amber-400" /> Executive Theme Palette
                </h3>
                <div className="grid grid-cols-1 gap-2">
                  {ENHANCED_REPORT_THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      onClick={() => setSelectedThemeId(theme.id)}
                      className={`flex items-center justify-between p-2.5 rounded-lg text-xs text-left border transition ${
                        selectedThemeId === theme.id
                          ? 'border-indigo-400 bg-indigo-950/80 text-white font-bold'
                          : 'border-slate-700 bg-slate-900/60 text-slate-400 hover:border-slate-500'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-3.5 h-3.5 rounded-full shrink-0 border border-white/20" style={{ backgroundColor: theme.accentColor }} />
                        <span>{theme.name}</span>
                      </div>
                      <span className="text-[9px] font-mono text-slate-400">{theme.watermark.split(' ')[0]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-700 flex items-center justify-between">
                <button
                  onClick={() => setChartModalOpen(true)}
                  className="w-full text-center py-2 px-3 rounded-lg font-bold text-xs bg-indigo-600 hover:bg-indigo-500 text-white transition flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <BarChart2 className="w-4 h-4" /> Add Custom Chart Widget
                </button>
              </div>
            </div>
          </div>

          {/* 3. Section Layout Builder Component */}
          <SectionBuilder
            sections={sectionsConfig}
            onToggleSection={handleToggleSection}
            onMoveSection={handleMoveSection}
          />

          {/* 4. KPI Configurator Component */}
          <KpiConfigurator
            metrics={kpiMetrics}
            onToggleMetric={handleToggleKpiMetric}
          />
        </div>
      )}

      {/* Filter Bar (Only shown for data report views) */}
      {activeCategory !== 'saved' && activeCategory !== 'schedules' && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6 shadow-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
            {/* Date Presets */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Date Range Preset
              </label>
              <select
                value={datePreset}
                onChange={(e) => handleDatePresetChange(e.target.value)}
                className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-2 bg-white text-slate-700 focus:outline-none focus:border-indigo-500"
              >
                <option value="today">Today</option>
                <option value="this_week">This Week</option>
                <option value="this_month">This Month</option>
                <option value="last_month">Last Month</option>
                <option value="custom">Custom Date Range</option>
              </select>
            </div>

            {/* Custom Dates */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setDatePreset('custom'); }}
                className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setDatePreset('custom'); }}
                className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700"
              />
            </div>

            {/* Department */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Department
              </label>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-2 bg-white text-slate-700"
              >
                <option value="ALL">All Departments</option>
                {departmentsList.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            {/* Branch */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Branch
              </label>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-2 bg-white text-slate-700"
              >
                <option value="ALL">All Branches</option>
                {branchesList.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>

          {/* Secondary Filter Toggles & Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
            <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-600">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={wfhOnly}
                  onChange={(e) => setWfhOnly(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-0"
                />
                <span>WFH Only</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={lateOnly}
                  onChange={(e) => setLateOnly(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-0"
                />
                <span>Late Arrival Only</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={overtimeOnly}
                  onChange={(e) => setOvertimeOnly(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-0"
                />
                <span>Overtime Only</span>
              </label>

              <div className="relative">
                <input
                  type="text"
                  placeholder="Search employee..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="text-xs border border-slate-200 rounded-lg pl-7 pr-2.5 py-1.5 bg-slate-50 text-slate-700 w-44"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2" />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setSaveModalOpen(true)}
                className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100"
              >
                <Save className="w-3.5 h-3.5" />
                Save Filter Template
              </button>
              <button
                onClick={fetchReportData}
                className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100"
                title="Refresh Report Data"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW: Saved Templates */}
      {activeCategory === 'saved' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
          <h2 className="text-lg font-bold text-slate-800 mb-4">Saved Report Templates & Custom Layouts</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {savedTemplates.map((tpl) => (
              <div key={tpl.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:border-indigo-300 transition">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-slate-800 text-sm">{tpl.name}</h3>
                  <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-indigo-100 text-indigo-700">
                    {tpl.type}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-4">
                  Created by {tpl.createdBy || 'Admin'}
                </p>
                <button
                  onClick={() => {
                    setActiveCategory(tpl.type || 'attendance');
                    if (tpl.columns && Array.isArray(tpl.columns)) setSelectedColumnIds(tpl.columns);
                    if (tpl.theme) setSelectedThemeId(tpl.theme);
                    if (tpl.filters?.department) setDepartment(tpl.filters.department);
                    if (tpl.filters?.lateOnly) setLateOnly(tpl.filters.lateOnly);
                  }}
                  className="w-full text-center text-xs font-semibold py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition"
                >
                  Load & Run Layout
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW: Scheduled Delivery */}
      {activeCategory === 'schedules' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Scheduled Email Delivery</h2>
              <p className="text-xs text-slate-500">Automated recurring report delivery directly to key stakeholders.</p>
            </div>
            <button
              onClick={() => setScheduleModalOpen(true)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
            >
              <Plus className="w-4 h-4" />
              Schedule New Report
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {schedules.map((sch) => (
              <div key={sch.id} className="py-3 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-800 text-sm">{sch.reportName}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Frequency: <span className="font-medium text-slate-700">{sch.frequency}</span> • Format: <span className="font-medium text-slate-700">{sch.format || 'PDF'}</span>
                  </p>
                  <p className="text-xs text-indigo-600 mt-0.5">
                    Recipients: {Array.isArray(sch.recipients) ? sch.recipients.join(', ') : sch.recipients}
                  </p>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">
                  Active
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MAIN DATA REPORT & DYNAMIC VIEW */}
      {activeCategory !== 'saved' && activeCategory !== 'schedules' && (
        <div>
          {/* Executive KPI Summary Cards */}
          {showKpis && reportData?.summary && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wider">Total Employees</span>
                  <Users className="w-4 h-4 text-indigo-600" />
                </div>
                <div className="text-2xl font-bold text-slate-900">
                  {reportData.summary.totalEmployees || 0}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">Active workforce snapshot</div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wider">Attendance Rate</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="text-2xl font-bold text-emerald-600">
                  {reportData.summary.attendancePct ?? 0}%
                </div>
                <div className="text-[11px] text-emerald-600 font-medium mt-1">↑ +2.4% vs last period</div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wider">Total Working Hours</span>
                  <Clock className="w-4 h-4 text-blue-600" />
                </div>
                <div className="text-2xl font-bold text-slate-900">
                  {reportData.summary.totalHours || 0} <span className="text-xs text-slate-500 font-normal">hrs</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1">Calculated from approved logs</div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wider">Overtime Accumulation</span>
                  <TrendingUp className="w-4 h-4 text-amber-600" />
                </div>
                <div className="text-2xl font-bold text-amber-600">
                  {reportData.summary.overtimeHours || 0} <span className="text-xs text-slate-500 font-normal">hrs</span>
                </div>
                <div className="text-[11px] text-amber-600 font-medium mt-1">Under policy threshold</div>
              </div>
            </div>
          )}

          {/* Visual Charts Section (Executive & Attendance) */}
          {showCharts && reportData?.charts && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {reportData.charts.dailyTrend && (
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
                  <h3 className="text-sm font-bold text-slate-800 mb-3">Attendance & Late Trend Analysis</h3>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={reportData.charts.dailyTrend}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#64748b' }} />
                        <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                        <RechartsTooltip />
                        <Area type="monotone" dataKey="present" name="Present" stroke="#10b981" fill="#d1fae5" />
                        <Area type="monotone" dataKey="late" name="Late" stroke="#f59e0b" fill="#fef3c7" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {reportData.charts.departmentBreakdown && (
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
                  <h3 className="text-sm font-bold text-slate-800 mb-3">Department Breakdown Intelligence</h3>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={reportData.charts.departmentBreakdown}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="department" tick={{ fontSize: 10, fill: '#64748b' }} />
                        <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                        <RechartsTooltip />
                        <Bar dataKey="present" name="Present Count" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="late" name="Late Count" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Dynamic Configured Data Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-800 text-sm uppercase tracking-wider flex items-center gap-2">
                  <span>Custom Configured Report View</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700">
                    {selectedColumnIds.length} Columns Active
                  </span>
                </h3>
                <p className="text-xs text-slate-500">Live preview showing records configured via Dynamic Designer.</p>
              </div>

              <button
                onClick={() => setDesignerOpen(true)}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
              >
                <Sliders className="w-3.5 h-3.5" /> Modify Columns
              </button>
            </div>

            {loading ? (
              <div className="p-12 text-center text-xs font-mono uppercase tracking-widest text-slate-400">
                Generating Report Intelligence...
              </div>
            ) : reportData?.rows?.length === 0 ? (
              <div className="p-12 text-center text-xs text-slate-500">
                No matching records found for the selected filters and date range.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr
                      className="border-b font-semibold uppercase tracking-wider text-white"
                      style={{ backgroundColor: activeTheme.headerBg, borderColor: activeTheme.border }}
                    >
                      {selectedColumnIds.map((colId) => {
                        const fieldObj = availableFields.find(f => f.id === colId);
                        return (
                          <th key={colId} className="p-3 whitespace-nowrap">
                            {fieldObj?.label || colId}
                          </th>
                        );
                      })}
                      <th className="p-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reportData.rows.map((row: any) => {
                      const isHighlightLate = enableSmartHighlight && row.lateMins && row.lateMins > 20;

                      return (
                        <tr
                          key={row.id || Math.random()}
                          onClick={() => setSelectedRow(row)}
                          className={`hover:bg-indigo-50/40 cursor-pointer transition ${
                            isHighlightLate ? 'bg-amber-50/60' : ''
                          }`}
                        >
                          {selectedColumnIds.map((colId) => {
                            const val = getCellValue(row, colId);
                            return (
                              <td key={colId} className="p-3 text-slate-700 max-w-xs truncate">
                                {colId === 'status' ? (
                                  <span
                                    className={`inline-block px-2 py-0.5 rounded-full font-bold text-[10px] uppercase ${
                                      val === 'Present' || val === 'approved'
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : val === 'Late'
                                        ? 'bg-amber-100 text-amber-800'
                                        : val === 'WFH'
                                        ? 'bg-blue-100 text-blue-800'
                                        : val === 'Leave'
                                        ? 'bg-purple-100 text-purple-800'
                                        : 'bg-slate-100 text-slate-700'
                                    }`}
                                  >
                                    {val}
                                  </span>
                                ) : (
                                  val
                                )}
                              </td>
                            );
                          })}

                          <td className="p-3 text-right">
                            <button
                              onClick={(e) => { e.stopPropagation(); setSelectedRow(row); }}
                              className="text-xs text-indigo-600 hover:text-indigo-900 font-semibold"
                            >
                              Inspect
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Save Template Modal */}
      {saveModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-800 mb-2">Save Report Designer Layout</h3>
            <p className="text-xs text-slate-500 mb-4">Save your custom columns, theme, and filters to run instantly later.</p>
            <input
              type="text"
              placeholder="e.g., Executive Monthly Attendance & Payroll"
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              className="w-full text-xs border border-slate-200 rounded-lg p-2.5 mb-4 focus:border-indigo-500"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setSaveModalOpen(false)}
                className="px-3 py-2 text-xs text-slate-600 font-semibold hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTemplate}
                className="px-4 py-2 text-xs text-white font-semibold bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              >
                Save Layout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Modal */}
      {scheduleModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-800 mb-2">Schedule Automated Report Delivery</h3>
            <p className="text-xs text-slate-500 mb-4">Automatically deliver custom PDF/CSV reports to management emails.</p>
            
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Report Schedule Name</label>
                <input
                  type="text"
                  placeholder="e.g., Weekly Executive MIS Summary"
                  value={scheduleName}
                  onChange={(e) => setScheduleName(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded-lg p-2.5 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Delivery Frequency</label>
                <select
                  value={scheduleFrequency}
                  onChange={(e) => setScheduleFrequency(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded-lg p-2.5 focus:border-indigo-500"
                >
                  <option value="Daily (08:00 AM)">Daily Morning Summary (08:00 AM)</option>
                  <option value="Weekly (Mon 08:00)">Weekly Monday Report (08:00 AM)</option>
                  <option value="Monthly (1st Day)">Monthly Executive Digest (1st of month)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Recipient Emails (comma separated)</label>
                <input
                  type="text"
                  placeholder="e.g., ceo@company.com, hr@company.com"
                  value={scheduleRecipients}
                  onChange={(e) => setScheduleRecipients(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded-lg p-2.5 focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setScheduleModalOpen(false)}
                className="px-3 py-2 text-xs text-slate-600 font-semibold hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleScheduleReport}
                className="px-4 py-2 text-xs text-white font-semibold bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              >
                Create Schedule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email Modal */}
      {emailModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-800 mb-2">Email Report Export</h3>
            <p className="text-xs text-slate-500 mb-4">Send this configured report directly via official mail delivery.</p>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Recipient Email Address</label>
            <input
              type="email"
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              className="w-full text-xs border border-slate-200 rounded-lg p-2.5 mb-4 focus:border-indigo-500"
            />
            {emailSuccess && <p className="text-xs font-medium text-emerald-600 mb-3">{emailSuccess}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEmailModalOpen(false)}
                className="px-3 py-2 text-xs text-slate-600 font-semibold hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleEmailReport}
                disabled={emailSending}
                className="px-4 py-2 text-xs text-white font-semibold bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
              >
                {emailSending ? 'Sending Mail...' : 'Send Report'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audit Snapshots & Version Control Accordion/Bar */}
      {activeCategory !== 'saved' && activeCategory !== 'schedules' && (
        <div className="mb-6">
          <SnapshotVersionManager
            snapshots={reportSnapshots}
            onTakeSnapshot={handleTakeSnapshot}
            onRestoreSnapshot={(snap) => {
              if (snap.fields) setSelectedColumnIds(snap.fields);
            }}
          />
        </div>
      )}

      {/* Drill Down Record Detail Modal */}
      <DrillDownModal
        isOpen={!!selectedRow}
        onClose={() => setSelectedRow(null)}
        record={selectedRow}
      />

      {/* Dynamic Chart Builder Modal */}
      <ChartBuilderModal
        isOpen={chartModalOpen}
        onClose={() => setChartModalOpen(false)}
        onSaveChart={(chart) => setCustomCharts(prev => [...prev, chart])}
        availableFields={availableFields.map(f => ({ id: f.id, label: f.label }))}
      />
        </main>
      </div>
    </div>
  );
}
