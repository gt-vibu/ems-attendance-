import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, ChevronDown } from 'lucide-react';

interface HealthCheck {
  id: string;
  label: string;
  status: 'ok' | 'warning';
  message: string;
  tab: string;
}

// Where each check's "fix this" link actually goes — mirrors the real
// routes in AdminApp.tsx, not the abstract nav-item ids in adminPortalNav.ts
// (several of these pages aren't in the main nav at all).
const TAB_HREF: Record<string, string> = {
  branches: '/tenant/branches',
  'leave-management': '/tenant/leave',
  payroll: '/tenant/payroll',
  'notification-policies': '/tenant/notification-policies',
  'approval-routing': '/tenant/approval-routing',
};

// Reads GET /api/tenant/config-health (configHealth.routes.ts) — every
// signal it reports comes from a real table (branches, leave_policies,
// employee_compensation_profiles, holidays, notification_policies,
// notification_templates, approval_routing_rules, payroll_calendars), never
// a fabricated metric. Tenant-admin-only home-screen widget.
export const ConfigHealthWidget: React.FC = () => {
  const navigate = useNavigate();
  const token = localStorage.getItem('auth_token');
  const [score, setScore] = useState<number | null>(null);
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/tenant/config-health', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => { if (!cancelled && typeof d.score === 'number') { setScore(d.score); setChecks(Array.isArray(d.checks) ? d.checks : []); } })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading || score === null) return null;

  const warnings = checks.filter((c) => c.status === 'warning');
  const scoreColor = score >= 90 ? 'text-emerald-600' : score >= 70 ? 'text-amber-600' : 'text-rose-600';
  const ringColor = score >= 90 ? '#059669' : score >= 70 ? '#d97706' : '#e11d48';

  return (
    <div className="nexus-card rounded-2xl p-5">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="w-full flex items-center justify-between gap-4 text-left">
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center shrink-0"
            style={{ background: `conic-gradient(${ringColor} ${score * 3.6}deg, var(--color-nexus-surface-alt) 0deg)` }}
          >
            <div className="w-10 h-10 rounded-full bg-[var(--color-nexus-surface)] flex items-center justify-center">
              <span className={`text-xs font-extrabold ${scoreColor}`}>{score}</span>
            </div>
          </div>
          <div>
            <h3 className="font-bold text-sm text-[var(--color-nexus-ink)]">Tenant Setup Health</h3>
            <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">
              {warnings.length === 0 ? 'Everything checked out is configured.' : `${warnings.length} item${warnings.length === 1 ? '' : 's'} could use attention.`}
            </p>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-[var(--color-nexus-muted)] shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-[var(--color-nexus-border)] space-y-2">
          {checks.map((c) => {
            const href = TAB_HREF[c.tab];
            const Row = (
              <div className="flex items-start gap-2.5 py-1.5">
                {c.status === 'ok' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <div className={`text-xs font-semibold ${c.status === 'ok' ? 'text-[var(--color-nexus-ink)]' : 'text-amber-700'}`}>{c.label}</div>
                  <div className="text-[11px] text-[var(--color-nexus-muted)]">{c.message}</div>
                </div>
              </div>
            );
            return c.status === 'warning' && href ? (
              <button key={c.id} type="button" onClick={() => navigate(href)} className="w-full text-left hover:bg-[var(--color-nexus-surface-alt)] rounded-lg px-1.5 -mx-1.5 transition">
                {Row}
              </button>
            ) : (
              <div key={c.id}>{Row}</div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ConfigHealthWidget;
