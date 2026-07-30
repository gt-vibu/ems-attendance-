import { useEffect, useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { User } from '../lib/auth';
import PageChrome from '../components/PageChrome';

// Admin UI for the approval-routing engine built earlier this session
// (services/approvalRouting.ts, api/routes/approvalRouting.routes.ts) — a
// tenant with no rules configured here keeps today's flat "notify everyone
// holding the privilege" behavior exactly as before; rules only narrow that
// down once added. See the roadmap plan, Phase 0c/9.
const CATEGORIES = [
  { value: 'leave', label: 'Leave Requests' },
  { value: 'attendance_correction', label: 'Attendance Corrections' },
  { value: 'wfh', label: 'Work From Home' },
  { value: 'missed_checkout', label: 'Missed Checkout' },
  { value: 'late_arrival', label: 'Late Arrivals' },
];
const SCOPE_TYPES = [
  { value: 'all', label: 'Everyone' },
  { value: 'department', label: 'Department' },
  { value: 'branch', label: 'Branch' },
  { value: 'team', label: 'Team' },
];
const APPROVER_TYPES = [
  { value: 'reporting_manager', label: "Employee's Reporting Manager" },
  { value: 'role', label: 'Anyone With This Role' },
  { value: 'specific_user', label: 'Specific Person (email)' },
];

export default function ApprovalRoutingPage({ user }: { user: User }) {
  const token = localStorage.getItem('auth_token');
  const authHeaders = { Authorization: `Bearer ${token}` };

  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessible, setAccessible] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [category, setCategory] = useState('leave');
  const [scopeType, setScopeType] = useState('all');
  const [scopeValue, setScopeValue] = useState('');
  const [approverType, setApproverType] = useState('reporting_manager');
  const [approverValue, setApproverValue] = useState('');
  const [priority, setPriority] = useState('0');
  const [saving, setSaving] = useState(false);

  const fetchRules = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/approval-routing', { headers: authHeaders });
      if (!res.ok) { setAccessible(false); return; }
      const data = await res.json();
      setAccessible(true);
      setRules(data.rules || []);
    } catch {
      setAccessible(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRules(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (scopeType !== 'all' && !scopeValue.trim()) return;
    if (approverType !== 'reporting_manager' && !approverValue.trim()) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/approval-routing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          category, scopeType,
          scopeValue: scopeType === 'all' ? undefined : scopeValue.trim(),
          approverType,
          approverValue: approverType === 'reporting_manager' ? undefined : approverValue.trim(),
          priority: Number(priority) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add rule.');
      setScopeValue('');
      setApproverValue('');
      setSuccess('Routing rule added.');
      await fetchRules();
      setTimeout(() => setSuccess(''), 2500);
    } catch (err: any) {
      setError(err.message || 'Failed to add rule.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`/api/tenant/approval-routing/${id}`, { method: 'DELETE', headers: authHeaders });
      if (res.ok) setRules((prev) => prev.filter((r) => r.id !== id));
    } catch {
      setError('Failed to delete rule.');
    }
  };

  const labelFor = (list: typeof CATEGORIES, value: string) => list.find((o) => o.value === value)?.label || value;

  return (
    <div className="min-h-screen premium-mesh-bg p-6 sm:p-8 font-sans text-[var(--color-nexus-ink)]">
      <PageChrome fallbackHref="/dashboard" />
      <div className="max-w-4xl mx-auto pt-16 sm:pt-8">
        <h1 className="text-xl font-bold mb-1">Approval Routing</h1>
        <p className="text-sm text-[var(--color-nexus-muted)] mb-6">
          Configure who gets notified for each approval category, by department, branch, or team — instead of every
          request going to everyone who holds the approval privilege tenant-wide. A category with no rules below
          keeps today's default behavior unchanged.
        </p>

        {!accessible ? (
          <div className="nexus-card rounded-2xl p-8 text-center text-sm text-[var(--color-nexus-muted)]">
            Configurable Approval Routing is not enabled for this organization, or you don't have access to it.
          </div>
        ) : (
          <>
            <div className="nexus-card rounded-2xl p-6 mb-6">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-4">Add Routing Rule</h2>
              <form onSubmit={handleAddRule} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                <div className="flex-1 min-w-[150px]">
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[var(--color-nexus-muted)]">Category</label>
                  <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-3 py-2.5 text-sm focus:outline-none">
                    {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div className="flex-1 min-w-[150px]">
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[var(--color-nexus-muted)]">Scope</label>
                  <select value={scopeType} onChange={(e) => setScopeType(e.target.value)} className="w-full rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-3 py-2.5 text-sm focus:outline-none">
                    {SCOPE_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                {scopeType !== 'all' && (
                  <div className="flex-1 min-w-[150px]">
                    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[var(--color-nexus-muted)]">
                      {scopeType === 'department' ? 'Department name' : scopeType === 'branch' ? 'Branch ID' : 'Team ID'}
                    </label>
                    <input value={scopeValue} onChange={(e) => setScopeValue(e.target.value)} className="w-full rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-3 py-2.5 text-sm focus:outline-none" required />
                  </div>
                )}
                <div className="flex-1 min-w-[170px]">
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[var(--color-nexus-muted)]">Route To</label>
                  <select value={approverType} onChange={(e) => setApproverType(e.target.value)} className="w-full rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-3 py-2.5 text-sm focus:outline-none">
                    {APPROVER_TYPES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </div>
                {approverType !== 'reporting_manager' && (
                  <div className="flex-1 min-w-[150px]">
                    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[var(--color-nexus-muted)]">
                      {approverType === 'role' ? 'Role name' : 'Email'}
                    </label>
                    <input value={approverValue} onChange={(e) => setApproverValue(e.target.value)} className="w-full rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-3 py-2.5 text-sm focus:outline-none" required />
                  </div>
                )}
                <button type="submit" disabled={saving} className="flex items-center justify-center gap-1.5 rounded-xl bg-[var(--color-nexus-primary)] px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--color-nexus-primary-hover)] disabled:opacity-50">
                  <Plus size={14} /> Add
                </button>
              </form>
              {error && <p className="mt-3 text-[11px] text-[var(--color-nexus-error)]">{error}</p>}
              {success && <p className="mt-3 text-[11px] text-[var(--color-nexus-secondary)]">{success}</p>}
            </div>

            <div className="nexus-card rounded-2xl p-6">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-4">Configured Rules</h2>
              {loading ? (
                <p className="text-sm text-[var(--color-nexus-muted)] text-center py-8">Loading…</p>
              ) : rules.length === 0 ? (
                <p className="text-sm text-[var(--color-nexus-muted)] text-center py-8">
                  No routing rules yet — every category currently notifies everyone holding the relevant approval privilege.
                </p>
              ) : (
                <div className="space-y-2">
                  {rules.map((r: any) => (
                    <div key={r.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] p-3">
                      <p className="text-xs">
                        <strong>{labelFor(CATEGORIES, r.category)}</strong>
                        {' → '}
                        {r.scopeType === 'all' ? 'Everyone' : `${labelFor(SCOPE_TYPES, r.scopeType)}: ${r.scopeValue}`}
                        {' → '}
                        {r.approverType === 'reporting_manager' ? "Reporting Manager" : `${labelFor(APPROVER_TYPES, r.approverType)}: ${r.approverValue}`}
                      </p>
                      <button onClick={() => handleDelete(r.id)} className="self-end sm:self-auto p-1.5 rounded-lg text-[var(--color-nexus-error)] hover:bg-[var(--color-nexus-error-soft)]" aria-label="Delete rule">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
