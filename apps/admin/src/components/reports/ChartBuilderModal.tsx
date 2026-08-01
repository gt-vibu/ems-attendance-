import React, { useState } from 'react';
import {
  BarChart2,
  PieChart,
  TrendingUp,
  X,
  Sliders,
  CheckCircle2,
  Sparkles
} from 'lucide-react';

export interface ChartConfig {
  id: string;
  chartType: 'bar' | 'line' | 'pie' | 'area';
  xAxisField: string;
  yAxisMetric: string;
  aggregation: 'count' | 'sum' | 'avg';
  title: string;
}

export interface ChartBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveChart: (chartConfig: ChartConfig) => void;
  availableFields: { id: string; label: string }[];
}

export const ChartBuilderModal: React.FC<ChartBuilderModalProps> = ({
  isOpen,
  onClose,
  onSaveChart,
  availableFields
}) => {
  const [chartType, setChartType] = useState<'bar' | 'line' | 'pie' | 'area'>('bar');
  const [title, setTitle] = useState('Department Working Hours Analysis');
  const [xAxisField, setXAxisField] = useState('department');
  const [yAxisMetric, setYAxisMetric] = useState('workingHours');
  const [aggregation, setAggregation] = useState<'count' | 'sum' | 'avg'>('avg');

  if (!isOpen) return null;

  const handleSave = () => {
    onSaveChart({
      id: `chart_${Date.now()}`,
      chartType,
      xAxisField,
      yAxisMetric,
      aggregation,
      title: title || 'Custom Chart Analytics'
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 font-sans">
      <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <BarChart2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Configurable Chart Builder</h3>
              <p className="text-xs text-slate-500">Design dynamic visual chart widgets for report headers</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Chart Widget Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Attendance Distribution by Department"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Chart Type Selection */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Visualization Type
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[
                { id: 'bar', label: 'Bar', icon: BarChart2 },
                { id: 'line', label: 'Line', icon: TrendingUp },
                { id: 'pie', label: 'Pie', icon: PieChart },
                { id: 'area', label: 'Area', icon: TrendingUp }
              ].map((t) => {
                const Icon = t.icon;
                const active = chartType === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setChartType(t.id as any)}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs font-bold transition ${
                      active
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-5 h-5 mb-1" />
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Axes Configuration */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                X-Axis Grouping Field
              </label>
              <select
                value={xAxisField}
                onChange={(e) => setXAxisField(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {availableFields.map(f => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Y-Axis Metric Field
              </label>
              <select
                value={yAxisMetric}
                onChange={(e) => setYAxisMetric(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {availableFields.map(f => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Aggregation */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Metric Aggregation Method
            </label>
            <div className="flex items-center gap-2">
              {[
                { id: 'avg', label: 'Average (AVG)' },
                { id: 'sum', label: 'Sum (TOTAL)' },
                { id: 'count', label: 'Record Count' }
              ].map((agg) => (
                <button
                  key={agg.id}
                  onClick={() => setAggregation(agg.id as any)}
                  className={`flex-1 py-2 px-2 rounded-lg text-xs font-semibold border transition ${
                    aggregation === agg.id
                      ? 'bg-indigo-50 border-indigo-500 text-indigo-700'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {agg.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Modal Action Footer */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Add Chart Widget
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChartBuilderModal;
