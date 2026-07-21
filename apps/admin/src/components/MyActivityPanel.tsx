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
    <div className="nexus-card rounded-3xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-[var(--color-nexus-ink)] font-sans">My Activity</h2>
          <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">A read-only record of actions you took, and changes made to your record.</p>
        </div>
        <button onClick={handleDownloadData} className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-primary)] hover:underline">
          Download My Data
        </button>
      </div>
      {entries.length === 0 && <p className="text-xs text-[var(--color-nexus-muted)]">No activity recorded yet.</p>}
      <div className="space-y-2">
        {visible.map((e: any) => (
          <div key={e.id} className="flex items-center justify-between text-xs bg-[var(--color-nexus-surface-alt)] rounded-xl px-3.5 py-2.5">
            <span className="font-semibold text-[var(--color-nexus-ink)]">{String(e.action).replace(/_/g, ' ')}</span>
            <span className="text-[var(--color-nexus-muted)]">{new Date(e.timestamp).toLocaleString()}</span>
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
