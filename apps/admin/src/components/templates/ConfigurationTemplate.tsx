import React, { ReactNode, useState } from 'react';
import { DashboardMetric } from './DashboardTemplate';
import { ChevronDown, ChevronRight, Save, ShieldCheck, HelpCircle, CheckCircle2, History } from 'lucide-react';

export interface ConfigSection {
  id: string;
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  badge?: string;
  content: ReactNode;
}

export interface ConfigurationTemplateProps {
  title: string;
  subtitle?: string;
  badge?: string;
  healthMetrics?: DashboardMetric[];
  sections: ConfigSection[];
  activeSectionId?: string;
  onSectionChange?: (sectionId: string) => void;
  previewPanel?: ReactNode;
  auditPanel?: ReactNode;
  onSave?: () => void;
  saving?: boolean;
  hasUnsavedChanges?: boolean;
  primaryActions?: ReactNode;
}

export default function ConfigurationTemplate({
  title,
  subtitle,
  badge,
  healthMetrics,
  sections,
  activeSectionId,
  onSectionChange,
  previewPanel,
  auditPanel,
  onSave,
  saving = false,
  hasUnsavedChanges = false,
  primaryActions,
}: ConfigurationTemplateProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    sections.forEach((sec, idx) => {
      initial[sec.id] = idx === 0 || idx === 1; // Default expand first two
    });
    return initial;
  });

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const expandAll = () => {
    const all: Record<string, boolean> = {};
    sections.forEach((sec) => (all[sec.id] = true));
    setExpandedSections(all);
  };

  const collapseAll = () => {
    const none: Record<string, boolean> = {};
    sections.forEach((sec) => (none[sec.id] = false));
    setExpandedSections(none);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200 pb-20">
      {/* Configuration Header */}
      <div className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-[var(--radius-nexus-card)] p-5 md:p-6 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
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

        <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-[var(--color-nexus-muted)]">
            <button
              onClick={expandAll}
              className="px-2 py-1 rounded hover:bg-[var(--color-nexus-surface-alt)] font-medium"
            >
              Expand All
            </button>
            <span>•</span>
            <button
              onClick={collapseAll}
              className="px-2 py-1 rounded hover:bg-[var(--color-nexus-surface-alt)] font-medium"
            >
              Collapse All
            </button>
          </div>
          {primaryActions}
          {onSave && (
            <button
              onClick={onSave}
              disabled={saving}
              className={`flex items-center gap-2 px-4 py-2 rounded-[var(--radius-nexus-control)] text-xs font-bold text-white transition-all shadow-xs ${
                hasUnsavedChanges
                  ? 'bg-amber-600 hover:bg-amber-700 animate-pulse'
                  : 'bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)]'
              }`}
            >
              <Save size={14} />
              {saving ? 'Saving...' : hasUnsavedChanges ? 'Save Unsaved Changes' : 'Save Configuration'}
            </button>
          )}
        </div>
      </div>

      {/* Policy Health / Metric Overview */}
      {healthMetrics && healthMetrics.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {healthMetrics.map((metric, idx) => {
            const Icon = metric.icon || ShieldCheck;
            return (
              <div
                key={idx}
                className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-[var(--radius-nexus-card)] p-4 md:p-5 shadow-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[var(--color-nexus-muted)] truncate">
                    {metric.label}
                  </span>
                  <div className="p-1.5 rounded-md bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-primary)] shrink-0">
                    <Icon size={14} />
                  </div>
                </div>
                <div className="mt-2.5 text-lg font-extrabold text-[var(--color-nexus-ink)]">
                  {metric.value}
                </div>
                {metric.subtext && (
                  <p className="text-[10.5px] text-[var(--color-nexus-muted)] truncate mt-1">
                    {metric.subtext}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Main Workspace Layout with Accordions + Side Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Accordions Column */}
        <div className="lg:col-span-2 space-y-4">
          {sections.map((sec) => {
            const isExpanded = expandedSections[sec.id] !== false;
            const Icon = sec.icon;

            return (
              <div
                key={sec.id}
                id={`config-section-${sec.id}`}
                className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-[var(--radius-nexus-card)] shadow-xs overflow-hidden transition-all"
              >
                {/* Accordion Header */}
                <button
                  type="button"
                  onClick={() => toggleSection(sec.id)}
                  className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-[var(--color-nexus-surface-alt)] transition-colors cursor-pointer border-b border-[var(--color-nexus-border)]/40"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    {Icon ? (
                      <div className="p-2.5 rounded-lg bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] shrink-0">
                        <Icon size={16} />
                      </div>
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-[var(--color-nexus-primary)] shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-[var(--color-nexus-ink)] tracking-tight">
                          {sec.title}
                        </h3>
                        {sec.badge && (
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-secondary)] font-semibold">
                            {sec.badge}
                          </span>
                        )}
                      </div>
                      {sec.subtitle && (
                        <p className="text-xs text-[var(--color-nexus-muted)] truncate mt-1">
                          {sec.subtitle}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="p-1 rounded text-[var(--color-nexus-muted)] shrink-0">
                    {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </div>
                </button>

                {/* Accordion Content */}
                {isExpanded && (
                  <div className="p-5 md:p-6 border-t border-[var(--color-nexus-border)]/50 bg-[var(--color-nexus-surface)] animate-in slide-in-from-top-1 duration-150">
                    {sec.content}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Side Preview / Audit Column */}
        <div className="space-y-5">
          {previewPanel && (
            <div className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-[var(--radius-nexus-card)] p-5 shadow-xs sticky top-16">
              <h4 className="text-xs font-mono font-bold text-[var(--color-nexus-muted)] uppercase tracking-wider mb-4 flex items-center gap-2">
                <ShieldCheck size={14} className="text-[var(--color-nexus-primary)]" />
                Live Configuration Flow
              </h4>
              {previewPanel}
            </div>
          )}

          {auditPanel && (
            <div className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-[var(--radius-nexus-card)] p-5 shadow-xs">
              <h4 className="text-xs font-mono font-bold text-[var(--color-nexus-muted)] uppercase tracking-wider mb-4 flex items-center gap-2">
                <History size={14} className="text-[var(--color-nexus-secondary)]" />
                Policy Audit History
              </h4>
              {auditPanel}
            </div>
          )}
        </div>
      </div>

      {/* Sticky Save Changes Floating Bar */}
      {hasUnsavedChanges && onSave && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white px-5 py-3 rounded-full shadow-2xl border border-slate-700 flex items-center gap-4 animate-in slide-in-from-bottom-5 duration-200">
          <span className="text-xs font-semibold flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            Unsaved policy changes detected
          </span>
          <button
            onClick={onSave}
            disabled={saving}
            className="px-4 py-1.5 rounded-full bg-blue-600 hover:bg-blue-500 text-xs font-bold transition-all"
          >
            {saving ? 'Saving...' : 'Apply Changes Now'}
          </button>
        </div>
      )}
    </div>
  );
}
