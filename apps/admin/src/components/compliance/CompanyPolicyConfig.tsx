import React, { useState, useEffect } from 'react';
import { Settings2, Save, CheckCircle2, ShieldAlert, AlertCircle } from 'lucide-react';

export default function CompanyPolicyConfig() {
  const [policy, setPolicy] = useState<any>({
    pfCappingStrategy: 'cap_at_statutory_ceiling',
    epsCappingStrategy: 'cap_at_statutory_ceiling',
    defaultTaxRegime: 'new_regime',
    effectiveFrom: '2026-04-01',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetchPolicy();
  }, []);

  const fetchPolicy = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/tenant/compliance/company-policy');
      const data = await res.json();
      if (data.success && data.policy) {
        setPolicy(data.policy);
      }
    } catch (err) {
      console.error('Failed to fetch company policy', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setMessage(null);

      const res = await fetch('/api/tenant/compliance/company-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policy),
      });

      const data = await res.json();
      if (data.success) {
        setPolicy(data.policy);
        setMessage({ type: 'success', text: 'Company payroll policy saved and statutory validation passed.' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save company policy.' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Server connection error.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="nexus-card p-8 text-center text-xs font-semibold text-slate-500">Loading policy options...</div>;
  }

  return (
    <form onSubmit={handleSave} className="nexus-card rounded-2xl p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Company Payroll Policy Options (Layer B)
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Configure employer choices permitted by statutory regulations. Settings are automatically validated against legal boundaries.
          </p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200/50">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Statutory Validator Active
        </div>
      </div>

      {message && (
        <div className={`p-4 rounded-xl text-xs flex items-center gap-2 ${
          message.type === 'success' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200' : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200'
        }`}>
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <AlertCircle className="w-4 h-4 text-rose-500" />}
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* EPF Capping Choice */}
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800 space-y-3">
          <label className="block text-xs font-bold text-slate-900 dark:text-slate-100">
            Provident Fund (EPF) Contribution Strategy
          </label>
          <p className="text-[11px] text-slate-500">
            Choose whether to cap employee PF contribution at the statutory ₹15,000 basic wage ceiling or calculate on actual basic salary.
          </p>
          <select
            value={policy.pfCappingStrategy}
            onChange={(e) => setPolicy({ ...policy, pfCappingStrategy: e.target.value })}
            className="w-full text-xs rounded-xl p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-semibold"
          >
            <option value="cap_at_statutory_ceiling">Cap Basic Wage at Statutory Ceiling (₹15,000 / month)</option>
            <option value="actual_basic">Compute PF on Full Actual Basic Salary</option>
          </select>
        </div>

        {/* EPS Capping Choice */}
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800 space-y-3">
          <label className="block text-xs font-bold text-slate-900 dark:text-slate-100">
            Pension Scheme (EPS) Employer Capping
          </label>
          <p className="text-[11px] text-slate-500">
            Employer Pension Scheme (8.33%) contribution is statutorily capped at ₹1,250/month (₹15,000 ceiling).
          </p>
          <select
            value={policy.epsCappingStrategy}
            onChange={(e) => setPolicy({ ...policy, epsCappingStrategy: e.target.value })}
            className="w-full text-xs rounded-xl p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-semibold"
          >
            <option value="cap_at_statutory_ceiling">Cap EPS Contribution at ₹1,250 / month (Standard)</option>
          </select>
        </div>

        {/* Default Tax Regime */}
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800 space-y-3">
          <label className="block text-xs font-bold text-slate-900 dark:text-slate-100">
            Default Income Tax Regime Preference
          </label>
          <p className="text-[11px] text-slate-500">
            Default regime used for TDS calculation when an employee has not explicitly submitted a tax regime election.
          </p>
          <select
            value={policy.defaultTaxRegime}
            onChange={(e) => setPolicy({ ...policy, defaultTaxRegime: e.target.value })}
            className="w-full text-xs rounded-xl p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-semibold"
          >
            <option value="new_regime">New Tax Regime (Section 392(1) Income Tax Act, 2025 - Default)</option>
            <option value="old_regime">Old Tax Regime (With Chapter VI-A Exemptions)</option>
          </select>
        </div>

        {/* Effective From */}
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800 space-y-3">
          <label className="block text-xs font-bold text-slate-900 dark:text-slate-100">
            Policy Effective Date
          </label>
          <p className="text-[11px] text-slate-500">
            Date from which this company policy applies to payroll calculations.
          </p>
          <input
            type="date"
            value={policy.effectiveFrom || '2026-04-01'}
            onChange={(e) => setPolicy({ ...policy, effectiveFrom: e.target.value })}
            className="w-full text-xs rounded-xl p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-semibold"
          />
        </div>
      </div>

      <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md transition-all disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Validating & Saving...' : 'Save & Apply Company Policy'}
        </button>
      </div>
    </form>
  );
}
