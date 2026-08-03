import { useState, useEffect } from 'react';

// ==========================================
// SELF-SERVICE (My Space) STATE
// ==========================================
// Personal attendance state for the logged-in admin (used in Self Service
// mode). Extracted verbatim from Dashboard.tsx.
export function useSelfService(token: string | null) {
  const [selfState, setSelfState] = useState<'not_started' | 'checked_in' | 'on_break' | 'checked_out'>('not_started');
  const [selfCheckInTime, setSelfCheckInTime] = useState<string | null>(null);
  const [selfCheckOutTime, setSelfCheckOutTime] = useState<string | null>(null);
  const [selfWorkingHours, setSelfWorkingHours] = useState<number>(0);
  const [selfFormattedHours, setSelfFormattedHours] = useState<string>('00:00:00');
  const [selfTimeline, setSelfTimeline] = useState<any[]>([]);
  const [selfHoursWorked, setSelfHoursWorked] = useState('00:00:00');
  const [selfActiveBreak, setSelfActiveBreak] = useState<any>(null);
  const [selfBreakTimer, setSelfBreakTimer] = useState('00:00');
  const [selfBreakType, setSelfBreakType] = useState('Lunch');
  const [selfBreaksToday, setSelfBreaksToday] = useState<any[]>([]);
  const [selfBudgetMins, setSelfBudgetMins] = useState(60);
  const [selfRemainingMins, setSelfRemainingMins] = useState(60);
  const [selfCheckingOut, setSelfCheckingOut] = useState(false);
  const [selfTodayPending, setSelfTodayPending] = useState(false);
  const [selfCorrections, setSelfCorrections] = useState<any[]>([]);
  const [showSelfCorrectionModal, setShowSelfCorrectionModal] = useState(false);
  const [selfCorrectionType, setSelfCorrectionType] = useState('missed_checkin');
  const [selfCorrectionDate, setSelfCorrectionDate] = useState('');
  const [selfCorrectionTime, setSelfCorrectionTime] = useState('');
  const [selfCorrectionReason, setSelfCorrectionReason] = useState('');
  const [selfCorrectionSubmitting, setSelfCorrectionSubmitting] = useState(false);
  // True after a correction is submitted (shows a thank-you state in the modal)
  const [selfCorrectionSubmitted, setSelfCorrectionSubmitted] = useState(false);

  // Fetch current admin's personal attendance session
  const fetchSelfServiceData = async () => {
    try {
      const todayRes = await fetch('/api/attendance/today', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (todayRes.ok) {
        const d = await todayRes.json();
        setSelfState(d.state || 'not_started');
        setSelfCheckInTime(d.checkInTime || null);
        setSelfCheckOutTime(d.checkOutTime || null);
        setSelfWorkingHours(d.workingHours || 0);
        setSelfFormattedHours(d.formattedHours || '00:00:00');
        setSelfTimeline(d.timeline || []);
        setSelfTodayPending(!!d.pending);
        setSelfActiveBreak(d.activeBreak || null);
      }

      // Today's breaks + remaining budget
      const breaksRes = await fetch('/api/breaks/today', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (breaksRes.ok) {
        const bd = await breaksRes.json();
        setSelfBreaksToday(bd.sessions || bd.breaks || []);
        if (bd.budgetMins != null) setSelfBudgetMins(bd.budgetMins);
        if (bd.remainingMins != null) setSelfRemainingMins(bd.remainingMins);
      }

      // Personal correction requests
      const corrRes = await fetch('/api/attendance/corrections/mine', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (corrRes.ok) {
        const cd = await corrRes.json();
        setSelfCorrections(cd.corrections || []);
      }
    } catch (err) {
      console.error('[self-service] fetch error:', err);
    }
  };

  useEffect(() => {
    if (token) fetchSelfServiceData();
    const handleUpdate = () => { if (token) fetchSelfServiceData(); };
    window.addEventListener('attendance-session-updated', handleUpdate);
    return () => window.removeEventListener('attendance-session-updated', handleUpdate);
  }, [token]);

  // Self-service: start a break
  const handleStartSelfBreak = async () => {
    if (!selfCheckInTime || selfActiveBreak) return;
    try {
      const res = await fetch('/api/breaks/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ breakType: selfBreakType })
      });
      if (res.ok) {
        await fetchSelfServiceData();
        window.dispatchEvent(new CustomEvent('attendance-session-updated'));
      }
    } catch (err) {
      console.error('[self-service] start break error:', err);
    }
  };

  // Self-service: end the active break
  const handleEndSelfBreak = async () => {
    if (!selfActiveBreak) return;
    try {
      const res = await fetch('/api/breaks/end', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setSelfActiveBreak(null);
        await fetchSelfServiceData();
        window.dispatchEvent(new CustomEvent('attendance-session-updated'));
      }
    } catch (err) {
      console.error('[self-service] end break error:', err);
    }
  };

  // Self-service: punch out
  const handleSelfCheckout = async () => {
    if (!selfCheckInTime || selfActiveBreak) return;
    setSelfCheckingOut(true);
    try {
      const res = await fetch('/api/attendance/checkout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        await fetchSelfServiceData();
        window.dispatchEvent(new CustomEvent('attendance-session-updated'));
      }
    } catch (err) {
      console.error('[self-service] checkout error:', err);
    } finally {
      setSelfCheckingOut(false);
    }
  };

  // Self-service: submit a correction request
  const handleSubmitSelfCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selfCorrectionDate || !selfCorrectionReason) return;
    setSelfCorrectionSubmitting(true);
    try {
      const res = await fetch('/api/attendance/corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          requestType: selfCorrectionType,
          requestedDate: selfCorrectionDate,
          requestedTime: selfCorrectionTime || undefined,
          reason: selfCorrectionReason,
        })
      });
      if (res.ok) {
        setSelfCorrectionSubmitted(true);
        setSelfCorrectionDate('');
        setSelfCorrectionTime('');
        setSelfCorrectionReason('');
        await fetchSelfServiceData();
        window.dispatchEvent(new CustomEvent('attendance-session-updated'));
        setTimeout(() => {
          setShowSelfCorrectionModal(false);
          setSelfCorrectionSubmitted(false);
        }, 2000);
      }
    } catch (err) {
      console.error('[self-service] correction submit error:', err);
    } finally {
      setSelfCorrectionSubmitting(false);
    }
  };

  // Live work-hours ticker: updates every second when clocked in
  useEffect(() => {
    if (!selfCheckInTime) {
      setSelfHoursWorked('00:00:00');
      return;
    }
    if (selfState === 'checked_out') {
      setSelfHoursWorked(selfFormattedHours || '00:00:00');
      return;
    }
    const tick = () => {
      const start = new Date(selfCheckInTime).getTime();
      const elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
      const h = Math.floor(elapsed / 3600).toString().padStart(2, '0');
      const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
      const s = (elapsed % 60).toString().padStart(2, '0');
      setSelfHoursWorked(`${h}:${m}:${s}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [selfCheckInTime, selfState, selfFormattedHours]);

  // Live break-timer ticker: updates every second when a break is active
  useEffect(() => {
    if (!selfActiveBreak?.startTime) {
      setSelfBreakTimer('00:00');
      return;
    }
    const tick = () => {
      const start = new Date(selfActiveBreak.startTime).getTime();
      const elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
      const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
      const s = (elapsed % 60).toString().padStart(2, '0');
      setSelfBreakTimer(`${m}:${s}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [selfActiveBreak]);

  return {
    selfState,
    selfCheckInTime,
    selfCheckOutTime,
    selfWorkingHours,
    selfFormattedHours,
    selfTimeline,
    selfHoursWorked,
    selfActiveBreak,
    selfBreakTimer,
    selfBreakType, setSelfBreakType,
    selfBreaksToday,
    selfBudgetMins,
    selfRemainingMins,
    selfCheckingOut,
    selfTodayPending,
    selfCorrections,
    showSelfCorrectionModal, setShowSelfCorrectionModal,
    selfCorrectionType, setSelfCorrectionType,
    selfCorrectionDate, setSelfCorrectionDate,
    selfCorrectionTime, setSelfCorrectionTime,
    selfCorrectionReason, setSelfCorrectionReason,
    selfCorrectionSubmitting,
    selfCorrectionSubmitted,
    fetchSelfServiceData,
    handleStartSelfBreak,
    handleEndSelfBreak,
    handleSelfCheckout,
    handleSubmitSelfCorrection,
  };
}
