import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { User } from '../lib/auth';
import { AlertTriangle, CheckCircle2, Clock, Play, ArrowRight, Lock, Banknote, Receipt, Gift, TrendingUp, AlertCircle, Wallet } from 'lucide-react';
import AdminWorkspaceLayout from '../components/AdminWorkspaceLayout';
import AdminSalaryAdvancesWorkspace from '../components/AdminSalaryAdvancesWorkspace';

interface PayrollBatchPageProps {
  user: User;
  onLogout?: () => void;
}

const STAGES = ['draft', 'calculating', 'calculated', 'pending_hr_review', 'pending_finance_review', 'approved', 'payslips_generated', 'released', 'locked'];
const STAGE_LABELS: Record<string, string> = {
  draft: 'Draft', calculating: 'Calculating…', calculated: 'Calculated', pending_hr_review: 'Pending HR Review',
  pending_finance_review: 'Pending Finance Review', approved: 'Approved', payslips_generated: 'Payslips Generated',
  released: 'Released', locked: 'Locked',
};

export default function PayrollBatchPage({ user, onLogout }: PayrollBatchPageProps) {
  const navigate = useNavigate();
  const token = localStorage.getItem('auth_token');
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [tab, setTab] = useState<'batches' | 'salary_advances' | 'loans' | 'reimbursements' | 'bonuses' | 'revisions' | 'settlements'>('batches');
  const [batches, setBatches] = useState<any[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<any>(null);
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [newYear, setNewYear] = useState(new Date().getFullYear());
  const [newMonth, setNewMonth] = useState(new Date().getMonth() + 1);

  const fetchBatches = useCallback(async () => {
    const res = await fetch('/api/tenant/payroll/batches', { headers: authHeaders });
    const d = await res.json();
    if (res.ok) setBatches(d.batches || []);
  }, []);

  useEffect(() => { fetchBatches(); }, [fetchBatches]);

  const fetchExceptions = async (batchId: number) => {
    const res = await fetch(`/api/tenant/payroll/batches/${batchId}/exceptions`, { headers: authHeaders });
    const d = await res.json();
    if (res.ok) setExceptions(d.exceptions || []);
  };

  const selectBatch = async (batch: any) => {
    setSelectedBatch(batch);
    await fetchExceptions(batch.id);
  };

  const createBatch = async () => {
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await fetch('/api/tenant/payroll/batches', { method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ year: newYear, month: newMonth }) });
      const d = await res.json();
      if (res.ok) {
        await fetchBatches();
        await selectBatch(d.batch);
        setSuccessMsg(`Payroll batch for ${newMonth}/${newYear} initialized successfully.`);
      } else {
        setErrorMsg(d.error || 'Failed to initialize payroll batch.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error creating payroll batch.');
    } finally { setLoading(false); }
  };

  const runAction = async (path: string, method: 'GET' | 'POST' = 'POST') => {
    if (!selectedBatch) return;
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await fetch(`/api/tenant/payroll/batches/${selectedBatch.id}/${path}`, { method, headers: authHeaders });
      const d = await res.json();
      if (res.ok) {
        await fetchBatches();
        if (d.batch) { setSelectedBatch(d.batch); await fetchExceptions(d.batch.id); }
        setSuccessMsg('Action completed successfully.');
      } else {
        setErrorMsg(d.error + (d.failures ? '\n\n' + d.failures.join('\n') : ''));
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Action execution failed.');
    } finally { setLoading(false); }
  };

  const blockingExceptions = exceptions.filter((e) => e.blocking);
  const currentStageIdx = selectedBatch ? STAGES.indexOf(selectedBatch.status) : -1;

  const nextActionForStatus: Record<string, { path: string; label: string; disabled?: boolean }> = {
    draft: { path: 'calculate', label: 'Calculate', disabled: false },
    calculating: { path: 'calculate', label: 'Retry Calculation', disabled: false },
    calculated: { path: 'submit-hr', label: 'Submit for HR Review', disabled: blockingExceptions.length > 0 },
    pending_hr_review: { path: 'submit-finance', label: 'Submit for Finance Review' },
    pending_finance_review: { path: 'approve', label: 'Approve Batch' },
    approved: { path: 'generate-payslips', label: 'Generate Payslips' },
    payslips_generated: { path: 'release', label: 'Release Payroll' },
    released: { path: 'lock', label: 'Lock Period' },
  };
  const nextAction = selectedBatch ? nextActionForStatus[selectedBatch.status] : null;

  return (
    <AdminWorkspaceLayout
      user={user}
      onLogout={onLogout}
      title="Payroll Run Batches & Lifecycle"
      subtitle="Batches, loans, reimbursements, bonuses, salary revisions and final settlements."
    >
      <div className="w-full p-3 sm:p-6 max-w-6xl mx-auto font-sans text-slate-800">
        <div className="mb-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate('/tenant/payroll')}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[var(--color-nexus-surface-alt)] hover:bg-[var(--color-nexus-border)] border border-[var(--color-nexus-border)] rounded-xl text-xs font-bold text-[var(--color-nexus-ink)] transition-colors cursor-pointer"
          >
            ← Back to Payroll
          </button>
        </div>
        {errorMsg && (
          <div className="p-4 mb-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button onClick={() => setErrorMsg('')} className="text-red-500 hover:text-red-800 font-bold ml-2">×</button>
          </div>
        )}

        {successMsg && (
          <div className="p-4 mb-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{successMsg}</span>
            </div>
            <button onClick={() => setSuccessMsg('')} className="text-emerald-500 hover:text-emerald-800 font-bold ml-2">×</button>
          </div>
        )}

        <div className="flex items-center gap-2 mb-6 pb-4 border-b border-slate-200">
          <span className="p-2 rounded-lg bg-indigo-50 text-indigo-600"><Banknote className="w-5 h-5" /></span>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Payroll Workspace</h1>
            <p className="text-sm text-slate-500">Batches, loans, reimbursements, bonuses, salary revisions and final settlements.</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          {([
            ['batches', 'Payroll Batches', Play],
            ['salary_advances', 'Salary Advances', Wallet],
            ['loans', 'Loans & Advances', Banknote],
            ['reimbursements', 'Reimbursements', Receipt],
            ['bonuses', 'Bonuses', Gift],
            ['revisions', 'Salary Revisions', TrendingUp],
            ['settlements', 'Final Settlements', Lock],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id as any)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border transition ${
                tab === id ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs' : 'bg-white border-slate-200 text-slate-700 hover:border-indigo-300'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>

        {tab === 'batches' ? (
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-600">New Batch:</span>
                <select value={newYear} onChange={(e) => setNewYear(Number(e.target.value))} className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-800">
                  {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
                <select value={newMonth} onChange={(e) => setNewMonth(Number(e.target.value))} className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-800">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleString('default', { month: 'short' })} ({m})</option>
                  ))}
                </select>
              </div>
              <button onClick={createBatch} disabled={loading} className="text-xs font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition">
                {loading ? 'Working…' : '+ Initialize Batch'}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs space-y-2 max-h-[500px] overflow-y-auto">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2 py-1">All Runs</div>
                {batches.length === 0 ? (
                  <div className="text-xs text-slate-400 p-4 text-center">No payroll batches yet.</div>
                ) : (
                  batches.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => selectBatch(b)}
                      className={`w-full text-left p-3 rounded-lg border transition ${
                        selectedBatch?.id === b.id ? 'bg-indigo-50 border-indigo-300 text-indigo-900 font-medium' : 'border-slate-100 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-bold">
                        <span>{new Date(b.year, b.month - 1, 1).toLocaleString('default', { month: 'long' })} {b.year}</span>
                        <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600">{STAGE_LABELS[b.status] || b.status}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">Total: ₹{Number(b.totalNet ?? b.totalMonthlyNet ?? 0).toLocaleString()} • {b.employeeCount ?? b.totalEmployees ?? 0} staff</div>
                    </button>
                  ))
                )}
              </div>

              <div className="md:col-span-2 space-y-4">
                {!selectedBatch ? (
                  <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-xs text-slate-400">Select a batch from the list to view lifecycle details, exceptions and stage actions.</div>
                ) : (
                  <>
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
                      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                        <div>
                          <h2 className="text-base font-bold text-slate-900">{new Date(selectedBatch.year, selectedBatch.month - 1, 1).toLocaleString('default', { month: 'long' })} {selectedBatch.year} Batch</h2>
                          <p className="text-xs text-slate-500 mt-0.5">Stage: <strong className="text-slate-800">{STAGE_LABELS[selectedBatch.status] || selectedBatch.status}</strong></p>
                        </div>
                        {nextAction && (
                          <button
                            onClick={() => runAction(nextAction.path)}
                            disabled={loading || nextAction.disabled}
                            className="text-xs font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition flex items-center gap-1.5"
                          >
                            {nextAction.label} <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-1 overflow-x-auto py-2">
                        {STAGES.map((s, idx) => {
                          const active = idx <= currentStageIdx;
                          const current = s === selectedBatch.status;
                          return (
                            <div key={s} className="flex items-center gap-1 shrink-0">
                              <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${current ? 'bg-indigo-600 text-white border-indigo-600' : active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
                                {STAGE_LABELS[s]}
                              </span>
                              {idx < STAGES.length - 1 && <span className="text-slate-300 text-xs">→</span>}
                            </div>
                          );
                        })}
                      </div>

                      <div className="grid grid-cols-3 gap-3 text-xs bg-slate-50 p-3 rounded-lg border border-slate-100">
                        <div><span className="text-[10px] text-slate-400 block uppercase font-mono">Gross</span><strong className="text-slate-800 text-sm">₹{Number(selectedBatch.totalGross ?? selectedBatch.totalMonthlyGross ?? 0).toLocaleString()}</strong></div>
                        <div><span className="text-[10px] text-slate-400 block uppercase font-mono">Net Payable</span><strong className="text-emerald-700 text-sm">₹{Number(selectedBatch.totalNet ?? selectedBatch.totalMonthlyNet ?? 0).toLocaleString()}</strong></div>
                        <div><span className="text-[10px] text-slate-400 block uppercase font-mono">Deductions</span><strong className="text-slate-800 text-sm">₹{Number((selectedBatch.totalGross ?? selectedBatch.totalMonthlyGross ?? 0) - (selectedBatch.totalNet ?? selectedBatch.totalMonthlyNet ?? 0)).toLocaleString()}</strong></div>
                      </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 text-amber-500" /> Validation Exceptions ({exceptions.length})
                      </h3>
                      {exceptions.length === 0 ? (
                        <div className="text-xs text-slate-400 p-4 text-center border border-dashed border-slate-200 rounded-lg">No validation issues detected for this batch.</div>
                      ) : (
                        <div className="space-y-2">
                          {exceptions.map((e, i) => {
                            const title = e.message || e.reason || (e.type ? `Exception (${e.type})` : 'Validation Issue');
                            const subtitle = e.userName && e.userName !== 'All employees'
                              ? `Employee: ${e.userName}`
                              : (e.details || (e.userId ? `User #${e.userId}` : ''));
                            return (
                              <div key={i} className={`p-3 rounded-lg border text-xs flex items-start justify-between gap-3 ${e.blocking ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
                                <div>
                                  <strong className="font-bold block">{title}</strong>
                                  {subtitle && <span className="text-[11px] opacity-80">{subtitle}</span>}
                                </div>
                                <span className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded ${e.blocking ? 'bg-rose-200 text-rose-900' : 'bg-amber-200 text-amber-900'}`}>
                                  {e.blocking ? 'Blocking' : 'Warning'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : tab === 'salary_advances' ? (
          <AdminSalaryAdvancesWorkspace user={user} />
        ) : (
          <SimpleEntityTab tab={tab} token={token} />
        )}
      </div>
    </AdminWorkspaceLayout>
  );
}

function SimpleEntityTab({ tab, token }: { tab: string; token: string | null }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const endpointFor: Record<string, { list: string; key: string }> = {
      loans: { list: '/api/tenant/payroll/loans', key: 'loans' },
      reimbursements: { list: '/api/tenant/payroll/reimbursements', key: 'reimbursements' },
      bonuses: { list: '/api/tenant/payroll/bonuses', key: 'bonuses' },
      revisions: { list: '/api/tenant/payroll/salary-revisions', key: 'revisions' },
      settlements: { list: '/api/tenant/payroll/settlements', key: 'settlements' },
    };
    const cfg = endpointFor[tab];
    if (!cfg) return;

    let active = true;
    setLoading(true);
    fetch(cfg.list, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json())
      .then((d) => {
        if (active) setItems(d[cfg.key] || []);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [tab, token]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wider">
        {tab} {loading && <span className="normal-case font-normal text-slate-400">— loading…</span>}
      </div>
      {items.length === 0 ? (
        <div className="p-10 text-center text-xs text-slate-500">No records yet. Use the API directly to create one.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 uppercase text-[10px]">
                {Object.keys(items[0] || {}).slice(0, 6).map((k) => <th key={k} className="p-2.5">{k}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item, i) => (
                <tr key={item.id ?? i}>
                  {Object.keys(items[0] || {}).slice(0, 6).map((k) => <td key={k} className="p-2.5 text-slate-700">{String(item[k] ?? '-')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
