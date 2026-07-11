/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, Check, AlertTriangle, Clock, MapPin, EyeOff, Smile } from 'lucide-react';

interface ReconciliationSession {
  id: string;
  employeeName: string;
  shiftStart: string;
  declaredBreakMin: number;
  observedAbsenceMin: number;
  unreconciledGapMin: number;
  declaredRange: string;
  observedRange: string;
  discrepancyType: string;
}

export default function BreakReconciliation() {
  const [sessions, setSessions] = useState<ReconciliationSession[]>([
    {
      id: 'recon-1',
      employeeName: 'David Miller',
      shiftStart: '09:00 AM',
      declaredBreakMin: 15,
      observedAbsenceMin: 55,
      unreconciledGapMin: 40,
      declaredRange: '12:00 PM — 12:15 PM',
      observedRange: '11:50 AM — 12:45 PM',
      discrepancyType: 'Exceeded Break Limit (Grace Overrun)'
    },
    {
      id: 'recon-2',
      employeeName: 'Emma Watson',
      shiftStart: '08:45 AM',
      declaredBreakMin: 45,
      observedAbsenceMin: 48,
      unreconciledGapMin: 3,
      declaredRange: '01:00 PM — 01:45 PM',
      observedRange: '12:58 PM — 01:46 PM',
      discrepancyType: 'Aligned (Within Grace Tolerance)'
    }
  ]);

  const [resolvedIds, setResolvedIds] = useState<Record<string, 'approved' | 'flagged'>>({});
  const [comments, setComments] = useState<Record<string, string>>({});

  const handleResolve = (id: string, decision: 'approved' | 'flagged') => {
    setResolvedIds(prev => ({ ...prev, [id]: decision }));
  };

  return (
    <div className="bg-white/80 border border-slate-200/50 rounded-3xl p-6 shadow-xl max-w-3xl mx-auto backdrop-blur-md">
      <div className="flex justify-between items-center mb-5 pb-3 border-b border-slate-200/40">
        <div>
          <h4 className="font-sans font-bold text-sm tracking-tight text-slate-950 uppercase flex items-center gap-1.5">
            <RefreshCw className="w-4 h-4 text-slate-700 animate-spin-slow" />
            Active Break Reconciliation
          </h4>
          <span className="font-mono text-[9px] tracking-widest text-slate-400 font-semibold uppercase">
            Declared Logs vs Observed Presence Telemetry Gaps
          </span>
        </div>
        <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-[10px] font-mono text-slate-500 font-bold">
          AUDIT_RECON_v1.0
        </span>
      </div>

      <div className="space-y-6">
        {sessions.map((session) => {
          const isResolved = resolvedIds[session.id];
          const hasSignificantGap = session.unreconciledGapMin > 10;
          
          return (
            <div 
              key={session.id}
              className={`p-5 rounded-2xl border transition-all duration-500 relative ${
                isResolved
                  ? 'bg-slate-50/50 border-slate-200 opacity-60'
                  : hasSignificantGap
                    ? 'bg-amber-50/30 border-amber-200/60 shadow-md shadow-amber-50/20'
                    : 'bg-white border-slate-200/60'
              }`}
            >
              {/* Employee & Time metadata */}
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h5 className="font-sans font-bold text-sm text-slate-900">{session.employeeName}</h5>
                  <p className="font-mono text-[10px] text-slate-400 font-semibold uppercase">
                    SHIFT_START: {session.shiftStart} | DECLARED: {session.declaredBreakMin}m | TELEMETRY: {session.observedAbsenceMin}m
                  </p>
                </div>
                {isResolved ? (
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono uppercase font-bold flex items-center gap-1 ${
                    isResolved === 'approved' 
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                      : 'bg-rose-100 text-rose-800 border border-rose-200'
                  }`}>
                    {isResolved === 'approved' ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                    {isResolved === 'approved' ? 'GAP_FORGIVEN' : 'FLAGGED_ANOMALY'}
                  </span>
                ) : hasSignificantGap ? (
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-mono uppercase font-bold flex items-center gap-1 animate-pulse">
                    <AlertTriangle className="w-3 h-3" />
                    DISCREPANCY FLAGGED ({session.unreconciledGapMin}m Gap)
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-mono uppercase font-bold flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    RECONCILED
                  </span>
                )}
              </div>

              {/* Dual-timeline graphics */}
              <div className="space-y-3 bg-slate-50/50 p-4 rounded-xl border border-slate-100 mb-4">
                {/* Track A: Declared Break */}
                <div className="grid grid-cols-12 items-center gap-3">
                  <div className="col-span-3 text-[11px] font-mono text-slate-500 font-semibold flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-slate-400" /> Declared
                  </div>
                  <div className="col-span-9 relative h-4 bg-slate-100 rounded-md overflow-hidden flex items-center justify-center">
                    {/* Centered representation block */}
                    <div 
                      className="absolute h-full bg-amber-500/80 border-x border-amber-600/30 flex items-center justify-center"
                      style={{ left: '40%', width: '15%' }}
                    >
                      <span className="text-[8px] font-mono text-white font-bold leading-none">{session.declaredBreakMin}m</span>
                    </div>
                    <span className="absolute left-2 text-[8.5px] font-mono text-slate-400 font-semibold">{session.declaredRange}</span>
                  </div>
                </div>

                {/* Track B: Observed Geofence Absence */}
                <div className="grid grid-cols-12 items-center gap-3">
                  <div className="col-span-3 text-[11px] font-mono text-slate-500 font-semibold flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" /> Geofence exit
                  </div>
                  <div className="col-span-9 relative h-4 bg-slate-100 rounded-md overflow-hidden flex items-center justify-center">
                    {/* Wider observed exit gap block */}
                    <div 
                      className={`absolute h-full border-x flex items-center justify-center ${
                        hasSignificantGap 
                          ? 'bg-rose-500/70 border-rose-600/30' 
                          : 'bg-emerald-500/70 border-emerald-600/30'
                      }`}
                      style={{ left: '30%', width: '45%' }}
                    >
                      <span className="text-[8px] font-mono text-white font-bold leading-none">{session.observedAbsenceMin}m</span>
                    </div>
                    <span className="absolute left-2 text-[8.5px] font-mono text-slate-400 font-semibold">{session.observedRange}</span>
                  </div>
                </div>
              </div>

              {/* RED BRACKET ANOMALY EXPLANATION */}
              {hasSignificantGap && !isResolved && (
                <div className="flex items-start gap-2 text-rose-700 bg-rose-50/40 p-3 rounded-xl border border-rose-100/30 text-xs font-sans mb-4">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block uppercase font-mono text-[9px] text-rose-600 tracking-wider mb-0.5">Telemetry Gap analysis</span>
                    Employee left the geofence boundary at 11:50 AM, but did not declare a break until 12:00 PM. Employee returned to the building at 12:45 PM, but clicked &quot;End Break&quot; at 12:15 PM. <strong>Discrepancy: {session.unreconciledGapMin} minutes of unaccounted out-of-office presence.</strong>
                  </div>
                </div>
              )}

              {/* Action Toolbar for manager */}
              {!isResolved && (
                <div className="flex items-center gap-3 justify-end">
                  {hasSignificantGap && (
                    <input
                      type="text"
                      placeholder="Add reconciliation notes (e.g., Client meeting context)..."
                      className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700 w-full placeholder-slate-400 focus:outline-none focus:border-slate-400"
                      value={comments[session.id] || ''}
                      onChange={(e) => setComments(prev => ({ ...prev, [session.id]: e.target.value }))}
                    />
                  )}
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleResolve(session.id, 'approved')}
                      id={`recon-approve-btn-${session.id}`}
                      className="flex items-center gap-1 px-3.5 py-1.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 transition-all duration-300 text-xs font-semibold cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Forgive Gap
                    </button>
                    {hasSignificantGap && (
                      <button
                        onClick={() => handleResolve(session.id, 'flagged')}
                        id={`recon-flag-btn-${session.id}`}
                        className="flex items-center gap-1 px-3.5 py-1.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100 transition-all duration-300 text-xs font-semibold cursor-pointer"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Flag Anomaly
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Resolved comment audit line */}
              {isResolved && comments[session.id] && (
                <p className="text-[11px] font-sans text-slate-400 italic mt-2 pl-3 border-l border-slate-200">
                  Manager Audit Comment: &quot;{comments[session.id]}&quot;
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
