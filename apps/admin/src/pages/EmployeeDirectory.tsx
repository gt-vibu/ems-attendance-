import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, Filter, UserCheck, Shield, ChevronLeft, ChevronRight,
  MoreVertical, Eye, Trash2, Smartphone, Download, UserX, Check, Building2, ChevronDown, Users, UserPlus
} from 'lucide-react';
import type { User } from '../lib/auth';
import AdminWorkspaceLayout from '../components/AdminWorkspaceLayout';
import EmployeeDetailPanel from '../components/EmployeeDetailPanel';
import ManagementTemplate from '../components/templates/ManagementTemplate';

type Employee = {
  id: number;
  uid?: string;
  name: string;
  email: string;
  department: string;
  designation: string;
  dateOfJoining: string;
  role: string;
  employeeStatus?: string;
  managerName?: string;
  branchName?: string;
};

type Status = 'Present' | 'Late' | 'Absent' | 'On Leave';

const statusBadgeClass: Record<Status, string> = {
  Present: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Late: 'bg-amber-50 text-amber-700 border-amber-200',
  Absent: 'bg-red-50 text-red-700 border-red-200',
  'On Leave': 'bg-blue-50 text-blue-700 border-blue-200',
};

export default function EmployeeDirectory({ user, onLogout, embedded = false }: { user: User; onLogout?: () => void; embedded?: boolean }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = localStorage.getItem('auth_token');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [statusByUserId, setStatusByUserId] = useState<Record<number, Status>>({});

  // Filtering State
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [departmentFilter, setDepartmentFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [roleFilter, setRoleFilter] = useState('All');
  const [activeTab, setActiveTab] = useState('all');

  // Pagination & Multi-select
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  // Slide-over Details Panel Drawer
  const [detailUserId, setDetailUserId] = useState<number | null>(null);

  // Privileges
  const [myPrivileges, setMyPrivileges] = useState<string[] | 'ALL'>([]);

  useEffect(() => {
    fetch('/api/tenant/my-privileges', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => { if (d.privileges) setMyPrivileges(d.privileges); })
      .catch(() => {});
  }, [token]);

  const canTerminate = myPrivileges === 'ALL' || myPrivileges.includes('employee.terminate');
  const canResetDevice = user.deviceChangeEnabled !== false && (myPrivileges === 'ALL' || myPrivileges.includes('employee.resetDevice'));

  const fetchEmployees = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/employees', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to fetch employees.');
      setEmployees(Array.isArray(data.employees) ? data.employees : []);

      const sRes = await fetch('/api/tenant/attendance/today-statuses', { headers: { Authorization: `Bearer ${token}` } });
      if (sRes.ok) {
        const sData = await sRes.json().catch(() => ({}));
        if (sData.statuses) setStatusByUserId(sData.statuses);
      }
    } catch (err: any) {
      setError(err.message || 'Could not load employees.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
  }, [token]);

  // Derived filter options
  const departments = useMemo(() => {
    const set = new Set<string>();
    employees.forEach((e) => { if (e.department) set.add(e.department); });
    return ['All', ...Array.from(set)];
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((e) => {
      const q = search.trim().toLowerCase();
      const matchesSearch = !q ||
        e.name.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        (e.department || '').toLowerCase().includes(q) ||
        (e.designation || '').toLowerCase().includes(q) ||
        `EMP-${e.id}`.toLowerCase().includes(q);

      const matchesDept = departmentFilter === 'All' || e.department === departmentFilter;
      const matchesRole = roleFilter === 'All' || e.role === roleFilter;

      const st = statusByUserId[e.id] || 'Absent';
      const matchesStatus = statusFilter === 'All' || st === statusFilter;

      // Tab filtering
      let matchesTab = true;
      if (activeTab === 'active') matchesTab = e.employeeStatus !== 'terminated';
      else if (activeTab === 'present') matchesTab = st === 'Present' || st === 'Late';
      else if (activeTab === 'leave') matchesTab = st === 'On Leave';
      else if (activeTab === 'managers') matchesTab = e.role === 'tenant_admin' || e.role === 'manager' || e.role === 'hr';

      return matchesSearch && matchesDept && matchesRole && matchesStatus && matchesTab;
    });
  }, [employees, search, departmentFilter, roleFilter, statusFilter, activeTab, statusByUserId]);

  // Pagination slice
  const totalPages = Math.ceil(filteredEmployees.length / pageSize) || 1;
  const paginatedEmployees = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredEmployees.slice(start, start + pageSize);
  }, [filteredEmployees, currentPage]);

  const toggleSelectAll = () => {
    if (selectedIds.length === paginatedEmployees.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(paginatedEmployees.map((e) => e.id));
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);
  };

  // Metrics for Management Template
  const metrics = [
    {
      label: 'Total Workforce',
      value: employees.length,
      subtext: 'Registered employee profiles',
      icon: Users,
    },
    {
      label: 'Present Today',
      value: Object.values(statusByUserId).filter(s => s === 'Present' || s === 'Late').length,
      change: 'Active',
      changeType: 'positive' as const,
      icon: UserCheck,
    },
    {
      label: 'On Leave',
      value: Object.values(statusByUserId).filter(s => s === 'On Leave').length,
      subtext: 'Approved leaves today',
      icon: Shield,
    },
    {
      label: 'Managers & Staff',
      value: employees.filter(e => e.role === 'manager' || e.role === 'hr' || e.role === 'tenant_admin').length,
      subtext: 'Administrative leads',
      icon: Building2,
    },
  ];

  const tabs = [
    { id: 'all', label: 'All Employees', count: employees.length },
    { id: 'active', label: 'Active', count: employees.filter(e => e.employeeStatus !== 'terminated').length },
    { id: 'present', label: 'Present Today', count: Object.values(statusByUserId).filter(s => s === 'Present' || s === 'Late').length },
    { id: 'leave', label: 'On Leave', count: Object.values(statusByUserId).filter(s => s === 'On Leave').length },
    { id: 'managers', label: 'Management & Leads', count: employees.filter(e => e.role === 'manager' || e.role === 'hr' || e.role === 'tenant_admin').length },
  ];

  const filterControls = (
    <div className="flex items-center gap-2">
      <select
        value={departmentFilter}
        onChange={(e) => { setDepartmentFilter(e.target.value); setCurrentPage(1); }}
        className="px-2.5 py-1.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-[var(--radius-nexus-control)] text-xs font-semibold text-[var(--color-nexus-ink)] focus:outline-none"
      >
        <option value="All">All Departments</option>
        {departments.filter((d) => d !== 'All').map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>

      <select
        value={statusFilter}
        onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
        className="px-2.5 py-1.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-[var(--radius-nexus-control)] text-xs font-semibold text-[var(--color-nexus-ink)] focus:outline-none"
      >
        <option value="All">All Today Statuses</option>
        <option value="Present">Present</option>
        <option value="Late">Late</option>
        <option value="Absent">Absent</option>
        <option value="On Leave">On Leave</option>
      </select>
    </div>
  );

  const mainWorkspaceContent = (
    <div>
      {error && <div className="p-3 m-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">{error}</div>}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-[var(--color-nexus-surface-alt)] border-b border-[var(--color-nexus-border)] text-[10.5px] font-mono font-bold text-[var(--color-nexus-muted)] uppercase tracking-wider">
              <th className="py-3 px-4 w-10 text-center">
                <input
                  type="checkbox"
                  checked={paginatedEmployees.length > 0 && selectedIds.length === paginatedEmployees.length}
                  onChange={toggleSelectAll}
                  className="rounded border-slate-300"
                />
              </th>
              <th className="py-3 px-4">Employee</th>
              <th className="py-3 px-4">Department & Role</th>
              <th className="py-3 px-4">Branch</th>
              <th className="py-3 px-4">Today's Status</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)]">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-xs text-[var(--color-nexus-muted)] font-mono">
                  Loading workforce directory...
                </td>
              </tr>
            ) : paginatedEmployees.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-xs text-[var(--color-nexus-muted)]">
                  No employee records matched your search filters.
                </td>
              </tr>
            ) : (
              paginatedEmployees.map((emp) => {
                const isSelected = selectedIds.includes(emp.id);
                const todayStatus = statusByUserId[emp.id] || 'Absent';
                const isTerminated = emp.employeeStatus === 'terminated';

                return (
                  <tr
                    key={emp.id}
                    onClick={() => setDetailUserId(emp.id)}
                    className={`hover:bg-[var(--color-nexus-surface-alt)]/70 transition-colors cursor-pointer ${
                      isSelected ? 'bg-blue-50/50' : ''
                    }`}
                  >
                    <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(emp.id)}
                        className="rounded border-slate-300"
                      />
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] font-bold flex items-center justify-center text-xs shrink-0">
                          {emp.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-bold text-[var(--color-nexus-ink)] text-xs flex items-center gap-1.5">
                            {emp.name}
                            {isTerminated && (
                              <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-red-100 text-red-700">Terminated</span>
                            )}
                          </div>
                          <div className="text-[11px] text-[var(--color-nexus-muted)]">{emp.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-[var(--color-nexus-ink)]">{emp.department || 'General'}</div>
                      <div className="text-[11px] text-[var(--color-nexus-muted)]">{emp.designation || emp.role}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-xs text-[var(--color-nexus-ink)] font-medium">
                        {emp.branchName || 'Headquarters'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border ${statusBadgeClass[todayStatus]}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {todayStatus}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setDetailUserId(emp.id)}
                        className="px-2.5 py-1 rounded-[var(--radius-nexus-control)] border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] hover:bg-[var(--color-nexus-surface-alt)] text-[11px] font-bold text-[var(--color-nexus-primary)] transition-colors"
                      >
                        View Drawer
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="p-3 bg-[var(--color-nexus-surface-alt)] border-t border-[var(--color-nexus-border)] flex items-center justify-between text-xs font-mono text-[var(--color-nexus-muted)]">
        <div>
          Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong> ({filteredEmployees.length} total)
        </div>
        <div className="flex items-center gap-1">
          <button
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            className="p-1 rounded hover:bg-[var(--color-nexus-surface)] disabled:opacity-40"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            disabled={currentPage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            className="p-1 rounded hover:bg-[var(--color-nexus-surface)] disabled:opacity-40"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );

  const mainWorkspace = (
    <ManagementTemplate
      title="Employee Directory & Workforce Workspace"
      subtitle="Centralized management console for employee profiles, assignments, and real-time attendance drawers."
      badge="Enterprise Directory"
      metrics={metrics}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      searchQuery={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search by name, email, department, ID..."
      filterControls={filterControls}
      detailDrawer={detailUserId ? <EmployeeDetailPanel userId={detailUserId} onClose={() => setDetailUserId(null)} /> : null}
    >
      {mainWorkspaceContent}
    </ManagementTemplate>
  );

  if (embedded) return mainWorkspace;

  return (
    <AdminWorkspaceLayout user={user} onLogout={onLogout}>
      {mainWorkspace}
    </AdminWorkspaceLayout>
  );
}
