import { useEffect, useState, useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Clock, TrendingUp, Coffee, CalendarOff, Wallet } from 'lucide-react';
import DataTable from './DataTable';
import CompensationHistoryList, { type CompensationHistoryEntry } from './CompensationHistoryList';

// Self-service, day-by-day + monthly earnings breakdown — every non-admin
// role's "Earnings" tab. Backed by GET /api/earnings/mine, which computes
// this from real attendance/break/leave data (see
// api/services/earnings.ts); nothing here recomputes pay client-side, this
// component only renders what the server already worked out.
interface DailyEarning {
  date: string;
  status: 'present' | 'pending' | 'absent' | 'leave' | 'holiday' | 'weekend' | 'future';
  checkIn: string | null;
  checkOut: string | null;
  hoursWorked: number;
  regularHours: number;
  overtimeHours: number;
  overtimePay: number;
  breakMinutes: number;
  excessBreakMinutes: number;
  excessBreakDeduction: number;
  isLeave: boolean;
  leaveType: string | null;
  leaveChargeable: boolean;
  basePay: number;
  netPay: number;
}

const money = (n: number) => `₹${Math.round(n || 0).toLocaleString()}`;
const STATUS_STYLE: Record<string, string> = {
  present: 'bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)]',
  pending: 'bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-secondary)]',
  absent: 'bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)]',
  leave: 'bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)]',
  holiday: 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)]',
  weekend: 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)]',
  future: 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)]',
};

