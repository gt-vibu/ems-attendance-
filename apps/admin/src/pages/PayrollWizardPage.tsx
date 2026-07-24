import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { User } from '../lib/auth';
import PortalShell from '../components/PortalShell';
import { getAdminPortalNavItems, routeForAdminNav } from '../lib/adminPortalNav';
import DateSelect from '../components/DateSelect';

type PayrollWizardStep = 'salary' | 'statutory' | 'review';
// This wizard is shared by two entry points that both write a compensation
// structure through the exact same step UI: an individual employee's
// personal override (mode: 'employee', keyed by userId), and a role's shared
// default package (mode: 'role', keyed by roleName) — see PayrollPage.tsx's
// "Role Defaults" tab, which now sends admins here instead of embedding a
// second, cramped copy of this editor inline.
type WizardMode = 'employee' | 'role';
// A custom earning/deduction row, mirroring Zoho's "+ Add Earning" /
// "+ Add Deduction" affordance: each row picks a Calculation Type (a
// percentage of CTC, or a flat annual amount) independently.
type CalculationType = 'percent_of_ctc' | 'fixed_annual';
type CustomComponentDraft = {
  id: string;
  name: string;
  calcType: CalculationType;
  value: string; // percent (0-100) when calcType is percent_of_ctc, else an annual amount
};
type CompensationDraft = {
  annualCtc: string;
  effectiveFrom: string;
  overtimeHourlyRate: string;
  basicPercent: string;
  hraPercent: string;
  employeePfPercent: string;
  employerPfPercent: string;
  professionalTaxAnnual: string;
  customEarnings: CustomComponentDraft[];
  customDeductions: CustomComponentDraft[];
};

const DEFAULT_DRAFT: CompensationDraft = {
  annualCtc: '',
  effectiveFrom: new Date().toISOString().slice(0, 10),
  overtimeHourlyRate: '',
  basicPercent: '50',
  hraPercent: '20',
  employeePfPercent: '12',
  employerPfPercent: '12',
  professionalTaxAnnual: '2400',
  customEarnings: [],
  customDeductions: [],
};

