import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ChevronLeft, ChevronRight, Banknote, CalendarDays, Pencil, Check } from 'lucide-react';

// Reusable, self-contained employee detail overlay. Given just a userId, it
// fetches everything it needs (basic profile, a navigable month calendar
// built from attendance + approved leave + company holidays, leave balance,
// and a payroll snapshot) and renders as the same
// `fixed inset-0 ... bg-black/40 backdrop-blur-sm` modal chrome used
// elsewhere in this app (see EmployeeDirectory's quick-glance modal and
// EmployeeDashboard's correction-request modal). Intentionally has no
// dependency on any parent page's state — it can be dropped in anywhere with
// just { userId, onClose }.
export type EmployeeDetailPanelProps = {
  userId: number;
  onClose: () => void;
};

type DayStatus = 'present' | 'late' | 'half_day' | 'leave' | 'holiday' | 'weekend' | 'absent' | 'future' | 'none';

type DayCell = {
  dateKey: string;
  dayNum: number;
  inMonth: boolean;
  status: DayStatus;
  label: string;
};

const STATUS_STYLES: Record<Exclude<DayStatus, 'none'>, string> = {
  present: 'bg-[color:var(--color-nexus-success-text)]/15 border-[color:var(--color-nexus-success-text)]/40 text-[var(--color-nexus-success-text)]',
  late: 'bg-[var(--color-nexus-secondary-container)] border-[var(--color-nexus-secondary)]/40 text-[var(--color-nexus-secondary)]',
  half_day: 'bg-[var(--color-nexus-warning-soft)] border-[var(--color-nexus-warning)]/40 text-[var(--color-nexus-warning)]',
  leave: 'bg-[var(--color-nexus-secondary-container)] border-[var(--color-nexus-secondary)]/40 text-[var(--color-nexus-secondary)]',
  holiday: 'bg-[var(--color-nexus-info-soft)] border-[var(--color-nexus-info)]/40 text-[var(--color-nexus-info)]',
  weekend: 'bg-[var(--color-nexus-surface-alt)] border-[var(--color-nexus-border)] text-[var(--color-nexus-muted)]/70',
  absent: 'bg-[var(--color-nexus-error-soft)] border-[var(--color-nexus-error)]/30 text-[var(--color-nexus-error)]',
  future: 'bg-[var(--color-nexus-surface-alt)] border-[var(--color-nexus-border)] text-[var(--color-nexus-muted)]/50',
};

const STATUS_LABELS: Record<Exclude<DayStatus, 'none'>, string> = {
  present: 'Present',
  late: 'Late',
  half_day: 'Half-day',
  leave: 'On Leave',
  holiday: 'Holiday',
  weekend: 'Weekend',
  absent: 'Absent',
  future: 'Upcoming',
};

const LEGEND: Array<{ status: Exclude<DayStatus, 'none' | 'future'>; label: string }> = [
  { status: 'present', label: 'Present' },
  { status: 'late', label: 'Late' },
  { status: 'half_day', label: 'Half-day' },
  { status: 'leave', label: 'On Leave' },
  { status: 'holiday', label: 'Holiday' },
  { status: 'weekend', label: 'Weekend' },
  { status: 'absent', label: 'Absent' },
];

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const initials = (name: string) => (name || '').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');

