import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Users, ArrowLeft, Plus, MapPin, Wifi, QrCode, ChevronRight } from 'lucide-react';
import { User } from '../lib/auth';
import PageChrome from '../components/PageChrome';
import BranchFormModal from '../components/BranchFormModal';

export default function Branches({ user }: { user: User }) {
  const navigate = useNavigate();
  const token = localStorage.getItem('auth_token');
  const [branches, setBranches] = useState<any[]>([]);
  const [stats, setStats] = useState<Record<number, { headcount: number; presentToday: number }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  const fetchBranches = useCallback(async () => {
    try {
      // Scoped to what this caller can actually manage — a multi-branch GM
      // only ever sees their own set here, not every branch in the tenant.
      const res = await fetch('/api/tenant/my-branches', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load branches');
      const list = Array.isArray(data.branches) ? data.branches : [];
      setBranches(list);

      const entries = await Promise.all(list.map(async (b: any) => {
        try {
          const r = await fetch(`/api/tenant/analytics?branchId=${b.id}`, { headers: { Authorization: `Bearer ${token}` } });
          const d = await r.json();
          return [b.id, { headcount: d.totalStaff || 0, presentToday: d.presentToday || 0 }] as const;
        } catch {
          return [b.id, { headcount: 0, presentToday: 0 }] as const;
        }
      }));
      setStats(Object.fromEntries(entries));
    } catch (err: any) {
      setError(err.message || 'Failed to load branches');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { fetchBranches(); }, [fetchBranches]);

  return (
    <div className="min-h-screen premium-mesh-bg font-sans p-6">
      <PageChrome fallbackHref="/dashboard" />
      <div className="max-w-6xl mx-auto">
        <button onClick={() => navigate('/dashboard')} className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)] mb-6 transition-colors">
          <ArrowLeft size={14} /> Back to Dashboard
        </button>

        <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[var(--color-nexus-primary)] to-[var(--color-nexus-secondary)] flex items-center justify-center shadow-[0_8px_24px_rgba(37,99,235,0.3)]">
              <Building2 size={20} className="text-white" />
            </div>
            <div>
              <h1 className="font-sans text-2xl font-bold text-gradient inline-block">Branches</h1>
              <p className="text-sm text-[var(--color-nexus-muted)] mt-1">Outlets, headcount, and attendance at a glance.</p>
            </div>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-[var(--color-nexus-primary)] text-white hover:bg-[var(--color-nexus-primary-hover)] transition-colors shadow-[0_8px_24px_rgba(37,99,235,0.3)]"
          >
            <Plus size={14} /> Add Branch
          </button>
        </div>

        {error && <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-3 rounded-lg mb-6 border border-[var(--color-nexus-error)]/20 font-medium">{error}</div>}

        {loading ? (
          <div className="text-xs text-[var(--color-nexus-muted)] font-semibold">Loading…</div>
        ) : branches.length === 0 ? (
          <div className="nexus-card rounded-3xl p-12 text-center">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-[var(--color-nexus-primary-fixed)] flex items-center justify-center mb-4">
              <Building2 size={28} className="text-[var(--color-nexus-primary)]" />
            </div>
            <h3 className="font-sans font-bold text-lg text-[var(--color-nexus-ink)] mb-1">No branches yet</h3>
            <p className="text-sm text-[var(--color-nexus-muted)] mb-5 max-w-sm mx-auto">Add your first branch — name, location, and policies — before you can onboard employees.</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-wider bg-[var(--color-nexus-primary)] text-white hover:bg-[var(--color-nexus-primary-hover)] transition-colors shadow-[0_8px_24px_rgba(37,99,235,0.3)]"
            >
              <Plus size={14} /> Add Branch
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {branches.map((b: any) => {
              const s = stats[b.id] || { headcount: 0, presentToday: 0 };
              const presentRatio = s.headcount > 0 ? Math.round((s.presentToday / s.headcount) * 100) : 0;
              return (
                <button
                  key={b.id}
                  onClick={() => navigate(`/tenant/branches/${b.id}`)}
                  className="text-left nexus-card  rounded-2xl p-5 group relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-28 h-28 bg-gradient-to-br from-[var(--color-nexus-primary)]/10 to-transparent rounded-full -mr-10 -mt-10 pointer-events-none" />

                  <div className="flex items-start justify-between mb-4 relative">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[var(--color-nexus-primary)] to-[var(--color-nexus-secondary)] flex items-center justify-center shadow-[0_6px_16px_rgba(37,99,235,0.28)]">
                      <Building2 size={19} className="text-white" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      {b.isMainBranch && (
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] uppercase tracking-wider">Main</span>
                      )}
                      <ChevronRight size={16} className="text-[var(--color-nexus-muted)] group-hover:text-[var(--color-nexus-primary)] group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </div>

                  <h3 className="font-sans font-bold text-base text-[var(--color-nexus-ink)] mb-1">{b.name}</h3>
                  {b.address ? (
                    <p className="text-[11px] text-[var(--color-nexus-muted)] mb-3 line-clamp-1 flex items-center gap-1">
                      <MapPin size={11} className="shrink-0" /> {b.address}
                    </p>
                  ) : (
                    <p className="text-[11px] text-[var(--color-nexus-error)] mb-3">No location set yet</p>
                  )}

                  {/* Headcount / present-today ring */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="relative w-11 h-11 shrink-0">
                      <svg viewBox="0 0 36 36" className="w-11 h-11 -rotate-90">
                        <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--color-nexus-border)" strokeWidth="3" />
                        <circle
                          cx="18" cy="18" r="15.5" fill="none" stroke="var(--color-nexus-primary)" strokeWidth="3"
                          strokeDasharray={`${presentRatio * 0.974} 200`} strokeLinecap="round"
                        />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-[var(--color-nexus-ink)]">{presentRatio}%</span>
                    </div>
                    <div className="text-xs text-[var(--color-nexus-muted)]">
                      <div className="flex items-center gap-1 font-semibold text-[var(--color-nexus-ink)]"><Users size={12} /> {s.headcount} staff</div>
                      <div>{s.presentToday} present today</div>
                    </div>
                  </div>

                  {/* Policy badges */}
                  <div className="flex flex-wrap gap-1.5 pt-3 border-t border-[var(--color-nexus-border)]">
                    <span className="text-[9px] font-bold px-2 py-1 rounded-full bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)] flex items-center gap-1">
                      <MapPin size={10} /> {b.locationRadiusMeters ?? 100}m radius
                    </span>
                    {b.wifiCheckEnabled && (
                      <span className="text-[9px] font-bold px-2 py-1 rounded-full bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-secondary)] flex items-center gap-1">
                        <Wifi size={10} /> Wi-Fi lock
                      </span>
                    )}
                    {b.qrEnabled && (
                      <span className="text-[9px] font-bold px-2 py-1 rounded-full bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] flex items-center gap-1">
                        <QrCode size={10} /> QR enabled
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {showAddModal && (
        <BranchFormModal
          mode="create"
          onClose={() => setShowAddModal(false)}
          onSaved={() => { setShowAddModal(false); fetchBranches(); }}
        />
      )}
    </div>
  );
}
