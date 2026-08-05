import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users2, Plus, X, ChevronRight, Building2, UserCheck, Shield, ChevronDown,
  Activity, BarChart2, Bell, CheckCircle2, User, UserX, Clock, CalendarDays,
  FileText, Search, Settings, ArrowRight, CornerDownRight, Layers, Sliders
} from 'lucide-react';
import type { User as AuthUser } from '../lib/auth';
import AdminWorkspaceLayout from '../components/AdminWorkspaceLayout';
import EmployeeDetailPanel from '../components/EmployeeDetailPanel';

type TeamMember = {
  id: number;
  name: string;
  email: string;
  role: string;
  department: string;
  designation: string;
  managerId?: number | null;
  reportsToName?: string;
  employeeStatus?: string;
  employmentType?: string;
};

type Team = {
  id: number;
  name: string;
  department?: string;
  branchName?: string;
  managerId?: number;
  managerName?: string;
  memberCount?: number;
  createdAt?: string;
};

type LeadershipRole = {
  roleTitle: string;
  assignedPerson?: string;
  description: string;
};

export default function TeamsPage({ user, onLogout, embedded = false }: { user: AuthUser; onLogout?: () => void; embedded?: boolean }) {
  const navigate = useNavigate();
  const token = localStorage.getItem('auth_token');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'members' | 'hierarchy' | 'routing' | 'analytics' | 'settings'>('overview');

  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [availableManagers, setAvailableManagers] = useState<any[]>([]);
  const [todayStats, setTodayStats] = useState<{ presentTodayCount: number; averageWorkedHoursToday: number | null }>({ presentTodayCount: 0, averageWorkedHoursToday: null });

  // Create team state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [creating, setCreating] = useState(false);

  // Add member modal state
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [candidates, setCandidates] = useState<TeamMember[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);

  // Change manager modal state
  const [assigningMember, setAssigningMember] = useState<TeamMember | null>(null);
  const [selectedManagerId, setSelectedManagerId] = useState<string>('');
  const [assigningLoading, setAssigningLoading] = useState(false);

  // Search & Filter state
  const [memberSearch, setMemberSearch] = useState('');

  // Detail panel state
  const [detailUserId, setDetailUserId] = useState<number | null>(null);

  const refreshTeams = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/teams/mine', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load team workspace.');

      if (data.team) {
        setTeam(data.team);
        setMembers(Array.isArray(data.members) ? data.members : []);
      } else {
        setTeam(null);
        setMembers([]);
      }
      if (Array.isArray(data.availableManagers)) {
        setAvailableManagers(data.availableManagers);
      }
      setTodayStats(data.todayStats || { presentTodayCount: 0, averageWorkedHoursToday: null });
    } catch (err: any) {
      setError(err.message || 'Could not load team workspace.');
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
      setShowCreateModal(false);
      setSuccess('Team created successfully!');
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
      setSuccess('Member added to team.');
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
      setSuccess('Member removed.');
      await refreshTeams();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAssignManagerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigningMember) return;
    setAssigningLoading(true);
    try {
      const res = await fetch('/api/tenant/teams/assign-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ memberId: assigningMember.id, managerId: selectedManagerId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update manager.');
      setAssigningMember(null);
      setSuccess(`Updated reporting manager for ${assigningMember.name}.`);
      await refreshTeams();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAssigningLoading(false);
    }
  };

  const filteredMembers = members.filter(m =>
    m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
    m.email.toLowerCase().includes(memberSearch.toLowerCase()) ||
    (m.department && m.department.toLowerCase().includes(memberSearch.toLowerCase())) ||
    (m.designation && m.designation.toLowerCase().includes(memberSearch.toLowerCase()))
  );

  // Only real, data-backed roles — no invented "HR Department"/"Ops Unit"
  // placeholders. Team Lead and Reporting Manager both resolve to the
  // team's actual manager; there's no separate HRBP/Ops assignment on a
  // team record today, so those aren't shown rather than faked.
  const leadershipRoles: LeadershipRole[] = [
    { roleTitle: 'Team Lead', assignedPerson: team?.managerName || user.name, description: 'Directs day-to-day operations and team workflows.' },
    { roleTitle: 'Reporting Manager', assignedPerson: team?.managerName || user.name, description: 'Manages performance reviews and reporting tree.' },
  ];

  // Reference list of the org-wide event types that CAN be routed —
  // actual routing rules live in Notification Policies (tenant admin
  // settings), not per-team, so this is explicitly static reference
  // information rather than a live per-team status table.
  const notificationEventReference = [
    { event: 'Late Arrival Alert', recipient: 'Reporting Manager & HR' },
    { event: 'Missed Punch Out', recipient: 'Reporting Manager' },
    { event: 'Attendance Correction Submitted', recipient: 'Attendance Approver' },
    { event: 'Leave Request Submitted', recipient: 'Reporting Manager & HR' },
    { event: 'Payroll Batch Generation', recipient: 'Payroll Reviewer' },
  ];

  const content = (
    <div className="space-y-6">
      {loading && (
        <div className="p-8 text-center text-xs font-mono text-[var(--color-nexus-muted)]">
          Loading team workspace…
        </div>
      )}

      {/* Alert Notices */}
      {!loading && error && (
        <div className="p-4 rounded-xl bg-[var(--color-nexus-error-soft)] border border-[var(--color-nexus-error)]/20 text-[var(--color-nexus-error)] text-xs font-semibold flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="p-1 hover:opacity-80"><X size={14} /></button>
        </div>
      )}
      {!loading && success && (
        <div className="p-4 rounded-xl bg-[var(--color-nexus-secondary-container)] border border-[var(--color-nexus-secondary)]/30 text-[var(--color-nexus-secondary)] text-xs font-semibold flex items-center justify-between">
          <span>{success}</span>
          <button onClick={() => setSuccess('')} className="p-1 hover:opacity-80"><X size={14} /></button>
        </div>
      )}

      {/* Main Single Workspace Header */}
      {!loading && (
      <>
      <div className="p-5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-[var(--color-nexus-primary)] text-white flex items-center justify-center font-extrabold text-base">
                {team ? team.name.charAt(0).toUpperCase() : 'T'}
              </div>
              <div>
                <h1 className="text-xl font-extrabold text-[var(--color-nexus-ink)] font-sans">
                  {team ? team.name : 'Organization Teams Workspace'}
                </h1>
                <p className="text-xs text-[var(--color-nexus-muted)]">
                  {team
                    ? [team.department, team.branchName].filter(Boolean).join(' · ') || 'No department or branch set'
                    : 'Configure operational team hierarchies, leadership roles, and reporting paths.'}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {team ? (
              <button
                type="button"
                onClick={() => { setShowAddPanel(true); loadCandidates(); }}
                className="px-4 py-2.5 bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Plus size={15} /> Add Team Member
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2.5 bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Plus size={15} /> Provision New Team
              </button>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 border-t border-[var(--color-nexus-border)] pt-4 overflow-x-auto">
          {[
            { id: 'overview', label: 'Overview & Leadership', icon: Building2 },
            { id: 'members', label: `Members Roster (${members.length})`, icon: Users2 },
            { id: 'hierarchy', label: 'Reporting Tree', icon: CornerDownRight },
            { id: 'routing', label: 'Notification Routing', icon: Bell },
            { id: 'analytics', label: 'Team Analytics', icon: BarChart2 },
            { id: 'settings', label: 'Settings', icon: Settings },
          ].map((tabItem) => {
            const Icon = tabItem.icon;
            const active = activeTab === tabItem.id;
            return (
              <button
                key={tabItem.id}
                type="button"
                onClick={() => setActiveTab(tabItem.id as any)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
                  active
                    ? 'bg-[var(--color-nexus-primary)] text-white shadow-xs'
                    : 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]'
                }`}
              >
                <Icon size={14} />
                <span>{tabItem.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* WORKSPACE CONTENT AREA */}
      {!team ? (
        <div className="p-12 text-center bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl space-y-3">
          <Users2 size={40} className="mx-auto text-[var(--color-nexus-muted)]" />
          <h3 className="text-base font-bold text-[var(--color-nexus-ink)]">No Organization Team Provisioned Yet</h3>
          <p className="text-xs text-[var(--color-nexus-muted)] max-w-md mx-auto">
            Create your operational team unit to manage members, configure reporting managers, and route workflows automatically.
          </p>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="px-5 py-2.5 bg-[var(--color-nexus-primary)] text-white text-xs font-bold rounded-xl hover:opacity-90 transition-all inline-flex items-center gap-1.5 cursor-pointer mt-2"
          >
            <Plus size={15} /> Create First Team
          </button>
        </div>
      ) : (
        <>
          {/* TAB 1: OVERVIEW & LEADERSHIP */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Operational KPIs — every value here is real, sourced from
                  today's attendance_logs for this team; no placeholder
                  numbers. */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
                <div className="p-4 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] block">Total Members</span>
                  <span className="text-lg font-bold text-[var(--color-nexus-ink)] mt-1.5 block">{members.length}</span>
                </div>
                <div className="p-4 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] block">Present Today</span>
                  <span className="text-lg font-bold text-[var(--color-nexus-secondary)] mt-1.5 block">{todayStats.presentTodayCount} / {members.length}</span>
                </div>
                <div className="p-4 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] block">Avg. Hours Today</span>
                  <span className="text-lg font-bold text-[var(--color-nexus-primary)] mt-1.5 block">
                    {todayStats.averageWorkedHoursToday !== null ? `${todayStats.averageWorkedHoursToday}h` : 'No checkouts yet'}
                  </span>
                </div>
              </div>

              {/* Leadership Roles Matrix */}
              <div className="p-5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl space-y-3.5">
                <h3 className="text-sm font-bold text-[var(--color-nexus-ink)]">Team Leadership</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {leadershipRoles.map((role) => (
                    <div key={role.roleTitle} className="p-3.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[var(--color-nexus-primary)]">{role.roleTitle}</span>
                        <Shield size={14} className="text-[var(--color-nexus-muted)]" />
                      </div>
                      <span className="text-sm font-bold text-[var(--color-nexus-ink)] block">{role.assignedPerson}</span>
                      <p className="text-[11px] text-[var(--color-nexus-muted)] leading-relaxed">{role.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: MEMBERS ROSTER */}
          {activeTab === 'members' && (
            <div className="p-5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search size={14} className="absolute left-3.5 top-3 text-[var(--color-nexus-muted)]" />
                  <input
                    type="text"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Filter members by name, email, role, or designation..."
                    className="w-full pl-9 pr-4 py-2 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs text-[var(--color-nexus-ink)] focus:outline-none"
                  />
                </div>

                <span className="text-xs font-mono text-[var(--color-nexus-muted)]">
                  Showing {filteredMembers.length} of {members.length} members
                </span>
              </div>

              <div className="border border-[var(--color-nexus-border)] rounded-xl overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse min-w-[720px]">
                  <thead>
                    <tr className="bg-[var(--color-nexus-surface-alt)] border-b border-[var(--color-nexus-border)] text-[var(--color-nexus-muted)] font-mono text-[10px] uppercase">
                      <th className="py-3 px-4">Member</th>
                      <th className="py-3 px-4">Designation</th>
                      <th className="py-3 px-4">Department</th>
                      <th className="py-3 px-4">Reports To (Manager)</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-nexus-border)]">
                    {filteredMembers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-xs font-mono text-[var(--color-nexus-muted)]">
                          No team members match your filter criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredMembers.map((m) => (
                        <tr key={m.id} className="hover:bg-[var(--color-nexus-surface-alt)]/50 transition-colors">
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] font-extrabold text-xs flex items-center justify-center">
                                {m.name.charAt(0)}
                              </div>
                              <div>
                                <button
                                  type="button"
                                  onClick={() => setDetailUserId(m.id)}
                                  className="font-bold text-[var(--color-nexus-ink)] hover:text-[var(--color-nexus-primary)] hover:underline text-left cursor-pointer"
                                >
                                  {m.name}
                                </button>
                                <span className="block text-[10px] text-[var(--color-nexus-muted)] font-mono">{m.email}</span>
                              </div>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 font-medium text-[var(--color-nexus-ink)]">{m.designation || m.role}</td>
                          <td className="py-3.5 px-4 text-[var(--color-nexus-muted)]">{m.department || '—'}</td>
                          <td className="py-3.5 px-4">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] font-mono text-[11px] font-semibold text-[var(--color-nexus-ink)]">
                              <User size={12} className="text-[var(--color-nexus-primary)]" />
                              {m.reportsToName || 'Unassigned'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase">
                              Active
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-3">
                              <button
                                type="button"
                                onClick={() => { setAssigningMember(m); setSelectedManagerId(String(m.managerId || '')); }}
                                className="text-xs text-[var(--color-nexus-primary)] font-bold hover:underline cursor-pointer"
                              >
                                Change Manager
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveMember(m.id)}
                                className="text-xs text-red-600 font-bold hover:underline cursor-pointer"
                              >
                                Remove
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: REPORTING HIERARCHY TREE */}
          {activeTab === 'hierarchy' && (
            <div className="p-5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl space-y-6">
              <div>
                <h3 className="text-sm font-bold text-[var(--color-nexus-ink)] uppercase tracking-wider">Organizational Reporting Tree</h3>
                <p className="text-xs text-[var(--color-nexus-muted)] mt-1">Hierarchical tree view mapping direct reporting relationships within this team.</p>
              </div>

              <div className="p-5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg space-y-4">
                {/* Department Node */}
                <div className="flex items-center gap-2">
                  <Building2 size={16} className="text-[var(--color-nexus-primary)]" />
                  <span className="text-sm font-extrabold text-[var(--color-nexus-ink)] uppercase font-mono">{team.department ? `${team.department} Department` : 'No Department Set'}</span>
                </div>

                {/* Manager Node */}
                <div className="pl-6 border-l-2 border-[var(--color-nexus-primary)] space-y-3">
                  <div className="flex items-center gap-2">
                    <Shield size={14} className="text-[var(--color-nexus-secondary)]" />
                    <span className="text-xs font-bold text-[var(--color-nexus-ink)]">
                      Reporting Lead / Team Manager: <strong>{team.managerName || user.name}</strong>
                    </span>
                  </div>

                  {/* Members Sub-Tree */}
                  <div className="pl-6 border-l-2 border-[var(--color-nexus-border)] space-y-2">
                    <span className="text-[10px] font-mono font-bold uppercase text-[var(--color-nexus-muted)] block">Direct Team Members:</span>
                    {members.map((m) => (
                      <div key={m.id} className="flex items-center flex-wrap gap-x-2 gap-y-1 text-xs font-mono p-2 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg">
                        <CornerDownRight size={12} className="text-[var(--color-nexus-muted)]" />
                        <span className="font-bold text-[var(--color-nexus-ink)]">{m.name}</span>
                        <span className="text-[var(--color-nexus-muted)]">({m.designation || m.role})</span>
                        <span className="ml-auto text-[10px] text-[var(--color-nexus-secondary)]">Reports to: {m.reportsToName}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: NOTIFICATION ROUTING */}
          {activeTab === 'routing' && (
            <div className="p-5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl space-y-4">
              <div>
                <h3 className="text-sm font-bold text-[var(--color-nexus-ink)]">Event Routing Reference</h3>
                <p className="text-xs text-[var(--color-nexus-muted)] mt-1">
                  Typical recipients for each workflow event. Routing is configured centrally under Notification
                  Policies (Settings), not per team — this is reference information, not a live per-team status.
                </p>
              </div>

              <div className="border border-[var(--color-nexus-border)] rounded-xl overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse min-w-[420px]">
                  <thead>
                    <tr className="bg-[var(--color-nexus-surface-alt)] border-b border-[var(--color-nexus-border)] text-[var(--color-nexus-muted)] text-[10px] uppercase">
                      <th className="py-2.5 px-4">Workflow Event</th>
                      <th className="py-2.5 px-4">Typical Recipients</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-nexus-border)]">
                    {notificationEventReference.map((route) => (
                      <tr key={route.event} className="hover:bg-[var(--color-nexus-surface-alt)]/50 transition-colors">
                        <td className="py-3 px-4 font-bold text-[var(--color-nexus-ink)]">{route.event}</td>
                        <td className="py-3 px-4 text-[11px] text-[var(--color-nexus-muted)]">{route.recipient}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: TEAM ANALYTICS */}
          {activeTab === 'analytics' && (
            <div className="p-5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl space-y-4">
              <div>
                <h3 className="text-sm font-bold text-[var(--color-nexus-ink)]">Team Analytics</h3>
                <p className="text-xs text-[var(--color-nexus-muted)] mt-1">Attendance and working-hours trends for this team.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="p-4 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg space-y-1">
                  <span className="text-[10px] font-bold uppercase text-[var(--color-nexus-muted)]">Present Today</span>
                  <span className="text-lg font-bold text-[var(--color-nexus-secondary)] block">{todayStats.presentTodayCount} / {members.length}</span>
                </div>
                <div className="p-4 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg space-y-1">
                  <span className="text-[10px] font-bold uppercase text-[var(--color-nexus-muted)]">Avg. Hours Today</span>
                  <span className="text-lg font-bold text-[var(--color-nexus-primary)] block">
                    {todayStats.averageWorkedHoursToday !== null ? `${todayStats.averageWorkedHoursToday}h` : '—'}
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-lg border border-dashed border-[var(--color-nexus-border)] text-[11px] text-[var(--color-nexus-muted)] text-center">
                Multi-week trends (on-time rate, leave utilization) aren't tracked per team yet — see the org-wide
                Reports section for historical attendance and leave analytics.
              </div>
            </div>
          )}

          {/* TAB 6: SETTINGS */}
          {activeTab === 'settings' && (
            <div className="p-5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl space-y-4">
              <div>
                <h3 className="text-sm font-bold text-[var(--color-nexus-ink)]">Team Configuration</h3>
                <p className="text-xs text-[var(--color-nexus-muted)] mt-1">
                  Working shift and attendance policy are configured org-wide (Attendance Preferences), not per team —
                  nothing team-specific to override yet.
                </p>
              </div>
            </div>
          )}
        </>
      )}
      </>
      )}

      {/* CREATE TEAM MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[var(--color-nexus-ink)]">Provision New Team</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateTeam} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-1">Team Name</label>
                <input
                  type="text"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="e.g. Engineering Alpha..."
                  className="w-full bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-nexus-ink)] focus:outline-none"
                  required
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 py-2.5 bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)] text-xs font-bold uppercase rounded-xl hover:bg-[var(--color-nexus-border)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !newTeamName.trim()}
                  className="flex-1 py-2.5 bg-[var(--color-nexus-primary)] text-white text-xs font-bold uppercase rounded-xl hover:opacity-90 disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create Team'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD MEMBER MODAL */}
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
              <p className="text-xs font-mono text-[var(--color-nexus-muted)] py-4 text-center">Loading unassigned candidates...</p>
            ) : candidates.length === 0 ? (
              <p className="text-xs font-mono text-[var(--color-nexus-muted)] py-4 text-center">No unassigned candidates found.</p>
            ) : (
              <div className="divide-y divide-[var(--color-nexus-border)] max-h-80 overflow-y-auto">
                {candidates.map((c) => (
                  <div key={c.id} className="py-3 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-[var(--color-nexus-ink)] block">{c.name}</span>
                      <span className="text-[10px] text-[var(--color-nexus-muted)] block">{c.email} | {c.department || c.role}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAddMember(c.id)}
                      disabled={addingId === c.id}
                      className="px-3.5 py-1.5 bg-[var(--color-nexus-primary)] text-white text-xs font-bold rounded-xl hover:opacity-90 disabled:opacity-40 cursor-pointer"
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

      {/* ASSIGN DIRECT REPORTING MANAGER MODAL */}
      {assigningMember && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[var(--color-nexus-ink)]">Assign Direct Manager</h3>
              <button onClick={() => setAssigningMember(null)} className="text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAssignManagerSubmit} className="space-y-4">
              <p className="text-xs text-[var(--color-nexus-muted)]">
                Select the direct reporting manager for <strong>{assigningMember.name}</strong>:
              </p>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-1">Direct Manager</label>
                <select
                  value={selectedManagerId}
                  onChange={(e) => setSelectedManagerId(e.target.value)}
                  className="w-full bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-nexus-ink)] focus:outline-none"
                >
                  <option value="">Unassigned (Default Team Lead)</option>
                  {availableManagers.filter(m => m.id !== assigningMember.id).map((m) => (
                    <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setAssigningMember(null)}
                  className="flex-1 py-2.5 bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)] text-xs font-bold uppercase rounded-xl hover:bg-[var(--color-nexus-border)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={assigningLoading}
                  className="flex-1 py-2.5 bg-[var(--color-nexus-primary)] text-white text-xs font-bold uppercase rounded-xl hover:opacity-90 disabled:opacity-50"
                >
                  {assigningLoading ? 'Saving...' : 'Save Assignment'}
                </button>
              </div>
            </form>
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
      title="Enterprise Teams & Reporting Structure"
      subtitle="Manage operational team units, direct reporting paths, leadership governance, and workflow routing."
    >
      {content}
    </AdminWorkspaceLayout>
  );
}
