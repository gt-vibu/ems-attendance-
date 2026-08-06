import React, { useState, useEffect, useCallback } from 'react';
import { User } from '../lib/auth';
import { AlertTriangle, CheckCircle2, Clock, Play, ArrowRight, Lock, Banknote, Receipt, Gift, TrendingUp } from 'lucide-react';

interface PayrollBatchPageProps {
  user: User;
}

const STAGES = ['draft', 'calculating', 'calculated', 'pending_hr_review', 'pending_finance_review', 'approved', 'payslips_generated', 'released', 'locked'];
const STAGE_LABELS: Record<string, string> = {
  draft: 'Draft', calculating: 'Calculating…', calculated: 'Calculated', pending_hr_review: 'Pending HR Review',
  pending_finance_review: 'Pending Finance Review', approved: 'Approved', payslips_generated: 'Payslips Generated',
  released: 'Released', locked: 'Locked',
};

// One page covering the full Payroll Batch lifecycle (P1-P2) plus simple
// management tabs for the one-off financial events (P3/P4) — deliberately
// a single page rather than several, matching the master prompt's "keep
// the UI simple, don't overwhelm HR" instruction. Every action here calls
// the routes built in payroll.routes.ts / payrollExtras.routes.ts; no
// client-side calculation happens here.
export default function PayrollBatchPage({ user }: PayrollBatchPageProps) {
  const token = localStorage.getItem('auth_token');
  const authHeaders = { Authorization: `Bearer ${token}` };

  const [tab, setTab] = useState<'batches' | 'loans' | 'reimbursements' | 'bonuses' | 'revisions' | 'settlements'>('batches');
  const [batches, setBatches] = useState<any[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<any>(null);
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
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
    try {
      const res = await fetch('/api/tenant/payroll/batches', { method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ year: newYear, month: newMonth }) });
      const d = await res.json();
      if (res.ok) { await fetchBatches(); await selectBatch(d.batch); } else { alert(d.error); }
    } finally { setLoading(false); }
  };

  const runAction = async (path: string, method: 'GET' | 'POST' = 'POST') => {
    if (!selectedBatch) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tenant/payroll/batches/${selectedBatch.id}/${path}`, { method, headers: authHeaders });
      const d = await res.json();
      if (res.ok) {
        await fetchBatches();
        if (d.batch) { setSelectedBatch(d.batch); await fetchExceptions(d.batch.id); }
      } else {
        alert(d.error + (d.failures ? '\n\n' + d.failures.join('\n') : ''));
      }
    } finally { setLoading(false); }
  };

  const blockingExceptions = exceptions.filter((e) => e.blocking);
  const currentStageIdx = selectedBatch ? STAGES.indexOf(selectedBatch.status) : -1;

  const nextActionForStatus: Record<string, { path: string; label: string; disabled?: boolean }> = {
    draft: { path: 'calculate', label: 'Calculate', disabled: false },
    // A batch can get stuck here if a previous calculation job failed
    // permanently (queue retries exhausted) before reaching the step that
    // moves it to 'calculated' — recalculating is safe to re-run (it
    // recomputes fresh each time, never appends to a partial result), so
    // this is a real recovery path, not just a cosmetic label.
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
    <div className="w-full p-3 sm:p-6 max-w-6xl mx-auto font-sans text-slate-800">
      <div className="flex items-center gap-2 mb-6 pb-4 border-b border-slate-200">
        <span className="p-2 rounded-lg bg-indigo-50 text-indigo-600"><Banknote className="w-5 h-5" /></span>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Payroll</h1>
          <p className="text-sm text-slate-500">Batches, loans, reimbursements, bonuses, salary revisions and final settlements.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {([
          ['batches', 'Payroll Batches', Play],
          ['loans', 'Loans & Advances', Banknote],
          ['reimbursements', 'Reimbursements', Receipt],
          ['bonuses', 'Bonuses', Gift],
          ['revisions', 'Salary Revisions', TrendingUp],
          ['settlements', 'Final Settlements', Lock],
        ] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border transition ${tab === id ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-700'}`}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === 'batches' && (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          <div className="space-y-3">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">New Batch</div>
              <div className="flex gap-2 mb-2">
                <input type="number" value={newYear} onChange={(e) => setNewYear(Number(e.target.value))} className="w-20 text-xs border border-slate-200 rounded-lg px-2 py-1.5" />
                <select value={newMonth} onChange={(e) => setNewMonth(Number(e.target.value))} className="flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{new Date(2000, m - 1).toLocaleString('default', { month: 'long' })}</option>)}
                </select>
              </div>
              <button onClick={createBatch} disabled={loading} className="w-full text-xs font-semibold px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">Create Batch</button>
            </div>
            <div className="space-y-1.5">
              {batches.map((b) => (
                <button key={b.id} onClick={() => selectBatch(b)} className={`w-full text-left p-3 rounded-lg border text-xs ${selectedBatch?.id === b.id ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
                  <div className="font-semibold">{new Date(2000, b.month - 1).toLocaleString('default', { month: 'long' })} {b.year}</div>
                  <div className="text-slate-500">{STAGE_LABELS[b.status] || b.status}</div>
                </button>
              ))}
              {batches.length === 0 && <p className="text-xs text-slate-400 p-3">No payroll batches yet. Requires the "Payroll Batches" platform feature to be enabled for your organization.</p>}
            </div>
          </div>

          <div>
            {!selectedBatch ? (
              <div className="bg-white border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500">Select or create a batch.</div>
            ) : (
              <div className="space-y-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-bold text-slate-900">{new Date(2000, selectedBatch.month - 1).toLocaleString('default', { month: 'long' })} {selectedBatch.year}</h2>
                    <span className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-slate-100 text-slate-600">{STAGE_LABELS[selectedBatch.status]}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-4">
                    {STAGES.map((s, i) => (
                      <React.Fragment key={s}>
                        <span className={`text-[10px] px-2 py-1 rounded-full ${i <= currentStageIdx ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>{STAGE_LABELS[s]}</span>
                        {i < STAGES.length - 1 && <ArrowRight className="w-3 h-3 text-slate-300 self-center" />}
                      </React.Fragment>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-xs mb-4">
                    <div><div className="text-slate-400 uppercase text-[10px]">Employees</div><div className="font-bold text-slate-900">{selectedBatch.employeeCount || 0}</div></div>
                    <div><div className="text-slate-400 uppercase text-[10px]">Total Gross</div><div className="font-bold text-slate-900">${Math.round(selectedBatch.totalGross || 0).toLocaleString()}</div></div>
                    <div><div className="text-slate-400 uppercase text-[10px]">Total Net</div><div className="font-bold text-slate-900">${Math.round(selectedBatch.totalNet || 0).toLocaleString()}</div></div>
                  </div>
                  {nextAction && (
                    <button onClick={() => runAction(nextAction.path)} disabled={loading || nextAction.disabled} className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                      <Play className="w-3.5 h-3.5" /> {nextAction.label}
                    </button>
                  )}
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Exception Center</div>
                  {exceptions.length === 0 ? (
                    <p className="text-xs text-slate-400 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> No exceptions found.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {exceptions.map((e, i) => (
                        <div key={i} className={`flex items-center gap-2 text-xs p-2 rounded-lg ${e.blocking ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
                          {e.blocking ? <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> : <Clock className="w-3.5 h-3.5 shrink-0" />}
                          {e.message}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab !== 'batches' && (
        <SimpleEntityTab tab={tab} authHeaders={authHeaders} />
      )}
    </div>
  );
}

// Loans/Advances/Reimbursements/Bonuses/Revisions/Settlements share the
// same "list + create" shape — one small component instead of five nearly
// identical ones.
function SimpleEntityTab({ tab, authHeaders }: { tab: string; authHeaders: Record<string, string> }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const endpointFor: Record<string, { list: string; key: string }> = {
    loans: { list: '/api/tenant/payroll/loans', key: 'loans' },
    reimbursements: { list: '/api/tenant/payroll/reimbursements', key: 'reimbursements' },
    bonuses: { list: '/api/tenant/payroll/bonuses', key: 'bonuses' },
    revisions: { list: '/api/tenant/payroll/salary-revisions', key: 'revisions' },
    settlements: { list: '/api/tenant/payroll/settlements', key: 'settlements' },
  };
  const cfg = endpointFor[tab];

  const fetchItems = useCallback(async () => {
    if (!cfg) return;
    setLoading(true);
    try {
      const res = await fetch(cfg.list, { headers: authHeaders });
      const d = await res.json();
      if (res.ok) setItems(d[cfg.key] || []);
    } finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wider">
        {tab} {loading && <span className="normal-case font-normal text-slate-400">— loading…</span>}
      </div>
      {items.length === 0 ? (
        <div className="p-10 text-center text-xs text-slate-500">No records yet. Use the API directly to create one (a dedicated create form for this tab is a follow-up — the backend workflow, approvals, and payroll-calculation wiring are already live).</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 uppercase text-[10px]">
                {Object.keys(items[0]).slice(0, 6).map((k) => <th key={k} className="p-2.5">{k}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item, i) => (
                <tr key={item.id ?? i}>
                  {Object.keys(items[0]).slice(0, 6).map((k) => <td key={k} className="p-2.5 text-slate-700">{String(item[k] ?? '-')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
