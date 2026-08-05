import React, { ReactNode } from 'react';
import { DashboardMetric } from './DashboardTemplate';
import { Download, Calendar, Filter, RefreshCw, BarChart2, FileSpreadsheet } from 'lucide-react';

export interface AnalyticsTemplateProps {
  title: string;
  subtitle?: string;
  badge?: string;
  metrics?: DashboardMetric[];
  chartSection?: ReactNode;
  filterControls?: ReactNode;
  primaryActions?: ReactNode;
  secondaryActions?: ReactNode;
  onExport?: () => void;
  onSchedule?: () => void;
  children: ReactNode;
  detailDrawer?: ReactNode;
}

export default function AnalyticsTemplate({
  title,
  subtitle,
  badge,
  metrics,
  chartSection,
  filterControls,
  primaryActions,
  secondaryActions,
  onExport,
  onSchedule,
  children,
  detailDrawer,
}: AnalyticsTemplateProps) {
  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Analytics Workspace Header */}
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

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {onSchedule && (
            <button
              onClick={onSchedule}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-nexus-control)] border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] text-xs font-semibold text-[var(--color-nexus-ink)] hover:bg-[var(--color-nexus-surface-alt)] transition-colors"
            >
              <Calendar size={14} />
              Schedule Report
            </button>
          )}
          {onExport && (
            <button
              onClick={onExport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-nexus-control)] bg-[var(--color-nexus-primary)] text-white text-xs font-bold hover:bg-[var(--color-nexus-primary-hover)] transition-colors shadow-xs"
            >
              <Download size={14} />
              Export Data
            </button>
          )}
          {secondaryActions}
          {primaryActions}
        </div>
      </div>

      {/* Multi-Metric Summary Cards */}
      {metrics && metrics.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {metrics.map((metric, idx) => {
            const Icon = metric.icon || BarChart2;
            return (
              <div
                key={idx}
                className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-[var(--radius-nexus-card)] p-3.5 shadow-xs flex flex-col justify-between"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[var(--color-nexus-muted)] truncate">
                    {metric.label}
                  </span>
                  <div className="p-1.5 rounded-md bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-primary)] shrink-0">
                    <Icon size={14} />
                  </div>
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="text-xl md:text-2xl font-extrabold text-[var(--color-nexus-ink)] tracking-tight">
                    {metric.value}
                  </span>
                  {metric.change && (
                    <span
                      className={`text-[10px] font-bold ${
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
              </div>
            );
          })}
        </div>
      )}

      {/* Analytical Charts Section */}
      {chartSection && (
        <div className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-[var(--radius-nexus-card)] p-4 md:p-5 shadow-xs">
          {chartSection}
        </div>
      )}

      {/* Filter Toolbar */}
      {filterControls && (
        <div className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-[var(--radius-nexus-card)] p-3 shadow-xs flex items-center gap-3 overflow-x-auto">
          <div className="flex items-center gap-2 text-xs font-bold text-[var(--color-nexus-muted)] shrink-0 pr-2 border-r border-[var(--color-nexus-border)]">
            <Filter size={14} />
            Filters:
          </div>
          {filterControls}
        </div>
      )}

      {/* Main Analytics Data Table Workspace */}
      <div className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-[var(--radius-nexus-card)] shadow-xs overflow-hidden">
        {children}
      </div>

      {detailDrawer}
    </div>
  );
}
