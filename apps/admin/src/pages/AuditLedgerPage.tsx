import { useEffect } from 'react';
import { User } from '../lib/auth';
import AdminWorkspaceLayout from '../components/AdminWorkspaceLayout';
import LedgerTab from './dashboard/LedgerTab';
import { useLedger } from './dashboard/hooks/useLedger';

export default function AuditLedgerPage({ user, onLogout }: { user: User; onLogout?: () => void }) {
  const token = localStorage.getItem('auth_token');
  const {
    ledger,
    ledgerVerifying,
    ledgerVerificationResult,
    fetchLedgerData,
    verifyLedgerIntegrity,
    handleExportLedgerCsv,
  } = useLedger(token);

  useEffect(() => {
    fetchLedgerData();
  }, [token]);

  return (
    <AdminWorkspaceLayout
      user={user}
      onLogout={onLogout}
      title="Audit Ledger"
      subtitle="Cryptographically verified immutable audit trail of all workspace activity."
    >
      <LedgerTab
        ledger={ledger}
        ledgerVerifying={ledgerVerifying}
        ledgerVerificationResult={ledgerVerificationResult}
        verifyLedgerIntegrity={verifyLedgerIntegrity}
        handleExportLedgerCsv={handleExportLedgerCsv}
      />
    </AdminWorkspaceLayout>
  );
}
