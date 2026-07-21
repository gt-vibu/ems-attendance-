import { useState } from 'react';
import { Upload, Download, ChevronDown, ChevronUp, CheckCircle2, XCircle } from 'lucide-react';
import { downloadCsv, parseCsv } from '../lib/csv';

interface BulkHireRow {
  name: string;
  email: string;
  role: string;
  branchId: string;
  shiftId: string;
  department: string;
}

interface RowResult {
  row: number;
  email: string;
  success: boolean;
  error?: string;
}

// Bulk-hire via CSV upload — the counterpart to the single "Recruit Team
// Member" form above it. Deliberately its own component (not folded into
// Dashboard.tsx, already one of the largest files in the app) so the
// upload/preview/submit state stays self-contained. branchId/shiftId are
// numeric IDs, not names — the "Download Template" button below embeds the
// tenant's actual branch IDs so this isn't a guessing game, and Branches
// lists each branch's shift IDs for the same reason.
export default function BulkHireImport({ hireBranches, onDone }: { hireBranches: any[]; onDone: () => void }) {
  const token = localStorage.getItem('auth_token');
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<BulkHireRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [error, setError] = useState('');

  const downloadTemplate = () => {
    const header = ['name', 'email', 'role', 'branchId', 'shiftId', 'department'];
    const exampleBranch = hireBranches[0];
    const example = exampleBranch
      ? ['Jane Doe', 'jane.doe@example.com', 'employee', String(exampleBranch.id), '', 'Operations']
      : ['Jane Doe', 'jane.doe@example.com', 'employee', '', '', 'Operations'];
    const branchReference = hireBranches.map((b) => [`# Branch: ${b.name}`, `id=${b.id}`]);
    downloadCsv('bulk-hire-template.csv', [header, example, [], ['# Available branches (delete these rows before uploading):'], ...branchReference]);
  };

  const handleFile = async (file: File) => {
    setError('');
    setResults(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const parsed = parseCsv(text).filter((r) => r.name || r.email);
      if (parsed.length === 0) throw new Error('No data rows found in this file.');
      if (parsed.length > 200) throw new Error(`This file has ${parsed.length} rows — a single batch is limited to 200.`);
      setRows(parsed.map((r) => ({
        name: r.name || '', email: r.email || '', role: r.role || '',
        branchId: r.branchId || '', shiftId: r.shiftId || '', department: r.department || '',
      })));
    } catch (err: any) {
      setError(err.message || 'Could not read this file.');
      setRows([]);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    setResults(null);
    try {
      const res = await fetch('/api/tenant/users/bulk-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Bulk import failed.');
      setResults(data.results || []);
      if ((data.created || 0) > 0) onDone();
    } catch (err: any) {
      setError(err.message || 'Bulk import failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="nexus-card rounded-3xl p-6">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between">
        <div className="text-left">
          <h2 className="text-base font-bold text-[var(--color-nexus-ink)] font-sans">Bulk Import (CSV)</h2>
          <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">Hire up to 200 people at once from a spreadsheet.</p>
        </div>
        {open ? <ChevronUp size={18} className="text-[var(--color-nexus-muted)]" /> : <ChevronDown size={18} className="text-[var(--color-nexus-muted)]" />}
      </button>

      {open && (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={downloadTemplate} className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-3.5 py-2 rounded-xl bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] text-[var(--color-nexus-ink)]">
              <Download size={13} /> Download Template
            </button>
            <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-3.5 py-2 rounded-xl bg-[var(--color-nexus-primary)] text-white cursor-pointer">
              <Upload size={13} /> Upload CSV
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            </label>
            {fileName && <span className="text-xs text-[var(--color-nexus-muted)] self-center">{fileName} — {rows.length} row(s)</span>}
          </div>

          {error && <div className="text-xs font-semibold text-[var(--color-nexus-error)] bg-[var(--color-nexus-error-soft)] rounded-xl px-4 py-2.5">{error}</div>}

          {rows.length > 0 && !results && (
            <>
              <div className="overflow-x-auto rounded-xl border border-[var(--color-nexus-border)]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)] uppercase text-[9px] font-bold tracking-wider">
                    <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Branch ID</th><th className="px-3 py-2">Shift ID</th><th className="px-3 py-2">Department</th></tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 20).map((r, i) => (
                      <tr key={i} className="border-t border-[var(--color-nexus-border)]">
                        <td className="px-3 py-1.5">{r.name}</td><td className="px-3 py-1.5">{r.email}</td><td className="px-3 py-1.5">{r.role}</td>
                        <td className="px-3 py-1.5">{r.branchId}</td><td className="px-3 py-1.5">{r.shiftId}</td><td className="px-3 py-1.5">{r.department}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 20 && <p className="text-[10px] text-[var(--color-nexus-muted)] px-3 py-2">…and {rows.length - 20} more row(s)</p>}
              </div>
              <button type="button" onClick={handleSubmit} disabled={submitting} className="text-xs font-bold uppercase tracking-wider text-white bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] px-4 py-2.5 rounded-xl disabled:opacity-50">
                {submitting ? 'Importing…' : `Import ${rows.length} Employee(s)`}
              </button>
            </>
          )}

          {results && (
            <div className="space-y-1.5">
              <p className="text-xs font-bold text-[var(--color-nexus-ink)]">{results.filter((r) => r.success).length} succeeded, {results.filter((r) => !r.success).length} failed</p>
              {results.map((r) => (
                <div key={r.row} className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${r.success ? 'bg-[color:var(--color-nexus-success-text)]/10' : 'bg-[var(--color-nexus-error-soft)]'}`}>
                  {r.success ? <CheckCircle2 size={13} className="text-[var(--color-nexus-success-text)] shrink-0" /> : <XCircle size={13} className="text-[var(--color-nexus-error)] shrink-0" />}
                  <span className="font-semibold text-[var(--color-nexus-ink)]">Row {r.row}: {r.email}</span>
                  {r.error && <span className="text-[var(--color-nexus-error)]">— {r.error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