export default function EarningsBreakdown({ token }: { token: string | null }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-12
  const [view, setView] = useState<'daily' | 'monthly' | 'history'>('daily');
  const [data, setData] = useState<{ days: DailyEarning[]; summary: any; profile: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [history, setHistory] = useState<CompensationHistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  // Fetched once, lazily, the first time the History tab is opened — no
  // reason to hit this endpoint on every Earnings page load when most
  // visits only look at Daily/Monthly.
  useEffect(() => {
    if (view !== 'history' || history !== null || historyLoading) return;
    setHistoryLoading(true);
    setHistoryError('');
    fetch('/api/payroll/compensation-history/mine', { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        let body: any = null;
        try { body = await r.json(); } catch { /* non-JSON body */ }
        if (!r.ok) throw new Error(body?.error || `Could not load payroll history (${r.status}).`);
        return body;
      })
      .then((d) => setHistory(Array.isArray(d?.history) ? d.history : []))
      .catch((err: any) => setHistoryError(err?.message || 'Could not load payroll history.'))
      .finally(() => setHistoryLoading(false));
  }, [view, token, history, historyLoading]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/api/earnings/mine?year=${year}&month=${month}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        // Never assume the body is JSON just because the request completed —
        // a non-2xx response (401 on a dead session, a proxy's 502/504 HTML
        // error page, etc.) must be handled as an error, not fed to
        // response.json(), which throws an unhelpful "Unexpected token '<'"
        // for any HTML body and would otherwise crash straight into the
        // catch block below with no context on what actually went wrong.
        let body: any = null;
        try { body = await r.json(); } catch { /* non-JSON body, e.g. an HTML error page */ }
        if (!r.ok) throw new Error(body?.error || `Could not load earnings data (${r.status}).`);
        return body;
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err: any) => { if (!cancelled) setError(err?.message || 'Could not load earnings data.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, year, month]);

  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const goPrevMonth = () => { if (month === 1) { setMonth(12); setYear((y) => y - 1); } else { setMonth((m) => m - 1); } };
  const goNextMonth = () => { if (month === 12) { setMonth(1); setYear((y) => y + 1); } else { setMonth((m) => m + 1); } };

  const dailyColumns: ColumnDef<DailyEarning, any>[] = useMemo(() => [
    { accessorKey: 'date', header: 'Date', cell: ({ getValue }) => <span className="font-bold text-[var(--color-nexus-ink)]">{new Date(`${getValue()}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</span> },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => { const s = getValue() as string; return <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${STATUS_STYLE[s] || ''}`}>{s}</span>; } },
    { id: 'checkIn', accessorKey: 'checkIn', header: 'Check-in', cell: ({ getValue }) => { const v = getValue() as string | null; return <span className="text-[var(--color-nexus-muted)]">{v ? new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span>; } },
    { id: 'checkOut', accessorKey: 'checkOut', header: 'Check-out', cell: ({ getValue }) => { const v = getValue() as string | null; return <span className="text-[var(--color-nexus-muted)]">{v ? new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span>; } },
    { accessorKey: 'hoursWorked', header: 'Hours Worked', cell: ({ getValue }) => <span>{(getValue() as number).toFixed(2)}h</span> },
    { accessorKey: 'overtimeHours', header: 'OT Hours', cell: ({ getValue }) => { const v = getValue() as number; return v > 0 ? <span className="font-bold text-[var(--color-nexus-primary)]">{v.toFixed(2)}h</span> : <span className="text-[var(--color-nexus-muted)]">—</span>; } },
    { accessorKey: 'overtimePay', header: 'OT Pay', cell: ({ getValue }) => { const v = getValue() as number; return v > 0 ? <span className="font-bold text-[color:var(--color-nexus-success-text)]">+{money(v)}</span> : <span className="text-[var(--color-nexus-muted)]">—</span>; } },
    { accessorKey: 'breakMinutes', header: 'Breaks Taken', cell: ({ getValue }) => { const v = getValue() as number; return v > 0 ? <span>{v}m</span> : <span className="text-[var(--color-nexus-muted)]">—</span>; } },
    { accessorKey: 'excessBreakMinutes', header: 'Extra Break', cell: ({ getValue }) => { const v = getValue() as number; return v > 0 ? <span className="font-bold text-[var(--color-nexus-error)]">{v}m</span> : <span className="text-[var(--color-nexus-muted)]">—</span>; } },
    { accessorKey: 'excessBreakDeduction', header: 'Break Deduction', cell: ({ getValue }) => { const v = getValue() as number; return v > 0 ? <span className="font-bold text-[var(--color-nexus-error)]">-{money(v)}</span> : <span className="text-[var(--color-nexus-muted)]">—</span>; } },
    { id: 'leave', accessorKey: 'leaveType', header: 'Leave', cell: ({ row }) => row.original.isLeave ? <span className={row.original.leaveChargeable ? 'text-[var(--color-nexus-error)] font-bold' : 'text-[var(--color-nexus-ink)]'}>{row.original.leaveType}{row.original.leaveChargeable ? ' (unpaid)' : ' (paid)'}</span> : <span className="text-[var(--color-nexus-muted)]">—</span> },
    { accessorKey: 'netPay', header: 'Pay for Day', cell: ({ getValue }) => { const v = getValue() as number; return <span className={`font-bold ${v < 0 ? 'text-[var(--color-nexus-error)]' : 'text-[var(--color-nexus-ink)]'}`}>{v < 0 ? '-' : ''}{money(Math.abs(v))}</span>; } },
  ], []);

  const visibleDays = useMemo(() => (data?.days || []).filter((d) => d.status !== 'future'), [data]);

  // The Daily/Monthly views need a currently-active compensation profile to
  // show anything meaningful — but History doesn't (past changes can exist
  // even if, say, a profile was since deactivated), so that "no profile"
  // state only blocks the first two, never the History tab itself.
  const noActiveProfile = !loading && !error && (!data || !data.profile);

  if (loading && view !== 'history') return <div className="text-center py-12 text-xs font-mono uppercase tracking-widest text-[var(--color-nexus-muted)]">Loading earnings...</div>;
  if (error && view !== 'history') return <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-4 rounded-xl">{error}</div>;

  const s = data?.summary;

  return (
    <div className="space-y-5">
      {/* Month navigator (Daily/Monthly only — History isn't month-scoped) + view toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {view !== 'history' ? (
          <div className="flex items-center gap-2">
            <button onClick={goPrevMonth} className="p-2 rounded-lg border border-[var(--color-nexus-border)] hover:bg-[var(--color-nexus-surface-alt)]" aria-label="Previous month"><ChevronLeft size={16} /></button>
            <span className="font-bold text-sm text-[var(--color-nexus-ink)] min-w-[140px] text-center">{monthLabel}</span>
            <button onClick={goNextMonth} className="p-2 rounded-lg border border-[var(--color-nexus-border)] hover:bg-[var(--color-nexus-surface-alt)]" aria-label="Next month"><ChevronRight size={16} /></button>
          </div>
        ) : <div />}
        <div className="flex items-center gap-1 bg-[var(--color-nexus-surface-alt)] rounded-full p-1">
          <button
            onClick={() => setView('daily')}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${view === 'daily' ? 'bg-[var(--color-nexus-surface)] text-[var(--color-nexus-ink)] shadow-sm' : 'text-[var(--color-nexus-muted)]'}`}
          >
            Daily
          </button>
          <button
            onClick={() => setView('monthly')}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${view === 'monthly' ? 'bg-[var(--color-nexus-surface)] text-[var(--color-nexus-ink)] shadow-sm' : 'text-[var(--color-nexus-muted)]'}`}
          >
            Monthly
          </button>
          <button
            onClick={() => setView('history')}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${view === 'history' ? 'bg-[var(--color-nexus-surface)] text-[var(--color-nexus-ink)] shadow-sm' : 'text-[var(--color-nexus-muted)]'}`}
          >
            History
          </button>
        </div>
      </div>

      {view === 'history' ? (
        historyLoading ? (
          <div className="text-center py-12 text-xs font-mono uppercase tracking-widest text-[var(--color-nexus-muted)]">Loading history...</div>
        ) : historyError ? (
          <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-4 rounded-xl">{historyError}</div>
        ) : (
          <CompensationHistoryList history={history || []} emptyLabel="Your compensation has never been set or changed." />
        )
      ) : noActiveProfile ? (
        <div className="nexus-card rounded-2xl p-8 text-center">
          <Wallet className="w-8 h-8 mx-auto mb-3 text-[var(--color-nexus-muted)]" />
          <p className="text-sm font-bold text-[var(--color-nexus-ink)]">No compensation structure set up yet.</p>
          <p className="text-xs text-[var(--color-nexus-muted)] mt-1">Once your employer configures your salary, your day-by-day and monthly earnings will show up here.</p>
        </div>
      ) : view === 'daily' ? (
        <>
          {/* Desktop/tablet: the full 12-column table. Hidden below md — a
              dense table that wide only works with room to breathe; on a
              phone it just becomes an unreadable horizontal-scroll strip. */}
          <div className="hidden md:block">
            <DataTable
              data={visibleDays}
              columns={dailyColumns}
              emptyMessage="No attendance data for this month yet."
              pageSize={31}
            />
          </div>

          {/* Mobile: same data, one stacked card per day instead of a row. */}
          <div className="md:hidden space-y-3">
            {visibleDays.length === 0 ? (
              <div className="nexus-card rounded-2xl p-6 text-center text-xs text-[var(--color-nexus-muted)]">No attendance data for this month yet.</div>
            ) : visibleDays.map((day) => (
              <div key={day.date} className="nexus-card rounded-2xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-[var(--color-nexus-ink)]">
                    {new Date(`${day.date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${STATUS_STYLE[day.status] || ''}`}>{day.status}</span>
                </div>
                {(day.checkIn || day.checkOut) && (
                  <p className="mt-1.5 text-[11px] text-[var(--color-nexus-muted)]">
                    {day.checkIn ? new Date(day.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                    {' → '}
                    {day.checkOut ? new Date(day.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                    {' · '}{day.hoursWorked.toFixed(2)}h worked
                  </p>
                )}
                {day.isLeave && (
                  <p className={`mt-1.5 text-[11px] font-bold ${day.leaveChargeable ? 'text-[var(--color-nexus-error)]' : 'text-[var(--color-nexus-ink)]'}`}>
                    {day.leaveType} · {day.leaveChargeable ? 'unpaid' : 'paid'}
                  </p>
                )}
                <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                  {day.overtimeHours > 0 && (
                    <div className="flex justify-between"><span className="text-[var(--color-nexus-muted)]">OT</span><span className="font-bold text-[color:var(--color-nexus-success-text)]">{day.overtimeHours.toFixed(2)}h · +{money(day.overtimePay)}</span></div>
                  )}
                  {day.breakMinutes > 0 && (
                    <div className="flex justify-between"><span className="text-[var(--color-nexus-muted)]">Breaks</span><span className="font-bold text-[var(--color-nexus-ink)]">{day.breakMinutes}m</span></div>
                  )}
                  {day.excessBreakMinutes > 0 && (
                    <div className="flex justify-between"><span className="text-[var(--color-nexus-muted)]">Extra break</span><span className="font-bold text-[var(--color-nexus-error)]">{day.excessBreakMinutes}m · -{money(day.excessBreakDeduction)}</span></div>
                  )}
                </div>
                <div className="mt-2.5 pt-2.5 border-t border-[var(--color-nexus-border)] flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Pay for day</span>
                  <span className={`text-sm font-bold ${day.netPay < 0 ? 'text-[var(--color-nexus-error)]' : 'text-[var(--color-nexus-ink)]'}`}>{day.netPay < 0 ? '-' : ''}{money(Math.abs(day.netPay))}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-5">
          {/* Headline cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="nexus-card rounded-2xl p-5">
              <div className="flex items-center gap-2 text-[var(--color-nexus-muted)] mb-1"><Clock size={14} /><span className="text-[10px] font-bold uppercase tracking-wider">Hours Worked</span></div>
              <p className="text-xl font-bold text-[var(--color-nexus-ink)]">{s.totalHoursWorked.toFixed(1)}h</p>
              <p className="text-[11px] text-[var(--color-nexus-muted)] mt-0.5">{s.presentDays} day(s) present</p>
            </div>
            <div className="nexus-card rounded-2xl p-5">
              <div className="flex items-center gap-2 text-[var(--color-nexus-muted)] mb-1"><TrendingUp size={14} /><span className="text-[10px] font-bold uppercase tracking-wider">Overtime</span></div>
              <p className="text-xl font-bold text-[var(--color-nexus-ink)]">{s.totalOvertimeHours.toFixed(1)}h</p>
              <p className="text-[11px] font-bold text-[color:var(--color-nexus-success-text)] mt-0.5">+{money(s.totalOvertimePay)}</p>
            </div>
            <div className="nexus-card rounded-2xl p-5">
              <div className="flex items-center gap-2 text-[var(--color-nexus-muted)] mb-1"><Coffee size={14} /><span className="text-[10px] font-bold uppercase tracking-wider">Extra Breaks</span></div>
              <p className="text-xl font-bold text-[var(--color-nexus-ink)]">{s.totalExcessBreakMinutes}m</p>
              <p className="text-[11px] font-bold text-[var(--color-nexus-error)] mt-0.5">{s.totalExcessBreakDeduction > 0 ? `-${money(s.totalExcessBreakDeduction)}` : '—'}</p>
            </div>
            <div className="nexus-card rounded-2xl p-5">
              <div className="flex items-center gap-2 text-[var(--color-nexus-muted)] mb-1"><CalendarOff size={14} /><span className="text-[10px] font-bold uppercase tracking-wider">Leaves Taken</span></div>
              <p className="text-xl font-bold text-[var(--color-nexus-ink)]">{s.leaveDays}</p>
              <p className="text-[11px] font-bold text-[var(--color-nexus-error)] mt-0.5">{s.leaveDeduction > 0 ? `-${money(s.leaveDeduction)}` : 'fully paid'}</p>
            </div>
          </div>

          {/* Full breakdown */}
          <div className="nexus-card rounded-2xl p-6 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-2">Monthly Pay Breakdown</h3>
            {([
              ['Gross Pay (monthly salary components)', s.monthlyGross],
              ['Standard Deductions (PF, tax, etc.)', -s.monthlyDeductions],
              ['Base Pay (after standard deductions)', s.monthlyBaseNet],
              ['Overtime Pay', s.totalOvertimePay],
              ['Extra Break Deduction', -s.totalExcessBreakDeduction],
              [`Leave Deduction (${s.chargeableLeaveDays} unpaid day(s) of ${s.leaveDays} taken)`, -s.leaveDeduction],
            ] as [string, number][]).map(([label, value]) => (
              <div key={label} className="flex items-center justify-between text-xs py-1.5 border-b border-[var(--color-nexus-border)] last:border-0">
                <span className="text-[var(--color-nexus-muted)]">{label as string}</span>
                <span className={`font-mono font-bold ${(value as number) < 0 ? 'text-[var(--color-nexus-error)]' : 'text-[var(--color-nexus-ink)]'}`}>
                  {(value as number) < 0 ? '-' : ''}{money(Math.abs(value as number))}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between pt-3 mt-2 border-t-2 border-[var(--color-nexus-ink)]">
              <span className="text-sm font-bold text-[var(--color-nexus-ink)]">Net Pay This Month</span>
              <span className="text-lg font-bold text-[var(--color-nexus-ink)]">{money(s.monthlyNet)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
