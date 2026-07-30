import React from 'react';
import { KpiMetricConfig } from './reportMetadata';
import { Sliders, CheckSquare, Square, TrendingUp, Users, Clock, DollarSign, ShieldAlert } from 'lucide-react';

export interface KpiConfiguratorProps {
  metrics: KpiMetricConfig[];
  onToggleMetric: (metricId: string) => void;
}

const METRIC_ICONS: Record<string, React.ElementType> = {
  Users,
  Clock,
  TrendingUp,
  DollarSign,
  ShieldAlert
};

export const KpiConfigurator: React.FC<KpiConfiguratorProps> = ({
  metrics,
  onToggleMetric
}) => {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4 font-sans">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Sliders className="w-4 h-4 text-indigo-600" />
            Configurable Summary KPIs
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Select the key performance metrics displayed at the top of executive report summaries.
          </p>
        </div>
        <span className="text-xs font-semibold px-2 py-1 rounded bg-indigo-50 text-indigo-700">
          {metrics.filter(m => m.enabled).length} of {metrics.length} Selected
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {metrics.map((metric) => {
          const Icon = METRIC_ICONS[metric.iconName] || Users;
          return (
            <button
              key={metric.id}
              onClick={() => onToggleMetric(metric.id)}
              className={`flex items-center justify-between p-3 rounded-lg border text-left transition ${
                metric.enabled
                  ? 'bg-indigo-50/40 border-indigo-200 hover:bg-indigo-50'
                  : 'bg-slate-50 border-slate-200 opacity-60 hover:opacity-100'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={`p-1.5 rounded-md shrink-0 ${metric.enabled ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900 truncate">
                    {metric.title}
                  </p>
                  <p className="text-[10px] text-slate-500 font-medium">
                    Format: {metric.format.toUpperCase()}
                  </p>
                </div>
              </div>

              {metric.enabled ? (
                <CheckSquare className="w-4 h-4 text-indigo-600 shrink-0 ml-2" />
              ) : (
                <Square className="w-4 h-4 text-slate-400 shrink-0 ml-2" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default KpiConfigurator;
