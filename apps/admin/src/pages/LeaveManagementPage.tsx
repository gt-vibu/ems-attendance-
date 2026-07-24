import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDays, Users, Search, Grid3x3, List, Phone, Network, Plus, Trash2, X, Sun, HeartPulse, Baby, Briefcase, Info, PartyPopper, ArrowLeft } from 'lucide-react';
import type { User } from '../lib/auth';
import PortalShell from '../components/PortalShell';
import { getAdminPortalNavItems, routeForAdminNav } from '../lib/adminPortalNav';
import LeaveBalanceCards from '../components/LeaveBalanceCards';
import StatusPill from '../components/StatusPill';
import { downloadCsv } from '../lib/csv';
import DateSelect from '../components/DateSelect';

const STATUS_TONE = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
} as const;

const badgeClass = {
  pending: 'bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-secondary)]',
  approved: 'bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)]',
  rejected: 'bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)]',
} as const;

const AVATAR_PALETTE = ['bg-sky-500', 'bg-orange-500', 'bg-violet-500', 'bg-emerald-500', 'bg-pink-500', 'bg-indigo-500'];

// Zoho-style leave-type card row (Policy Catalog) — a distinct pastel icon
// color + icon per leave type, cycled by index, matching the reference
// design's Casual/Earned/LOP/Paternity/Sabbatical card row instead of a
// generic single-color grid.
const POLICY_PALETTE = [
  { bg: 'bg-blue-100', fg: 'text-blue-600', icon: CalendarDays },
  { bg: 'bg-emerald-100', fg: 'text-emerald-600', icon: Sun },
  { bg: 'bg-rose-100', fg: 'text-rose-600', icon: HeartPulse },
  { bg: 'bg-orange-100', fg: 'text-orange-600', icon: Baby },
  { bg: 'bg-yellow-100', fg: 'text-yellow-700', icon: Briefcase },
  { bg: 'bg-purple-100', fg: 'text-purple-600', icon: PartyPopper },
];
const initialsOf = (name: string) => (name || '?').split(' ').filter(Boolean).slice(0, 2).map((p: string) => p[0]?.toUpperCase()).join('');

const TOP_TABS = [
  { id: 'overview', label: 'Overview', icon: CalendarDays },
  { id: 'reportees', label: 'Reportees', icon: Users },
  { id: 'holidays', label: 'Holidays', icon: CalendarDays },
  { id: 'approval-queue', label: 'Approval Queue', icon: List },
] as const;

type TopTab = typeof TOP_TABS[number]['id'];

