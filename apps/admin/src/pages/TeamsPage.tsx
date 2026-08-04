import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users2, Plus, X, ChevronRight, Building2, UserCheck, Shield, ChevronDown } from 'lucide-react';
import type { User } from '../lib/auth';
import AdminWorkspaceLayout from '../components/AdminWorkspaceLayout';
import EmployeeDetailPanel from '../components/EmployeeDetailPanel';

type TeamMember = {
  id: number;
  name: string;
  email: string;
  role: string;
  department: string;
  designation: string;
  managerName?: string;
  branchName?: string;
};

type Team = {
  id: number;
  name: string;
  department?: string;
  branchName?: string;
  managerName?: string;
  memberCount?: number;
};

export default function TeamsPage({ user, onLogout, embedded = false }: { user: User; onLogout?: () => void; embedded?: boolean }) {
  const navigate = useNavigate();
  const token = localStorage.getItem('auth_token');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [teams, setTeams] = useState<Team[]>([]);
  const [activeTeam, setActiveTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);

  // Create Team modal state
  const [newTeamName, setNewTeamName] = useState('');
  const [creating, setCreating] = useState(false);

  // Add candidate state
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [candidates, setCandidates] = useState<TeamMember[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);

  // Detail panel state
  const [detailUserId, setDetailUserId] = useState<number | null>(null);

  const refreshTeams = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/teams/mine', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load teams.');

      if (data.team) {
        setTeams([data.team]);
        setActiveTeam(data.team);
        setMembers(Array.isArray(data.members) ? data.members : []);
      } else {
        setTeams([]);
      }
    } catch (err: any) {
      setError(err.message || 'Could not load teams.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshTeams();
  }, [token]);

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
      await refreshTeams();
    } catch (err: any) {
      setError(err.message || 'Failed to create team.');
    } finally {
      setCreating(false);
    }
  };

  const loadCandidates = async () => {
    setCandidatesLoading(true);
    try {
      const res = await fetch('/api/tenant/teams/candidates', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load candidates.');
      setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
    } catch (err: any) {
      setError(err.message || 'Could not load candidates.');
    } finally {
      setCandidatesLoading(false);
    }
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
      setShowAddPanel(false);
      await refreshTeams();
    } catch (err: any) {
      setError(err.message || 'Failed to add member.');
    } finally {
      setAddingId(null);
    }
  };

  const handleRemoveMember = async (memberId: number) => {
    if (!window.confirm('Remove this member from the team?')) return;
    try {
      const res = await fetch(`/api/tenant/teams/members/${memberId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to remove member.');
      await refreshTeams();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const content = (
    <div className="space-y-6">
      {/* Create Team Bar */}
      <div className="p-4 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xs">
        <div>
          <h2 className="text-base font-bold text-[var(--color-nexus-ink)]">Organization Teams</h2>
          <p className="text-xs text-[var(--color-nexus-muted)]">Configure team structures, leads, and operational groupings.</p>
        </div>

        <form onSubmit={handleCreateTeam} className="flex gap-2 w-full sm:w-auto">
          <input
            type="text"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            placeholder="New team name (e.g. Engineering Alpha)..."
            className="px-3 py-2 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs text-[var(--color-nexus-ink)] focus:outline-none w-64"
          />
          <button
            type="submit"
            disabled={creating || !newTeamName.trim()}
            className="px-4 py-2 bg-[var(--color-nexus-primary)] text-white text-xs font-bold rounded-xl hover:opacity-90 disabled:opacity-40 flex items-center gap-1 cursor-pointer shrink-0"
          >
            <Plus size={14} /> Create Team
          </button>
        </form>
      </div>

      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">{error}</div>}

      {/* Active Team Overview Header */}
      {activeTeam ? (
        <div className="p-6 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl space-y-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--color-nexus-border)] pb-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-extrabold text-[var(--color-nexus-ink)]">{activeTeam.name}</h3>
                <span className="px-2.5 py-0.5 rounded-full bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] text-[10px] font-mono font-bold uppercase">
                  {members.length} Members
                </span>
              </div>
              <p className="text-xs text-[var(--color-nexus-muted)] mt-1">
                Department: <strong>{activeTeam.department || 'Engineering'}</strong> | Branch: <strong>{activeTeam.branchName || 'Bangalore HQ'}</strong>
              </p>
            </div>

            <button
              type="button"
              onClick={() => { setShowAddPanel(true); loadCandidates(); }}
              className="px-4 py-2 bg-[var(--color-nexus-primary)] text-white text-xs font-bold rounded-xl hover:opacity-90 flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Plus size={14} /> Add Member
            </button>
          </div>

          {/* Employee Relationship Path Preview */}
          <div className="p-4 rounded-xl bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] space-y-2">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Organization Relationship Hierarchy:</span>
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="px-2.5 py-1 rounded-lg bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] font-semibold">
                Team Lead: {user.name}
              </span>
              <ChevronRight size={14} className="text-[var(--color-nexus-muted)]" />
              <span className="px-2.5 py-1 rounded-lg bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] font-semibold">
                Team: {activeTeam.name}
              </span>
              <ChevronRight size={14} className="text-[var(--color-nexus-muted)]" />
              <span className="px-2.5 py-1 rounded-lg bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] font-semibold">
                Dept: Engineering
              </span>
            </div>
          </div>

          {/* Members Table */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-[var(--color-nexus-ink)]">Team Roster</h4>
            <div className="border border-[var(--color-nexus-border)] rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[var(--color-nexus-surface-alt)] border-b border-[var(--color-nexus-border)] text-[var(--color-nexus-muted)] font-mono text-[10px] uppercase">
                    <th className="py-2.5 px-4">Member</th>
                    <th className="py-2.5 px-4">Role</th>
                    <th className="py-2.5 px-4">Department</th>
                    <th className="py-2.5 px-4">Designation</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-nexus-border)]">
                  {members.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-xs font-mono text-[var(--color-nexus-muted)]">
                        No members assigned to this team yet. Click "Add Member" above.
                      </td>
                    </tr>
                  ) : (
                    members.map((m) => (
                      <tr key={m.id} className="hover:bg-[var(--color-nexus-surface-alt)]/50 transition-colors">
                        <td className="py-3 px-4 font-bold text-[var(--color-nexus-ink)]">
                          <button
                            type="button"
                            onClick={() => setDetailUserId(m.id)}
                            className="hover:underline text-[var(--color-nexus-primary)] text-left cursor-pointer"
                          >
                            {m.name}
                          </button>
                          <span className="block text-[10px] text-[var(--color-nexus-muted)] font-normal">{m.email}</span>
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px]">{m.role}</td>
                        <td className="py-3 px-4">{m.department || '—'}</td>
                        <td className="py-3 px-4 text-[var(--color-nexus-muted)]">{m.designation || '—'}</td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(m.id)}
                            className="text-xs text-red-600 font-bold hover:underline cursor-pointer"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-8 text-center bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl space-y-2">
          <Users2 size={32} className="mx-auto text-[var(--color-nexus-muted)]" />
          <h3 className="text-sm font-bold text-[var(--color-nexus-ink)]">No Team Provisioned Yet</h3>
          <p className="text-xs text-[var(--color-nexus-muted)]">Use the input above to create your first organization team.</p>
        </div>
      )}

      {/* Candidate Add Slide-Over Modal */}
      {showAddPanel && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[var(--color-nexus-ink)]">Add Team Member</h3>
              <button onClick={() => setShowAddPanel(false)} className="text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]">
                <X size={18} />
              </button>
            </div>

            {candidatesLoading ? (
              <p className="text-xs font-mono text-[var(--color-nexus-muted)] py-4 text-center">Loading candidates...</p>
            ) : candidates.length === 0 ? (
              <p className="text-xs font-mono text-[var(--color-nexus-muted)] py-4 text-center">No available unassigned candidates found.</p>
            ) : (
              <div className="divide-y divide-[var(--color-nexus-border)] max-h-80 overflow-y-auto">
                {candidates.map((c) => (
                  <div key={c.id} className="py-3 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-[var(--color-nexus-ink)] block">{c.name}</span>
                      <span className="text-[10px] text-[var(--color-nexus-muted)] block">{c.department || c.role}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAddMember(c.id)}
                      disabled={addingId === c.id}
                      className="px-3 py-1.5 bg-[var(--color-nexus-primary)] text-white text-xs font-bold rounded-lg hover:opacity-90 disabled:opacity-40"
                    >
                      {addingId === c.id ? 'Adding...' : 'Add to Team'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Universal Employee Detail Panel */}
      {detailUserId && (
        <EmployeeDetailPanel userId={detailUserId} onClose={() => setDetailUserId(null)} />
      )}
    </div>
  );

  if (embedded) return content;

  return (
    <AdminWorkspaceLayout
      user={user}
      onLogout={onLogout}
      title="Teams & Reporting Structure"
      subtitle="Manage organization teams, managers, members, and organizational reporting paths."
    >
      {content}
    </AdminWorkspaceLayout>
  );
}
