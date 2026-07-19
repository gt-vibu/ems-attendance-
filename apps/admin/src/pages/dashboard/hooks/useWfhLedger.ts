import { useState } from 'react';

// Per-employee/per-day WFH ledger — gated by wfh.view_logs (delegable to
// managers/HR/etc., same probe-the-endpoint pattern as QR logs).
// Extracted verbatim from Dashboard.tsx.
export function useWfhLedger(token: string | null) {
  const [wfhLedger, setWfhLedger] = useState<any[]>([]);
  const [hasWfhLedgerAccess, setHasWfhLedgerAccess] = useState(false);

  const fetchWfhLedger = async () => {
    try {
      const res = await fetch('/api/tenant/wfh/ledger', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) { setHasWfhLedgerAccess(false); return; }
      const data = await res.json();
      setHasWfhLedgerAccess(true);
      if (data.ledger) setWfhLedger(data.ledger);
    } catch (err) {
      console.error(err);
    }
  };

  return { wfhLedger, hasWfhLedgerAccess, fetchWfhLedger };
}

// WFH dashboard stats widget — fails quietly if the caller wasn't granted
// reports.view. Extracted verbatim from Dashboard.tsx.
export function useWfhStats(token: string | null) {
  const [wfhStats, setWfhStats] = useState<any>(null);

  const fetchWfhStats = async () => {
    try {
      const res = await fetch('/api/tenant/wfh/stats', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return; // user may not have reports.view — fail quietly, matches fetchLedgerData's convention
      const data = await res.json();
      setWfhStats(data);
    } catch (err) {
      console.error(err);
    }
  };

  return { wfhStats, fetchWfhStats };
}
