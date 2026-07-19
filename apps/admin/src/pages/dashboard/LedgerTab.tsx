import { Download } from 'lucide-react';

// Administration > Audit Ledger tab — extracted verbatim from Dashboard.tsx's
// JSX (same markup, same props feed straight from the useLedger() hook).
export default function LedgerTab({
  ledger,
  ledgerVerifying,
  ledgerVerificationResult,
  verifyLedgerIntegrity,
  handleExportLedgerCsv,
}: {
  ledger: any[];
  ledgerVerifying: boolean;
  ledgerVerificationResult: { isValid: boolean; invalidBlocks: number[]; verifiedBlocksCount: number } | null;
  verifyLedgerIntegrity: () => void;
  handleExportLedgerCsv: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="nexus-card rounded-3xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-gradient font-sans">Immutable Cryptographic Audit Ledger</h2>
            <span className="px-2 py-0.5 bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)] text-[10px] uppercase font-bold rounded-md border border-[color:var(--color-nexus-success-text)]/20 flex items-center gap-1">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M2.166 11.37h7.478l2.5-8.333a1 1 0 011.902.008L15.344 7.62h2.49a1 1 0 110 2H14.656a1 1 0 01-.95-.678L12.5 5.03l-2.5 8.333a1 1 0 01-1.902-.008L6.804 9.38H2.166a1 1 0 110-2z" clipRule="evenodd" /></svg>
              SHA-256 Chained
            </span>
          </div>
          <p className="text-xs text-[var(--color-nexus-muted)] mt-1">Verify that database logs have not been tampered with or modified since creation.</p>
        </div>
        <div className="flex gap-2 self-start md:self-auto">
          <button
            onClick={handleExportLedgerCsv}
            className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] font-bold text-xs uppercase tracking-wider py-3 px-5 rounded-xl hover:bg-[var(--color-nexus-primary-fixed)] transition-colors flex items-center gap-2"
          >
            <Download size={14} />
            Export CSV
          </button>
          <button
            onClick={verifyLedgerIntegrity}
            disabled={ledgerVerifying}
            className="bg-[var(--color-nexus-primary)] text-white font-bold text-xs uppercase tracking-wider py-3 px-6 rounded-xl hover:bg-[var(--color-nexus-primary-hover)] transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {ledgerVerifying ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                Scanning Chain...
              </>
            ) : 'Verify Chain Integrity'}
          </button>
        </div>
      </div>

      {ledgerVerificationResult && (
        <div className={`p-5 rounded-3xl border flex items-start gap-4 ${ledgerVerificationResult.isValid ? 'bg-[color:var(--color-nexus-success-text)]/10 border-[color:var(--color-nexus-success-text)]/20 text-[var(--color-nexus-success-text)]' : 'bg-[var(--color-nexus-error-soft)] border-[var(--color-nexus-error)]/20 text-[var(--color-nexus-error)]'}`}>
          <div className={`p-2 rounded-2xl ${ledgerVerificationResult.isValid ? 'bg-[color:var(--color-nexus-success-text)]/10' : 'bg-[var(--color-nexus-error-soft)]'}`}>
            {ledgerVerificationResult.isValid ? (
              <svg className="w-6 h-6 text-[var(--color-nexus-success-text)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
            ) : (
              <svg className="w-6 h-6 text-[var(--color-nexus-error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            )}
          </div>
          <div>
            <h4 className="font-bold text-sm">{ledgerVerificationResult.isValid ? 'Ledger Verification Succeeded' : 'Ledger Verification Failed!'}</h4>
            <p className="text-xs opacity-90 mt-0.5">
              {ledgerVerificationResult.isValid
                ? `Cryptographic chain matches root block. Scanned ${ledgerVerificationResult.verifiedBlocksCount} operational entries. Zero tempering detected.`
                : `Alert! Tampering detected. Signature mismatch at log blocks: [${ledgerVerificationResult.invalidBlocks.join(', ')}].`
              }
            </p>
          </div>
        </div>
      )}

      <div className="nexus-card rounded-3xl p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] text-[10px] text-[var(--color-nexus-muted)] font-bold uppercase tracking-wider">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Actor</th>
                <th className="py-3 px-4">Security Action</th>
                <th className="py-3 px-4">Context</th>
                <th className="py-3 px-4 font-mono">Block Hash</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((log) => {
                const isFraud = log.action.startsWith('FRAUD') || log.action.includes('VIOLATION');
                return (
                  <tr key={log.id} className="border-b border-[var(--color-nexus-border)] text-xs hover:bg-[var(--color-nexus-primary-fixed)]/50 transition-colors">
                    <td className="py-4 px-4 text-[var(--color-nexus-muted)] whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                    <td className="py-4 px-4">
                      <span className="font-semibold text-[var(--color-nexus-ink)] block">{log.actorName}</span>
                      <span className="text-[10px] text-[var(--color-nexus-muted)] font-mono">ID: #{log.actorId || 'SYS'}</span>
                    </td>
                    <td className="py-4 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                        isFraud ? 'bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)]' :
                        log.action.startsWith('WFH_') ? 'bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)]' :
                        log.action === 'CHECK_IN' ? 'bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)]' :
                        log.action === 'CHECK_OUT' ? 'bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-secondary)]' :
                        'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-ink)]'
                      }`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <span className="text-[var(--color-nexus-muted)] block">{log.ipAddress || 'No IP'}</span>
                      <span className="text-[10px] text-[var(--color-nexus-muted)] block truncate max-w-[200px]">{log.deviceInfo || 'System Agent'}</span>
                    </td>
                    <td className="py-4 px-4 font-mono text-[10px] text-[var(--color-nexus-muted)]" title={log.hash}>
                      {log.hash.substring(0, 8)}...
                    </td>
                  </tr>
                );
              })}
              {ledger.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-[var(--color-nexus-muted)] text-sm">No ledger block records created yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
