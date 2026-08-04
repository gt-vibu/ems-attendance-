import { useEffect, useState } from 'react';
import { User } from '../lib/auth';
import AdminWorkspaceLayout from '../components/AdminWorkspaceLayout';
import { useTerminationRequests } from './dashboard/hooks/useApprovalQueues';

export default function TerminationsPage({ user, onLogout }: { user: User; onLogout?: () => void }) {
  const token = localStorage.getItem('auth_token');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const {
    terminationRequests,
    fetchTerminationRequests,
    handleResolveTermination,
  } = useTerminationRequests(token, { setLoading, setError, setSuccess });

  useEffect(() => {
    fetchTerminationRequests();
  }, [token]);

  return (
    <AdminWorkspaceLayout
      user={user}
      onLogout={onLogout}
      title="Termination Requests"
      subtitle="Review and manage pending employee termination approvals."
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
          <h2 className="text-lg font-bold text-[var(--color-nexus-ink)] mb-1 font-sans">Pending Termination Requests</h2>
          <p className="text-xs text-[var(--color-nexus-muted)] mb-6">
            Submitted by authorized managers. Approving immediately revokes employee access; rejecting leaves them active.
          </p>

          {terminationRequests.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-[var(--color-nexus-border)] rounded-xl text-xs text-[var(--color-nexus-muted)]">
              No pending termination requests found.
            </div>
          ) : (
            <div className="space-y-3">
              {terminationRequests.map((r: any) => (
                <div key={r.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-[var(--color-nexus-surface-alt)] rounded-xl border border-[var(--color-nexus-border)] gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-bold text-[var(--color-nexus-ink)]">{r.employeeName}</span>
                      <span className="text-[10px] text-[var(--color-nexus-muted)] uppercase font-bold">requested by {r.requestedByName}</span>
                    </div>
                    <p className="text-xs text-[var(--color-nexus-muted)]">{r.reason || 'No reason provided'}</p>
                    <p className="text-[10px] text-[var(--color-nexus-muted)] mt-1">Submitted {new Date(r.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleResolveTermination(r.id, 'approve')}
                      disabled={loading}
                      className="bg-[var(--color-nexus-error)] hover:brightness-110 text-white text-xs font-bold uppercase tracking-wider py-2 px-4 rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleResolveTermination(r.id, 'reject')}
                      disabled={loading}
                      className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] hover:bg-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] text-xs font-bold uppercase tracking-wider py-2 px-4 rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
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
