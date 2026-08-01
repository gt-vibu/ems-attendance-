import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { User } from '../lib/auth';
import PageChrome from '../components/PageChrome';

interface CalendarEvent {
  date: string;
  type: string;
  label: string;
}

const TYPE_STYLE: Record<string, { dot: string; label: string }> = {
  holiday: { dot: 'bg-rose-500', label: 'Holiday' },
  leave: { dot: 'bg-blue-500', label: 'Leave' },
  payroll_freeze: { dot: 'bg-amber-500', label: 'Payroll' },
  payroll_calculation: { dot: 'bg-amber-500', label: 'Payroll' },
  payroll_hr_review: { dot: 'bg-amber-500', label: 'Payroll' },
  payroll_finance_review: { dot: 'bg-amber-500', label: 'Payroll' },
  payroll_release: { dot: 'bg-emerald-500', label: 'Payroll' },
  payroll_salary_credit: { dot: 'bg-emerald-500', label: 'Payroll' },
};

// One aggregated read-only view over data that already lives in Holidays,
// Leave, and the Payroll Calendar — no new events are created here, this
// just merges and sorts what already exists chronologically.
export default function BusinessCalendarPage({ user }: { user: User }) {
  const navigate = useNavigate();
  const token = localStorage.getItem('auth_token');

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/tenant/business-calendar?year=${year}&month=${month}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setEvents(Array.isArray(d.events) ? d.events : []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [year, month]); // eslint-disable-line react-hooks/exhaustive-deps

  const shiftMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m > 12) { m = 1; y += 1; }
    if (m < 1) { m = 12; y -= 1; }
    setMonth(m); setYear(y);
  };

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const grouped = events.reduce((acc: Record<string, CalendarEvent[]>, e) => {
    (acc[e.date] ||= []).push(e);
    return acc;
  }, {});

  return (
    <div className="min-h-screen premium-mesh-bg font-sans p-6">
      <PageChrome fallbackHref="/dashboard" />
      <div className="max-w-3xl mx-auto">
        <button onClick={() => navigate('/dashboard')} className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)] mb-6 transition-colors">
          <ArrowLeft size={14} /> Back to Dashboard
        </button>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 shrink-0 rounded-xl bg-gradient-to-br from-[var(--color-nexus-primary)] to-[var(--color-nexus-secondary)] flex items-center justify-center shadow-[0_8px_24px_rgba(37,99,235,0.3)]">
              <CalendarDays size={20} className="text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="font-sans text-2xl font-bold text-gradient inline-block">Business Calendar</h1>
              <p className="text-sm text-[var(--color-nexus-muted)] mt-1">Holidays, leave, and payroll milestones in one place.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => shiftMonth(-1)} className="p-2 rounded-lg hover:bg-[var(--color-nexus-surface-alt)]"><ChevronLeft size={16} /></button>
            <span className="text-sm font-bold text-[var(--color-nexus-ink)] w-32 sm:w-36 text-center">{monthLabel}</span>
            <button onClick={() => shiftMonth(1)} className="p-2 rounded-lg hover:bg-[var(--color-nexus-surface-alt)]"><ChevronRight size={16} /></button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mb-5 text-[11px] font-semibold text-[var(--color-nexus-muted)]">
          {Object.entries({ holiday: 'Holiday', leave: 'Leave', payroll_freeze: 'Payroll' }).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${TYPE_STYLE[k].dot}`} /> {v}</span>
          ))}
        </div>

        {loading ? (
          <div className="text-xs text-[var(--color-nexus-muted)] font-semibold">Loading…</div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="nexus-card rounded-xl p-12 text-center text-sm text-[var(--color-nexus-muted)]">Nothing scheduled this month.</div>
        ) : (
          <div className="space-y-2">
            {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([date, dayEvents]) => (
              <div key={date} className="nexus-card rounded-xl p-4 flex items-start gap-4">
                <div className="w-14 shrink-0 text-center">
                  <div className="text-lg font-black text-[var(--color-nexus-ink)]">{new Date(date + 'T00:00:00').getDate()}</div>
                  <div className="text-[10px] font-bold uppercase text-[var(--color-nexus-muted)]">{new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })}</div>
                </div>
                <div className="flex-1 space-y-1.5">
                  {(dayEvents as CalendarEvent[]).map((e, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-[var(--color-nexus-ink)]">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${TYPE_STYLE[e.type]?.dot || 'bg-[var(--color-nexus-muted)]'}`} />
                      {e.label}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
