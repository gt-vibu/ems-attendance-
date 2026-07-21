import { useEffect, useState } from 'react';

type Doc = { id: number; category: string; fileName: string; mimeType: string; fileSize: number; createdAt: string };

const CATEGORY_LABELS: Record<string, string> = {
  offer_letter: 'Offer Letter',
  contract: 'Contract',
  id_proof: 'ID Proof',
  certificate: 'Certificate',
  other: 'Other',
};

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Shared upload/list/download/delete UI for the document-storage feature —
// used both by an admin managing an employee's file (EmployeeDirectory) and
// an employee managing their own (EmployeeDashboard self-service). Entirely
// inert (renders nothing) when the tenant hasn't turned the feature on.
export default function DocumentsPanel({ userId, canUpload = true, canDelete = true }: { userId: number; canUpload?: boolean; canDelete?: boolean }) {
  const token = localStorage.getItem('auth_token');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [category, setCategory] = useState('other');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const res = await fetch(`/api/tenant/documents?userId=${userId}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      setEnabled(!!data.enabled);
      if (res.ok && Array.isArray(data.documents)) setDocs(data.documents);
    } catch {
      setEnabled(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const fileBase64 = await readFileAsBase64(file);
      const res = await fetch('/api/tenant/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId, category, fileName: file.name, mimeType: file.type || 'application/octet-stream', fileBase64 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed.');
      await load();
    } catch (err: any) {
      setError(err.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  // Authenticated download: the endpoint only accepts a Bearer header (never
  // a token in the URL — that would land in server logs and browser
  // history), so fetch the bytes ourselves and hand the browser a short-
  // lived blob: URL to save instead of a plain <a href>.
  const handleDownload = async (id: number, fileName: string) => {
    try {
      const res = await fetch(`/api/tenant/documents/${id}/download`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Download failed.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || 'Download failed.');
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this document? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/tenant/documents/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setDocs((prev) => prev.filter((d) => d.id !== id));
    } catch {
      // best-effort; list will self-correct on next load()
    }
  };

  if (enabled === null) return null;
  if (!enabled) return null;

  return (
    <div className="rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--color-nexus-muted)]">Documents</h4>
        {canUpload && (
          <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-primary)] cursor-pointer hover:underline">
            {uploading ? 'Uploading…' : '+ Upload'}
            <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
          </label>
        )}
      </div>
      {canUpload && (
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="mb-3 w-full text-xs bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg px-2.5 py-1.5 text-[var(--color-nexus-ink)]"
        >
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      )}
      {error && <p className="text-[11px] text-[var(--color-nexus-error)] mb-2">{error}</p>}
      {docs.length === 0 ? (
        <p className="text-[11px] text-[var(--color-nexus-muted)]">No documents uploaded yet.</p>
      ) : (
        <div className="space-y-1.5">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between text-xs bg-[var(--color-nexus-surface)] rounded-lg px-3 py-2">
              <div className="min-w-0">
                <button onClick={() => handleDownload(d.id, d.fileName)} className="font-semibold text-[var(--color-nexus-ink)] hover:underline truncate block max-w-[180px] text-left">{d.fileName}</button>
                <span className="text-[10px] text-[var(--color-nexus-muted)]">{CATEGORY_LABELS[d.category] || d.category} · {(d.fileSize / 1024).toFixed(0)}KB</span>
              </div>
              {canDelete && (
                <button onClick={() => handleDelete(d.id)} className="text-[var(--color-nexus-error)] text-[10px] font-bold uppercase tracking-wider shrink-0 ml-2">Delete</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
