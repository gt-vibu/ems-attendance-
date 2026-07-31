import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, AlertOctagon, ChevronDown } from 'lucide-react';

interface SlaItem {
  id: string;
  type: 'leave_request' | 'attendance_correction' | 'late_arrival';
  label: string;
  userId: number;
  userName: string;
  ageHours: number;
  bucket: 'ok' | 'warning' | 'breached';
}

// Reads GET /api/tenant/sla-dashboard (slaDashboard.routes.ts) — surfaces
// pending leave/attendance approvals that have been sitting the longest, so
// a manager/HR sees what's overdue without digging through each module's
// own pending queue. Purely a read-only view over existing request tables;
// no new approval state.
export const SlaDashboardWidget: React.FC = () => {
  const navigate = useNavigate();
  const token = localStorage.getItem('auth_token');
  const [items, setItems] = useState<SlaItem[]>([]);
  const [summary, setSummary] = useState<{ total: number; breached: number; warning: number; ok: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/tenant/sla-dashboard', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d && d.summary) { setSummary(d.summary); setItems(Array.isArray(d.items) ? d.items : []); } })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading || !summary || summary.total === 0) return null;

  const TYPE_HREF: Record<string, string> = {
    leave_request: '/tenant/leave',
    attendance_correction: '/dashboard',
    late_arrival: '/dashboard',
  };

  return (
    <div className="nexus-card rounded-2xl p-5">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="w-full flex items-center justify-between gap-4 text-left">
        <div className="flex items-center gap-3">
          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${summary.breached > 0 ? 'bg-rose-100' : summary.warning > 0 ? 'bg-amber-100' : 'bg-emerald-100'}`}>
            {summary.breached > 0
              ? <AlertOctagon className="w-5 h-5 text-rose-600" />
              : <Clock className="w-5 h-5 text-amber-600" />}
          </div>
          <div>
            <h3 className="font-bold text-sm text-[var(--color-nexus-ink)]">Approval SLA</h3>
            <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">
              {summary.breached > 0
                ? `${summary.breached} request${summary.breached === 1 ? '' : 's'} pending 48h+`
                : summary.warning > 0
                  ? `${summary.warning} request${summary.warning === 1 ? '' : 's'} pending 24h+`
                  : `${summary.total} pending, all within SLA`}
            </p>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-[var(--color-nexus-muted)] shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-[var(--color-nexus-border)] space-y-1.5">
          {items.slice(0, 15).map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => navigate(TYPE_HREF[it.type] || '/dashboard')}
              className="w-full flex items-center justify-between gap-2 py-1.5 px-1.5 -mx-1.5 rounded-lg hover:bg-[var(--color-nexus-surface-alt)] transition text-left"
            >
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[var(--color-nexus-ink)] truncate">{it.userName} — {it.label}</div>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                it.bucket === 'breached' ? 'bg-rose-100 text-rose-700' : it.bucket === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)]'
              }`}>
                {it.ageHours}h
              </span>
            </button>
          ))}
          {items.length > 15 && (
            <div className="text-[11px] text-[var(--color-nexus-muted)] pt-1">+{items.length - 15} more pending</div>
          )}
        </div>
      )}
    </div>
  );
};

export default SlaDashboardWidget;
