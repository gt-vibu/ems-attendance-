import React, { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

export interface DashboardMetric {
  label: string;
  value: string | number;
  subtext?: string;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  icon?: LucideIcon;
}

export interface DashboardTemplateProps {
  title: string;
  subtitle?: string;
  badge?: string;
  metrics?: DashboardMetric[];
  primaryActions?: ReactNode;
  secondaryActions?: ReactNode;
  quickActions?: ReactNode;
  children: ReactNode;
  sidePanel?: ReactNode;
  footer?: ReactNode;
}

export default function DashboardTemplate({
  title,
  subtitle,
  badge,
  metrics,
  primaryActions,
  secondaryActions,
  quickActions,
  children,
  sidePanel,
  footer,
}: DashboardTemplateProps) {
  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Workspace Header */}
      <div className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-[var(--radius-nexus-card)] p-4 md:p-5 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-lg md:text-xl font-bold text-[var(--color-nexus-ink)] tracking-tight">
              {title}
            </h1>
            {badge && (
              <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)]">
                {badge}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="text-xs md:text-sm text-[var(--color-nexus-muted)] truncate">
              {subtitle}
            </p>
          )}
        </div>

        {(primaryActions || secondaryActions) && (
          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            {secondaryActions}
            {primaryActions}
          </div>
        )}
      </div>

      {/* Multi-Metric Summary Strip (Grouped Card to reduce vertical waste) */}
      {metrics && metrics.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {metrics.map((metric, idx) => {
            const Icon = metric.icon;
            return (
              <div
                key={idx}
                className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-[var(--radius-nexus-card)] p-3.5 shadow-xs flex flex-col justify-between"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[var(--color-nexus-muted)] truncate">
                    {metric.label}
                  </span>
                  {Icon && (
                    <div className="p-1.5 rounded-md bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-secondary)] shrink-0">
                      <Icon size={15} />
                    </div>
                  )}
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="text-xl md:text-2xl font-extrabold text-[var(--color-nexus-ink)] tracking-tight">
                    {metric.value}
                  </span>
                  {metric.change && (
                    <span
                      className={`text-[11px] font-bold ${
                        metric.changeType === 'positive'
                          ? 'text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded'
                          : metric.changeType === 'negative'
                          ? 'text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded'
                          : 'text-[var(--color-nexus-muted)] bg-[var(--color-nexus-surface-alt)] px-1.5 py-0.5 rounded'
                      }`}
                    >
                      {metric.change}
                    </span>
                  )}
                </div>
                {metric.subtext && (
                  <p className="mt-1 text-[11px] text-[var(--color-nexus-muted)] truncate">
                    {metric.subtext}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Quick Action Ribbon */}
      {quickActions && (
        <div className="bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg p-2.5 flex items-center gap-2 overflow-x-auto">
          {quickActions}
        </div>
      )}

      {/* Main Workspace Body & Side Panel */}
      <div className={`grid grid-cols-1 ${sidePanel ? 'lg:grid-cols-3' : 'grid-cols-1'} gap-5`}>
        <div className={sidePanel ? 'lg:col-span-2 space-y-5' : 'space-y-5'}>
          {children}
        </div>
        {sidePanel && (
          <div className="space-y-5">
            {sidePanel}
          </div>
        )}
      </div>

      {footer && <div>{footer}</div>}
    </div>
  );
}
