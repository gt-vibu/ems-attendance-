import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { User } from '../lib/auth';
import PortalShell from '../components/PortalShell';
import { getAdminPortalNavItems, routeForAdminNav } from '../lib/adminPortalNav';
import { downloadCsv } from '../lib/csv';

const formatMoney = (value: number) => `₹${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// Role Defaults tab — set a salary structure ONCE per role name, which every
// employee in that role inherits automatically unless they have their own
// individual override (set via the per-employee wizard). The actual
// Basic/HRA/Fixed-Allowance/PF editing now happens on its own dedicated page
// (PayrollWizardPage.tsx in "role" mode) — this tab only shows a summary
// card per role with a "Set Default"/"Edit Default" button that navigates
// there, instead of piling the whole editor inline.

export default function PayrollPage({ user, onLogout, embedded = false }: { user: User; onLogout: () => void; embedded?: boolean }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = localStorage.getItem('auth_token');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [payrollSettings, setPayrollSettings] = useState<any>(null);
  const [payrollOverview, setPayrollOverview] = useState<any>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [workingDaysPerMonthInput, setWorkingDaysPerMonthInput] = useState('26');
  const [maxPaidLeaveDaysInput, setMaxPaidLeaveDaysInput] = useState('0');
  const [excessLeavePenaltyInput, setExcessLeavePenaltyInput] = useState('100');
  const [overtimeHourlyRateInput, setOvertimeHourlyRateInput] = useState('0');
  const [optionalHolidayLimitInput, setOptionalHolidayLimitInput] = useState('2');
  // --- Statutory compliance (PF/ESI/Professional Tax/TDS) — see the schema
  // comment on payrollSettings for the "simplified estimate" caveat. ---
  const [statutoryEnabled, setStatutoryEnabled] = useState(false);
  const [pfEnabled, setPfEnabled] = useState(false);
  const [pfEmployeeRateInput, setPfEmployeeRateInput] = useState('12');
  const [pfEmployerRateInput, setPfEmployerRateInput] = useState('12');
  const [pfWageCeilingInput, setPfWageCeilingInput] = useState('15000');
  const [esiEnabled, setEsiEnabled] = useState(false);
  const [esiEmployeeRateInput, setEsiEmployeeRateInput] = useState('0.75');
  const [esiEmployerRateInput, setEsiEmployerRateInput] = useState('3.25');
  const [esiWageCeilingInput, setEsiWageCeilingInput] = useState('21000');
  const [ptEnabled, setPtEnabled] = useState(false);
  const [ptFlatAmountInput, setPtFlatAmountInput] = useState('200');
  const [tdsEnabled, setTdsEnabled] = useState(false);
  const [tdsStandardDeductionInput, setTdsStandardDeductionInput] = useState('50000');
  const [statutoryBasicPercentInput, setStatutoryBasicPercentInput] = useState('50');
  const [setupFilter, setSetupFilter] = useState<'all' | 'configured' | 'pending'>('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [section, setSection] = useState<'builder' | 'roles'>('builder');
  const [roleDefaults, setRoleDefaults] = useState<any[]>([]);
  const [roleNames, setRoleNames] = useState<string[]>([]);
  const [roleDefaultsLoading, setRoleDefaultsLoading] = useState(true);
  const [roleDefaultsAccessible, setRoleDefaultsAccessible] = useState(true);
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleError, setRoleError] = useState('');
  const [roleSuccess, setRoleSuccess] = useState('');

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
      if (settingsData.settings) {
        setWorkingDaysPerMonthInput(String(settingsData.settings.workingDaysPerMonth ?? 26));
        setMaxPaidLeaveDaysInput(String(settingsData.settings.maxPaidLeaveDaysPerMonth ?? 0));
        setExcessLeavePenaltyInput(String(settingsData.settings.excessLeavePenaltyPercent ?? 100));
        setOvertimeHourlyRateInput(String(settingsData.settings.overtimeHourlyRate ?? 0));
        setOptionalHolidayLimitInput(String(settingsData.settings.optionalHolidayLimit ?? 2));
        const s = settingsData.settings;
        setStatutoryEnabled(!!s.statutoryComplianceEnabled);
        setPfEnabled(!!s.pfEnabled);
        setPfEmployeeRateInput(String(s.pfEmployeeRatePercent ?? 12));
        setPfEmployerRateInput(String(s.pfEmployerRatePercent ?? 12));
        setPfWageCeilingInput(String(s.pfWageCeiling ?? 15000));
        setEsiEnabled(!!s.esiEnabled);
        setEsiEmployeeRateInput(String(s.esiEmployeeRatePercent ?? 0.75));
        setEsiEmployerRateInput(String(s.esiEmployerRatePercent ?? 3.25));
        setEsiWageCeilingInput(String(s.esiWageCeiling ?? 21000));
        setPtEnabled(!!s.professionalTaxEnabled);
        setPtFlatAmountInput(String(Array.isArray(s.professionalTaxSlabs) && s.professionalTaxSlabs[0]?.amount != null ? s.professionalTaxSlabs[0].amount : 200));
        setTdsEnabled(!!s.tdsEnabled);
        setTdsStandardDeductionInput(String(s.tdsStandardDeduction ?? 50000));
        setStatutoryBasicPercentInput(String(s.statutoryBasicPercentOfGross ?? 50));
      }
    } catch (err: any) {
      setError(err.message || 'Could not load payroll data.');
    } finally {
      setLoading(false);
    }
  };

  const refreshRoleDefaults = async () => {
    setRoleDefaultsLoading(true);
    try {
      const res = await fetch('/api/tenant/payroll/role-defaults', { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 403) {
        setRoleDefaultsAccessible(false);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load role defaults.');
      setRoleDefaults(Array.isArray(data.roleDefaults) ? data.roleDefaults : []);
      setRoleNames(Array.isArray(data.roles) ? data.roles : []);
      setRoleDefaultsAccessible(true);
    } catch (err: any) {
      setRoleError(err.message || 'Could not load role defaults.');
    } finally {
      setRoleDefaultsLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    refreshRoleDefaults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep-link support: a "set up this new role" prompt (e.g. right after
  // hiring the first person into a brand-new role) links here with
  // ?section=roles&role=<name>. Since role-default editing now lives on its
  // own wizard page instead of an inline editor, this sends the admin
  // straight into that wizard for the requested role.
  useEffect(() => {
    if (roleDefaultsLoading) return;
    const requestedSection = searchParams.get('section');
    const requestedRole = searchParams.get('role');
    if (requestedSection === 'roles') setSection('roles');
    if (requestedRole && roleNames.includes(requestedRole)) {
      navigate(`/tenant/payroll/setup/role/${encodeURIComponent(requestedRole)}/salary`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleDefaultsLoading]);

  // The wizard sends us back here with ?section=roles&saved=<roleName> after
  // a successful save so the admin sees a confirmation instead of silently
  // landing back on the tab.
  useEffect(() => {
    const saved = searchParams.get('saved');
    if (!saved) return;
    setSection('roles');
    setRoleSuccess(`${saved} default package saved. Everyone inheriting it has been notified.`);
    const timeout = setTimeout(() => setRoleSuccess(''), 4000);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const removeRoleDefault = async (roleName: string) => {
    setRoleSaving(true);
    setRoleError('');
    try {
      const res = await fetch(`/api/tenant/payroll/role-defaults/${encodeURIComponent(roleName)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to remove role default.');
      await Promise.all([refreshRoleDefaults(), refresh()]);
    } catch (err: any) {
      setRoleError(err.message || 'Failed to remove role default.');
    } finally {
      setRoleSaving(false);
    }
  };

  const metrics = useMemo(() => ({
    annualCtc: payrollOverview?.totals?.totalAnnualCtc || 0,
    monthlyGross: payrollOverview?.totals?.totalMonthlyGross || 0,
    monthlyNet: payrollOverview?.totals?.totalMonthlyNet || 0,
    leaveCut: payrollOverview?.totals?.totalLeaveDeduction || 0,
  }), [payrollOverview]);

  const configuredCount = useMemo(() => (payrollOverview?.employees || []).length, [payrollOverview]);
  const unconfiguredCount = Math.max(0, employees.length - configuredCount);
  const averageNet = configuredCount > 0 ? metrics.monthlyNet / configuredCount : 0;

  // Role options for the filter dropdown — the union of every role name
  // actually present on a current employee and the tenant's full configured
  // role list (roleNames, from role-defaults' live `rolePrivilegeDefaults`
  // read). The union matters: a role with zero employees today still shows
  // up here since roleNames already carries it, and a role that somehow
  // isn't in roleNames yet (e.g. roleNames failed to load) still shows up
  // because an employee has it — either way, a newly created role is never
  // missing from this list without a code change.
  const employeeRoleOptions = useMemo(() => {
    const roles = new Set<string>(roleNames);
    employees.forEach((e) => { if (e.role) roles.add(e.role); });
    return Array.from(roles).sort((a, b) => a.localeCompare(b));
  }, [roleNames, employees]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((employee) => {
      const existingRow = (payrollOverview?.employees || []).find((row: any) => String(row.userId) === String(employee.id));
      const matchesSetup = setupFilter === 'all'
        || (setupFilter === 'configured' && !!existingRow)
        || (setupFilter === 'pending' && !existingRow);
      if (!matchesSetup) return false;
      if (roleFilter !== 'all' && employee.role !== roleFilter) return false;
      return true;
    });
  }, [employees, payrollOverview, setupFilter, roleFilter]);

  const handleSavePayrollSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/payroll/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          workingDaysPerMonth: parseInt(workingDaysPerMonthInput, 10) || 26,
          maxPaidLeaveDaysPerMonth: parseFloat(maxPaidLeaveDaysInput) || 0,
          excessLeavePenaltyPercent: parseFloat(excessLeavePenaltyInput) || 100,
          overtimeHourlyRate: parseFloat(overtimeHourlyRateInput) || 0,
          optionalHolidayLimit: parseInt(optionalHolidayLimitInput, 10) || 2,
          statutoryComplianceEnabled: statutoryEnabled,
          pfEnabled, pfEmployeeRatePercent: parseFloat(pfEmployeeRateInput) || 12, pfEmployerRatePercent: parseFloat(pfEmployerRateInput) || 12, pfWageCeiling: parseFloat(pfWageCeilingInput) || 15000,
          esiEnabled, esiEmployeeRatePercent: parseFloat(esiEmployeeRateInput) || 0.75, esiEmployerRatePercent: parseFloat(esiEmployerRateInput) || 3.25, esiWageCeiling: parseFloat(esiWageCeilingInput) || 21000,
          professionalTaxEnabled: ptEnabled,
          professionalTaxSlabs: [{ minGross: 0, maxGross: null, amount: parseFloat(ptFlatAmountInput) || 0 }],
          tdsEnabled, tdsStandardDeduction: parseFloat(tdsStandardDeductionInput) || 50000,
          statutoryBasicPercentOfGross: parseFloat(statutoryBasicPercentInput) || 50,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save payroll settings.');
      setPayrollSettings(data.settings || null);
      setSuccess('Payroll settings saved.');
      await refresh();
      setTimeout(() => setSuccess(''), 2500);
    } catch (err: any) {
      setError(err.message || 'Failed to save payroll settings.');
    } finally {
      setSaving(false);
    }
  };

  const content = (
    <>
      {error && <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-4 rounded-xl mb-6 border border-[var(--color-nexus-error)]/20 font-medium">{error}</div>}
      {success && <div className="bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)] text-xs p-4 rounded-xl mb-6 border border-[color:var(--color-nexus-success-text)]/20 font-medium">{success}</div>}

      <div className="space-y-6">
        <section className="rounded-[28px] border border-[var(--color-nexus-border)] bg-gradient-to-r from-[var(--color-nexus-primary-fixed)] via-white/80 to-[var(--color-nexus-secondary-container)] p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="font-sans text-2xl font-bold text-[var(--color-nexus-ink)]">Employee Compensation Workspace</h2>
              <p className="mt-2 max-w-2xl text-sm text-[var(--color-nexus-muted)]">This is now a dedicated payroll area. Pick an employee first, then move through separate setup pages for CTC, salary structure, PF, and final review.</p>
            </div>
            <button
              onClick={() => employees[0] && navigate(`/tenant/payroll/setup/employee/${employees[0].id}/salary`)}
              className="rounded-xl bg-[var(--color-nexus-primary)] px-4 py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--color-nexus-primary-hover)] disabled:opacity-50"
              disabled={employees.length === 0}
            >
              Start Payroll Setup
            </button>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {[
            ['Annual CTC', metrics.annualCtc],
            ['Monthly Gross', metrics.monthlyGross],
            ['Monthly Net', metrics.monthlyNet],
            ['Leave Deductions', metrics.leaveCut],
          ].map(([label, value]) => (
            <div key={String(label)} className="nexus-card rounded-3xl p-5">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">{label}</span>
              <span className="mt-2 block text-2xl font-black text-[var(--color-nexus-ink)]">{formatMoney(Number(value))}</span>
            </div>
          ))}
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="nexus-card rounded-3xl p-5">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Payroll Coverage</span>
            <span className="mt-2 block text-3xl font-black text-[var(--color-nexus-ink)]">{configuredCount}/{employees.length}</span>
            <p className="mt-2 text-xs text-[var(--color-nexus-muted)]">Employees with a saved salary structure and deductions profile.</p>
          </div>
          <div className="nexus-card rounded-3xl p-5">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Pending Setup</span>
            <span className="mt-2 block text-3xl font-black text-[var(--color-nexus-ink)]">{unconfiguredCount}</span>
            <p className="mt-2 text-xs text-[var(--color-nexus-muted)]">Employees still waiting for CTC, PF, and component configuration.</p>
          </div>
          <div className="nexus-card rounded-3xl p-5">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Average Net Pay</span>
            <span className="mt-2 block text-3xl font-black text-[var(--color-nexus-ink)]">{formatMoney(averageNet)}</span>
            <p className="mt-2 text-xs text-[var(--color-nexus-muted)]">Quick benchmark to spot unusual compensation setups early.</p>
          </div>
        </section>

        <div className="flex flex-wrap gap-2">
          {([
            ['builder', 'Compensation Builder'],
            ['roles', 'Role Defaults'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setSection(value)}
              className={`rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                section === value
                  ? 'bg-[var(--color-nexus-primary)] text-white'
                  : 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {roleError && <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-4 rounded-xl border border-[var(--color-nexus-error)]/20 font-medium">{roleError}</div>}
        {roleSuccess && <div className="bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)] text-xs p-4 rounded-xl border border-[color:var(--color-nexus-success-text)]/20 font-medium">{roleSuccess}</div>}

        {section === 'roles' && (
          <section className="nexus-card rounded-3xl p-6">
            <div>
              <h3 className="font-sans text-lg font-bold text-[var(--color-nexus-ink)]">Role Defaults</h3>
              <p className="mt-1 text-xs text-[var(--color-nexus-muted)]">Set a salary structure once per role — every employee in that role inherits it automatically unless they've been given a personal override in the Compensation Builder.</p>
            </div>

            {!roleDefaultsAccessible ? (
              <div className="mt-5 rounded-3xl border border-dashed border-[var(--color-nexus-border)] p-12 text-center text-sm text-[var(--color-nexus-muted)]">You don't have access to manage role defaults.</div>
            ) : roleDefaultsLoading ? (
              <div className="mt-5 py-16 text-center text-sm text-[var(--color-nexus-muted)]">Loading role defaults…</div>
            ) : roleNames.length === 0 ? (
              <div className="mt-5 rounded-3xl border border-dashed border-[var(--color-nexus-border)] p-12 text-center text-sm text-[var(--color-nexus-muted)]">No roles found in this tenant yet.</div>
            ) : (
              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                {roleNames.map((roleName) => {
                  const entry = roleDefaults.find((d: any) => d.roleName === roleName);
                  return (
                    <div key={roleName} className="rounded-3xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-bold text-[var(--color-nexus-ink)]">{roleName}</h4>
                          <p className="mt-1 text-xs text-[var(--color-nexus-muted)]">
                            {entry ? `${entry.overrideCount} of ${entry.employeeCount} employees customized` : `${entry?.employeeCount ?? ''} employees`}
                          </p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${entry ? 'bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)]' : 'bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-secondary)]'}`}>
                          {entry ? 'Configured' : 'Not set'}
                        </span>
                      </div>

                      {entry && (
                        <div className="mt-4 grid grid-cols-2 gap-3 text-[11px]">
                          <div><span className="block text-[var(--color-nexus-muted)]">Annual CTC</span><span className="font-bold text-[var(--color-nexus-ink)]">{formatMoney(entry.annualCtc)}</span></div>
                          <div><span className="block text-[var(--color-nexus-muted)]">Monthly Net</span><span className="font-bold text-[color:var(--color-nexus-success-text)]">{formatMoney(entry.summary?.monthlyNet || 0)}</span></div>
                        </div>
                      )}

                      <div className="mt-4 flex gap-2">
                        <button
                          onClick={() => navigate(`/tenant/payroll/setup/role/${encodeURIComponent(roleName)}/salary`)}
                          className="rounded-xl bg-[var(--color-nexus-primary)] px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-[var(--color-nexus-primary-hover)]"
                        >
                          {entry ? 'Edit Default' : 'Set Default'}
                        </button>
                        {entry && (
                          <button
                            onClick={() => removeRoleDefault(roleName)}
                            disabled={roleSaving}
                            className="rounded-xl border border-[var(--color-nexus-border)] bg-white px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-nexus-error)] disabled:opacity-50"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {section === 'builder' && (
        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.95fr_1.35fr]">
          <div className="nexus-card rounded-3xl p-6">
            <h3 className="font-sans text-lg font-bold text-[var(--color-nexus-ink)]">Payroll Settings</h3>
            <p className="mt-1 text-xs text-[var(--color-nexus-muted)]">Keep tenant-level working day and deduction rules separate from employee salary structure.</p>
            <form onSubmit={handleSavePayrollSettings} className="mt-5 space-y-4">
              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Working Days / Month</label>
                <input type="number" min="1" value={workingDaysPerMonthInput} onChange={(e) => setWorkingDaysPerMonthInput(e.target.value)} className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Max Paid Leave Days / Month</label>
                <input type="number" min="0" step="0.5" value={maxPaidLeaveDaysInput} onChange={(e) => setMaxPaidLeaveDaysInput(e.target.value)} className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Excess Leave Penalty %</label>
                <input type="number" min="0" step="1" value={excessLeavePenaltyInput} onChange={(e) => setExcessLeavePenaltyInput(e.target.value)} className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Default Overtime Rate</label>
                <input type="number" min="0" step="0.01" value={overtimeHourlyRateInput} onChange={(e) => setOvertimeHourlyRateInput(e.target.value)} className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Optional Holiday Limit</label>
                <input type="number" min="0" step="1" value={optionalHolidayLimitInput} onChange={(e) => setOptionalHolidayLimitInput(e.target.value)} className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm focus:outline-none" />
              </div>

              <div className="border-t border-[var(--color-nexus-border)] pt-4 mt-4">
                <label className="flex items-center gap-2.5 cursor-pointer mb-1">
                  <input type="checkbox" checked={statutoryEnabled} onChange={(e) => setStatutoryEnabled(e.target.checked)} className="w-4 h-4 accent-[var(--color-nexus-primary)]" />
                  <span className="text-xs font-bold text-[var(--color-nexus-ink)] uppercase tracking-wider">Statutory Compliance</span>
                </label>
                <p className="text-[10px] text-[var(--color-nexus-muted)] mb-3">India-style defaults (PF/ESI/Professional Tax/TDS) — every rate is editable. TDS here is a simplified estimate (annual slabs, standard deduction only, no HRA/80C) for payslip display, not a statutory filing engine.</p>

                {statutoryEnabled && (
                  <div className="space-y-4 pl-1">
                    <div className="rounded-2xl bg-[var(--color-nexus-surface-alt)] p-3.5">
                      <label className="flex items-center gap-2 cursor-pointer mb-2">
                        <input type="checkbox" checked={pfEnabled} onChange={(e) => setPfEnabled(e.target.checked)} className="accent-[var(--color-nexus-primary)]" />
                        <span className="text-[11px] font-bold text-[var(--color-nexus-ink)]">Provident Fund (PF)</span>
                      </label>
                      {pfEnabled && (
                        <div className="grid grid-cols-3 gap-2">
                          <div><span className="block text-[9px] text-[var(--color-nexus-muted)] mb-1">Employee %</span><input type="number" step="0.1" value={pfEmployeeRateInput} onChange={(e) => setPfEmployeeRateInput(e.target.value)} className="w-full rounded-lg border border-[var(--color-nexus-border)] bg-white px-2 py-1.5 text-xs" /></div>
                          <div><span className="block text-[9px] text-[var(--color-nexus-muted)] mb-1">Employer %</span><input type="number" step="0.1" value={pfEmployerRateInput} onChange={(e) => setPfEmployerRateInput(e.target.value)} className="w-full rounded-lg border border-[var(--color-nexus-border)] bg-white px-2 py-1.5 text-xs" /></div>
                          <div><span className="block text-[9px] text-[var(--color-nexus-muted)] mb-1">Wage Ceiling</span><input type="number" step="1" value={pfWageCeilingInput} onChange={(e) => setPfWageCeilingInput(e.target.value)} className="w-full rounded-lg border border-[var(--color-nexus-border)] bg-white px-2 py-1.5 text-xs" /></div>
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl bg-[var(--color-nexus-surface-alt)] p-3.5">
                      <label className="flex items-center gap-2 cursor-pointer mb-2">
                        <input type="checkbox" checked={esiEnabled} onChange={(e) => setEsiEnabled(e.target.checked)} className="accent-[var(--color-nexus-primary)]" />
                        <span className="text-[11px] font-bold text-[var(--color-nexus-ink)]">Employee State Insurance (ESI)</span>
                      </label>
                      {esiEnabled && (
                        <div className="grid grid-cols-3 gap-2">
                          <div><span className="block text-[9px] text-[var(--color-nexus-muted)] mb-1">Employee %</span><input type="number" step="0.01" value={esiEmployeeRateInput} onChange={(e) => setEsiEmployeeRateInput(e.target.value)} className="w-full rounded-lg border border-[var(--color-nexus-border)] bg-white px-2 py-1.5 text-xs" /></div>
                          <div><span className="block text-[9px] text-[var(--color-nexus-muted)] mb-1">Employer %</span><input type="number" step="0.01" value={esiEmployerRateInput} onChange={(e) => setEsiEmployerRateInput(e.target.value)} className="w-full rounded-lg border border-[var(--color-nexus-border)] bg-white px-2 py-1.5 text-xs" /></div>
                          <div><span className="block text-[9px] text-[var(--color-nexus-muted)] mb-1">Wage Ceiling</span><input type="number" step="1" value={esiWageCeilingInput} onChange={(e) => setEsiWageCeilingInput(e.target.value)} className="w-full rounded-lg border border-[var(--color-nexus-border)] bg-white px-2 py-1.5 text-xs" /></div>
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl bg-[var(--color-nexus-surface-alt)] p-3.5">
                      <label className="flex items-center gap-2 cursor-pointer mb-2">
                        <input type="checkbox" checked={ptEnabled} onChange={(e) => setPtEnabled(e.target.checked)} className="accent-[var(--color-nexus-primary)]" />
                        <span className="text-[11px] font-bold text-[var(--color-nexus-ink)]">Professional Tax</span>
                      </label>
                      {ptEnabled && (
                        <div><span className="block text-[9px] text-[var(--color-nexus-muted)] mb-1">Flat Monthly Amount</span><input type="number" step="1" value={ptFlatAmountInput} onChange={(e) => setPtFlatAmountInput(e.target.value)} className="w-full max-w-[140px] rounded-lg border border-[var(--color-nexus-border)] bg-white px-2 py-1.5 text-xs" /></div>
                      )}
                    </div>

                    <div className="rounded-2xl bg-[var(--color-nexus-surface-alt)] p-3.5">
                      <label className="flex items-center gap-2 cursor-pointer mb-2">
                        <input type="checkbox" checked={tdsEnabled} onChange={(e) => setTdsEnabled(e.target.checked)} className="accent-[var(--color-nexus-primary)]" />
                        <span className="text-[11px] font-bold text-[var(--color-nexus-ink)]">TDS (Income Tax, estimate)</span>
                      </label>
                      {tdsEnabled && (
                        <div><span className="block text-[9px] text-[var(--color-nexus-muted)] mb-1">Annual Standard Deduction</span><input type="number" step="1" value={tdsStandardDeductionInput} onChange={(e) => setTdsStandardDeductionInput(e.target.value)} className="w-full max-w-[140px] rounded-lg border border-[var(--color-nexus-border)] bg-white px-2 py-1.5 text-xs" /></div>
                      )}
                    </div>

                    <div>
                      <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Basic Wage (% of Gross, when no "Basic" component is defined)</label>
                      <input type="number" min="0" max="100" step="1" value={statutoryBasicPercentInput} onChange={(e) => setStatutoryBasicPercentInput(e.target.value)} className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm focus:outline-none" />
                    </div>
                  </div>
                )}
              </div>

              <button type="submit" disabled={saving} className="w-full rounded-2xl bg-[var(--color-nexus-primary)] py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--color-nexus-primary-hover)] disabled:opacity-50">
                {saving ? 'Saving…' : 'Save Payroll Settings'}
              </button>
            </form>
          </div>

          <div className="nexus-card rounded-3xl p-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="font-sans text-lg font-bold text-[var(--color-nexus-ink)]">Compensation Builder</h3>
                <p className="mt-1 text-xs text-[var(--color-nexus-muted)]">Choose the employee first, then configure CTC and components in separate steps.</p>
              </div>
              <button
                type="button"
                onClick={() => downloadCsv(
                  `payroll-overview-${new Date().toISOString().slice(0, 10)}.csv`,
                  [
                    ['Employee', 'Role', 'Department', 'Annual CTC', 'Monthly Gross', 'Monthly Net', 'Setup Source'],
                    ...((payrollOverview?.employees || []) as any[]).map((row) => [row.name, row.role, row.department, row.annualCtc, row.monthlyGross, row.monthlyNet, row.source]),
                  ]
                )}
                disabled={!(payrollOverview?.employees || []).length}
                className="shrink-0 rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-ink)] hover:bg-[var(--color-nexus-border)] disabled:opacity-50"
              >
                Export CSV
              </button>
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <select
                value={setupFilter}
                onChange={(e) => setSetupFilter(e.target.value as 'all' | 'configured' | 'pending')}
                className="w-full sm:w-56 rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm focus:outline-none"
              >
                <option value="all">All Setup Status</option>
                <option value="configured">Configured</option>
                <option value="pending">Pending Setup</option>
              </select>
              {/* Role list is never hardcoded — employeeRoleOptions is the live
                  union of the tenant's configured roles + whatever's actually
                  on an employee record, so a newly created custom role
                  appears here automatically, no code change needed. */}
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="w-full sm:w-56 rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm focus:outline-none"
              >
                <option value="all">All Roles</option>
                {employeeRoleOptions.map((roleName) => (
                  <option key={roleName} value={roleName}>{roleName}</option>
                ))}
              </select>
            </div>

            {loading ? (
              <div className="py-16 text-center text-sm text-[var(--color-nexus-muted)]">Loading employees…</div>
            ) : filteredEmployees.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-[var(--color-nexus-border)] p-12 text-center text-sm text-[var(--color-nexus-muted)]">No employees available for payroll setup yet.</div>
            ) : (
              <div className="mt-5 space-y-3">
                {filteredEmployees.map((employee) => {
                  const existingRow = (payrollOverview?.employees || []).find((row: any) => String(row.userId) === String(employee.id));
                  return (
                    <div key={employee.id} className="rounded-3xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-5 py-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-sm font-bold text-[var(--color-nexus-ink)]">{employee.name}</h4>
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                              !existingRow
                                ? 'bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-secondary)]'
                                : existingRow.source === 'individual'
                                  ? 'bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)]'
                                  : 'bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)]'
                            }`}>
                              {!existingRow ? 'Pending setup' : existingRow.source === 'individual' ? 'Custom' : `Standard — ${employee.role} default`}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-[var(--color-nexus-muted)]">{employee.department || 'Unassigned'} • {employee.role}</p>
                          <div className="mt-3 grid grid-cols-2 gap-3 text-[11px] md:grid-cols-4">
                            <div><span className="block text-[var(--color-nexus-muted)]">Annual CTC</span><span className="font-bold text-[var(--color-nexus-ink)]">{formatMoney(existingRow?.annualCtc || 0)}</span></div>
                            <div><span className="block text-[var(--color-nexus-muted)]">Gross</span><span className="font-bold text-[var(--color-nexus-secondary)]">{formatMoney(existingRow?.monthlyGross || 0)}</span></div>
                            <div><span className="block text-[var(--color-nexus-muted)]">Net</span><span className="font-bold text-[color:var(--color-nexus-success-text)]">{formatMoney(existingRow?.monthlyNet || 0)}</span></div>
                            <div><span className="block text-[var(--color-nexus-muted)]">Leave Cut</span><span className="font-bold text-[var(--color-nexus-error)]">{formatMoney(existingRow?.leaveDeduction || 0)}</span></div>
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <button
                            onClick={() => navigate(`/tenant/payroll/history/${employee.id}`)}
                            className="rounded-xl border border-[var(--color-nexus-border)] px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)] hover:bg-[var(--color-nexus-surface-alt)]"
                          >
                            History
                          </button>
                          <button
                            onClick={() => navigate(`/tenant/payroll/setup/employee/${employee.id}/salary`)}
                            className="rounded-xl bg-[var(--color-nexus-primary)] px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-[var(--color-nexus-primary-hover)]"
                          >
                            {existingRow ? 'Edit Structure' : 'Setup Payroll'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
        )}
      </div>
    </>
  );

  if (embedded) {
    return content;
  }

  return (
    <PortalShell
      user={user}
      roleLabel={user.role === 'tenant_admin' ? 'Tenant Admin' : user.role}
      navItems={getAdminPortalNavItems(user.role)}
      activeTab="payroll"
      onTabChange={(id) => navigate(routeForAdminNav(id))}
      onLogout={onLogout}
      title="Payroll"
      fallbackHref="/dashboard"
    >
      {content}
    </PortalShell>
  );
}
