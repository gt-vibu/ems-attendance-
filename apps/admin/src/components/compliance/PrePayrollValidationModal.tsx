import React, { useState, useEffect } from 'react';
import { X, ShieldAlert, CheckCircle2, AlertTriangle, AlertCircle, RefreshCw } from 'lucide-react';

export interface PrePayrollValidationModalProps {
  isOpen: boolean;
  onClose: () => void;
  year: number;
  month: number;
  onProceed?: () => void;
}

export default function PrePayrollValidationModal({
  isOpen,
  onClose,
  year,
  month,
  onProceed,
}: PrePayrollValidationModalProps) {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<any>(null);

  useEffect(() => {
    if (isOpen) {
      runAudit();
    }
  }, [isOpen, year, month]);

  const runAudit = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/tenant/compliance/validate-payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month }),
      });
      const data = await res.json();
      if (data.success) {
        setReport(data.report);
      }
    } catch (err) {
      console.error('Failed to run compliance validation', err);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="nexus-card w-full max-w-3xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Pre-Payroll Compliance Audit ({month}/{year})
              </h3>
              <p className="text-xs text-slate-500">Automated statutory compliance scanner</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
          {loading ? (
            <div className="p-12 text-center text-slate-400 font-semibold flex flex-col items-center gap-3">
              <RefreshCw className="w-6 h-6 animate-spin text-indigo-600" />
              <span>Scanning employees for statutory compliance...</span>
            </div>
          ) : !report ? (
            <div className="p-8 text-center text-slate-400">Failed to generate compliance report.</div>
          ) : (
            <div className="space-y-6">
              {/* Overall Status Banner */}
              <div className={`p-4 rounded-2xl border flex items-center justify-between gap-4 ${
                report.overallStatus === 'VALID'
                  ? 'bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-100 dark:border-emerald-900'
                  : report.overallStatus === 'WARNING'
                  ? 'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/60 dark:text-amber-100 dark:border-amber-900'
                  : 'bg-rose-50 text-rose-900 border-rose-200 dark:bg-rose-950/60 dark:text-rose-100 dark:border-rose-900'
              }`}>
                <div className="flex items-center gap-3">
                  {report.overallStatus === 'VALID' ? (
                    <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                  ) : report.overallStatus === 'WARNING' ? (
                    <AlertTriangle className="w-8 h-8 text-amber-500" />
                  ) : (
                    <AlertCircle className="w-8 h-8 text-rose-500" />
                  )}
                  <div>
                    <h4 className="text-sm font-bold">Overall Status: {report.overallStatus}</h4>
                    <p className="text-xs opacity-90">
                      {report.overallStatus === 'VALID'
                        ? 'All employees passed statutory compliance checks.'
                        : report.overallStatus === 'WARNING'
                        ? 'Warnings detected. Payroll calculation can proceed, but review recommended.'
                        : 'Blocking errors detected. Fix issues before calculating payroll.'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-center font-bold">
                  <div>
                    <span className="text-base block">{report.totalEmployeesAudited}</span>
                    <span className="text-[10px] font-normal opacity-80 uppercase">Audited</span>
                  </div>
                  <div>
                    <span className="text-base text-amber-600 block">{report.warningCount}</span>
                    <span className="text-[10px] font-normal opacity-80 uppercase">Warnings</span>
                  </div>
                  <div>
                    <span className="text-base text-rose-600 block">{report.blockingErrorCount}</span>
                    <span className="text-[10px] font-normal opacity-80 uppercase">Blocking</span>
                  </div>
                </div>
              </div>

              {/* Itemized Employee Issues */}
              {report.employeeIssues.length === 0 ? (
                <div className="nexus-card rounded-xl p-6 text-center text-emerald-600 dark:text-emerald-400 font-bold">
                  Zero statutory issues found. System ready for calculation.
                </div>
              ) : (
                <div className="space-y-3">
                  <h4 className="font-bold text-slate-800 dark:text-slate-200">Audit Diagnostics ({report.employeeIssues.length} employees)</h4>
                  {report.employeeIssues.map((emp: any) => (
                    <div key={emp.userId} className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800 space-y-2">
                      <div className="font-bold text-slate-900 dark:text-slate-100 flex items-center justify-between">
                        <span>{emp.userName} (#{emp.userId})</span>
                        <span className="text-[10px] text-slate-400 font-mono">{emp.issues.length} issue(s)</span>
                      </div>
                      <div className="space-y-1.5">
                        {emp.issues.map((iss: any, idx: number) => (
                          <div key={idx} className={`p-2 rounded-lg text-xs flex items-start gap-2 ${
                            iss.severity === 'BLOCKING_ERROR' ? 'bg-rose-100/50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300' : 'bg-amber-100/50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                          }`}>
                            <span className="font-bold uppercase text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border shrink-0 mt-0.5">{iss.severity}</span>
                            <span>{iss.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 flex items-center justify-between gap-3">
          <button onClick={runAudit} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs">
            <RefreshCw className="w-3.5 h-3.5" /> Re-scan
          </button>

          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 font-bold text-xs text-slate-700 dark:text-slate-300">
              Close
            </button>
            {onProceed && report?.overallStatus !== 'BLOCKING_ERROR' && (
              <button onClick={onProceed} className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md">
                Proceed to Payroll Batch Calculation
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
