import { useEffect, useState } from 'react';

type Colleague = { id: number; name: string; designation?: string };

// Self-contained "propose a shift swap with a colleague" widget — lists the
// caller's own in-flight requests (either side: requester or target) and
// lets them respond to ones a colleague sent them. The eventual manager
// approval step lives in the admin dashboard, not here.
export default function ShiftSwapWidget({ colleagues }: { colleagues: Colleague[] }) {
  const token = localStorage.getItem('auth_token');
  const [requests, setRequests] = useState<any[]>([]);
  const [targetUserId, setTargetUserId] = useState('');
  const [swapDate, setSwapDate] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  const load = async () => {
    try {
      const res = await fetch('/api/tenant/shift-swap/mine', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.requests)) setRequests(data.requests);
    } catch {
      // best-effort widget — stays empty on failure rather than erroring the page
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePropose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUserId || !swapDate) return;
    setSubmitting(true);
    setMessage('');
    try {
      const res = await fetch('/api/tenant/shift-swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetUserId: Number(targetUserId), swapDate, reason: reason.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to submit request.');
      setSwapDate('');
      setReason('');
      await load();
    } catch (err: any) {
      setMessage(err.message || 'Failed to submit request.');
    } finally {
      setSubmitting(false);
    }
  };

  const respond = async (id: number, action: 'accept' | 'decline') => {
    try {
      const res = await fetch(`/api/tenant/shift-swap/${id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action }),
      });
      if (res.ok) await load();
    } catch {
      // best-effort; list will self-correct on next load()
    }
  };

  const statusLabel: Record<string, string> = {
    pending_target: 'Awaiting colleague',
    pending_approval: 'Awaiting manager approval',
    approved: 'Approved',
    rejected: 'Rejected by manager',
    declined: 'Declined',
  };

  if (colleagues.length === 0 && requests.length === 0) return null;

  return (
    <div className="nexus-card rounded-3xl p-6">
      <h2 className="text-base font-bold text-[var(--color-nexus-ink)] font-sans mb-1">Shift Swap</h2>
      <p className="text-xs text-[var(--color-nexus-muted)] mb-4">Propose trading your shift with a colleague on a specific date — needs their acceptance, then manager approval.</p>

      {colleagues.length > 0 && (
        <form onSubmit={handlePropose} className="grid sm:grid-cols-4 gap-3 items-end mb-5">
          <div className="sm:col-span-2">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-1">Colleague</label>
            <select value={targetUserId} onChange={(e) => setTargetUserId(e.target.value)} className="w-full rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-3 py-2.5 text-sm focus:outline-none" required>
              <option value="">Select…</option>
              {colleagues.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-muted)] mb-1">Date</label>
            <input type="date" value={swapDate} onChange={(e) => setSwapDate(e.target.value)} className="w-full rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] px-3 py-2.5 text-sm focus:outline-none" required />
          </div>
          <button type="submit" disabled={submitting} className="rounded-xl bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white text-xs font-bold uppercase tracking-wider py-2.5 disabled:opacity-50">
            {submitting ? 'Sending…' : 'Propose'}
          </button>
        </form>
      )}
      {message && <p className="text-xs text-[var(--color-nexus-error)] mb-3">{message}</p>}

      {requests.length > 0 && (
        <div className="space-y-2">
          {requests.map((r) => (
            <div key={r.id} className="flex items-center justify-between p-3 bg-[var(--color-nexus-surface-alt)] rounded-xl border border-[var(--color-nexus-border)] text-xs">
              <div>
                <span className="font-semibold text-[var(--color-nexus-ink)]">{r.isRequester ? `You ↔ ${r.targetName}` : `${r.requesterName} ↔ You`}</span>
                <span className="block text-[var(--color-nexus-muted)] mt-0.5">{r.swapDate} · {statusLabel[r.status] || r.status}</span>
              </div>
              {!r.isRequester && r.status === 'pending_target' ? (
                <div className="flex gap-2">
                  <button onClick={() => respond(r.id, 'accept')} className="text-[var(--color-nexus-success-text)] font-bold uppercase tracking-wider">Accept</button>
                  <button onClick={() => respond(r.id, 'decline')} className="text-[var(--color-nexus-error)] font-bold uppercase tracking-wider">Decline</button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
