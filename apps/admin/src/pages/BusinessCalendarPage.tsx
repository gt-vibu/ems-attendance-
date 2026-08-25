import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { User } from '../lib/auth';
import AdminWorkspaceLayout from '../components/AdminWorkspaceLayout';

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

export default function BusinessCalendarPage({ user, onLogout }: { user: User; onLogout?: () => void }) {
  const navigate = useNavigate();
  const token = localStorage.getItem('auth_token');

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState(() => `${year}-${String(month).padStart(2, '0')}-15`);
  const [isOptional, setIsOptional] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const loadCalendar = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tenant/business-calendar?year=${year}&month=${month}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCalendar();
  }, [year, month, token]);

  const shiftMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m > 12) { m = 1; y += 1; }
    if (m < 1) { m = 12; y -= 1; }
    setMonth(m); setYear(y);
    setEventDate(`${y}-${String(m).padStart(2, '0')}-15`);
  };

  const handleAddEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventName.trim() || !eventDate) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/business-calendar/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: eventName.trim(), date: eventDate, isOptional }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add event.');

      setShowAddModal(false);
      setEventName('');
      await loadCalendar();
    } catch (err: any) {
      setError(err.message || 'Failed to create event.');
    } finally {
      setSubmitting(false);
    }
  };

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const grouped = events.reduce((acc: Record<string, CalendarEvent[]>, e) => {
    (acc[e.date] ||= []).push(e);
    return acc;
  }, {});

  return (
    <AdminWorkspaceLayout
      user={user}
      onLogout={onLogout}
      title="Business Calendar"
      subtitle="Holidays, leave, and payroll milestones in one place."
    >
      <div className="space-y-6">

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 shrink-0 rounded-lg bg-[var(--color-nexus-primary-fixed)] flex items-center justify-center">
              <CalendarDays size={16} className="text-[var(--color-nexus-primary)]" />
            </div>
            <div className="min-w-0">
              <h1 className="font-sans text-[18px] font-bold text-[var(--color-nexus-ink)]">Business Calendar</h1>
              <p className="text-[13px] text-[var(--color-nexus-muted)] mt-0.5">Holidays, leave, and payroll milestones in one place.</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-1 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl p-1">
              <button onClick={() => shiftMonth(-1)} className="p-1.5 rounded-lg hover:bg-[var(--color-nexus-surface-alt)]"><ChevronLeft size={16} /></button>
              <span className="text-xs font-bold text-[var(--color-nexus-ink)] w-32 text-center">{monthLabel}</span>
              <button onClick={() => shiftMonth(1)} className="p-1.5 rounded-lg hover:bg-[var(--color-nexus-surface-alt)]"><ChevronRight size={16} /></button>
            </div>
            
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--color-nexus-primary)] text-white text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-opacity shadow-xs"
            >
              <Plus size={15} /> Add Event
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mb-5 text-[11px] font-semibold text-[var(--color-nexus-muted)]">
          {Object.entries({ holiday: 'Holiday', leave: 'Leave', payroll_freeze: 'Payroll' }).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${TYPE_STYLE[k].dot}`} /> {v}</span>
          ))}
        </div>

        {loading ? (
          <div className="text-xs text-[var(--color-nexus-muted)] font-semibold py-8 text-center">Loading calendar events…</div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="nexus-card rounded-xl p-12 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] mx-auto flex items-center justify-center">
              <CalendarDays size={24} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--color-nexus-ink)]">Nothing scheduled for {monthLabel}</h3>
              <p className="text-xs text-[var(--color-nexus-muted)] mt-1 max-w-sm mx-auto">
                No holidays or milestones exist for this month yet. Set up company holidays or key operational dates.
              </p>
            </div>
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--color-nexus-primary)] text-white text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-opacity shadow-xs"
            >
              <Plus size={16} /> Schedule Event / Holiday
            </button>
          </div>
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

        {/* Add Event Modal */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowAddModal(false)}>
            <div className="nexus-card rounded-2xl max-w-md w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-[var(--color-nexus-border)] pb-3">
                <div className="flex items-center gap-2">
                  <Plus size={18} className="text-[var(--color-nexus-primary)]" />
                  <h3 className="font-bold text-sm text-[var(--color-nexus-ink)]">Add Calendar Event / Holiday</h3>
                </div>
                <button onClick={() => setShowAddModal(false)} className="text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]">
                  <X size={18} />
                </button>
              </div>

              {error && <div className="bg-red-50 text-red-700 text-xs p-3 rounded-xl border border-red-200">{error}</div>}

              <form onSubmit={handleAddEvent} className="space-y-4">
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] block mb-1">
                    Event / Holiday Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Independence Day, Quarterly Planning"
                    value={eventName}
                    onChange={e => setEventName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary)]/20"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] block mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    required
                    value={eventDate}
                    onChange={e => setEventDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary)]/20"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isOptional"
                    checked={isOptional}
                    onChange={e => setIsOptional(e.target.checked)}
                    className="rounded border-[var(--color-nexus-border)] text-[var(--color-nexus-primary)] focus:ring-0"
                  />
                  <label htmlFor="isOptional" className="text-xs text-[var(--color-nexus-ink)] font-semibold cursor-pointer">
                    Optional Holiday (Employees choose from quota)
                  </label>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 py-2.5 bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)] text-xs font-bold uppercase rounded-xl hover:bg-[var(--color-nexus-border)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 py-2.5 bg-[var(--color-nexus-primary)] text-white text-xs font-bold uppercase rounded-xl hover:opacity-90 disabled:opacity-50"
                  >
                    {submitting ? 'Saving…' : 'Save Event'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AdminWorkspaceLayout>
  );
}
