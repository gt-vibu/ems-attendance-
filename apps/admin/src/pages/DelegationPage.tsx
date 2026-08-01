import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, UserCog, Plus, X, Check } from 'lucide-react';
import { User } from '../lib/auth';
import PageChrome from '../components/PageChrome';
import { fetchFeatureCatalog, type FeatureCatalogCategory } from '../lib/featureCatalog';

interface Delegation {
  id: number;
  delegatedByUserId: number;
  delegatedToUserId: number;
  delegatedByName: string;
  delegatedToName: string;
  privilegeKeys: string[];
  startDate: string;
  endDate: string;
  reason: string | null;
  effectiveStatus: 'active' | 'expired' | 'revoked';
}

interface EmployeeOption {
  id: number;
  name: string;
}

// Fine-grained, time-bounded privilege handoff — not identity impersonation.
// You can only delegate privileges you yourself hold (server-enforced), for
// a bounded date range, auto-expiring with no manual cleanup. Tenant admins
// always bypass every delegation (existing hasPrivilege() behavior), which
// is the "emergency override" guarantee.
export default function DelegationPage({ user }: { user: User }) {
  const navigate = useNavigate();
  const token = localStorage.getItem('auth_token');

  const [catalog, setCatalog] = useState<FeatureCatalogCategory[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [delegatedToUserId, setDelegatedToUserId] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchAll = async () => {
    try {
      const [catalogData, empRes, delRes] = await Promise.all([
        fetchFeatureCatalog(),
        fetch('/api/tenant/employees', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).catch(() => ({ employees: [] })),
        fetch('/api/tenant/delegations', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      ]);
      setCatalog(catalogData);
      const empList = Array.isArray(empRes.employees) ? empRes.employees : Array.isArray(empRes) ? empRes : [];
      setEmployees(empList.filter((e: any) => e.id !== user.id).map((e: any) => ({ id: e.id, name: e.name })));
      setDelegations(Array.isArray(delRes.delegations) ? delRes.delegations : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load delegations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleKey = (key: string) => {
    setSelectedKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!delegatedToUserId || selectedKeys.length === 0 || !startDate || !endDate) {
      setError('Pick a delegate, at least one privilege, and a date range.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/tenant/delegations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ delegatedToUserId: Number(delegatedToUserId), privilegeKeys: selectedKeys, startDate, endDate, reason: reason.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create delegation');
      setSuccess('Delegation created.');
      setShowForm(false);
      setDelegatedToUserId(''); setSelectedKeys([]); setEndDate(''); setReason('');
      await fetchAll();
      setTimeout(() => setSuccess(''), 2500);
    } catch (err: any) {
      setError(err.message || 'Failed to create delegation');
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async (id: number) => {
    setError(''); setSuccess('');
    try {
      const res = await fetch(`/api/tenant/delegations/${id}/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to revoke');
      setSuccess('Delegation revoked.');
      await fetchAll();
      setTimeout(() => setSuccess(''), 2500);
    } catch (err: any) {
      setError(err.message || 'Failed to revoke delegation');
    }
  };

  const STATUS_TONE: Record<string, string> = {
    active: 'bg-emerald-100 text-emerald-700',
    expired: 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)]',
    revoked: 'bg-rose-100 text-rose-700',
  };

  const given = delegations.filter(d => d.delegatedByUserId === user.id);
  const received = delegations.filter(d => d.delegatedToUserId === user.id);

  return (
    <div className="min-h-screen premium-mesh-bg font-sans p-6">
      <PageChrome fallbackHref="/dashboard" />
      <div className="max-w-4xl mx-auto">
        <button onClick={() => navigate('/dashboard')} className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)] mb-6 transition-colors">
          <ArrowLeft size={14} /> Back to Dashboard
        </button>

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[var(--color-nexus-primary)] to-[var(--color-nexus-secondary)] flex items-center justify-center shadow-[0_8px_24px_rgba(37,99,235,0.3)]">
              <UserCog size={20} className="text-white" />
            </div>
            <div>
              <h1 className="font-sans text-2xl font-bold text-gradient inline-block">Delegation</h1>
              <p className="text-sm text-[var(--color-nexus-muted)] mt-1">Hand off specific approvals for a set window — e.g. while you're on leave.</p>
            </div>
          </div>
          <button
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[var(--color-nexus-primary)] text-white text-xs font-bold uppercase tracking-wider hover:opacity-90"
          >
            <Plus size={14} /> Delegate Access
          </button>
        </div>

        {error && <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-3 rounded-lg mb-4 border border-[var(--color-nexus-error)]/20 font-medium">{error}</div>}
        {success && <div className="bg-emerald-50 text-emerald-700 text-xs p-3 rounded-lg mb-4 border border-emerald-200 font-medium flex items-center gap-1.5"><Check size={13} /> {success}</div>}

        {showForm && (
          <form onSubmit={handleCreate} className="nexus-card rounded-2xl p-5 mb-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-1.5">Delegate to</label>
                <select value={delegatedToUserId} onChange={e => setDelegatedToUserId(e.target.value)} className="w-full px-3 py-2 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg text-xs">
                  <option value="">Select a person…</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-1.5">Reason (optional)</label>
                <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. On leave, covering approvals" className="w-full px-3 py-2 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg text-xs" />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-1.5">Start date</label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full px-3 py-2 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg text-xs" />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-1.5">End date (auto-expires)</label>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} min={startDate} className="w-full px-3 py-2 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg text-xs" />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-2">Privileges to delegate (only what you hold yourself)</label>
              <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                {catalog.map(cat => (
                  <div key={cat.category}>
                    <div className="text-xs font-bold text-[var(--color-nexus-ink)] mb-1">{cat.icon} {cat.category}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {cat.features.map(f => (
                        <button
                          type="button"
                          key={f.key}
                          onClick={() => toggleKey(f.key)}
                          title={f.description}
                          className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                            selectedKeys.includes(f.key)
                              ? 'bg-[var(--color-nexus-primary)] text-white border-[var(--color-nexus-primary)]'
                              : 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)] border-[var(--color-nexus-border)]'
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowForm(false)} className="text-xs font-bold uppercase tracking-wider px-4 py-2.5 rounded-xl text-[var(--color-nexus-muted)]">Cancel</button>
              <button type="submit" disabled={saving} className="text-xs font-bold uppercase tracking-wider px-4 py-2.5 rounded-xl bg-[var(--color-nexus-primary)] text-white disabled:opacity-50">
                {saving ? 'Creating…' : 'Create Delegation'}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="text-xs text-[var(--color-nexus-muted)] font-semibold">Loading…</div>
        ) : (
          <div className="space-y-6">
            <section>
              <h2 className="text-sm font-bold text-[var(--color-nexus-ink)] mb-3">Delegated by you</h2>
              {given.length === 0 ? (
                <div className="nexus-card rounded-2xl p-6 text-center text-xs text-[var(--color-nexus-muted)]">You haven't delegated anything.</div>
              ) : (
                <div className="space-y-2">
                  {given.map(d => (
                    <div key={d.id} className="nexus-card rounded-2xl p-4 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-bold text-[var(--color-nexus-ink)] flex items-center gap-2">
                          To {d.delegatedToName}
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_TONE[d.effectiveStatus]}`}>{d.effectiveStatus}</span>
                        </div>
                        <div className="text-[11px] text-[var(--color-nexus-muted)] mt-1">{d.startDate} to {d.endDate} · {d.privilegeKeys.length} privilege(s){d.reason ? ` · ${d.reason}` : ''}</div>
                      </div>
                      {d.effectiveStatus === 'active' && (
                        <button onClick={() => handleRevoke(d.id)} className="text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg text-[var(--color-nexus-error)] hover:bg-[var(--color-nexus-error-soft)]">Revoke</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="text-sm font-bold text-[var(--color-nexus-ink)] mb-3">Delegated to you</h2>
              {received.length === 0 ? (
                <div className="nexus-card rounded-2xl p-6 text-center text-xs text-[var(--color-nexus-muted)]">Nothing has been delegated to you.</div>
              ) : (
                <div className="space-y-2">
                  {received.map(d => (
                    <div key={d.id} className="nexus-card rounded-2xl p-4 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-bold text-[var(--color-nexus-ink)] flex items-center gap-2">
                          From {d.delegatedByName}
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_TONE[d.effectiveStatus]}`}>{d.effectiveStatus}</span>
                        </div>
                        <div className="text-[11px] text-[var(--color-nexus-muted)] mt-1">{d.startDate} to {d.endDate} · {d.privilegeKeys.length} privilege(s){d.reason ? ` · ${d.reason}` : ''}</div>
                      </div>
                      {d.effectiveStatus === 'active' && (
                        <button onClick={() => handleRevoke(d.id)} className="text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg text-[var(--color-nexus-muted)] hover:bg-[var(--color-nexus-surface-alt)]">
                          <X size={12} className="inline mr-1" /> Decline
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
