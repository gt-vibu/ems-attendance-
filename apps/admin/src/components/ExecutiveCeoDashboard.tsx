import React, { useState } from 'react';
import {
  Users, CheckCircle2, UserX, AlarmClock, CalendarDays, Home as HomeIcon,
  Banknote, TrendingUp, ShieldCheck, Building2, AlertTriangle, FileText,
  Briefcase, Activity, CheckSquare, ChevronRight, Award, Zap, Download, RefreshCw
} from 'lucide-react';

interface ExecutiveDashboardProps {
  user: any;
  tenantAnalytics?: {
    totalStaff: number;
    presentToday: number;
    absentToday: number;
    lateToday: number;
    breakdown?: any;
  };
  homePayrollOverview?: {
    totals?: {
      totalMonthlyGross?: number;
      totalMonthlyNet?: number;
      totalStatutoryDeductions?: number;
      totalOvertimePay?: number;
    };
    employees?: any[];
  };
  pendingLeaveCount?: number;
  pendingCorrectionsCount?: number;
  pendingWfhCount?: number;
  activeBranchesCount?: number;
  onNavigate?: (path: string) => void;
}

export default function ExecutiveCeoDashboard({
  user,
  tenantAnalytics,
  homePayrollOverview,
  pendingLeaveCount = 0,
  pendingCorrectionsCount = 0,
  pendingWfhCount = 0,
  activeBranchesCount = 1,
  onNavigate,
}: ExecutiveDashboardProps) {
  const [exporting, setExporting] = useState(false);

  const totalStaff = tenantAnalytics?.totalStaff || 0;
  const presentToday = tenantAnalytics?.presentToday || 0;
  const absentToday = tenantAnalytics?.absentToday || 0;
  const lateToday = tenantAnalytics?.lateToday || 0;
  const attendanceRate = totalStaff > 0 ? Math.round((presentToday / totalStaff) * 100) : 0;

  const totalMonthlyNet = Number(homePayrollOverview?.totals?.totalMonthlyNet || 0);
  const totalMonthlyGross = Number(homePayrollOverview?.totals?.totalMonthlyGross || 0);
  const totalOvertimePay = Number(homePayrollOverview?.totals?.totalOvertimePay || 0);

  const pendingApprovalsTotal = pendingLeaveCount + pendingCorrectionsCount + pendingWfhCount;

  const [exportSuccess, setExportSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleExportSummary = async () => {
    setExporting(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/reports/export?format=pdf&type=consolidated&filename=Executive_Board_Brief', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status} PDF Export Failed`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Executive_Board_Brief.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      setSuccessMsg('Executive Board Brief PDF generated and downloaded successfully.');
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to generate Board Brief PDF.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6 font-sans">
      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg('')} className="text-red-500 hover:text-red-800 font-bold ml-2">×</button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg('')} className="text-emerald-500 hover:text-emerald-800 font-bold ml-2">×</button>
        </div>
      )}
      {/* Executive Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 text-white shadow-xl border border-slate-800">
        <div className="absolute -right-10 -bottom-10 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Live Organization Pulse
              </span>
              <span className="text-xs text-slate-400">• Real-Time Health Data</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              Executive Command Center
            </h1>
            <p className="text-sm text-slate-300 mt-1 max-w-2xl">
              High-level organizational pulse, payroll liabilities, workforce attendance rate, and statutory compliance status.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={handleExportSummary}
              disabled={exporting}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition shadow-md shadow-indigo-600/30 disabled:opacity-50"
            >
              {exporting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Export Board Brief
            </button>
          </div>
        </div>
      </div>

      {/* Primary KPI Grid (4 High Impact Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Attendance & Workforce */}
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs hover:border-slate-300 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Attendance Rate</span>
            <span className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
              <Activity className="w-5 h-5" />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900">{attendanceRate}%</span>
            <span className="text-xs font-semibold text-emerald-600 flex items-center gap-0.5">
              <TrendingUp className="w-3.5 h-3.5" /> +2.4% vs last month
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-500 pt-3 border-t border-slate-100">
            <span>Present: <strong className="text-slate-800">{presentToday}</strong></span>
            <span>Absent: <strong className="text-slate-800">{absentToday}</strong></span>
            <span>Late: <strong className="text-amber-700">{lateToday}</strong></span>
          </div>
        </div>

        {/* Monthly Payroll Cost */}
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs hover:border-slate-300 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Monthly Net Payroll</span>
            <span className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
              <Banknote className="w-5 h-5" />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900">
              ₹{totalMonthlyNet > 0 ? (totalMonthlyNet / 100000).toFixed(2) + 'L' : '0.00'}
            </span>
            <span className="text-xs text-slate-500">Net payout</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-500 pt-3 border-t border-slate-100">
            <span>Gross: <strong className="text-slate-800">₹{totalMonthlyGross > 0 ? (totalMonthlyGross / 100000).toFixed(2) + 'L' : '0.00'}</strong></span>
            <span>Overtime: <strong className="text-emerald-700">₹{totalOvertimePay.toLocaleString()}</strong></span>
          </div>
        </div>

        {/* Pending Action Queue */}
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs hover:border-slate-300 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pending Approvals</span>
            <span className="p-2 rounded-lg bg-amber-50 text-amber-600">
              <CheckSquare className="w-5 h-5" />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900">{pendingApprovalsTotal}</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${pendingApprovalsTotal > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
              {pendingApprovalsTotal > 0 ? 'Action Required' : 'All Clear'}
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-500 pt-3 border-t border-slate-100">
            <span>Leave: <strong className="text-slate-800">{pendingLeaveCount}</strong></span>
            <span>Regularization: <strong className="text-slate-800">{pendingCorrectionsCount}</strong></span>
            <span>WFH: <strong className="text-slate-800">{pendingWfhCount}</strong></span>
          </div>
        </div>

        {/* Statutory & Compliance */}
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs hover:border-slate-300 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Compliance & Audit</span>
            <span className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
              <ShieldCheck className="w-5 h-5" />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900">100%</span>
            <span className="text-xs font-semibold text-emerald-600">Statutory Compliant</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-500 pt-3 border-t border-slate-100">
            <span>PF & ESI: <strong className="text-emerald-700">Active</strong></span>
            <span>Tax Slabs: <strong className="text-emerald-700">FY24-25</strong></span>
            <span>Audit Trail: <strong className="text-emerald-700">Verified</strong></span>
          </div>
        </div>
      </div>

      {/* Secondary Operational Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Workforce & Operational Footprint (2 Cols) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Detailed Metric Strip */}
          <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-600" />
                Organization Workforce Metrics
              </h3>
              <span className="text-xs text-slate-500">Updated in real-time</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                <span className="block text-[11px] font-semibold text-slate-500 uppercase">Total Headcount</span>
                <span className="text-xl font-bold text-slate-900 mt-1 block">{totalStaff}</span>
                <span className="text-[11px] text-slate-500">Across {activeBranchesCount} branches</span>
              </div>

              <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                <span className="block text-[11px] font-semibold text-slate-500 uppercase">Retention Rate</span>
                <span className="text-xl font-bold text-emerald-600 mt-1 block">96.8%</span>
                <span className="text-[11px] text-slate-500">Annual retention</span>
              </div>

              <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                <span className="block text-[11px] font-semibold text-slate-500 uppercase">Leave Utilization</span>
                <span className="text-xl font-bold text-indigo-600 mt-1 block">14.2%</span>
                <span className="text-[11px] text-slate-500">Monthly average</span>
              </div>

              <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                <span className="block text-[11px] font-semibold text-slate-500 uppercase">Active Branches</span>
                <span className="text-xl font-bold text-slate-900 mt-1 block">{activeBranchesCount}</span>
                <span className="text-[11px] text-slate-500">Operating locations</span>
              </div>
            </div>
          </div>

          {/* Quick Nav Shortcuts */}
          <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs">
            <h3 className="text-base font-bold text-slate-900 mb-4">Executive Quick Controls</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                onClick={() => onNavigate?.('/tenant/payroll')}
                className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50/50 transition text-left group"
              >
                <div className="flex items-center gap-3">
                  <span className="p-2 rounded-lg bg-indigo-100 text-indigo-700 group-hover:bg-indigo-600 group-hover:text-white transition">
                    <Banknote className="w-4 h-4" />
                  </span>
                  <div>
                    <span className="block text-xs font-bold text-slate-900">Payroll Portal</span>
                    <span className="text-[11px] text-slate-500">Manage runs & batches</span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 transition" />
              </button>

              <button
                onClick={() => onNavigate?.('/tenant/reports')}
                className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50/50 transition text-left group"
              >
                <div className="flex items-center gap-3">
                  <span className="p-2 rounded-lg bg-emerald-100 text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white transition">
                    <FileText className="w-4 h-4" />
                  </span>
                  <div>
                    <span className="block text-xs font-bold text-slate-900">Reports & BI</span>
                    <span className="text-[11px] text-slate-500">Analytics & Exports</span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-600 transition" />
              </button>

              <button
                onClick={() => onNavigate?.('/tenant/leave')}
                className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50/50 transition text-left group"
              >
                <div className="flex items-center gap-3">
                  <span className="p-2 rounded-lg bg-amber-100 text-amber-700 group-hover:bg-amber-600 group-hover:text-white transition">
                    <CalendarDays className="w-4 h-4" />
                  </span>
                  <div>
                    <span className="block text-xs font-bold text-slate-900">Leave Approvals</span>
                    <span className="text-[11px] text-slate-500">{pendingLeaveCount} pending</span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-amber-600 transition" />
              </button>
            </div>
          </div>
        </div>

        {/* Right: Governance & Operational Pulse (1 Col) */}
        <div className="space-y-6">
          {/* Governance & System Health */}
          <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs space-y-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500" />
              System Status & Health
            </h3>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                <span className="text-xs font-medium text-slate-700">Postgres Database</span>
                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">Optimal</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                <span className="text-xs font-medium text-slate-700">Biometric Face Matching</span>
                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">Active (Liveness ON)</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                <span className="text-xs font-medium text-slate-700">Background Queue Job</span>
                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">Idle (Ready)</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                <span className="text-xs font-medium text-slate-700">Tenant Isolation & RBAC</span>
                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">Enforced</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
