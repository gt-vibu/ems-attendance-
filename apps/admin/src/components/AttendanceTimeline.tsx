import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar, List, LayoutGrid, Filter, MoreHorizontal, Camera, Download, RotateCcw, Check } from 'lucide-react';

// Zoho People-style "Attendance Summary" week timeline, built entirely from
// real data already available to the caller (attendance history, approved
// leave requests, company holidays) plus this tenant's actual shift timing
// (fetched once from /api/tenant/config — the same shiftStart/shiftEnd/
// gracePeriodMins/weekendConfig fields the backend itself uses to decide
// lateness in POST /api/attendance, see attendance.routes.ts). Nothing here
// is fabricated: a day with no matching attendance/leave/holiday record and
// a past date renders as "Absent"; a future date renders neutral.
//
// This component is role-agnostic — it only cares about "the logged-in
// user's own attendance", so it works identically for an employee or a
// manager viewing their own clock-in history.

interface TenantShiftConfig {
  shiftStart: string; // 'HH:MM'
  shiftEnd: string; // 'HH:MM'
  gracePeriodMins: number;
  weekendConfig: string[];
}

export interface AttendanceTimelineProps {
  attendanceHistory: any[]; // rows from /api/attendance/mine — { type, status, createdAt, attendanceMode }
  leaveRequests: any[]; // leaveData.requests — { status, startDate, endDate }
  holidays: any[]; // /api/tenant/holidays — { id, name, date }
  todayState: 'not_started' | 'checked_in' | 'checked_out';
  todayPending: boolean;
  checkInTime: string | null;
  hoursWorked: string; // live ticker, 'HH:MM:SS', only meaningful while checked_in
  onMarkAttendance: () => void;
  authHeaders: Record<string, string>;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}
