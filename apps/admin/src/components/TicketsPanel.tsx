import { useEffect, useState } from 'react';
import { Ticket, Plus, X, ArrowUpCircle, CheckCircle2, XCircle } from 'lucide-react';
import type { User } from '../lib/auth';

interface TicketRow {
  id: number;
  category: string;
  priority: string;
  subject: string;
  description: string;
  status: string;
  escalationLevel: number;
  relatedDate: string | null;
  relatedLeaveRequestId: number | null;
  raisedByName?: string;
  currentAssigneeName?: string | null;
  resolutionNote?: string | null;
  createdAt: string;
}

const CATEGORIES = [
  { value: 'attendance_dispute', label: 'Attendance Dispute (e.g. wrongly marked absent)' },
  { value: 'leave_dispute', label: 'Leave Dispute' },
  { value: 'payroll_dispute', label: 'Payroll Dispute' },
  { value: 'other', label: 'Other' },
];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

const priorityColor: Record<string, string> = {
  low: 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)]',
  medium: 'bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)]',
  high: 'bg-[color:var(--color-nexus-secondary)]/15 text-[var(--color-nexus-secondary)]',
  urgent: 'bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)]',
};

// Self-service ticket raising + resolution queue, in one component so it
// can be embedded identically in EmployeeDashboard.tsx (covers employee/
// manager/HR/GM — everyone who clocks in) and the tenant_admin's own
// Dashboard.tsx (who never clocks in, but is the final escalation
// backstop). "My Tickets" always shows; "Assigned to Me" only renders when
// non-empty, since most viewers will never have anything routed to them.
export default function TicketsPanel({ user }: { user: User }) {
  const token = localStorage.getItem('auth_token');
  const [myTickets, setMyTickets] = useState<TicketRow[]>([]);
  const [assignedTickets, setAssignedTickets] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [showRaise, setShowRaise] = useState(false);
  const [category, setCategory] = useState('attendance_dispute');
  const [priority, setPriority] = useState('medium');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [relatedDate, setRelatedDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [applyCorrection, setApplyCorrection] = useState(false);
  const [correctedStatus, setCorrectedStatus] = useState<'present' | 'absent'>('present');
  const [checkInTime, setCheckInTime] = useState('09:00');
  const [checkOutTime, setCheckOutTime] = useState('18:00');
  const [actionBusy, setActionBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const [mineRes, assignedRes] = await Promise.all([
        fetch('/api/tickets/mine', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/tenant/tickets', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const mineData = await mineRes.json().catch(() => ({}));
      const assignedData = await assignedRes.json().catch(() => ({}));
      if (Array.isArray(mineData.tickets)) setMyTickets(mineData.tickets);
      if (Array.isArray(assignedData.tickets)) setAssignedTickets(assignedData.tickets);
    } catch (err: any) {
      setError('Could not load tickets.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRaise = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !description.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          category, priority, subject: subject.trim(), description: description.trim(),
          relatedDate: category === 'attendance_dispute' && relatedDate ? relatedDate : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to raise ticket.');
      setSuccess('Ticket raised — routed to your manager.');
      setShowRaise(false);
      setSubject(''); setDescription(''); setRelatedDate(''); setPriority('medium'); setCategory('attendance_dispute');
      refresh();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to raise ticket.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAction = async (ticket: TicketRow, action: 'resolve' | 'reject' | 'escalate') => {
    setActionBusy(true);
    setError('');
    try {
      const body: any = { action, resolutionNote: resolutionNote || undefined };
      if (action === 'resolve' && applyCorrection && ticket.category === 'attendance_dispute' && ticket.relatedDate) {
        body.attendanceEdit = { newStatus: correctedStatus, checkInTime: correctedStatus === 'present' ? checkInTime : undefined, checkOutTime: correctedStatus === 'present' ? checkOutTime : undefined };
      }
      const res = await fetch(`/api/tenant/tickets/${ticket.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Action failed.');
      setSuccess(action === 'escalate' ? 'Ticket escalated.' : `Ticket ${action}d.`);
      setResolvingId(null);
      setResolutionNote(''); setApplyCorrection(false);
      refresh();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Action failed.');
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) return null;

  return (
    <div className="nexus-card rounded-3xl p-6">
      {error && <div className="mb-4 text-xs font-semibold text-[var(--color-nexus-error)] bg-[var(--color-nexus-error-soft)] rounded-xl px-4 py-2.5">{error}</div>}
      {success && <div className="mb-4 text-xs font-semibold text-[var(--color-nexus-success-text)] bg-[color:var(--color-nexus-success-text)]/10 rounded-xl px-4 py-2.5">{success}</div>}

      {assignedTickets.length > 0 && (
        <div className="mb-8">
          <h2 className="text-base font-bold text-[var(--color-nexus-ink)] font-sans mb-1">Tickets Assigned to Me</h2>
          <p className="text-xs text-[var(--color-nexus-muted)] mb-4">Routed to you via the escalation chain. Unactioned tickets auto-forward after 24 hours.</p>
          <div className="space-y-3">
            {assignedTickets.filter((t) => t.status === 'open').map((t) => (
              <div key={t.id} className="rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${priorityColor[t.priority]}`}>{t.priority}</span>
                      <span className="text-[10px] text-[var(--color-nexus-muted)] uppercase tracking-wider">{t.category.replace('_', ' ')}</span>
                    </div>
                    <p className="text-sm font-bold text-[var(--color-nexus-ink)]">{t.subject}</p>
                    <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">From {t.raisedByName} · {new Date(t.createdAt).toLocaleString()}</p>
                    <p className="text-xs text-[var(--color-nexus-ink)] mt-2">{t.description}</p>
                    {t.relatedDate && <p className="text-[10px] text-[var(--color-nexus-muted)] mt-1">Related date: {t.relatedDate}</p>}
                  </div>
                  {resolvingId !== t.id && (
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => setResolvingId(t.id)} className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg bg-[var(--color-nexus-success-text)] text-white">Resolve</button>
                      <button onClick={() => handleAction(t, 'reject')} disabled={actionBusy} className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg bg-[var(--color-nexus-error)] text-white disabled:opacity-50">Reject</button>
                      <button onClick={() => handleAction(t, 'escalate')} disabled={actionBusy} className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] disabled:opacity-50">Escalate</button>
                    </div>
                  )}
                </div>

                {resolvingId === t.id && (
                  <div className="mt-4 pt-4 border-t border-[var(--color-nexus-border)] space-y-3">
                    <textarea
                      value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)}
                      placeholder="Resolution note..." rows={2}
                      className="w-full px-3 py-2 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-xs focus:outline-none"
                    />
                    {t.category === 'attendance_dispute' && t.relatedDate && (
                      <label className="flex items-center gap-2 text-xs text-[var(--color-nexus-ink)] cursor-pointer">
                        <input type="checkbox" checked={applyCorrection} onChange={(e) => setApplyCorrection(e.target.checked)} className="accent-[var(--color-nexus-primary)]" />
                        Correct the attendance record for {t.relatedDate}
                      </label>
                    )}
                    {applyCorrection && t.category === 'attendance_dispute' && (
                      <div className="flex flex-wrap items-center gap-2 pl-6">
                        <select value={correctedStatus} onChange={(e) => setCorrectedStatus(e.target.value as any)} className="px-2 py-1.5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg text-xs">
                          <option value="present">Mark Present</option>
                          <option value="absent">Mark Absent</option>
                        </select>
                        {correctedStatus === 'present' && (
                          <>
                            <input type="time" value={checkInTime} onChange={(e) => setCheckInTime(e.target.value)} className="px-2 py-1.5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg text-xs" />
                            <span className="text-[10px] text-[var(--color-nexus-muted)]">to</span>
                            <input type="time" value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} className="px-2 py-1.5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg text-xs" />
                          </>
                        )}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button onClick={() => handleAction(t, 'resolve')} disabled={actionBusy} className="text-[10px] font-bold uppercase tracking-wider px-4 py-2 rounded-lg bg-[var(--color-nexus-success-text)] text-white disabled:opacity-50">Confirm Resolve</button>
                      <button onClick={() => { setResolvingId(null); setApplyCorrection(false); setResolutionNote(''); }} className="text-[10px] font-bold uppercase tracking-wider px-4 py-2 rounded-lg bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] text-[var(--color-nexus-ink)]">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-bold text-[var(--color-nexus-ink)] font-sans">My Tickets</h2>
        <button onClick={() => setShowRaise((v) => !v)} className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] px-3.5 py-2 rounded-xl transition-colors">
          {showRaise ? <X size={13} /> : <Plus size={13} />} {showRaise ? 'Cancel' : 'Raise a Ticket'}
        </button>
      </div>
      <p className="text-xs text-[var(--color-nexus-muted)] mb-4">Raise a dispute or request — e.g. "I was marked absent but I was present." Routed to your manager first, then GM, then the tenant admin if nobody is available.</p>

      {showRaise && (
        <form onSubmit={handleRaise} className="mb-6 p-4 rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase tracking-wider mb-1">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full px-3 py-2.5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-xs focus:outline-none">
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase tracking-wider mb-1">Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full px-3 py-2.5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-xs focus:outline-none">
                {PRIORITIES.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
          </div>
          {category === 'attendance_dispute' && (
            <div>
              <label className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase tracking-wider mb-1">Date in question</label>
              <input type="date" value={relatedDate} onChange={(e) => setRelatedDate(e.target.value)} className="w-full px-3 py-2.5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-xs focus:outline-none" />
            </div>
          )}
          <div>
            <label className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase tracking-wider mb-1">Subject</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} required className="w-full px-3 py-2.5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-xs focus:outline-none" placeholder="e.g. Marked absent on a day I was present" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase tracking-wider mb-1">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} required rows={3} className="w-full px-3 py-2.5 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl text-xs focus:outline-none" placeholder="Explain what happened..." />
          </div>
          <button type="submit" disabled={submitting} className="text-[10px] font-bold uppercase tracking-wider text-white bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] px-4 py-2.5 rounded-xl disabled:opacity-50">
            {submitting ? 'Submitting...' : 'Submit Ticket'}
          </button>
        </form>
      )}

      {myTickets.length === 0 ? (
        <p className="text-xs text-[var(--color-nexus-muted)] text-center py-8">No tickets raised yet.</p>
      ) : (
        <div className="space-y-2">
          {myTickets.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 bg-[var(--color-nexus-surface-alt)] rounded-xl px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${priorityColor[t.priority]}`}>{t.priority}</span>
                  <p className="text-xs font-bold text-[var(--color-nexus-ink)] truncate">{t.subject}</p>
                </div>
                {t.resolutionNote && <p className="text-[10px] text-[var(--color-nexus-muted)] mt-1">{t.resolutionNote}</p>}
              </div>
              <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full flex items-center gap-1 ${
                t.status === 'resolved' ? 'bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)]'
                : t.status === 'rejected' ? 'bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)]'
                : 'bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)]'
              }`}>
                {t.status === 'resolved' && <CheckCircle2 size={11} />}
                {t.status === 'rejected' && <XCircle size={11} />}
                {t.status === 'open' && <ArrowUpCircle size={11} />}
                {t.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
