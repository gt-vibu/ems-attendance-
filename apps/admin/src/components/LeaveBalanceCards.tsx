import { CalendarDays, Sun, HeartPulse, Baby, Coffee, Briefcase, Palmtree, Umbrella, Info } from 'lucide-react';

// Zoho-style "leave type" card row: icon in a colored rounded square, the
// leave type name, then Available (green) / Booked with an info icon.
// Shared by LeaveManagementPage.tsx (admin drilling into one employee's
// balances) and EmployeeDashboard.tsx (an employee's own Leave Tracker) so
// both views render the identical visual instead of two hand-rolled lists.

const ICONS = [CalendarDays, Sun, HeartPulse, Baby, Coffee, Briefcase, Palmtree, Umbrella];

const PALETTES = [
  { bg: 'bg-[var(--color-nexus-primary-fixed)]', fg: 'text-[var(--color-nexus-primary)]' },
  { bg: 'bg-[var(--color-nexus-secondary-container)]', fg: 'text-[var(--color-nexus-secondary)]' },
  { bg: 'bg-[var(--color-nexus-secondary-container)]', fg: 'text-[var(--color-nexus-secondary)]' },
  { bg: 'bg-[color:var(--color-nexus-success-text)]/10', fg: 'text-[var(--color-nexus-success-text)]' },
  { bg: 'bg-[var(--color-nexus-error-soft)]', fg: 'text-[var(--color-nexus-error)]' },
  { bg: 'bg-[var(--color-nexus-info-soft)]', fg: 'text-[var(--color-nexus-info)]' },
];

export interface LeaveBalanceEntry {
  id?: number | string;
  code?: string;
  name: string;
  maxDaysPerYear?: number | string;
  usedDays?: number | string;
  adjustmentDays?: number | string;
  remainingDays?: number | string;
}

export default function LeaveBalanceCards({
  balances,
  emptyMessage = 'No leave policy has been assigned yet.',
  onSelect,
}: {
  balances: LeaveBalanceEntry[] | null | undefined;
  emptyMessage?: string;
  // Optional — when provided, each card becomes clickable (e.g. the
  // employee's own Leave Tracker uses this to pre-select that leave type
  // and open the Apply Leave modal). The read-only admin drill-down view
  // (LeaveManagementPage.tsx's Reportees modal) omits this and stays
  // purely informational, same as before.
  onSelect?: (balance: LeaveBalanceEntry) => void;
}) {
  if (!balances || balances.length === 0) {
    return <p className="text-sm text-[var(--color-nexus-muted)]">{emptyMessage}</p>;
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
      {balances.map((balance, i) => {
        const Icon = ICONS[i % ICONS.length];
        const palette = PALETTES[i % PALETTES.length];
        const maxDays = Number(balance.maxDaysPerYear || 0);
        const used = Number(balance.usedDays || 0);
        const adjustment = Number(balance.adjustmentDays || 0);
        const available = balance.remainingDays != null ? Number(balance.remainingDays) : Math.max(0, maxDays + adjustment - used);
        const CardTag = onSelect ? 'button' : 'div';
        return (
          <CardTag
            key={balance.id ?? balance.code ?? balance.name}
            type={onSelect ? 'button' : undefined}
            onClick={onSelect ? () => onSelect(balance) : undefined}
            className={`shrink-0 w-56 rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] p-4 text-left ${onSelect ? 'hover:border-[var(--color-nexus-primary)] hover:shadow-md transition-all cursor-pointer' : ''}`}
          >
            <div className={`w-10 h-10 rounded-xl ${palette.bg} ${palette.fg} flex items-center justify-center mb-3`}>
              <Icon size={18} />
            </div>
            <h4 className="text-sm font-bold text-[var(--color-nexus-ink)] truncate" title={balance.name}>{balance.name}</h4>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="text-[var(--color-nexus-muted)]">Available: <strong className="text-[var(--color-nexus-success-text)]">{available}</strong></span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs">
              <span className="text-[var(--color-nexus-muted)]">Booked: <strong className="text-[var(--color-nexus-ink)]">{used}</strong></span>
              <Info size={11} className="text-[var(--color-nexus-muted)] shrink-0" aria-label={`${maxDays} day(s) per year policy`} >
                <title>{`${maxDays} day(s)/year policy${adjustment ? ` · ${adjustment > 0 ? '+' : ''}${adjustment} adjustment` : ''}`}</title>
              </Info>
            </div>
            {onSelect && (
              <span className="block mt-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-primary)]">Apply this leave →</span>
            )}
          </CardTag>
        );
      })}
    </div>
  );
}
