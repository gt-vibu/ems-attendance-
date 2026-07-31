// Shared cell/summary formatting for the Reports wizard — one implementation
// used by both the live preview (ReportPreview.tsx) and the wizard's own
// inline table, so a value never renders differently in two places.

export type CellFormat = 'hours' | 'currency' | 'boolean';
export type SummaryFormat = 'hours' | 'currency' | 'percentage';

export function formatCell(row: any, key: string, format?: CellFormat): string {
  const val = row?.[key];
  if (val === undefined || val === null || val === '') return 'N/A';
  if (format === 'boolean') return val ? 'Yes' : 'No';
  if (format === 'hours') return `${val} hrs`;
  if (format === 'currency') return `$${Number(val).toLocaleString()}`;
  return String(val);
}

export function formatSummary(val: any, format?: SummaryFormat): string {
  if (val === undefined || val === null) return 'N/A';
  if (format === 'hours') return `${val} hrs`;
  if (format === 'currency') return `$${Number(val).toLocaleString()}`;
  if (format === 'percentage') return `${val}%`;
  return String(val);
}

// Color-codes known status values so a report reads at a glance instead of
// requiring the reader to parse text — matches STATUS_LABELS in
// api/services/reportData.ts plus leave/payroll status strings. Returns
// null for anything unrecognized, so callers fall back to plain text.
export interface StatusBadgeStyle {
  bg: string;
  text: string;
  dot: string;
}

const STATUS_BADGE_STYLES: Record<string, StatusBadgeStyle> = {
  present: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: '#10b981' },
  approved: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: '#10b981' },
  absent: { bg: 'bg-rose-50', text: 'text-rose-700', dot: '#e11d48' },
  'absent (lop)': { bg: 'bg-rose-50', text: 'text-rose-700', dot: '#e11d48' },
  rejected: { bg: 'bg-rose-50', text: 'text-rose-700', dot: '#e11d48' },
  late: { bg: 'bg-amber-50', text: 'text-amber-700', dot: '#d97706' },
  pending: { bg: 'bg-amber-50', text: 'text-amber-700', dot: '#d97706' },
  'half day': { bg: 'bg-amber-50', text: 'text-amber-700', dot: '#d97706' },
  'on leave (paid)': { bg: 'bg-purple-50', text: 'text-purple-700', dot: '#9333ea' },
  'on leave (unpaid)': { bg: 'bg-purple-50', text: 'text-purple-700', dot: '#9333ea' },
  wfh: { bg: 'bg-blue-50', text: 'text-blue-700', dot: '#2563eb' },
  holiday: { bg: 'bg-slate-100', text: 'text-slate-600', dot: '#64748b' },
  weekend: { bg: 'bg-slate-100', text: 'text-slate-600', dot: '#64748b' },
};

export function statusBadgeStyle(value: string): StatusBadgeStyle | null {
  return STATUS_BADGE_STYLES[String(value || '').toLowerCase().trim()] || null;
}
