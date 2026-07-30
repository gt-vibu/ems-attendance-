import React from 'react';
import {
  GripVertical,
  Eye,
  EyeOff,
  MoveUp,
  MoveDown,
  Layout,
  BarChart2,
  PieChart,
  FileSpreadsheet,
  ShieldCheck,
  CreditCard,
  PenTool,
  Info,
  CheckCircle2
} from 'lucide-react';
import { ReportSectionConfig } from './reportMetadata';

export interface SectionBuilderProps {
  sections: ReportSectionConfig[];
  onToggleSection: (sectionId: string) => void;
  onMoveSection: (index: number, direction: 'up' | 'down') => void;
  onResetSections?: () => void;
}

const SECTION_ICONS: Record<string, React.ElementType> = {
  header: Layout,
  kpi_cards: BarChart2,
  chart_analytics: PieChart,
  dept_comparison: BarChart2,
  data_table: FileSpreadsheet,
  compliance_alerts: ShieldCheck,
  payroll_summary: CreditCard,
  signature_block: PenTool,
  audit_footer: Info
};

export const SectionBuilder: React.FC<SectionBuilderProps> = ({
  sections,
  onToggleSection,
  onMoveSection,
  onResetSections
}) => {
  const enabledCount = sections.filter(s => s.enabled).length;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4 font-sans">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Layout className="w-4 h-4 text-indigo-600" />
            Section-Based Layout Designer
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Enable, disable, and reorder structural blocks in your output report template ({enabledCount} active).
          </p>
        </div>
        {onResetSections && (
          <button
            onClick={onResetSections}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition"
          >
            Reset Layout
          </button>
        )}
      </div>

      <div className="space-y-2">
        {sections.map((sec, idx) => {
          const Icon = SECTION_ICONS[sec.type] || Layout;
          return (
            <div
              key={sec.id}
              className={`flex items-center justify-between p-3 rounded-lg border transition ${
                sec.enabled
                  ? 'bg-slate-50/70 border-slate-200 hover:border-indigo-300'
                  : 'bg-slate-100/40 border-dashed border-slate-200 opacity-60'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="text-slate-400 cursor-grab active:cursor-grabbing p-1">
                  <GripVertical className="w-4 h-4" />
                </div>
                <div className={`p-2 rounded-lg shrink-0 ${sec.enabled ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-200 text-slate-500'}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 truncate">
                      {sec.title}
                    </span>
                    {sec.enabled && (
                      <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.2 rounded flex items-center gap-1">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 truncate mt-0.5">
                    {sec.description}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0 ml-3">
                <button
                  disabled={idx === 0}
                  onClick={() => onMoveSection(idx, 'up')}
                  className="p-1.5 rounded hover:bg-slate-200 text-slate-500 disabled:opacity-30 transition"
                  title="Move Up"
                >
                  <MoveUp className="w-3.5 h-3.5" />
                </button>
                <button
                  disabled={idx === sections.length - 1}
                  onClick={() => onMoveSection(idx, 'down')}
                  className="p-1.5 rounded hover:bg-slate-200 text-slate-500 disabled:opacity-30 transition"
                  title="Move Down"
                >
                  <MoveDown className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onToggleSection(sec.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition ml-1 ${
                    sec.enabled
                      ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                      : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                  }`}
                >
                  {sec.enabled ? (
                    <>
                      <Eye className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Visible</span>
                    </>
                  ) : (
                    <>
                      <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                      <span>Hidden</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SectionBuilder;
