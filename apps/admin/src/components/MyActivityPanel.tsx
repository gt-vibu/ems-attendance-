import { useEffect, useState } from 'react';

// Self-service slice of the audit ledger — every prior audit view in this
// app required 'reports.view' (manager/admin-only); this is the same data
// source scoped to just what the caller personally did or was the subject
// of, with no privilege required.
export default function MyActivityPanel() {
  const token = localStorage.getItem('auth_token');
  const [entries, setEntries] = useState<any[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/audit/mine', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.ledger)) setEntries(d.ledger); })
      .catch(() => {})
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDownloadData = async () => {
    const res = await fetch('/api/employees/me/data-export', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-data-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (!loaded) return null;

  const visible = expanded ? entries : entries.slice(0, 5);

  return (
    <div className="nexus-card rounded-xl p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h2 className="text-sm sm:text-base font-bold text-[var(--color-nexus-ink)] font-sans">My Activity Log</h2>
          <p className="text-[11px] text-[var(--color-nexus-muted)] mt-0.5">Chronological record of actions performed on your account.</p>
        </div>
        <button onClick={handleDownloadData} className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-primary)] hover:underline">
          Download My Data
        </button>
      </div>
      {entries.length === 0 && <p className="text-xs text-[var(--color-nexus-muted)]">No activity recorded yet.</p>}
      
      {/* Chronological Activity Timeline Feed */}
      <div className="relative pl-4 space-y-3 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-[var(--color-nexus-border)]">
        {visible.map((e: any) => (
          <div key={e.id} className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between text-xs bg-[var(--color-nexus-surface-alt)] rounded-lg p-2.5 gap-1 border border-[var(--color-nexus-border)]/50">
            <span className="absolute -left-4 top-3.5 w-2 h-2 rounded-full bg-[var(--color-nexus-primary)] ring-4 ring-[var(--color-nexus-surface)]" />
            <span className="font-semibold text-[var(--color-nexus-ink)] capitalize">{String(e.action).replace(/_/g, ' ')}</span>
            <span className="text-[10px] font-mono text-[var(--color-nexus-muted)]">{new Date(e.timestamp).toLocaleString()}</span>
          </div>
        ))}
      </div>
      {entries.length > 5 && (
        <button onClick={() => setExpanded((v) => !v)} className="mt-3 text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-primary)]">
          {expanded ? 'Show less' : `Show all ${entries.length}`}
        </button>
      )}
    </div>
  );
}
