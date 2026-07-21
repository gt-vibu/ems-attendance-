import { useState } from 'react';

// Several independent "pending approval queue" widgets that all share the
// same shape (fetch a list + probe access via 200/403, resolve one item via
// approve/reject). Bundled in one file since each is tiny, but kept as
// separate hooks (not merged) since they're genuinely independent
// endpoints/state — extracted verbatim from Dashboard.tsx.

type Setters = {
  setLoading: (v: boolean) => void;
  setError: (v: string) => void;
  setSuccess: (v: string) => void;
};

// Correction requests (check-in/out time corrections) — gated by attendance.approve.
export function useCorrections(token: string | null, { setLoading, setError, setSuccess }: Setters) {
  const [corrections, setCorrections] = useState<any[]>([]);
  const [hasCorrectionsAccess, setHasCorrectionsAccess] = useState(false);

  const fetchCorrections = async () => {
    try {
      const res = await fetch('/api/tenant/corrections', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) { setHasCorrectionsAccess(false); return; }
      const data = await res.json();
      setHasCorrectionsAccess(true);
      if (data.corrections) setCorrections(data.corrections);
    } catch (err) {
      console.error(err);
    }
  };

  const handleResolveCorrection = async (correctionId: number, action: 'approve' | 'reject') => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/corrections/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ correctionId, action })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve request');
      setSuccess(`Correction request ${action === 'approve' ? 'approved' : 'rejected'}.`);
      fetchCorrections();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to resolve request');
    } finally {
      setLoading(false);
    }
  };

  return { corrections, hasCorrectionsAccess, fetchCorrections, handleResolveCorrection };
}

// Late check-ins awaiting approval — an employee checked in late, explained
// why, and the log was written as 'pending' instead of 'approved' until
// someone with 'attendance.approve' resolves it.
export function usePendingAttendance(token: string | null, { setLoading, setError, setSuccess }: Setters) {
  const [pendingAttendance, setPendingAttendance] = useState<any[]>([]);
  const [hasAttendanceApprovalAccess, setHasAttendanceApprovalAccess] = useState(false);

  const fetchPendingAttendance = async () => {
    try {
      const res = await fetch('/api/tenant/attendance/pending', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) { setHasAttendanceApprovalAccess(false); return; }
      const data = await res.json();
      setHasAttendanceApprovalAccess(true);
      if (data.logs) setPendingAttendance(data.logs);
    } catch (err) {
      console.error(err);
    }
  };

  const handleResolveAttendance = async (logId: number, action: 'approve' | 'reject') => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/attendance/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ logId, action })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve request');
      setSuccess(`Late check-in ${action === 'approve' ? 'approved' : 'rejected — marked absent'}.`);
      fetchPendingAttendance();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to resolve request');
    } finally {
      setLoading(false);
    }
  };

  return { pendingAttendance, hasAttendanceApprovalAccess, fetchPendingAttendance, handleResolveAttendance };
}

// WFH home-location change requests — same approval convention as
// corrections/late-arrivals above ('attendance.approve').
export function useWfhLocationRequests(token: string | null, { setLoading, setError, setSuccess }: Setters) {
  const [wfhLocationRequests, setWfhLocationRequests] = useState<any[]>([]);
  const [hasWfhLocationAccess, setHasWfhLocationAccess] = useState(false);

  const fetchWfhLocationRequests = async () => {
    try {
      const res = await fetch('/api/tenant/wfh/location-change-requests', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) { setHasWfhLocationAccess(false); return; }
      const data = await res.json();
      setHasWfhLocationAccess(true);
      if (data.requests) setWfhLocationRequests(data.requests);
    } catch (err) {
      console.error(err);
    }
  };

  const handleResolveWfhLocationRequest = async (requestId: number, action: 'approve' | 'reject') => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/wfh/location-change-requests/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ requestId, action })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve request');
      setSuccess(`Home location request ${action === 'approve' ? 'approved' : 'rejected'}.`);
      fetchWfhLocationRequests();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to resolve request');
    } finally {
      setLoading(false);
    }
  };

  return { wfhLocationRequests, hasWfhLocationAccess, fetchWfhLocationRequests, handleResolveWfhLocationRequest };
}

