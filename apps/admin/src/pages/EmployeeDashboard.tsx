import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { LayoutDashboard, Fingerprint, Home as HomeIcon, Clock, ClipboardCheck, Coffee, CalendarDays, Banknote, Users, Megaphone, X, ChevronLeft, ChevronRight, List, CheckCircle2, AlarmClock, CalendarX, Plane, ShieldCheck, Wallet, Ticket } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { User } from '../lib/auth';
import PortalShell, { type PortalNavItem } from '../components/PortalShell';
import DataTable from '../components/DataTable';
import StatCard from '../components/StatCard';
import StatusPill from '../components/StatusPill';
import LeaveBalanceCards from '../components/LeaveBalanceCards';
import AttendanceTimeline from '../components/AttendanceTimeline';
import EarningsBreakdown from '../components/EarningsBreakdown';
import DocumentsPanel from '../components/DocumentsPanel';
import ShiftSwapWidget from '../components/ShiftSwapWidget';
import MyActivityPanel from '../components/MyActivityPanel';
import TicketsPanel from '../components/TicketsPanel';
import PushNotificationToggle from '../components/PushNotificationToggle';

type AttendanceCalendarStatus = 'present' | 'late' | 'half_day' | 'paid_leave' | 'leave' | 'holiday' | 'weekend' | 'absent' | 'future' | 'none';

const ATTENDANCE_CALENDAR_STYLES: Record<Exclude<AttendanceCalendarStatus, 'none'>, string> = {
  present: 'bg-[color:var(--color-nexus-success-text)]/15 border-[color:var(--color-nexus-success-text)]/40 text-[var(--color-nexus-success-text)]',
  late: 'bg-[var(--color-nexus-secondary-container)] border-[var(--color-nexus-secondary)]/40 text-[var(--color-nexus-secondary)]',
  half_day: 'bg-[var(--color-nexus-warning-soft)] border-[var(--color-nexus-warning)]/40 text-[var(--color-nexus-warning)]',
  paid_leave: 'bg-[var(--color-nexus-secondary-container)] border-[var(--color-nexus-secondary)]/40 text-[var(--color-nexus-secondary)]',
  leave: 'bg-[var(--color-nexus-error-soft)] border-[var(--color-nexus-error)]/30 text-[var(--color-nexus-error)]',
  holiday: 'bg-[var(--color-nexus-info-soft)] border-[var(--color-nexus-info)]/40 text-[var(--color-nexus-info)]',
  weekend: 'bg-[var(--color-nexus-surface-alt)] border-[var(--color-nexus-border)] text-[var(--color-nexus-muted)]/70',
  absent: 'bg-[var(--color-nexus-error-soft)] border-[var(--color-nexus-error)]/30 text-[var(--color-nexus-error)]',
  future: 'bg-[var(--color-nexus-surface-alt)] border-[var(--color-nexus-border)] text-[var(--color-nexus-muted)]/50',
};

const ATTENDANCE_CALENDAR_LABELS: Record<Exclude<AttendanceCalendarStatus, 'none'>, string> = {
  present: 'Present',
  late: 'Late',
  half_day: 'Half-day',
  paid_leave: 'Paid Leave',
  leave: 'Leave',
  holiday: 'Holiday',
  weekend: 'Weekend',
  absent: 'Absent',
  future: 'Upcoming',
};

const ATTENDANCE_CALENDAR_LEGEND: Array<{ status: Exclude<AttendanceCalendarStatus, 'none' | 'future'>; label: string }> = [
  { status: 'present', label: 'Present' },
  { status: 'late', label: 'Late' },
  { status: 'half_day', label: 'Half-day' },
  { status: 'paid_leave', label: 'Paid Leave' },
  { status: 'leave', label: 'Leave' },
  { status: 'holiday', label: 'Holiday' },
  { status: 'weekend', label: 'Weekend' },
  { status: 'absent', label: 'Absent' },
];

function attendanceDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function attendanceMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function normalizeText(value: any) {
  return String(value || '').trim().toLowerCase();
}

function isPaidLeaveRequest(request: any, policies: any[]) {
  const policy = policies.find((item: any) => String(item.id) === String(request.policyId))
    || policies.find((item: any) => normalizeText(item.code) === normalizeText(request.leaveType))
    || policies.find((item: any) => normalizeText(item.name) === normalizeText(request.leaveType));
  if (policy) return Number(policy.defaultDeductionPercent ?? 100) === 0;
  return /paid|paternity/.test(normalizeText(request.leaveType));
}