function makeComponentId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const STEP_ORDER: PayrollWizardStep[] = ['salary', 'statutory', 'review'];
const formatMoney = (value: number) => `₹${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function parsePercent(value: string) {
  return Math.max(0, Number(value || 0));
}

function percentFromComponent(component: any, annualCtc: number, fallback: string) {
  if (!component) return fallback;
  if (component.calculationType === 'percent_of_ctc') return String(component.value);
  if (component.calculationType === 'fixed_annual' && annualCtc > 0) {
    return String((Number(component.value || 0) / annualCtc) * 100);
  }
  return fallback;
}

function loadSavedDraft(draftKey: string): CompensationDraft | null {
  try {
    const raw = sessionStorage.getItem(`payroll-wizard-${draftKey}`);
    if (!raw) return null;
    return { ...DEFAULT_DRAFT, ...JSON.parse(raw) };
  } catch {
    return null;
  }
}

function saveDraft(draftKey: string, draft: CompensationDraft) {
  sessionStorage.setItem(`payroll-wizard-${draftKey}`, JSON.stringify(draft));
}

function clearDraft(draftKey: string) {
  sessionStorage.removeItem(`payroll-wizard-${draftKey}`);
}

// Shared by both modes: given a saved components array (from either the
// per-employee profile or a role's default template) plus the annual CTC,
// reconstruct the Basic/HRA/PF percent fields and any custom earning/
// deduction rows the same way regardless of where the data came from.
function buildDraftFromComponents(annualCtcRaw: any, components: any[], effectiveFrom?: string | null, overtimeHourlyRate?: any): CompensationDraft {
  const list = Array.isArray(components) ? components : [];
  const basic = list.find((row: any) => row.componentType === 'earning' && String(row.componentName || '').toLowerCase().includes('basic'));
  const hra = list.find((row: any) => row.componentType === 'earning' && String(row.componentName || '').toLowerCase().includes('hra'));
  const employeePf = list.find((row: any) => row.componentType === 'deduction' && String(row.componentName || '').toLowerCase().includes('pf'));
  const employerPf = list.find((row: any) => row.componentType === 'employer_contribution' && String(row.componentName || '').toLowerCase().includes('pf'));
  const professionalTax = list.find((row: any) => String(row.componentName || '').toLowerCase().includes('professional'));
  // Any earning/deduction component that isn't one of the fixed rows above
  // (Basic, HRA, Fixed Allowance, Employee PF, Professional Tax, Employer PF)
  // is a previously-saved custom row — surface it as an editable "+ Add
  // Earning/Deduction" row instead of silently dropping it on the next save.
  const isFixedEarningName = (name: string) => ['basic', 'hra', 'fixed allowance'].some((needle) => name.includes(needle));
  const isFixedDeductionName = (name: string) => name.includes('professional') || name.includes('pf');
  const customEarningComponents = list.filter((row: any) => row.componentType === 'earning' && !isFixedEarningName(String(row.componentName || '').toLowerCase()));
  const customDeductionComponents = list.filter((row: any) => row.componentType === 'deduction' && !isFixedDeductionName(String(row.componentName || '').toLowerCase()));
  const toCustomDraft = (row: any): CustomComponentDraft => ({
    id: makeComponentId(),
    name: row.componentName,
    calcType: row.calculationType === 'percent_of_ctc' ? 'percent_of_ctc' : 'fixed_annual',
    value: String(row.value ?? 0),
  });
  const annualCtcValue = Number(annualCtcRaw || 0);
  return {
    annualCtc: annualCtcRaw != null ? String(annualCtcRaw) : DEFAULT_DRAFT.annualCtc,
    effectiveFrom: effectiveFrom || DEFAULT_DRAFT.effectiveFrom,
    overtimeHourlyRate: overtimeHourlyRate != null ? String(overtimeHourlyRate) : DEFAULT_DRAFT.overtimeHourlyRate,
    basicPercent: percentFromComponent(basic, annualCtcValue, DEFAULT_DRAFT.basicPercent),
    hraPercent: percentFromComponent(hra, annualCtcValue, DEFAULT_DRAFT.hraPercent),
    employeePfPercent: percentFromComponent(employeePf, annualCtcValue, DEFAULT_DRAFT.employeePfPercent),
    employerPfPercent: percentFromComponent(employerPf, annualCtcValue, DEFAULT_DRAFT.employerPfPercent),
    professionalTaxAnnual: professionalTax?.value != null ? String(professionalTax.value) : DEFAULT_DRAFT.professionalTaxAnnual,
    customEarnings: customEarningComponents.map(toCustomDraft),
    customDeductions: customDeductionComponents.map(toCustomDraft),
  };
}

export default function PayrollWizardPage({ user, onLogout }: { user: User; onLogout: () => void }) {
  const navigate = useNavigate();
  const { userId, roleName: roleNameParam, step } = useParams<{ userId?: string; roleName?: string; step: PayrollWizardStep }>();
  const mode: WizardMode = roleNameParam != null ? 'role' : 'employee';
  const entityId = mode === 'role' ? (roleNameParam || '') : (userId || '');
  const draftKey = mode === 'role' ? `role-${entityId}` : `employee-${entityId}`;
  const basePath = (target: PayrollWizardStep) => (mode === 'role'
    ? `/tenant/payroll/setup/role/${encodeURIComponent(entityId)}/${target}`
    : `/tenant/payroll/setup/employee/${entityId}/${target}`);
  const token = localStorage.getItem('auth_token');
  const activeStep: PayrollWizardStep = STEP_ORDER.includes((step as PayrollWizardStep) || 'salary') ? (step as PayrollWizardStep) : 'salary';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [employee, setEmployee] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [draft, setDraft] = useState<CompensationDraft>(DEFAULT_DRAFT);

  useEffect(() => {
    if (!entityId) return;
    if (step && !STEP_ORDER.includes(step as PayrollWizardStep)) {
      navigate(basePath('salary'), { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, step, entityId, mode]);

  useEffect(() => {
    if (!entityId) return;
    const populate = async () => {
      setLoading(true);
      try {
        if (mode === 'employee') {
          const [usersRes, detailRes] = await Promise.all([
            fetch('/api/tenant/users', { headers: { Authorization: `Bearer ${token}` } }),
            fetch(`/api/tenant/payroll/employee/${entityId}`, { headers: { Authorization: `Bearer ${token}` } }),
          ]);
          const usersData = await usersRes.json().catch(() => ({}));
          const detailData = await detailRes.json().catch(() => ({}));
          if (!usersRes.ok) throw new Error(usersData.error || 'Could not load employee list.');
          if (!detailRes.ok) throw new Error(detailData.error || 'Could not load payroll profile.');
          const selectedEmployee = (usersData.users || []).find((row: any) => String(row.id) === String(entityId));
          setEmployee(selectedEmployee || detailData.employee || null);
          setDetail(detailData);

          const persisted = loadSavedDraft(draftKey);
          if (persisted) {
            setDraft(persisted);
            return;
          }

          const initialDraft = buildDraftFromComponents(
            detailData.profile?.annualCtc,
            detailData.components,
            detailData.profile?.effectiveFrom,
            detailData.profile?.overtimeHourlyRate,
          );
          setDraft(initialDraft);
          saveDraft(draftKey, initialDraft);
        } else {
          const res = await fetch('/api/tenant/payroll/role-defaults', { headers: { Authorization: `Bearer ${token}` } });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'Could not load role defaults.');
          if (Array.isArray(data.roles) && !data.roles.includes(entityId)) {
            throw new Error(`Role "${entityId}" was not found in this tenant.`);
          }
          const entry = (data.roleDefaults || []).find((d: any) => d.roleName === entityId);
          setEmployee(null);
          setDetail({ roleName: entityId, entry, summary: entry?.summary, employeeCount: entry?.employeeCount, overrideCount: entry?.overrideCount });

          const persisted = loadSavedDraft(draftKey);
          if (persisted) {
            setDraft(persisted);
            return;
          }

          const initialDraft = buildDraftFromComponents(entry?.annualCtc, entry?.components);
          setDraft(initialDraft);
          saveDraft(draftKey, initialDraft);
        }
      } catch (err: any) {
        setError(err.message || 'Could not load payroll setup.');
      } finally {
        setLoading(false);
      }
    };
    populate();
  }, [token, entityId, mode, draftKey]);

  useEffect(() => {
    // Guarded on `loading`: without this, this effect fires on the very
    // first render (draft still === DEFAULT_DRAFT) and writes that empty
    // draft to sessionStorage before populate() below gets a chance to check
    // for a persisted draft — populate() then sees its own just-written
    // empty draft, treats it as "already have a draft", and skips
    // initializing from the fetched profile/role-default entirely. Once
    // loading is false, populate() has already made its decision, so it's
    // safe to persist every subsequent change.
    if (!entityId || loading) return;
    saveDraft(draftKey, draft);
  }, [draft, entityId, draftKey, loading]);

  const annualCtc = Number(draft.annualCtc || 0);
  const basicAnnual = annualCtc * parsePercent(draft.basicPercent) / 100;
  const hraAnnual = annualCtc * parsePercent(draft.hraPercent) / 100;

  const customComponentAnnual = (row: CustomComponentDraft) =>
    row.calcType === 'percent_of_ctc' ? annualCtc * parsePercent(row.value) / 100 : Math.max(0, Number(row.value || 0));
  const customEarningsAnnualTotal = draft.customEarnings.reduce((sum, row) => sum + customComponentAnnual(row), 0);
  const customDeductionsAnnualTotal = draft.customDeductions.reduce((sum, row) => sum + customComponentAnnual(row), 0);

  // Fixed Allowance auto-balances whatever's left of the CTC after Basic,
  // HRA, and any custom earnings — so "Cost to Company" always foots back to
  // the annual CTC no matter how the earnings are split (Zoho-style).
  const fixedAllowanceAnnual = Math.max(0, annualCtc - basicAnnual - hraAnnual - customEarningsAnnualTotal);
  const employeePfAnnual = annualCtc * parsePercent(draft.employeePfPercent) / 100;
  const employerPfAnnual = annualCtc * parsePercent(draft.employerPfPercent) / 100;
  const professionalTaxAnnual = Number(draft.professionalTaxAnnual || 0);
  const monthlyGross = annualCtc / 12;
  const monthlyDeductions = (employeePfAnnual + professionalTaxAnnual + customDeductionsAnnualTotal) / 12;
  const monthlyNet = monthlyGross - monthlyDeductions;
  const annualEmployerCost = annualCtc + employerPfAnnual;
  const monthlyEmployerCost = annualEmployerCost / 12;
  const netPayoutRatio = monthlyGross > 0 ? (monthlyNet / monthlyGross) * 100 : 0;
  const salaryOverAllocated = basicAnnual + hraAnnual + customEarningsAnnualTotal > annualCtc;

  const previewRows = useMemo(() => [
    { label: 'Basic', section: 'Earnings', type: '% of CTC', monthly: basicAnnual / 12, annual: basicAnnual },
    { label: 'HRA', section: 'Earnings', type: '% of CTC', monthly: hraAnnual / 12, annual: hraAnnual },
    { label: 'Fixed Allowance', section: 'Earnings', type: 'Fixed amount', monthly: fixedAllowanceAnnual / 12, annual: fixedAllowanceAnnual },
    ...draft.customEarnings.filter((row) => row.name.trim()).map((row) => ({
      label: row.name, section: 'Earnings', type: row.calcType === 'percent_of_ctc' ? '% of CTC' : 'Fixed amount',
      monthly: customComponentAnnual(row) / 12, annual: customComponentAnnual(row),
    })),
    { label: 'Employee PF', section: 'Deductions', type: '% of CTC', monthly: employeePfAnnual / 12, annual: employeePfAnnual },
    { label: 'Professional Tax', section: 'Deductions', type: 'Fixed annual', monthly: professionalTaxAnnual / 12, annual: professionalTaxAnnual },
    ...draft.customDeductions.filter((row) => row.name.trim()).map((row) => ({
      label: row.name, section: 'Deductions', type: row.calcType === 'percent_of_ctc' ? '% of CTC' : 'Fixed amount',
      monthly: customComponentAnnual(row) / 12, annual: customComponentAnnual(row),
    })),
    { label: 'Employer PF', section: 'Employer Contribution', type: '% of CTC', monthly: employerPfAnnual / 12, annual: employerPfAnnual },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [basicAnnual, employeePfAnnual, employerPfAnnual, fixedAllowanceAnnual, hraAnnual, professionalTaxAnnual, draft.customEarnings, draft.customDeductions, annualCtc]);

  const updateDraft = (key: keyof CompensationDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const addCustomComponent = (kind: 'customEarnings' | 'customDeductions') => {
    setDraft((current) => ({
      ...current,
      [kind]: [...current[kind], { id: makeComponentId(), name: '', calcType: 'fixed_annual', value: '0' }],
    }));
  };
  const updateCustomComponent = (kind: 'customEarnings' | 'customDeductions', id: string, patch: Partial<CustomComponentDraft>) => {
    setDraft((current) => ({
      ...current,
      [kind]: current[kind].map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));
  };
  const removeCustomComponent = (kind: 'customEarnings' | 'customDeductions', id: string) => {
    setDraft((current) => ({ ...current, [kind]: current[kind].filter((row) => row.id !== id) }));
  };

  const goToStep = (target: PayrollWizardStep) => {
    navigate(basePath(target));
  };

  const saveProfile = async () => {
    if (!entityId) return;
    setSaving(true);
    setError('');
    try {
      const componentsPayload = [
        { componentName: 'Basic', componentType: 'earning', calculationType: 'percent_of_ctc', value: parsePercent(draft.basicPercent) },
        { componentName: 'HRA', componentType: 'earning', calculationType: 'percent_of_ctc', value: parsePercent(draft.hraPercent) },
        { componentName: 'Fixed Allowance', componentType: 'earning', calculationType: 'fixed_annual', value: fixedAllowanceAnnual },
        ...draft.customEarnings.filter((row) => row.name.trim()).map((row) => ({
          componentName: row.name.trim(), componentType: 'earning', calculationType: row.calcType,
          value: row.calcType === 'percent_of_ctc' ? parsePercent(row.value) : Math.max(0, Number(row.value || 0)),
        })),
        { componentName: 'Employee PF', componentType: 'deduction', calculationType: 'percent_of_ctc', value: parsePercent(draft.employeePfPercent) },
        { componentName: 'Professional Tax', componentType: 'deduction', calculationType: 'fixed_annual', value: professionalTaxAnnual },
        ...draft.customDeductions.filter((row) => row.name.trim()).map((row) => ({
          componentName: row.name.trim(), componentType: 'deduction', calculationType: row.calcType,
          value: row.calcType === 'percent_of_ctc' ? parsePercent(row.value) : Math.max(0, Number(row.value || 0)),
        })),
        { componentName: 'Employer PF', componentType: 'employer_contribution', calculationType: 'percent_of_ctc', value: parsePercent(draft.employerPfPercent) },
      ];

      const res = mode === 'employee'
        ? await fetch(`/api/tenant/payroll/employee/${entityId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            annualCtc,
            overtimeHourlyRate: draft.overtimeHourlyRate ? Number(draft.overtimeHourlyRate) : null,
            effectiveFrom: draft.effectiveFrom,
            components: componentsPayload,
          }),
        })
        : await fetch(`/api/tenant/payroll/role-defaults/${encodeURIComponent(entityId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ annualCtc, components: componentsPayload }),
        });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to save ${mode === 'role' ? 'role default' : 'employee payroll'}.`);
      clearDraft(draftKey);
      setSuccess(mode === 'role' ? `${entityId} default package saved. Everyone inheriting it has been notified.` : 'Employee payroll saved.');
      setTimeout(() => {
        navigate(mode === 'role' ? `/tenant/payroll?section=roles&saved=${encodeURIComponent(entityId)}` : '/tenant/payroll');
      }, 900);
    } catch (err: any) {
      setError(err.message || `Failed to save ${mode === 'role' ? 'role default' : 'employee payroll'}.`);
    } finally {
      setSaving(false);
    }
  };

  const stepIndex = STEP_ORDER.indexOf(activeStep);

  return (
    <PortalShell
      user={user}
      roleLabel={user.role === 'tenant_admin' ? 'Tenant Admin' : user.role}
      navItems={getAdminPortalNavItems(user.role)}
      activeTab="payroll"
      onTabChange={(id) => navigate(routeForAdminNav(id))}
      onLogout={onLogout}
      title={mode === 'role' ? 'Role Default Setup Wizard' : 'Payroll Setup Wizard'}
      fallbackHref={mode === 'role' ? '/tenant/payroll?section=roles' : '/tenant/payroll'}
    >
      {error && <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-4 rounded-xl mb-6 border border-[var(--color-nexus-error)]/20 font-medium">{error}</div>}
      {success && <div className="bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)] text-xs p-4 rounded-xl mb-6 border border-[color:var(--color-nexus-success-text)]/20 font-medium">{success}</div>}

      {loading ? (
        <div className="nexus-card rounded-3xl p-16 text-center text-sm text-[var(--color-nexus-muted)]">Loading payroll builder…</div>
      ) : (
        <div className="space-y-6">
          <section className="nexus-card rounded-3xl p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-sans text-2xl font-bold text-[var(--color-nexus-ink)]">
                    {mode === 'role' ? `${entityId} Role Default` : `${employee?.name || detail?.employee?.name || 'Employee'} Compensation Builder`}
                  </h2>
                  {mode === 'employee' && detail?.source === 'role_default' && (
                    <span className="rounded-full bg-[var(--color-nexus-primary-fixed)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-primary)]">
                      Following the standard {employee?.role || detail?.employee?.role} default
                    </span>
                  )}
                </div>
                {mode === 'role' ? (
                  <p className="mt-1 text-sm text-[var(--color-nexus-muted)]">
                    Shared default package for everyone with the "{entityId}" role • {detail?.employeeCount ?? 0} employee{detail?.employeeCount === 1 ? '' : 's'} in this role
                    {detail?.overrideCount ? `, ${detail.overrideCount} on a personal override` : ''} • build it in separate steps, not one dumped form.
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-[var(--color-nexus-muted)]">{employee?.department || detail?.employee?.department || 'Unassigned'} • {employee?.role || detail?.employee?.role || 'employee'} • build salary structure in separate steps, not one dumped form.</p>
                )}
                {mode === 'employee' && detail?.source === 'role_default' && (
                  <p className="mt-1 text-xs text-[var(--color-nexus-muted)]">Pre-filled from the role default below — saving here creates a personal override just for this employee, it never changes the shared default.</p>
                )}
                {mode === 'role' && (
                  <p className="mt-1 text-xs text-[var(--color-nexus-muted)]">Saving here updates the shared default — anyone on the standard package (no personal override) is notified automatically.</p>
                )}
              </div>
              <button
                onClick={() => navigate(mode === 'role' ? '/tenant/payroll?section=roles' : '/tenant/payroll')}
                className="rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-ink)]"
              >
                Back to Payroll
              </button>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
              {STEP_ORDER.map((item, index) => (
                <button
                  key={item}
                  onClick={() => goToStep(item)}
                  className={`rounded-2xl border px-4 py-4 text-left transition-colors ${
                    activeStep === item
                      ? 'border-[var(--color-nexus-primary)] bg-[var(--color-nexus-primary-fixed)]'
                      : 'border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)]'
                  }`}
                >
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Step {index + 1}</span>
                  <span className="mt-1 block text-sm font-bold text-[var(--color-nexus-ink)]">
                    {item === 'salary' ? 'Salary Structure' : item === 'statutory' ? 'PF & Deductions' : 'Review & Save'}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {activeStep === 'salary' && (
            <section className="nexus-card rounded-3xl p-6">
              <div className="mb-5">
                <h3 className="font-sans text-xl font-bold text-[var(--color-nexus-ink)]">Salary Structure</h3>
                <p className="mt-1 text-sm text-[var(--color-nexus-muted)]">Start with the annual CTC and split the earnings the way you showed: basic, HRA, and an auto-balanced fixed allowance.</p>
              </div>

              <div className={`grid grid-cols-1 gap-5 ${mode === 'employee' ? 'md:grid-cols-3' : 'md:max-w-xs'}`}>
                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Annual CTC</label>
                  <input type="number" min="0" value={draft.annualCtc} onChange={(e) => updateDraft('annualCtc', e.target.value)} className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm focus:outline-none" />
                </div>
                {mode === 'employee' && (
                  <>
                    <div>
                      <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Effective From</label>
                      <DateSelect value={draft.effectiveFrom} onChange={(v) => updateDraft('effectiveFrom', v)} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Overtime Hourly Rate</label>
                      <input type="number" min="0" step="0.01" value={draft.overtimeHourlyRate} onChange={(e) => updateDraft('overtimeHourlyRate', e.target.value)} className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm focus:outline-none" />
                    </div>
                  </>
                )}
              </div>

              <div className="mt-6 overflow-hidden rounded-3xl border border-[var(--color-nexus-border)]">
                <div className="grid grid-cols-[1.3fr_1fr_1fr_1fr] bg-[var(--color-nexus-surface-alt)] px-5 py-4 text-[11px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">
                  <span>Salary Components</span>
                  <span>Calculation Type</span>
                  <span>Monthly Amount</span>
                  <span>Annual Amount</span>
                </div>
                <div className="space-y-0 bg-white px-5 py-2">
                  <div className="grid grid-cols-[1.3fr_1fr_1fr_1fr] items-center gap-4 border-b border-[var(--color-nexus-border)] py-5">
                    <div>
                      <div className="font-bold text-[var(--color-nexus-ink)]">Basic</div>
                    </div>
                    <div className="flex overflow-hidden rounded-xl border border-[var(--color-nexus-border)]">
                      <input type="number" min="0" max="100" step="0.5" value={draft.basicPercent} onChange={(e) => updateDraft('basicPercent', e.target.value)} className="w-20 bg-white px-4 py-3 text-sm focus:outline-none" />
                      <span className="flex items-center border-l border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 text-sm text-[var(--color-nexus-ink)]">% of CTC</span>
                    </div>
                    <div className="text-sm font-semibold text-[var(--color-nexus-ink)]">{formatMoney(basicAnnual / 12)}</div>
                    <div className="text-sm font-semibold text-[var(--color-nexus-ink)]">{formatMoney(basicAnnual)}</div>
                  </div>
                  <div className="grid grid-cols-[1.3fr_1fr_1fr_1fr] items-center gap-4 border-b border-[var(--color-nexus-border)] py-5">
                    <div>
                      <div className="font-bold text-[var(--color-nexus-ink)]">HRA</div>
                    </div>
                    <div className="flex overflow-hidden rounded-xl border border-[var(--color-nexus-border)]">
                      <input type="number" min="0" max="100" step="0.5" value={draft.hraPercent} onChange={(e) => updateDraft('hraPercent', e.target.value)} className="w-20 bg-white px-4 py-3 text-sm focus:outline-none" />
                      <span className="flex items-center border-l border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 text-sm text-[var(--color-nexus-ink)]">% of CTC</span>
                    </div>
                    <div className="text-sm font-semibold text-[var(--color-nexus-ink)]">{formatMoney(hraAnnual / 12)}</div>
                    <div className="text-sm font-semibold text-[var(--color-nexus-ink)]">{formatMoney(hraAnnual)}</div>
                  </div>
                  <div className={`grid grid-cols-[1.3fr_1fr_1fr_1fr] items-center gap-4 py-5 ${draft.customEarnings.length > 0 ? 'border-b border-[var(--color-nexus-border)]' : ''}`}>
                    <div>
                      <div className="font-bold text-[var(--color-nexus-ink)]">Fixed Allowance</div>
                      <p className="mt-1 text-xs text-[var(--color-nexus-muted)]">Auto-balances the remaining CTC after basic, HRA, and any custom earnings.</p>
                    </div>
                    <div className="text-sm text-[var(--color-nexus-muted)]">Fixed amount</div>
                    <div className="text-sm font-semibold text-[var(--color-nexus-ink)]">{formatMoney(fixedAllowanceAnnual / 12)}</div>
                    <div className="text-sm font-semibold text-[var(--color-nexus-ink)]">{formatMoney(fixedAllowanceAnnual)}</div>
                  </div>
                  {draft.customEarnings.map((row, index) => (
                    <div key={row.id} className={`grid grid-cols-[1.3fr_1fr_1fr_1fr] items-center gap-4 py-5 ${index < draft.customEarnings.length - 1 ? 'border-b border-[var(--color-nexus-border)]' : ''}`}>
                      <div>
                        <input
                          type="text"
                          value={row.name}
                          onChange={(e) => updateCustomComponent('customEarnings', row.id, { name: e.target.value })}
                          placeholder="Earning name (e.g. Special Allowance)"
                          className="w-full rounded-xl border border-[var(--color-nexus-border)] bg-white px-3 py-2 text-sm font-semibold text-[var(--color-nexus-ink)] focus:outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={row.calcType}
                          onChange={(e) => updateCustomComponent('customEarnings', row.id, { calcType: e.target.value as CalculationType })}
                          className="rounded-xl border border-[var(--color-nexus-border)] bg-white px-2 py-2 text-xs text-[var(--color-nexus-ink)] focus:outline-none"
                        >
                          <option value="fixed_annual">Fixed amount</option>
                          <option value="percent_of_ctc">% of CTC</option>
                        </select>
                        <input
                          type="number"
                          min="0"
                          value={row.value}
                          onChange={(e) => updateCustomComponent('customEarnings', row.id, { value: e.target.value })}
                          className="w-20 rounded-xl border border-[var(--color-nexus-border)] bg-white px-3 py-2 text-sm focus:outline-none"
                        />
                        <button type="button" onClick={() => removeCustomComponent('customEarnings', row.id)} aria-label="Remove earning" className="text-[var(--color-nexus-error)] hover:brightness-110 text-xs font-bold">✕</button>
                      </div>
                      <div className="text-sm font-semibold text-[var(--color-nexus-ink)]">{formatMoney(customComponentAnnual(row) / 12)}</div>
                      <div className="text-sm font-semibold text-[var(--color-nexus-ink)]">{formatMoney(customComponentAnnual(row))}</div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-[1.3fr_1fr_1fr_1fr] bg-[var(--color-nexus-primary-fixed)] px-5 py-4 text-sm font-bold text-[var(--color-nexus-ink)]">
                  <span>Cost to Company</span>
                  <span />
                  <span>{formatMoney(monthlyGross)}</span>
                  <span>{formatMoney(annualCtc)}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => addCustomComponent('customEarnings')}
                className="mt-4 text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-primary)] hover:text-[var(--color-nexus-primary-hover)]"
              >
                + Add Earning
              </button>

              {salaryOverAllocated && (
                <p className="mt-4 text-sm font-medium text-[var(--color-nexus-error)]">Basic, HRA, and custom earnings cannot exceed the annual CTC. Reduce one of them to continue.</p>
              )}

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => goToStep('statutory')}
                  disabled={annualCtc <= 0 || salaryOverAllocated}
                  className="rounded-2xl bg-[var(--color-nexus-primary)] px-5 py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--color-nexus-primary-hover)] disabled:opacity-50"
                >
                  Continue to PF & Deductions
                </button>
              </div>
            </section>
          )}

          {activeStep === 'statutory' && (
            <section className="nexus-card rounded-3xl p-6">
              <div className="mb-5">
                <h3 className="font-sans text-xl font-bold text-[var(--color-nexus-ink)]">PF & Statutory Deductions</h3>
                <p className="mt-1 text-sm text-[var(--color-nexus-muted)]">This is the part that was missing before: proper places for PF percentages and tax deductions.</p>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="rounded-3xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] p-5">
                  <h4 className="text-sm font-bold text-[var(--color-nexus-ink)]">Employee Deductions</h4>
                  <div className="mt-4 space-y-4">
                    <div>
                      <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Employee PF % of CTC</label>
                      <input type="number" min="0" max="100" step="0.5" value={draft.employeePfPercent} onChange={(e) => updateDraft('employeePfPercent', e.target.value)} className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-white px-4 py-3 text-sm focus:outline-none" />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Professional Tax Annual</label>
                      <input type="number" min="0" step="1" value={draft.professionalTaxAnnual} onChange={(e) => updateDraft('professionalTaxAnnual', e.target.value)} className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-white px-4 py-3 text-sm focus:outline-none" />
                    </div>
                    {draft.customDeductions.map((row) => (
                      <div key={row.id} className="rounded-2xl border border-[var(--color-nexus-border)] bg-white p-3">
                        <input
                          type="text"
                          value={row.name}
                          onChange={(e) => updateCustomComponent('customDeductions', row.id, { name: e.target.value })}
                          placeholder="Deduction name (e.g. Loan EMI)"
                          className="mb-2 w-full rounded-xl border border-[var(--color-nexus-border)] px-3 py-2 text-sm font-semibold text-[var(--color-nexus-ink)] focus:outline-none"
                        />
                        <div className="flex items-center gap-2">
                          <select
                            value={row.calcType}
                            onChange={(e) => updateCustomComponent('customDeductions', row.id, { calcType: e.target.value as CalculationType })}
                            className="rounded-xl border border-[var(--color-nexus-border)] px-2 py-2 text-xs text-[var(--color-nexus-ink)] focus:outline-none"
                          >
                            <option value="fixed_annual">Fixed amount</option>
                            <option value="percent_of_ctc">% of CTC</option>
                          </select>
                          <input
                            type="number"
                            min="0"
                            value={row.value}
                            onChange={(e) => updateCustomComponent('customDeductions', row.id, { value: e.target.value })}
                            className="w-20 rounded-xl border border-[var(--color-nexus-border)] px-3 py-2 text-sm focus:outline-none"
                          />
                          <span className="text-xs text-[var(--color-nexus-muted)]">{formatMoney(customComponentAnnual(row) / 12)}/mo</span>
                          <button type="button" onClick={() => removeCustomComponent('customDeductions', row.id)} aria-label="Remove deduction" className="ml-auto text-[var(--color-nexus-error)] hover:brightness-110 text-xs font-bold">✕</button>
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => addCustomComponent('customDeductions')}
                      className="text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-primary)] hover:text-[var(--color-nexus-primary-hover)]"
                    >
                      + Add Deduction
                    </button>
                  </div>
                </div>

                <div className="rounded-3xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] p-5">
                  <h4 className="text-sm font-bold text-[var(--color-nexus-ink)]">Employer Contributions</h4>
                  <div className="mt-4 space-y-4">
                    <div>
                      <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Employer PF % of CTC</label>
                      <input type="number" min="0" max="100" step="0.5" value={draft.employerPfPercent} onChange={(e) => updateDraft('employerPfPercent', e.target.value)} className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-white px-4 py-3 text-sm focus:outline-none" />
                    </div>
                    <div className="rounded-2xl bg-white p-4 text-sm text-[var(--color-nexus-muted)]">
                      Employer-side contributions are previewed separately so HR can review true cost without mixing them into the employee's take-home.
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-2xl bg-[var(--color-nexus-surface-alt)] px-4 py-4">
                  <span className="block text-[10px] uppercase tracking-wider text-[var(--color-nexus-muted)]">Employee PF / month</span>
                  <span className="mt-1 block text-xl font-black text-[var(--color-nexus-ink)]">{formatMoney(employeePfAnnual / 12)}</span>
                </div>
                <div className="rounded-2xl bg-[var(--color-nexus-surface-alt)] px-4 py-4">
                  <span className="block text-[10px] uppercase tracking-wider text-[var(--color-nexus-muted)]">Employer PF / month</span>
                  <span className="mt-1 block text-xl font-black text-[var(--color-nexus-ink)]">{formatMoney(employerPfAnnual / 12)}</span>
                </div>
                <div className="rounded-2xl bg-[var(--color-nexus-surface-alt)] px-4 py-4">
                  <span className="block text-[10px] uppercase tracking-wider text-[var(--color-nexus-muted)]">Projected Monthly Net</span>
                  <span className="mt-1 block text-xl font-black text-[color:var(--color-nexus-success-text)]">{formatMoney(monthlyNet)}</span>
                </div>
              </div>

              <div className="mt-6 flex justify-between">
                <button onClick={() => goToStep('salary')} className="rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-5 py-3 text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-ink)]">
                  Back
                </button>
                <button onClick={() => goToStep('review')} className="rounded-2xl bg-[var(--color-nexus-primary)] px-5 py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--color-nexus-primary-hover)]">
                  Continue to Review
                </button>
              </div>
            </section>
          )}

          {activeStep === 'review' && (
            <section className="nexus-card rounded-3xl p-6">
              <div className="mb-5">
                <h3 className="font-sans text-xl font-bold text-[var(--color-nexus-ink)]">Review & Save</h3>
                <p className="mt-1 text-sm text-[var(--color-nexus-muted)]">Final confirmation page before writing the salary structure back to payroll.</p>
              </div>

              <div className="overflow-hidden rounded-3xl border border-[var(--color-nexus-border)]">
                <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr] bg-[var(--color-nexus-surface-alt)] px-5 py-4 text-[11px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">
                  <span>Component</span>
                  <span>Section</span>
                  <span>Monthly</span>
                  <span>Annual</span>
                </div>
                <div className="divide-y divide-[var(--color-nexus-border)] bg-white">
                  {previewRows.map((row) => (
                    <div key={row.label} className="grid grid-cols-[1.2fr_1fr_1fr_1fr] px-5 py-4 text-sm">
                      <span className="font-semibold text-[var(--color-nexus-ink)]">{row.label}</span>
                      <span className="text-[var(--color-nexus-muted)]">{row.section}</span>
                      <span className="text-[var(--color-nexus-ink)]">{formatMoney(row.monthly)}</span>
                      <span className="text-[var(--color-nexus-ink)]">{formatMoney(row.annual)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className="rounded-2xl bg-[var(--color-nexus-surface-alt)] px-4 py-4">
                  <span className="block text-[10px] uppercase tracking-wider text-[var(--color-nexus-muted)]">Annual CTC</span>
                  <span className="mt-1 block text-xl font-black text-[var(--color-nexus-ink)]">{formatMoney(annualCtc)}</span>
                </div>
                <div className="rounded-2xl bg-[var(--color-nexus-surface-alt)] px-4 py-4">
                  <span className="block text-[10px] uppercase tracking-wider text-[var(--color-nexus-muted)]">Monthly Gross</span>
                  <span className="mt-1 block text-xl font-black text-[var(--color-nexus-ink)]">{formatMoney(monthlyGross)}</span>
                </div>
                <div className="rounded-2xl bg-[var(--color-nexus-surface-alt)] px-4 py-4">
                  <span className="block text-[10px] uppercase tracking-wider text-[var(--color-nexus-muted)]">Monthly Deductions</span>
                  <span className="mt-1 block text-xl font-black text-[var(--color-nexus-error)]">{formatMoney(monthlyDeductions)}</span>
                </div>
                <div className="rounded-2xl bg-[var(--color-nexus-surface-alt)] px-4 py-4">
                  <span className="block text-[10px] uppercase tracking-wider text-[var(--color-nexus-muted)]">Monthly Net</span>
                  <span className="mt-1 block text-xl font-black text-[color:var(--color-nexus-success-text)]">{formatMoney(monthlyNet)}</span>
                </div>
              </div>

              {detail?.summary && (
                <div className="mt-6 rounded-3xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-primary-fixed)] p-5 text-sm text-[var(--color-nexus-ink)]">
                  Existing saved profile: gross {formatMoney(detail.summary.monthlyGross || 0)}, net {formatMoney(detail.summary.monthlyNet || 0)}, leave cut {formatMoney(detail.summary.leaveDeduction || 0)}.
                </div>
              )}

              <div className="mt-6 flex justify-between">
                <button onClick={() => goToStep('statutory')} className="rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-5 py-3 text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-ink)]">
                  Back
                </button>
                <button onClick={saveProfile} disabled={saving || annualCtc <= 0 || salaryOverAllocated} className="rounded-2xl bg-[var(--color-nexus-primary)] px-5 py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--color-nexus-primary-hover)] disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save Payroll Structure'}
                </button>
              </div>
            </section>
          )}

          <div className="text-center text-xs text-[var(--color-nexus-muted)]">
            Step {stepIndex + 1} of {STEP_ORDER.length}
          </div>
        </div>
      )}
    </PortalShell>
  );
}
