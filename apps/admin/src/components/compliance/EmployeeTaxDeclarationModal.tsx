import React, { useState, useEffect } from 'react';
import { X, FileText, CheckCircle2, AlertCircle, Save } from 'lucide-react';

export interface EmployeeTaxDeclarationModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: number;
  userName: string;
  financialYear?: string;
  isHrView?: boolean;
}

export default function EmployeeTaxDeclarationModal({
  isOpen,
  onClose,
  userId,
  userName,
  financialYear = '2026-2027',
  isHrView = false,
}: EmployeeTaxDeclarationModalProps) {
  const [declaration, setDeclaration] = useState<any>({
    financialYear,
    regime: 'new_regime',
    section80c: 0,
    section80d: 0,
    section80ccd1b: 0,
    hraRentPaid: 0,
    isMetroCity: false,
    homeLoanInterest24b: 0,
    otherIncome: 0,
    previousEmployerIncome: 0,
    previousEmployerTds: 0,
  });

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (isOpen && userId) {
      fetchDeclaration();
    }
  }, [isOpen, userId, financialYear]);

  const fetchDeclaration = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/tenant/compliance/tax-declarations/${userId}?financialYear=${financialYear}`);
      const data = await res.json();
      if (data.success && data.declaration) {
        setDeclaration(data.declaration);
      }
    } catch (err) {
      console.error('Failed to fetch tax declaration', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setMessage(null);

      const res = await fetch(`/api/tenant/compliance/tax-declarations/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...declaration, financialYear }),
      });

      const data = await res.json();
      if (data.success) {
        setDeclaration(data.declaration);
        setMessage({ type: 'success', text: 'Tax declaration submitted successfully.' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to submit declaration.' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Server error.' });
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async (status: 'verified' | 'rejected') => {
    if (!declaration.id) return;
    try {
      setSaving(true);
      const res = await fetch(`/api/tenant/compliance/tax-declarations/${declaration.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (data.success) {
        setDeclaration(data.declaration);
        setMessage({ type: 'success', text: `Declaration proof status updated to '${status}'.` });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Verification failed.' });
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="nexus-card w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              Tax Declaration ({financialYear})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Employee: <span className="font-semibold text-slate-800 dark:text-slate-200">{userName}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
          {message && (
            <div className={`p-4 rounded-xl flex items-center gap-2 ${
              message.type === 'success' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200' : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200'
            }`}>
              {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <AlertCircle className="w-4 h-4 text-rose-500" />}
              {message.text}
            </div>
          )}

          {loading ? (
            <div className="p-8 text-center text-slate-400 font-semibold">Loading tax declaration...</div>
          ) : (
            <form id="tax-form" onSubmit={handleSave} className="space-y-6">
              {/* Regime Selection */}
              <div className="p-4 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/40 border border-indigo-200/50 dark:border-indigo-800/50 space-y-3">
                <label className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                  Select Income Tax Regime
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className={`p-3 rounded-xl border cursor-pointer transition-all flex flex-col gap-1 ${
                    declaration.regime === 'new_regime'
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                  }`}>
                    <input
                      type="radio"
                      name="regime"
                      value="new_regime"
                      checked={declaration.regime === 'new_regime'}
                      onChange={() => setDeclaration({ ...declaration, regime: 'new_regime' })}
                      className="sr-only"
                    />
                    <span className="font-bold">New Tax Regime</span>
                    <span className="text-[10px] opacity-80">ITA 2025 Sec 392(1) AY26-27 Slabs + ₹75k Std Ded. Lower rates, zero exemptions required.</span>
                  </label>

                  <label className={`p-3 rounded-xl border cursor-pointer transition-all flex flex-col gap-1 ${
                    declaration.regime === 'old_regime'
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                  }`}>
                    <input
                      type="radio"
                      name="regime"
                      value="old_regime"
                      checked={declaration.regime === 'old_regime'}
                      onChange={() => setDeclaration({ ...declaration, regime: 'old_regime' })}
                      className="sr-only"
                    />
                    <span className="font-bold">Old Tax Regime</span>
                    <span className="text-[10px] opacity-80">Supports Chapter VI-A deductions (80C, 80D, HRA, Sec 24b). Requires proof verification.</span>
                  </label>
                </div>
              </div>

              {/* Itemized Declarations (Old Regime) */}
              {declaration.regime === 'old_regime' && (
                <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <h4 className="font-bold text-slate-800 dark:text-slate-200">Chapter VI-A Itemized Declarations</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Section 80C (Max ₹1.5L)</label>
                      <input
                        type="number"
                        value={declaration.section80c || 0}
                        onChange={(e) => setDeclaration({ ...declaration, section80c: Number(e.target.value) })}
                        className="w-full rounded-xl p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-semibold"
                        placeholder="PF, LIC, PPF, ELSS, Tuition"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Section 80D Health Insurance</label>
                      <input
                        type="number"
                        value={declaration.section80d || 0}
                        onChange={(e) => setDeclaration({ ...declaration, section80d: Number(e.target.value) })}
                        className="w-full rounded-xl p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-semibold"
                        placeholder="Self, Family, Parents Mediclaim"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Annual HRA Rent Paid</label>
                      <input
                        type="number"
                        value={declaration.hraRentPaid || 0}
                        onChange={(e) => setDeclaration({ ...declaration, hraRentPaid: Number(e.target.value) })}
                        className="w-full rounded-xl p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-semibold"
                        placeholder="Annual rent paid to landlord"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Section 24(b) Home Loan Interest</label>
                      <input
                        type="number"
                        value={declaration.homeLoanInterest24b || 0}
                        onChange={(e) => setDeclaration({ ...declaration, homeLoanInterest24b: Number(e.target.value) })}
                        className="w-full rounded-xl p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-semibold"
                        placeholder="Interest on self-occupied housing loan"
                      />
                    </div>
                  </div>
                </div>
              )}
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 flex flex-wrap items-center justify-between gap-3">
          {isHrView && declaration.id && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleVerify('verified')}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs"
              >
                Approve Proofs
              </button>
              <button
                type="button"
                onClick={() => handleVerify('rejected')}
                className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs"
              >
                Reject Proofs
              </button>
            </div>
          )}

          <div className="flex gap-2 ml-auto">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 font-bold text-xs text-slate-700 dark:text-slate-300">
              Close
            </button>
            <button
              type="submit"
              form="tax-form"
              disabled={saving}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md transition-all disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Submitting...' : 'Submit Declaration'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
