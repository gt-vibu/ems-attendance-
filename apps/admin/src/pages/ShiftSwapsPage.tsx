import { useEffect, useState } from 'react';
import { User } from '../lib/auth';
import AdminWorkspaceLayout from '../components/AdminWorkspaceLayout';
import { useShiftSwapRequests } from './dashboard/hooks/useApprovalQueues';

export default function ShiftSwapsPage({ user, onLogout }: { user: User; onLogout?: () => void }) {
  const token = localStorage.getItem('auth_token');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const {
    shiftSwapRequests,
    fetchShiftSwapRequests,
    handleResolveShiftSwap,
  } = useShiftSwapRequests(token, { setLoading, setError, setSuccess });

  useEffect(() => {
    fetchShiftSwapRequests();
  }, [token]);

  return (
    <AdminWorkspaceLayout
      user={user}
      onLogout={onLogout}
      title="Shift Swap Requests"
      subtitle="Review and sign off on peer-to-peer shift swap proposals."
    >
      <div className="space-y-6">
        {error && (
          <div className="p-4 bg-[var(--color-nexus-error-soft)] border border-[var(--color-nexus-error)] text-[var(--color-nexus-error)] text-xs rounded-xl font-bold">
            {error}
          </div>
        )}
        {success && (
          <div className="p-4 bg-[var(--color-nexus-success-soft)] border border-[var(--color-nexus-success)] text-[var(--color-nexus-success-text)] text-xs rounded-xl font-bold">
            {success}
          </div>
        )}

        <div className="p-6 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl">
          <h2 className="text-lg font-bold text-[var(--color-nexus-ink)] mb-1 font-sans">Pending Shift Swaps</h2>
          <p className="text-xs text-[var(--color-nexus-muted)] mb-6">
            Both employees have already agreed to this swap — this step provides final policy sign-off.
          </p>

          {shiftSwapRequests.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-[var(--color-nexus-border)] rounded-xl text-xs text-[var(--color-nexus-muted)]">
              No pending shift swap requests found.
            </div>
          ) : (
            <div className="space-y-3">
              {shiftSwapRequests.map((r: any) => (
                <div key={r.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-[var(--color-nexus-surface-alt)] rounded-xl border border-[var(--color-nexus-border)] gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-bold text-[var(--color-nexus-ink)]">
                        {r.requesterName} ({r.requesterShiftName || 'No shift'}) ↔ {r.targetName} ({r.targetShiftName || 'No shift'})
                      </span>
                    </div>
                    <p className="text-xs text-[var(--color-nexus-muted)]">
                      Swap Date: <span className="font-semibold text-[var(--color-nexus-ink)]">{r.swapDate}</span>{r.reason ? ` — ${r.reason}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleResolveShiftSwap(r.id, 'approve')}
                      disabled={loading}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase tracking-wider py-2 px-4 rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleResolveShiftSwap(r.id, 'reject')}
                      disabled={loading}
                      className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold uppercase tracking-wider py-2 px-4 rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminWorkspaceLayout>
  );
}
