import React, { ReactNode } from 'react';
import { DashboardMetric } from './DashboardTemplate';
import { Search, Filter, SlidersHorizontal, RefreshCw } from 'lucide-react';

export interface TabOption {
  id: string;
  label: string;
  count?: number;
}

export interface ManagementTemplateProps {
  title: string;
  subtitle?: string;
  badge?: string;
  metrics?: DashboardMetric[];
  tabs?: TabOption[];
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  searchPlaceholder?: string;
  filterControls?: ReactNode;
  primaryActions?: ReactNode;
  secondaryActions?: ReactNode;
  children: ReactNode;
  detailDrawer?: ReactNode;
}

export default function ManagementTemplate({
  title,
  subtitle,
  badge,
  metrics,
  tabs,
  activeTab,
  onTabChange,
  searchQuery,
  onSearchChange,
  searchPlaceholder = 'Search records...',
  filterControls,
  primaryActions,
  secondaryActions,
  children,
  detailDrawer,
}: ManagementTemplateProps) {
  return (
    <div className="space-y-4 animate-in fade-in duration-200">
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
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {secondaryActions}
            {primaryActions}
          </div>
        )}
      </div>

      {/* Multi-Metric Summary Cards */}
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
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-xl font-extrabold text-[var(--color-nexus-ink)] tracking-tight">
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

      {/* Enterprise Toolbar & Filter Bar */}
      <div className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-[var(--radius-nexus-card)] p-3 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search bar */}
          {onSearchChange !== undefined && (
            <div className="relative flex-1 min-w-[200px]">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-nexus-muted)]"
              />
              <input
                type="text"
                value={searchQuery || ''}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full pl-8 pr-3 py-1.5 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-[var(--radius-nexus-control)] text-xs text-[var(--color-nexus-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary-fixed)] focus:bg-[var(--color-nexus-surface)]"
              />
            </div>
          )}

          {/* Filter Controls */}
          {filterControls && (
            <div className="flex items-center gap-2 overflow-x-auto">
              {filterControls}
            </div>
          )}
        </div>

        {/* Workspace Category Tabs */}
        {tabs && tabs.length > 0 && (
          <div className="flex items-center gap-1 border-t border-[var(--color-nexus-border)] pt-2.5 overflow-x-auto">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onTabChange && onTabChange(tab.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] font-bold'
                      : 'text-[var(--color-nexus-secondary)] hover:bg-[var(--color-nexus-surface-alt)] hover:text-[var(--color-nexus-ink)]'
                  }`}
                >
                  <span>{tab.label}</span>
                  {typeof tab.count === 'number' && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                        isActive
                          ? 'bg-white text-[var(--color-nexus-primary)] font-extrabold'
                          : 'bg-[var(--color-nexus-surface-sunken)] text-[var(--color-nexus-muted)]'
                      }`}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Main Table / Grid Workspace */}
      <div className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-[var(--radius-nexus-card)] shadow-xs overflow-hidden">
        {children}
      </div>

      {/* Detail Side Panel Drawer (if active) */}
      {detailDrawer}
    </div>
  );
}
