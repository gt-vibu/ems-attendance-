import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Layers, Check } from 'lucide-react';
import { User } from '../lib/auth';
import PageChrome from '../components/PageChrome';

// Same grouping this used to render inline in Dashboard.tsx's "Edit
// Features" modal — moved here verbatim so a tenant with 20+ platform
// features doesn't have to be reviewed in a cramped 400px-wide dialog.
const PLATFORM_FEATURE_CATEGORIES: Record<string, string> = {
  face_recognition: 'Attendance',
  wifi_lock: 'Attendance',
  gps_geofence: 'Attendance',
  qr_attendance: 'Attendance',
  attendance_freeze: 'Attendance',
  missed_checkout_verification: 'Attendance',
  wfh: 'Attendance',
  payroll_attendance_driven: 'Payroll',
  payroll_batches: 'Payroll',
  payroll_lock_adjustments: 'Payroll',
  service_accounts: 'Integrations',
  webhooks: 'Integrations',
  custom_rbac: 'Organization',
  notification_routing: 'Organization',
  unified_notifications: 'Organization',
  device_identity: 'Employee Experience',
  device_change: 'Employee Experience',
  documents: 'Employee Experience',
};
const CATEGORY_ORDER = ['Attendance', 'Payroll', 'Integrations', 'Organization', 'Employee Experience', 'Other'];

function groupFeatures(features: { key: string; label: string; description: string }[]) {
  const groups = new Map<string, typeof features>();
  for (const f of features) {
    const cat = PLATFORM_FEATURE_CATEGORIES[f.key] || 'Other';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(f);
  }
  return CATEGORY_ORDER.filter((cat) => groups.has(cat)).map((cat) => ({ category: cat, features: groups.get(cat)! }));
}

function unmetDependencies(selected: string[], dependencies: Record<string, string[]>, features: { key: string; label: string }[]): string[] {
  const labelOf = (key: string) => features.find((f) => f.key === key)?.label || key;
  const warnings: string[] = [];
  for (const key of selected) {
    const deps = dependencies[key];
    if (!deps) continue;
    const missing = deps.filter((d) => !selected.includes(d));
    if (missing.length > 0) warnings.push(`${labelOf(key)} usually needs ${missing.map(labelOf).join(', ')} enabled too.`);
  }
  return warnings;
}

// Full-page replacement for the old "Plan Features" modal (Dashboard.tsx) —
// same data, same save endpoint, just given room to breathe instead of
// being crammed into a max-w-md dialog. Reachable only from the Manage
// Tenants table (super_admin only, enforced both by the route guard in
// AdminApp.tsx and by every API call here requiring a super_admin token).
export default function PlanFeaturesPage({ user }: { user: User }) {
  const navigate = useNavigate();
  const { tenantId } = useParams<{ tenantId: string }>();
  const token = localStorage.getItem('auth_token');

  const [tenant, setTenant] = useState<any>(null);
  const [features, setFeatures] = useState<{ key: string; label: string; description: string }[]>([]);
  const [dependencies, setDependencies] = useState<Record<string, string[]>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const [tenantsRes, featuresRes] = await Promise.all([
          fetch('/api/super/tenants', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/super/platform-features', { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        const tenantsData = await tenantsRes.json();
        const featuresData = await featuresRes.json();
        const found = (tenantsData.tenants || []).find((t: any) => String(t.id) === String(tenantId));
        if (!found) throw new Error('Tenant not found.');
        setTenant(found);
        setSelected(Array.isArray(found.featuresAllowed) ? found.featuresAllowed : []);
        setFeatures(Array.isArray(featuresData.features) ? featuresData.features : []);
        setDependencies(featuresData.dependencies && typeof featuresData.dependencies === 'object' ? featuresData.dependencies : {});
      } catch (err: any) {
        setError(err.message || 'Failed to load plan features.');
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const toggle = (key: string) => {
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const handleSave = async () => {
    if (!tenant) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/super/tenants/features', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenantId: tenant.id, featuresAllowed: selected }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update plan features.');
      setSuccess('Plan features saved.');
      setTimeout(() => setSuccess(''), 2500);
    } catch (err: any) {
      setError(err.message || 'Failed to update plan features.');
    } finally {
      setSaving(false);
    }
  };

  const warnings = unmetDependencies(selected, dependencies, features);
  const groups = groupFeatures(features);

  return (
    <div className="min-h-screen premium-mesh-bg font-sans p-6">
      <PageChrome fallbackHref="/dashboard" />
      <div className="max-w-3xl mx-auto">
        <button onClick={() => navigate('/dashboard')} className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)] mb-6 transition-colors">
          <ArrowLeft size={14} /> Back to Dashboard
        </button>

        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--color-nexus-primary-fixed)] flex items-center justify-center shrink-0">
              <Layers size={16} className="text-[var(--color-nexus-primary)]" />
            </div>
            <div>
              <h1 className="font-sans text-[18px] font-bold text-[var(--color-nexus-ink)]">Plan Features{tenant ? ` — ${tenant.name}` : ''}</h1>
              <p className="text-[13px] text-[var(--color-nexus-muted)]">Only modules checked here can ever be turned on or delegated by this tenant's admin. Unchecking a module already in use disables it immediately.</p>
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || loading || !tenant}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-nexus-primary)] px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--color-nexus-primary-hover)] disabled:opacity-50"
          >
            <Check size={14} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        {error && <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-3 rounded-lg mb-4 border border-[var(--color-nexus-error)]/20 font-medium">{error}</div>}
        {success && <div className="bg-emerald-50 text-emerald-700 text-xs p-3 rounded-lg mb-4 border border-emerald-200 font-medium flex items-center gap-1.5"><Check size={13} /> {success}</div>}

        {loading ? (
          <div className="text-xs text-[var(--color-nexus-muted)] font-semibold">Loading…</div>
        ) : (
          <>
            {warnings.length > 0 && (
              <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-[12px] text-amber-800 space-y-1">
                {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
              </div>
            )}

            <div className="space-y-5">
              {groups.map((group) => (
                <div key={group.category} className="nexus-card p-5">
                  <span className="block text-[11px] font-bold text-[var(--color-nexus-muted)] uppercase tracking-widest mb-3">{group.category}</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {group.features.map((f) => (
                      <label
                        key={f.key}
                        className="flex items-start gap-3 p-3 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg cursor-pointer hover:bg-[var(--color-nexus-primary-fixed)]/50 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selected.includes(f.key)}
                          onChange={() => toggle(f.key)}
                          className="mt-0.5 w-4 h-4 accent-[var(--color-nexus-primary)]"
                        />
                        <div className="min-w-0">
                          <span className="block text-[13px] font-bold text-[var(--color-nexus-ink)]">{f.label}</span>
                          <span className="text-[11.5px] text-[var(--color-nexus-muted)]">{f.description}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
