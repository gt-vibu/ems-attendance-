import { useState } from 'react';

// ==========================================
// AUDIT LEDGER STATE & FUNCTIONS
// ==========================================
// Extracted verbatim from Dashboard.tsx — fetch/verify/export logic for the
// tenant admin's Audit Ledger tab. No behavior changes.
export function useLedger(token: string | null) {
  const [ledger, setLedger] = useState<any[]>([]);
  const [ledgerVerifying, setLedgerVerifying] = useState(false);
  const [ledgerVerificationResult, setLedgerVerificationResult] = useState<{
    isValid: boolean;
    invalidBlocks: number[];
    verifiedBlocksCount: number;
  } | null>(null);

  const fetchLedgerData = async () => {
    try {
      const res = await fetch('/api/tenant/ledger', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.ledger) {
        setLedger(data.ledger);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Zero-dependency CSV export — no export library exists anywhere in this
  // app yet, and pulling in xlsx/jspdf for Excel/PDF is a bigger call than
  // this task needs; a hand-built CSV blob covers the common case (opens
  // straight into Excel/Sheets) without a new dependency.
  const downloadCsv = (filename: string, rows: (string | number)[][]) => {
    const escapeCell = (cell: string | number) => {
      const str = String(cell ?? '');
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const csv = rows.map(row => row.map(escapeCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportLedgerCsv = () => {
    const header = ['Timestamp', 'Actor', 'Actor ID', 'Action', 'IP Address', 'Device Info', 'Block Hash'];
    const rows = ledger.map((log: any) => [
      new Date(log.timestamp).toLocaleString(),
      log.actorName,
      log.actorId ?? 'SYS',
      log.action,
      log.ipAddress || '',
      log.deviceInfo || '',
      log.hash,
    ]);
    downloadCsv(`audit-ledger-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows]);
  };

  const verifyLedgerIntegrity = async () => {
    setLedgerVerifying(true);
    setLedgerVerificationResult(null);
    try {
      await new Promise(resolve => setTimeout(resolve, 1200)); // premium verification scan feel
      const res = await fetch('/api/tenant/ledger/verify', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setLedgerVerificationResult({
        isValid: data.isValid,
        invalidBlocks: data.invalidBlocks || [],
        verifiedBlocksCount: data.verifiedBlocksCount || 0
      });
      fetchLedgerData();
    } catch (err) {
      console.error(err);
    } finally {
      setLedgerVerifying(false);
    }
  };

  return {
    ledger,
    ledgerVerifying,
    ledgerVerificationResult,
    fetchLedgerData,
    handleExportLedgerCsv,
    verifyLedgerIntegrity,
  };
}
