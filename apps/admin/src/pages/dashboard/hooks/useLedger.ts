import { useState } from 'react';
import { downloadCsv } from '../../../lib/csv';

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
