import type { LucideIcon } from 'lucide-react';
import { TrendingDown, TrendingUp } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  caption?: string;
  icon: LucideIcon;
  /** Icon chip background — defaults to the Nexus "primary-fixed" lavender chip. */
  iconBg?: string;
  iconColor?: string;
  trend?: 'up' | 'down' | 'neutral';
  onClick?: () => void;
}

// Shared stat-card primitive matching the "Nexus Enterprise" reference's
// stat-card shape (admin dashboard, attendance history, and payroll all use
// this identical layout: icon chip + uppercase label + big number + small
// caption). Renders as a button when onClick is passed, a div otherwise.
export default function StatCard({ label, value, caption, icon: Icon, iconBg, iconColor, trend, onClick }: StatCardProps) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`nexus-card p-4 text-left w-full ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-semibold text-[var(--color-nexus-muted)] uppercase tracking-wider">{label}</span>
        <span
          className="rounded-md p-1 shrink-0"
          style={{ background: iconBg || 'var(--color-nexus-primary-fixed)', color: iconColor || 'var(--color-nexus-ink)' }}
        >
          <Icon size={16} />
        </span>
      </div>
      <div className="text-[28px] leading-tight font-bold text-[var(--color-nexus-ink)]">{value}</div>
      {caption && (
        <div
          className="mt-1.5 text-[12px] font-medium flex items-center gap-1"
          style={{ color: trend === 'up' ? 'var(--color-nexus-success-text)' : trend === 'down' ? 'var(--color-nexus-error)' : 'var(--color-nexus-muted)' }}
        >
          {trend === 'up' && <TrendingUp size={13} />}
          {trend === 'down' && <TrendingDown size={13} />}
          {caption}
        </div>
      )}
    </Wrapper>
  );
}