export default function EmployeeDetailPanel({ userId, onClose }: EmployeeDetailPanelProps) {
  const navigate = useNavigate();
  const token = localStorage.getItem('auth_token');
  const authHeaders = { Authorization: `Bearer ${token}` };

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [employee, setEmployee] = useState<any>(null);
  const [leaveBalance, setLeaveBalance] = useState<{ balances: any[]; remainingDays: number } | null>(null);
  const [holidays, setHolidays] = useState<any[]>([]);

  // Temporary (dated) shift overrides — additive alongside the employee's
  // permanent shift (still changed via PUT /api/tenant/employees/:id).
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const [overrides, setOverrides] = useState<any[]>([]);
  const [overridesLoading, setOverridesLoading] = useState(true);
  const [shiftOptions, setShiftOptions] = useState<any[]>([]);
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [overrideShiftId, setOverrideShiftId] = useState('');
  const [overrideStart, setOverrideStart] = useState(todayISO());
  const [overrideEnd, setOverrideEnd] = useState(todayISO());
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [overrideError, setOverrideError] = useState('');

  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [monthLoading, setMonthLoading] = useState(true);
  const [payrollDetail, setPayrollDetail] = useState<any>(null);

  // What this viewer is actually allowed to do here — same "fetch my own
  // privileges" convention used throughout the app, so an Edit/correction
  // control only ever appears for someone who can actually use it.
  const [myPrivileges, setMyPrivileges] = useState<string[] | 'ALL'>([]);
  useEffect(() => {
    fetch('/api/tenant/my-privileges', { headers: authHeaders })
      .then((r) => r.json())
      .then((d) => setMyPrivileges(d.privileges ?? []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const hasPriv = (...keys: string[]) => myPrivileges === 'ALL' || keys.some((k) => myPrivileges.includes(k));
  const canEditDetails = hasPriv('employee.edit', 'employee.create');
  const canEditAttendance = hasPriv('attendance.edit');

  // Edit Details — toggles the profile grid into editable inputs; saved via
  // PUT /api/tenant/employees/:id (the endpoint already accepted these
  // fields, there was just no UI calling it with anything but the shift).
  const [editingDetails, setEditingDetails] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '', department: '', designation: '', dateOfJoining: '', role: '' });
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [detailsError, setDetailsError] = useState('');

  const startEditingDetails = () => {
    setEditForm({
      name: employee?.name || '', email: employee?.email || '', phone: employee?.phone || '',
      department: employee?.department || '', designation: employee?.designation || '',
      dateOfJoining: employee?.dateOfJoining ? String(employee.dateOfJoining).slice(0, 10) : '', role: employee?.role || '',
    });
    setDetailsError('');
    setEditingDetails(true);
  };

  const handleSaveDetails = async () => {
    setDetailsSaving(true);
    setDetailsError('');
    try {
      const res = await fetch(`/api/tenant/employees/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(editForm),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save these changes.');
      setEmployee(data.employee || { ...employee, ...editForm });
      setEditingDetails(false);
    } catch (err: any) {
      setDetailsError(err.message || 'Could not save these changes.');
    } finally {
      setDetailsSaving(false);
    }
  };

  // Attendance correction — click a day on the calendar to flip it
  // present/absent or adjust its times, via the same editAttendanceDay()
  // endpoint the standalone attendance-edit flow and ticket resolution use.
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [dayNewStatus, setDayNewStatus] = useState<'present' | 'absent'>('present');
  const [dayCheckIn, setDayCheckIn] = useState('09:00');
  const [dayCheckOut, setDayCheckOut] = useState('18:00');
  const [dayReason, setDayReason] = useState('');
  const [daySaving, setDaySaving] = useState(false);
  const [dayError, setDayError] = useState('');

  const openDayEditor = (dateKey: string, currentStatus: DayStatus) => {
    setEditingDate(dateKey);
    setDayNewStatus(currentStatus === 'absent' ? 'present' : 'absent');
    setDayCheckIn('09:00');
    setDayCheckOut('18:00');
    setDayReason('');
    setDayError('');
  };

  const handleSaveDayEdit = async () => {
    if (!editingDate) return;
    if (!dayReason.trim()) { setDayError('A reason is required.'); return; }
    setDaySaving(true);
    setDayError('');
    try {
      const res = await fetch(`/api/tenant/attendance/${userId}/${editingDate}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          newStatus: dayNewStatus,
          checkInTime: dayNewStatus === 'present' ? dayCheckIn : undefined,
          checkOutTime: dayNewStatus === 'present' ? dayCheckOut : undefined,
          reason: dayReason.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not correct this day.');
      setEditingDate(null);
      // Re-trigger the month fetch by nudging viewMonth to a new Date
      // instance with the same value — cheaper than extracting the fetch
      // into its own callback just for this one refresh.
      setViewMonth((m) => new Date(m));
    } catch (err: any) {
      setDayError(err.message || 'Could not correct this day.');
    } finally {
      setDaySaving(false);
    }
  };

  // Basic profile + leave balance + holidays: fetched once per userId, not
  // per month (they don't depend on which month is being viewed).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const [empRes, balRes, holRes] = await Promise.all([
          fetch(`/api/tenant/employees/${userId}`, { headers: authHeaders }),
          fetch(`/api/tenant/employees/${userId}/leave-balance`, { headers: authHeaders }),
          fetch('/api/tenant/holidays', { headers: authHeaders }),
        ]);
        const empData = await empRes.json().catch(() => ({}));
        if (!empRes.ok) throw new Error(empData.error || 'Could not load this employee.');
        if (cancelled) return;
        setEmployee(empData.employee || null);

        const balData = await balRes.json().catch(() => ({}));
        if (balRes.ok && !cancelled) setLeaveBalance({ balances: balData.balances || [], remainingDays: balData.remainingDays ?? 0 });

        const holData = await holRes.json().catch(() => ({}));
        if (holRes.ok && !cancelled) setHolidays(Array.isArray(holData.holidays) ? holData.holidays : []);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Could not load this employee.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const fetchOverrides = async () => {
    if (!userId) return;
    setOverridesLoading(true);
    try {
      const res = await fetch(`/api/tenant/employees/${userId}/shift-overrides`, { headers: authHeaders });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setOverrides(Array.isArray(data.overrides) ? data.overrides : []);
    } catch {
      // Non-fatal — the rest of the panel still works without override history.
    } finally {
      setOverridesLoading(false);
    }
  };

  useEffect(() => {
    fetchOverrides();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Shift options for the override form come from the employee's own
  // branch (same endpoint BranchDetail's shift tab uses) — only available
  // once the employee's branchId is known from the profile fetch above.
  useEffect(() => {
    if (!employee?.branchId) { setShiftOptions([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/branches/${employee.branchId}/shifts`, { headers: authHeaders });
        const data = await res.json().catch(() => ({}));
        if (res.ok && !cancelled) setShiftOptions(Array.isArray(data.shifts) ? data.shifts : []);
      } catch {
        // Keep the form usable-but-empty rather than blocking the panel.
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.branchId]);

  const handleCreateOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    setOverrideError('');
    if (!overrideShiftId) { setOverrideError('Please choose a shift.'); return; }
    if (overrideStart > overrideEnd) { setOverrideError('Start date cannot be after end date.'); return; }
    setOverrideSaving(true);
    try {
      const res = await fetch(`/api/tenant/employees/${userId}/shift-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          shiftId: Number(overrideShiftId),
          startDate: overrideStart,
          endDate: overrideEnd,
          reason: overrideReason.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not create the temporary shift change.');
      setShowOverrideForm(false);
      setOverrideShiftId('');
      setOverrideReason('');
      setOverrideStart(todayISO());
      setOverrideEnd(todayISO());
      fetchOverrides();
    } catch (err: any) {
      setOverrideError(err.message || 'Could not create the temporary shift change.');
    } finally {
      setOverrideSaving(false);
    }
  };

  const handleCancelOverride = async (overrideId: number) => {
    try {
      const res = await fetch(`/api/tenant/employees/${userId}/shift-overrides/${overrideId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not cancel this shift change.');
      fetchOverrides();
    } catch (err: any) {
      setOverrideError(err.message || 'Could not cancel this shift change.');
    }
  };

  // Attendance logs + approved leave + payroll snapshot for the viewed month.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setMonthLoading(true);
      try {
        const year = viewMonth.getFullYear();
        const month = viewMonth.getMonth() + 1;
        const res = await fetch(`/api/tenant/payroll/employee/${userId}?year=${year}&month=${month}`, { headers: authHeaders });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not load attendance for this month.');
        if (!cancelled) setPayrollDetail(data);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Could not load attendance for this month.');
      } finally {
        if (!cancelled) setMonthLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, viewMonth]);

  const calendarDays: DayCell[] = useMemo(() => {
    const attendanceRows: any[] = payrollDetail?.attendanceRows || [];
    const leaveRows: any[] = payrollDetail?.leaveRows || [];

    const byDate = new Map<string, { hasApproved: boolean; hasPending: boolean }>();
    attendanceRows.forEach((log: any) => {
      if (log.type !== 'check_in' || !log.createdAt) return;
      const key = new Date(log.createdAt).toISOString().slice(0, 10);
      const entry = byDate.get(key) || { hasApproved: false, hasPending: false };
      if (log.status === 'approved') entry.hasApproved = true;
      if (log.status === 'pending') entry.hasPending = true;
      byDate.set(key, entry);
    });

    const holidayByDate = new Map<string, string>();
    holidays.forEach((h: any) => holidayByDate.set(String(h.date).slice(0, 10), h.name));

    const leaveRanges = leaveRows.map((r: any) => ({
      start: r.startDate,
      end: r.endDate,
      halfDay: Number(r.totalDays) === 0.5 && r.startDate === r.endDate,
    }));

    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const lastOfMonth = new Date(year, month + 1, 0);
    const leadingBlanks = firstOfMonth.getDay();
    const totalCells = leadingBlanks + lastOfMonth.getDate();
    const trailingBlanks = (7 - (totalCells % 7)) % 7;

    const todayKey = new Date().toISOString().slice(0, 10);
    const days: DayCell[] = [];

    for (let i = 0; i < leadingBlanks; i++) {
      days.push({ dateKey: `lead-${i}`, dayNum: 0, inMonth: false, status: 'none', label: '' });
    }

    for (let d = 1; d <= lastOfMonth.getDate(); d++) {
      const date = new Date(year, month, d);
      const dateKey = date.toISOString().slice(0, 10);
      const dow = date.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const entry = byDate.get(dateKey);
      const holidayName = holidayByDate.get(dateKey);
      const onLeave = leaveRanges.find((range) => dateKey >= range.start && dateKey <= range.end);

      let status: DayStatus;
      if (entry?.hasApproved) status = 'present';
      else if (entry?.hasPending) status = 'late';
      else if (holidayName) status = 'holiday';
      else if (onLeave) status = onLeave.halfDay ? 'half_day' : 'leave';
      else if (dateKey > todayKey) status = 'future';
      else if (isWeekend) status = 'weekend';
      else status = 'absent';

      days.push({ dateKey, dayNum: d, inMonth: true, status, label: holidayName || STATUS_LABELS[status] });
    }

    for (let i = 0; i < trailingBlanks; i++) {
      days.push({ dateKey: `trail-${i}`, dayNum: 0, inMonth: false, status: 'none', label: '' });
    }

    return days;
  }, [payrollDetail, holidays, viewMonth]);

  const goMonth = (delta: number) => {
    setViewMonth((current) => {
      const next = new Date(current);
      next.setMonth(next.getMonth() + delta);
      return next;
    });
  };

  const summary = payrollDetail?.summary || null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl bg-[var(--color-nexus-surface)] p-6 shadow-2xl border border-[var(--color-nexus-border)]"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div className="py-16 text-center text-sm text-[var(--color-nexus-muted)]">Loading employee…</div>
        ) : error && !employee ? (
          <div className="space-y-4">
            <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-4 rounded-xl border border-[var(--color-nexus-error)]/20 font-medium">{error}</div>
            <button onClick={onClose} className="w-full rounded-2xl bg-[var(--color-nexus-surface-alt)] py-3 text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-ink)]">Close</button>
          </div>
        ) : employee ? (
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--color-nexus-primary-fixed)] text-base font-bold text-[var(--color-nexus-primary)]">
                  {initials(employee.name)}
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-base font-bold text-[var(--color-nexus-ink)]">{employee.name}</h3>
                  <p className="truncate text-xs text-[var(--color-nexus-muted)]">{employee.designation || employee.role}{employee.department ? ` • ${employee.department}` : ''}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {canEditDetails && !editingDetails && (
                  <button onClick={startEditingDetails} className="flex items-center gap-1.5 rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-ink)] hover:bg-[var(--color-nexus-border)]">
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                )}
                <button onClick={onClose} aria-label="Close" className="text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-3 rounded-xl border border-[var(--color-nexus-error)]/20 font-medium">{error}</div>
            )}

            {/* Basic info — read-only grid, or an editable form when
                editingDetails is true (see startEditingDetails/handleSaveDetails
                above). Saves via PUT /api/tenant/employees/:id, the same
                endpoint the shift-override flow below already used for
                shiftId — this just exposes the rest of the fields it
                always accepted. */}
            {editingDetails ? (
              <div className="rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] p-4 space-y-3">
                {detailsError && <p className="text-xs font-semibold text-[var(--color-nexus-error)]">{detailsError}</p>}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] uppercase font-bold tracking-wider text-[var(--color-nexus-muted)] mb-1">Name</label>
                    <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} className="w-full px-3 py-2 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold tracking-wider text-[var(--color-nexus-muted)] mb-1">Email</label>
                    <input type="email" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} className="w-full px-3 py-2 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold tracking-wider text-[var(--color-nexus-muted)] mb-1">Role</label>
                    <input value={editForm.role} onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))} className="w-full px-3 py-2 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold tracking-wider text-[var(--color-nexus-muted)] mb-1">Department</label>
                    <input value={editForm.department} onChange={(e) => setEditForm((f) => ({ ...f, department: e.target.value }))} className="w-full px-3 py-2 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold tracking-wider text-[var(--color-nexus-muted)] mb-1">Designation</label>
                    <input value={editForm.designation} onChange={(e) => setEditForm((f) => ({ ...f, designation: e.target.value }))} className="w-full px-3 py-2 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold tracking-wider text-[var(--color-nexus-muted)] mb-1">Phone</label>
                    <input value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} className="w-full px-3 py-2 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold tracking-wider text-[var(--color-nexus-muted)] mb-1">Joined</label>
                    <input type="date" value={editForm.dateOfJoining} onChange={(e) => setEditForm((f) => ({ ...f, dateOfJoining: e.target.value }))} className="w-full px-3 py-2 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg text-sm" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleSaveDetails} disabled={detailsSaving} className="flex items-center gap-1.5 rounded-xl bg-[var(--color-nexus-primary)] px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--color-nexus-primary-hover)] disabled:opacity-50">
                    <Check className="h-3.5 w-3.5" /> {detailsSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setEditingDetails(false)} className="rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] px-4 py-2 text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-ink)]">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3">
                  <dt className="text-[10px] uppercase font-bold tracking-wider text-[var(--color-nexus-muted)]">Email</dt>
                  <dd className="truncate font-semibold text-[var(--color-nexus-ink)] mt-0.5">{employee.email}</dd>
                </div>
                <div className="rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3">
                  <dt className="text-[10px] uppercase font-bold tracking-wider text-[var(--color-nexus-muted)]">Role</dt>
                  <dd className="truncate font-semibold text-[var(--color-nexus-ink)] mt-0.5 capitalize">{employee.role}</dd>
                </div>
                <div className="rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3">
                  <dt className="text-[10px] uppercase font-bold tracking-wider text-[var(--color-nexus-muted)]">Department</dt>
                  <dd className="truncate font-semibold text-[var(--color-nexus-ink)] mt-0.5">{employee.department || '—'}</dd>
                </div>
                <div className="rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3">
                  <dt className="text-[10px] uppercase font-bold tracking-wider text-[var(--color-nexus-muted)]">Joined</dt>
                  <dd className="truncate font-semibold text-[var(--color-nexus-ink)] mt-0.5">{employee.dateOfJoining ? new Date(employee.dateOfJoining).toLocaleDateString() : '—'}</dd>
                </div>
              </dl>
            )}

            {/* Shift + temporary shift change — additive alongside the
                permanent shift (still changed via the employee edit form,
                which calls PUT /api/tenant/employees/:id with shiftId). */}
            <div className="rounded-3xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] p-5">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div>
                  <h4 className="text-sm font-bold text-[var(--color-nexus-ink)] font-sans">Shift</h4>
                  <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">
                    Permanent shift: <span className="font-semibold text-[var(--color-nexus-ink)]">{employee.shiftName || 'Not assigned'}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowOverrideForm((v) => !v)}
                  disabled={!employee.branchId}
                  title={!employee.branchId ? 'Assign this employee to a branch first' : undefined}
                  className="shrink-0 rounded-xl border border-[var(--color-nexus-primary)] px-3 py-2 text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-fixed)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {showOverrideForm ? 'Cancel' : 'Temporary Shift Change'}
                </button>
              </div>

              {showOverrideForm && (
                <form onSubmit={handleCreateOverride} className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 p-3 rounded-2xl bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)]">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold text-[var(--color-nexus-muted)] mb-1 uppercase tracking-wider">Shift</label>
                    <select
                      value={overrideShiftId}
                      onChange={(e) => setOverrideShiftId(e.target.value)}
                      className="w-full px-3 py-2 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg text-sm text-[var(--color-nexus-ink)]"
                      required
                    >
                      <option value="">Select a shift…</option>
                      {shiftOptions.map((s: any) => (
                        <option key={s.id} value={s.id}>{s.name} ({s.checkInTime}–{s.checkOutTime})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--color-nexus-muted)] mb-1 uppercase tracking-wider">Start Date</label>
                    <input type="date" value={overrideStart} onChange={(e) => setOverrideStart(e.target.value)} className="w-full px-3 py-2 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg text-sm text-[var(--color-nexus-ink)]" required />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--color-nexus-muted)] mb-1 uppercase tracking-wider">End Date</label>
                    <input type="date" value={overrideEnd} onChange={(e) => setOverrideEnd(e.target.value)} className="w-full px-3 py-2 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg text-sm text-[var(--color-nexus-ink)]" required />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold text-[var(--color-nexus-muted)] mb-1 uppercase tracking-wider">Reason (optional)</label>
                    <input type="text" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="e.g. covering the night shift this week" className="w-full px-3 py-2 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg text-sm text-[var(--color-nexus-ink)]" />
                  </div>
                  {overrideError && <p className="sm:col-span-2 text-xs text-[var(--color-nexus-error)] font-medium">{overrideError}</p>}
                  <button type="submit" disabled={overrideSaving} className="sm:col-span-2 rounded-xl bg-[var(--color-nexus-primary)] py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--color-nexus-primary-hover)] disabled:opacity-50">
                    {overrideSaving ? 'Saving…' : 'Apply Temporary Shift Change'}
                  </button>
                </form>
              )}

              {overridesLoading ? (
                <p className="text-xs text-[var(--color-nexus-muted)]">Loading shift changes…</p>
              ) : overrides.length === 0 ? (
                <p className="text-xs text-[var(--color-nexus-muted)]">No temporary shift changes on record.</p>
              ) : (
                <div className="space-y-1.5">
                  {overrides.map((o: any) => (
                    <div key={o.id} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--color-nexus-surface)] px-3 py-2 text-xs">
                      <div className="min-w-0">
                        <span className="font-semibold text-[var(--color-nexus-ink)]">{o.shiftName}</span>
                        <span className="text-[var(--color-nexus-muted)]"> — {o.startDate === o.endDate ? `on ${o.startDate}` : `${o.startDate} to ${o.endDate}`}</span>
                        {o.reason && <span className="block text-[10px] text-[var(--color-nexus-muted)] mt-0.5 truncate">{o.reason}</span>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                          o.status === 'active' ? 'bg-[color:var(--color-nexus-success-text)]/15 text-[var(--color-nexus-success-text)]'
                          : o.status === 'upcoming' ? 'bg-[var(--color-nexus-info-soft)] text-[var(--color-nexus-info)]'
                          : 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)]'
                        }`}>{o.status}</span>
                        {o.status !== 'past' && (
                          <button type="button" onClick={() => handleCancelOverride(o.id)} className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-error)] hover:underline">
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Month calendar */}
            <div className="rounded-3xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-[var(--color-nexus-primary)]" />
                  <h4 className="text-sm font-bold text-[var(--color-nexus-ink)] font-sans">
                    {viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                  </h4>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => goMonth(-1)} aria-label="Previous month" className="rounded-lg border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] p-1.5 text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button onClick={() => goMonth(1)} aria-label="Next month" className="rounded-lg border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] p-1.5 text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 mb-3">
                {LEGEND.map((item) => (
                  <div key={item.status} className="flex items-center gap-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full border ${STATUS_STYLES[item.status]}`} />
                    <span className="text-[9px] uppercase font-bold text-[var(--color-nexus-muted)] tracking-wider">{item.label}</span>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1.5 mb-1.5">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                  <div key={`${d}-${i}`} className="text-center text-[9px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">{d}</div>
                ))}
              </div>

              {monthLoading ? (
                <div className="py-10 text-center text-xs text-[var(--color-nexus-muted)]">Loading calendar…</div>
              ) : (
                <div className="grid grid-cols-7 gap-1.5" key={monthKey(viewMonth)}>
                  {calendarDays.map((day) => {
                    const clickable = canEditAttendance && day.inMonth && day.status !== 'future';
                    return (
                      <button
                        type="button"
                        key={day.dateKey}
                        disabled={!clickable}
                        onClick={() => clickable && openDayEditor(day.dateKey, day.status)}
                        title={day.inMonth ? `${day.dateKey} — ${day.label}${clickable ? ' (click to correct)' : ''}` : undefined}
                        className={`aspect-square rounded-lg flex items-center justify-center border text-[10px] font-mono font-bold ${
                          day.inMonth ? STATUS_STYLES[day.status as Exclude<DayStatus, 'none'>] : 'border-transparent'
                        } ${clickable ? 'cursor-pointer hover:ring-2 hover:ring-[var(--color-nexus-primary)]' : 'cursor-default'}`}
                      >
                        {day.inMonth ? day.dayNum : ''}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Attendance correction form — appears when a day is
                  clicked (see openDayEditor above), gated by attendance.edit.
                  Same underlying editAttendanceDay() call the standalone
                  edit endpoint and ticket resolution use, so this reflects
                  in attendance history, leave, and payroll immediately. */}
              {editingDate && (
                <div className="mt-4 p-4 rounded-2xl border border-[var(--color-nexus-primary)]/30 bg-[var(--color-nexus-primary-fixed)]/30 space-y-3">
                  <p className="text-xs font-bold text-[var(--color-nexus-ink)]">Correct attendance for {editingDate}</p>
                  {dayError && <p className="text-xs font-semibold text-[var(--color-nexus-error)]">{dayError}</p>}
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={dayNewStatus} onChange={(e) => setDayNewStatus(e.target.value as any)} className="px-2 py-1.5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg text-xs">
                      <option value="present">Mark Present</option>
                      <option value="absent">Mark Absent</option>
                    </select>
                    {dayNewStatus === 'present' && (
                      <>
                        <input type="time" value={dayCheckIn} onChange={(e) => setDayCheckIn(e.target.value)} className="px-2 py-1.5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg text-xs" />
                        <span className="text-[10px] text-[var(--color-nexus-muted)]">to</span>
                        <input type="time" value={dayCheckOut} onChange={(e) => setDayCheckOut(e.target.value)} className="px-2 py-1.5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg text-xs" />
                      </>
                    )}
                  </div>
                  <input
                    value={dayReason}
                    onChange={(e) => setDayReason(e.target.value)}
                    placeholder="Reason (required — becomes part of the permanent record)"
                    className="w-full px-3 py-2 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg text-xs"
                  />
                  <div className="flex gap-2">
                    <button onClick={handleSaveDayEdit} disabled={daySaving} className="rounded-xl bg-[var(--color-nexus-primary)] px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-[var(--color-nexus-primary-hover)] disabled:opacity-50">
                      {daySaving ? 'Saving…' : 'Confirm Correction'}
                    </button>
                    <button onClick={() => setEditingDate(null)} className="rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-[var(--color-nexus-ink)]">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Leave balance */}
            <div className="rounded-3xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] p-5">
              <h4 className="text-sm font-bold text-[var(--color-nexus-ink)] font-sans mb-3">Leave Balance</h4>
              {!leaveBalance || leaveBalance.balances.length === 0 ? (
                <p className="text-sm text-[var(--color-nexus-muted)]">No leave policy has been assigned yet.</p>
              ) : (
                <div className="space-y-2">
                  {leaveBalance.balances.map((balance: any) => (
                    <div key={balance.id || balance.name} className="flex items-center justify-between rounded-xl bg-[var(--color-nexus-surface)] px-4 py-2.5 text-sm">
                      <span className="font-semibold text-[var(--color-nexus-ink)]">{balance.name}</span>
                      <span className="text-[11px] text-[var(--color-nexus-muted)]">{balance.usedDays} used • <span className="font-bold text-[var(--color-nexus-primary)]">{balance.remainingDays} left</span></span>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => { onClose(); navigate(`/tenant/leave?tab=approval-queue&employee=${encodeURIComponent(employee.name)}`); }}
                className="mt-3 w-full rounded-xl border border-[var(--color-nexus-primary)] py-2.5 text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-fixed)] transition-colors"
              >
                View Full Leave History
              </button>
            </div>

            {/* Payroll breakdown — every real salary component (Basic, HRA,
                Fixed Allowance, PF, etc.) from summary.annualBreakdown, plus
                the actual leave/half-day deduction already computed
                server-side (buildPayrollSummary in leavePayrollShared.ts:
                chargeableLeaveDays * dailyRate * excessLeavePenaltyPercent),
                so the take-home figure shown here is the real number after
                this month's approved leave — never a flat CTC/12 guess. */}
            <div className="rounded-3xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] p-5">
              <div className="flex items-center gap-2 mb-3">
                <Banknote className="h-4 w-4 text-[var(--color-nexus-secondary)]" />
                <h4 className="text-sm font-bold text-[var(--color-nexus-ink)] font-sans">Payroll Breakdown</h4>
              </div>
              {monthLoading ? (
                <p className="text-sm text-[var(--color-nexus-muted)]">Loading…</p>
              ) : !summary ? (
                <p className="text-sm text-[var(--color-nexus-muted)]">Payroll has not been configured for this employee yet.</p>
              ) : (
                <div className="space-y-4">
                  <div>
                    <span className="block text-[10px] uppercase font-bold text-[var(--color-nexus-success-text)] tracking-wider mb-2">Earnings</span>
                    <div className="space-y-1.5">
                      {summary.annualBreakdown.filter((c: any) => c.componentType === 'earning').map((c: any) => (
                        <div key={c.id || c.componentName} className="flex items-center justify-between text-xs">
                          <span className="text-[var(--color-nexus-muted)]">{c.componentName}</span>
                          <span className="font-semibold text-[var(--color-nexus-ink)]">{Math.round(c.monthlyAmount).toLocaleString()}/mo</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {summary.annualBreakdown.some((c: any) => c.componentType === 'deduction') && (
                    <div>
                      <span className="block text-[10px] uppercase font-bold text-[var(--color-nexus-error)] tracking-wider mb-2">Deductions</span>
                      <div className="space-y-1.5">
                        {summary.annualBreakdown.filter((c: any) => c.componentType === 'deduction').map((c: any) => (
                          <div key={c.id || c.componentName} className="flex items-center justify-between text-xs">
                            <span className="text-[var(--color-nexus-muted)]">{c.componentName}</span>
                            <span className="font-semibold text-[var(--color-nexus-ink)]">-{Math.round(c.monthlyAmount).toLocaleString()}/mo</span>
                          </div>
                        ))}
                        {summary.chargeableLeaveDays > 0 && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-[var(--color-nexus-muted)]">Unpaid leave ({summary.chargeableLeaveDays} day{summary.chargeableLeaveDays === 1 ? '' : 's'} this month)</span>
                            <span className="font-semibold text-[var(--color-nexus-error)]">-{Math.round(summary.leaveDeduction).toLocaleString()}/mo</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between rounded-2xl border border-[var(--color-nexus-secondary)]/40 bg-[var(--color-nexus-secondary-container)] px-4 py-3">
                    <div>
                      <span className="block text-[10px] uppercase font-bold text-[var(--color-nexus-secondary)] tracking-wider">Take-Home (This Month)</span>
                      <span className="block text-[11px] text-[var(--color-nexus-muted)] mt-0.5">CTC {Math.round(summary.annualCtc).toLocaleString()}/yr • Gross {Math.round(summary.monthlyGross).toLocaleString()}/mo</span>
                    </div>
                    <span className="text-xl font-bold text-[var(--color-nexus-secondary)]">{Math.round(summary.monthlyNet).toLocaleString()}</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => { onClose(); navigate(`/tenant/payroll/setup/employee/${userId}/salary`); }}
                    className="w-full rounded-xl border border-[var(--color-nexus-secondary)] py-2.5 text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-secondary)] hover:bg-[var(--color-nexus-secondary-container)] transition-colors"
                  >
                    View Full Payroll Breakdown
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={onClose}
              className="w-full rounded-2xl bg-[var(--color-nexus-primary)] py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--color-nexus-primary-hover)]"
            >
              Close
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
