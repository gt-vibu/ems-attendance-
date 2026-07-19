import { useState, useEffect } from 'react';

// ==========================================
// SELF-SERVICE (My Space) STATE
// ==========================================
// Personal attendance state for the logged-in admin (used in Self Service
// mode). Extracted verbatim from Dashboard.tsx.
export function useSelfService(token: string | null) {
  const [selfCheckInTime, setSelfCheckInTime] = useState<string | null>(null);
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
  const [selfCorrectionType, setSelfCorrectionType] = useState('check_in');
  const [selfCorrectionDate, setSelfCorrectionDate] = useState('');
  const [selfCorrectionTime, setSelfCorrectionTime] = useState('');
  const [selfCorrectionReason, setSelfCorrectionReason] = useState('');
  const [selfCorrectionSubmitting, setSelfCorrectionSubmitting] = useState(false);
  // True after a correction is submitted (shows a thank-you state in the modal)
  const [selfCorrectionSubmitted, setSelfCorrectionSubmitted] = useState(false);

  // Fetch current admin's personal attendance state for Self-Service mode
  const fetchSelfServiceData = async () => {
    try {
      // Today's check-in
      const todayRes = await fetch('/api/attendance/today', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (todayRes.ok) {
        const d = await todayRes.json();
        if (d.checkInTime) {
          setSelfCheckInTime(d.checkInTime);
          setSelfTodayPending(d.status === 'pending');
        } else {
          setSelfCheckInTime(null);
          setSelfTodayPending(false);
        }
      }

      // Active break
      const breakRes = await fetch('/api/breaks/active', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (breakRes.ok) {
        const bd = await breakRes.json();
        setSelfActiveBreak(bd.activeBreak || null);
      }

      // Today's breaks + remaining budget
      const breaksRes = await fetch('/api/breaks/today', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (breaksRes.ok) {
        const bd = await breaksRes.json();
        setSelfBreaksToday(bd.breaks || []);
        if (bd.budgetMins != null) setSelfBudgetMins(bd.budgetMins);
        if (bd.remainingMins != null) setSelfRemainingMins(bd.remainingMins);
      }

      // Personal correction requests
      const corrRes = await fetch('/api/attendance/my-corrections', {
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

  // Self-service: start a break
  const handleStartSelfBreak = async () => {
    if (!selfCheckInTime || selfActiveBreak) return;
    try {
      const res = await fetch('/api/breaks/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ breakType: selfBreakType })
      });
      if (res.ok) await fetchSelfServiceData();
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
        setSelfCheckInTime(null);
        setSelfHoursWorked('00:00:00');
        await fetchSelfServiceData();
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
      const res = await fetch('/api/tenant/corrections/request', {
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
        // Auto-close after a short delay so the user sees the success message
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
  }, [selfCheckInTime]);

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
    selfCheckInTime,
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
    selfCorrectionSubmitted, setSelfCorrectionSubmitted,
    fetchSelfServiceData,
    handleStartSelfBreak,
    handleEndSelfBreak,
    handleSelfCheckout,
    handleSubmitSelfCorrection,
  };
}