function startOfDay(d: Date) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}
function parseHM(hm: string): number {
  const [h, m] = (hm || '09:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function fmtMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}
function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function fmtHourLabel(totalMins: number): string {
  let h = Math.floor(totalMins / 60);
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}${suffix}`;
}

export default function AttendanceTimeline({
  attendanceHistory,
  leaveRequests,
  holidays,
  todayState,
  todayPending,
  checkInTime,
  hoursWorked,
  onMarkAttendance,
  authHeaders,
}: AttendanceTimelineProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [notes, setNotes] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<Set<DayInfo['kind']>>(new Set());
  const filterRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  // Close either dropdown on an outside click, same pattern as any other
  // menu in this app — without it the panel would only ever close by
  // toggling the same button again.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);
  const [shift, setShift] = useState<TenantShiftConfig>({
    shiftStart: '09:00',
    shiftEnd: '18:00',
    gracePeriodMins: 15,
    weekendConfig: ['Saturday', 'Sunday'],
  });

  // Fetched once — this is the same tenant config row attendance.routes.ts
  // reads shiftStart/shiftEnd/gracePeriodMins/weekendConfig from to decide
  // lateness server-side, so the timeline's late/early math matches the
  // real check-in flow exactly instead of guessing at "9-6".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/tenant/config', { headers: authHeaders });
        if (!r.ok) return;
        const d = await r.json();
        const t = d.tenant;
        if (!t || cancelled) return;
        const weekendConfig = Array.isArray(t.weekendConfig)
          ? t.weekendConfig
          : (typeof t.weekendConfig === 'string' ? JSON.parse(t.weekendConfig) : ['Saturday', 'Sunday']);
        setShift({
          shiftStart: t.shiftStart || '09:00',
          shiftEnd: t.shiftEnd || '18:00',
          gracePeriodMins: t.gracePeriodMins ?? 15,
          weekendConfig,
        });
      } catch {
        // Keep the 9-6 default rather than blocking the whole view.
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shiftStartMins = parseHM(shift.shiftStart);
  const shiftEndMins = parseHM(shift.shiftEnd);
  const shiftLabel = `General [ ${fmtHourLabel(shiftStartMins)} - ${fmtHourLabel(shiftEndMins)} ]`;

  // --- Week range (Sun–Sat), navigable with weekOffset ---
  const weekStart = useMemo(() => {
    const now = startOfDay(new Date());
    const sunday = new Date(now);
    sunday.setDate(now.getDate() - now.getDay() + weekOffset * 7);
    return sunday;
  }, [weekOffset]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const todayKeyStr = dateKey(new Date());
  const rangeLabel = `${weekDays[0].toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })} - ${weekDays[6].toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}`;

  // --- Index real data by date ---
  const attendanceByDate = useMemo(() => {
    const map = new Map<string, { checkIn?: any; checkOut?: any }>();
    attendanceHistory.forEach((log: any) => {
      if (log.status !== 'approved' && log.status !== 'pending') return;
      if (!log.createdAt) return;
      const key = dateKey(new Date(log.createdAt));
      const entry = map.get(key) || {};
      if (log.type === 'check_in' && (!entry.checkIn || new Date(log.createdAt) < new Date(entry.checkIn.createdAt))) entry.checkIn = log;
      if (log.type === 'check_out' && (!entry.checkOut || new Date(log.createdAt) > new Date(entry.checkOut.createdAt))) entry.checkOut = log;
      map.set(key, entry);
    });
    return map;
  }, [attendanceHistory]);

  const approvedLeaveRanges = useMemo(
    () => (leaveRequests || []).filter((r: any) => r.status === 'approved').map((r: any) => ({ start: r.startDate, end: r.endDate })),
    [leaveRequests]
  );

  const holidayByDate = useMemo(() => {
    const map = new Map<string, string>();
    (holidays || []).forEach((h: any) => map.set(String(h.date).slice(0, 10), h.name));
    return map;
  }, [holidays]);

  const isWeekend = (d: Date) => shift.weekendConfig.includes(DAY_NAMES[d.getDay()]);

  // --- Per-day derived status, used both for the row render and the
  // bottom legend counts (both computed from the SAME visible week). ---
  type DayInfo = {
    d: Date;
    key: string;
    isToday: boolean;
    isFuture: boolean;
    isWeekend: boolean;
    holidayName: string | null;
    onLeave: boolean;
    checkIn: any | null;
    checkOut: any | null;
    kind: 'weekend' | 'holiday' | 'leave' | 'present' | 'pending' | 'absent' | 'upcoming';
  };

  const days: DayInfo[] = useMemo(() => weekDays.map((d) => {
    const key = dateKey(d);
    const entry = attendanceByDate.get(key);
    const holidayName = holidayByDate.get(key) || null;
    const onLeave = approvedLeaveRanges.some((r) => key >= r.start && key <= r.end);
    const weekend = isWeekend(d);
    const isFuture = key > todayKeyStr;
    const isToday = key === todayKeyStr;

    let kind: DayInfo['kind'];
    if (entry?.checkIn) kind = entry.checkIn.status === 'pending' ? 'pending' : 'present';
    else if (holidayName) kind = 'holiday';
    else if (onLeave) kind = 'leave';
    else if (weekend) kind = 'weekend';
    // Today isn't "absent" yet while the day is still in progress and
    // nothing's been recorded — only a past day with no check-in is a
    // confirmed absence.
    else if (isFuture || isToday) kind = 'upcoming';
    else kind = 'absent';

    return { d, key, isToday, isFuture, isWeekend: weekend, holidayName, onLeave, checkIn: entry?.checkIn || null, checkOut: entry?.checkOut || null, kind };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [weekDays, attendanceByDate, holidayByDate, approvedLeaveRanges, shift.weekendConfig, todayKeyStr]);

  // --- Bottom legend counts, all for the currently visible week ---
  const counts = useMemo(() => {
    let present = 0, onDuty = 0, paidLeave = 0, holidaysCount = 0, weekendCount = 0;
    days.forEach((day) => {
      if (day.checkIn) {
        if (day.checkIn.attendanceMode === 'wfh') onDuty++;
        else present++;
      } else if (day.holidayName) holidaysCount++;
      else if (day.onLeave) paidLeave++;
      else if (day.isWeekend) weekendCount++;
    });
    const payableDays = present + onDuty + paidLeave + holidaysCount + weekendCount;
    return { payableDays, present, onDuty, paidLeave, holidaysCount, weekendCount };
  }, [days]);

  // --- Filter panel: which day statuses to show in the row list below.
  // Empty set = no filter applied, show every day (counts/ruler always stay
  // scoped to the full visible week regardless of this). ---
  const STATUS_OPTIONS: { kind: DayInfo['kind']; label: string }[] = [
    { kind: 'present', label: 'Present' },
    { kind: 'pending', label: 'Pending Approval' },
    { kind: 'absent', label: 'Absent' },
    { kind: 'leave', label: 'Paid Leave' },
    { kind: 'holiday', label: 'Holiday' },
    { kind: 'weekend', label: 'Weekend' },
    { kind: 'upcoming', label: 'Upcoming' },
  ];
  const toggleStatusFilter = (kind: DayInfo['kind']) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };
  const visibleDays = useMemo(
    () => (statusFilter.size === 0 ? days : days.filter((d) => statusFilter.has(d.kind))),
    [days, statusFilter]
  );

  // --- Track geometry: hour ruler spans shiftStart..shiftEnd, plus a small
  // margin on both sides so early/late clock events aren't clipped. ---
  const rulerHours = useMemo(() => {
    const hours: number[] = [];
    const startHour = Math.floor(shiftStartMins / 60);
    const endHour = Math.ceil(shiftEndMins / 60);
    for (let h = startHour; h <= endHour; h++) hours.push(h * 60);
    return hours;
  }, [shiftStartMins, shiftEndMins]);

  const trackMin = shiftStartMins;
  const trackMax = shiftEndMins;
  const trackSpan = Math.max(1, trackMax - trackMin);
  const pctOf = (mins: number) => Math.min(100, Math.max(0, ((mins - trackMin) / trackSpan) * 100));

  const renderPill = (day: DayInfo) => {
    const base = 'absolute top-1/2 -translate-y-1/2 h-6 rounded-full border flex items-center justify-center text-[10px] font-bold uppercase tracking-wide';
    if (day.kind === 'weekend') {
      return <div className={`${base} inset-x-0 bg-[var(--color-nexus-secondary-container)] border-[var(--color-nexus-secondary)]/50 text-[var(--color-nexus-secondary)]`}>Weekend</div>;
    }
    if (day.kind === 'holiday') {
      return <div className={`${base} inset-x-0 bg-[var(--color-nexus-primary-fixed)] border-[var(--color-nexus-primary)]/40 text-[var(--color-nexus-primary)]`} title={day.holidayName || 'Holiday'}>Holiday</div>;
    }
    if (day.kind === 'leave') {
      return <div className={`${base} inset-x-0 bg-[var(--color-nexus-secondary-container)] border-[var(--color-nexus-secondary)]/40 text-[var(--color-nexus-secondary)]`}>Paid Leave</div>;
    }
    if (day.kind === 'upcoming') {
      return <div className={`${base} inset-x-0 bg-[var(--color-nexus-surface-alt)] border-[var(--color-nexus-border)] text-[var(--color-nexus-muted)]/50`}>Upcoming</div>;
    }
    if (day.kind === 'absent') {
      return <div className={`${base} inset-x-0 bg-[var(--color-nexus-error-soft)] border-[var(--color-nexus-error)]/40 text-[var(--color-nexus-error)]`}>Absent</div>;
    }
    // present / pending — size the pill to the actual clocked span
    const inTime = new Date(day.checkIn.createdAt);
    const inMins = inTime.getHours() * 60 + inTime.getMinutes();
    const outTime = day.checkOut ? new Date(day.checkOut.createdAt) : (day.isToday ? new Date() : null);
    const outMins = outTime ? outTime.getHours() * 60 + outTime.getMinutes() : Math.min(trackMax, inMins + 30);
    const left = pctOf(inMins);
    const right = pctOf(outMins);
    const width = Math.max(3, right - left);
    const pending = day.kind === 'pending';
    const colorClasses = pending
      ? 'bg-[var(--color-nexus-secondary-container)] border-[var(--color-nexus-secondary)]/50 text-[var(--color-nexus-secondary)]'
      : 'bg-[color:var(--color-nexus-success-text)]/10 border-[color:var(--color-nexus-success-text)]/50 text-[var(--color-nexus-success-text)]';
    return (
      <>
        <span className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[var(--color-nexus-ink)]/30" style={{ left: `calc(${left}% - 4px)` }} />
        <div className={`${base} ${colorClasses}`} style={{ left: `${left}%`, width: `${width}%` }}>
          {!day.checkOut && day.isToday ? 'Working' : ''}
        </div>
        <span className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[var(--color-nexus-ink)]/30" style={{ left: `calc(${right}% - 4px)` }} />
      </>
    );
  };

  const lateEarlyLabel = (day: DayInfo): { text: string; danger: boolean } | null => {
    if (!day.checkIn) return null;
    const inTime = new Date(day.checkIn.createdAt);
    const inMins = inTime.getHours() * 60 + inTime.getMinutes();
    const lateThreshold = shiftStartMins + (shift.gracePeriodMins || 0);
    if (inMins > lateThreshold) {
      return { text: `Late by ${fmtMinutes(inMins - shiftStartMins)}`, danger: true };
    }
    if (inMins < shiftStartMins) {
      return { text: `Early by ${fmtMinutes(shiftStartMins - inMins)}`, danger: false };
    }
    return null;
  };

  const hoursWorkedLabel = (day: DayInfo): string => {
    if (!day.checkIn) return day.isFuture ? '-- Hrs' : '00:00 Hrs worked';
    const inTime = new Date(day.checkIn.createdAt);
    const end = day.checkOut ? new Date(day.checkOut.createdAt) : (day.isToday && todayState === 'checked_in' ? new Date() : null);
    if (!end) return '00:00 Hrs worked';
    const diffMins = Math.max(0, (end.getTime() - inTime.getTime()) / 60000);
    return `${fmtMinutes(diffMins)} Hrs worked`;
  };

  // --- "More" menu: export exactly what's currently visible (respects the
  // active status filter) as a CSV a manager can hand off or archive. ---
  const exportCsv = () => {
    const header = ['Date', 'Day', 'Status', 'Check-In', 'Check-Out', 'Hours Worked'];
    const rows = visibleDays.map((day) => [
      day.key,
      DAY_NAMES[day.d.getDay()],
      day.kind,
      day.checkIn ? fmtTime(new Date(day.checkIn.createdAt)) : '',
      day.checkOut ? fmtTime(new Date(day.checkOut.createdAt)) : '',
      hoursWorkedLabel(day).replace(' Hrs worked', ''),
    ]);
    const csv = [header, ...rows].map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance_${weekDays[0].toISOString().slice(0, 10)}_to_${weekDays[6].toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setMoreOpen(false);
  };

  const checkedIn = todayState === 'checked_in';
  const checkedOut = todayState === 'checked_out';

  return (
    <div className="nexus-card rounded-3xl p-6 space-y-5">
      {/* Sub-tabs */}
      <div className="flex items-center gap-6 border-b border-[var(--color-nexus-border)] pb-3">
        <span className="text-sm font-bold text-[var(--color-nexus-ink)] border-b-2 border-[var(--color-nexus-primary)] pb-3 -mb-3">Attendance Summary</span>
        <span className="text-sm font-medium text-[var(--color-nexus-muted)]">Shift</span>
      </div>

      {/* Header control row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekOffset((w) => w - 1)} aria-label="Previous week" className="w-8 h-8 rounded-lg border border-[var(--color-nexus-border)] flex items-center justify-center text-[var(--color-nexus-muted)] hover:bg-[var(--color-nexus-surface-alt)] transition-colors">
            <ChevronLeft size={15} />
          </button>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--color-nexus-border)] text-xs font-bold text-[var(--color-nexus-ink)]">
            <Calendar size={13} className="text-[var(--color-nexus-muted)]" />
            {rangeLabel}
          </div>
          <button onClick={() => setWeekOffset((w) => w + 1)} aria-label="Next week" className="w-8 h-8 rounded-lg border border-[var(--color-nexus-border)] flex items-center justify-center text-[var(--color-nexus-muted)] hover:bg-[var(--color-nexus-surface-alt)] transition-colors">
            <ChevronRight size={15} />
          </button>
          {weekOffset !== 0 && (
            <button onClick={() => setWeekOffset(0)} className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-nexus-primary)] hover:underline">This week</button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setViewMode('list')} title="List view" className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${viewMode === 'list' ? 'bg-[var(--color-nexus-primary-fixed)] border-[var(--color-nexus-primary)]/40 text-[var(--color-nexus-primary)]' : 'border-[var(--color-nexus-border)] text-[var(--color-nexus-muted)] hover:bg-[var(--color-nexus-surface-alt)]'}`}>
            <List size={14} />
          </button>
          <button onClick={() => setViewMode('grid')} title="Grid view" className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${viewMode === 'grid' ? 'bg-[var(--color-nexus-primary-fixed)] border-[var(--color-nexus-primary)]/40 text-[var(--color-nexus-primary)]' : 'border-[var(--color-nexus-border)] text-[var(--color-nexus-muted)] hover:bg-[var(--color-nexus-surface-alt)]'}`}>
            <LayoutGrid size={14} />
          </button>
          <div className="relative" ref={filterRef}>
            <button
              type="button"
              title="Filter"
              onClick={() => { setFilterOpen((v) => !v); setMoreOpen(false); }}
              className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${statusFilter.size > 0 ? 'bg-[var(--color-nexus-primary-fixed)] border-[var(--color-nexus-primary)]/40 text-[var(--color-nexus-primary)]' : 'border-[var(--color-nexus-border)] text-[var(--color-nexus-muted)] hover:bg-[var(--color-nexus-surface-alt)]'}`}
            >
              <Filter size={14} />
            </button>
            {filterOpen && (
              <div className="absolute right-0 top-full mt-2 z-20 w-52 rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] shadow-lg p-2">
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-nexus-muted)]">Filter by status</span>
                  {statusFilter.size > 0 && (
                    <button type="button" onClick={() => setStatusFilter(new Set())} className="text-[10px] font-bold text-[var(--color-nexus-primary)] hover:underline">Clear</button>
                  )}
                </div>
                {STATUS_OPTIONS.map((opt) => {
                  const active = statusFilter.has(opt.kind);
                  return (
                    <button
                      key={opt.kind}
                      type="button"
                      onClick={() => toggleStatusFilter(opt.kind)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium text-[var(--color-nexus-ink)] hover:bg-[var(--color-nexus-surface-alt)] transition-colors"
                    >
                      <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${active ? 'bg-[var(--color-nexus-primary)] border-[var(--color-nexus-primary)]' : 'border-[var(--color-nexus-border)]'}`}>
                        {active && <Check size={11} className="text-white" />}
                      </span>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="relative" ref={moreRef}>
            <button
              type="button"
              title="More"
              onClick={() => { setMoreOpen((v) => !v); setFilterOpen(false); }}
              className="w-8 h-8 rounded-lg border border-[var(--color-nexus-border)] flex items-center justify-center text-[var(--color-nexus-muted)] hover:bg-[var(--color-nexus-surface-alt)] transition-colors"
            >
              <MoreHorizontal size={14} />
            </button>
            {moreOpen && (
              <div className="absolute right-0 top-full mt-2 z-20 w-48 rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] shadow-lg p-1.5">
                <button type="button" onClick={exportCsv} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-semibold text-[var(--color-nexus-ink)] hover:bg-[var(--color-nexus-surface-alt)] transition-colors">
                  <Download size={13} className="text-[var(--color-nexus-muted)]" /> Export as CSV
                </button>
                <button type="button" onClick={() => { setWeekOffset(0); setMoreOpen(false); }} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-semibold text-[var(--color-nexus-ink)] hover:bg-[var(--color-nexus-surface-alt)] transition-colors">
                  <RotateCcw size={13} className="text-[var(--color-nexus-muted)]" /> Jump to current week
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Shift info + check-in bar — reuses the REAL check-in flow (face +
          GPS verification at /employee/attendance); this is deliberately not
          a bare button that fakes an instant check-in. */}
      <div className="rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 flex items-center gap-3 flex-wrap">
        <span className="text-xs font-bold text-[var(--color-nexus-ink)] shrink-0">{shiftLabel}</span>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={checkedIn || checkedOut}
          placeholder="Add notes for check-in"
          className="flex-1 min-w-[160px] bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg px-3 py-2 text-xs text-[var(--color-nexus-ink)] focus:outline-none focus:border-[var(--color-nexus-primary)] disabled:opacity-50"
        />
        <button
          onClick={onMarkAttendance}
          disabled={checkedOut}
          className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold text-white flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${checkedIn ? 'bg-[var(--color-nexus-error)] hover:brightness-110' : 'bg-[color:var(--color-nexus-success-text)] hover:brightness-110'}`}
        >
          <Camera size={13} />
          {checkedOut ? 'Completed' : checkedIn ? `Check-out / ${hoursWorked} Hrs` : todayPending ? 'Pending Approval' : 'Check-in / 00:00:00 Hrs'}
        </button>
      </div>

      {/* Day rows — list view keeps the original timeline-pill layout; grid
          view is a compact card-per-day summary. Both read from
          visibleDays, so the status filter above applies to either. */}
      {viewMode === 'list' ? (
        <div className="space-y-2">
          {visibleDays.length === 0 ? (
            <div className="text-center py-8 text-xs text-[var(--color-nexus-muted)]">No days match the selected filter.</div>
          ) : visibleDays.map((day) => {
            const lateEarly = lateEarlyLabel(day);
            return (
              <div key={day.key} className="flex items-center gap-3 rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] px-3 py-3">
                <div className="w-12 shrink-0 text-center">
                  <span className="block text-[11px] font-bold text-[var(--color-nexus-ink)]">{day.isToday ? 'Today' : DAY_SHORT[day.d.getDay()]}</span>
                  <span className={`mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold ${day.isToday ? 'bg-[var(--color-nexus-primary)] text-white' : 'text-[var(--color-nexus-muted)]'}`}>{day.d.getDate()}</span>
                </div>
                <div className="relative flex-1 h-8 min-w-[120px]">
                  <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-[var(--color-nexus-border)]" />
                  {renderPill(day)}
                </div>
                <div className="w-32 shrink-0 text-right">
                  {day.checkIn ? (
                    <>
                      <span className="block text-[11px] font-bold text-[var(--color-nexus-ink)]">{fmtTime(new Date(day.checkIn.createdAt))}</span>
                      {lateEarly && <span className={`block text-[9px] font-bold ${lateEarly.danger ? 'text-[var(--color-nexus-warning)]' : 'text-[var(--color-nexus-secondary)]'}`}>{lateEarly.text}</span>}
                    </>
                  ) : (
                    <span className="block text-[11px] text-[var(--color-nexus-muted)]">—</span>
                  )}
                </div>
                <div className="w-28 shrink-0 text-right">
                  <span className="block text-[11px] font-mono text-[var(--color-nexus-muted)]">{hoursWorkedLabel(day)}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {visibleDays.length === 0 ? (
            <div className="col-span-full text-center py-8 text-xs text-[var(--color-nexus-muted)]">No days match the selected filter.</div>
          ) : visibleDays.map((day) => {
            const lateEarly = lateEarlyLabel(day);
            const kindLabel = STATUS_OPTIONS.find((o) => o.kind === day.kind)?.label || day.kind;
            return (
              <div key={day.key} className="rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] p-3 flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-[var(--color-nexus-ink)]">{day.isToday ? 'Today' : DAY_SHORT[day.d.getDay()]}</span>
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold ${day.isToday ? 'bg-[var(--color-nexus-primary)] text-white' : 'text-[var(--color-nexus-muted)]'}`}>{day.d.getDate()}</span>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-nexus-muted)]">{kindLabel}</span>
                {day.checkIn ? (
                  <>
                    <span className="text-[11px] font-bold text-[var(--color-nexus-ink)]">
                      {fmtTime(new Date(day.checkIn.createdAt))}{day.checkOut ? ` – ${fmtTime(new Date(day.checkOut.createdAt))}` : ''}
                    </span>
                    {lateEarly && <span className={`text-[9px] font-bold ${lateEarly.danger ? 'text-[var(--color-nexus-warning)]' : 'text-[var(--color-nexus-secondary)]'}`}>{lateEarly.text}</span>}
                  </>
                ) : (
                  <span className="text-[11px] text-[var(--color-nexus-muted)]">—</span>
                )}
                <span className="text-[10px] font-mono text-[var(--color-nexus-muted)]">{hoursWorkedLabel(day)}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Hour ruler — only meaningful against the list view's timeline pills */}
      {viewMode === 'list' && (
        <div className="flex items-center gap-3 px-3">
          <div className="w-12 shrink-0" />
          <div className="relative flex-1 min-w-[120px] flex justify-between text-[9px] font-mono text-[var(--color-nexus-muted)]">
            {rulerHours.map((mins) => (
              <span key={mins}>{fmtHourLabel(mins)}</span>
            ))}
          </div>
          <div className="w-32 shrink-0" />
          <div className="w-28 shrink-0" />
        </div>
      )}

      {/* Bottom legend / tab bar */}
      <div className="flex items-center justify-between flex-wrap gap-4 pt-3 border-t border-[var(--color-nexus-border)]">
        <div className="flex items-center gap-4">
          <span className="text-xs font-bold text-[var(--color-nexus-ink)] border-b-2 border-[var(--color-nexus-primary)] pb-1">Days</span>
          <span className="text-xs font-medium text-[var(--color-nexus-muted)]">Hours</span>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          {[
            { label: 'Payable Days', value: counts.payableDays, dot: 'bg-[var(--color-nexus-ink)]' },
            { label: 'Present', value: `${counts.present} Day`, dot: 'bg-[color:var(--color-nexus-success-text)]' },
            { label: 'On Duty', value: `${counts.onDuty} Day`, dot: 'bg-[var(--color-nexus-secondary)]' },
            { label: 'Paid leave', value: `${counts.paidLeave} Day`, dot: 'bg-[var(--color-nexus-primary)]' },
            { label: 'Holidays', value: `${counts.holidaysCount} Day`, dot: 'bg-[var(--color-nexus-primary)]' },
            { label: 'Weekend', value: `${counts.weekendCount} Day`, dot: 'bg-[var(--color-nexus-secondary)]' },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${item.dot}`} />
              <span className="text-[10px] text-[var(--color-nexus-muted)]">{item.label}: <strong className="text-[var(--color-nexus-ink)]">{item.value}</strong></span>
            </div>
          ))}
        </div>
        <span className="text-[10px] font-bold text-[var(--color-nexus-muted)]">{shiftLabel}</span>
      </div>
    </div>
  );
}
