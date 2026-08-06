import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDays, Users, Search, List, Phone, Network, Plus, Trash2, X, Sun, HeartPulse, Baby, Briefcase, Info, PartyPopper, ArrowLeft, CheckCircle2, XCircle, Clock, Shield } from 'lucide-react';
import type { User } from '../lib/auth';
import AdminWorkspaceLayout from '../components/AdminWorkspaceLayout';
import ManagementTemplate from '../components/templates/ManagementTemplate';
import StatusPill from '../components/StatusPill';

const POLICY_PALETTE = [
  { bg: 'bg-blue-100', fg: 'text-blue-600', icon: CalendarDays },
  { bg: 'bg-emerald-100', fg: 'text-emerald-600', icon: Sun },
  { bg: 'bg-rose-100', fg: 'text-rose-600', icon: HeartPulse },
  { bg: 'bg-orange-100', fg: 'text-orange-600', icon: Baby },
  { bg: 'bg-yellow-100', fg: 'text-yellow-700', icon: Briefcase },
  { bg: 'bg-purple-100', fg: 'text-purple-600', icon: PartyPopper },
];

export default function LeaveManagementPage({ user, onLogout, embedded = false }: { user: User; onLogout?: () => void; embedded?: boolean }) {
  const navigate = useNavigate();
  const token = localStorage.getItem('auth_token');
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [activeTab, setActiveTab] = useState<string>(() => (searchParams.get('tab') || 'pending_approvals'));
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
  const [leavePolicies, setLeavePolicies] = useState<any[]>([]);
  const [holidays, setHolidays] = useState<any[]>([]);
  const [encashmentRequests, setEncashmentRequests] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  // Policy creation — POST /api/tenant/leave/policies already existed on the
  // backend with nothing in this UI ever calling it, so there was no way to
  // add a leave type/policy short of a direct API call. seedingDefaults
  // drives the companion one-click "seed the standard starter set" action
  // (POST /api/tenant/leave/policies/seed-defaults), also previously unused
  // by any frontend.
  const [showCreatePolicyModal, setShowCreatePolicyModal] = useState(false);
  const [creatingPolicy, setCreatingPolicy] = useState(false);
  const [seedingDefaults, setSeedingDefaults] = useState(false);
  const [policyForm, setPolicyForm] = useState({
    name: '',
    code: '',
    maxDaysPerYear: 12,
    allowHalfDay: true,
    requiresApproval: true,
    accrualEnabled: false,
    carryForwardEnabled: false,
    maxCarryForwardDays: 0,
    encashmentEnabled: false,
  });

  const refresh = async () => {
    setLoading(true);
    try {
      const [requestsRes, policiesRes, holidaysRes, encashmentRes] = await Promise.all([
        fetch('/api/tenant/leave/requests', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/tenant/leave/policies', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/tenant/holidays?includeArchived=1', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/tenant/leave/encashment-requests', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const requestsData = await requestsRes.json().catch(() => ({}));
      const policiesData = await policiesRes.json().catch(() => ({}));
      const holidaysData = await holidaysRes.json().catch(() => ({}));
      const encashmentData = await encashmentRes.json().catch(() => ({}));

      setLeaveRequests(Array.isArray(requestsData.requests) ? requestsData.requests : []);
      setLeavePolicies(Array.isArray(policiesData.policies) ? policiesData.policies : []);
      setHolidays(Array.isArray(holidaysData.holidays) ? holidaysData.holidays : []);
      setEncashmentRequests(Array.isArray(encashmentData.requests) ? encashmentData.requests : []);
    } catch (err: any) {
      setError(err.message || 'Could not load leave management data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleAction = async (requestId: number, action: 'approve' | 'reject') => {
    try {
      const res = await fetch(`/api/tenant/leave/requests/${requestId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update leave request.');
      setSuccess(`Request ${action === 'approve' ? 'approved' : 'rejected'}.`);
      refresh();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to action request.');
    }
  };

  const handleCreatePolicy = async () => {
    if (!policyForm.name.trim() || !policyForm.code.trim()) {
      setError('Policy name and code are required.');
      return;
    }
    setCreatingPolicy(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/leave/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(policyForm),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to create leave policy.');
      setSuccess(`"${policyForm.name}" policy created.`);
      setShowCreatePolicyModal(false);
      setPolicyForm({ name: '', code: '', maxDaysPerYear: 12, allowHalfDay: true, requiresApproval: true, accrualEnabled: false, carryForwardEnabled: false, maxCarryForwardDays: 0, encashmentEnabled: false });
      refresh();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to create leave policy.');
    } finally {
      setCreatingPolicy(false);
    }
  };

  const handleSeedDefaults = async () => {
    setSeedingDefaults(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/leave/policies/seed-defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to seed standard leave policies.');
      setSuccess(`Added ${data.policies?.length || 0} standard leave type(s).`);
      refresh();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to seed standard leave policies.');
    } finally {
      setSeedingDefaults(false);
    }
  };

  const pendingCount = leaveRequests.filter((r) => r.status === 'pending').length;
  const approvedCount = leaveRequests.filter((r) => r.status === 'approved').length;

  const metrics = [
    {
      label: 'Pending Approvals',
      value: pendingCount,
      change: pendingCount > 0 ? 'Requires Action' : 'All Clear',
      changeType: pendingCount > 0 ? ('negative' as const) : ('positive' as const),
      icon: Clock,
    },
    {
      label: 'Approved Leaves',
      value: approvedCount,
      subtext: 'Approved for current period',
      icon: CheckCircle2,
    },
    {
      label: 'Leave Policies',
      value: leavePolicies.length,
      subtext: 'Configured leave categories',
      icon: CalendarDays,
    },
    {
      label: 'Upcoming Holidays',
      value: holidays.length,
      subtext: 'Company calendar events',
      icon: Sun,
    },
  ];

  const tabs = [
    { id: 'pending_approvals', label: 'Pending Approvals Queue', count: pendingCount },
    { id: 'all_requests', label: 'All Leave Requests', count: leaveRequests.length },
    { id: 'holidays', label: 'Company Holidays', count: holidays.length },
    { id: 'policies', label: 'Leave Types & Policies', count: leavePolicies.length },
  ];

  const filteredRequests = useMemo(() => {
    return leaveRequests.filter((r) => {
      const q = search.trim().toLowerCase();
      const matchesSearch = !q || (r.userName || '').toLowerCase().includes(q) || (r.reason || '').toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
      const matchesTab = activeTab === 'pending_approvals' ? r.status === 'pending' : true;
      return matchesSearch && matchesStatus && matchesTab;
    });
  }, [leaveRequests, search, statusFilter, activeTab]);

  const filterControls = (
    <select
      value={statusFilter}
      onChange={(e) => setStatusFilter(e.target.value as any)}
      className="px-2.5 py-1.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-[var(--radius-nexus-control)] text-xs font-semibold text-[var(--color-nexus-ink)]"
    >
      <option value="all">All Request Statuses</option>
      <option value="pending">Pending</option>
      <option value="approved">Approved</option>
      <option value="rejected">Rejected</option>
    </select>
  );

  const mainContent = (
    <div className="p-4 md:p-5">
      {error && <div className="p-3 mb-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">{error}</div>}
      {success && <div className="p-3 mb-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">{success}</div>}

      {(activeTab === 'pending_approvals' || activeTab === 'all_requests') && (
        <div className="overflow-x-auto border border-[var(--color-nexus-border)] rounded-xl">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[var(--color-nexus-surface-alt)] border-b border-[var(--color-nexus-border)] text-[10.5px] font-mono font-bold text-[var(--color-nexus-muted)] uppercase tracking-wider">
                <th className="py-3 px-4">Employee</th>
                <th className="py-3 px-4">Leave Type</th>
                <th className="py-3 px-4">Duration / Dates</th>
                <th className="py-3 px-4">Reason</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)]">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs font-mono text-[var(--color-nexus-muted)]">
                    Loading leave requests...
                  </td>
                </tr>
              ) : filteredRequests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-[var(--color-nexus-muted)]">
                    No leave requests found for this filter.
                  </td>
                </tr>
              ) : (
                filteredRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-[var(--color-nexus-surface-alt)]/60 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-bold text-[var(--color-nexus-ink)]">{req.userName || 'Employee'}</div>
                      <div className="text-[11px] text-[var(--color-nexus-muted)]">{req.userEmail}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-semibold px-2 py-0.5 rounded bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] text-[11px]">
                        {req.leaveTypeName || 'Leave'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-[var(--color-nexus-ink)]">{req.startDate} to {req.endDate}</div>
                      <div className="text-[11px] text-[var(--color-nexus-muted)]">{req.daysCount || 1} day(s)</div>
                    </td>
                    <td className="py-3 px-4 max-w-xs truncate text-[var(--color-nexus-muted)]">
                      {req.reason || 'No reason specified'}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border ${
                        req.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                        req.status === 'rejected' ? 'bg-red-50 text-red-700 border-red-200' :
                        'bg-amber-50 text-amber-700 border-amber-200'
                      }`}>
                        {req.status?.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {req.status === 'pending' && (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleAction(req.id, 'approve')}
                            className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleAction(req.id, 'reject')}
                            className="px-2.5 py-1 rounded bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 text-[11px] font-bold transition-colors"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'policies' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h4 className="font-bold text-sm text-[var(--color-nexus-ink)]">Leave Types &amp; Policies</h4>
            <div className="flex items-center gap-2">
              {leavePolicies.length === 0 && (
                <button
                  type="button"
                  onClick={handleSeedDefaults}
                  disabled={seedingDefaults}
                  className="px-3 py-2 rounded-[var(--radius-nexus-control)] bg-[var(--color-nexus-surface-alt)] hover:bg-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] text-xs font-bold transition-colors disabled:opacity-50"
                >
                  {seedingDefaults ? 'Adding…' : 'Seed Standard Policies'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowCreatePolicyModal(true)}
                className="px-3 py-2 rounded-[var(--radius-nexus-control)] bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white text-xs font-bold transition-colors flex items-center gap-1.5"
              >
                <Plus size={14} /> Add Policy
              </button>
            </div>
          </div>

          {leavePolicies.length === 0 && (
            <div className="p-8 text-center bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl">
              <CalendarDays size={32} className="mx-auto text-[var(--color-nexus-muted)] mb-2" />
              <p className="text-sm font-bold text-[var(--color-nexus-ink)]">No leave types configured yet</p>
              <p className="text-xs text-[var(--color-nexus-muted)] mt-1 max-w-sm mx-auto">
                Employees can't request leave until at least one policy exists. Seed the standard starter set (Casual, Sick, Earned, LWP, Paternity, Sabbatical) or add your own.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {leavePolicies.map((pol, idx) => {
            const palette = POLICY_PALETTE[idx % POLICY_PALETTE.length];
            const Icon = palette.icon;
            return (
              <div key={pol.id} className="p-4 rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <div className={`p-2.5 rounded-lg ${palette.bg} ${palette.fg}`}>
                    <Icon size={20} />
                  </div>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)]">
                    {pol.code}
                  </span>
                </div>
                <div>
                  <h4 className="font-bold text-sm text-[var(--color-nexus-ink)]">{pol.name}</h4>
                  <p className="text-xs text-[var(--color-nexus-muted)] mt-1">Max Allowance: {pol.maxDaysPerYear || 12} days/year</p>
                </div>
              </div>
            );
          })}
          </div>
        </div>
      )}

      {activeTab === 'holidays' && (
        <div className="space-y-3">
          <h4 className="font-bold text-sm text-[var(--color-nexus-ink)]">Company Holiday Calendar</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {holidays.map((h) => (
              <div key={h.id} className="p-3.5 rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] shadow-xs flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-blue-50 text-blue-600 font-bold text-xs shrink-0 text-center">
                  <Sun size={18} />
                </div>
                <div>
                  <span className="font-bold text-xs text-[var(--color-nexus-ink)] block">{h.name}</span>
                  <span className="text-[11px] text-[var(--color-nexus-muted)] font-mono">{h.date}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCreatePolicyModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => !creatingPolicy && setShowCreatePolicyModal(false)}>
          <div className="nexus-card rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[var(--color-nexus-ink)]">Add Leave Policy</h3>
              <button type="button" onClick={() => setShowCreatePolicyModal(false)} className="p-1 text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]">
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-1">Name</label>
                <input
                  type="text"
                  value={policyForm.name}
                  onChange={(e) => setPolicyForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Casual Leave"
                  className="w-full px-3 py-2 border border-[var(--color-nexus-border)] rounded-lg text-sm"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-1">Code</label>
                <input
                  type="text"
                  value={policyForm.code}
                  onChange={(e) => setPolicyForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="e.g. CASUAL"
                  className="w-full px-3 py-2 border border-[var(--color-nexus-border)] rounded-lg text-sm font-mono"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-1">Max Days / Year</label>
                <input
                  type="number"
                  min={0}
                  value={policyForm.maxDaysPerYear}
                  onChange={(e) => setPolicyForm((f) => ({ ...f, maxDaysPerYear: Number(e.target.value) }))}
                  className="w-full px-3 py-2 border border-[var(--color-nexus-border)] rounded-lg text-sm"
                />
              </div>

              {[
                { key: 'allowHalfDay' as const, label: 'Allow half-day requests' },
                { key: 'requiresApproval' as const, label: 'Requires manager approval' },
                { key: 'accrualEnabled' as const, label: 'Accrues monthly (not available all at once)' },
                { key: 'carryForwardEnabled' as const, label: 'Unused days carry forward to next year' },
                { key: 'encashmentEnabled' as const, label: 'Employees can encash unused days for pay' },
              ].map(({ key, label }) => (
                <label key={key} className="col-span-2 flex items-center gap-2 text-xs text-[var(--color-nexus-ink)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={policyForm[key]}
                    onChange={(e) => setPolicyForm((f) => ({ ...f, [key]: e.target.checked }))}
                    className="w-4 h-4"
                  />
                  {label}
                </label>
              ))}

              {policyForm.carryForwardEnabled && (
                <div className="col-span-2">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-1">Max Carry-Forward Days</label>
                  <input
                    type="number"
                    min={0}
                    value={policyForm.maxCarryForwardDays}
                    onChange={(e) => setPolicyForm((f) => ({ ...f, maxCarryForwardDays: Number(e.target.value) }))}
                    className="w-full px-3 py-2 border border-[var(--color-nexus-border)] rounded-lg text-sm"
                  />
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCreatePolicyModal(false)}
                className="flex-1 bg-[var(--color-nexus-surface-alt)] hover:bg-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] font-bold text-xs uppercase tracking-wider py-3 rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreatePolicy}
                disabled={creatingPolicy}
                className="flex-1 bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white font-bold text-xs uppercase tracking-wider py-3 rounded-xl transition-all disabled:opacity-50"
              >
                {creatingPolicy ? 'Creating…' : 'Create Policy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const mainWorkspace = (
    <ManagementTemplate
      title="Leave Desk & Approval Workspace"
      subtitle="Operational hub for employee leave requests, approval routing queues, policies, and company holidays."
      badge="Leave Management"
      metrics={metrics}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      searchQuery={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search employee name or reason..."
      filterControls={filterControls}
    >
      {mainContent}
    </ManagementTemplate>
  );

  if (embedded) return mainWorkspace;

  return (
    <AdminWorkspaceLayout user={user} onLogout={onLogout}>
      {mainWorkspace}
    </AdminWorkspaceLayout>
  );
}
