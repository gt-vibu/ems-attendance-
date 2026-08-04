import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, Filter, UserCheck, Shield, ChevronLeft, ChevronRight,
  MoreVertical, Eye, Trash2, Smartphone, Download, UserX, Check, Building2, ChevronDown
} from 'lucide-react';
import type { User } from '../lib/auth';
import AdminWorkspaceLayout from '../components/AdminWorkspaceLayout';
import EmployeeDetailPanel from '../components/EmployeeDetailPanel';

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

  // Pagination & Multi-select
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  // Slide-over Details Panel
  const [detailUserId, setDetailUserId] = useState<number | null>(null);

  // Privileges
  const [myPrivileges, setMyPrivileges] = useState<string[] | 'ALL'>([]);
  const [resettingDeviceId, setResettingDeviceId] = useState<number | null>(null);

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

  const roles = useMemo(() => {
    const set = new Set<string>();
    employees.forEach((e) => { if (e.role) set.add(e.role); });
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

      return matchesSearch && matchesDept && matchesRole && matchesStatus;
    });
  }, [employees, search, departmentFilter, roleFilter, statusFilter, statusByUserId]);

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

  const content = (
    <div className="space-y-4">
      {/* ── Toolbar & Filters Bar ── */}
      <div className="p-4 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          {/* Search */}
          <div className="relative w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-nexus-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
              placeholder="Search name, ID, department..."
              className="w-full pl-9 pr-3 py-2 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs text-[var(--color-nexus-ink)] focus:outline-none focus:border-[var(--color-nexus-primary)]"
            />
          </div>

          {/* Department Filter */}
          <select
            value={departmentFilter}
            onChange={(e) => { setDepartmentFilter(e.target.value); setCurrentPage(1); }}
            className="px-3 py-2 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-semibold text-[var(--color-nexus-ink)] focus:outline-none"
          >
            <option value="All">All Departments</option>
            {departments.filter((d) => d !== 'All').map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
            className="px-3 py-2 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-semibold text-[var(--color-nexus-ink)] focus:outline-none"
          >
            <option value="All">All Statuses</option>
            <option value="Present">Present</option>
            <option value="Late">Late</option>
            <option value="Absent">Absent</option>
            <option value="On Leave">On Leave</option>
          </select>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-[var(--color-nexus-muted)]">
          <span>Showing <strong>{filteredEmployees.length}</strong> employees</span>
        </div>
      </div>

      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">{error}</div>}

      {/* ── High-Density Enterprise Employee Table ── */}
      <div className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[var(--color-nexus-surface-alt)] border-b border-[var(--color-nexus-border)] text-[var(--color-nexus-muted)] font-mono text-[10px] uppercase tracking-wider">
                <th className="py-3 px-4 w-10">
                  <input
                    type="checkbox"
                    checked={selectedIds.length === paginatedEmployees.length && paginatedEmployees.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="py-3 px-4">Employee</th>
                <th className="py-3 px-4">Employee ID</th>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4">Designation</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Status Today</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-nexus-border)]">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-xs font-mono text-[var(--color-nexus-muted)]">
                    Loading employee directory...
                  </td>
                </tr>
              ) : paginatedEmployees.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-xs font-mono text-[var(--color-nexus-muted)]">
                    No employees match the selected criteria.
                  </td>
                </tr>
              ) : (
                paginatedEmployees.map((emp) => {
                  const status: Status = statusByUserId[emp.id] || 'Absent';
                  const isSelected = selectedIds.includes(emp.id);

                  return (
                    <tr
                      key={emp.id}
                      onClick={() => setDetailUserId(emp.id)}
                      className={`hover:bg-[var(--color-nexus-surface-alt)]/60 transition-colors cursor-pointer ${
                        isSelected ? 'bg-[var(--color-nexus-primary-fixed)]/40' : ''
                      }`}
                    >
                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(emp.id)}
                          className="rounded border-gray-300"
                        />
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] flex items-center justify-center font-bold text-xs shrink-0">
                            {emp.name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')}
                          </div>
                          <div>
                            <span className="font-bold text-[var(--color-nexus-ink)] block">{emp.name}</span>
                            <span className="text-[10px] text-[var(--color-nexus-muted)] block">{emp.email}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono font-semibold text-[var(--color-nexus-secondary)]">
                        EMP-{String(emp.id).padStart(4, '0')}
                      </td>
                      <td className="py-3 px-4 font-semibold text-[var(--color-nexus-ink)]">
                        {emp.department || '—'}
                      </td>
                      <td className="py-3 px-4 text-[var(--color-nexus-muted)]">
                        {emp.designation || '—'}
                      </td>
                      <td className="py-3 px-4 font-mono text-[10px]">
                        <span className="px-2 py-0.5 rounded bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] text-[var(--color-nexus-ink)]">
                          {emp.role}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${statusBadgeClass[status]}`}>
                          {status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => setDetailUserId(emp.id)}
                          className="px-2.5 py-1 text-[11px] font-bold text-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-fixed)] rounded-lg transition-colors"
                        >
                          View Details →
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
        <div className="p-4 border-t border-[var(--color-nexus-border)] flex items-center justify-between text-xs font-mono text-[var(--color-nexus-muted)]">
          <span>
            Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 rounded-lg border border-[var(--color-nexus-border)] hover:bg-[var(--color-nexus-surface-alt)] disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 rounded-lg border border-[var(--color-nexus-border)] hover:bg-[var(--color-nexus-surface-alt)] disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Unified Employee Slide-Over Panel */}
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
      title="Employee Directory"
      subtitle="Single source of truth for organization workforce records, status, and detail management."
    >
      {content}
    </AdminWorkspaceLayout>
  );
}
