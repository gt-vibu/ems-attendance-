import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { User } from '../lib/auth';
import PageChrome from '../components/PageChrome';
import AuroraField from '../three/AuroraField';

// The post-check-in landing page — everything that happens between clocking
// in and clocking out (breaks, status, correction requests, checkout) lives
// here, separate from the biometric Scan & Verify flow in
// EmployeeAttendance.tsx. Reachable only once today's attendance state is
// 'checked_in' — see the redirect in fetchToday() below and the guard in
// AdminApp.tsx.
export default function EmployeeHome({ user, onLogout }: { user: User, onLogout: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [todayPending, setTodayPending] = useState(false);
  const [checkInTime, setCheckInTime] = useState<string | null>(null);
  const [hoursWorked, setHoursWorked] = useState('00:00:00');

  const [location, setLocation] = useState<{ lat: number, lng: number } | null>(null);
  const [activeBreak, setActiveBreak] = useState<any>(null);
  const [breakTimer, setBreakTimer] = useState('00:00');
  const [breakType, setBreakType] = useState('General');

  const [breaksToday, setBreaksToday] = useState<any[]>([]);
  const [budgetMins, setBudgetMins] = useState(60);
  const [remainingMins, setRemainingMins] = useState(60);

  const [corrections, setCorrections] = useState<any[]>([]);

  const [attendancePercent, setAttendancePercent] = useState<number | null>(null);
  const [attendanceThreshold, setAttendanceThreshold] = useState(75);
  const [attendanceHistory, setAttendanceHistory] = useState<any[]>([]);

  const [checkingOut, setCheckingOut] = useState(false);

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
    fetchToday();
    fetchActiveBreak();
    fetchBreaksToday();
    fetchCorrections();
    fetchAttendancePercentage();
    fetchAttendanceHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // GPS is required for both starting and ending a break, and it must be a
  // FRESH read at the moment of the action — not a snapshot from whenever
  // the page happened to load, which could easily be stale by the time the
  // employee actually taps the button (they may have moved in the
  // meantime). The server enforces the geofence itself regardless.
  const getFreshLocation = (): Promise<{ lat: number, lng: number }> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported on this device.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
          setLocation(coords);
          resolve(coords);
        },
        (err) => reject(new Error(err.code === err.TIMEOUT
          ? 'Could not get a GPS fix in time. Move somewhere with a clearer signal and try again.'
          : 'Location permission is required for breaks. Enable it in your browser and try again.')),
        // timeout so it can't hang forever on a weak signal; maximumAge lets a
        // recent fix return instantly instead of forcing a slow high-accuracy one.
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
      );
    });
  };

  // Anyone who isn't actually checked in today doesn't belong on this page —
  // bounce to the Scan & Verify flow, which itself shows the right state
  // (camera for not_started, locked card for checked_out).
  const fetchToday = async () => {
    try {
      const res = await fetch('/api/attendance/today', { headers: authHeaders });
      const data = await res.json();
      if (data.state !== 'checked_in') {
        navigate('/employee/attendance');
        return;
      }
      setTodayPending(!!data.pending);
      setCheckInTime(data.log?.createdAt || null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Live "hours worked" ticker
  useEffect(() => {
    if (!checkInTime) return;
    const update = () => {
      const diff = Date.now() - new Date(checkInTime).getTime();
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setHoursWorked(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [checkInTime]);

  // Live break timer
  useEffect(() => {
    let interval: any;
    if (activeBreak) {
      interval = setInterval(() => {
        const start = new Date(activeBreak.startTime).getTime();
        const diff = Date.now() - start;
        const mins = Math.floor(diff / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        setBreakTimer(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
      }, 1000);
    } else {
      setBreakTimer('00:00');
    }
    return () => clearInterval(interval);
  }, [activeBreak]);

  const fetchActiveBreak = async () => {
    try {
      const res = await fetch('/api/breaks/active', { headers: authHeaders });
      const data = await res.json();
      setActiveBreak(data.active || null);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchBreaksToday = async () => {
    try {
      const res = await fetch('/api/breaks/today', { headers: authHeaders });
      const data = await res.json();
      setBreaksToday(data.sessions || []);
      setBudgetMins(data.budgetMins ?? 60);
      setRemainingMins(data.remainingMins ?? 60);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchCorrections = async () => {
    try {
      const res = await fetch('/api/attendance/corrections/mine', { headers: authHeaders });
      const data = await res.json();
      setCorrections(data.corrections || []);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchAttendancePercentage = async () => {
    try {
      const res = await fetch('/api/attendance/percentage', { headers: authHeaders });
      const data = await res.json();
      if (res.ok) {
        setAttendancePercent(data.percentage);
        setAttendanceThreshold(data.threshold ?? 75);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Read-only — there is no edit route for this data, by design.
  const fetchAttendanceHistory = async () => {
    try {
      const res = await fetch('/api/attendance/mine?limit=30', { headers: authHeaders });
      const data = await res.json();
      setAttendanceHistory(data.logs || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleStartBreak = async () => {
    setError('');
    setSuccess('');
    try {
      const coords = await getFreshLocation();
      const res = await fetch('/api/breaks/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ breakType, lat: coords.lat, lng: coords.lng })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setActiveBreak(data.session);
    } catch (err: any) {
      setError(err.message || 'Failed to start break');
    }
  };

  const handleEndBreak = async () => {
    setError('');
    setSuccess('');
    try {
      const coords = await getFreshLocation();
      const res = await fetch('/api/breaks/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ lat: coords.lat, lng: coords.lng, clientTimestamp: new Date().toISOString() })
      });
      const data = await res.json();
      if (!res.ok) {
        // Outside the office geofence — the break was intentionally left
        // active server-side (not silently closed), so nothing here needs
        // to change local state; the message just needs to stay visible
        // until they've moved back in range and try again.
        throw new Error(data.error);
      }
      setActiveBreak(null);
      fetchBreaksToday();
      setSuccess(data.isViolation ? 'Work session resumed — this break exceeded the allowed budget and has been flagged for review.' : 'Work session resumed successfully.');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to end break');
    }
  };

  const handleCheckout = async () => {
    setError('');
    setCheckingOut(true);
    try {
      const res = await fetch('/api/attendance/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ clientTimestamp: new Date().toISOString() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to check out.');
      navigate('/employee/attendance');
    } catch (err: any) {
      setError(err.message || 'Failed to check out.');
      setCheckingOut(false);
    }
  };

  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctionDate || !correctionReason) return;
    setCorrectionSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/attendance/corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          requestType: correctionType,
          requestedDate: correctionDate,
          requestedTime: correctionTime || undefined,
          reason: correctionReason
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit request');
      setCorrectionSubmitted(true);
      setCorrectionDate('');
      setCorrectionTime('');
      setCorrectionReason('');
      fetchCorrections();
      setTimeout(() => {
        setShowCorrectionModal(false);
        setCorrectionSubmitted(false);
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to submit request');
    } finally {
      setCorrectionSubmitting(false);
    }
  };

  const budgetUsedPct = budgetMins > 0 ? Math.min(100, Math.round(((budgetMins - remainingMins) / budgetMins) * 100)) : 0;

  if (loading) {
    return (
      <div className="min-h-screen premium-gradient-bg flex items-center justify-center font-mono text-xs uppercase tracking-widest text-[var(--color-premium-muted)]">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen premium-gradient-bg flex items-center justify-center p-6 font-sans text-[var(--color-premium-ink)] selection:bg-[var(--color-premium-accent)] selection:text-white relative overflow-hidden">
      <AuroraField />
      <PageChrome fallbackHref="/employee/dashboard" />

      <div className="absolute top-6 right-6 z-40">
        <button
          onClick={onLogout}
          className="text-xs font-bold text-[var(--color-premium-muted)] hover:text-[var(--color-premium-accent)] transition-colors uppercase tracking-widest bg-[var(--color-premium-surface)] border border-[var(--color-premium-border)] hover:border-[var(--color-premium-accent)] px-5 py-2.5 rounded-full shadow-sm"
        >
          Sign Out
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-md w-full glass-card rounded-3xl p-8 space-y-6 relative z-10"
      >

        {/* Header / status */}
        <div className="text-center">
          <span className="px-3 py-1 bg-[var(--color-premium-accent-soft)] border border-[var(--color-premium-border)] text-[var(--color-premium-accent)] rounded-full text-[9px] font-mono tracking-widest uppercase">
            Portal: {user.role}
          </span>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-[var(--color-premium-ink)] mt-4">
            Welcome, {user.name?.split(' ')[0] || 'there'}
          </h1>
        </div>

        <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="bg-[var(--color-premium-danger-soft)] text-[var(--color-premium-danger)] text-xs p-4 rounded-xl border border-[var(--color-premium-danger)]/20 font-medium text-center">
            ⚠️ {error}
          </motion.div>
        )}
        {success && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="bg-[var(--color-premium-accent-2-soft)] text-[var(--color-premium-accent-2)] text-xs p-4 rounded-xl border border-[var(--color-premium-accent-2)]/30 font-medium text-center">
            {success}
          </motion.div>
        )}
        </AnimatePresence>
        {todayPending && (
          <div className="p-3 rounded-xl bg-[var(--color-premium-gold-soft)] border border-[var(--color-premium-gold)]/40 text-center">
            <p className="text-[10px] font-bold text-[var(--color-premium-gold)] uppercase tracking-wider">Late check-in pending manager approval</p>
          </div>
        )}

        {/* Status card: check-in time + hours worked + attendance % */}
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="card-3d bg-[var(--color-premium-surface-alt)] border border-[var(--color-premium-border)] rounded-2xl p-5 grid grid-cols-2 gap-4"
        >
          <div>
            <span className="block text-[9px] text-[var(--color-premium-muted)] font-mono uppercase tracking-wider">Checked In</span>
            <span className="text-lg font-mono font-bold text-[var(--color-premium-ink)] mt-1 block">
              {checkInTime ? new Date(checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
            </span>
          </div>
          <div>
            <span className="block text-[9px] text-[var(--color-premium-accent-2)] font-mono uppercase tracking-wider">Hours Worked</span>
            <span className="text-lg font-mono font-bold text-[var(--color-premium-accent-2)] mt-1 block">{hoursWorked}</span>
          </div>
          <div className="col-span-2 pt-3 border-t border-[var(--color-premium-border)]">
            <span className="block text-[9px] text-[var(--color-premium-muted)] font-mono uppercase tracking-wider">Attendance This Month</span>
            <span className={`text-lg font-mono font-bold mt-1 block ${attendancePercent !== null && attendancePercent < attendanceThreshold ? 'text-[var(--color-premium-danger)]' : 'text-[var(--color-premium-ink)]'}`}>
              {attendancePercent !== null ? `${attendancePercent}%` : '—'}
              <span className="text-[10px] text-[var(--color-premium-muted)] font-normal ml-2">min. required {attendanceThreshold}%</span>
            </span>
          </div>
        </motion.div>

        {/* Break Management */}
        <div className="border-t border-[var(--color-premium-border)] pt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold text-[var(--color-premium-muted)] uppercase tracking-widest font-mono">Break Management</h3>
            <span className="text-[10px] font-mono text-[var(--color-premium-muted)]">{remainingMins}m left of {budgetMins}m</span>
          </div>

          <div className="w-full bg-[var(--color-premium-border)] rounded-full h-1.5 mb-4 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${budgetUsedPct}%` }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className={`h-1.5 rounded-full ${budgetUsedPct >= 100 ? 'bg-[var(--color-premium-danger)]' : 'bg-[var(--color-premium-accent-2)]'}`}
            />
          </div>

          {activeBreak ? (
            <div className="bg-[var(--color-premium-surface-alt)] border border-[var(--color-premium-border)] p-5 rounded-2xl flex justify-between items-center">
              <div>
                <span className="inline-block text-[9px] text-[var(--color-premium-danger)] font-mono uppercase tracking-wider pulse-ring rounded-full px-1">Status: On Break ({activeBreak.breakType})</span>
                <span className="text-2xl font-mono font-bold text-[var(--color-premium-ink)] mt-1 block">{breakTimer}</span>
              </div>
              <button
                onClick={handleEndBreak}
                className="bg-[var(--color-premium-accent)] hover:bg-[var(--color-premium-accent-hover)] text-white font-bold text-xs uppercase tracking-wider px-5 py-3 rounded-xl transition-all shadow-md cursor-pointer"
              >
                Resume Work
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <select
                value={breakType}
                onChange={e => setBreakType(e.target.value)}
                className="w-full bg-[var(--color-premium-surface)] border border-[var(--color-premium-border)] rounded-xl px-3.5 py-2.5 text-xs font-mono text-[var(--color-premium-ink)] focus:outline-none focus:border-[var(--color-premium-accent)]"
              >
                <option value="Lunch">Lunch</option>
                <option value="Tea">Tea / Coffee</option>
                <option value="Personal">Personal</option>
                <option value="Meeting">Meeting</option>
                <option value="General">General</option>
              </select>
              <button
                onClick={handleStartBreak}
                className="w-full bg-[var(--color-premium-accent)] hover:bg-[var(--color-premium-accent-hover)] text-white font-bold text-xs uppercase tracking-wider py-4 rounded-xl transition-all shadow-[0_4px_15px_rgba(123,92,250,0.3)] flex items-center justify-center gap-2 cursor-pointer"
              >
                Go on Break
              </button>
            </div>
          )}

          {/* Today's break log */}
          {breaksToday.length > 0 && (
            <div className="mt-4 space-y-1.5">
              {breaksToday.map((b) => (
                <div key={b.id} className="flex items-center justify-between text-[11px] font-mono px-3 py-2 bg-[var(--color-premium-surface-alt)] border border-[var(--color-premium-border)] rounded-lg">
                  <span className="text-[var(--color-premium-ink)]">{b.breakType}</span>
                  <span className="text-[var(--color-premium-muted)]">
                    {new Date(b.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {b.endTime ? ` – ${new Date(b.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ' – ongoing'}
                  </span>
                  {b.isViolation && <span className="text-[var(--color-premium-danger)] text-[9px] uppercase font-bold">Over budget</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pending requests */}
        {corrections.length > 0 && (
          <div className="border-t border-[var(--color-premium-border)] pt-6">
            <h3 className="text-xs font-bold text-[var(--color-premium-muted)] uppercase tracking-widest font-mono mb-4">Correction Requests</h3>
            <div className="space-y-1.5">
              {corrections.slice(0, 5).map((c) => (
                <div key={c.id} className="flex items-center justify-between text-[11px] font-mono px-3 py-2 bg-[var(--color-premium-surface-alt)] border border-[var(--color-premium-border)] rounded-lg">
                  <span className="text-[var(--color-premium-ink)]">{c.requestType.replace('_', ' ')} — {c.requestedDate}</span>
                  <span className={`text-[9px] uppercase font-bold ${c.status === 'pending' ? 'text-[var(--color-premium-gold)]' : c.status === 'approved' ? 'text-[var(--color-premium-accent-2)]' : 'text-[var(--color-premium-danger)]'}`}>
                    {c.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Read-only attendance history — no edit affordance anywhere here */}
        {attendanceHistory.length > 0 && (
          <div className="border-t border-[var(--color-premium-border)] pt-6">
            <h3 className="text-xs font-bold text-[var(--color-premium-muted)] uppercase tracking-widest font-mono mb-4">Attendance History</h3>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {attendanceHistory.map((log) => (
                <div key={log.id} className="flex items-center justify-between text-[11px] font-mono px-3 py-2 bg-[var(--color-premium-surface-alt)] border border-[var(--color-premium-border)] rounded-lg">
                  <span className="text-[var(--color-premium-ink)]">
                    {new Date(log.createdAt).toLocaleDateString()} — {log.type.replace('_', ' ')}
                    {' '}{new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className={`text-[9px] uppercase font-bold ${log.status === 'approved' ? 'text-[var(--color-premium-accent-2)]' : log.status === 'pending' ? 'text-[var(--color-premium-gold)]' : 'text-[var(--color-premium-danger)]'}`}>
                    {log.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Check Out */}
        <div className="border-t border-[var(--color-premium-border)] pt-6 space-y-3">
          <button
            onClick={handleCheckout}
            disabled={checkingOut || !!activeBreak}
            title={activeBreak ? "Resume work before checking out" : undefined}
            className="w-full bg-[var(--color-premium-danger)] hover:brightness-110 text-white rounded-xl py-4 font-bold text-sm uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_4px_15px_rgba(226,69,69,0.3)]"
          >
            {checkingOut ? 'Checking Out...' : activeBreak ? 'Resume Work To Check Out' : 'Check Out'}
          </button>

          <button
            onClick={() => setShowCorrectionModal(true)}
            className="w-full text-[var(--color-premium-muted)] hover:text-[var(--color-premium-accent)] text-xs font-bold uppercase tracking-wider py-2 transition-colors cursor-pointer"
          >
            Missed a check-in/out? Request a correction
          </button>
        </div>
      </motion.div>

      {/* Correction request modal */}
      {showCorrectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm">
          <div className="max-w-md w-full bg-[var(--color-premium-surface)] rounded-3xl p-8 shadow-[0_20px_60px_rgba(123,92,250,0.2)] border border-[var(--color-premium-border)]">
            {correctionSubmitted ? (
              <div className="text-center py-6">
                <p className="text-[var(--color-premium-accent-2)] font-bold text-sm uppercase tracking-wider">Request submitted</p>
                <p className="text-[var(--color-premium-muted)] text-xs mt-2">Your manager or admin will review it shortly.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmitCorrection}>
                <h3 className="text-[var(--color-premium-ink)] font-bold text-sm uppercase tracking-wider mb-5">Request Attendance Correction</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-[var(--color-premium-muted)] uppercase tracking-widest mb-1.5">Issue Type</label>
                    <select
                      value={correctionType}
                      onChange={e => setCorrectionType(e.target.value)}
                      className="w-full bg-[var(--color-premium-surface-alt)] border border-[var(--color-premium-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-premium-ink)] focus:outline-none focus:border-[var(--color-premium-accent)]"
                    >
                      <option value="missed_checkin">Missed Check-In</option>
                      <option value="missed_checkout">Missed Check-Out</option>
                      <option value="wrong_location">Wrong Location Flagged</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[var(--color-premium-muted)] uppercase tracking-widest mb-1.5">Date</label>
                    <input
                      type="date"
                      value={correctionDate}
                      onChange={e => setCorrectionDate(e.target.value)}
                      className="w-full bg-[var(--color-premium-surface-alt)] border border-[var(--color-premium-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-premium-ink)] focus:outline-none focus:border-[var(--color-premium-accent)]"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[var(--color-premium-muted)] uppercase tracking-widest mb-1.5">Time (optional)</label>
                    <input
                      type="time"
                      value={correctionTime}
                      onChange={e => setCorrectionTime(e.target.value)}
                      className="w-full bg-[var(--color-premium-surface-alt)] border border-[var(--color-premium-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-premium-ink)] focus:outline-none focus:border-[var(--color-premium-accent)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[var(--color-premium-muted)] uppercase tracking-widest mb-1.5">Explanation</label>
                    <textarea
                      value={correctionReason}
                      onChange={e => setCorrectionReason(e.target.value)}
                      rows={3}
                      className="w-full bg-[var(--color-premium-surface-alt)] border border-[var(--color-premium-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-premium-ink)] focus:outline-none focus:border-[var(--color-premium-accent)] resize-none"
                      placeholder="e.g. Phone died at 9am, couldn't check in until I found a charger."
                      required
                    />
                  </div>
                </div>
                {error && <p className="text-[var(--color-premium-danger)] text-[10px] mt-3">{error}</p>}
                <div className="flex gap-3 mt-6">
                  <button
                    type="button"
                    onClick={() => setShowCorrectionModal(false)}
                    className="flex-1 bg-[var(--color-premium-surface-alt)] hover:bg-[var(--color-premium-border)] text-[var(--color-premium-ink)] rounded-xl py-3 text-xs font-bold uppercase tracking-wider transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={correctionSubmitting}
                    className="flex-1 bg-[var(--color-premium-accent)] hover:bg-[var(--color-premium-accent-hover)] text-white rounded-xl py-3 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
                  >
                    {correctionSubmitting ? 'Submitting...' : 'Submit Request'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
