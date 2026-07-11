import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { LayoutDashboard, Camera, Home as HomeIcon, Clock, ClipboardCheck, Coffee } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { User } from '../lib/auth';
import PortalShell, { type PortalNavItem } from '../components/PortalShell';
import DataTable from '../components/DataTable';

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

  // Break management (ported from the old EmployeeHome)
  const [activeBreak, setActiveBreak] = useState<any>(null);
  const [breakTimer, setBreakTimer] = useState('00:00');
  const [breakType, setBreakType] = useState('General');
  const [breaksToday, setBreaksToday] = useState<any[]>([]);
  const [budgetMins, setBudgetMins] = useState(60);
  const [remainingMins, setRemainingMins] = useState(60);
  const [checkingOut, setCheckingOut] = useState(false);

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

  const navigate = useNavigate();
  const token = localStorage.getItem('auth_token');
  const authHeaders = { 'Authorization': `Bearer ${token}` };

  useEffect(() => {
    (async () => {
      try {
        const todayRes = await fetch('/api/attendance/today', { headers: authHeaders });
        const todayData = await todayRes.json();
        const state = todayData.state || 'not_started';
        setTodayState(state);
        setTodayPending(!!todayData.pending);
        setCheckInTime(todayData.log?.createdAt || null);

        const [pctRes, corrRes, wfhRes, histRes] = await Promise.all([
          fetch('/api/attendance/percentage', { headers: authHeaders }).catch(() => null),
          fetch('/api/attendance/corrections/mine', { headers: authHeaders }).catch(() => null),
          fetch('/api/attendance/wfh/eligibility', { headers: authHeaders }).catch(() => null),
          fetch('/api/attendance/mine?limit=60', { headers: authHeaders }).catch(() => null),
        ]);
        if (pctRes?.ok) { const p = await pctRes.json(); setAttendancePercent(p.percentage); setAttendanceThreshold(p.threshold ?? 75); }
        if (corrRes?.ok) { const c = await corrRes.json(); setCorrections(c.corrections || []); }
        if (wfhRes?.ok) { const w = await wfhRes.json(); setWfhEligible(!!w.eligible); if (!w.eligible && w.reason) setWfhReasonMsg(w.reason); }
        if (histRes?.ok) { const h = await histRes.json(); setAttendanceHistory(h.logs || []); }

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
        () => reject(new Error('GPS location permission is required for breaks.')),
        { enableHighAccuracy: true }
      );
    });

  const fetchActiveBreak = async () => {
    try { const r = await fetch('/api/breaks/active', { headers: authHeaders }); const d = await r.json(); setActiveBreak(d.active || null); } catch (e) { console.error(e); }
  };
  const fetchBreaksToday = async () => {
    try { const r = await fetch('/api/breaks/today', { headers: authHeaders }); const d = await r.json(); setBreaksToday(d.sessions || []); setBudgetMins(d.budgetMins ?? 60); setRemainingMins(d.remainingMins ?? 60); } catch (e) { console.error(e); }
  };

  const handleStartBreak = async () => {
    setError(''); setSuccess('');
    try {
      const coords = await getFreshLocation();
      const r = await fetch('/api/breaks/start', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ breakType, lat: coords.lat, lng: coords.lng }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setActiveBreak(d.session);
    } catch (err: any) { setError(err.message || 'Failed to start break'); }
  };
  const handleEndBreak = async () => {
    setError(''); setSuccess('');
    try {
      const coords = await getFreshLocation();
      const r = await fetch('/api/breaks/end', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ lat: coords.lat, lng: coords.lng, clientTimestamp: new Date().toISOString() }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setActiveBreak(null);
      fetchBreaksToday();
      setSuccess(d.isViolation ? 'Work resumed — this break exceeded the budget and was flagged.' : 'Work session resumed.');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) { setError(err.message || 'Failed to end break'); }
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

  const budgetUsedPct = budgetMins > 0 ? Math.min(100, Math.round(((budgetMins - remainingMins) / budgetMins) * 100)) : 0;

  const navItems: PortalNavItem[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'attendance', label: 'My Attendance', icon: Clock, count: attendanceHistory.length || undefined },
    ...(todayState === 'checked_in' ? [{ id: 'breaks', label: 'Breaks & Checkout', icon: Coffee } as PortalNavItem] : []),
    { id: 'requests', label: 'My Requests', icon: ClipboardCheck, count: corrections.filter(c => c.status === 'pending').length || undefined },
  ];
  const titleFor = navItems.find(n => n.id === tab)?.label || 'Overview';

  const historyColumns: ColumnDef<any, any>[] = [
    { accessorKey: 'createdAt', header: 'Date', cell: ({ getValue }) => <span className="text-slate-600">{new Date(getValue() as string).toLocaleDateString()}</span> },
    { id: 'time', accessorKey: 'createdAt', header: 'Time', cell: ({ getValue }) => <span className="font-mono text-[11px] text-slate-500">{new Date(getValue() as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> },
    { accessorKey: 'type', header: 'Type', cell: ({ getValue }) => <span className="text-slate-700 text-[11px]">{String(getValue() || '').replace('_', ' ')}</span> },
    { accessorKey: 'attendanceMode', header: 'Mode', cell: ({ getValue }) => { const m = (getValue() as string) || 'office'; return <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${m === 'wfh' ? 'bg-violet-100 text-violet-700' : m === 'qr' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600'}`}>{m}</span>; } },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => { const s = getValue() as string; return <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${s === 'approved' ? 'bg-emerald-100 text-emerald-800' : s === 'pending' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'}`}>{s}</span>; } },
  ];

  if (loading) {
    return <div className="min-h-screen premium-mesh-bg flex items-center justify-center font-mono text-xs uppercase tracking-widest text-[var(--color-premium-muted)]">Loading...</div>;
  }

  const alreadyDone = todayState === 'checked_out';
  const tile = 'glass-card card-3d rounded-2xl p-5';

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
      {error && <div className="bg-[var(--color-premium-danger-soft)] text-[var(--color-premium-danger)] text-xs p-4 rounded-xl mb-6 border border-[var(--color-premium-danger)]/20 font-medium">{error}</div>}
      {success && <div className="bg-[var(--color-premium-accent-2-soft)] text-[var(--color-premium-accent-2)] text-xs p-4 rounded-xl mb-6 border border-[var(--color-premium-accent-2)]/30 font-medium">{success}</div>}

      {/* OVERVIEW */}
      {tab === 'overview' && (
        <div className="space-y-6">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <h2 className="text-2xl font-extrabold font-display text-gradient inline-block">Welcome, {user.name?.split(' ')[0] || 'there'}</h2>
            <p className="text-sm text-[var(--color-premium-muted)] mt-1">
              {alreadyDone ? "You've completed your attendance for today." : todayState === 'checked_in' ? 'You are checked in. Have a productive day.' : 'How would you like to mark your attendance?'}
            </p>
          </motion.div>

          {todayPending && (
            <div className="p-3 rounded-xl bg-[var(--color-premium-gold-soft)] border border-[var(--color-premium-gold)]/40 text-center">
              <p className="text-[10px] font-bold text-[var(--color-premium-gold)] uppercase tracking-wider">Late check-in pending manager approval</p>
            </div>
          )}

          {/* Quick actions (only when not yet checked in today) */}
          {todayState === 'not_started' && (
            <div className="grid sm:grid-cols-2 gap-4">
              <button onClick={() => navigate('/employee/attendance?mode=office')} className={`${tile} !bg-[var(--color-premium-accent)] text-white flex items-center gap-4 text-left`}>
                <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center shrink-0 float-c"><Camera size={24} /></div>
                <div><span className="block font-bold">Mark Attendance</span><span className="block text-[11px] text-white/80 mt-0.5">Face verification at the office</span></div>
              </button>
              {wfhEligible ? (
                <button onClick={() => navigate('/employee/attendance?mode=wfh')} className={`${tile} flex items-center gap-4 text-left`}>
                  <div className="w-12 h-12 rounded-xl bg-[var(--color-premium-accent-soft)] flex items-center justify-center shrink-0 float-b"><HomeIcon size={24} className="text-[var(--color-premium-accent)]" /></div>
                  <div><span className="block font-bold text-[var(--color-premium-ink)]">Work From Home</span><span className="block text-[11px] text-[var(--color-premium-muted)] mt-0.5">Check in from your registered home</span></div>
                </button>
              ) : wfhReasonMsg ? (
                <div className={`${tile} flex items-center gap-4 opacity-70`}>
                  <div className="w-12 h-12 rounded-xl bg-[var(--color-premium-border)]/40 flex items-center justify-center shrink-0"><HomeIcon size={24} className="text-[var(--color-premium-muted)]" /></div>
                  <div><span className="block font-bold text-[var(--color-premium-muted)]">Work From Home</span><span className="block text-[11px] text-[var(--color-premium-muted)] mt-0.5">{wfhReasonMsg}</span></div>
                </div>
              ) : null}
            </div>
          )}
          {todayState === 'checked_in' && (
            <button onClick={() => setTab('breaks')} className={`${tile} w-full !bg-[var(--color-premium-accent-2)] text-white flex items-center gap-4 text-left`}>
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center shrink-0 float-c"><Coffee size={24} /></div>
              <div><span className="block font-bold">Breaks & Checkout</span><span className="block text-[11px] text-white/80 mt-0.5">Manage breaks or check out for the day</span></div>
            </button>
          )}

          {/* Status tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className={tile}>
              <span className="block text-[9px] text-[var(--color-premium-muted)] font-mono uppercase tracking-wider">Checked In</span>
              <span className="text-lg font-mono font-bold text-[var(--color-premium-ink)] mt-1 block">{checkInTime && todayState !== 'not_started' ? new Date(checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
            </div>
            <div className={tile}>
              <span className="block text-[9px] text-[var(--color-premium-accent-2)] font-mono uppercase tracking-wider">Hours Today</span>
              <span className="text-lg font-mono font-bold text-[var(--color-premium-accent-2)] mt-1 block">{todayState === 'checked_in' ? hoursWorked : '—'}</span>
            </div>
            <div className={tile}>
              <span className="block text-[9px] text-[var(--color-premium-muted)] font-mono uppercase tracking-wider">Attendance</span>
              <span className={`text-lg font-mono font-bold mt-1 block ${attendancePercent !== null && attendancePercent < attendanceThreshold ? 'text-[var(--color-premium-danger)]' : 'text-[var(--color-premium-ink)]'}`}>{attendancePercent !== null ? `${attendancePercent}%` : '—'}</span>
              <span className="text-[10px] text-[var(--color-premium-muted)]">min {attendanceThreshold}%</span>
            </div>
            <div className={tile}>
              <span className="block text-[9px] text-[var(--color-premium-muted)] font-mono uppercase tracking-wider">Pending Requests</span>
              <span className="text-lg font-mono font-bold text-[var(--color-premium-ink)] mt-1 block">{corrections.filter(c => c.status === 'pending').length}</span>
            </div>
          </div>
        </div>
      )}

      {/* MY ATTENDANCE */}
      {tab === 'attendance' && (
        <div className="glass-card rounded-3xl p-6">
          <h2 className="text-base font-bold text-[var(--color-premium-ink)] mb-4 font-display">My Attendance History</h2>
          <DataTable
            data={attendanceHistory}
            columns={historyColumns}
            searchPlaceholder="Search by status..."
            globalFilterColumnIds={['status', 'type']}
            pageSize={12}
            emptyMessage="No attendance records yet."
          />
        </div>
      )}

      {/* BREAKS & CHECKOUT */}
      {tab === 'breaks' && todayState === 'checked_in' && (
        <div className="space-y-6">
          <div className="glass-card rounded-3xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold text-[var(--color-premium-muted)] uppercase tracking-widest font-mono">Break Management</h3>
              <span className="text-[10px] font-mono text-[var(--color-premium-muted)]">{remainingMins}m left of {budgetMins}m</span>
            </div>
            <div className="w-full bg-[var(--color-premium-border)] rounded-full h-1.5 mb-4 overflow-hidden">
              <motion.div initial={{ width: 0 }} animate={{ width: `${budgetUsedPct}%` }} transition={{ duration: 0.6 }} className={`h-1.5 rounded-full ${budgetUsedPct >= 100 ? 'bg-[var(--color-premium-danger)]' : 'bg-[var(--color-premium-accent-2)]'}`} />
            </div>
            {activeBreak ? (
              <div className="bg-[var(--color-premium-surface-alt)] border border-[var(--color-premium-border)] p-5 rounded-2xl flex justify-between items-center">
                <div>
                  <span className="block text-[9px] text-[var(--color-premium-danger)] font-mono uppercase tracking-wider">On Break ({activeBreak.breakType})</span>
                  <span className="text-2xl font-mono font-bold text-[var(--color-premium-ink)] mt-1 block">{breakTimer}</span>
                </div>
                <button onClick={handleEndBreak} className="bg-[var(--color-premium-accent)] hover:bg-[var(--color-premium-accent-hover)] text-white font-bold text-xs uppercase tracking-wider px-5 py-3 rounded-xl transition-all shadow-md">Resume Work</button>
              </div>
            ) : (
              <div className="space-y-3">
                <select value={breakType} onChange={e => setBreakType(e.target.value)} className="w-full bg-white border border-[var(--color-premium-border)] rounded-xl px-3.5 py-2.5 text-xs font-mono text-[var(--color-premium-ink)] focus:outline-none focus:border-[var(--color-premium-accent)]">
                  <option value="Lunch">Lunch</option><option value="Tea">Tea / Coffee</option><option value="Personal">Personal</option><option value="Meeting">Meeting</option><option value="General">General</option>
                </select>
                <button onClick={handleStartBreak} className="w-full bg-[var(--color-premium-accent)] hover:bg-[var(--color-premium-accent-hover)] text-white font-bold text-xs uppercase tracking-wider py-4 rounded-xl transition-all shadow-[0_4px_15px_rgba(123,92,250,0.3)]">Go on Break</button>
              </div>
            )}
            {breaksToday.length > 0 && (
              <div className="mt-4 space-y-1.5">
                {breaksToday.map((b) => (
                  <div key={b.id} className="flex items-center justify-between text-[11px] font-mono px-3 py-2 bg-[var(--color-premium-surface-alt)] border border-[var(--color-premium-border)] rounded-lg">
                    <span className="text-[var(--color-premium-ink)]">{b.breakType}</span>
                    <span className="text-[var(--color-premium-muted)]">{new Date(b.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{b.endTime ? ` – ${new Date(b.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ' – ongoing'}</span>
                    {b.isViolation && <span className="text-[var(--color-premium-danger)] text-[9px] uppercase font-bold">Over budget</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="glass-card rounded-3xl p-6">
            <button onClick={handleCheckout} disabled={checkingOut || !!activeBreak} title={activeBreak ? 'Resume work before checking out' : undefined} className="w-full bg-[var(--color-premium-danger)] hover:brightness-110 text-white rounded-xl py-4 font-bold text-sm uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_4px_15px_rgba(226,69,69,0.3)]">
              {checkingOut ? 'Checking Out...' : activeBreak ? 'Resume Work To Check Out' : 'Check Out'}
            </button>
          </div>
        </div>
      )}

      {/* MY REQUESTS */}
      {tab === 'requests' && (
        <div className="glass-card rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[var(--color-premium-ink)] font-display">My Correction Requests</h2>
            <button onClick={() => setShowCorrectionModal(true)} className="bg-[var(--color-premium-accent)] hover:bg-[var(--color-premium-accent-hover)] text-white text-[10px] font-bold uppercase tracking-wider px-4 py-2 rounded-lg transition-colors">New Request</button>
          </div>
          {corrections.length === 0 ? (
            <p className="text-sm text-[var(--color-premium-muted)] text-center py-8">No correction requests yet.</p>
          ) : (
            <div className="space-y-1.5">
              {corrections.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-[11px] font-mono px-3 py-2.5 bg-[var(--color-premium-surface-alt)] border border-[var(--color-premium-border)] rounded-lg">
                  <span className="text-[var(--color-premium-ink)]">{c.requestType.replace('_', ' ')} — {c.requestedDate}</span>
                  <span className={`text-[9px] uppercase font-bold ${c.status === 'pending' ? 'text-[var(--color-premium-gold)]' : c.status === 'approved' ? 'text-[var(--color-premium-accent-2)]' : 'text-[var(--color-premium-danger)]'}`}>{c.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Correction request modal */}
      {showCorrectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm" onClick={() => setShowCorrectionModal(false)}>
          <div className="max-w-md w-full bg-[var(--color-premium-surface)] rounded-3xl p-8 shadow-2xl border border-[var(--color-premium-border)]" onClick={e => e.stopPropagation()}>
            {correctionSubmitted ? (
              <div className="text-center py-6">
                <p className="text-[var(--color-premium-accent-2)] font-bold text-sm uppercase tracking-wider">Request submitted</p>
                <p className="text-[var(--color-premium-muted)] text-xs mt-2">Your manager or admin will review it shortly.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmitCorrection}>
                <h3 className="text-[var(--color-premium-ink)] font-bold text-sm uppercase tracking-wider mb-5">Request Attendance Correction</h3>
                <div className="space-y-4">
                  <select value={correctionType} onChange={e => setCorrectionType(e.target.value)} className="w-full bg-[var(--color-premium-surface-alt)] border border-[var(--color-premium-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-premium-ink)] focus:outline-none focus:border-[var(--color-premium-accent)]">
                    <option value="missed_checkin">Missed Check-In</option><option value="missed_checkout">Missed Check-Out</option><option value="wrong_location">Wrong Location Flagged</option><option value="other">Other</option>
                  </select>
                  <input type="date" value={correctionDate} onChange={e => setCorrectionDate(e.target.value)} className="w-full bg-[var(--color-premium-surface-alt)] border border-[var(--color-premium-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-premium-ink)] focus:outline-none focus:border-[var(--color-premium-accent)]" required />
                  <input type="time" value={correctionTime} onChange={e => setCorrectionTime(e.target.value)} className="w-full bg-[var(--color-premium-surface-alt)] border border-[var(--color-premium-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-premium-ink)] focus:outline-none focus:border-[var(--color-premium-accent)]" />
                  <textarea value={correctionReason} onChange={e => setCorrectionReason(e.target.value)} rows={3} placeholder="Explain what happened…" className="w-full bg-[var(--color-premium-surface-alt)] border border-[var(--color-premium-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-premium-ink)] focus:outline-none focus:border-[var(--color-premium-accent)] resize-none" required />
                </div>
                <div className="flex gap-3 mt-6">
                  <button type="button" onClick={() => setShowCorrectionModal(false)} className="flex-1 bg-[var(--color-premium-surface-alt)] hover:bg-[var(--color-premium-border)] text-[var(--color-premium-ink)] rounded-xl py-3 text-xs font-bold uppercase tracking-wider transition-colors">Cancel</button>
                  <button type="submit" disabled={correctionSubmitting} className="flex-1 bg-[var(--color-premium-accent)] hover:bg-[var(--color-premium-accent-hover)] text-white rounded-xl py-3 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50">{correctionSubmitting ? 'Submitting...' : 'Submit'}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </PortalShell>
  );
}
