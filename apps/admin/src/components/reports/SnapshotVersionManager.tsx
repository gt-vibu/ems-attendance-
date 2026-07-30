import React, { useState } from 'react';
import {
  History,
  Lock,
  Download,
  ShieldCheck,
  Calendar,
  UserCheck,
  FileCheck2,
  Trash2,
  Copy,
  ExternalLink,
  CheckCircle2,
  LockKeyhole
} from 'lucide-react';
import { ReportSnapshot } from './reportMetadata';

export interface SnapshotVersionManagerProps {
  snapshots: ReportSnapshot[];
  onTakeSnapshot: (confidentiality: ReportSnapshot['confidentiality']) => void;
  onRestoreSnapshot: (snapshot: ReportSnapshot) => void;
  onDeleteSnapshot?: (snapshotId: string) => void;
  currentReportTitle: string;
}

export const SnapshotVersionManager: React.FC<SnapshotVersionManagerProps> = ({
  snapshots,
  onTakeSnapshot,
  onRestoreSnapshot,
  onDeleteSnapshot,
  currentReportTitle
}) => {
  const [selectedConfidentiality, setSelectedConfidentiality] = useState<ReportSnapshot['confidentiality']>('Confidential');
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-5 font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <History className="w-4 h-4 text-indigo-600" />
            Immutable Snapshot & Audit Versioning
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Freeze report data into immutable audit snapshots with cryptographic verification hashes for compliance.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedConfidentiality}
            onChange={(e) => setSelectedConfidentiality(e.target.value as any)}
            className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 font-medium bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="Public">Public</option>
            <option value="Internal">Internal Use</option>
            <option value="Confidential">Confidential</option>
            <option value="Strictly Secret">Strictly Secret</option>
          </select>

          <button
            onClick={() => onTakeSnapshot(selectedConfidentiality)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
          >
            <LockKeyhole className="w-3.5 h-3.5" />
            Lock Snapshot
          </button>
        </div>
      </div>

      {snapshots.length === 0 ? (
        <div className="text-center py-8 bg-slate-50 border border-dashed border-slate-200 rounded-xl">
          <FileCheck2 className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-xs font-bold text-slate-700">No Historical Snapshots Created</p>
          <p className="text-[11px] text-slate-400 max-w-sm mx-auto mt-1">
            Click "Lock Snapshot" above to create an immutable audit record of "{currentReportTitle}" for payroll and compliance reporting.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {snapshots.map((snap) => (
            <div
              key={snap.id}
              className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-white hover:border-indigo-200 transition space-y-2"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="text-xs font-extrabold px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 border border-indigo-200 font-mono">
                    {snap.version}
                  </span>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">{snap.reportName}</h4>
                    <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-0.5">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-slate-400" />
                        {snap.generatedAt}
                      </span>
                      <span className="flex items-center gap-1">
                        <UserCheck className="w-3 h-3 text-slate-400" />
                        By {snap.generatedBy}
                      </span>
                      <span className="font-semibold text-slate-700">
                        {snap.recordCount} records
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                    snap.confidentiality === 'Strictly Secret' ? 'bg-rose-100 text-rose-800 border border-rose-200' :
                    snap.confidentiality === 'Confidential' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                    'bg-slate-200 text-slate-700'
                  }`}>
                    {snap.confidentiality}
                  </span>

                  <button
                    onClick={() => onRestoreSnapshot(snap)}
                    className="flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-300 hover:border-indigo-500 text-slate-700 hover:text-indigo-600 rounded-md text-xs font-semibold shadow-2xs transition"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Inspect Data
                  </button>

                  {onDeleteSnapshot && (
                    <button
                      onClick={() => onDeleteSnapshot(snap.id)}
                      className="p-1 text-slate-400 hover:text-rose-600 transition"
                      title="Delete Snapshot"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* SHA-256 Cryptographic Hash & Signature Bar */}
              <div className="pt-2 border-t border-slate-200/60 flex flex-col sm:flex-row sm:items-center justify-between text-[10px] text-slate-500 gap-2">
                <div className="flex items-center gap-1.5 font-mono text-slate-600 bg-white px-2 py-1 rounded border border-slate-200 truncate">
                  <ShieldCheck className="w-3 h-3 text-emerald-600 shrink-0" />
                  <span className="text-slate-400">HASH:</span>
                  <span className="truncate max-w-[200px] sm:max-w-[300px]">{snap.hash}</span>
                  <button
                    onClick={() => handleCopyHash(snap.hash)}
                    className="p-0.5 text-slate-400 hover:text-slate-700 transition ml-1"
                    title="Copy Verification Hash"
                  >
                    {copiedHash === snap.hash ? <CheckCircle2 className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-slate-400">DIGITAL SIGNATURE:</span>
                  <span className="font-mono text-indigo-950 font-semibold">{snap.digitalSignature}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SnapshotVersionManager;
