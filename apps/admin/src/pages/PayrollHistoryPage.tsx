import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { User } from '../lib/auth';
import PortalShell from '../components/PortalShell';
import { getAdminPortalNavItems, routeForAdminNav } from '../lib/adminPortalNav';
import { ArrowLeft } from 'lucide-react';
import CompensationHistoryList, { type CompensationHistoryEntry } from '../components/CompensationHistoryList';

// Every recorded change to one employee's compensation — CTC, and each
// salary component (Basic/HRA/PF/allowances/deductions) added, removed, or
// adjusted — reached via a "History" link on their Compensation Builder
// card in PayrollPage. Backed by GET /api/tenant/payroll/employee/:id/history,
// which reads compensation_history (written alongside every save in
// payroll.routes.ts — see computeCompensationDiff in leavePayrollShared.ts).
export default function PayrollHistoryPage({ user, onLogout }: { user: User; onLogout: () => void }) {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const token = localStorage.getItem('auth_token');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [employee, setEmployee] = useState<{ id: number; name: string; email: string; role: string } | null>(null);
  const [history, setHistory] = useState<CompensationHistoryEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/api/tenant/payroll/employee/${userId}/history`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        let d: any = null;
        try { d = await r.json(); } catch { /* non-JSON body */ }
        if (!r.ok) throw new Error(d?.error || `Could not load payroll history (${r.status}).`);
        return d;
      })
      .then((d) => { if (!cancelled) { setEmployee(d.employee || null); setHistory(Array.isArray(d.history) ? d.history : []); } })
      .catch((err: any) => { if (!cancelled) setError(err.message || 'Could not load payroll history.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, userId]);

  const navItems = getAdminPortalNavItems(user.role).map(({ id, label, icon }) => ({ id, label, icon }));

  return (
    <PortalShell
      user={user}
      roleLabel={user.role}
      navItems={navItems}
      activeTab="payroll"
      onTabChange={(id) => navigate(routeForAdminNav(id))}
      onLogout={onLogout}
      title="Payroll History"
      subtitle={employee ? `${employee.name} • ${employee.role}` : undefined}
      fallbackHref="/tenant/payroll"
    >
      <button
        onClick={() => navigate('/tenant/payroll')}
        className="mb-4 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]"
      >
        <ArrowLeft size={14} /> Back to Payroll
      </button>

      {loading ? (
        <div className="py-16 text-center text-sm text-[var(--color-nexus-muted)]">Loading history…</div>
      ) : error ? (
        <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-4 rounded-xl">{error}</div>
      ) : (
        <CompensationHistoryList
          history={history}
          emptyLabel={`${employee ? employee.name + "'s" : "This employee's"} compensation has never been set or changed.`}
        />
      )}
    </PortalShell>
  );
}
