import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { User } from '../lib/auth';
import AdminWorkspaceLayout from '../components/AdminWorkspaceLayout';
import ManagementTemplate from '../components/templates/ManagementTemplate';
import { Banknote, CreditCard, DollarSign, Calendar, Layers, ShieldCheck, Download, Plus, ArrowRight, UserCheck } from 'lucide-react';
import { downloadCsv } from '../lib/csv';

const formatMoney = (value: number) => `₹${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function PayrollPage({ user, onLogout, embedded = false }: { user: User; onLogout?: () => void; embedded?: boolean }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = localStorage.getItem('auth_token');

  const isSelfRow = (employeeId: number) => String(employeeId) === String(user.id) && user.role !== 'tenant_admin' && user.role !== 'super_admin';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [payrollSettings, setPayrollSettings] = useState<any>(null);
  const [payrollOverview, setPayrollOverview] = useState<any>(null);
  const [employees, setEmployees] = useState<any[]>([]);

  const [activeTab, setActiveTab] = useState<'current_cycle' | 'role_structures' | 'payroll_history' | 'policy_settings'>('current_cycle');
  const [search, setSearch] = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      const [settingsRes, overviewRes, usersRes] = await Promise.all([
        fetch('/api/tenant/payroll/settings', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/tenant/payroll/overview', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/tenant/users', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const settingsData = await settingsRes.json().catch(() => ({}));
      const overviewData = await overviewRes.json().catch(() => ({}));
      const usersData = await usersRes.json().catch(() => ({}));
      if (!settingsRes.ok && !overviewRes.ok) {
        throw new Error(settingsData.error || overviewData.error || 'Could not load payroll data.');
      }
      setPayrollSettings(settingsData.settings || null);
      setPayrollOverview(overviewRes.ok ? overviewData : null);
      setEmployees(Array.isArray(usersData.users) ? usersData.users.filter((row: any) => row.role !== 'tenant_admin') : []);
    } catch (err: any) {
      setError(err.message || 'Could not load payroll data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const metrics = useMemo(() => ({
    annualCtc: payrollOverview?.totals?.totalAnnualCtc || 0,
    monthlyGross: payrollOverview?.totals?.totalMonthlyGross || 0,
    monthlyNet: payrollOverview?.totals?.totalMonthlyNet || 0,
    leaveCut: payrollOverview?.totals?.totalLeaveDeduction || 0,
  }), [payrollOverview]);

  const configuredCount = useMemo(() => (payrollOverview?.employees || []).length, [payrollOverview]);

  const metricCards = [
    {
      label: 'Monthly Net Payout',
      value: formatMoney(metrics.monthlyNet),
      subtext: `Current payroll cycle commitment`,
      change: 'Active Cycle',
      changeType: 'positive' as const,
      icon: Banknote,
    },
    {
      label: 'Monthly Gross Expense',
      value: formatMoney(metrics.monthlyGross),
      subtext: `Annual CTC: ${formatMoney(metrics.annualCtc)}`,
      icon: CreditCard,
    },
    {
      label: 'Leave & Attendance Cut',
      value: formatMoney(metrics.leaveCut),
      subtext: 'Auto-calculated deductions',
      icon: DollarSign,
    },
    {
      label: 'Configured Profiles',
      value: `${configuredCount} / ${employees.length}`,
      subtext: 'Employees with active salary structure',
      icon: UserCheck,
    },
  ];

  const tabs = [
    { id: 'current_cycle', label: 'Current Payroll Cycle', count: configuredCount },
    { id: 'role_structures', label: 'Salary Structures & Roles' },
    { id: 'payroll_history', label: 'Payroll Batches & History' },
    { id: 'policy_settings', label: 'Statutory & Policy Rules' },
  ];

  const handleExportCsv = () => {
    if (!payrollOverview?.employees) return;
    const rows = payrollOverview.employees.map((e: any) => ({
      'Employee ID': e.employeeId,
      'Name': e.employeeName,
      'Email': e.employeeEmail,
      'Monthly Gross': e.monthlyGross,
      'Monthly Net': e.monthlyNet,
      'Deductions': e.totalDeductions,
    }));
    downloadCsv('payroll_cycle_overview.csv', rows);
  };

  const primaryActions = (
    <div className="flex items-center gap-2">
      <button
        onClick={() => navigate('/tenant/payroll/batches')}
        className="px-3.5 py-1.5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] text-xs font-bold text-[var(--color-nexus-ink)] hover:bg-[var(--color-nexus-surface-alt)] rounded-[var(--radius-nexus-control)] transition-colors"
      >
        View Run Batches
      </button>
      <button
        onClick={handleExportCsv}
        className="px-3.5 py-1.5 bg-[var(--color-nexus-primary)] text-white text-xs font-bold rounded-[var(--radius-nexus-control)] hover:bg-[var(--color-nexus-primary-hover)] flex items-center gap-1.5 transition-colors shadow-xs"
      >
        <Download size={14} /> Export Payroll CSV
      </button>
    </div>
  );

  const filteredOverviewEmployees = useMemo(() => {
    const list = payrollOverview?.employees || [];
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter((e: any) => {
      const name = (e.employeeName || e.name || '').toLowerCase();
      const email = (e.employeeEmail || e.email || '').toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [payrollOverview, search]);

  const workspaceContent = (
    <div className="p-4 md:p-5">
      {error && <div className="p-3 mb-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">{error}</div>}

      {activeTab === 'current_cycle' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-[var(--color-nexus-ink)]">Current Cycle Employee Payouts</h3>
              <p className="text-xs text-[var(--color-nexus-muted)]">Live calculated monthly breakdown based on base pay, attendance loss, and statutory deductions.</p>
            </div>
          </div>

          <div className="overflow-x-auto border border-[var(--color-nexus-border)] rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[var(--color-nexus-surface-alt)] border-b border-[var(--color-nexus-border)] text-[10.5px] font-mono font-bold text-[var(--color-nexus-muted)] uppercase tracking-wider">
                  <th className="py-3 px-4">Employee</th>
                  <th className="py-3 px-4 text-right">Monthly Gross</th>
                  <th className="py-3 px-4 text-right">Deductions</th>
                  <th className="py-3 px-4 text-right">Net Salary</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)]">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-xs text-[var(--color-nexus-muted)] font-mono">
                      Loading current payroll cycle...
                    </td>
                  </tr>
                ) : filteredOverviewEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-xs text-[var(--color-nexus-muted)]">
                      No payroll records found for current cycle.
                    </td>
                  </tr>
                ) : (
                  filteredOverviewEmployees.map((emp: any) => {
                    const empId = emp.employeeId || emp.userId || emp.id;
                    const empName = emp.employeeName || emp.name || 'Employee';
                    const empEmail = emp.employeeEmail || emp.email || '';
                    const deductions = emp.totalDeductions ?? emp.leaveDeduction ?? 0;
                    return (
                      <tr key={empId} className="hover:bg-[var(--color-nexus-surface-alt)]/60 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-bold text-[var(--color-nexus-ink)]">{empName}</div>
                          {empEmail && <div className="text-[11px] text-[var(--color-nexus-muted)]">{empEmail}</div>}
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-[var(--color-nexus-ink)]">
                          {formatMoney(emp.monthlyGross)}
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-rose-600">
                          {formatMoney(deductions)}
                        </td>
                        <td className="py-3 px-4 text-right font-extrabold text-emerald-600">
                          {formatMoney(emp.monthlyNet)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => navigate(`/tenant/payroll/history/${empId}`)}
                            className="px-2.5 py-1 rounded bg-[var(--color-nexus-surface-alt)] hover:bg-[var(--color-nexus-primary-fixed)] text-[11px] font-bold text-[var(--color-nexus-primary)] transition-colors"
                          >
                            Payroll History
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'role_structures' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs">
            <h4 className="font-bold mb-1">Role-Based Salary Structures</h4>
            <p>Configure default salary structures per role. All employees with matching role inherit these defaults automatically.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {['manager', 'developer', 'sales_rep', 'hr'].map((roleName) => (
              <div key={roleName} className="p-4 rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] shadow-xs flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-mono uppercase font-bold text-[var(--color-nexus-primary)]">Role Package</span>
                  <h4 className="text-sm font-extrabold text-[var(--color-nexus-ink)] capitalize mt-0.5">{roleName.replace('_', ' ')}</h4>
                  <p className="text-xs text-[var(--color-nexus-muted)] mt-2">Configured default compensation package for {roleName}.</p>
                </div>
                <button
                  onClick={() => navigate(`/tenant/payroll/setup/role/${encodeURIComponent(roleName)}/salary`)}
                  className="mt-4 w-full py-1.5 rounded-lg bg-[var(--color-nexus-surface-alt)] hover:bg-[var(--color-nexus-primary-fixed)] text-[11px] font-bold text-[var(--color-nexus-primary)] transition-colors"
                >
                  Configure Role Default →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'payroll_history' && (
        <div className="p-6 text-center space-y-3">
          <Calendar size={32} className="mx-auto text-[var(--color-nexus-primary)]" />
          <h3 className="text-sm font-bold text-[var(--color-nexus-ink)]">Historical Payroll Batches</h3>
          <p className="text-xs text-[var(--color-nexus-muted)] max-w-sm mx-auto">Access prior executed monthly payroll runs, payslips, and compliance exports.</p>
          <button
            onClick={() => navigate('/tenant/payroll/batches')}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-[var(--color-nexus-primary)] text-white"
          >
            Open Payroll Batches Workspace →
          </button>
        </div>
      )}

      {activeTab === 'policy_settings' && (
        <div className="space-y-4 text-xs">
          <h4 className="font-bold text-sm text-[var(--color-nexus-ink)]">Statutory Compliance & Deduction Rules</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)]">
              <span className="font-bold text-[var(--color-nexus-ink)] block">Provident Fund (PF) Rate</span>
              <span className="text-[11px] text-[var(--color-nexus-muted)]">Standard employee/employer contribution percentage (12%)</span>
            </div>
            <div className="p-4 rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)]">
              <span className="font-bold text-[var(--color-nexus-ink)] block">ESI Contribution</span>
              <span className="text-[11px] text-[var(--color-nexus-muted)]">Statutory employee health insurance deduction</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const mainWorkspace = (
    <ManagementTemplate
      title="Payroll & Compensation Management Workspace"
      subtitle="Operational console for current monthly payroll cycle, role structures, statutory compliance, and payouts."
      badge="Payroll Engine"
      metrics={metricCards}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(t) => setActiveTab(t as any)}
      searchQuery={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search employee name, email..."
      primaryActions={primaryActions}
    >
      {workspaceContent}
    </ManagementTemplate>
  );

  if (embedded) return mainWorkspace;

  return (
    <AdminWorkspaceLayout user={user} onLogout={onLogout}>
      {mainWorkspace}
    </AdminWorkspaceLayout>
  );
}