// The employee portal, rebuilt as a full admin-style dashboard (sidebar +
// sections) scoped to only what an employee can see/do — replacing the old
// minimal single-card landing. The focused biometric camera flow still lives
// on its own route (/employee/attendance); everything else (status, history,
// breaks, requests) lives here. All data is self-scoped via endpoints that
// filter on req.user.userId server-side.
export default function EmployeeDashboard({ user, onLogout }: { user: User, onLogout: () => void }) {
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);

  const [todayState, setTodayState] = useState<'not_started' | 'checked_in' | 'checked_out'>('not_started');
  const [todayPending, setTodayPending] = useState(false);
  const [checkInTime, setCheckInTime] = useState<string | null>(null);
  const [hoursWorked, setHoursWorked] = useState('00:00:00');

  const [attendancePercent, setAttendancePercent] = useState<number | null>(null);
  const [attendanceThreshold, setAttendanceThreshold] = useState(75);
  const [attendanceHistory, setAttendanceHistory] = useState<any[]>([]);
  const [corrections, setCorrections] = useState<any[]>([]);
  const [wfhEligible, setWfhEligible] = useState(false);
  const [wfhReasonMsg, setWfhReasonMsg] = useState('');
  const [leaveData, setLeaveData] = useState<{ policies: any[]; balances: any[]; requests: any[]; optionalHolidayLimit: number; selectedOptionalHolidayCount: number } | null>(null);
  const [payrollData, setPayrollData] = useState<{ summary: any; profile: any; components: any[] } | null>(null);
  const [optionalHolidayData, setOptionalHolidayData] = useState<{ limit: number; holidays: any[] } | null>(null);
  const [upcomingHolidays, setUpcomingHolidays] = useState<any[]>([]);
  const [allHolidays, setAllHolidays] = useState<any[]>([]);
  const [myTeam, setMyTeam] = useState<{ manager: any; colleagues: any[] } | null>(null);
  const [policyAnnouncement, setPolicyAnnouncement] = useState('');
  const [policyExpanded, setPolicyExpanded] = useState(false);
  const [payslipHistory, setPayslipHistory] = useState<any[]>([]);
  const [selectedOptionalHolidayIds, setSelectedOptionalHolidayIds] = useState<number[]>([]);
  const [leavePolicyId, setLeavePolicyId] = useState('');
  const [leaveStartDate, setLeaveStartDate] = useState('');
  const [leaveEndDate, setLeaveEndDate] = useState('');
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveMedicalCause, setLeaveMedicalCause] = useState(false);
  const [leaveHalfDay, setLeaveHalfDay] = useState(false);
  const [applyLeaveModalOpen, setApplyLeaveModalOpen] = useState(false);
  const [leaveHistoryView, setLeaveHistoryView] = useState<'list' | 'calendar'>('list');
  const [leaveCalendarMonth, setLeaveCalendarMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [attendanceCalendarMonth, setAttendanceCalendarMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [attendanceCalendarRows, setAttendanceCalendarRows] = useState<any[]>([]);
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [optionalHolidaySaving, setOptionalHolidaySaving] = useState(false);

  // Break management (ported from the old EmployeeHome)
  const [activeBreak, setActiveBreak] = useState<any>(null);
  const [breakTimer, setBreakTimer] = useState('00:00');
  const [breakType, setBreakType] = useState('General');
  const [breakNote, setBreakNote] = useState('');
  const [breaksToday, setBreaksToday] = useState<any[]>([]);
  const [budgetMins, setBudgetMins] = useState(60);
  const [remainingMins, setRemainingMins] = useState(60);
  const [checkingOut, setCheckingOut] = useState(false);
  const [showCheckoutConfirm, setShowCheckoutConfirm] = useState(false);
  // In-flight guard for start/end break: a break action first waits on a GPS
  // fix (which can be slow on mobile), so without this the button gives no
  // feedback and invites repeated taps that fire concurrent, racing requests.
  const [breakBusy, setBreakBusy] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Correction request modal
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [correctionType, setCorrectionType] = useState('missed_checkin');
  const [correctionDate, setCorrectionDate] = useState('');
  const [correctionTime, setCorrectionTime] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [correctionSubmitted, setCorrectionSubmitted] = useState(false);

  // Leave encashment (convert unused days into pay) — only offered for
  // policies with encashmentEnabled on.
  const [encashPolicyId, setEncashPolicyId] = useState('');
  const [encashDays, setEncashDays] = useState('1');
  const [encashReason, setEncashReason] = useState('');
  const [encashSubmitting, setEncashSubmitting] = useState(false);
  const [encashMessage, setEncashMessage] = useState('');

  const navigate = useNavigate();
  const token = localStorage.getItem('auth_token');
  const authHeaders = { 'Authorization': `Bearer ${token}` };

  const refreshLeaveData = async () => {
    const leaveRes = await fetch('/api/leave/mine', { headers: authHeaders });
    if (!leaveRes.ok) throw new Error('Failed to load leave details.');
    const leaveJson = await leaveRes.json();
    setLeaveData({
      policies: leaveJson.policies || [],
      balances: leaveJson.balances || [],
      requests: leaveJson.requests || [],
      optionalHolidayLimit: leaveJson.optionalHolidayLimit || 0,
      selectedOptionalHolidayCount: leaveJson.selectedOptionalHolidayCount || 0,
    });
    return leaveJson;
  };

  const handleEncashLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!encashPolicyId || !encashDays) return;
    setEncashSubmitting(true);
    setEncashMessage('');
    try {
      const res = await fetch('/api/leave/encashment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ policyId: Number(encashPolicyId), days: Number(encashDays), reason: encashReason.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to submit encashment request.');
      setEncashMessage('Request submitted — your admin will review it.');
      setEncashDays('1');
      setEncashReason('');
    } catch (err: any) {
      setEncashMessage(err.message || 'Failed to submit encashment request.');
    } finally {
      setEncashSubmitting(false);
    }
  };

  const refreshPayrollData = async () => {
    const payrollRes = await fetch('/api/payroll/mine', { headers: authHeaders });
    if (!payrollRes.ok) throw new Error('Failed to load payroll details.');
    const payrollJson = await payrollRes.json();
    setPayrollData({
      summary: payrollJson.summary || null,
      profile: payrollJson.profile || null,
      components: payrollJson.components || [],
    });
    return payrollJson;
  };

  // Snapshots (idempotently, server-side) the current month's payslip into
  // history the first time this loads in a given period, then returns every
  // period recorded so far — see GET /api/payroll/history.
  const refreshPayslipHistory = async () => {
    const res = await fetch('/api/payroll/history', { headers: authHeaders });
    if (!res.ok) return;
    const data = await res.json();
    setPayslipHistory(data.history || []);
  };

  const downloadPayslip = async (runId: number, year: number, month: number) => {
    const res = await fetch(`/api/payroll/history/${runId}/pdf`, { headers: authHeaders });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payslip-${year}-${String(month).padStart(2, '0')}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const refreshOptionalHolidayData = async () => {
    const optionalRes = await fetch('/api/tenant/holidays/optional', { headers: authHeaders });
    if (!optionalRes.ok) throw new Error('Failed to load optional holidays.');
    const optionalJson = await optionalRes.json();
    setOptionalHolidayData({
      limit: optionalJson.limit || 0,
      holidays: optionalJson.holidays || [],
    });
    setSelectedOptionalHolidayIds((optionalJson.holidays || []).filter((holiday: any) => holiday.selected).map((holiday: any) => holiday.id));
    return optionalJson;
  };

  useEffect(() => {
    (async () => {
      try {
        const todayRes = await fetch('/api/attendance/today', { headers: authHeaders });
        const todayData = await todayRes.json();
        const state = todayData.state || 'not_started';
        setTodayState(state);
        setTodayPending(!!todayData.pending);
        setCheckInTime(todayData.log?.createdAt || null);

        const [pctRes, corrRes, wfhRes, histRes, holidaysRes, teamRes, policyRes] = await Promise.all([
          fetch('/api/attendance/percentage', { headers: authHeaders }).catch(() => null),
          fetch('/api/attendance/corrections/mine', { headers: authHeaders }).catch(() => null),
          fetch('/api/attendance/wfh/eligibility', { headers: authHeaders }).catch(() => null),
          fetch('/api/attendance/mine?limit=60', { headers: authHeaders }).catch(() => null),
          fetch('/api/tenant/holidays', { headers: authHeaders }).catch(() => null),
          fetch('/api/employees/my-team', { headers: authHeaders }).catch(() => null),
          fetch('/api/tenant/policy', { headers: authHeaders }).catch(() => null),
        ]);
        const [leaveResult, payrollResult] = await Promise.all([
          refreshLeaveData().catch(() => null),
          refreshPayrollData().catch(() => null),
          refreshPayslipHistory().catch(() => null),
        ]);
        if (pctRes?.ok) { const p = await pctRes.json(); setAttendancePercent(p.percentage); setAttendanceThreshold(p.threshold ?? 75); }
        if (corrRes?.ok) { const c = await corrRes.json(); setCorrections(c.corrections || []); }
        // Always land on either "eligible" or a reason string — never leave
        // both empty, or the WFH card silently disappears instead of
        // showing a disabled state (a real bug: a failed/slow network
        // request used to make the whole card vanish rather than degrade).
        if (wfhRes?.ok) {
          const w = await wfhRes.json();
          setWfhEligible(!!w.eligible);
          setWfhReasonMsg(!w.eligible ? (w.reason || 'Work From Home is not available right now.') : '');
        } else {
          setWfhEligible(false);
          setWfhReasonMsg('Could not check Work From Home eligibility. Try refreshing.');
        }
        if (histRes?.ok) { const h = await histRes.json(); setAttendanceHistory(h.logs || []); }
        if (holidaysRes?.ok) {
          const hd = await holidaysRes.json();
          setAllHolidays(hd.holidays || []);
          const todayStr = new Date().toISOString().slice(0, 10);
          const upcoming = (hd.holidays || [])
            .filter((holiday: any) => String(holiday.date).slice(0, 10) >= todayStr)
            .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)))
            .slice(0, 5);
          setUpcomingHolidays(upcoming);
        }
        if (teamRes?.ok) { const t = await teamRes.json(); setMyTeam({ manager: t.manager || null, colleagues: t.colleagues || [] }); }
        if (policyRes?.ok) { const pl = await policyRes.json(); setPolicyAnnouncement(pl.policyAnnouncement || ''); }
        if (leaveResult?.policies?.length) setLeavePolicyId((current: string) => current || String(leaveResult.policies[0].id));

        if (state === 'checked_in') {
          await Promise.all([fetchActiveBreak(), fetchBreaksToday()]);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!leaveData?.policies?.length) return;
    setLeavePolicyId((current) => current || String(leaveData.policies[0].id));
  }, [leaveData]);

  useEffect(() => {
    if (tab !== 'leave-pay') return;
    refreshOptionalHolidayData().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const year = attendanceCalendarMonth.getFullYear();
        const month = attendanceCalendarMonth.getMonth() + 1;
        const res = await fetch(`/api/attendance/mine?year=${year}&month=${month}`, { headers: authHeaders });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        if (!cancelled) setAttendanceCalendarRows(Array.isArray(data.logs) ? data.logs : []);
      } catch {
        if (!cancelled) setAttendanceCalendarRows([]);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendanceCalendarMonth]);

  // Live "hours worked" ticker
  useEffect(() => {
    if (!checkInTime || todayState !== 'checked_in') return;
    const update = () => {
      const diff = Date.now() - new Date(checkInTime).getTime();
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setHoursWorked(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [checkInTime, todayState]);

  // Live break timer
  useEffect(() => {
    let iv: any;
    if (activeBreak) {
      iv = setInterval(() => {
        const diff = Date.now() - new Date(activeBreak.startTime).getTime();
        const mins = Math.floor(diff / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        setBreakTimer(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
      }, 1000);
    } else setBreakTimer('00:00');
    return () => clearInterval(iv);
  }, [activeBreak]);

  const getFreshLocation = (): Promise<{ lat: number, lng: number }> =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Geolocation is not supported on this device.'));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        // Distinct, actionable messages instead of always blaming "permission".
        (err) => reject(new Error(
          err.code === err.TIMEOUT
            ? 'Could not get a GPS fix in time. Move somewhere with a clearer signal and try again.'
            : err.code === err.PERMISSION_DENIED
              ? 'Location permission is required for breaks. Enable it in your browser and try again.'
              : 'Could not read your GPS location. Please try again.'
        )),
        // timeout: never hang forever waiting for a fix (the default) — that's
        // what made the buttons feel dead on mobile indoors. maximumAge: a
        // fix from the last 30s is fine for "are you still at the office" and
        // returns instantly instead of forcing a slow fresh high-accuracy fix.
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
      );
    });

  const fetchActiveBreak = async () => {
    try { const r = await fetch('/api/breaks/active', { headers: authHeaders }); const d = await r.json(); setActiveBreak(d.active || null); } catch (e) { console.error(e); }
  };
  const fetchBreaksToday = async () => {
    try { const r = await fetch('/api/breaks/today', { headers: authHeaders }); const d = await r.json(); setBreaksToday(d.sessions || []); setBudgetMins(d.budgetMins ?? 60); setRemainingMins(d.remainingMins ?? 60); } catch (e) { console.error(e); }
  };

  const handleStartBreak = async () => {
    if (breakBusy) return; // ignore double-taps while a request is already in flight
    setError(''); setSuccess(''); setBreakBusy(true);
    try {
      const coords = await getFreshLocation();
      const r = await fetch('/api/breaks/start', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ breakType, lat: coords.lat, lng: coords.lng, note: breakNote.trim() || undefined }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setActiveBreak(d.session);
      setBreakNote('');
    } catch (err: any) { setError(err.message || 'Failed to start break'); }
    finally { setBreakBusy(false); }
  };
  const handleEndBreak = async () => {
    if (breakBusy) return; // ignore double-taps while a request is already in flight
    setError(''); setSuccess(''); setBreakBusy(true);
    try {
      const coords = await getFreshLocation();
      const r = await fetch('/api/breaks/end', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ lat: coords.lat, lng: coords.lng, clientTimestamp: new Date().toISOString() }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setActiveBreak(null);
      fetchBreaksToday();
      setSuccess(d.isViolation ? 'Work resumed — this break exceeded the budget and was flagged.' : 'Work session resumed.');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to end break');
      // The end-break request can be rejected server-side (e.g. a GPS-drift
      // geofence check) while the break stays OPEN in the database. Re-sync
      // from the server so the UI keeps showing "On Break" — otherwise the
      // user thinks the break ended, then checkout mysteriously blocks them
      // with "you're currently on break".
      fetchActiveBreak();
    }
    finally { setBreakBusy(false); }
  };
  const handleCheckout = async () => {
    setError(''); setCheckingOut(true);
    try {
      const r = await fetch('/api/attendance/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ clientTimestamp: new Date().toISOString() }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to check out.');
      setTodayState('checked_out');
      setSuccess('Checked out. See you next time!');
    } catch (err: any) { setError(err.message || 'Failed to check out.'); } finally { setCheckingOut(false); }
  };

  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctionDate || !correctionReason) return;
    setCorrectionSubmitting(true); setError('');
    try {
      const r = await fetch('/api/attendance/corrections', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ requestType: correctionType, requestedDate: correctionDate, requestedTime: correctionTime || undefined, reason: correctionReason }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to submit request');
      setCorrectionSubmitted(true); setCorrectionDate(''); setCorrectionTime(''); setCorrectionReason('');
      const cr = await fetch('/api/attendance/corrections/mine', { headers: authHeaders }); const cd = await cr.json(); setCorrections(cd.corrections || []);
      setTimeout(() => { setShowCorrectionModal(false); setCorrectionSubmitted(false); }, 1800);
    } catch (err: any) { setError(err.message || 'Failed to submit request'); } finally { setCorrectionSubmitting(false); }
  };

  const handleSubmitLeaveRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leavePolicyId || !leaveStartDate || !leaveEndDate || !leaveReason.trim()) return;
    const selectedPolicy = leaveData?.policies?.find((policy: any) => String(policy.id) === leavePolicyId);
    setLeaveSubmitting(true);
    setError('');
    try {
      const r = await fetch('/api/leave/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          policyId: Number(leavePolicyId),
          leaveType: selectedPolicy?.code || selectedPolicy?.name || leavePolicyId,
          startDate: leaveStartDate,
          endDate: leaveEndDate,
          reason: leaveReason.trim(),
          medicalCause: leaveMedicalCause,
          halfDay: leaveHalfDay,
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to submit leave request.');
      await Promise.all([refreshLeaveData(), refreshPayrollData()]);
      setLeaveReason('');
      setLeaveMedicalCause(false);
      setLeaveHalfDay(false);
      setLeaveStartDate('');
      setLeaveEndDate('');
      setSuccess(selectedPolicy?.requiresApproval === false ? 'Leave recorded successfully.' : 'Leave request submitted for approval.');
      setTimeout(() => setSuccess(''), 4000);
      setApplyLeaveModalOpen(false);
    } catch (err: any) {
      setError(err.message || 'Failed to submit leave request.');
    } finally {
      setLeaveSubmitting(false);
    }
  };

  const handleOptionalHolidayToggle = (holidayId: number) => {
    setSelectedOptionalHolidayIds((current) => {
      if (current.includes(holidayId)) return current.filter((id) => id !== holidayId);
      const limit = optionalHolidayData?.limit ?? 0;
      if (limit > 0 && current.length >= limit) {
        setError(`You can only choose up to ${limit} optional holidays.`);
        setTimeout(() => setError(''), 3000);
        return current;
      }
      return [...current, holidayId];
    });
  };

  const handleSaveOptionalHolidays = async () => {
    setOptionalHolidaySaving(true);
    setError('');
    try {
      const r = await fetch('/api/tenant/holidays/optional', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ holidayIds: selectedOptionalHolidayIds })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to save optional holidays.');
      await Promise.all([refreshOptionalHolidayData(), refreshLeaveData()]);
      setSuccess('Optional holidays updated.');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to save optional holidays.');
    } finally {
      setOptionalHolidaySaving(false);
    }
  };

  const budgetUsedPct = budgetMins > 0 ? Math.min(100, Math.round(((budgetMins - remainingMins) / budgetMins) * 100)) : 0;
  const breakDurationMins = (b: any) => {
    const start = new Date(b.startTime).getTime();
    const end = b.endTime ? new Date(b.endTime).getTime() : Date.now();
    return Math.max(0, Math.round((end - start) / 60000));
  };
  const totalBreakMinsToday = useMemo(() => breaksToday.reduce((sum, b) => sum + breakDurationMins(b), 0), [breaksToday]);
  const breakBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    breaksToday.forEach((b) => {
      const type = b.breakType || 'General';
      map.set(type, (map.get(type) || 0) + breakDurationMins(b));
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [breaksToday]);
  const selectedLeavePolicy = leaveData?.policies?.find((policy: any) => String(policy.id) === leavePolicyId) || null;

  // "Attendance this month" hero stat — derived from the same
  // attendanceHistory already fetched for the Last 28 Days calendar (no new
  // API call): distinct calendar dates this month with an approved check-in,
  // out of the weekdays (Mon–Fri) that have elapsed in the month so far.
  const attendanceThisMonth = (() => {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const presentDates = new Set<string>();
    attendanceHistory.forEach((log: any) => {
      if (log.type !== 'check_in' || log.status !== 'approved' || !log.createdAt) return;
      const d = new Date(log.createdAt);
      const key = d.toISOString().slice(0, 10);
      if (key.startsWith(monthKey)) presentDates.add(key);
    });
    let workingDaysSoFar = 0;
    for (let day = 1; day <= now.getDate(); day++) {
      const d = new Date(now.getFullYear(), now.getMonth(), day);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) workingDaysSoFar++;
    }
    return { presentDays: presentDates.size, workingDaysSoFar };
  })();

  // Total hours worked this month — attendance_logs stores one row per event
  // (a check_in row, a separate check_out row), not a paired start/end per
  // day, so this pairs each day's earliest check_in with its next check_out
  // on/after it and sums the deltas. Deliberately no "+X% vs last month"
  // trend here: the /api/attendance/mine?limit=60 fetch this reads from
  // isn't guaranteed to cover a full prior month, so that comparison isn't
  // reliably computable from what's already on the page.
  const totalHoursThisMonth = useMemo(() => {
    const now = new Date();
    const monthKey = attendanceMonthKey(now);
    const byDay = new Map<string, any[]>();
    attendanceHistory.forEach((log: any) => {
      if (!log.createdAt || log.status !== 'approved') return;
      if (log.type !== 'check_in' && log.type !== 'check_out') return;
      const d = new Date(log.createdAt);
      if (attendanceMonthKey(d) !== monthKey) return;
      const dayKey = attendanceDateKey(d);
      const list = byDay.get(dayKey) || [];
      list.push(log);
      byDay.set(dayKey, list);
    });
    let totalMs = 0;
    byDay.forEach((logs) => {
      const sorted = [...logs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const checkIn = sorted.find((l) => l.type === 'check_in');
      if (!checkIn) return;
      const checkOut = sorted.find((l) => l.type === 'check_out' && new Date(l.createdAt).getTime() >= new Date(checkIn.createdAt).getTime());
      if (!checkOut) return;
      totalMs += new Date(checkOut.createdAt).getTime() - new Date(checkIn.createdAt).getTime();
    });
    const totalHours = totalMs / (1000 * 60 * 60);
    return `${totalHours.toFixed(1)}h`;
  }, [attendanceHistory]);

  // Month grid for the "Leave History" calendar view — marks this
  // employee's own leave-request days (colored by status) and company
  // holidays. Built entirely from leaveData.requests + allHolidays, both
  // already fetched for the list view above — no new endpoint.
  const leaveCalendarCells = (() => {
    const year = leaveCalendarMonth.getFullYear();
    const month = leaveCalendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOffset = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const holidaySet = new Map<string, string>();
    allHolidays.forEach((h: any) => holidaySet.set(h.date, h.name));
    const requests = leaveData?.requests || [];
    const cells: Array<{ dateKey: string; dayNum: number; inMonth: boolean; leave: any | null; holidayName: string | null }> = [];
    for (let i = 0; i < startOffset; i++) cells.push({ dateKey: `pad-${i}`, dayNum: 0, inMonth: false, leave: null, holidayName: null });
    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const leave = requests.find((r: any) => r.startDate <= dateKey && r.endDate >= dateKey) || null;
      cells.push({ dateKey, dayNum: day, inMonth: true, leave, holidayName: holidaySet.get(dateKey) || null });
    }
    return cells;
  })();
  const leaveBalanceTotal = (leaveData?.balances || []).reduce((sum: number, b: any) => {
    const maxDays = Number(b.maxDaysPerYear || 0);
    const used = Number(b.usedDays || 0);
    const adjustment = Number(b.adjustmentDays || 0);
    const available = b.remainingDays != null ? Number(b.remainingDays) : Math.max(0, maxDays + adjustment - used);
    return sum + available;
  }, 0);

  const attendanceCalendarCells = useMemo(() => {
    const year = attendanceCalendarMonth.getFullYear();
    const month = attendanceCalendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOffset = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayKey = attendanceDateKey(new Date());

    const attendanceByDate = new Map<string, { approvedCheckIn: any | null; pendingCheckIn: any | null }>();
    attendanceCalendarRows.forEach((log: any) => {
      if (!log.createdAt || log.type !== 'check_in') return;
      const key = attendanceDateKey(new Date(log.createdAt));
      const entry = attendanceByDate.get(key) || { approvedCheckIn: null, pendingCheckIn: null };
      if (log.status === 'approved') entry.approvedCheckIn = log;
      if (log.status === 'pending') entry.pendingCheckIn = log;
      attendanceByDate.set(key, entry);
    });

    const holidayByDate = new Map<string, string>();
    allHolidays.forEach((holiday: any) => holidayByDate.set(String(holiday.date).slice(0, 10), holiday.name));

    const leaveRanges = (leaveData?.requests || [])
      .filter((request: any) => request.status === 'approved')
      .map((request: any) => {
        const isHalfDay = Number(request.totalDays || 0) === 0.5 || !!request.halfDay;
        const isPaid = isPaidLeaveRequest(request, leaveData?.policies || []);
        return {
          start: String(request.startDate).slice(0, 10),
          end: String(request.endDate).slice(0, 10),
          label: isHalfDay ? 'Half-day' : isPaid ? 'Paid Leave' : 'Leave',
          status: isHalfDay ? 'half_day' : isPaid ? 'paid_leave' : 'leave',
        };
      });

    const cells: Array<{ dateKey: string; dayNum: number; inMonth: boolean; status: AttendanceCalendarStatus; label: string }> = [];

    for (let index = 0; index < startOffset; index++) {
      cells.push({ dateKey: `pad-${index}`, dayNum: 0, inMonth: false, status: 'none', label: '' });
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dateKey = attendanceDateKey(date);
      const entry = attendanceByDate.get(dateKey);
      const holidayName = holidayByDate.get(dateKey) || null;
      const leave = leaveRanges.find((range) => dateKey >= range.start && dateKey <= range.end) || null;
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;

      let status: AttendanceCalendarStatus;
      if (entry?.approvedCheckIn) status = 'present';
      else if (entry?.pendingCheckIn) status = 'late';
      else if (holidayName) status = 'holiday';
      else if (leave) status = leave.status;
      else if (dateKey > todayKey) status = 'future';
      else if (isWeekend) status = 'weekend';
      else status = 'absent';

      const label = holidayName || leave?.label || ATTENDANCE_CALENDAR_LABELS[status];
      cells.push({ dateKey, dayNum: day, inMonth: true, status, label });
    }

    return cells;
  }, [attendanceCalendarMonth, attendanceCalendarRows, allHolidays, leaveData?.policies, leaveData?.requests]);

  const navItems: PortalNavItem[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'attendance', label: 'My Attendance', icon: Clock, count: attendanceHistory.length || undefined },
    ...(todayState === 'checked_in' ? [{ id: 'breaks', label: 'Breaks & Checkout', icon: Coffee } as PortalNavItem] : []),
    { id: 'earnings', label: 'Earnings', icon: Wallet },
    { id: 'leave-pay', label: 'Leave & Payroll', icon: Banknote, count: leaveData?.requests?.filter((r: any) => r.status === 'pending').length || undefined },
    { id: 'requests', label: 'My Requests', icon: ClipboardCheck, count: corrections.filter(c => c.status === 'pending').length || undefined },
    { id: 'tickets', label: 'Tickets', icon: Ticket },
  ];
  const titleFor = navItems.find(n => n.id === tab)?.label || 'Overview';

  const leaveHistoryColumns: ColumnDef<any, any>[] = [
    { accessorKey: 'leaveType', header: 'Type', cell: ({ getValue }) => <span className="font-bold text-[var(--color-nexus-ink)]">{getValue() as string}</span> },
    { id: 'dates', accessorKey: 'startDate', header: 'Dates', cell: ({ row }) => <span className="text-[var(--color-nexus-muted)]">{row.original.startDate} to {row.original.endDate}</span> },
    { accessorKey: 'totalDays', header: 'Duration', cell: ({ getValue }) => <span className="text-[var(--color-nexus-muted)]">{getValue() as number} day(s)</span> },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => { const s = getValue() as string; return <StatusPill tone={s === 'approved' ? 'success' : s === 'rejected' ? 'error' : 'warning'} dot>{s}</StatusPill>; } },
  ];

  const payslipHistoryColumns: ColumnDef<any, any>[] = [
    { id: 'period', header: 'Pay Period', cell: ({ row }) => <span className="font-bold text-[var(--color-nexus-ink)]">{new Date(Date.UTC(row.original.year, row.original.month - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span> },
    { id: 'generated', header: 'Generated', cell: ({ row }) => <span className="text-[var(--color-nexus-muted)]">{new Date(row.original.createdAt).toLocaleDateString()}</span> },
    { accessorKey: 'grossPay', header: 'Gross Pay', cell: ({ getValue }) => <span>{Math.round(getValue() as number).toLocaleString()}</span> },
    { accessorKey: 'netPay', header: 'Net Pay', cell: ({ getValue }) => <span className="font-bold">{Math.round(getValue() as number).toLocaleString()}</span> },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusPill tone="success" dot>{getValue() as string}</StatusPill> },
    { id: 'download', header: 'Action', enablePinning: false, cell: ({ row }) => (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); downloadPayslip(row.original.id, row.original.year, row.original.month); }}
        className="text-[var(--color-nexus-primary)] hover:underline text-xs font-bold uppercase tracking-wider"
      >
        Download
      </button>
    ) },
  ];

  const historyColumns: ColumnDef<any, any>[] = [
    { accessorKey: 'createdAt', header: 'Date', cell: ({ getValue }) => <span className="text-[var(--color-nexus-muted)]">{new Date(getValue() as string).toLocaleDateString()}</span> },
    { id: 'time', accessorKey: 'createdAt', header: 'Time', cell: ({ getValue }) => <span className="font-mono text-[11px] text-[var(--color-nexus-muted)]">{new Date(getValue() as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> },
    { accessorKey: 'type', header: 'Type', cell: ({ getValue }) => <span className="text-[var(--color-nexus-ink)] text-[11px]">{String(getValue() || '').replace('_', ' ')}</span> },
    { accessorKey: 'attendanceMode', header: 'Mode', cell: ({ getValue }) => { const m = (getValue() as string) || 'office'; return <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${m === 'wfh' ? 'bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)]' : m === 'qr' ? 'bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-secondary)]' : 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)]'}`}>{m}</span>; } },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => { const s = getValue() as string; return <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${s === 'approved' ? 'bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)]' : s === 'pending' ? 'bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-secondary)]' : 'bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)]'}`}>{s}</span>; } },
  ];

  if (loading) {
    return <div className="min-h-screen premium-mesh-bg flex items-center justify-center font-mono text-xs uppercase tracking-widest text-[var(--color-nexus-muted)]">Loading...</div>;
  }

  const alreadyDone = todayState === 'checked_out';
  const tile = 'nexus-card  rise-in rounded-2xl p-5';

  return (
    <PortalShell
      user={user}
      roleLabel={user.role}
      navItems={navItems}
      activeTab={tab}
      onTabChange={setTab}
      onLogout={onLogout}
      title={titleFor}
      fallbackHref="/"
    >
      {error && <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-4 rounded-xl mb-6 border border-[var(--color-nexus-error)]/20 font-medium">{error}</div>}
      {success && <div className="bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-secondary)] text-xs p-4 rounded-xl mb-6 border border-[var(--color-nexus-secondary)]/30 font-medium">{success}</div>}

      {/* OVERVIEW */}
      {tab === 'overview' && (
        <div className="space-y-6">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <h2 className="text-2xl font-extrabold font-sans text-gradient inline-block">Welcome, {user.name?.split(' ')[0] || 'there'}</h2>
            <p className="text-sm text-[var(--color-nexus-muted)] mt-1">
              {alreadyDone ? "You've completed your attendance for today." : todayState === 'checked_in' ? 'You are checked in. Have a productive day.' : 'How would you like to mark your attendance?'}
            </p>
          </motion.div>

          {todayPending && (
            <div className="p-3 rounded-xl bg-[var(--color-nexus-secondary-container)] border border-[var(--color-nexus-secondary)]/40 text-center">
              <p className="text-[10px] font-bold text-[var(--color-nexus-secondary)] uppercase tracking-wider">Late check-in pending manager approval</p>
            </div>
          )}

          <PushNotificationToggle />

          {policyAnnouncement && (
            <div className="nexus-card p-4 bg-[var(--color-nexus-primary-container)] text-white">
              <div className="flex items-center gap-2 mb-1.5">
                <Megaphone size={16} className="text-[var(--color-nexus-tertiary-fixed)]" />
                <h3 className="text-sm font-bold">Company Policy</h3>
              </div>
              <p className={`text-sm text-white/80 leading-relaxed ${policyExpanded ? '' : 'line-clamp-2'}`}>{policyAnnouncement}</p>
              <button type="button" onClick={() => setPolicyExpanded((v) => !v)} className="text-xs font-bold text-[var(--color-nexus-tertiary-fixed)] mt-1.5 hover:underline">
                {policyExpanded ? 'Show less' : 'Read more'}
              </button>
            </div>
          )}

          {/* Quick actions (only when not yet checked in today) */}
          {todayState === 'not_started' && (
            <div className="grid sm:grid-cols-2 gap-4">
              <button onClick={() => navigate('/employee/attendance?mode=office')} className={`${tile} !bg-[var(--color-nexus-primary)] text-white flex items-center gap-4 text-left`}>
                <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center shrink-0 float-c"><Fingerprint size={24} /></div>
                <div><span className="block font-bold">Mark Attendance</span><span className="block text-[11px] text-white/80 mt-0.5">Verify with your device at the office</span></div>
              </button>
              {wfhEligible ? (
                <button onClick={() => navigate('/employee/attendance?mode=wfh')} className={`${tile} flex items-center gap-4 text-left`}>
                  <div className="w-12 h-12 rounded-xl bg-[var(--color-nexus-primary-fixed)] flex items-center justify-center shrink-0 float-b"><HomeIcon size={24} className="text-[var(--color-nexus-primary)]" /></div>
                  <div><span className="block font-bold text-[var(--color-nexus-ink)]">Work From Home</span><span className="block text-[11px] text-[var(--color-nexus-muted)] mt-0.5">Check in from your registered home</span></div>
                </button>
              ) : wfhReasonMsg ? (
                <div className={`${tile} flex items-center gap-4 opacity-70`}>
                  <div className="w-12 h-12 rounded-xl bg-[var(--color-nexus-border)]/40 flex items-center justify-center shrink-0"><HomeIcon size={24} className="text-[var(--color-nexus-muted)]" /></div>
                  <div><span className="block font-bold text-[var(--color-nexus-muted)]">Work From Home</span><span className="block text-[11px] text-[var(--color-nexus-muted)] mt-0.5">{wfhReasonMsg}</span></div>
                </div>
              ) : null}
            </div>
          )}
          {todayState === 'checked_in' && (
            <button onClick={() => setTab('breaks')} className={`${tile} w-full !bg-[var(--color-nexus-secondary)] text-white flex items-center gap-4 text-left`}>
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center shrink-0 float-c"><Coffee size={24} /></div>
              <div><span className="block font-bold">Breaks & Checkout</span><span className="block text-[11px] text-white/80 mt-0.5">Manage breaks or check out for the day</span></div>
            </button>
          )}

          {/* Hero stat row — Attendance This Month (solid blue "hero" card,
              matching the reference design's single filled tile among
              otherwise white-bordered cards), Upcoming Payslip, Leave
              Balance. All derived from data already fetched above (no
              fabricated numbers): attendanceThisMonth from attendanceHistory,
              payrollData.summary.monthlyNet from /api/payroll/mine,
              leaveBalanceTotal summed from leaveData.balances. */}
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="rounded-[12px] p-5 bg-[var(--color-nexus-primary)] text-white">
              <span className="block text-xs font-medium text-white/80">Attendance This Month</span>
              <span className="block text-[28px] leading-tight font-bold mt-2">{attendanceThisMonth.presentDays} days present</span>
              <span className="block text-xs text-white/80 mt-1">out of {attendanceThisMonth.workingDaysSoFar} working days so far</span>
            </div>
            <button onClick={() => setTab('leave-pay')} className="text-left nexus-card p-5">
              <span className="block text-xs font-medium text-[var(--color-nexus-muted)]">Upcoming Payslip</span>
              <span className="block text-[28px] leading-tight font-bold text-[var(--color-nexus-ink)] mt-2">
                {payrollData?.summary ? `₹${Math.round(payrollData.summary.monthlyNet).toLocaleString()}` : '—'}
              </span>
              <span className="block text-xs text-[var(--color-nexus-muted)] mt-1">
                {payrollData?.summary ? `${new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} · net pay` : 'Payroll not configured yet'}
              </span>
            </button>
            <button onClick={() => setTab('leave-pay')} className="text-left nexus-card p-5">
              <span className="block text-xs font-medium text-[var(--color-nexus-muted)]">Leave Balance</span>
              <span className="block text-[28px] leading-tight font-bold text-[var(--color-nexus-ink)] mt-2">
                {leaveData?.balances?.length ? `${leaveBalanceTotal} days` : '—'}
              </span>
              <span className="block text-xs text-[var(--color-nexus-muted)] mt-1">remaining across all types</span>
            </button>
          </div>

          {/* Status tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Checked In"
              icon={Clock}
              value={checkInTime && todayState !== 'not_started' ? new Date(checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
            />
            <StatCard
              label="Hours Today"
              icon={AlarmClock}
              iconBg="var(--color-nexus-secondary-container)"
              iconColor="var(--color-nexus-secondary)"
              value={todayState === 'checked_in' ? hoursWorked : '—'}
            />
            <StatCard
              label="Attendance"
              icon={CheckCircle2}
              iconBg={attendancePercent !== null && attendancePercent < attendanceThreshold ? 'var(--color-nexus-error-soft)' : 'var(--color-nexus-tertiary-fixed)'}
              iconColor={attendancePercent !== null && attendancePercent < attendanceThreshold ? 'var(--color-nexus-error)' : 'var(--color-nexus-ink)'}
              value={attendancePercent !== null ? `${attendancePercent}%` : '—'}
              caption={`min ${attendanceThreshold}%`}
            />
            <StatCard
              label="Pending Requests"
              icon={ClipboardCheck}
              value={corrections.filter(c => c.status === 'pending').length}
            />
          </div>

          {/* Total Hours This Month + Last Leave Request */}
          <div className="grid sm:grid-cols-2 gap-4">
            <button onClick={() => setTab('attendance')} className="text-left nexus-card p-5 hover:bg-[var(--color-nexus-surface-alt)] transition-colors">
              <span className="block text-xs font-medium text-[var(--color-nexus-muted)] uppercase tracking-wider">Total Hours This Month</span>
              <span className="block text-[28px] leading-tight font-bold text-[var(--color-nexus-ink)] mt-2">{totalHoursThisMonth}</span>
              <span className="block text-xs font-bold text-[var(--color-nexus-primary)] mt-1">View Timesheet →</span>
            </button>
            {(() => {
              const lastRequest = leaveData?.requests?.length
                ? [...leaveData.requests].sort((a: any, b: any) => String(b.startDate).localeCompare(String(a.startDate)))[0]
                : null;
              return (
                <div className="nexus-card p-5">
                  <span className="block text-xs font-medium text-[var(--color-nexus-muted)] uppercase tracking-wider mb-2">Last Leave Request</span>
                  {lastRequest ? (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-[var(--color-nexus-ink)]">{lastRequest.leaveType}</span>
                        <StatusPill tone={lastRequest.status === 'approved' ? 'success' : lastRequest.status === 'rejected' ? 'error' : 'warning'}>{lastRequest.status}</StatusPill>
                      </div>
                      <span className="block text-xs text-[var(--color-nexus-muted)] mt-1">{lastRequest.startDate} to {lastRequest.endDate} ({lastRequest.totalDays} day{lastRequest.totalDays === 1 ? '' : 's'})</span>
                      {lastRequest.status === 'pending' && (
                        <span className="block text-xs text-[var(--color-nexus-secondary)] font-semibold mt-1">Waiting for manager approval</span>
                      )}
                    </>
                  ) : (
                    <span className="text-sm text-[var(--color-nexus-muted)]">No leave requests yet.</span>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Personal attendance timeline — available to every clock-in role
              (employee, manager, HR, GM, custom staff roles) as an Overview
              option; tenant_admin/super_admin never reach this page at all
              (canClockIn() in AdminApp.tsx routes them to /dashboard instead),
              so no extra role check is needed here. */}
          <AttendanceTimeline
            attendanceHistory={attendanceHistory}
            leaveRequests={leaveData?.requests || []}
            holidays={allHolidays}
            todayState={todayState}
            todayPending={todayPending}
            checkInTime={checkInTime}
            hoursWorked={hoursWorked}
            onMarkAttendance={() => navigate('/employee/attendance?mode=office')}
            authHeaders={authHeaders}
          />

          <div className="grid md:grid-cols-2 gap-4">
            <button onClick={() => setTab('leave-pay')} className={`${tile} text-left flex items-center gap-4`}>
              <div className="w-12 h-12 rounded-xl bg-[var(--color-nexus-primary-fixed)] flex items-center justify-center shrink-0">
                <CalendarDays size={22} className="text-[var(--color-nexus-primary)]" />
              </div>
              <div>
                <span className="block font-bold text-[var(--color-nexus-ink)]">Leave Tracker</span>
                <span className="block text-[11px] text-[var(--color-nexus-muted)] mt-0.5">
                  {leaveData ? `${leaveData.requests.filter((r: any) => r.status === 'pending').length} pending request(s)` : 'View balances and request history'}
                </span>
              </div>
            </button>
            <button onClick={() => setTab('leave-pay')} className={`${tile} text-left flex items-center gap-4`}>
              <div className="w-12 h-12 rounded-xl bg-[var(--color-nexus-secondary-container)] flex items-center justify-center shrink-0">
                <Banknote size={22} className="text-[var(--color-nexus-secondary)]" />
              </div>
              <div>
                <span className="block font-bold text-[var(--color-nexus-ink)]">Payroll Snapshot</span>
                <span className="block text-[11px] text-[var(--color-nexus-muted)] mt-0.5">
                  {payrollData?.summary ? `Monthly net ${Math.round(payrollData.summary.monthlyNet).toLocaleString()}` : 'Payroll not configured yet'}
                </span>
              </div>
            </button>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="nexus-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Megaphone size={16} className="text-[var(--color-nexus-primary)]" />
                <h2 className="text-base font-bold text-[var(--color-nexus-ink)]">Announcements</h2>
              </div>
              {upcomingHolidays.length === 0 ? (
                <p className="text-sm text-[var(--color-nexus-muted)]">No upcoming holidays on the company calendar yet.</p>
              ) : (
                <div className="divide-y divide-[var(--color-nexus-border)]">
                  {upcomingHolidays.map((holiday: any) => (
                    <div key={holiday.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="shrink-0 rounded-lg bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] text-[11px] font-bold px-2.5 py-1.5 text-center leading-tight">
                        {new Date(`${holiday.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </div>
                      <div className="min-w-0">
                        <span className="block font-bold text-sm text-[var(--color-nexus-ink)] truncate">{holiday.name}</span>
                        <span className="block text-xs text-[var(--color-nexus-muted)] mt-0.5">Company holiday</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="nexus-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Users size={16} className="text-[var(--color-nexus-secondary)]" />
                <h2 className="text-base font-bold text-[var(--color-nexus-ink)]">Your Team</h2>
              </div>
              {!myTeam || (!myTeam.manager && myTeam.colleagues.length === 0) ? (
                <p className="text-sm text-[var(--color-nexus-muted)]">No team members are linked to your profile yet.</p>
              ) : (
                <div className="space-y-3">
                  {myTeam.manager && (
                    <>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 shrink-0 rounded-full bg-[var(--color-nexus-secondary)] text-white flex items-center justify-center text-xs font-bold">
                          {(myTeam.manager.name || '?').split(' ').filter(Boolean).slice(0, 2).map((p: string) => p[0]?.toUpperCase()).join('')}
                        </div>
                        <div className="min-w-0">
                          <span className="block font-bold text-sm text-[var(--color-nexus-ink)] truncate">{myTeam.manager.name}</span>
                          <span className="block text-xs text-[var(--color-nexus-muted)] truncate">{myTeam.manager.designation || 'Engineering Manager'}</span>
                        </div>
                      </div>
                      <div className="border-t border-[var(--color-nexus-border)]" />
                    </>
                  )}
                  <div className="space-y-2.5">
                    {myTeam.colleagues.map((colleague: any, i: number) => (
                      <div key={colleague.id} className="flex items-center gap-2.5">
                        <div className={`w-7 h-7 shrink-0 rounded-full ${['bg-sky-500', 'bg-orange-500', 'bg-violet-500', 'bg-emerald-500', 'bg-pink-500'][i % 5]} text-white flex items-center justify-center text-[10px] font-bold`}>
                          {(colleague.name || '?').split(' ').filter(Boolean).slice(0, 2).map((p: string) => p[0]?.toUpperCase()).join('')}
                        </div>
                        <span className="text-sm text-[var(--color-nexus-ink)] truncate">{colleague.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <ShiftSwapWidget colleagues={myTeam?.colleagues || []} />
          <MyActivityPanel />

          {user.role !== 'employee' && user.role !== 'intern' && (
            <button onClick={() => navigate('/dashboard')} className={`${tile} w-full text-left flex items-center justify-between gap-4`}>
              <div>
                <span className="block font-bold text-[var(--color-nexus-ink)]">Management Dashboard</span>
                <span className="block text-[11px] text-[var(--color-nexus-muted)] mt-0.5">Open approvals, reports, payroll, and team operations after marking your own attendance.</span>
              </div>
              <span className="text-[10px] uppercase font-bold text-[var(--color-nexus-primary)]">Open</span>
            </button>
          )}
        </div>
      )}

      {/* MY ATTENDANCE — the day-by-day timeline itself now lives on
          Overview (see above); this tab keeps the full tabular history. */}
      {tab === 'attendance' && (
        <div className="space-y-6">
          {/* Stat row — counts derived from the same attendanceCalendarCells
              already computed for the calendar below (current visible
              month), matching the reference's attendance-history stat strip.
              No fabricated averages: hours-worked-per-day isn't tracked
              anywhere in attendanceHistory, so the 4th card is Absent Days
              (a real, already-categorized count) rather than an invented
              "avg hours" figure. */}
          {(() => {
            const inMonthCells = attendanceCalendarCells.filter((c) => c.inMonth);
            const presentDays = inMonthCells.filter((c) => c.status === 'present').length;
            const lateDays = inMonthCells.filter((c) => c.status === 'late').length;
            const onLeaveDays = inMonthCells.filter((c) => c.status === 'leave' || c.status === 'paid_leave' || c.status === 'half_day').length;
            const absentDays = inMonthCells.filter((c) => c.status === 'absent').length;
            return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Present Days" value={presentDays} icon={CheckCircle2} iconBg="var(--color-nexus-tertiary-fixed)" caption={attendanceCalendarMonth.toLocaleDateString(undefined, { month: 'long' })} />
                <StatCard label="Pending Approval" value={lateDays} icon={AlarmClock} iconBg="var(--color-nexus-secondary-container)" iconColor="var(--color-nexus-secondary)" />
                <StatCard label="On Leave" value={onLeaveDays} icon={Plane} iconBg="var(--color-nexus-secondary-container)" iconColor="var(--color-nexus-secondary)" />
                <StatCard label="Absent" value={absentDays} icon={CalendarX} iconBg="var(--color-nexus-error-soft)" iconColor="var(--color-nexus-error)" />
              </div>
            );
          })()}

          <div className="nexus-card rounded-3xl p-6">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div>
                <h2 className="text-base font-bold text-[var(--color-nexus-ink)] font-sans">Attendance Calendar</h2>
                <p className="text-[11px] text-[var(--color-nexus-muted)] mt-1">Month view with the same status colors used by admins.</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => setAttendanceCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} className="p-1.5 rounded-lg hover:bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)]">
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs font-bold text-[var(--color-nexus-ink)]">{attendanceCalendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
                <button type="button" onClick={() => setAttendanceCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} className="p-1.5 rounded-lg hover:bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)]">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 mb-3">
              {ATTENDANCE_CALENDAR_LEGEND.map((item) => (
                <div key={item.status} className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full border ${ATTENDANCE_CALENDAR_STYLES[item.status]}`} />
                  <span className="text-[9px] uppercase font-bold text-[var(--color-nexus-muted)] tracking-wider">{item.label}</span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1.5 mb-1.5">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((dayLabel, index) => (
                <div key={`${dayLabel}-${index}`} className="text-center text-[9px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">{dayLabel}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {attendanceCalendarCells.map((cell) => (
                <div
                  key={cell.dateKey}
                  title={cell.inMonth ? `${cell.dateKey} — ${cell.label}` : undefined}
                  className={`aspect-square rounded-lg flex items-center justify-center border text-[10px] font-mono font-bold ${cell.inMonth ? ATTENDANCE_CALENDAR_STYLES[cell.status as Exclude<AttendanceCalendarStatus, 'none'>] : 'border-transparent'}`}
                >
                  {cell.inMonth ? cell.dayNum : ''}
                </div>
              ))}
            </div>
          </div>

          <div className="nexus-card rounded-3xl p-6">
            <h2 className="text-base font-bold text-[var(--color-nexus-ink)] mb-4 font-sans">My Attendance History</h2>
            <DataTable
              data={attendanceHistory}
              columns={historyColumns}
              searchPlaceholder="Search by status..."
              globalFilterColumnIds={['status', 'type']}
              pageSize={12}
              emptyMessage="No attendance records yet."
            />
          </div>
        </div>
      )}

      {/* BREAKS & CHECKOUT */}
      {tab === 'breaks' && todayState === 'checked_in' && (
        <div className="space-y-6">
          {/* Today's summary strip — check-in time, live hours worked, and
              total break time used, none of which were visible on this page
              before (only the break budget bar was). */}
          <div className="grid grid-cols-3 gap-3">
            <div className="nexus-card rounded-2xl p-4 text-center">
              <Clock size={16} className="mx-auto mb-1.5 text-[var(--color-nexus-muted)]" />
              <span className="block text-[9px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Checked In</span>
              <span className="block text-sm font-mono font-bold text-[var(--color-nexus-ink)] mt-0.5">{checkInTime ? new Date(checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
            </div>
            <div className="nexus-card rounded-2xl p-4 text-center">
              <CheckCircle2 size={16} className="mx-auto mb-1.5 text-[var(--color-nexus-muted)]" />
              <span className="block text-[9px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Hours Worked</span>
              <span className="block text-sm font-mono font-bold text-[var(--color-nexus-ink)] mt-0.5">{hoursWorked || '—'}</span>
            </div>
            <div className="nexus-card rounded-2xl p-4 text-center">
              <Coffee size={16} className="mx-auto mb-1.5 text-[var(--color-nexus-muted)]" />
              <span className="block text-[9px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Break Time Used</span>
              <span className="block text-sm font-mono font-bold text-[var(--color-nexus-ink)] mt-0.5">{totalBreakMinsToday}m</span>
            </div>
          </div>

          <div className="nexus-card rounded-3xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold text-[var(--color-nexus-muted)] uppercase tracking-widest font-mono">Break Management</h3>
              <span className="text-[10px] font-mono text-[var(--color-nexus-muted)]">{remainingMins}m left of {budgetMins}m</span>
            </div>
            <div className="w-full bg-[var(--color-nexus-border)] rounded-full h-1.5 mb-4 overflow-hidden">
              <motion.div initial={{ width: 0 }} animate={{ width: `${budgetUsedPct}%` }} transition={{ duration: 0.6 }} className={`h-1.5 rounded-full ${budgetUsedPct >= 100 ? 'bg-[var(--color-nexus-error)]' : 'bg-[var(--color-nexus-secondary)]'}`} />
            </div>
            {activeBreak ? (
              <div className="bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] p-5 rounded-2xl flex justify-between items-center">
                <div>
                  <span className="inline-block text-[9px] text-[var(--color-nexus-error)] font-mono uppercase tracking-wider pulse-ring rounded-full px-1">On Break ({activeBreak.breakType})</span>
                  <span className="text-2xl font-mono font-bold text-[var(--color-nexus-ink)] mt-1 block">{breakTimer}</span>
                  {activeBreak.note && <span className="text-[11px] text-[var(--color-nexus-muted)] mt-1 block italic">"{activeBreak.note}"</span>}
                </div>
                <button onClick={handleEndBreak} disabled={breakBusy} className="bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white font-bold text-xs uppercase tracking-wider px-5 py-3 rounded-xl transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed">{breakBusy ? 'Ending…' : 'Resume Work'}</button>
              </div>
            ) : (
              <div className="space-y-3">
                <select value={breakType} onChange={e => setBreakType(e.target.value)} className="w-full bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl px-3.5 py-2.5 text-xs font-mono text-[var(--color-nexus-ink)] focus:outline-none focus:border-[var(--color-nexus-primary)]">
                  <option value="Lunch">Lunch</option><option value="Tea">Tea / Coffee</option><option value="Personal">Personal</option><option value="Meeting">Meeting</option><option value="General">General</option>
                </select>
                <input
                  value={breakNote}
                  onChange={e => setBreakNote(e.target.value)}
                  maxLength={280}
                  placeholder="Optional note (e.g. client call)"
                  className="w-full bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-nexus-ink)] focus:outline-none focus:border-[var(--color-nexus-primary)]"
                />
                <button onClick={handleStartBreak} disabled={breakBusy} className="w-full bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white font-bold text-xs uppercase tracking-wider py-4 rounded-xl transition-all shadow-[0_4px_15px_rgba(37,99,235,0.3)] disabled:opacity-50 disabled:cursor-not-allowed">{breakBusy ? 'Locating…' : 'Go on Break'}</button>
              </div>
            )}
            {breaksToday.length > 0 && (
              <div className="mt-4 space-y-1.5">
                {breaksToday.map((b) => (
                  <div key={b.id} className="flex items-center justify-between text-[11px] font-mono px-3 py-2 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg">
                    <div className="min-w-0">
                      <span className="text-[var(--color-nexus-ink)]">{b.breakType}</span>
                      {b.note && <span className="text-[10px] text-[var(--color-nexus-muted)] italic ml-2 truncate">"{b.note}"</span>}
                    </div>
                    <span className="text-[var(--color-nexus-muted)] shrink-0 ml-2">{new Date(b.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{b.endTime ? ` – ${new Date(b.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ' – ongoing'}</span>
                    {b.isViolation && <span className="text-[var(--color-nexus-error)] text-[9px] uppercase font-bold shrink-0 ml-2">Over budget</span>}
                  </div>
                ))}
              </div>
            )}
            {/* Per-type breakdown — a flat list of entries doesn't answer
                "where did my break time actually go today" at a glance. */}
            {breakBreakdown.length > 0 && (
              <div className="mt-4 pt-4 border-t border-[var(--color-nexus-border)] flex flex-wrap gap-2">
                {breakBreakdown.map(([type, mins]) => (
                  <span key={type} className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] text-[var(--color-nexus-muted)]">
                    {type}: <strong className="text-[var(--color-nexus-ink)]">{mins}m</strong>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="nexus-card rounded-3xl p-6">
            {showCheckoutConfirm ? (
              <div className="space-y-4">
                <p className="text-xs font-bold text-[var(--color-nexus-muted)] uppercase tracking-widest font-mono">Confirm Check Out</p>
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl p-3">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Hours Worked</span>
                    <span className="block text-lg font-mono font-bold text-[var(--color-nexus-ink)] mt-0.5">{hoursWorked || '—'}</span>
                  </div>
                  <div className="bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl p-3">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)]">Break Time</span>
                    <span className="block text-lg font-mono font-bold text-[var(--color-nexus-ink)] mt-0.5">{totalBreakMinsToday}m</span>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setShowCheckoutConfirm(false)} disabled={checkingOut} className="flex-1 border border-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50">
                    Cancel
                  </button>
                  <button onClick={handleCheckout} disabled={checkingOut} className="flex-1 bg-[var(--color-nexus-error)] hover:brightness-110 text-white rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                    {checkingOut ? 'Checking Out...' : 'Confirm Check Out'}
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowCheckoutConfirm(true)} disabled={!!activeBreak} title={activeBreak ? 'Resume work before checking out' : undefined} className="w-full bg-[var(--color-nexus-error)] hover:brightness-110 text-white rounded-xl py-4 font-bold text-sm uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_4px_15px_rgba(226,69,69,0.3)]">
                {activeBreak ? 'Resume Work To Check Out' : 'Check Out'}
              </button>
            )}
          </div>
        </div>
      )}

      {tab === 'earnings' && <EarningsBreakdown token={token} />}

      {tab === 'leave-pay' && (
        <div className="space-y-6">
          {/* Two-column layout — request-related (balances + Apply Leave) on
              the left, history on the right, matching the Nexus reference's
              leave-management screen shape. Apply Leave itself stays a modal
              (Leave type / Date range / Reason / Submit·Cancel) rather than a
              permanently-open inline form — that's an existing, deliberate
              choice unrelated to this visual pass, not something this
              restyle should silently undo. */}
          <div className="grid md:grid-cols-2 gap-4 items-start">
            <div className="nexus-card p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h2 className="text-base font-bold text-[var(--color-nexus-ink)] font-sans">Leave Tracker</h2>
                <button
                  type="button"
                  onClick={() => setApplyLeaveModalOpen(true)}
                  disabled={!leaveData?.policies?.length}
                  className="bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white rounded-[var(--radius-nexus-control)] px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
                >
                  Apply Leave
                </button>
              </div>
              <LeaveBalanceCards
                balances={leaveData?.balances}
                onSelect={(balance) => {
                  if (balance.id != null) setLeavePolicyId(String(balance.id));
                  setLeaveHalfDay(false);
                  setApplyLeaveModalOpen(true);
                }}
              />
              {leaveData && leaveData.balances.length > 0 && (
                <p className="text-[11px] text-[var(--color-nexus-muted)] mt-4">Optional holidays chosen: {leaveData.selectedOptionalHolidayCount}/{leaveData.optionalHolidayLimit}</p>
              )}
              {!leaveData?.policies?.length && (
                <p className="text-sm text-[var(--color-nexus-muted)] mt-4">Ask your admin to assign at least one leave policy before you submit a request.</p>
              )}
            </div>

            <div className="nexus-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-[var(--color-nexus-ink)] font-sans">Leave History</h2>
                <div className="flex items-center gap-1 rounded-lg border border-[var(--color-nexus-border)] p-0.5">
                  <button
                    type="button"
                    onClick={() => setLeaveHistoryView('list')}
                    aria-label="List view"
                    className={`p-1.5 rounded-md ${leaveHistoryView === 'list' ? 'bg-[var(--color-nexus-primary)] text-white' : 'text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]'}`}
                  >
                    <List size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setLeaveHistoryView('calendar')}
                    aria-label="Calendar view"
                    className={`p-1.5 rounded-md ${leaveHistoryView === 'calendar' ? 'bg-[var(--color-nexus-primary)] text-white' : 'text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]'}`}
                  >
                    <CalendarDays size={14} />
                  </button>
                </div>
              </div>

              {leaveHistoryView === 'list' ? (
                <DataTable
                  data={leaveData?.requests || []}
                  columns={leaveHistoryColumns}
                  searchPlaceholder="Search by type or status..."
                  globalFilterColumnIds={['leaveType', 'status']}
                  pageSize={8}
                  emptyMessage="No leave requests yet."
                  renderRowDetail={(request: any) => request.reason ? <span><strong>Reason:</strong> {request.reason}</span> : null}
                />
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <button type="button" onClick={() => setLeaveCalendarMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))} className="p-1.5 rounded-lg hover:bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)]">
                      <ChevronLeft size={16} />
                    </button>
                    <span className="text-xs font-bold text-[var(--color-nexus-ink)]">{leaveCalendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
                    <button type="button" onClick={() => setLeaveCalendarMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))} className="p-1.5 rounded-lg hover:bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)]">
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <div className="grid grid-cols-7 gap-1.5 text-center text-[9px] font-bold text-[var(--color-nexus-muted)] mb-1.5">
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i}>{d}</span>)}
                  </div>
                  <div className="grid grid-cols-7 gap-1.5">
                    {leaveCalendarCells.map((cell) => {
                      if (!cell.inMonth) return <div key={cell.dateKey} />;
                      const isHoliday = !!cell.holidayName;
                      const status = cell.leave?.status;
                      const cellClass = isHoliday
                        ? 'bg-[var(--color-nexus-info-soft)] border-[var(--color-nexus-info)]/40 text-[var(--color-nexus-info)]'
                        : status === 'approved'
                          ? 'bg-[color:var(--color-nexus-success-text)]/15 border-[color:var(--color-nexus-success-text)]/40 text-[var(--color-nexus-success-text)]'
                          : status === 'pending'
                            ? 'bg-[var(--color-nexus-secondary-container)] border-[var(--color-nexus-secondary)]/40 text-[var(--color-nexus-secondary)]'
                            : 'border-[var(--color-nexus-border)] text-[var(--color-nexus-ink)]';
                      return (
                        <div
                          key={cell.dateKey}
                          title={isHoliday ? cell.holidayName! : cell.leave ? `${cell.leave.leaveType} · ${cell.leave.status}` : undefined}
                          className={`aspect-square rounded-lg border flex items-center justify-center text-[10px] font-semibold ${cellClass}`}
                        >
                          {cell.dayNum}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-3 mt-3 text-[9px] text-[var(--color-nexus-muted)]">
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-[color:var(--color-nexus-success-text)]/25 border border-[color:var(--color-nexus-success-text)]/40 inline-block" />Approved leave</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-[var(--color-nexus-secondary-container)] border border-[var(--color-nexus-secondary)]/40 inline-block" />Pending leave</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-[var(--color-nexus-info-soft)] border border-[var(--color-nexus-info)]/40 inline-block" />Holiday</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Apply Leave — a clean modal (Leave type / Date range / Reason /
              Submit·Cancel) rather than a permanently-open inline form,
              matching how leave request is actually applied for elsewhere
              (e.g. Zoho People's "Apply Leave" dialog). Half-day and medical-
              cause are real policy-driven fields (allowHalfDay,
              medicalOnlyNoAdvanceNoticeDays), kept inside the same modal
              rather than dropped, since they're not cosmetic. */}
          {applyLeaveModalOpen && (
            <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm p-4 sm:p-8" onClick={() => setApplyLeaveModalOpen(false)}>
              <div className="nexus-card rounded-3xl p-6 w-full max-w-lg my-8" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-lg font-bold text-[var(--color-nexus-ink)] font-sans">Apply Leave</h2>
                  <button type="button" onClick={() => setApplyLeaveModalOpen(false)} className="text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)] p-1">
                    <X size={18} />
                  </button>
                </div>
                <form onSubmit={handleSubmitLeaveRequest} className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-1.5">Leave Type</label>
                    <select value={leavePolicyId} onChange={e => { setLeavePolicyId(e.target.value); setLeaveHalfDay(false); }} className="w-full bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl px-4 py-3 text-sm focus:outline-none">
                      {leaveData!.policies.map((policy: any) => (
                        <option key={policy.id} value={policy.id}>{policy.name} ({policy.code})</option>
                      ))}
                    </select>
                    {selectedLeavePolicy && (
                      <span className="block text-[11px] text-[var(--color-nexus-muted)] mt-1.5">
                        {selectedLeavePolicy.allowHalfDay ? 'Half-day allowed' : 'Full-day only'} • {selectedLeavePolicy.requiresApproval === false ? 'Auto approved' : 'Needs approval'}
                      </span>
                    )}
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-1.5">Date</label>
                    <div className="grid grid-cols-2 gap-3">
                      <input type="date" value={leaveStartDate} onChange={e => setLeaveStartDate(e.target.value)} className="w-full bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl px-4 py-3 text-sm focus:outline-none" required />
                      <input type="date" min={leaveStartDate || undefined} value={leaveEndDate} onChange={e => setLeaveEndDate(e.target.value)} className="w-full bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl px-4 py-3 text-sm focus:outline-none" required />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className={`rounded-xl border px-4 py-3 text-sm ${selectedLeavePolicy?.allowHalfDay ? 'border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)]' : 'border-[var(--color-nexus-border)]/60 bg-[var(--color-nexus-surface-alt)]/60 text-[var(--color-nexus-muted)]'}`}>
                      <input type="checkbox" checked={leaveHalfDay} disabled={!selectedLeavePolicy?.allowHalfDay} onChange={e => setLeaveHalfDay(e.target.checked)} className="mr-2" />
                      Half-day
                    </label>
                    <label className="rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm text-[var(--color-nexus-ink)]">
                      <input type="checkbox" checked={leaveMedicalCause} onChange={e => setLeaveMedicalCause(e.target.checked)} className="mr-2" />
                      Medical / emergency
                    </label>
                  </div>
                  {selectedLeavePolicy?.medicalOnlyNoAdvanceNoticeDays ? (
                    <p className="text-[11px] text-[var(--color-nexus-muted)]">
                      Short-notice requests inside {selectedLeavePolicy.medicalOnlyNoAdvanceNoticeDays} day(s) must be marked as medical or emergency.
                    </p>
                  ) : null}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-1.5">Reason For Leave</label>
                    <textarea value={leaveReason} onChange={e => setLeaveReason(e.target.value)} rows={3} placeholder="Tell your manager what this leave is for..." className="w-full bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-2xl px-4 py-3 text-sm focus:outline-none resize-none" required />
                  </div>
                  <div className="flex justify-end gap-3 pt-1">
                    <button type="button" onClick={() => setApplyLeaveModalOpen(false)} className="border border-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] rounded-xl px-5 py-3 text-xs font-bold uppercase tracking-wider hover:bg-[var(--color-nexus-surface-alt)] transition-colors">
                      Cancel
                    </button>
                    <button type="submit" disabled={leaveSubmitting} className="bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white rounded-xl px-5 py-3 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50">
                      {leaveSubmitting ? 'Submitting...' : 'Submit'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <div className="nexus-card rounded-3xl p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-base font-bold text-[var(--color-nexus-ink)] font-sans">Optional Holidays</h2>
                  <p className="text-[11px] text-[var(--color-nexus-muted)] mt-1">Choose the holidays you want to reserve from the company calendar.</p>
                </div>
                <span className="text-[10px] uppercase font-bold text-[var(--color-nexus-primary)]">
                  {selectedOptionalHolidayIds.length}/{optionalHolidayData?.limit ?? leaveData?.optionalHolidayLimit ?? 0}
                </span>
              </div>
              {!optionalHolidayData || optionalHolidayData.holidays.length === 0 ? (
                <p className="text-sm text-[var(--color-nexus-muted)]">No holidays are available to choose yet.</p>
              ) : (
                <div className="space-y-3">
                  <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                    {optionalHolidayData.holidays.map((holiday: any) => (
                      <label key={holiday.id} className="flex items-start gap-3 rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-4 py-3 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedOptionalHolidayIds.includes(holiday.id)}
                          onChange={() => handleOptionalHolidayToggle(holiday.id)}
                          className="mt-1"
                        />
                        <div>
                          <span className="block font-bold text-[var(--color-nexus-ink)]">{holiday.name}</span>
                          <span className="block text-[11px] text-[var(--color-nexus-muted)]">{holiday.date}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="flex justify-end">
                    <button type="button" onClick={handleSaveOptionalHolidays} disabled={optionalHolidaySaving} className="bg-[var(--color-nexus-secondary)] hover:brightness-110 text-white rounded-xl px-5 py-3 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50">
                      {optionalHolidaySaving ? 'Saving...' : 'Save Optional Holidays'}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="nexus-card rounded-3xl p-6">
              <h2 className="text-base font-bold text-[var(--color-nexus-ink)] font-sans mb-4">Payroll Breakup</h2>
              {!payrollData?.summary ? (
                <p className="text-sm text-[var(--color-nexus-muted)]">Payroll structure has not been configured yet.</p>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[var(--color-nexus-muted)]">Annual CTC</span>
                    <span className="font-bold text-[var(--color-nexus-ink)]">{Math.round(payrollData.summary.annualCtc).toLocaleString()}</span>
                  </div>

                  <div className="rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] p-4">
                    <span className="block text-[10px] uppercase font-bold text-[var(--color-nexus-success-text)] tracking-wider mb-2">Earnings</span>
                    <div className="space-y-1.5">
                      {payrollData.summary.annualBreakdown.filter((c: any) => c.componentType === 'earning').map((component: any) => (
                        <div key={component.id || component.componentName} className="flex items-center justify-between text-[11px]">
                          <span className="text-[var(--color-nexus-muted)]">{component.componentName}</span>
                          <span className="font-mono text-[var(--color-nexus-ink)]">{Math.round(component.monthlyAmount).toLocaleString()}/mo</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] p-4">
                    <span className="block text-[10px] uppercase font-bold text-[var(--color-nexus-error)] tracking-wider mb-2">Deductions</span>
                    <div className="space-y-1.5">
                      {payrollData.summary.annualBreakdown.filter((c: any) => c.componentType === 'deduction').map((component: any) => (
                        <div key={component.id || component.componentName} className="flex items-center justify-between text-[11px]">
                          <span className="text-[var(--color-nexus-muted)]">{component.componentName}</span>
                          <span className="font-mono text-[var(--color-nexus-error)]">{Math.round(component.monthlyAmount).toLocaleString()}/mo</span>
                        </div>
                      ))}
                      {payrollData.summary.leaveDeduction > 0 && (
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-[var(--color-nexus-muted)]">Unpaid Leave</span>
                          <span className="font-mono text-[var(--color-nexus-error)]">{Math.round(payrollData.summary.leaveDeduction).toLocaleString()}</span>
                        </div>
                      )}
                      {payrollData.summary.annualBreakdown.filter((c: any) => c.componentType === 'deduction').length === 0 && payrollData.summary.leaveDeduction <= 0 && (
                        <p className="text-[11px] text-[var(--color-nexus-muted)]">No deductions this period.</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[var(--color-nexus-secondary)]/40 bg-[var(--color-nexus-secondary-container)] p-4 flex items-center justify-between">
                    <div>
                      <span className="block text-[10px] uppercase font-bold text-[var(--color-nexus-secondary)] tracking-wider">Net Pay (Monthly)</span>
                      <span className="block text-[11px] text-[var(--color-nexus-muted)] mt-0.5">Gross {Math.round(payrollData.summary.monthlyGross).toLocaleString()}</span>
                    </div>
                    <span className="text-xl font-bold text-[var(--color-nexus-secondary)]">{Math.round(payrollData.summary.monthlyNet).toLocaleString()}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {(leaveData?.balances || []).some((b: any) => b.encashmentEnabled) && (
            <div className="nexus-card p-6">
              <h2 className="text-base font-bold text-[var(--color-nexus-ink)] font-sans mb-1">Encash Leave</h2>
              <p className="text-xs text-[var(--color-nexus-muted)] mb-4">Convert unused days into pay — subject to admin approval.</p>
              <form onSubmit={handleEncashLeave} className="grid sm:grid-cols-4 gap-3 items-end">
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-1">Leave Type</label>
                  <select value={encashPolicyId} onChange={(e) => setEncashPolicyId(e.target.value)} className="w-full rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-3 py-2.5 text-sm focus:outline-none" required>
                    <option value="">Select…</option>
                    {(leaveData?.balances || []).filter((b: any) => b.encashmentEnabled).map((b: any) => (
                      <option key={b.id} value={b.id}>{b.name} ({b.remainingDays} available)</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-1">Days</label>
                  <input type="number" min="0.5" step="0.5" value={encashDays} onChange={(e) => setEncashDays(e.target.value)} className="w-full rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-3 py-2.5 text-sm focus:outline-none" required />
                </div>
                <button type="submit" disabled={encashSubmitting} className="rounded-xl bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white text-xs font-bold uppercase tracking-wider py-2.5 disabled:opacity-50">
                  {encashSubmitting ? 'Submitting…' : 'Request'}
                </button>
              </form>
              {encashMessage && <p className="mt-3 text-xs text-[var(--color-nexus-muted)]">{encashMessage}</p>}
            </div>
          )}

          <div className="grid lg:grid-cols-3 gap-4">
            <div className="nexus-card p-5 bg-[var(--color-nexus-primary-container)] text-white lg:col-span-1">
              <ShieldCheck size={20} className="text-[var(--color-nexus-tertiary-fixed)]" />
              <h3 className="text-base font-bold mt-2">Secure Payout</h3>
              <p className="text-sm text-white/70 mt-2 leading-relaxed">Your salary is processed through encrypted financial channels.</p>
            </div>
            <div className="nexus-card rounded-3xl p-6 lg:col-span-2">
              <h2 className="text-base font-bold text-[var(--color-nexus-ink)] font-sans mb-4">Payslip History</h2>
              <DataTable
                data={payslipHistory}
                columns={payslipHistoryColumns}
                searchPlaceholder="Search by month..."
                pageSize={6}
                emptyMessage="No payslips generated yet — one is recorded automatically each month you visit this page."
              />
            </div>
          </div>

          {/* Renders nothing unless the tenant has document storage turned
              on (Administration > Advanced & Security). */}
          <DocumentsPanel userId={user.id} canUpload canDelete />
        </div>
      )}

      {/* MY REQUESTS */}
      {tab === 'requests' && (
        <div className="nexus-card rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[var(--color-nexus-ink)] font-sans">My Correction Requests</h2>
            <button onClick={() => setShowCorrectionModal(true)} className="bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white text-[10px] font-bold uppercase tracking-wider px-4 py-2 rounded-lg transition-colors">New Request</button>
          </div>
          {corrections.length === 0 ? (
            <p className="text-sm text-[var(--color-nexus-muted)] text-center py-8">No correction requests yet.</p>
          ) : (
            <div className="space-y-1.5">
              {corrections.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-[11px] font-mono px-3 py-2.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg">
                  <span className="text-[var(--color-nexus-ink)]">{c.requestType.replace('_', ' ')} — {c.requestedDate}</span>
                  <span className={`text-[9px] uppercase font-bold ${c.status === 'pending' ? 'text-[var(--color-nexus-secondary)]' : c.status === 'approved' ? 'text-[var(--color-nexus-secondary)]' : 'text-[var(--color-nexus-error)]'}`}>{c.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TICKETS */}
      {tab === 'tickets' && <TicketsPanel user={user} />}

      {/* Correction request modal */}
      {showCorrectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm" onClick={() => setShowCorrectionModal(false)}>
          <div className="max-w-md w-full bg-[var(--color-nexus-surface)] rounded-3xl p-8 shadow-2xl border border-[var(--color-nexus-border)]" onClick={e => e.stopPropagation()}>
            {correctionSubmitted ? (
              <div className="text-center py-6">
                <p className="text-[var(--color-nexus-secondary)] font-bold text-sm uppercase tracking-wider">Request submitted</p>
                <p className="text-[var(--color-nexus-muted)] text-xs mt-2">Your manager or admin will review it shortly.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmitCorrection}>
                <h3 className="text-[var(--color-nexus-ink)] font-bold text-sm uppercase tracking-wider mb-5">Request Attendance Correction</h3>
                <div className="space-y-4">
                  <select value={correctionType} onChange={e => setCorrectionType(e.target.value)} className="w-full bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-nexus-ink)] focus:outline-none focus:border-[var(--color-nexus-primary)]">
                    <option value="missed_checkin">Missed Check-In</option><option value="missed_checkout">Missed Check-Out</option><option value="wrong_location">Wrong Location Flagged</option><option value="other">Other</option>
                  </select>
                  <input type="date" value={correctionDate} onChange={e => setCorrectionDate(e.target.value)} className="w-full bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-nexus-ink)] focus:outline-none focus:border-[var(--color-nexus-primary)]" required />
                  <input type="time" value={correctionTime} onChange={e => setCorrectionTime(e.target.value)} className="w-full bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-nexus-ink)] focus:outline-none focus:border-[var(--color-nexus-primary)]" />
                  <textarea value={correctionReason} onChange={e => setCorrectionReason(e.target.value)} rows={3} placeholder="Explain what happened…" className="w-full bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-nexus-ink)] focus:outline-none focus:border-[var(--color-nexus-primary)] resize-none" required />
                </div>
                <div className="flex gap-3 mt-6">
                  <button type="button" onClick={() => setShowCorrectionModal(false)} className="flex-1 bg-[var(--color-nexus-surface-alt)] hover:bg-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] rounded-xl py-3 text-xs font-bold uppercase tracking-wider transition-colors">Cancel</button>
                  <button type="submit" disabled={correctionSubmitting} className="flex-1 bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white rounded-xl py-3 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50">{correctionSubmitting ? 'Submitting...' : 'Submit'}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </PortalShell>
  );
}
