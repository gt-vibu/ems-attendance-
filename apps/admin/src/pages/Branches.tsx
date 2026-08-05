import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Users, ArrowLeft, Plus, MapPin, Wifi, QrCode, ChevronRight, UserCheck, Shield } from 'lucide-react';
import { User } from '../lib/auth';
import BranchFormModal from '../components/BranchFormModal';
import AdminWorkspaceLayout from '../components/AdminWorkspaceLayout';
import ManagementTemplate from '../components/templates/ManagementTemplate';

export default function Branches({ user, onLogout }: { user: User; onLogout?: () => void }) {
  const navigate = useNavigate();
  const token = localStorage.getItem('auth_token');
  const [branches, setBranches] = useState<any[]>([]);
  const [stats, setStats] = useState<Record<number, { headcount: number; presentToday: number }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [search, setSearch] = useState('');

  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch('/api/tenant/my-branches', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load branches');
      const list = Array.isArray(data.branches) ? data.branches : [];
      setBranches(list);

      const entries = await Promise.all(list.map(async (b: any) => {
        try {
          const r = await fetch(`/api/tenant/analytics?branchId=${b.id}`, { headers: { Authorization: `Bearer ${token}` } });
          const d = await r.json();
          return [b.id, { headcount: Number(d.totalStaff || 0), presentToday: Number(d.presentToday || 0) }];
        } catch {
          return [b.id, { headcount: 0, presentToday: 0 }];
        }
      }));
      setStats(Object.fromEntries(entries));
    } catch (err: any) {
      setError(err.message || 'Failed to load branches');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchBranches(); }, [fetchBranches]);

  const totalHeadcount = Object.values(stats).reduce((acc: number, curr: any) => acc + (curr?.headcount || 0), 0);
  const totalPresentToday = Object.values(stats).reduce((acc: number, curr: any) => acc + (curr?.presentToday || 0), 0);

  const metrics = [
    {
      label: 'Registered Branches',
      value: branches.length,
      subtext: 'Operational office locations',
      icon: Building2,
    },
    {
      label: 'Total Branch Headcount',
      value: totalHeadcount,
      subtext: 'Assigned workforce across branches',
      icon: Users,
    },
    {
      label: 'Present Across Branches',
      value: totalPresentToday as number,
      change: 'Active Today',
      changeType: 'positive' as const,
      icon: UserCheck,
    },
    {
      label: 'Geofence Security',
      value: `${branches.filter(b => b.locationRadiusMeters).length} / ${branches.length}`,
      subtext: 'Branches with geofence radius set',
      icon: Shield,
    },
  ];

  const filteredBranches = branches.filter(b => 
    b.name.toLowerCase().includes(search.toLowerCase()) ||
    (b.address || '').toLowerCase().includes(search.toLowerCase())
  );

  const primaryActions = (
    <button
      type="button"
      onClick={() => setShowAddModal(true)}
      className="px-3.5 py-1.5 bg-[var(--color-nexus-primary)] text-white text-xs font-bold rounded-[var(--radius-nexus-control)] hover:bg-[var(--color-nexus-primary-hover)] flex items-center gap-1.5 transition-colors shadow-xs"
    >
      <Plus size={14} /> Add New Branch
    </button>
  );

  const mainContent = (
    <ManagementTemplate
      title="Branch Infrastructure Workspace"
      subtitle="Operational hub for physical office locations, geofences, and site attendance statistics."
      badge="Branches"
      metrics={metrics}
      searchQuery={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search branch name or address..."
      primaryActions={primaryActions}
    >
      <div className="p-4 md:p-5">
        {error && <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-3 rounded-lg mb-4 border border-[var(--color-nexus-error)]/20 font-medium">{error}</div>}

        {loading ? (
          <div className="text-xs text-[var(--color-nexus-muted)] font-mono py-8 text-center">Loading branch workspaces...</div>
        ) : filteredBranches.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <div className="w-12 h-12 mx-auto rounded-xl bg-[var(--color-nexus-surface-alt)] flex items-center justify-center text-[var(--color-nexus-primary)]">
              <Building2 size={24} />
            </div>
            <h3 className="text-sm font-bold text-[var(--color-nexus-ink)]">No branches found</h3>
            <p className="text-xs text-[var(--color-nexus-muted)] max-w-sm mx-auto">Create a new branch location to assign staff and enforce attendance policies.</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-[var(--color-nexus-primary)] text-white"
            >
              <Plus size={14} /> Add Branch
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredBranches.map((b: any) => {
              const s = stats[b.id] || { headcount: 0, presentToday: 0 };
              const presentRatio = s.headcount > 0 ? Math.round((s.presentToday / s.headcount) * 100) : 0;
              return (
                <button
                  key={b.id}
                  onClick={() => navigate(`/tenant/branches/${b.id}`)}
                  className="text-left bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] hover:border-[var(--color-nexus-primary)] rounded-[var(--radius-nexus-card)] p-4 group transition-all shadow-xs cursor-pointer flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 rounded-lg bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] group-hover:bg-[var(--color-nexus-primary)] group-hover:text-white transition-colors flex items-center justify-center">
                        <Building2 size={18} />
                      </div>
                      <div className="flex items-center gap-1.5">
                        {b.isMainBranch && (
                          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] uppercase tracking-wider">Main</span>
                        )}
                        <ChevronRight size={16} className="text-[var(--color-nexus-muted)] group-hover:text-[var(--color-nexus-primary)] group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </div>

                    <h3 className="font-bold text-sm text-[var(--color-nexus-ink)] mb-1">{b.name}</h3>
                    {b.address ? (
                      <p className="text-[11px] text-[var(--color-nexus-muted)] mb-3 line-clamp-1 flex items-center gap-1">
                        <MapPin size={11} className="shrink-0" /> {b.address}
                      </p>
                    ) : (
                      <p className="text-[11px] text-amber-600 mb-3 font-medium">Location unset</p>
                    )}

                    <div className="flex items-center gap-3 mb-3 p-2 rounded-lg bg-[var(--color-nexus-surface-alt)]">
                      <div className="relative w-9 h-9 shrink-0">
                        <svg viewBox="0 0 36 36" className="w-9 h-9 -rotate-90">
                          <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--color-nexus-border)" strokeWidth="3" />
                          <circle
                            cx="18" cy="18" r="15.5" fill="none" stroke="var(--color-nexus-primary)" strokeWidth="3"
                            strokeDasharray={`${presentRatio * 0.974} 200`} strokeLinecap="round"
                          />
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-[var(--color-nexus-ink)]">{presentRatio}%</span>
                      </div>
                      <div className="text-xs text-[var(--color-nexus-muted)] min-w-0">
                        <div className="flex items-center gap-1 font-bold text-[var(--color-nexus-ink)]"><Users size={12} /> {s.headcount} staff</div>
                        <div className="text-[10.5px] truncate">{s.presentToday} present today</div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 pt-2 border-t border-[var(--color-nexus-border)]/60">
                    <span className="text-[9.5px] font-semibold px-2 py-0.5 rounded bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)] flex items-center gap-1">
                      <MapPin size={10} /> {b.locationRadiusMeters ?? 100}m radius
                    </span>
                    {b.wifiCheckEnabled && (
                      <span className="text-[9.5px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 flex items-center gap-1">
                        <Wifi size={10} /> Wi-Fi Lock
                      </span>
                    )}
                    {b.qrEnabled && (
                      <span className="text-[9.5px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 flex items-center gap-1">
                        <QrCode size={10} /> Dynamic QR
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </ManagementTemplate>
  );

  return (
    <AdminWorkspaceLayout user={user} onLogout={onLogout}>
      {mainContent}

      {showAddModal && (
        <BranchFormModal
          mode="create"
          onClose={() => setShowAddModal(false)}
          onSaved={() => { setShowAddModal(false); fetchBranches(); }}
        />
      )}
    </AdminWorkspaceLayout>
  );
}