// Termination requests — submitted by anyone holding 'employee.terminate'
// who is NOT the tenant_admin (the tenant_admin's own terminations are
// immediate and never appear here). Approve/reject-only (tenant_admin-only
// access, enforced server-side), same 200/403-probe convention as the
// queues above.
export function useTerminationRequests(token: string | null, { setLoading, setError, setSuccess }: Setters) {
  const [terminationRequests, setTerminationRequests] = useState<any[]>([]);
  const [hasTerminationAccess, setHasTerminationAccess] = useState(false);

  const fetchTerminationRequests = async () => {
    try {
      const res = await fetch('/api/tenant/termination-requests', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) { setHasTerminationAccess(false); return; }
      const data = await res.json();
      setHasTerminationAccess(true);
      if (data.requests) setTerminationRequests(data.requests);
    } catch (err) {
      console.error(err);
    }
  };

  const handleResolveTermination = async (requestId: number, action: 'approve' | 'reject') => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/termination-requests/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ requestId, action })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve request');
      setSuccess(`Termination request ${action === 'approve' ? 'approved — employee removed' : 'rejected'}.`);
      fetchTerminationRequests();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to resolve request');
    } finally {
      setLoading(false);
    }
  };

  return { terminationRequests, hasTerminationAccess, fetchTerminationRequests, handleResolveTermination };
}

// Shift-swap requests awaiting manager approval — the two colleagues have
// already agreed (see ShiftSwapWidget.tsx); this is just the final policy
// sign-off (shift.manage), same convention as the queues above.
export function useShiftSwapRequests(token: string | null, { setLoading, setError, setSuccess }: Setters) {
  const [shiftSwapRequests, setShiftSwapRequests] = useState<any[]>([]);
  const [hasShiftSwapAccess, setHasShiftSwapAccess] = useState(false);

  const fetchShiftSwapRequests = async () => {
    try {
      const res = await fetch('/api/tenant/shift-swap/pending-approval', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) { setHasShiftSwapAccess(false); return; }
      const data = await res.json();
      setHasShiftSwapAccess(true);
      if (data.requests) setShiftSwapRequests(data.requests);
    } catch (err) {
      console.error(err);
    }
  };

  const handleResolveShiftSwap = async (requestId: number, action: 'approve' | 'reject') => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/tenant/shift-swap/${requestId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve request');
      setSuccess(`Shift swap ${action === 'approve' ? 'approved' : 'rejected'}.`);
      fetchShiftSwapRequests();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to resolve request');
    } finally {
      setLoading(false);
    }
  };

  return { shiftSwapRequests, hasShiftSwapAccess, fetchShiftSwapRequests, handleResolveShiftSwap };
}

// Attendance alerts (e.g. anomaly/violation notices) — gated by alerts.receive.
export function useAlerts(token: string | null, { setLoading, setError, setSuccess }: Setters) {
  const [attendanceAlerts, setAttendanceAlerts] = useState<any[]>([]);
  const [hasAlertsAccess, setHasAlertsAccess] = useState(false);

  const fetchAlerts = async () => {
    try {
      const res = await fetch('/api/tenant/alerts', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) { setHasAlertsAccess(false); return; } // user may not have alerts.receive — fail quietly
      const data = await res.json();
      setHasAlertsAccess(true);
      if (data.alerts) setAttendanceAlerts(data.alerts);
    } catch (err) {
      console.error(err);
    }
  };

  const handleResolveAlert = async (alertId: number, action: 'accept' | 'reject') => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/alerts/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ alertId, action })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve alert');
      setSuccess(`Alert ${action === 'accept' ? 'accepted' : 'rejected'}.`);
      fetchAlerts();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to resolve alert');
    } finally {
      setLoading(false);
    }
  };

  return { attendanceAlerts, hasAlertsAccess, fetchAlerts, handleResolveAlert };
}
