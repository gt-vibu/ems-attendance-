import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import type { User } from '../lib/auth';
import PortalShell from '../components/PortalShell';
import EmployeeDetailPanel from '../components/EmployeeDetailPanel';
import { getAdminPortalNavItems, routeForAdminNav } from '../lib/adminPortalNav';

type Employee = {
  id: number;
  name: string;
  email: string;
  department: string;
  designation: string;
  dateOfJoining: string;
  role: string;
};

type Status = 'Present' | 'Late' | 'Absent' | 'On Leave';

const statusBadgeClass: Record<Status, string> = {
  Present: 'bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)]',
  Late: 'bg-[var(--color-nexus-warning-soft)] text-[var(--color-nexus-warning)]',
  Absent: 'bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)]',
  'On Leave': 'bg-[var(--color-nexus-info-soft)] text-[var(--color-nexus-info)]',
};

export default function EmployeeDirectory({ user, onLogout, embedded = false }: { user: User; onLogout: () => void; embedded?: boolean }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = localStorage.getItem('auth_token');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [statusByUserId, setStatusByUserId] = useState<Record<number, Status>>({});
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [department, setDepartment] = useState('All');
  const [selected, setSelected] = useState<Employee | null>(null);
  const [selectedBalance, setSelectedBalance] = useState<{ remainingDays: number } | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [detailUserId, setDetailUserId] = useState<number | null>(null);

  useEffect(() => {
    const q = searchParams.get('q');
    if (q) setSearch(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [employeesRes, analyticsRes, leaveRes] = await Promise.all([
          fetch('/api/tenant/employees', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/tenant/analytics', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/tenant/leave/requests', { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        const employeesData = await employeesRes.json().catch(() => ({}));
        if (!employeesRes.ok) throw new Error(employeesData.error || 'Could not load the employee directory.');
        setEmployees(Array.isArray(employeesData.employees) ? employeesData.employees : []);

        const analyticsData = await analyticsRes.json().catch(() => ({}));
        const leaveData = await leaveRes.json().catch(() => ({}));

        const today = new Date().toISOString().slice(0, 10);
        const onLeaveIds = new Set<number>(
          (Array.isArray(leaveData.requests) ? leaveData.requests : [])
            .filter((r: any) => r.status === 'approved' && r.startDate <= today && r.endDate >= today)
            .map((r: any) => r.userId)
        );
        const lateIds = new Set<number>((analyticsData.breakdown?.late || []).map((r: any) => r.userId));
        const presentIds = new Set<number>((analyticsData.breakdown?.present || []).map((r: any) => r.userId));

        const nextStatus: Record<number, Status> = {};
        for (const emp of (Array.isArray(employeesData.employees) ? employeesData.employees : [])) {
          if (onLeaveIds.has(emp.id)) nextStatus[emp.id] = 'On Leave';
          else if (lateIds.has(emp.id)) nextStatus[emp.id] = 'Late';
          else if (presentIds.has(emp.id)) nextStatus[emp.id] = 'Present';
          else nextStatus[emp.id] = 'Absent';
        }
        setStatusByUserId(nextStatus);
      } catch (err: any) {
        setError(err.message || 'Could not load the employee directory.');
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const departments = useMemo(() => {
    const unique = Array.from(new Set(employees.map((e) => e.department).filter(Boolean)));
    return ['All', ...unique];
  }, [employees]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return employees.filter((emp) => {
      if (department !== 'All' && emp.department !== department) return false;
      if (!query) return true;
      const haystack = [emp.name, emp.designation, emp.department, emp.email].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [employees, search, department]);

  const openEmployee = async (emp: Employee) => {
    setSelected(emp);
    setSelectedBalance(null);
    setBalanceLoading(true);
    try {
      const res = await fetch(`/api/tenant/employees/${emp.id}/leave-balance`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setSelectedBalance({ remainingDays: data.remainingDays ?? 0 });
    } catch {
      // Leave balance is a nice-to-have in the modal — swallow failures rather than blocking the rest of the details.
    } finally {
      setBalanceLoading(false);
    }
  };

  const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');

  const content = (
    <>
      {error && <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-4 rounded-xl mb-6 border border-[var(--color-nexus-error)]/20 font-medium">{error}</div>}

      <div className="space-y-6">
        <section>
          <h2 className="font-sans text-2xl font-bold text-[var(--color-nexus-ink)]">Employee Directory</h2>
          <p className="mt-1 text-sm text-[var(--color-nexus-muted)]">Browse and search the organization.</p>
        </section>

        <section className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-xs">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-nexus-muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or title..."
              className="w-full rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] py-3 pl-10 pr-4 text-sm focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {departments.map((dept) => (
              <button
                key={dept}
                onClick={() => setDepartment(dept)}
                className={`rounded-xl px-3.5 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
                  department === dept
                    ? 'bg-[var(--color-nexus-primary)] text-white'
                    : 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]'
                }`}
              >
                {dept}
              </button>
            ))}
          </div>
        </section>

        {loading ? (
          <div className="py-16 text-center text-sm text-[var(--color-nexus-muted)]">Loading employees…</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[var(--color-nexus-border)] p-12 text-center text-sm text-[var(--color-nexus-muted)]">No employees match this search.</div>
        ) : (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((emp) => {
              const status = statusByUserId[emp.id] || 'Absent';
              return (
                <button
                  key={emp.id}
                  onClick={() => openEmployee(emp)}
                  className="nexus-card rounded-3xl p-5 text-left transition-shadow hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-nexus-primary-fixed)] text-sm font-bold text-[var(--color-nexus-primary)]">
                        {initials(emp.name)}
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-bold text-[var(--color-nexus-ink)]">{emp.name}</h3>
                        <p className="truncate text-xs text-[var(--color-nexus-muted)]">{emp.designation || emp.role}</p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-[var(--color-nexus-muted)]">{emp.department || '—'}</span>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${statusBadgeClass[status]}`}>{status}</span>
                  </div>
                </button>
              );
            })}
          </section>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelected(null)}>
          <div className="w-full max-w-sm rounded-3xl bg-[var(--color-nexus-surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--color-nexus-primary-fixed)] text-base font-bold text-[var(--color-nexus-primary)]">
                  {initials(selected.name)}
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-base font-bold text-[var(--color-nexus-ink)]">{selected.name}</h3>
                  <p className="truncate text-xs text-[var(--color-nexus-muted)]">{selected.designation || selected.role}</p>
                </div>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close" className="shrink-0 text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]">
                <X className="h-5 w-5" />
              </button>
            </div>

            <dl className="mt-6 space-y-4 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-[var(--color-nexus-muted)]">Department</dt>
                <dd className="font-semibold text-[var(--color-nexus-ink)]">{selected.department || '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-[var(--color-nexus-muted)]">Email</dt>
                <dd className="truncate font-semibold text-[var(--color-nexus-ink)]">{selected.email}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-[var(--color-nexus-muted)]">Joined</dt>
                <dd className="font-semibold text-[var(--color-nexus-ink)]">{selected.dateOfJoining ? new Date(selected.dateOfJoining).toLocaleDateString() : '—'}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-[var(--color-nexus-muted)]">Today's Status</dt>
                <dd>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${statusBadgeClass[statusByUserId[selected.id] || 'Absent']}`}>
                    {statusByUserId[selected.id] || 'Absent'}
                  </span>
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-[var(--color-nexus-muted)]">Leave Days Remaining</dt>
                <dd className="font-semibold text-[var(--color-nexus-ink)]">
                  {balanceLoading ? '…' : selectedBalance ? selectedBalance.remainingDays : '—'}
                </dd>
              </div>
            </dl>

            <button
              onClick={() => setDetailUserId(selected.id)}
              className="mt-6 w-full rounded-2xl border border-[var(--color-nexus-primary)] py-3 text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-fixed)]"
            >
              View Full Calendar
            </button>
            <button
              onClick={() => setSelected(null)}
              className="mt-3 w-full rounded-2xl bg-[var(--color-nexus-primary)] py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--color-nexus-primary-hover)]"
            >
              Close
            </button>
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
      activeTab="directory"
      onTabChange={(id) => navigate(routeForAdminNav(id))}
      onLogout={onLogout}
      title="Employee Directory"
      fallbackHref="/dashboard"
    >
      {content}
    </PortalShell>
  );
}
