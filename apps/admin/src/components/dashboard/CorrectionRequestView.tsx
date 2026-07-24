/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldCheck, ChevronRight, CheckCircle2, AlertTriangle, ArrowRight, Clock, HelpCircle, FileDiff } from 'lucide-react';
import { MOCK_CORRECTIONS } from '../../data';
import { CorrectionRequest } from '../../types';

export default function CorrectionRequestView() {
  const [corrections, setCorrections] = useState<CorrectionRequest[]>(MOCK_CORRECTIONS);
  const [selectedIdx, setSelectedIdx] = useState<number>(0);
  const [diffDrawerOpen, setDiffDrawerOpen] = useState(false);

  const active = corrections[selectedIdx];

  const steps = [
    { label: 'Draft', status: 'DRAFT' },
    { label: 'Submitted', status: 'SUBMITTED' },
    { label: 'Manager Sign-off', status: 'MANAGER_APPROVED' },
    { label: 'HR Audit', status: 'APPLIED' }
  ];

  // Helper to determine stepper status color
  const getStepStatus = (stepIndex: number, currentStatus: string) => {
    const statusIndices: Record<string, number> = {
      DRAFT: 0,
      SUBMITTED: 1,
      MANAGER_APPROVED: 2,
      APPLIED: 3
    };

    const currentIdx = statusIndices[currentStatus] ?? 0;

    if (stepIndex < currentIdx) return 'complete';
    if (stepIndex === currentIdx) return 'active';
    return 'upcoming';
  };

  const handleApproveStage = () => {
    setCorrections(prev => {
      const updated = [...prev];
      const target = updated[selectedIdx];
      if (target.status === 'SUBMITTED') {
        target.status = 'MANAGER_APPROVED';
        target.approvalsChain[0].status = 'APPROVED';
        target.approvalsChain[0].time = 'Today, ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else if (target.status === 'MANAGER_APPROVED') {
        target.status = 'APPLIED';
        target.approvalsChain[1].status = 'APPROVED';
        target.approvalsChain[1].time = 'Today, ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      return updated;
    });
  };

  return (
    <div className="bg-white/80 border border-[var(--color-nexus-border)]/50 rounded-3xl p-6 shadow-xl max-w-3xl mx-auto backdrop-blur-md relative overflow-hidden">
      <div className="absolute top-0 right-0 p-3 text-[9px] font-mono tracking-widest text-[var(--color-nexus-muted)] uppercase">
        STAGE_WORKFLOW_ENG
      </div>

      <div className="flex justify-between items-center mb-6 pb-3 border-b border-[var(--color-nexus-border)]/40">
        <div>
          <h4 className="font-sans font-bold text-sm tracking-tight text-[var(--color-nexus-ink)] uppercase flex items-center gap-1.5">
            <FileDiff className="w-4 h-4 text-[var(--color-nexus-ink)]" />
            Timesheet Correction Workflow
          </h4>
          <span className="font-mono text-[9px] tracking-widest text-[var(--color-nexus-muted)] font-semibold uppercase">
            Double-stage review & immutable audit trial updates
          </span>
        </div>

        {/* Navigation tabs between requests */}
        <div className="flex gap-1.5">
          {corrections.map((c, i) => (
            <button
              key={c.id}
              onClick={() => setSelectedIdx(i)}
              className={`px-3 py-1 rounded-full text-xs font-mono font-bold tracking-tight transition-all duration-300 ${
                selectedIdx === i
                  ? 'bg-[var(--color-nexus-ink)] text-white shadow-sm'
                  : 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)] hover:bg-[var(--color-nexus-border)]'
              }`}
            >
              {c.userName.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-6">

        {/* VISUAL WORKFLOW STEPPER */}
        <div className="bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)]/30 rounded-2xl p-4 flex justify-between items-center relative overflow-hidden">
          {steps.map((step, idx) => {
            const status = getStepStatus(idx, active.status);
            return (
              <React.Fragment key={step.label}>
                <div className="flex flex-col items-center relative z-10">
                  <motion.div
                    animate={{
                      scale: status === 'active' ? 1.1 : 1,
                      backgroundColor: status === 'complete' || status === 'active' ? '#0f172a' : '#f1f5f9',
                      color: status === 'complete' || status === 'active' ? '#ffffff' : '#94a3b8',
                      borderColor: status === 'active' ? '#6366f1' : 'transparent'
                    }}
                    className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold font-mono transition-all duration-350"
                  >
                    {status === 'complete' ? (
                      <CheckCircle2 className="w-4 h-4 text-[var(--color-nexus-success-text)]" />
                    ) : (
                      idx + 1
                    )}
                  </motion.div>
                  <span className={`text-[10px] font-sans font-medium mt-1.5 ${
                    status === 'active' ? 'text-[var(--color-nexus-ink)] font-bold' : 'text-[var(--color-nexus-muted)]'
                  }`}>
                    {step.label}
                  </span>
                </div>
                {idx < steps.length - 1 && (
                  <div className="flex-1 h-[2px] bg-[var(--color-nexus-border)] mx-2 relative">
                    <motion.div
                      className="absolute top-0 left-0 bottom-0 bg-[var(--color-nexus-ink)]"
                      initial={{ width: '0%' }}
                      animate={{ width: status === 'complete' ? '100%' : '0%' }}
                      transition={{ duration: 0.4 }}
                    />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* SIDE-BY-SIDE DIFF PANELS */}
        <div className="grid md:grid-cols-2 gap-4">

          {/* Pre-Change Snapshot container (Read-only, immutable) */}
          <div className="border border-[var(--color-nexus-border)] rounded-2xl p-4 bg-[var(--color-nexus-surface-alt)] relative">
            <div className="absolute top-0 right-0 p-2 text-[8px] font-mono text-[var(--color-nexus-muted)] tracking-widest uppercase font-bold">
              PRE_SNAPSHOT
            </div>
            <h5 className="font-sans font-bold text-xs text-[var(--color-nexus-muted)] uppercase tracking-tight mb-3">
              Immutable Original Logs
            </h5>
            <div className="space-y-3 font-mono text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-[var(--color-nexus-border)]/50">
                <span className="text-[var(--color-nexus-muted)] font-semibold">CHECK_IN_TIME</span>
                <span className="text-[var(--color-nexus-ink)] font-bold">{active.preSnapshot.checkIn || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-[var(--color-nexus-border)]/50">
                <span className="text-[var(--color-nexus-muted)] font-semibold">CHECK_OUT_TIME</span>
                <span className="text-[var(--color-nexus-ink)] font-bold">{active.preSnapshot.checkOut || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[var(--color-nexus-muted)] font-semibold">BREAK_DURATION</span>
                <span className="text-[var(--color-nexus-ink)] font-bold">{active.preSnapshot.breakDuration} MINS</span>
              </div>
            </div>
          </div>

          {/* Requested Post-Change Updates */}
          <div className="border border-[var(--color-nexus-border)] rounded-2xl p-4 bg-white shadow-sm relative">
            <div className="absolute top-0 right-0 p-2 text-[8px] font-mono text-[var(--color-nexus-info)] tracking-widest uppercase font-bold">
              PROPOSED_CHANGES
            </div>
            <h5 className="font-sans font-bold text-xs text-[var(--color-nexus-ink)] uppercase tracking-tight mb-3">
              Proposed Updates
            </h5>
            <div className="space-y-3 font-mono text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-[var(--color-nexus-border)]">
                <span className="text-[var(--color-nexus-muted)] font-semibold">CHECK_IN_TIME</span>
                <span className="text-[var(--color-nexus-ink)] font-bold flex items-center gap-1.5">
                  {active.preSnapshot.checkIn !== active.postChanges.checkIn && (
                    <motion.span animate={{ scale: [1, 1.1, 1] }} className="text-[var(--color-nexus-error)] line-through text-[10px]">{active.preSnapshot.checkIn}</motion.span>
                  )}
                  <ArrowRight className="w-3 h-3 text-[var(--color-nexus-muted)]" />
                  <span className="text-[var(--color-nexus-success-text)] font-black">{active.postChanges.checkIn}</span>
                </span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-[var(--color-nexus-border)]">
                <span className="text-[var(--color-nexus-muted)] font-semibold">CHECK_OUT_TIME</span>
                <span className="text-[var(--color-nexus-ink)] font-bold flex items-center gap-1.5">
                  {active.preSnapshot.checkOut !== active.postChanges.checkOut && (
                    <motion.span className="text-[var(--color-nexus-error)] line-through text-[10px]">{active.preSnapshot.checkOut}</motion.span>
                  )}
                  <ArrowRight className="w-3 h-3 text-[var(--color-nexus-muted)]" />
                  <span className="text-[var(--color-nexus-success-text)] font-black">{active.postChanges.checkOut}</span>
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[var(--color-nexus-muted)] font-semibold">BREAK_DURATION</span>
                <span className="text-[var(--color-nexus-ink)] font-bold flex items-center gap-1.5">
                  {active.preSnapshot.breakDuration !== active.postChanges.breakDuration && (
                    <motion.span className="text-[var(--color-nexus-error)] line-through text-[10px]">{active.preSnapshot.breakDuration}m</motion.span>
                  )}
                  <ArrowRight className="w-3 h-3 text-[var(--color-nexus-muted)]" />
                  <span className="text-[var(--color-nexus-success-text)] font-black">{active.postChanges.breakDuration} MINS</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Correction Notes / Statement of Reason */}
        <div className="p-4 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-2xl text-xs">
          <span className="font-mono text-[9px] text-[var(--color-nexus-muted)] tracking-wider block mb-1 font-bold">STATEMENT_OF_REASON</span>
          <p className="font-sans text-[var(--color-nexus-muted)] leading-normal italic">
            &quot;{active.notes}&quot;
          </p>
        </div>

        {/* Interactive Approvals Chain Flow */}
        <div className="space-y-2">
          <span className="font-mono text-[9px] text-[var(--color-nexus-muted)] tracking-wider block font-bold uppercase">APPROVALS_STATUS_FLOW</span>
          <div className="space-y-1.5">
            {active.approvalsChain.map((node, index) => (
              <div key={index} className="flex justify-between items-center p-2.5 rounded-xl bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] text-xs font-sans">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    node.status === 'APPROVED' ? 'bg-[var(--color-nexus-success-text)]' : 'bg-[var(--color-nexus-warning)] animate-pulse'
                  }`} />
                  <span className="font-semibold text-[var(--color-nexus-ink)]">{node.role} ({node.actor})</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-[var(--color-nexus-muted)]">{node.time || 'AWAITING_REVIEW'}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-mono uppercase font-bold border ${
                    node.status === 'APPROVED'
                      ? 'bg-[var(--color-nexus-success-soft)] border-[var(--color-nexus-success-text)]/20 text-[var(--color-nexus-success-text)]'
                      : 'bg-[var(--color-nexus-warning-soft)] border-[var(--color-nexus-warning)]/20 text-[var(--color-nexus-warning)]'
                  }`}>
                    {node.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Trigger Approval node actions for presentation demo */}
        {active.status !== 'APPLIED' && (
          <div className="flex items-center justify-between border-t border-[var(--color-nexus-border)] pt-4 mt-2">
            <div className="flex items-center gap-1.5 text-xs text-[var(--color-nexus-muted)]">
              <Clock className="w-3.5 h-3.5 text-[var(--color-nexus-info)] animate-pulse" />
              SLA Countdown: <span className="font-mono text-[var(--color-nexus-muted)] font-bold">{active.slaHoursRemaining} Hours Remaining</span>
            </div>

            <button
              onClick={handleApproveStage}
              id={`approve-correction-btn-${active.id}`}
              className="flex items-center gap-1 px-5 py-2 rounded-2xl bg-[var(--color-nexus-ink)] text-white hover:bg-[var(--color-nexus-ink)]/90 transition-all duration-300 text-xs font-semibold cursor-pointer shadow-sm shadow-[var(--color-nexus-border)]"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-nexus-success-text)]" />
              {active.status === 'SUBMITTED' ? 'Manager Sign-off' : 'HR Final Audit Apply'}
            </button>
          </div>
        )}

        {active.status === 'APPLIED' && (
          <div className="flex items-center justify-center gap-2 p-3 bg-[var(--color-nexus-success-soft)] border border-[var(--color-nexus-success-text)]/20 rounded-2xl text-[var(--color-nexus-success-text)] text-xs font-semibold animate-fade-in text-center">
            <CheckCircle2 className="w-4 h-4 text-[var(--color-nexus-success-text)] animate-bounce" />
            Correction request applied successfully. Original Timesheet row overridden and committed to historic audit ledgers.
          </div>
        )}
      </div>
    </div>
  );
}
