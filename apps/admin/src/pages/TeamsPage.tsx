import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users2, Plus, X, ChevronRight } from 'lucide-react';
import type { User } from '../lib/auth';
import PortalShell from '../components/PortalShell';
import EmployeeDetailPanel from '../components/EmployeeDetailPanel';
import { getAdminPortalNavItems, routeForAdminNav } from '../lib/adminPortalNav';

type TeamMember = {
  id: number;
  name: string;
  email: string;
  role: string;
  department: string;
  designation: string;
};

export default function TeamsPage({ user, onLogout, embedded = false }: { user: User; onLogout: () => void; embedded?: boolean }) {
  const navigate = useNavigate();
  const token = localStorage.getItem('auth_token');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [team, setTeam] = useState<{ id: number; name: string } | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [newTeamName, setNewTeamName] = useState('');
  const [creating, setCreating] = useState(false);

  const [showAddPanel, setShowAddPanel] = useState(false);
  const [candidates, setCandidates] = useState<TeamMember[]>([]);
  const [candidatesReason, setCandidatesReason] = useState('');
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [detailUserId, setDetailUserId] = useState<number | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/teams/mine', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load your team.');
      setTeam(data.team);
      setMembers(Array.isArray(data.members) ? data.members : []);
    } catch (err: any) {
      setError(err.message || 'Could not load your team.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newTeamName.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to create team.');
      setNewTeamName('');
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Failed to create team.');
    } finally {
      setCreating(false);
    }
  };

  const loadCandidates = async () => {
    setCandidatesLoading(true);
    setCandidatesReason('');
    try {
      const res = await fetch('/api/tenant/teams/candidates', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load candidates.');
      setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      if (data.reason) setCandidatesReason(data.reason);
    } catch (err: any) {
      setError(err.message || 'Could not load candidates.');
    } finally {
      setCandidatesLoading(false);
    }
  };

  const openAddPanel = () => {
    setShowAddPanel(true);
    loadCandidates();
  };

  const handleAddMember = async (candidateId: number) => {
    setAddingId(candidateId);
    setError('');
    try {
      const res = await fetch('/api/tenant/teams/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: candidateId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to add member.');
      setCandidates((prev) => prev.filter((c) => c.id !== candidateId));
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Failed to add member.');
    } finally {
      setAddingId(null);
    }
  };

  const handleRemoveMember = async (memberId: number) => {
    setRemovingId(memberId);
    setError('');
    try {
      const res = await fetch(`/api/tenant/teams/members/${memberId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to remove member.');
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Failed to remove member.');
    } finally {
      setRemovingId(null);
    }
  };

  const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');

  const content = (
    <>
      {error && <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-4 rounded-xl mb-6 border border-[var(--color-nexus-error)]/20 font-medium">{error}</div>}

      <div className="space-y-6">
        <section>
          <h2 className="font-sans text-2xl font-bold text-[var(--color-nexus-ink)]">Teams</h2>
          <p className="mt-1 text-sm text-[var(--color-nexus-muted)]">Build your own team from colleagues in your department, and check in on their attendance, leave, and payroll where you're permitted to.</p>
        </section>

        {loading ? (
          <div className="py-16 text-center text-sm text-[var(--color-nexus-muted)]">Loading your team…</div>
        ) : !team ? (
          <section className="nexus-card rounded-3xl p-8 max-w-md">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)]">
                <Users2 size={20} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[var(--color-nexus-ink)]">You don't have a team yet</h3>
                <p className="text-xs text-[var(--color-nexus-muted)]">Give it a name to get started.</p>
              </div>
            </div>
            <form onSubmit={handleCreateTeam} className="flex gap-2">
              <input
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder="e.g. Frontend Squad"
                className="flex-1 rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] px-4 py-2.5 text-sm focus:outline-none"
              />
              <button
                type="submit"
                disabled={creating || !newTeamName.trim()}
                className="rounded-2xl bg-[var(--color-nexus-primary)] px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--color-nexus-primary-hover)] disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create Team'}
              </button>
            </form>
          </section>
        ) : (
          <>
            <section className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-lg font-bold text-[var(--color-nexus-ink)]">{team.name}</h3>
                <p className="text-xs text-[var(--color-nexus-muted)]">{members.length} member{members.length === 1 ? '' : 's'}</p>
              </div>
              <button
                onClick={openAddPanel}
                className="flex items-center gap-1.5 rounded-xl bg-[var(--color-nexus-primary)] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--color-nexus-primary-hover)] self-start md:self-auto"
              >
                <Plus size={14} /> Add Member
              </button>
            </section>

            {members.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-[var(--color-nexus-border)] p-12 text-center text-sm text-[var(--color-nexus-muted)]">
                No members yet — add colleagues from your department to get started.
              </div>
            ) : (
              <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {members.map((m) => (
                  <div key={m.id} className=" nexus-card rounded-3xl p-5">
                    <button onClick={() => setDetailUserId(m.id)} className="w-full text-left">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-nexus-primary-fixed)] text-sm font-bold text-[var(--color-nexus-primary)]">
                          {initials(m.name)}
                        </div>
                        <div className="min-w-0">
                          <h4 className="truncate text-sm font-bold text-[var(--color-nexus-ink)]">{m.name}</h4>
                          <p className="truncate text-xs text-[var(--color-nexus-muted)]">{m.designation || m.role}</p>
                        </div>
                      </div>
                      <div className="mt-4 flex items-center justify-between text-[11px] font-semibold text-[var(--color-nexus-muted)]">
                        <span>{m.department || '—'}</span>
                        <span className="flex items-center gap-0.5 text-[var(--color-nexus-primary)]">
                          View details <ChevronRight size={12} />
                        </span>
                      </div>
                    </button>
                    <button
                      onClick={() => handleRemoveMember(m.id)}
                      disabled={removingId === m.id}
                      className="mt-3 w-full rounded-xl border border-[var(--color-nexus-border)] py-2 text-[11px] font-bold uppercase tracking-wider text-[var(--color-nexus-error)] hover:bg-[var(--color-nexus-error-soft)] disabled:opacity-50"
                    >
                      {removingId === m.id ? 'Removing…' : 'Remove from Team'}
                    </button>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </div>

      {showAddPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowAddPanel(false)}>
          <div className="w-full max-w-md max-h-[80vh] overflow-y-auto rounded-3xl bg-[var(--color-nexus-surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-[var(--color-nexus-ink)]">Add from your department</h3>
              <button onClick={() => setShowAddPanel(false)} aria-label="Close" className="text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]">
                <X size={18} />
              </button>
            </div>

            {candidatesLoading ? (
              <div className="py-10 text-center text-sm text-[var(--color-nexus-muted)]">Loading…</div>
            ) : candidates.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--color-nexus-border)] p-6 text-center text-xs text-[var(--color-nexus-muted)]">
                {candidatesReason || 'No one else in your department is available to add right now.'}
              </div>
            ) : (
              <div className="space-y-2">
                {candidates.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--color-nexus-border)] px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-[var(--color-nexus-ink)]">{c.name}</p>
                      <p className="truncate text-xs text-[var(--color-nexus-muted)]">{c.designation || c.role}</p>
                    </div>
                    <button
                      onClick={() => handleAddMember(c.id)}
                      disabled={addingId === c.id}
                      className="shrink-0 rounded-xl bg-[var(--color-nexus-primary)] px-3.5 py-2 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-[var(--color-nexus-primary-hover)] disabled:opacity-50"
                    >
                      {addingId === c.id ? 'Adding…' : 'Add'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {detailUserId != null && (
        <EmployeeDetailPanel userId={detailUserId} onClose={() => setDetailUserId(null)} />
      )}
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
      activeTab="teams"
      onTabChange={(id) => navigate(routeForAdminNav(id))}
      onLogout={onLogout}
      title="Teams"
      fallbackHref="/dashboard"
    >
      {content}
    </PortalShell>
  );
}
