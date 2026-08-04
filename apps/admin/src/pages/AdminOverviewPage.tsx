import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Building2, Clock, ShieldCheck, Activity, Bell, FileText,
  UserCheck, AlertTriangle, ArrowUpRight, CheckCircle2, Zap
} from 'lucide-react';
import type { User } from '../lib/auth';
import AdminWorkspaceLayout, { ADMIN_NAV_ITEMS } from '../components/AdminWorkspaceLayout';

export default function AdminOverviewPage({ user, onLogout }: { user: User; onLogout?: () => void }) {
  const navigate = useNavigate();
  const token = localStorage.getItem('auth_token');
  const [loading, setLoading] = useState(true);
  const [employeesCount, setEmployeesCount] = useState<number | null>(null);
  const [branches, setBranches] = useState<Array<{ id: number; name: string }>>([]);
  const [prefs, setPrefs] = useState<any>(null);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState<number>(0);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    const loadData = async () => {
      try {
        // Fetch real employees count
        const empRes = await fetch('/api/tenant/employees', { headers: { Authorization: `Bearer ${token}` } });
        if (empRes.ok) {
          const empData = await empRes.json();
          if (isMounted && Array.isArray(empData.employees)) {
            setEmployeesCount(empData.employees.length);
          }
        }

        // Fetch real branches
        const bRes = await fetch('/api/tenant/branches', { headers: { Authorization: `Bearer ${token}` } });
        if (bRes.ok) {
          const bData = await bRes.json();
          if (isMounted && Array.isArray(bData.branches)) {
            setBranches(bData.branches);
          }
        }

        // Fetch real attendance preferences policy
        const pRes = await fetch('/api/attendance-preferences', { headers: { Authorization: `Bearer ${token}` } });
        if (pRes.ok) {
          const pData = await pRes.json();
          if (isMounted && pData.preferences) {
            setPrefs(pData.preferences);
          }
        }

        // Fetch pending device / swap / termination approvals count
        const dRes = await fetch('/api/tenant/device-requests', { headers: { Authorization: `Bearer ${token}` } });
        if (dRes.ok) {
          const dData = await dRes.json();
          if (isMounted && Array.isArray(dData.requests)) {
            const pendingDev = dData.requests.filter((r: any) => r.status === 'pending').length;
            setPendingApprovalsCount(pendingDev);
          }
        }
      } catch (err) {
        console.error('Failed to load overview metrics:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadData();
    return () => { isMounted = false; };
  }, [token]);

  const enabledMethodsCount = Array.isArray(prefs?.enabledMethods) ? prefs.enabledMethods.length : 0;
  const branchNamesStr = branches.length > 0 ? branches.map(b => b.name).slice(0, 3).join(', ') : 'No branches configured';

  return (
    <AdminWorkspaceLayout
      user={user}
      onLogout={onLogout}
      title="Administration Workspace Overview"
      subtitle="Centralized management console for workspace policies, employee structures, and system configurations."
    >
      <div className="space-y-6">
        {/* ── Clickable Real Workspace KPI Cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

          {/* CARD 1: Active Employees */}
          <button
            type="button"
            onClick={() => navigate('/tenant/directory')}
            className="p-4 rounded-2xl bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] hover:border-[var(--color-nexus-primary)] hover:shadow-md transition-all text-left group cursor-pointer flex items-center justify-between"
          >
            <div>
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] group-hover:text-[var(--color-nexus-primary)] transition-colors">
                Active Employees
              </span>
              <h3 className="text-2xl font-extrabold text-[var(--color-nexus-ink)] mt-1">
                {loading ? '...' : (employeesCount ?? 0)}
              </h3>
              <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1 mt-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                View Directory →
              </span>
            </div>
            <div className="w-10 h-10 rounded-xl bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] group-hover:bg-[var(--color-nexus-primary)] group-hover:text-white transition-colors flex items-center justify-center">
              <Users size={20} />
            </div>
          </button>

          {/* CARD 2: Registered Branches */}
          <button
            type="button"
            onClick={() => navigate('/tenant/branches')}
            className="p-4 rounded-2xl bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] hover:border-[var(--color-nexus-primary)] hover:shadow-md transition-all text-left group cursor-pointer flex items-center justify-between"
          >
            <div>
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] group-hover:text-[var(--color-nexus-primary)] transition-colors">
                Registered Branches
              </span>
              <h3 className="text-2xl font-extrabold text-[var(--color-nexus-ink)] mt-1">
                {loading ? '...' : branches.length}
              </h3>
              <span className="text-[10px] text-[var(--color-nexus-muted)] mt-1 block truncate max-w-[160px]">
                {branchNamesStr}
              </span>
            </div>
            <div className="w-10 h-10 rounded-xl bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] group-hover:bg-[var(--color-nexus-primary)] group-hover:text-white transition-colors flex items-center justify-center">
              <Building2 size={20} />
            </div>
          </button>

          {/* CARD 3: Attendance Policy */}
          <button
            type="button"
            onClick={() => navigate('/tenant/attendance-preferences')}
            className="p-4 rounded-2xl bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] hover:border-emerald-500 hover:shadow-md transition-all text-left group cursor-pointer flex items-center justify-between"
          >
            <div>
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] group-hover:text-emerald-600 transition-colors">
                Attendance Policy
              </span>
              <h3 className="text-2xl font-extrabold text-emerald-600 mt-1">
                {loading ? '...' : (prefs?.presenceEngineEnabled ? 'Engine Active' : 'Basic Policy')}
              </h3>
              <span className="text-[10px] text-[var(--color-nexus-muted)] mt-1 block">
                {enabledMethodsCount > 0 ? `${enabledMethodsCount} Methods Enabled` : 'Configure Rules'}
              </span>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition-colors flex items-center justify-center">
              <Clock size={20} />
            </div>
          </button>

          {/* CARD 4: Pending Approvals */}
          <button
            type="button"
            onClick={() => navigate('/tenant/approval-routing')}
            className="p-4 rounded-2xl bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] hover:border-amber-500 hover:shadow-md transition-all text-left group cursor-pointer flex items-center justify-between"
          >
            <div>
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] group-hover:text-amber-600 transition-colors">
                Pending Approvals
              </span>
              <h3 className="text-2xl font-extrabold text-amber-600 mt-1">
                {loading ? '...' : pendingApprovalsCount}
              </h3>
              <span className="text-[10px] text-[var(--color-nexus-muted)] mt-1 block">
                {pendingApprovalsCount > 0 ? 'Requires Action' : 'All Clear'}
              </span>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 group-hover:bg-amber-500 group-hover:text-white transition-colors flex items-center justify-center">
              <AlertTriangle size={20} />
            </div>
          </button>

        </div>

        {/* ── Quick Access Module Cards Grid ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[var(--color-nexus-ink)]">Administration Modules</h2>
            <span className="text-xs text-[var(--color-nexus-muted)] font-mono">{ADMIN_NAV_ITEMS.length - 1} Modules Available</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {ADMIN_NAV_ITEMS.filter((item) => item.id !== 'overview').map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.path)}
                  className="p-4 rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] hover:bg-[var(--color-nexus-surface-alt)]/80 hover:border-[var(--color-nexus-primary)] transition-all text-left group cursor-pointer shadow-xs"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-8 h-8 rounded-xl bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] group-hover:bg-[var(--color-nexus-primary)] group-hover:text-white transition-colors flex items-center justify-center">
                      <Icon size={16} />
                    </div>
                    <ArrowUpRight size={14} className="text-[var(--color-nexus-muted)] group-hover:text-[var(--color-nexus-primary)] transition-colors" />
                  </div>
                  <span className="text-xs font-bold text-[var(--color-nexus-ink)] block group-hover:text-[var(--color-nexus-primary)] transition-colors">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </AdminWorkspaceLayout>
  );
}
