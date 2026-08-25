import React, { useState, useEffect } from 'react';
import { ShieldCheck, Scale, FileText, CheckCircle, Info, Building2 } from 'lucide-react';

export default function StatutoryRulesView() {
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'epf' | 'esi' | 'pt' | 'tds'>('tds');

  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/tenant/compliance/rules');
      const data = await res.json();
      if (data.success) {
        setRules(data.rules || []);
      }
    } catch (err) {
      console.error('Failed to fetch statutory rules catalog', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredRules = rules.filter((r) => r.category === activeTab);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="nexus-card rounded-2xl p-6 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white shadow-xl border border-indigo-500/20">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-6 h-6 text-indigo-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">System Statutory Rules Catalog (Layer A)</h2>
            </div>
            <p className="text-xs text-indigo-200 max-w-2xl">
              Legally mandated statutory compliance rules enforced system-wide. Rules are versioned, effective-dated, jurisdiction-aware, and read-only for tenant administrators to prevent illegal configurations.
            </p>
          </div>
          <div className="flex items-center gap-2 bg-indigo-500/10 border border-indigo-400/30 rounded-xl px-4 py-2 text-xs font-semibold text-indigo-300">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            <span>Effective Dated & Audited</span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mt-6 border-b border-indigo-500/20 pb-2">
          <button
            onClick={() => setActiveTab('tds')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'tds' ? 'bg-indigo-600 text-white shadow-md' : 'text-indigo-300 hover:bg-indigo-900/40'
            }`}
          >
            TDS / Income Tax Act, 2025
          </button>
          <button
            onClick={() => setActiveTab('epf')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'epf' ? 'bg-indigo-600 text-white shadow-md' : 'text-indigo-300 hover:bg-indigo-900/40'
            }`}
          >
            EPF / Provident Fund
          </button>
          <button
            onClick={() => setActiveTab('esi')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'esi' ? 'bg-indigo-600 text-white shadow-md' : 'text-indigo-300 hover:bg-indigo-900/40'
            }`}
          >
            ESI / State Insurance
          </button>
          <button
            onClick={() => setActiveTab('pt')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'pt' ? 'bg-indigo-600 text-white shadow-md' : 'text-indigo-300 hover:bg-indigo-900/40'
            }`}
          >
            Professional Tax (State Slabs)
          </button>
        </div>
      </div>

      {loading ? (
        <div className="nexus-card rounded-2xl p-12 text-center text-sm font-semibold text-slate-500">
          Loading statutory compliance rules...
        </div>
      ) : filteredRules.length === 0 ? (
        <div className="nexus-card rounded-2xl p-12 text-center text-sm text-slate-500">
          No statutory rules registered for category '{activeTab.toUpperCase()}'.
        </div>
      ) : (
        <div className="space-y-6">
          {filteredRules.map((rule) => (
            <div key={rule.id} className="nexus-card rounded-2xl p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-3">
                  <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200/50">
                    {rule.jurisdiction}
                  </span>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{rule.name}</h3>
                </div>
                <span className="text-xs font-mono text-slate-400">Rule Code: {rule.ruleCode}</span>
              </div>

              {rule.activeVersions && rule.activeVersions.length > 0 ? (
                rule.activeVersions.map((v: any) => (
                  <div key={v.id} className="rounded-xl bg-slate-50 dark:bg-slate-950/60 p-4 border border-slate-200/60 dark:border-slate-800/80 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
                      <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                        <Scale className="w-4 h-4" />
                        <span>Version {v.version} (Effective: {v.effectiveFrom} {v.effectiveTo ? `to ${v.effectiveTo}` : 'onwards'})</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-500">
                        <Building2 className="w-3.5 h-3.5" />
                        <span>Authority: {v.authority}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      <div className="space-y-1">
                        <span className="font-bold text-slate-700 dark:text-slate-300">Legal Reference & Act:</span>
                        <p className="text-slate-600 dark:text-slate-400 font-mono bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-800">{v.legalReference}</p>
                      </div>
                      <div className="space-y-1">
                        <span className="font-bold text-slate-700 dark:text-slate-300">Calculation Formula / Logic:</span>
                        <p className="text-slate-600 dark:text-slate-400 font-mono bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-800">{v.calculationFormula}</p>
                      </div>
                    </div>

                    {/* Parameter Visualization */}
                    <div className="space-y-2">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5 text-indigo-500" />
                        Rule Parameters & Thresholds
                      </span>

                      {v.parameters.slabs ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="bg-slate-200/50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 font-bold">
                                <th className="p-2 rounded-l-lg">Gross Wage Bracket</th>
                                <th className="p-2 rounded-r-lg">Statutory Amount / Rate</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/60">
                              {(v.parameters.slabs || v.parameters.newRegimeSlabs).map((s: any, idx: number) => (
                                <tr key={idx} className="hover:bg-slate-100/50 dark:hover:bg-slate-900/50">
                                  <td className="p-2 font-mono">
                                    {s.upTo != null
                                      ? `Up to ₹${s.upTo.toLocaleString('en-IN')}`
                                      : s.maxGross != null
                                      ? `₹${s.minGross.toLocaleString('en-IN')} - ₹${s.maxGross.toLocaleString('en-IN')}`
                                      : `Above ₹${(s.minGross || 0).toLocaleString('en-IN')}`}
                                  </td>
                                  <td className="p-2 font-bold text-indigo-600 dark:text-indigo-400">
                                    {s.ratePercent != null ? `${s.ratePercent}%` : `₹${s.amount}/month`}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          {Object.entries(v.parameters).map(([key, val]) => (
                            <div key={key} className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs">
                              <span className="text-[10px] uppercase font-bold text-slate-400 block">{key.replace(/([A-Z])/g, ' $1')}</span>
                              <span className="font-bold text-slate-900 dark:text-slate-100">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-400">No active version found.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
