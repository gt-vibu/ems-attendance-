import type { ReactNode } from 'react';

type Tone = 'success' | 'warning' | 'error' | 'neutral' | 'info' | 'muted' | 'indigo' | 'purple' | 'slate';

const TONE_STYLES: Record<string, { bg: string; text: string }> = {
  success: { bg: 'rgba(111, 251, 190, 0.25)', text: 'var(--color-nexus-success-text)' },
  warning: { bg: 'var(--color-nexus-secondary-container)', text: 'var(--color-nexus-secondary)' },
  error: { bg: 'var(--color-nexus-error-soft)', text: 'var(--color-nexus-error)' },
  neutral: { bg: 'var(--color-nexus-surface-sunken)', text: 'var(--color-nexus-muted)' },
  muted: { bg: 'var(--color-nexus-surface-sunken)', text: 'var(--color-nexus-muted)' },
  info: { bg: 'var(--color-nexus-primary-fixed)', text: 'var(--color-nexus-ink)' },
  indigo: { bg: 'rgba(99, 102, 241, 0.15)', text: '#4338ca' },
  purple: { bg: 'rgba(168, 85, 247, 0.15)', text: '#6b21a8' },
  slate: { bg: 'rgba(100, 116, 139, 0.15)', text: '#334155' },
};

interface StatusPillProps {
  tone?: string;
  children: ReactNode;
  dot?: boolean;
}

// Shared status-badge primitive matching the reference's colored soft-bg
// rounded-full pill (attendance ON TIME/LATE/LEAVE, leave Approved/Pending/
// Rejected, payroll Deposited/Ready/Pending Approval/Completed).
export default function StatusPill({ tone = 'neutral', children, dot }: StatusPillProps) {
  const normalizedTone = String(tone || 'neutral').toLowerCase();
  const { bg, text } = TONE_STYLES[normalizedTone] || TONE_STYLES.neutral;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide"
      style={{ background: bg, color: text }}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: text }} />}
      {children}
    </span>
  );
}
