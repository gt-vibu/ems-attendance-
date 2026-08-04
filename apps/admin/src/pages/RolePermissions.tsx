import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ShieldCheck, Plus, Check, Eye, X,
  Users, Clock, Coffee, ScrollText, Smartphone, Building2, QrCode, Home, AlertTriangle,
  CalendarDays, Banknote, Users2, Megaphone, Ticket,
  type LucideIcon,
} from 'lucide-react';

// Same name -> component map FeatureCatalogGrid.tsx uses — catalog.icon is
// a Lucide icon NAME string (see featureCatalog.ts), never a literal
// glyph to print as text.
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Users, Clock, Coffee, ScrollText, Smartphone, Building2, QrCode, Home, AlertTriangle, CalendarDays, Banknote, Users2, Megaphone, ShieldCheck, Ticket,
};
import { User } from '../lib/auth';
import AdminWorkspaceLayout from '../components/AdminWorkspaceLayout';
import FeatureCatalogGrid from '../components/FeatureCatalogGrid';
import { fetchFeatureCatalog, fetchFeatureDependencies, type FeatureCatalogCategory, type FeatureDependencies } from '../lib/featureCatalog';

interface RoleRow {
  id: number;
  roleName: string;
  privileges: string[];
}

export default function RolePermissions({ user, onLogout, embedded = false }: { user: User; onLogout?: () => void; embedded?: boolean }) {
  const [searchParams] = useSearchParams();
  const token = localStorage.getItem('auth_token');

  const [catalog, setCatalog] = useState<FeatureCatalogCategory[]>([]);
  const [dependencies, setDependencies] = useState<FeatureDependencies>({});
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
  const [showPreview, setShowPreview] = useState(false);

  const fetchAll = async () => {
    try {
      const [catalogData, depsData, rolesRes, privRes] = await Promise.all([
        fetchFeatureCatalog(),
        fetchFeatureDependencies(),
        fetch('/api/tenant/roles', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        fetch('/api/tenant/my-privileges', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      ]);
      setCatalog(catalogData);
      setDependencies(depsData);
      const roleList: RoleRow[] = Array.isArray(rolesRes.roles)
        ? rolesRes.roles.map((r: any) => ({ id: r.id, roleName: r.roleName, privileges: Array.isArray(r.privileges) ? r.privileges : [] }))
        : [];
      setRoles(roleList);
      setMyPrivileges(privRes.privileges ?? []);
      if (roleList.length > 0) {
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

  useEffect(() => { fetchAll(); }, []);

  useEffect(() => {
    if (!selectedRoleId) return;
    const found = roles.find(r => r.id === selectedRoleId);
    if (found) {
      setDraftPrivileges(found.privileges);
      setSaveState('idle');
    }
  }, [selectedRoleId, roles]);

  const selectedRole = roles.find(r => r.id === selectedRoleId);

  const handleTogglePrivilege = (key: string) => {
    setDraftPrivileges(prev => {
      const active = prev.includes(key);
      let next: string[];
      if (active) {
        next = prev.filter(k => k !== key);
      } else {
        const deps = dependencies[key] ?? [];
        const missing = deps.filter(d => !prev.includes(d));
        next = Array.from(new Set([...prev, key, ...missing]));
      }
      return next;
    });
    setSaveState('idle');
  };

  const handleSave = async () => {
    if (!selectedRoleId) return;
    setSaveState('saving');
    setError('');
    try {
      const res = await fetch(`/api/tenant/roles/${selectedRoleId}/privileges`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ privileges: draftPrivileges }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setRoles(prev => prev.map(r => r.id === selectedRoleId ? { ...r, privileges: draftPrivileges } : r));
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2500);
    } catch (err: any) {
      setError(err.message || 'Save failed');
      setSaveState('idle');
    }
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
        body: JSON.stringify({ roleName: newRoleName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Create failed');
      const newRole: RoleRow = { id: data.role.id, roleName: data.role.roleName, privileges: [] };
      setRoles(prev => [...prev, newRole]);
      setSelectedRoleId(newRole.id);
      setNewRoleName('');
      setShowNewRole(false);
    } catch (err: any) {
      setError(err.message || 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  const hasChanges = selectedRole
    ? JSON.stringify([...draftPrivileges].sort()) !== JSON.stringify([...selectedRole.privileges].sort())
    : false;

  const content = (
    <div className="space-y-6">
      {error && <div className="bg-red-50 text-red-700 text-xs p-3 rounded-xl border border-red-200 font-semibold">{error}</div>}

      {loading ? (
        <div className="text-xs text-[var(--color-nexus-muted)] font-semibold py-8 text-center">Loading permissions...</div>
      ) : myPrivileges !== 'ALL' && !myPrivileges.includes('roles.manage') ? (
        <div className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl p-10 text-center text-sm text-[var(--color-nexus-muted)]">
          You don't have access to manage roles &amp; permissions. Ask your tenant admin to grant it.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
            <div className="nexus-card rounded-xl p-3 h-fit">
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
                    <div className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-2">
                      {saveState === 'saving' && <span className="text-[var(--color-nexus-muted)]">Saving…</span>}
                      {saveState === 'saved' && <span className="text-[var(--color-nexus-secondary)] flex items-center gap-1"><Check size={13} /> Saved</span>}
                      <button
                        onClick={() => setShowPreview(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[var(--color-nexus-primary)] bg-[var(--color-nexus-primary-fixed)] hover:opacity-80 transition-opacity normal-case"
                      >
                        <Eye size={13} /> Preview Access As {selectedRole.roleName}
                      </button>
                    </div>
                  </div>
                  <FeatureCatalogGrid
                    catalog={catalog}
                    selected={draftPrivileges}
                    onChange={(next) => {
                      setDraftPrivileges(next);
                      setSaveState('idle');
                    }}
                    allowedKeys={myPrivileges}
                    dependencies={dependencies}
                  />
                </>
              ) : (
                <div className="nexus-card rounded-xl p-10 text-center text-sm text-[var(--color-nexus-muted)]">
                  No roles yet — add one to get started.
                </div>
              )}
            </div>
          </div>
        )}

        {showPreview && selectedRole && (
          <AccessPreviewModal
            roleName={selectedRole.roleName}
            catalog={catalog}
            privileges={draftPrivileges}
            onClose={() => setShowPreview(false)}
          />
        )}
      </div>
  );

  if (embedded) return content;

  return (
    <AdminWorkspaceLayout
      user={user}
      onLogout={onLogout}
      title="Roles & Permissions"
      subtitle="Manage role-based access control and privilege assignments."
    >
      {content}
    </AdminWorkspaceLayout>
  );
}

// Read-only, computed-from-data access preview — NOT real session impersonation.
// Deliberately never creates a token, session, or "view as" auth context; it
// only reports which catalog categories the role's current privilege set
// would unlock, so admins can sanity-check a role before assigning it.
function AccessPreviewModal({
  roleName,
  catalog,
  privileges,
  onClose,
}: {
  roleName: string;
  catalog: FeatureCatalogCategory[];
  privileges: string[];
  onClose: () => void;
}) {
  const granted = new Set(privileges);
  const categorySummaries = catalog.map((cat) => {
    const grantedFeatures = cat.features.filter((f) => granted.has(f.key));
    return { category: cat.category, icon: cat.icon, total: cat.features.length, grantedFeatures };
  });
  const accessibleCategories = categorySummaries.filter((c) => c.grantedFeatures.length > 0);
  const noAccessCategories = categorySummaries.filter((c) => c.grantedFeatures.length === 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="nexus-card rounded-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-2">
            <Eye size={18} className="text-[var(--color-nexus-primary)]" />
            <h3 className="font-sans text-lg font-bold text-[var(--color-nexus-ink)]">Access Preview — {roleName}</h3>
          </div>
          <button onClick={onClose} className="text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]">
            <X size={18} />
          </button>
        </div>
        <p className="text-xs text-[var(--color-nexus-muted)] mb-5">
          A read-only summary of what someone in this role would be able to see and do, computed from its
          current privilege set below — not a live session, and nothing here is being changed or logged as if
          someone actually signed in as this role.
        </p>

        {accessibleCategories.length === 0 ? (
          <div className="text-xs text-[var(--color-nexus-muted)] p-4 rounded-lg bg-[var(--color-nexus-surface-alt)]">
            This role currently has zero granted privileges — no app sections would be accessible beyond
            baseline pages every employee sees.
          </div>
        ) : (
          <div className="space-y-3 mb-4">
            {accessibleCategories.map((c) => {
              const CatIcon = CATEGORY_ICONS[c.icon] || Building2;
              return (
              <div key={c.category} className="rounded-xl border border-[var(--color-nexus-border)] p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-[var(--color-nexus-ink)] flex items-center gap-1.5"><CatIcon size={15} /> {c.category}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)]">
                    {c.grantedFeatures.length}/{c.total}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {c.grantedFeatures.map((f) => (
                    <span
                      key={f.key}
                      title={f.description}
                      className="text-[10px] font-semibold px-2 py-1 rounded-full bg-[var(--color-nexus-secondary-soft,rgba(16,185,129,0.1))] text-[var(--color-nexus-secondary)]"
                    >
                      {f.label}
                    </span>
                  ))}
                </div>
              </div>
              );
            })}
          </div>
        )}

        {noAccessCategories.length > 0 && (
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-2">
              No access in these areas
            </div>
            <div className="flex flex-wrap gap-1.5">
              {noAccessCategories.map((c) => {
                const CatIcon = CATEGORY_ICONS[c.icon] || Building2;
                return (
                <span
                  key={c.category}
                  className="text-[10px] font-semibold px-2 py-1 rounded-full bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)] flex items-center gap-1"
                >
                  <CatIcon size={11} /> {c.category}
                </span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
