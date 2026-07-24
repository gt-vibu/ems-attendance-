import { History } from 'lucide-react';

const formatMoney = (value: number | null) => value == null ? '—' : `₹${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const MONEY_FIELDS = new Set(['Annual CTC', 'Overtime Hourly Rate']);
const formatFieldValue = (field: string, value: any) => {
  if (value == null) return '—';
  return MONEY_FIELDS.has(field) ? formatMoney(Number(value)) : String(value);
};

export interface CompensationHistoryEntry {
  id: number;
  changedAt: string;
  changedByName: string;
  effectiveFrom: string | null;
  previousAnnualCtc: number | null;
  newAnnualCtc: number;
  fieldChanges: Array<{ field: string; oldValue: any; newValue: any }>;
  isFirstSetup: boolean;
}

// Renders one employee's compensation change timeline — CTC and every
// salary component (Basic/HRA/PF/allowances/deductions) added, removed, or
// adjusted. Shared by PayrollHistoryPage.tsx (a tenant admin looking up any
// employee) and EarningsBreakdown.tsx (an employee looking up their own),
// which each fetch from their own endpoint but get back the exact same
// shape (see buildCompensationHistoryResponse in payroll.routes.ts) — this
// component doesn't care which one supplied it.
export default function CompensationHistoryList({ history, emptyLabel }: { history: CompensationHistoryEntry[]; emptyLabel: string }) {
  if (history.length === 0) {
    return (
      <div className="nexus-card rounded-2xl p-8 text-center">
        <History className="w-8 h-8 mx-auto mb-3 text-[var(--color-nexus-muted)]" />
        <p className="text-sm font-bold text-[var(--color-nexus-ink)]">No changes recorded</p>
        <p className="text-xs text-[var(--color-nexus-muted)] mt-1">{emptyLabel} Nil.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {history.map((entry) => (
        <div key={entry.id} className="nexus-card rounded-2xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${entry.isFirstSetup ? 'bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)]' : 'bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-secondary)]'}`}>
                {entry.isFirstSetup ? 'Initial Setup' : 'Updated'}
              </span>
              <span className="text-xs text-[var(--color-nexus-muted)]">by {entry.changedByName}</span>
            </div>
            <span className="text-xs text-[var(--color-nexus-muted)]">
              {new Date(entry.changedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              {entry.effectiveFrom ? ` · effective ${entry.effectiveFrom}` : ''}
            </span>
          </div>

          {entry.fieldChanges.length === 0 ? (
            <p className="text-xs text-[var(--color-nexus-muted)]">No field-level changes recorded for this save — nil.</p>
          ) : (
            <div className="space-y-2">
              {entry.fieldChanges.map((change, i) => (
                <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[var(--color-nexus-surface-alt)] px-4 py-2.5 text-xs">
                  <span className="font-bold text-[var(--color-nexus-ink)]">{change.field}</span>
                  <span className="font-mono">
                    <span className="text-[var(--color-nexus-muted)]">{formatFieldValue(change.field, change.oldValue)}</span>
                    <span className="mx-2 text-[var(--color-nexus-muted)]">→</span>
                    <span className="font-bold text-[var(--color-nexus-ink)]">{formatFieldValue(change.field, change.newValue)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