export default function LeaveManagementPage({ user, onLogout, embedded = false }: { user: User; onLogout: () => void; embedded?: boolean }) {
  const navigate = useNavigate();
  const token = localStorage.getItem('auth_token');
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  // Deep-link support: EmployeeDetailPanel's "View Leave History" link
  // arrives as /tenant/leave?tab=approval-queue&employee=<name> — land
  // directly on that employee's requests instead of the general catalog.
  const [activeTopTab, setActiveTopTab] = useState<TopTab>(() => (searchParams.get('tab') === 'approval-queue' ? 'approval-queue' : 'overview'));
  // Overview has three focused, single-purpose screens instead of cramming
  // the catalog + a form + everything else side by side: the default
  // catalog grid, a full-width "who applied for this leave type" drill-down
  // (click a policy card), and a full-width Create Policy screen (click
  // the header button) — never more than one at a time.
  const [overviewView, setOverviewView] = useState<'catalog' | 'policy-detail' | 'create-policy'>('catalog');
  const [selectedPolicy, setSelectedPolicy] = useState<any | null>(null);

  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
  const [leavePolicies, setLeavePolicies] = useState<any[]>([]);
  const [newLeavePolicyName, setNewLeavePolicyName] = useState('');
  const [newLeavePolicyCode, setNewLeavePolicyCode] = useState('');
  const [newLeavePolicyMaxDays, setNewLeavePolicyMaxDays] = useState('12');
  const [newLeavePolicyDeductionPercent, setNewLeavePolicyDeductionPercent] = useState('100');
  const [newLeavePolicyAllowHalfDay, setNewLeavePolicyAllowHalfDay] = useState(true);
  const [newLeavePolicyRequiresApproval, setNewLeavePolicyRequiresApproval] = useState(true);
  const [newLeavePolicyMedicalNoticeDays, setNewLeavePolicyMedicalNoticeDays] = useState('0');
  const [newLeavePolicyAccrualEnabled, setNewLeavePolicyAccrualEnabled] = useState(false);
  const [newLeavePolicyCarryForwardEnabled, setNewLeavePolicyCarryForwardEnabled] = useState(false);
  const [newLeavePolicyMaxCarryForwardDays, setNewLeavePolicyMaxCarryForwardDays] = useState('0');
  const [newLeavePolicyEncashmentEnabled, setNewLeavePolicyEncashmentEnabled] = useState(false);
  const [requestSearch, setRequestSearch] = useState(() => searchParams.get('employee') || '');
  const [requestStatusFilter, setRequestStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<number>>(new Set());

  // Leave adjustments state variables
  const [users, setUsers] = useState<any[]>([]);
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [adjUserId, setAdjUserId] = useState('');
  const [adjLeaveType, setAdjLeaveType] = useState('');
  const [adjDays, setAdjDays] = useState('');
  const [adjReason, setAdjReason] = useState('');

  // Reportees tab state
  const [employees, setEmployees] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [teamScope, setTeamScope] = useState<'direct' | 'all'>('all');
  const [teamView, setTeamView] = useState<'grid' | 'list'>('grid');
  const [teamSearch, setTeamSearch] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [selectedEmployeeBalances, setSelectedEmployeeBalances] = useState<any[] | null>(null);
  const [selectedEmployeeLoading, setSelectedEmployeeLoading] = useState(false);

  // Holidays tab state
  const [holidays, setHolidays] = useState<any[]>([]);
  const [holidaysLoading, setHolidaysLoading] = useState(true);
  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [newHolidayName, setNewHolidayName] = useState('');
  const canManageHolidays = user.role === 'tenant_admin' || user.role === 'super_admin';
  const [encashmentRequests, setEncashmentRequests] = useState<any[]>([]);
  const [encashmentActioning, setEncashmentActioning] = useState<number | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const [requestsRes, policiesRes, usersRes, adjustmentsRes, employeesRes, analyticsRes, encashmentRes] = await Promise.all([
        fetch('/api/tenant/leave/requests', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/tenant/leave/policies', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/tenant/users', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/tenant/leave/adjustments', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/tenant/employees', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/tenant/analytics', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/tenant/leave/encashment-requests', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const requestsData = await requestsRes.json().catch(() => ({}));
      const policiesData = await policiesRes.json().catch(() => ({}));
      const usersData = await usersRes.json().catch(() => ({}));
      const adjustmentsData = await adjustmentsRes.json().catch(() => ({}));
      const employeesData = await employeesRes.json().catch(() => ({}));
      const analyticsData = await analyticsRes.json().catch(() => ({}));
      const encashmentData = await encashmentRes.json().catch(() => ({}));

      if (!requestsRes.ok && !policiesRes.ok) {
        throw new Error(requestsData.error || policiesData.error || 'Could not load leave management data.');
      }
      setLeaveRequests(Array.isArray(requestsData.requests) ? requestsData.requests : []);
      setLeavePolicies(Array.isArray(policiesData.policies) ? policiesData.policies : []);
      setUsers(Array.isArray(usersData.users) ? usersData.users : []);
      setAdjustments(Array.isArray(adjustmentsData.adjustments) ? adjustmentsData.adjustments : []);
      setEmployees(Array.isArray(employeesData.employees) ? employeesData.employees : []);
      if (analyticsRes.ok) setAnalytics(analyticsData);
      if (encashmentRes.ok) setEncashmentRequests(Array.isArray(encashmentData.requests) ? encashmentData.requests : []);
    } catch (err: any) {
      setError(err.message || 'Could not load leave management data.');
    } finally {
      setLoading(false);
    }
  };

  const handleEncashmentAction = async (requestId: number, action: 'approve' | 'reject') => {
    setEncashmentActioning(requestId);
    try {
      const res = await fetch('/api/tenant/leave/encashment-requests/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestId, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to resolve request.');
      setSuccess(`Encashment request ${action === 'approve' ? 'approved' : 'rejected'}.`);
      await refresh();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to resolve request.');
    } finally {
      setEncashmentActioning(null);
    }
  };

  const refreshHolidays = async () => {
    setHolidaysLoading(true);
    try {
      const res = await fetch('/api/tenant/holidays', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load holidays.');
      setHolidays(Array.isArray(data.holidays) ? data.holidays : []);
    } catch (err: any) {
      setError(err.message || 'Could not load holidays.');
    } finally {
      setHolidaysLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    refreshHolidays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const metrics = useMemo(() => ({
    policies: leavePolicies.length,
    pending: leaveRequests.filter((row) => row.status === 'pending').length,
    approved: leaveRequests.filter((row) => row.status === 'approved').length,
    rejected: leaveRequests.filter((row) => row.status === 'rejected').length,
  }), [leavePolicies, leaveRequests]);

  const filteredRequests = useMemo(() => {
    const query = requestSearch.trim().toLowerCase();
    return leaveRequests.filter((request) => {
      const matchesStatus = requestStatusFilter === 'all' || request.status === requestStatusFilter;
      if (!matchesStatus) return false;
      if (!query) return true;
      const haystack = [
        request.employeeName,
        request.employeeEmail,
        request.department,
        request.role,
        request.leaveType,
        request.reason,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [leaveRequests, requestSearch, requestStatusFilter]);

  const requestsForSelectedPolicy = useMemo(() => {
    if (!selectedPolicy) return [];
    return leaveRequests.filter((r) => r.leaveType === selectedPolicy.code || r.leaveType === selectedPolicy.name);
  }, [leaveRequests, selectedPolicy]);

  const pendingDeductionDays = useMemo(() => leaveRequests
    .filter((row) => row.status === 'pending')
    .reduce((sum, row) => sum + Number(row.totalDays || 0), 0), [leaveRequests]);

  // Reportees derived data: who reports to whom, and today's live status per
  // person, sourced from the same tenantAnalytics.breakdown pattern used by
  // Dashboard.tsx's "Your Team" section — no fabricated statuses.
  const myDirectReports = useMemo(() => employees.filter((e: any) => e.managerId === user.id), [employees, user.id]);
  const teamRoster = useMemo(() => {
    const base = teamScope === 'direct' ? myDirectReports : employees;
    const query = teamSearch.trim().toLowerCase();
    if (!query) return base;
    return base.filter((e: any) => [e.name, e.department, e.designation, e.role].filter(Boolean).join(' ').toLowerCase().includes(query));
  }, [employees, myDirectReports, teamScope, teamSearch]);

  const statusFor = (employeeId: number): { label: string; tone: 'success' | 'gold' | 'danger' | 'muted' } => {
    const bd = analytics?.breakdown;
    if (!bd) return { label: 'Status unavailable', tone: 'muted' };
    if (bd.late?.some((p: any) => p.userId === employeeId)) return { label: 'Late Check-in', tone: 'gold' };
    if (bd.present?.some((p: any) => p.userId === employeeId)) return { label: 'Present', tone: 'success' };
    return { label: 'Yet to check-in', tone: 'danger' };
  };

  const openEmployeeBalances = async (employee: any) => {
    setSelectedEmployee(employee);
    setSelectedEmployeeBalances(null);
    setSelectedEmployeeLoading(true);
    try {
      const res = await fetch(`/api/tenant/employees/${employee.id}/leave-balance`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load leave balance.');
      setSelectedEmployeeBalances(Array.isArray(data.balances) ? data.balances : []);
    } catch (err: any) {
      setError(err.message || 'Could not load leave balance.');
    } finally {
      setSelectedEmployeeLoading(false);
    }
  };

  const handleCreatePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/leave/policies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newLeavePolicyName,
          code: newLeavePolicyCode,
          maxDaysPerYear: parseFloat(newLeavePolicyMaxDays) || 0,
          allowHalfDay: newLeavePolicyAllowHalfDay,
          requiresApproval: newLeavePolicyRequiresApproval,
          medicalOnlyNoAdvanceNoticeDays: parseFloat(newLeavePolicyMedicalNoticeDays) || 0,
          defaultDeductionPercent: parseFloat(newLeavePolicyDeductionPercent) || 100,
          accrualEnabled: newLeavePolicyAccrualEnabled,
          carryForwardEnabled: newLeavePolicyCarryForwardEnabled,
          maxCarryForwardDays: parseFloat(newLeavePolicyMaxCarryForwardDays) || 0,
          encashmentEnabled: newLeavePolicyEncashmentEnabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create leave policy.');
      setNewLeavePolicyName('');
      setNewLeavePolicyCode('');
      setNewLeavePolicyMaxDays('12');
      setNewLeavePolicyDeductionPercent('100');
      setNewLeavePolicyAllowHalfDay(true);
      setNewLeavePolicyRequiresApproval(true);
      setNewLeavePolicyMedicalNoticeDays('0');
      setNewLeavePolicyAccrualEnabled(false);
      setNewLeavePolicyCarryForwardEnabled(false);
      setNewLeavePolicyMaxCarryForwardDays('0');
      setNewLeavePolicyEncashmentEnabled(false);
      setSuccess('Leave policy created.');
      await refresh();
      setOverviewView('catalog');
      setTimeout(() => setSuccess(''), 2500);
    } catch (err: any) {
      setError(err.message || 'Failed to create leave policy.');
    } finally {
      setSaving(false);
    }
  };

  const handleResolveLeaveRequest = async (requestId: number, action: 'approve' | 'reject') => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/leave/requests/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ requestId, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update leave request.');
      setSuccess(`Leave request ${action === 'approve' ? 'approved' : 'rejected'}.`);
      await refresh();
      setTimeout(() => setSuccess(''), 2500);
    } catch (err: any) {
      setError(err.message || 'Failed to update leave request.');
    } finally {
      setSaving(false);
    }
  };

  const handleBulkResolveLeaveRequests = async (action: 'approve' | 'reject') => {
    const requestIds = Array.from(selectedRequestIds);
    if (requestIds.length === 0) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/leave/requests/bulk-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestIds, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update leave requests.');
      setSuccess(`${data.updated} request(s) ${action === 'approve' ? 'approved' : 'rejected'}${data.failed ? `, ${data.failed} skipped` : ''}.`);
      setSelectedRequestIds(new Set());
      await refresh();
      setTimeout(() => setSuccess(''), 3500);
    } catch (err: any) {
      setError(err.message || 'Failed to update leave requests.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjUserId || !adjLeaveType || !adjDays || !adjReason.trim()) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/leave/adjustments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: parseInt(adjUserId, 10),
          leaveType: adjLeaveType,
          adjustmentDays: parseFloat(adjDays),
          reason: adjReason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create adjustment.');

      setAdjUserId('');
      setAdjLeaveType('');
      setAdjDays('');
      setAdjReason('');
      setSuccess('Leave balance adjusted successfully.');
      await refresh();
      setTimeout(() => setSuccess(''), 2500);
    } catch (err: any) {
      setError(err.message || 'Failed to create adjustment.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHolidayDate || !newHolidayName.trim()) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ date: newHolidayDate, name: newHolidayName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add holiday.');
      setNewHolidayDate('');
      setNewHolidayName('');
      setSuccess('Holiday added.');
      await refreshHolidays();
      setTimeout(() => setSuccess(''), 2500);
    } catch (err: any) {
      setError(err.message || 'Failed to add holiday.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteHoliday = async (id: number) => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/tenant/holidays/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to delete holiday.');
      setSuccess('Holiday removed.');
      await refreshHolidays();
      setTimeout(() => setSuccess(''), 2500);
    } catch (err: any) {
      setError(err.message || 'Failed to delete holiday.');
    } finally {
      setSaving(false);
    }
  };

  const content = (
    <>
      {error && <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-4 rounded-xl mb-6 border border-[var(--color-nexus-error)]/20 font-medium">{error}</div>}
      {success && <div className="bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)] text-xs p-4 rounded-xl mb-6 border border-[color:var(--color-nexus-success-text)]/20 font-medium">{success}</div>}

      {/* Top-level tab pills — same visual pattern as the Organization
          Dashboard / Self Service toggle on Dashboard.tsx, reused here so the
          two "portal-within-a-portal" areas of the app read as one system. */}
      <div className="flex bg-[var(--color-nexus-surface-alt)] p-1 rounded-full border border-[var(--color-nexus-border)] w-fit mb-6 shadow-sm overflow-x-auto">
        {TOP_TABS.map((tabDef) => {
          const Icon = tabDef.icon;
          return (
            <button
              key={tabDef.id}
              type="button"
              onClick={() => setActiveTopTab(tabDef.id)}
              className={`px-5 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap ${activeTopTab === tabDef.id ? 'bg-[var(--color-nexus-primary)] text-white shadow-sm' : 'text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]'}`}
            >
              <Icon size={13} className="inline-block mr-1.5 align-middle" />
              {tabDef.label}
              {tabDef.id === 'approval-queue' && metrics.pending > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-white/25 px-1.5 text-[10px]">{metrics.pending}</span>
              )}
            </button>
          );
        })}
      </div>

      {activeTopTab === 'overview' && (
        <div className="space-y-6">
          {overviewView === 'catalog' && (
            <>
              <section className="rounded-[28px] border border-[var(--color-nexus-border)] bg-gradient-to-r from-[var(--color-nexus-primary-fixed)] via-white/80 to-[var(--color-nexus-secondary-container)] p-6">
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <h2 className="font-sans text-2xl font-bold text-[var(--color-nexus-ink)]">Professional Leave Desk</h2>
                    <p className="mt-2 max-w-2xl text-sm text-[var(--color-nexus-muted)]">Create clear leave policies, review approval queues, and keep annual deduction rules visible in one focused workspace instead of a crammed dashboard card.</p>
                  </div>
                  <button
                    onClick={() => setOverviewView('create-policy')}
                    className="shrink-0 rounded-xl bg-[var(--color-nexus-primary)] px-4 py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--color-nexus-primary-hover)]"
                  >
                    Create Policy
                  </button>
                </div>
              </section>

              <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
                {[
                  ['Leave Policies', metrics.policies, 'Configured policy types available to staff.'],
                  ['Pending Requests', metrics.pending, 'Requests waiting for an approver action.'],
                  ['Approved', metrics.approved, 'Requests already cleared for payroll and attendance.'],
                  ['Rejected', metrics.rejected, 'Requests declined with no deduction reversal.'],
                ].map(([label, value, note]) => (
                  <div key={String(label)} className="nexus-card rounded-3xl p-5">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">{label}</span>
                    <span className="mt-2 block text-3xl font-black text-[var(--color-nexus-ink)]">{value}</span>
                    <p className="mt-2 text-xs leading-relaxed text-[var(--color-nexus-muted)]">{note}</p>
                  </div>
                ))}
              </section>

              <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="nexus-card rounded-3xl p-5">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Approval Workbench</span>
                  <h3 className="mt-2 font-sans text-xl font-bold text-[var(--color-nexus-ink)]">Keep policy pressure visible</h3>
                  <p className="mt-2 text-sm text-[var(--color-nexus-muted)]">Pending requests currently represent <span className="font-bold text-[var(--color-nexus-ink)]">{pendingDeductionDays}</span> leave day(s) waiting to be finalized for attendance and payroll.</p>
                </div>
                <div className="nexus-card rounded-3xl p-5">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">EMS-style Controls</span>
                  <p className="mt-2 text-sm text-[var(--color-nexus-muted)]">Half-day rules, approval routing, medical short-notice handling, and searchable approval queues now behave more like a serious HR workspace.</p>
                </div>
              </section>
            </>
          )}

          {overviewView === 'catalog' && (
          <section className="grid grid-cols-1 gap-6 items-start">
            <div className="nexus-card rounded-3xl p-6">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <h3 className="font-sans text-lg font-bold text-[var(--color-nexus-ink)]">Policy Catalog</h3>
                  <p className="mt-1 text-xs text-[var(--color-nexus-muted)]">Yearly entitlement and deduction rules for every leave type, at a glance.</p>
                </div>
                {!loading && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={async () => {
                      setSaving(true);
                      setError('');
                      try {
                        const res = await fetch('/api/tenant/leave/policies/seed-defaults', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) throw new Error(data.error || 'Could not load standard leave types.');
                        await refresh();
                      } catch (err: any) {
                        setError(err.message || 'Could not load standard leave types.');
                      } finally {
                        setSaving(false);
                      }
                    }}
                    className="shrink-0 rounded-xl border border-[var(--color-nexus-primary)] px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-fixed)] disabled:opacity-50 whitespace-nowrap"
                  >
                    {saving ? 'Loading…' : '+ Load Standard Types'}
                  </button>
                )}
              </div>

              {loading ? (
                <div className="py-16 text-center text-sm text-[var(--color-nexus-muted)]">Loading leave policies…</div>
              ) : leavePolicies.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-[var(--color-nexus-border)] p-12 text-center text-sm text-[var(--color-nexus-muted)]">
                  No leave policies yet. Start by creating your first policy on the right, or click "+ Load Standard Types" above for a starter set (Casual, Sick, Earned, Leave Without Pay, Paternity, Sabbatical).
                </div>
              ) : (
                // Horizontally-scrolling row of leave-type cards (Zoho
                // People's Leave Summary layout) instead of a 2-column grid —
                // each card gets its own pastel icon-square color, then two
                // stat rows. For the admin's tenant-wide catalog view (not a
                // specific employee's balance), "Available"/"Booked" doesn't
                // apply per-policy, so this shows the admin-relevant Yearly
                // Days / Deduction % numbers instead, in the same card shape.
                <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1">
                  {leavePolicies.map((policy: any, i: number) => {
                    const palette = POLICY_PALETTE[i % POLICY_PALETTE.length];
                    const PolicyIcon = palette.icon;
                    const requestCount = leaveRequests.filter((r) => r.leaveType === policy.code || r.leaveType === policy.name).length;
                    return (
                      <button
                        type="button"
                        key={policy.id}
                        onClick={() => { setSelectedPolicy(policy); setOverviewView('policy-detail'); }}
                        className="shrink-0 w-60 text-left rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-bg)] p-4 hover:border-[var(--color-nexus-primary)] hover:shadow-md transition-all cursor-pointer"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className={`w-10 h-10 rounded-xl ${palette.bg} ${palette.fg} flex items-center justify-center`}>
                            <PolicyIcon size={18} />
                          </div>
                          <span className="rounded-full bg-[var(--color-nexus-primary-fixed)] px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-[var(--color-nexus-primary)]">
                            {policy.requiresApproval === false ? 'Auto' : 'Approval'}
                          </span>
                        </div>
                        <h4 className="mt-3 text-sm font-bold text-[var(--color-nexus-ink)] truncate" title={policy.name}>{policy.name}</h4>
                        <p className="text-[10px] uppercase tracking-wider text-[var(--color-nexus-muted)]">{policy.code}</p>
                        <div className="mt-3 flex items-center justify-between text-xs">
                          <span className="text-[var(--color-nexus-muted)]">Yearly Days</span>
                          <strong className="text-[var(--color-nexus-success-text)]">{policy.maxDaysPerYear}</strong>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-xs">
                          <span className="text-[var(--color-nexus-muted)]">Deduction</span>
                          <span className="flex items-center gap-1">
                            <strong className="text-[var(--color-nexus-ink)]">{policy.defaultDeductionPercent}%</strong>
                            <Info size={11} className="text-[var(--color-nexus-muted)] shrink-0" aria-label="Policy rules">
                              <title>{`${policy.allowHalfDay ? 'Half-day allowed' : 'Full-day only'}${policy.medicalOnlyNoAdvanceNoticeDays ? ` · medical exception window: ${policy.medicalOnlyNoAdvanceNoticeDays}d` : ''}`}</title>
                            </Info>
                          </span>
                        </div>
                        <div className="mt-3 pt-3 border-t border-[var(--color-nexus-border)] text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-primary)]">
                          {requestCount} request{requestCount === 1 ? '' : 's'} →
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Upcoming Leaves & Holidays — matches Zoho's section below the
                  leave-type card row. Reuses the same `holidays` list already
                  fetched for the Holidays tab (no new endpoint), filtered to
                  future dates. Honest empty state when there's nothing
                  upcoming, no fabricated placeholder rows. */}
              <div className="mt-6 border-t border-[var(--color-nexus-border)] pt-5">
                <h4 className="text-sm font-bold text-[var(--color-nexus-ink)]">Upcoming Leaves &amp; Holidays</h4>
                {(() => {
                  const todayStr = new Date().toISOString().slice(0, 10);
                  const upcoming = holidays
                    .filter((h: any) => String(h.date).slice(0, 10) >= todayStr)
                    .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)))
                    .slice(0, 5);
                  if (holidaysLoading) {
                    return <div className="py-8 text-center text-sm text-[var(--color-nexus-muted)]">Loading…</div>;
                  }
                  if (upcoming.length === 0) {
                    return (
                      <div className="py-8 flex flex-col items-center justify-center gap-2 text-center">
                        <PartyPopper size={22} className="text-[var(--color-nexus-muted)]" />
                        <p className="text-sm text-[var(--color-nexus-muted)]">No Data Found</p>
                      </div>
                    );
                  }
                  return (
                    <div className="mt-3 space-y-2">
                      {upcoming.map((h: any) => (
                        <div key={h.id} className="flex items-center gap-3 rounded-xl bg-[var(--color-nexus-surface-alt)] px-4 py-2.5">
                          <span className="shrink-0 rounded-lg bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] text-[11px] font-bold px-2.5 py-1">
                            {new Date(`${h.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </span>
                          <span className="text-sm text-[var(--color-nexus-ink)] truncate">{h.name}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </section>
          )}

          {/* Policy detail — full-width drill-down for "who applied for
              this leave type, and what's the status", opened by clicking a
              Policy Catalog card. Pending rows are actionable right here
              (reuses the same approve/reject handler as the Approval Queue
              tab) instead of forcing a second trip to find them. */}
          {overviewView === 'policy-detail' && selectedPolicy && (() => {
            const palette = POLICY_PALETTE[leavePolicies.findIndex((p: any) => p.id === selectedPolicy.id) % POLICY_PALETTE.length] || POLICY_PALETTE[0];
            const PolicyIcon = palette.icon;
            return (
              <div className="space-y-5">
                <button type="button" onClick={() => { setOverviewView('catalog'); setSelectedPolicy(null); }} className="flex items-center gap-1.5 text-xs font-bold text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]">
                  <ArrowLeft size={14} /> Back to Policy Catalog
                </button>
                <section className="nexus-card rounded-3xl p-6">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl ${palette.bg} ${palette.fg} flex items-center justify-center shrink-0`}>
                      <PolicyIcon size={20} />
                    </div>
                    <div>
                      <h2 className="font-sans text-xl font-bold text-[var(--color-nexus-ink)]">{selectedPolicy.name}</h2>
                      <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">{selectedPolicy.code} · {selectedPolicy.maxDaysPerYear} day(s)/year · {selectedPolicy.defaultDeductionPercent}% deduction · {selectedPolicy.requiresApproval === false ? 'Auto-approved' : 'Needs approval'}</p>
                    </div>
                  </div>
                </section>

                <section className="nexus-card rounded-3xl p-6">
                  <h3 className="font-sans text-lg font-bold text-[var(--color-nexus-ink)] mb-4">Requests for {selectedPolicy.name} <span className="text-[var(--color-nexus-muted)] font-normal text-sm">({requestsForSelectedPolicy.length})</span></h3>
                  {requestsForSelectedPolicy.length === 0 ? (
                    <div className="rounded-3xl border border-dashed border-[var(--color-nexus-border)] p-12 text-center text-sm text-[var(--color-nexus-muted)]">No one has applied for this leave type yet.</div>
                  ) : (
                    <div className="space-y-3">
                      {requestsForSelectedPolicy.map((request: any) => (
                        <div key={request.id} className="rounded-3xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-5 py-4">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="text-sm font-bold text-[var(--color-nexus-ink)]">{request.employeeName}</h4>
                                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${badgeClass[(request.status || 'pending') as keyof typeof badgeClass] || badgeClass.pending}`}>
                                  {request.status}
                                </span>
                              </div>
                              <p className="text-xs text-[var(--color-nexus-muted)]">{[request.employeeEmail, request.department, request.role].filter(Boolean).join(' • ')}</p>
                              <p className="text-xs text-[var(--color-nexus-muted)]">{request.startDate} to {request.endDate} • {request.totalDays} day(s)</p>
                              <p className="text-xs text-[var(--color-nexus-muted)]">{request.reason}</p>
                            </div>
                            {request.status === 'pending' && (
                              <div className="flex shrink-0 items-center gap-2">
                                <button
                                  onClick={() => handleResolveLeaveRequest(request.id, 'approve')}
                                  disabled={saving}
                                  className="rounded-xl bg-[var(--color-nexus-success-text)] px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-white hover:brightness-110 disabled:opacity-50"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => handleResolveLeaveRequest(request.id, 'reject')}
                                  disabled={saving}
                                  className="rounded-xl bg-[var(--color-nexus-error)] px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-white hover:brightness-110 disabled:opacity-50"
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            );
          })()}

          {/* Create Policy — its own full-width screen instead of a
              cramped sidebar column squeezed next to the catalog. */}
          {overviewView === 'create-policy' && (
            <div className="space-y-5">
              <button type="button" onClick={() => setOverviewView('catalog')} className="flex items-center gap-1.5 text-xs font-bold text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]">
                <ArrowLeft size={14} /> Back to Policy Catalog
              </button>
              <section className="nexus-card rounded-3xl p-6 max-w-xl">
                <h3 className="font-sans text-lg font-bold text-[var(--color-nexus-ink)]">Create Leave Policy</h3>
                <p className="mt-1 text-xs text-[var(--color-nexus-muted)]">Define a new leave type with its yearly entitlement and rules.</p>
                <form onSubmit={handleCreatePolicy} className="mt-5 space-y-4">
                  <div>
                    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Policy Name</label>
                    <input value={newLeavePolicyName} onChange={(e) => setNewLeavePolicyName(e.target.value)} placeholder="Earned Leave" className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm focus:outline-none" required />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Policy Code</label>
                    <input value={newLeavePolicyCode} onChange={(e) => setNewLeavePolicyCode(e.target.value.toUpperCase())} placeholder="EL" className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm focus:outline-none" required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Days / Year</label>
                      <input type="number" min="0" step="0.5" value={newLeavePolicyMaxDays} onChange={(e) => setNewLeavePolicyMaxDays(e.target.value)} className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm focus:outline-none" required />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Deduction %</label>
                      <input type="number" min="0" max="100" step="1" value={newLeavePolicyDeductionPercent} onChange={(e) => setNewLeavePolicyDeductionPercent(e.target.value)} className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm focus:outline-none" required />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Short-Notice Medical Window</label>
                    <input type="number" min="0" step="1" value={newLeavePolicyMedicalNoticeDays} onChange={(e) => setNewLeavePolicyMedicalNoticeDays(e.target.value)} className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm focus:outline-none" />
                    <p className="mt-1 text-[11px] text-[var(--color-nexus-muted)]">Use `0` if no medical exception window is needed.</p>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    <label className="flex items-center justify-between rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3">
                      <span>
                        <span className="block text-xs font-bold text-[var(--color-nexus-ink)]">Allow half-day booking</span>
                        <span className="block text-[11px] text-[var(--color-nexus-muted)]">Good for casual and medical leave cases.</span>
                      </span>
                      <input type="checkbox" checked={newLeavePolicyAllowHalfDay} onChange={(e) => setNewLeavePolicyAllowHalfDay(e.target.checked)} className="h-4 w-4" />
                    </label>
                    <label className="flex items-center justify-between rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3">
                      <span>
                        <span className="block text-xs font-bold text-[var(--color-nexus-ink)]">Require approval</span>
                        <span className="block text-[11px] text-[var(--color-nexus-muted)]">Disable only for auto-approved policy types.</span>
                      </span>
                      <input type="checkbox" checked={newLeavePolicyRequiresApproval} onChange={(e) => setNewLeavePolicyRequiresApproval(e.target.checked)} className="h-4 w-4" />
                    </label>
                    <label className="flex items-center justify-between rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3">
                      <span>
                        <span className="block text-xs font-bold text-[var(--color-nexus-ink)]">Accrue monthly instead of granting the full year upfront</span>
                        <span className="block text-[11px] text-[var(--color-nexus-muted)]">1/12th of the annual entitlement becomes available at the start of each month.</span>
                      </span>
                      <input type="checkbox" checked={newLeavePolicyAccrualEnabled} onChange={(e) => setNewLeavePolicyAccrualEnabled(e.target.checked)} className="h-4 w-4" />
                    </label>
                    <label className="flex items-center justify-between rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3">
                      <span>
                        <span className="block text-xs font-bold text-[var(--color-nexus-ink)]">Allow carry-forward into next year</span>
                        <span className="block text-[11px] text-[var(--color-nexus-muted)]">Unused days roll into next year (one year only), up to the cap below.</span>
                      </span>
                      <input type="checkbox" checked={newLeavePolicyCarryForwardEnabled} onChange={(e) => setNewLeavePolicyCarryForwardEnabled(e.target.checked)} className="h-4 w-4" />
                    </label>
                    {newLeavePolicyCarryForwardEnabled && (
                      <div>
                        <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Max Carry-Forward Days</label>
                        <input type="number" min="0" step="0.5" value={newLeavePolicyMaxCarryForwardDays} onChange={(e) => setNewLeavePolicyMaxCarryForwardDays(e.target.value)} className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm focus:outline-none" />
                      </div>
                    )}
                    <label className="flex items-center justify-between rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3">
                      <span>
                        <span className="block text-xs font-bold text-[var(--color-nexus-ink)]">Allow encashment</span>
                        <span className="block text-[11px] text-[var(--color-nexus-muted)]">Employees can request to convert unused days of this type into pay.</span>
                      </span>
                      <input type="checkbox" checked={newLeavePolicyEncashmentEnabled} onChange={(e) => setNewLeavePolicyEncashmentEnabled(e.target.checked)} className="h-4 w-4" />
                    </label>
                  </div>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setOverviewView('catalog')} className="flex-1 rounded-2xl border border-[var(--color-nexus-border)] py-3 text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-ink)] hover:bg-[var(--color-nexus-surface-alt)]">
                      Cancel
                    </button>
                    <button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[var(--color-nexus-primary)] py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--color-nexus-primary-hover)] disabled:opacity-50">
                      {saving ? 'Saving…' : 'Save Leave Policy'}
                    </button>
                  </div>
                </form>
              </section>
            </div>
          )}
        </div>
      )}

      {activeTopTab === 'reportees' && (
        <div className="space-y-6">
          <section className="nexus-card rounded-3xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[var(--color-nexus-primary)] text-white flex items-center justify-center text-sm font-bold">
                  {initialsOf(user.name || user.email)}
                </div>
                <div>
                  <span className="block text-sm font-bold text-[var(--color-nexus-ink)]">{user.name || user.email}</span>
                  <span className="block text-[11px] text-[var(--color-nexus-muted)]">Viewing your reporting structure</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex rounded-full border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] p-1">
                  <button
                    type="button"
                    onClick={() => setTeamScope('direct')}
                    className={`px-3.5 py-1.5 rounded-full text-[11px] font-bold transition-colors ${teamScope === 'direct' ? 'bg-[var(--color-nexus-primary)] text-white' : 'text-[var(--color-nexus-muted)]'}`}
                  >
                    Direct {myDirectReports.length}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTeamScope('all')}
                    className={`px-3.5 py-1.5 rounded-full text-[11px] font-bold transition-colors ${teamScope === 'all' ? 'bg-[var(--color-nexus-primary)] text-white' : 'text-[var(--color-nexus-muted)]'}`}
                  >
                    All {employees.length}
                  </button>
                </div>
                <div className="flex rounded-full border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] p-1">
                  <button type="button" onClick={() => setTeamView('grid')} className={`p-1.5 rounded-full ${teamView === 'grid' ? 'bg-[var(--color-nexus-primary)] text-white' : 'text-[var(--color-nexus-muted)]'}`}>
                    <Grid3x3 size={14} />
                  </button>
                  <button type="button" onClick={() => setTeamView('list')} className={`p-1.5 rounded-full ${teamView === 'list' ? 'bg-[var(--color-nexus-primary)] text-white' : 'text-[var(--color-nexus-muted)]'}`}>
                    <List size={14} />
                  </button>
                </div>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-nexus-muted)]" />
                  <input
                    value={teamSearch}
                    onChange={(e) => setTeamSearch(e.target.value)}
                    placeholder="Search"
                    className="rounded-full border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] pl-8 pr-3 py-1.5 text-xs focus:outline-none w-36"
                  />
                </div>
              </div>
            </div>
          </section>

          {loading ? (
            <div className="py-16 text-center text-sm text-[var(--color-nexus-muted)]">Loading reportees…</div>
          ) : teamRoster.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-[var(--color-nexus-border)] p-12 text-center text-sm text-[var(--color-nexus-muted)]">
              {teamScope === 'direct' ? 'No one reports directly to you yet.' : 'No employees found.'}
            </div>
          ) : teamView === 'grid' ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {teamRoster.map((employee: any, i: number) => {
                const status = statusFor(employee.id);
                const toneClass = {
                  success: 'text-[var(--color-nexus-success-text)]',
                  gold: 'text-[var(--color-nexus-secondary)]',
                  danger: 'text-[var(--color-nexus-error)]',
                  muted: 'text-[var(--color-nexus-muted)]',
                }[status.tone];
                return (
                  <button
                    key={employee.id}
                    type="button"
                    onClick={() => openEmployeeBalances(employee)}
                    className="text-left nexus-card rounded-3xl p-5 hover:bg-[var(--color-nexus-primary-fixed)]/20 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-11 h-11 shrink-0 rounded-full ${AVATAR_PALETTE[i % AVATAR_PALETTE.length]} text-white flex items-center justify-center text-sm font-bold`}>
                        {initialsOf(employee.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="block text-sm font-bold text-[var(--color-nexus-ink)] truncate">
                          {employee.id ? `#${employee.id} · ` : ''}{employee.name}
                        </span>
                        <span className={`block text-[11px] font-bold ${toneClass}`}>{status.label}</span>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-3 text-[var(--color-nexus-muted)]">
                      <Phone size={14} />
                      <Network size={14} />
                      <span className="text-[11px] truncate">{employee.department || 'Unassigned'}</span>
                    </div>
                    <div className="mt-3 border-t border-[var(--color-nexus-border)] pt-3 text-[11px] text-[var(--color-nexus-muted)]">
                      {employee.shiftName || 'No shift assigned'}
                      {employee.shiftCheckIn && employee.shiftCheckOut ? ` - ${employee.shiftCheckIn} - ${employee.shiftCheckOut}` : ''}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="nexus-card rounded-3xl p-2">
              {teamRoster.map((employee: any, i: number) => {
                const status = statusFor(employee.id);
                const toneClass = {
                  success: 'text-[var(--color-nexus-success-text)]',
                  gold: 'text-[var(--color-nexus-secondary)]',
                  danger: 'text-[var(--color-nexus-error)]',
                  muted: 'text-[var(--color-nexus-muted)]',
                }[status.tone];
                return (
                  <button
                    key={employee.id}
                    type="button"
                    onClick={() => openEmployeeBalances(employee)}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl hover:bg-[var(--color-nexus-surface-alt)] transition-colors text-left"
                  >
                    <div className={`w-9 h-9 shrink-0 rounded-full ${AVATAR_PALETTE[i % AVATAR_PALETTE.length]} text-white flex items-center justify-center text-xs font-bold`}>
                      {initialsOf(employee.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-[var(--color-nexus-ink)] truncate">{employee.name}</span>
                      <span className="block text-[11px] text-[var(--color-nexus-muted)] truncate">{employee.department || 'Unassigned'} · {employee.shiftName || 'No shift'}</span>
                    </div>
                    <span className={`text-[11px] font-bold shrink-0 ${toneClass}`}>{status.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {selectedEmployee && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm" onClick={() => setSelectedEmployee(null)}>
              <div className="max-w-2xl w-full bg-[var(--color-nexus-surface)] rounded-3xl p-8 shadow-2xl border border-[var(--color-nexus-border)]" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div>
                    <h3 className="font-sans text-lg font-bold text-[var(--color-nexus-ink)]">{selectedEmployee.name}</h3>
                    <p className="text-xs text-[var(--color-nexus-muted)] mt-1">{selectedEmployee.designation || selectedEmployee.role} · {selectedEmployee.department || 'Unassigned'}</p>
                  </div>
                  <button type="button" onClick={() => setSelectedEmployee(null)} className="text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]">
                    <X size={18} />
                  </button>
                </div>
                {selectedEmployeeLoading ? (
                  <div className="py-10 text-center text-sm text-[var(--color-nexus-muted)]">Loading leave balance…</div>
                ) : (
                  <LeaveBalanceCards balances={selectedEmployeeBalances} emptyMessage="No leave policy has been assigned to this employee yet." />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTopTab === 'holidays' && (
        <div className="space-y-6">
          <section className="nexus-card rounded-3xl p-6">
            <div className="flex items-center justify-between gap-4 mb-5">
              <div>
                <h3 className="font-sans text-lg font-bold text-[var(--color-nexus-ink)]">Holiday Calendar</h3>
                <p className="mt-1 text-xs text-[var(--color-nexus-muted)]">Company holidays visible to every employee's Upcoming Holidays feed.</p>
              </div>
            </div>

            {canManageHolidays && (
              <form onSubmit={handleAddHoliday} className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Date</label>
                  <DateSelect value={newHolidayDate} onChange={setNewHolidayDate} required />
                </div>
                <div className="flex-[2]">
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Holiday Name</label>
                  <input value={newHolidayName} onChange={(e) => setNewHolidayName(e.target.value)} placeholder="Independence Day" className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm focus:outline-none" required />
                </div>
                <button type="submit" disabled={saving} className="flex items-center justify-center gap-1.5 rounded-2xl bg-[var(--color-nexus-primary)] px-5 py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--color-nexus-primary-hover)] disabled:opacity-50">
                  <Plus size={14} /> Add Holiday
                </button>
              </form>
            )}

            {holidaysLoading ? (
              <div className="py-16 text-center text-sm text-[var(--color-nexus-muted)]">Loading holidays…</div>
            ) : holidays.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-[var(--color-nexus-border)] p-12 text-center text-sm text-[var(--color-nexus-muted)]">No holiday data to display currently.</div>
            ) : (
              <div className="space-y-2">
                {holidays.map((holiday: any) => (
                  <div key={holiday.id} className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-5 py-3">
                    <div>
                      <span className="block text-sm font-bold text-[var(--color-nexus-ink)]">{holiday.name}</span>
                      <span className="block text-[11px] text-[var(--color-nexus-muted)]">{holiday.date}</span>
                    </div>
                    {canManageHolidays && (
                      <button
                        type="button"
                        onClick={() => handleDeleteHoliday(holiday.id)}
                        disabled={saving}
                        className="rounded-xl p-2 text-[var(--color-nexus-error)] hover:bg-[var(--color-nexus-error-soft)] disabled:opacity-50"
                        title="Remove holiday"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {activeTopTab === 'approval-queue' && (
        <div className="space-y-6">
          <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.3fr_0.9fr]">
            <div className="nexus-card rounded-3xl p-6">
              <h3 className="font-sans text-lg font-bold text-[var(--color-nexus-ink)] mb-1">Adjustment Ledger</h3>
              <p className="text-xs text-[var(--color-nexus-muted)] mb-5">Audit trail of manual leave balance updates made by managers and administrators.</p>
              {loading ? (
                <div className="py-16 text-center text-sm text-[var(--color-nexus-muted)]">Loading adjustments…</div>
              ) : adjustments.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-[var(--color-nexus-border)] p-12 text-center text-sm text-[var(--color-nexus-muted)]">No balance adjustments yet.</div>
              ) : (
                <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                  {adjustments.map((a: any) => (
                    <div key={a.id} className="rounded-3xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] p-4 flex justify-between items-start">
                      <div>
                        <h4 className="text-sm font-bold text-[var(--color-nexus-ink)]">{a.employeeName}</h4>
                        <p className="text-xs text-[var(--color-nexus-muted)]">{a.employeeEmail}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[var(--color-nexus-muted)]">
                          <span>Type: <strong>{a.leaveType}</strong></span>
                          <span>•</span>
                          <span>Reason: <em>{a.reason}</em></span>
                        </div>
                        <p className="text-[10px] text-[var(--color-nexus-muted)] mt-1">Adjusted by {a.adjustedByName} on {new Date(a.createdAt).toLocaleDateString()}</p>
                      </div>
                      <span className={`text-xs font-bold px-3 py-1 rounded-full ${a.adjustmentDays > 0 ? 'bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)]' : 'bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)]'}`}>
                        {a.adjustmentDays > 0 ? `+${a.adjustmentDays}` : a.adjustmentDays} Days
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="nexus-card rounded-3xl p-6">
              <h3 className="font-sans text-lg font-bold text-[var(--color-nexus-ink)]">Manual Adjustment Workbench</h3>
              <p className="mt-1 text-xs text-[var(--color-nexus-muted)]">Credit or debit an employee's leave balance directly to resolve exceptions or award compensatory leaves.</p>
              <form onSubmit={handleCreateAdjustment} className="mt-5 space-y-4">
                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Employee</label>
                  <select
                    required
                    value={adjUserId}
                    onChange={e => setAdjUserId(e.target.value)}
                    className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm focus:outline-none"
                  >
                    <option value="">Select Employee…</option>
                    {users.map((u: any) => (
                      <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Leave Type</label>
                  <select
                    required
                    value={adjLeaveType}
                    onChange={e => setAdjLeaveType(e.target.value)}
                    className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm focus:outline-none"
                  >
                    <option value="">Select Leave Type…</option>
                    {leavePolicies.map((p: any) => (
                      <option key={p.id} value={p.code}>{p.name} ({p.code})</option>
                    ))}
                    {!leavePolicies.some(p => p.code === 'CL') && <option value="CL">Casual Leave (CL)</option>}
                    {!leavePolicies.some(p => p.code === 'SL') && <option value="SL">Sick Leave (SL)</option>}
                    {!leavePolicies.some(p => p.code === 'EL') && <option value="EL">Earned Leave (EL)</option>}
                    {!leavePolicies.some(p => p.code === 'LOP') && <option value="LOP">Loss of Pay (LOP)</option>}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Adjustment Days</label>
                  <input
                    type="number"
                    step="0.5"
                    required
                    value={adjDays}
                    onChange={e => setAdjDays(e.target.value)}
                    placeholder="e.g. 5 or -2"
                    className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm focus:outline-none"
                  />
                  <p className="mt-1 text-[10px] text-[var(--color-nexus-muted)]">Use positive numbers to add leave balance, and negative numbers to subtract.</p>
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Reason</label>
                  <textarea
                    required
                    value={adjReason}
                    onChange={e => setAdjReason(e.target.value)}
                    placeholder="e.g. Compensatory leave for working on weekend"
                    className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm focus:outline-none min-h-[80px]"
                  />
                </div>
                <button type="submit" disabled={saving} className="w-full rounded-2xl bg-[var(--color-nexus-secondary)] py-3 text-xs font-bold uppercase tracking-wider text-white hover:brightness-110 disabled:opacity-50 transition-all">
                  {saving ? 'Processing…' : 'Apply Adjustment'}
                </button>
              </form>
            </div>
          </section>

          {encashmentRequests.filter((r) => r.status === 'pending').length > 0 && (
            <section className="nexus-card rounded-3xl p-6">
              <h3 className="font-sans text-lg font-bold text-[var(--color-nexus-ink)] mb-1">Encashment Requests</h3>
              <p className="mb-4 text-xs text-[var(--color-nexus-muted)]">Approving deducts the days and records the payout amount at the current daily rate; it doesn't disburse funds automatically.</p>
              <div className="space-y-3">
                {encashmentRequests.filter((r) => r.status === 'pending').map((r) => (
                  <div key={r.id} className="flex items-center justify-between p-4 bg-[var(--color-nexus-surface-alt)] rounded-2xl border border-[var(--color-nexus-border)]">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold text-[var(--color-nexus-ink)]">{r.employeeName}</span>
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-[var(--color-nexus-border)] text-[var(--color-nexus-ink)]">{r.days} day(s) · {r.leaveType}</span>
                      </div>
                      {r.reason && <p className="text-xs text-[var(--color-nexus-muted)]">{r.reason}</p>}
                    </div>
                    <div className="flex gap-2 shrink-0 ml-4">
                      <button onClick={() => handleEncashmentAction(r.id, 'approve')} disabled={encashmentActioning === r.id} className="bg-[var(--color-nexus-success-text)] hover:brightness-110 text-white text-xs font-bold uppercase tracking-wider py-1.5 px-4 rounded-lg transition-colors disabled:opacity-50">Approve</button>
                      <button onClick={() => handleEncashmentAction(r.id, 'reject')} disabled={encashmentActioning === r.id} className="bg-[var(--color-nexus-error)] hover:brightness-110 text-white text-xs font-bold uppercase tracking-wider py-1.5 px-4 rounded-lg transition-colors disabled:opacity-50">Reject</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="nexus-card rounded-3xl p-6">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h3 className="font-sans text-lg font-bold text-[var(--color-nexus-ink)]">Leave Approval Queue</h3>
                <p className="mt-1 text-xs text-[var(--color-nexus-muted)]">Review requests in a clean operations queue, not buried below unrelated payroll widgets.</p>
              </div>
              <button
                type="button"
                onClick={() => downloadCsv(
                  `leave-requests-${new Date().toISOString().slice(0, 10)}.csv`,
                  [
                    ['Employee', 'Email', 'Department', 'Leave Type', 'Start Date', 'End Date', 'Total Days', 'Status', 'Reason', 'Submitted'],
                    ...filteredRequests.map((r: any) => [r.employeeName || '', r.employeeEmail || '', r.department || '', r.leaveType || '', r.startDate || '', r.endDate || '', r.totalDays ?? '', r.status || '', r.reason || '', r.createdAt ? new Date(r.createdAt).toLocaleString() : '']),
                  ]
                )}
                className="shrink-0 rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-ink)] hover:bg-[var(--color-nexus-border)]"
              >
                Export CSV
              </button>
            </div>

            <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <input
                value={requestSearch}
                onChange={(e) => setRequestSearch(e.target.value)}
                placeholder="Search employee, department, leave type, or reason"
                className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm focus:outline-none md:max-w-xs"
              />
              <div className="flex flex-wrap gap-2">
                {([
                  ['all', 'All Statuses'],
                  ['pending', 'Pending'],
                  ['approved', 'Approved'],
                  ['rejected', 'Rejected'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setRequestStatusFilter(value)}
                    className={`rounded-xl px-3.5 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
                      requestStatusFilter === value
                        ? 'bg-[var(--color-nexus-primary)] text-white'
                        : 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {(() => {
              const pendingIds = filteredRequests.filter((r: any) => r.status === 'pending').map((r: any) => r.id);
              const allPendingSelected = pendingIds.length > 0 && pendingIds.every((id: number) => selectedRequestIds.has(id));
              if (pendingIds.length === 0) return null;
              return (
                <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-[var(--color-nexus-surface-alt)] px-4 py-3">
                  <label className="flex items-center gap-2 text-xs font-bold text-[var(--color-nexus-ink)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allPendingSelected}
                      onChange={(e) => setSelectedRequestIds(e.target.checked ? new Set(pendingIds) : new Set())}
                      className="accent-[var(--color-nexus-primary)]"
                    />
                    Select all pending ({pendingIds.length})
                  </label>
                  {selectedRequestIds.size > 0 && (
                    <>
                      <span className="text-xs text-[var(--color-nexus-muted)]">{selectedRequestIds.size} selected</span>
                      <button onClick={() => handleBulkResolveLeaveRequests('approve')} disabled={saving} className="rounded-xl bg-[var(--color-nexus-primary)] px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-[var(--color-nexus-primary-hover)] disabled:opacity-50">Approve Selected</button>
                      <button onClick={() => handleBulkResolveLeaveRequests('reject')} disabled={saving} className="rounded-xl border border-[var(--color-nexus-error)] bg-[var(--color-nexus-surface)] px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-[var(--color-nexus-error)] hover:bg-[var(--color-nexus-error-soft)] disabled:opacity-50">Reject Selected</button>
                    </>
                  )}
                </div>
              );
            })()}

            {loading ? (
              <div className="py-16 text-center text-sm text-[var(--color-nexus-muted)]">Loading leave requests…</div>
            ) : filteredRequests.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-[var(--color-nexus-border)] p-12 text-center text-sm text-[var(--color-nexus-muted)]">No leave requests yet.</div>
            ) : (
              <div className="space-y-3">
                {filteredRequests.map((request, i) => {
                  const initials = (request.employeeName || request.leaveType || '?').split(' ').filter(Boolean).slice(0, 2).map((p: string) => p[0]?.toUpperCase()).join('');
                  return (
                    <div key={request.id} className="nexus-card px-5 py-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex items-start gap-3">
                          {request.status === 'pending' && (
                            <input
                              type="checkbox"
                              checked={selectedRequestIds.has(request.id)}
                              onChange={(e) => setSelectedRequestIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(request.id); else next.delete(request.id);
                                return next;
                              })}
                              className="mt-1.5 accent-[var(--color-nexus-primary)]"
                            />
                          )}
                          <div className={`w-11 h-11 shrink-0 rounded-full ${AVATAR_PALETTE[i % AVATAR_PALETTE.length]} text-white flex items-center justify-center text-sm font-bold`}>
                            {initials}
                          </div>
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="text-sm font-bold text-[var(--color-nexus-ink)]">{request.employeeName || request.leaveType}</h4>
                              <StatusPill tone="info">{request.leaveType}</StatusPill>
                              <StatusPill tone={STATUS_TONE[(request.status || 'pending') as keyof typeof STATUS_TONE] || 'warning'}>{request.status}</StatusPill>
                            </div>
                            <p className="text-xs text-[var(--color-nexus-muted)]">{[request.employeeEmail, request.department, request.role].filter(Boolean).join(' • ')}</p>
                            <p className="text-xs text-[var(--color-nexus-muted)]">{request.startDate} to {request.endDate} • {request.totalDays} day(s)</p>
                            <p className="text-xs text-[var(--color-nexus-muted)]">{request.reason}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            onClick={() => handleResolveLeaveRequest(request.id, 'reject')}
                            disabled={saving || request.status !== 'pending'}
                            className="rounded-[var(--radius-nexus-control)] border border-[var(--color-nexus-error)] bg-[var(--color-nexus-surface)] px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-[var(--color-nexus-error)] hover:bg-[var(--color-nexus-error-soft)] disabled:opacity-50"
                          >
                            Reject
                          </button>
                          <button
                            onClick={() => handleResolveLeaveRequest(request.id, 'approve')}
                            disabled={saving || request.status !== 'pending'}
                            className="rounded-[var(--radius-nexus-control)] bg-[var(--color-nexus-primary)] px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-[var(--color-nexus-primary-hover)] disabled:opacity-50"
                          >
                            Approve
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
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
      activeTab="leave-management"
      onTabChange={(id) => navigate(routeForAdminNav(id))}
      onLogout={onLogout}
      title="Leave Management"
      fallbackHref="/dashboard"
    >
      {content}
    </PortalShell>
  );
}
