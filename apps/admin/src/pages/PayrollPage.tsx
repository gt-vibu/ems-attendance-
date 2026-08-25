import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { User } from '../lib/auth';
import AdminWorkspaceLayout from '../components/AdminWorkspaceLayout';
import ManagementTemplate from '../components/templates/ManagementTemplate';
import { downloadCsv } from '../lib/csv';
import { Banknote, CreditCard, DollarSign, Calendar, Layers, ShieldCheck, Download, Plus, ArrowRight, UserCheck, Users, UserPlus, Trash2, Edit3, CheckCircle2, AlertCircle, Sparkles, Filter, Search } from 'lucide-react';

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
  const [advancePolicy, setAdvancePolicy] = useState<any>(null);
  const [savingAdvancePolicy, setSavingAdvancePolicy] = useState(false);
  const [lockingFeatureAllowed, setLockingFeatureAllowed] = useState(true);
  const [savingLockToggle, setSavingLockToggle] = useState(false);
  const [payrollOverview, setPayrollOverview] = useState<any>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const tabParam = searchParams.get('tab') || searchParams.get('section');
  const initialTab = (tabParam === 'role_structures' || tabParam === 'roles') ? 'role_structures' : (tabParam === 'history' || tabParam === 'batches') ? 'payroll_history' : (tabParam === 'policy' || tabParam === 'policy_settings') ? 'policy_settings' : 'current_cycle';
  const [activeTab, setActiveTab] = useState<'current_cycle' | 'role_structures' | 'payroll_history' | 'policy_settings'>(initialTab);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const t = searchParams.get('tab') || searchParams.get('section');
    if (t === 'role_structures' || t === 'roles') setActiveTab('role_structures');
    else if (t === 'history' || t === 'batches') setActiveTab('payroll_history');
    else if (t === 'policy' || t === 'policy_settings') setActiveTab('policy_settings');
    else setActiveTab('current_cycle');
  }, [searchParams]);

  const [roleDefaults, setRoleDefaults] = useState<any[]>([]);
  const [companyRoles, setCompanyRoles] = useState<string[]>([]);
  const [structureSubTab, setStructureSubTab] = useState<'roles' | 'individual'>('roles');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [structureFilter, setStructureFilter] = useState<'all' | 'individual' | 'role_default' | 'unconfigured'>('all');
  const [showAddRoleModal, setShowAddRoleModal] = useState(false);
  const [customRoleInput, setCustomRoleInput] = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      const [settingsRes, overviewRes, usersRes, policyRes, roleDefaultsRes] = await Promise.all([
        fetch('/api/tenant/payroll/settings', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/tenant/payroll/overview', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/tenant/users', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/tenant/payroll/salary-advances/policies', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/tenant/payroll/role-defaults', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const settingsData = await settingsRes.json().catch(() => ({}));
      const overviewData = await overviewRes.json().catch(() => ({}));
      const usersData = await usersRes.json().catch(() => ({}));
      const policyData = await policyRes.json().catch(() => ({}));
      const roleDefaultsData = await roleDefaultsRes.json().catch(() => ({}));

      if (!settingsRes.ok && !overviewRes.ok) {
        throw new Error(settingsData.error || overviewData.error || 'Could not load payroll data.');
      }
      setPayrollSettings(settingsData.settings || null);
      if (policyData.policy) setAdvancePolicy(policyData.policy);
      setLockingFeatureAllowed(settingsData.lockingFeatureAllowed !== false);
      setPayrollOverview(overviewRes.ok ? overviewData : null);
      setEmployees(Array.isArray(usersData.users) ? usersData.users.filter((row: any) => row.role !== 'tenant_admin') : []);
      
      if (Array.isArray(roleDefaultsData.roleDefaults)) {
        setRoleDefaults(roleDefaultsData.roleDefaults);
      }
      if (Array.isArray(roleDefaultsData.roles)) {
        setCompanyRoles(roleDefaultsData.roles);
      }
    } catch (err: any) {
      setError(err.message || 'Could not load payroll data.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteRoleDefault = async (roleName: string) => {
    if (!window.confirm(`Are you sure you want to delete the default salary package for ${roleName}? Employees in this role will need an individual package configured or a new default.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/tenant/payroll/role-defaults/${encodeURIComponent(roleName)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not delete role default.');
      setSuccess(`Salary default package for ${roleName} deleted successfully.`);
      setTimeout(() => setSuccess(''), 3500);
      refresh();
    } catch (err: any) {
      setError(err.message || 'Failed to delete role default.');
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const saveAdvancePolicy = async (updates: any) => {
    setSavingAdvancePolicy(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/tenant/payroll/salary-advances/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update advance policy.');
      setAdvancePolicy(data.policy);
      setSuccess('Salary advance policy updated successfully.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to update advance policy.');
    } finally {
      setSavingAdvancePolicy(false);
    }
  };

  const togglePayrollLocking = async (enabled: boolean) => {
    setSavingLockToggle(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/payroll/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ payrollLockingEnabled: enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update payroll locking setting.');
      setPayrollSettings(data.settings || payrollSettings);
    } catch (err: any) {
      setError(err.message || 'Could not update payroll locking setting.');
    } finally {
      setSavingLockToggle(false);
    }
  };

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
      label: 'Configured Employees',
      value: configuredCount,
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

  const handleExportCsv = async () => {
    let list = payrollOverview?.employees || [];
    if (list.length === 0) {
      try {
        const res = await fetch('/api/tenant/payroll/overview', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        list = data.employees || [];
      } catch (e) {
        console.error('Error fetching payroll overview for export', e);
      }
    }
    if (list.length === 0) {
      setError('No employee payroll records available to export.');
      return;
    }
    const headers = ['Employee ID', 'Name', 'Email', 'Role', 'Department', 'Monthly Gross', 'Monthly Net', 'Deductions'];
    const rows = [
      headers,
      ...list.map((e: any) => [
        e.employeeId || e.userId || e.id || '',
        e.employeeName || e.name || '',
        e.employeeEmail || e.email || '',
        e.role || '',
        e.department || '',
        e.monthlyGross || e.grossPay || 0,
        e.monthlyNet || e.netPay || 0,
        e.totalDeductions || e.leaveDeduction || 0,
      ])
    ];
    downloadCsv('payroll_cycle_overview.csv', rows);
    setSuccess('Payroll CSV exported successfully.');
    setTimeout(() => setSuccess(''), 4000);
  };

  const primaryActions = (
    <div className="flex items-center gap-2">
      <button
        onClick={() => navigate('/tenant/payroll/batches')}
        className="px-3.5 py-1.5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] text-xs font-bold text-[var(--color-nexus-ink)] hover:bg-[var(--color-nexus-surface-alt)] rounded-[var(--radius-nexus-control)] transition-colors cursor-pointer"
      >
        View Run Batches
      </button>
      <button
        onClick={handleExportCsv}
        className="px-3.5 py-1.5 bg-[var(--color-nexus-primary)] text-white text-xs font-bold rounded-[var(--radius-nexus-control)] hover:bg-[var(--color-nexus-primary-hover)] flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
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
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {empEmail && <span className="text-[11px] text-[var(--color-nexus-muted)]">{empEmail}</span>}
                            {emp.source === 'individual' ? (
                              <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-purple-100 text-purple-800">Custom</span>
                            ) : emp.source === 'role_default' ? (
                              <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-emerald-100 text-emerald-800">Role Default</span>
                            ) : (
                              <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-amber-100 text-amber-800">Unconfigured</span>
                            )}
                          </div>
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
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => navigate(`/tenant/payroll/setup/employee/${empId}/salary`)}
                              className="px-2 py-1 rounded bg-[var(--color-nexus-surface-alt)] hover:bg-[var(--color-nexus-primary-fixed)] text-[11px] font-bold text-[var(--color-nexus-primary)] transition-colors cursor-pointer"
                            >
                              Edit Salary
                            </button>
                            <button
                              type="button"
                              onClick={() => navigate(`/tenant/payroll/history/${empId}`)}
                              className="px-2 py-1 rounded bg-[var(--color-nexus-surface-alt)] hover:bg-[var(--color-nexus-border)] text-[11px] font-semibold text-[var(--color-nexus-muted)] transition-colors cursor-pointer"
                            >
                              History
                            </button>
                          </div>
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
        <div className="space-y-5">
          {/* Sub-tab Navigation */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--color-nexus-border)] pb-3">
            <div className="flex items-center gap-2 bg-[var(--color-nexus-surface-alt)] p-1 rounded-xl border border-[var(--color-nexus-border)] w-fit">
              <button
                type="button"
                onClick={() => setStructureSubTab('roles')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  structureSubTab === 'roles'
                    ? 'bg-[var(--color-nexus-surface)] text-[var(--color-nexus-primary)] shadow-xs border border-[var(--color-nexus-border)]'
                    : 'text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]'
                }`}
              >
                <Layers size={14} />
                <span>Role Default Packages</span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-[var(--color-nexus-primary)]/10 text-[var(--color-nexus-primary)]">
                  {companyRoles.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setStructureSubTab('individual')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  structureSubTab === 'individual'
                    ? 'bg-[var(--color-nexus-surface)] text-[var(--color-nexus-primary)] shadow-xs border border-[var(--color-nexus-border)]'
                    : 'text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]'
                }`}
              >
                <Users size={14} />
                <span>Individual Employee Salaries</span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-100 text-blue-800">
                  {employees.length || (payrollOverview?.employees || []).length}
                </span>
              </button>
            </div>

            {structureSubTab === 'roles' && (
              <button
                type="button"
                onClick={() => setShowAddRoleModal(true)}
                className="px-3 py-1.5 rounded-lg bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white text-xs font-bold flex items-center gap-1.5 transition-colors shadow-xs w-fit cursor-pointer"
              >
                <Plus size={14} />
                <span>Add Role Package</span>
              </button>
            )}
          </div>

          {/* Add Role Modal */}
          {showAddRoleModal && (
            <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/70 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                  <Sparkles size={14} className="text-indigo-600" />
                  Configure New Role Salary Package
                </h4>
                <button
                  type="button"
                  onClick={() => { setShowAddRoleModal(false); setCustomRoleInput(''); }}
                  className="text-xs font-bold text-gray-500 hover:text-gray-800"
                >
                  ✕ Close
                </button>
              </div>
              <p className="text-[11px] text-indigo-800">
                Enter the role identifier or job title (e.g. <code>team_lead</code>, <code>product_manager</code>, <code>qa_engineer</code>) to set up a baseline salary package.
              </p>
              <div className="flex items-center gap-2 max-w-md">
                <input
                  type="text"
                  placeholder="e.g. team_lead, accountant, designer"
                  value={customRoleInput}
                  onChange={(e) => setCustomRoleInput(e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-indigo-300 bg-white text-xs text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  disabled={!customRoleInput.trim()}
                  onClick={() => {
                    const role = customRoleInput.trim();
                    if (role) {
                      navigate(`/tenant/payroll/setup/role/${encodeURIComponent(role)}/salary`);
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  Setup Salary →
                </button>
              </div>
            </div>
          )}

          {/* 1. ROLE-BASED PACKAGES VIEW */}
          {structureSubTab === 'roles' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs flex items-center justify-between">
                <div>
                  <h4 className="font-bold mb-0.5">Role-Level Compensation Templates</h4>
                  <p className="text-[11px] text-blue-800">
                    Define baseline salary structures per role. All employees with matching role inherit these packages automatically unless an individual override is configured.
                  </p>
                </div>
                <div className="text-right pl-4">
                  <span className="text-[11px] font-bold text-blue-900 block">
                    {roleDefaults.length} of {companyRoles.length} Configured
                  </span>
                </div>
              </div>

              {companyRoles.length === 0 ? (
                <div className="p-8 text-center border border-[var(--color-nexus-border)] rounded-xl bg-[var(--color-nexus-surface)] text-xs text-[var(--color-nexus-muted)]">
                  No company roles detected. You can add one using the "Add Role Package" button above.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {companyRoles.map((roleName) => {
                    const normalizedRole = String(roleName).toLowerCase().replace(/[\s_-]/g, '');
                    const roleDefault = roleDefaults.find(
                      (d) => String(d.roleName).toLowerCase().replace(/[\s_-]/g, '') === normalizedRole
                    );
                    const isConfigured = !!roleDefault;
                    const employeeCount = roleDefault?.employeeCount ?? employees.filter((e) => e.role?.toLowerCase() === roleName.toLowerCase()).length;
                    const overrideCount = roleDefault?.overrideCount ?? 0;
                    const inheritingCount = Math.max(0, employeeCount - overrideCount);

                    return (
                      <div
                        key={roleName}
                        className={`p-4 rounded-xl border transition-all flex flex-col justify-between ${
                          isConfigured
                            ? 'border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] shadow-xs hover:border-[var(--color-nexus-primary)]/50'
                            : 'border-dashed border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)]/50'
                        }`}
                      >
                        <div>
                          {/* Role Header */}
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span className="text-[10.5px] font-mono font-bold uppercase tracking-wider text-[var(--color-nexus-primary)]">
                              Role Package
                            </span>
                            {isConfigured ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 flex items-center gap-1">
                                <CheckCircle2 size={11} /> Configured
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-200 text-gray-700">
                                No Default Package
                              </span>
                            )}
                          </div>

                          <h4 className="text-sm font-extrabold text-[var(--color-nexus-ink)] capitalize">
                            {roleName.replace(/_/g, ' ')}
                          </h4>

                          {/* Compensation Metrics */}
                          {isConfigured ? (
                            <div className="mt-3 space-y-2 text-xs">
                              <div className="p-2.5 rounded-lg bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)]/60">
                                <div className="text-[11px] text-[var(--color-nexus-muted)]">Annual Baseline CTC</div>
                                <div className="text-base font-extrabold text-[var(--color-nexus-ink)]">
                                  {formatMoney(roleDefault.annualCtc)} <span className="text-[10px] font-normal text-[var(--color-nexus-muted)]">/ year</span>
                                </div>
                                {roleDefault.summary && (
                                  <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--color-nexus-muted)] pt-1 border-t border-[var(--color-nexus-border)]/40">
                                    <span>Gross: <strong className="text-[var(--color-nexus-ink)]">{formatMoney(roleDefault.summary.monthlyGross)}</strong>/mo</span>
                                    <span>Net: <strong className="text-emerald-600">{formatMoney(roleDefault.summary.monthlyNet)}</strong>/mo</span>
                                  </div>
                                )}
                              </div>

                              <div className="text-[11px] text-[var(--color-nexus-muted)] flex items-center justify-between px-1">
                                <span>{roleDefault.components?.length || 0} Salary Components</span>
                                <span className="font-semibold text-blue-700">
                                  {inheritingCount} on default {overrideCount > 0 && `(${overrideCount} override)`}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-3 text-xs text-[var(--color-nexus-muted)] space-y-1.5">
                              <p className="text-[11px]">
                                No baseline template configured. New hires in this role will require manual compensation setup.
                              </p>
                              <div className="text-[11px] font-semibold text-amber-700">
                                {employeeCount} active employee{employeeCount !== 1 ? 's' : ''} currently in this role
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Action Buttons */}
                        <div className="mt-4 pt-3 border-t border-[var(--color-nexus-border)]/60 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => navigate(`/tenant/payroll/setup/role/${encodeURIComponent(roleName)}/salary`)}
                            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1 cursor-pointer ${
                              isConfigured
                                ? 'bg-[var(--color-nexus-surface-alt)] hover:bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)]'
                                : 'bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white shadow-xs'
                            }`}
                          >
                            <span>{isConfigured ? 'Edit Package' : '+ Setup Package'}</span>
                            <ArrowRight size={12} />
                          </button>

                          {isConfigured && (
                            <button
                              type="button"
                              title="Reset role default"
                              onClick={() => handleDeleteRoleDefault(roleName)}
                              className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-colors cursor-pointer"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 2. INDIVIDUAL EMPLOYEE SALARIES VIEW */}
          {structureSubTab === 'individual' && (
            <div className="space-y-4">
              {/* Filter / Search Bar */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3.5 rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)]">
                <div className="flex-1 flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-2.5 text-[var(--color-nexus-muted)]" />
                    <input
                      type="text"
                      placeholder="Filter employees by name or email..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-xs text-[var(--color-nexus-ink)] focus:outline-hidden"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-xs text-[var(--color-nexus-ink)] font-semibold"
                  >
                    <option value="all">All Roles</option>
                    {companyRoles.map((r) => (
                      <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                    ))}
                  </select>

                  <select
                    value={structureFilter}
                    onChange={(e) => setStructureFilter(e.target.value as any)}
                    className="px-2.5 py-1.5 rounded-lg border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-xs text-[var(--color-nexus-ink)] font-semibold"
                  >
                    <option value="all">All Structures</option>
                    <option value="individual">Custom Override</option>
                    <option value="role_default">Inheriting Role Default</option>
                    <option value="unconfigured">Not Configured</option>
                  </select>
                </div>
              </div>

              {/* Employee Salary List Table */}
              <div className="overflow-x-auto border border-[var(--color-nexus-border)] rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--color-nexus-surface-alt)] border-b border-[var(--color-nexus-border)] text-[10.5px] font-mono font-bold text-[var(--color-nexus-muted)] uppercase tracking-wider">
                      <th className="py-3 px-4">Employee</th>
                      <th className="py-3 px-4">Role & Dept</th>
                      <th className="py-3 px-4">Structure Source</th>
                      <th className="py-3 px-4 text-right">Annual CTC</th>
                      <th className="py-3 px-4 text-right">Monthly Net</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)]">
                    {(() => {
                      const allList = payrollOverview?.employees || employees;
                      const filtered = allList.filter((emp: any) => {
                        const name = (emp.employeeName || emp.name || '').toLowerCase();
                        const email = (emp.employeeEmail || emp.email || '').toLowerCase();
                        const role = (emp.role || '').toLowerCase();
                        const matchesQuery = !search.trim() || name.includes(search.toLowerCase()) || email.includes(search.toLowerCase());
                        const matchesRole = roleFilter === 'all' || role === roleFilter.toLowerCase();
                        const matchesStructure = structureFilter === 'all' || emp.source === structureFilter;
                        return matchesQuery && matchesRole && matchesStructure;
                      });

                      if (loading) {
                        return (
                          <tr>
                            <td colSpan={6} className="py-8 text-center text-xs text-[var(--color-nexus-muted)] font-mono">
                              Loading employee structures...
                            </td>
                          </tr>
                        );
                      }

                      if (filtered.length === 0) {
                        return (
                          <tr>
                            <td colSpan={6} className="py-8 text-center text-xs text-[var(--color-nexus-muted)]">
                              No employees match the selected criteria.
                            </td>
                          </tr>
                        );
                      }

                      return filtered.map((emp: any) => {
                        const empId = emp.employeeId || emp.userId || emp.id;
                        const empName = emp.employeeName || emp.name || 'Employee';
                        const empEmail = emp.employeeEmail || emp.email || '';
                        const empRole = emp.role || 'Unassigned';
                        const empDept = emp.department || 'Unassigned';
                        const source = emp.source || (emp.annualCtc > 0 ? 'individual' : 'unconfigured');

                        return (
                          <tr key={empId} className="hover:bg-[var(--color-nexus-surface-alt)]/60 transition-colors">
                            <td className="py-3 px-4">
                              <div className="font-bold text-[var(--color-nexus-ink)]">{empName}</div>
                              {empEmail && <div className="text-[11px] text-[var(--color-nexus-muted)]">{empEmail}</div>}
                            </td>
                            <td className="py-3 px-4">
                              <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)] capitalize">
                                {empRole.replace(/_/g, ' ')}
                              </span>
                              <div className="text-[10.5px] text-[var(--color-nexus-muted)] mt-0.5">{empDept}</div>
                            </td>
                            <td className="py-3 px-4">
                              {source === 'individual' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-purple-100 text-purple-800">
                                  <UserCheck size={11} /> Custom Override
                                </span>
                              ) : source === 'role_default' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-100 text-emerald-800">
                                  <Layers size={11} /> Role Default Package
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-amber-100 text-amber-800">
                                  <AlertCircle size={11} /> Unconfigured
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right font-semibold text-[var(--color-nexus-ink)]">
                              {emp.annualCtc ? formatMoney(emp.annualCtc) : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="py-3 px-4 text-right font-extrabold text-emerald-600">
                              {emp.monthlyNet ? formatMoney(emp.monthlyNet) : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => navigate(`/tenant/payroll/setup/employee/${empId}/salary`)}
                                  className="px-2.5 py-1 rounded-lg bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white text-[11px] font-bold transition-colors cursor-pointer shadow-2xs"
                                >
                                  {source === 'individual' ? 'Edit Salary' : 'Configure Salary'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => navigate(`/tenant/payroll/history/${empId}`)}
                                  className="px-2 py-1 rounded-lg bg-[var(--color-nexus-surface-alt)] hover:bg-[var(--color-nexus-border)] text-[11px] font-semibold text-[var(--color-nexus-muted)] transition-colors cursor-pointer"
                                >
                                  History
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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
        <div className="space-y-5 text-xs">
          <div>
            <h4 className="font-bold text-sm text-[var(--color-nexus-ink)] mb-2">Payroll Locking</h4>
            {lockingFeatureAllowed ? (
              <label className="flex items-center justify-between p-3.5 rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] cursor-pointer">
                <div>
                  <span className="font-bold text-[var(--color-nexus-ink)] block">Enable Payroll Run Locking</span>
                  <span className="text-[11px] text-[var(--color-nexus-muted)]">
                    Once a payroll run is locked it can never be silently recalculated — corrections after that point
                    are issued as a separate Payroll Adjustment instead. Turning this off hides the Lock action; it
                    does not affect runs already locked.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={!!payrollSettings?.payrollLockingEnabled}
                  disabled={savingLockToggle}
                  onChange={(e) => togglePayrollLocking(e.target.checked)}
                  className="w-4 h-4 rounded text-blue-600 ml-4 shrink-0"
                />
              </label>
            ) : (
              <div className="p-3.5 rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)]">
                Payroll Lock & Adjustments is not included in your organization's plan. Contact your platform administrator to enable it.
              </div>
            )}
          </div>

          {/* Salary Advance Policy Configuration */}
          <div className="p-4 rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--color-nexus-border)] pb-3">
              <div>
                <h4 className="font-bold text-sm text-[var(--color-nexus-ink)]">Salary Advance & Loan Policy Rules</h4>
                <p className="text-[11px] text-[var(--color-nexus-muted)]">Configure tenant-wide eligibility caps, calculation basis, recovery schedules, and cutoff days.</p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-xs font-bold text-[var(--color-nexus-ink)]">Enabled</span>
                <input
                  type="checkbox"
                  checked={advancePolicy?.salaryAdvanceEnabled !== false}
                  disabled={savingAdvancePolicy}
                  onChange={(e) => saveAdvancePolicy({ salaryAdvanceEnabled: e.target.checked })}
                  className="w-4 h-4 rounded text-indigo-600"
                />
              </label>
            </div>

            {advancePolicy && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-[var(--color-nexus-ink)] mb-1">Calculation Basis</label>
                  <select
                    value={advancePolicy.advanceCalculationBasis || 'net_salary'}
                    disabled={savingAdvancePolicy}
                    onChange={(e) => saveAdvancePolicy({ advanceCalculationBasis: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)] text-xs"
                  >
                    <option value="net_salary">Net / Take-Home Salary</option>
                    <option value="gross_salary">Gross Monthly Salary</option>
                    <option value="basic_salary">Basic Salary Component</option>
                    <option value="fixed_cap">Fixed Amount Cap Only</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[var(--color-nexus-ink)] mb-1">Max Advance Cap (₹)</label>
                  <input
                    type="number"
                    value={advancePolicy.advanceMaxAmount || 50000}
                    disabled={savingAdvancePolicy}
                    onBlur={(e) => saveAdvancePolicy({ advanceMaxAmount: Number(e.target.value) })}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)] text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[var(--color-nexus-ink)] mb-1">Max % of Salary Basis</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={advancePolicy.advanceMaxPercentage || 50}
                    disabled={savingAdvancePolicy}
                    onBlur={(e) => saveAdvancePolicy({ advanceMaxPercentage: Number(e.target.value) })}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)] text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[var(--color-nexus-ink)] mb-1">Min Tenure Required (Months)</label>
                  <input
                    type="number"
                    min={0}
                    value={advancePolicy.advanceMinTenureMonths ?? 3}
                    disabled={savingAdvancePolicy}
                    onBlur={(e) => saveAdvancePolicy({ advanceMinTenureMonths: Number(e.target.value) })}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)] text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[var(--color-nexus-ink)] mb-1">Max Active Advances / Employee</label>
                  <input
                    type="number"
                    min={1}
                    value={advancePolicy.advanceMaxActiveCount ?? 1}
                    disabled={savingAdvancePolicy}
                    onBlur={(e) => saveAdvancePolicy({ advanceMaxActiveCount: Number(e.target.value) })}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)] text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[var(--color-nexus-ink)] mb-1">Max Recovery Installments (Months)</label>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={advancePolicy.advanceMaxInstallments ?? 6}
                    disabled={savingAdvancePolicy}
                    onBlur={(e) => saveAdvancePolicy({ advanceMaxInstallments: Number(e.target.value) })}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)] text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[var(--color-nexus-ink)] mb-1">Payroll Cutoff Day (1–31)</label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={advancePolicy.advancePayrollCutoffDay ?? 20}
                    disabled={savingAdvancePolicy}
                    onBlur={(e) => saveAdvancePolicy({ advancePayrollCutoffDay: Number(e.target.value) })}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)] text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[var(--color-nexus-ink)] mb-1">Default Recovery Method</label>
                  <select
                    value={advancePolicy.advanceDefaultRecoveryMethod || 'full_next_payroll'}
                    disabled={savingAdvancePolicy}
                    onChange={(e) => saveAdvancePolicy({ advanceDefaultRecoveryMethod: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)] text-xs"
                  >
                    <option value="full_next_payroll">Full Next Payroll</option>
                    <option value="installment">Installments</option>
                  </select>
                </div>

                <div className="flex flex-col justify-center gap-1.5 pt-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={advancePolicy.advanceEmployeeCanRequest !== false}
                      disabled={savingAdvancePolicy}
                      onChange={(e) => saveAdvancePolicy({ advanceEmployeeCanRequest: e.target.checked })}
                      className="rounded text-indigo-600"
                    />
                    <span className="text-[11px] text-[var(--color-nexus-ink)]">Allow Employee Self-Service Requests</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={advancePolicy.advanceApprovalRequired !== false}
                      disabled={savingAdvancePolicy}
                      onChange={(e) => saveAdvancePolicy({ advanceApprovalRequired: e.target.checked })}
                      className="rounded text-indigo-600"
                    />
                    <span className="text-[11px] text-[var(--color-nexus-ink)]">Require Management Approval</span>
                  </label>
                </div>
              </div>
            )}
          </div>

          <div>
            <h4 className="font-bold text-sm text-[var(--color-nexus-ink)] mb-2">Statutory Compliance & Deduction Rules</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-3.5 rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)]">
                <span className="font-bold text-[var(--color-nexus-ink)] block">Provident Fund (PF) Rate</span>
                <span className="text-[11px] text-[var(--color-nexus-muted)]">Standard employee/employer contribution percentage (12%)</span>
              </div>
              <div className="p-3.5 rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)]">
                <span className="font-bold text-[var(--color-nexus-ink)] block">ESI Contribution</span>
                <span className="text-[11px] text-[var(--color-nexus-muted)]">Statutory employee health insurance deduction</span>
              </div>
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
      onTabChange={(t) => {
        setActiveTab(t as any);
        navigate(`/tenant/payroll?tab=${t}`, { replace: true });
      }}
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
