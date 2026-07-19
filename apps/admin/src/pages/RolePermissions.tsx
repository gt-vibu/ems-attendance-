import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, Plus, Check } from 'lucide-react';
import { User } from '../lib/auth';
import PageChrome from '../components/PageChrome';
import FeatureCatalogGrid from '../components/FeatureCatalogGrid';
import { fetchFeatureCatalog, type FeatureCatalogCategory } from '../lib/featureCatalog';

interface RoleRow {
  id: number;
  roleName: string;
  privileges: string[];
}

export default function RolePermissions({ user }: { user: User }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = localStorage.getItem('auth_token');

  const [catalog, setCatalog] = useState<FeatureCatalogCategory[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [myPrivileges, setMyPrivileges] = useState<string[] | 'ALL'>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [draftPrivileges, setDraftPrivileges] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');

  const [showNewRole, setShowNewRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchAll = async () => {
    try {
      const [catalogData, rolesRes, privRes] = await Promise.all([
        fetchFeatureCatalog(),
        fetch('/api/tenant/roles', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        fetch('/api/tenant/my-privileges', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      ]);
      setCatalog(catalogData);
      const roleList: RoleRow[] = Array.isArray(rolesRes.roles)
        ? rolesRes.roles.map((r: any) => ({ id: r.id, roleName: r.roleName, privileges: Array.isArray(r.privileges) ? r.privileges : [] }))
        : [];
      setRoles(roleList);
      setMyPrivileges(privRes.privileges ?? []);
      if (roleList.length > 0) {
        // Deep-link support: a "set up this new role" prompt (e.g. right
        // after hiring the first person into a brand-new role) links here
        // with ?role=<name> so the admin lands directly on that role
        // instead of whichever one happens to be first in the list.
        const requestedRoleName = searchParams.get('role');
        const requestedRole = requestedRoleName ? roleList.find(r => r.roleName === requestedRoleName) : null;
        setSelectedRoleId(prev => {
          if (requestedRole) return requestedRole.id;
          return (prev && roleList.some(r => r.id === prev)) ? prev : roleList[0].id;
        });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const role = roles.find(r => r.id === selectedRoleId);
    setDraftPrivileges(role ? role.privileges : []);
  }, [selectedRoleId, roles]);

  const selectedRole = roles.find(r => r.id === selectedRoleId) || null;

  const saveRole = async (privileges: string[]) => {
    if (!selectedRoleId) return;
    setSaveState('saving');
    try {
      const res = await fetch(`/api/tenant/roles/${selectedRoleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ privileges }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setRoles(prev => prev.map(r => r.id === selectedRoleId ? { ...r, privileges: data.role.privileges } : r));
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to save role');
      setSaveState('idle');
    }
  };

  const handleToggleChange = (next: string[]) => {
    setDraftPrivileges(next);
    saveRole(next);
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName.trim()) return;
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roleName: newRoleName.trim(), privileges: [] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create role');
      setRoles(prev => [...prev, { id: data.role.id, roleName: data.role.roleName, privileges: data.role.privileges }]);
      setSelectedRoleId(data.role.id);
      setNewRoleName('');
      setShowNewRole(false);
    } catch (err: any) {
      setError(err.message || 'Failed to create role');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen premium-mesh-bg font-sans p-6">
      <PageChrome fallbackHref="/dashboard" />
      <div className="max-w-6xl mx-auto">
        <button onClick={() => navigate('/dashboard')} className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)] mb-6 transition-colors">
          <ArrowLeft size={14} /> Back to Dashboard
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[var(--color-nexus-primary)] to-[var(--color-nexus-secondary)] flex items-center justify-center shadow-[0_8px_24px_rgba(37,99,235,0.3)]">
            <ShieldCheck size={20} className="text-white" />
          </div>
          <div>
            <h1 className="font-sans text-2xl font-bold text-gradient inline-block">Roles &amp; Permissions</h1>
            <p className="text-sm text-[var(--color-nexus-muted)] mt-1">Pick a role, toggle what it gets — changes apply instantly to everyone already in that role.</p>
          </div>
        </div>

        {error && <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-3 rounded-lg mb-6 border border-[var(--color-nexus-error)]/20 font-medium">{error}</div>}

        {loading ? (
          <div className="text-xs text-[var(--color-nexus-muted)] font-semibold">Loading…</div>
        ) : myPrivileges !== 'ALL' && !myPrivileges.includes('roles.manage') ? (
          <div className="nexus-card rounded-2xl p-10 text-center text-sm text-[var(--color-nexus-muted)]">
            You don't have access to manage roles &amp; permissions. Ask your tenant admin to grant it.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
            {/* Role list */}
            <div className="nexus-card rounded-2xl p-3 h-fit">
              <div className="space-y-1">
                {roles.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRoleId(r.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors flex items-center justify-between ${
                      selectedRoleId === r.id
                        ? 'bg-[var(--color-nexus-primary)] text-white shadow-[0_6px_16px_rgba(37,99,235,0.3)]'
                        : 'text-[var(--color-nexus-ink)] hover:bg-[var(--color-nexus-primary-fixed)]'
                    }`}
                  >
                    <span className="truncate">{r.roleName}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${selectedRoleId === r.id ? 'bg-white/25 text-white' : 'bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)]'}`}>
                      {r.privileges.length}
                    </span>
                  </button>
                ))}
              </div>

              <div className="mt-3 pt-3 border-t border-[var(--color-nexus-border)]">
                {showNewRole ? (
                  <form onSubmit={handleCreateRole} className="space-y-2">
                    <input
                      autoFocus
                      value={newRoleName}
                      onChange={e => setNewRoleName(e.target.value)}
                      placeholder="Role name…"
                      className="w-full px-3 py-2 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary)]/20"
                    />
                    <div className="flex gap-2">
                      <button type="submit" disabled={creating} className="flex-1 text-[11px] font-bold uppercase tracking-wider py-2 rounded-lg bg-[var(--color-nexus-primary)] text-white disabled:opacity-50">
                        {creating ? 'Adding…' : 'Add'}
                      </button>
                      <button type="button" onClick={() => { setShowNewRole(false); setNewRoleName(''); }} className="text-[11px] font-bold uppercase tracking-wider py-2 px-3 rounded-lg text-[var(--color-nexus-muted)]">
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    onClick={() => setShowNewRole(true)}
                    className="w-full flex items-center justify-center gap-1.5 text-xs font-bold uppercase tracking-wider py-2.5 rounded-xl text-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-fixed)] transition-colors"
                  >
                    <Plus size={14} /> New Role
                  </button>
                )}
              </div>
            </div>

            {/* Feature grid for selected role */}
            <div>
              {selectedRole ? (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-sans text-lg font-bold text-[var(--color-nexus-ink)]">{selectedRole.roleName}</h2>
                    <div className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5">
                      {saveState === 'saving' && <span className="text-[var(--color-nexus-muted)]">Saving…</span>}
                      {saveState === 'saved' && <span className="text-[var(--color-nexus-secondary)] flex items-center gap-1"><Check size={13} /> Saved</span>}
                    </div>
                  </div>
                  <FeatureCatalogGrid
                    catalog={catalog}
                    selected={draftPrivileges}
                    onChange={handleToggleChange}
                    allowedKeys={myPrivileges}
                  />
                </>
              ) : (
                <div className="nexus-card rounded-2xl p-10 text-center text-sm text-[var(--color-nexus-muted)]">
                  No roles yet — add one to get started.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
