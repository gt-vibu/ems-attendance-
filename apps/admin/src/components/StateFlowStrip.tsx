/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ShieldAlert, RefreshCw, CheckCircle, Coffee, ShieldCheck, HelpCircle, XCircle, Moon, Play } from 'lucide-react';

// Static replacement for the previous 3D "orbit ring" of attendance states —
// same real information (every state the attendance engine can be in, and
// what it means), just presented as a plain grid of cards instead of a
// rotating WebGL scene, per the "make it static" request.
const STATE_NODES = [
  { id: 'NOT_STARTED', name: 'Not Started', meaning: 'Shift not yet begun — verification gate is armed.', color: '#64748B', icon: Play },
  { id: 'PENDING_VERIFICATION', name: 'Verifying', meaning: 'Face and location checks are running.', color: '#D97706', icon: RefreshCw },
  { id: 'ACTIVE', name: 'Active', meaning: 'Fully verified — location and identity confirmed.', color: '#16A34A', icon: ShieldCheck },
  { id: 'ON_BREAK', name: 'On Break', meaning: 'Shift paused — location tracking suspended.', color: '#2563EB', icon: Coffee },
  { id: 'NEEDS_REVIEW', name: 'Needs Review', meaning: 'Flagged for a location gap or verification issue.', color: '#D97706', icon: ShieldAlert },
  { id: 'PENDING_APPROVAL', name: 'Pending Approval', meaning: 'A correction has been filed and awaits sign-off.', color: '#7C3AED', icon: HelpCircle },
  { id: 'CLOSED', name: 'Closed', meaning: 'Checkout verified — the record is locked in.', color: '#16A34A', icon: CheckCircle },
  { id: 'REJECTED', name: 'Rejected', meaning: 'Verification failed — the attempt was discarded.', color: '#DC2626', icon: XCircle },
  { id: 'ABSENT', name: 'Absent', meaning: 'Shift began but no check-in was ever completed.', color: '#64748B', icon: Moon },
];

export default function StateFlowStrip() {
  return (
    <div className="max-w-6xl mx-auto px-6">
      <div className="text-center mb-10 space-y-2">
        <span className="text-xs font-bold uppercase tracking-widest text-[var(--color-premium-accent)]">Every transition, versioned</span>
        <h2 className="font-display font-semibold text-2xl md:text-3xl text-[var(--color-premium-ink)] tracking-tight">
          Nine states. Zero ambiguity.
        </h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-3 gap-4">
        {STATE_NODES.map((node) => (
          <div
            key={node.id}
            className="bg-[var(--color-premium-surface)] border border-[var(--color-premium-border)] rounded-2xl p-4 flex items-start gap-3"
          >
            <span
              className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
              style={{ color: node.color, backgroundColor: `${node.color}18` }}
            >
              <node.icon size={16} />
            </span>
            <div>
              <p className="text-sm font-bold text-[var(--color-premium-ink)]">{node.name}</p>
              <p className="text-[12px] text-[var(--color-premium-muted)] leading-snug mt-0.5">{node.meaning}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
