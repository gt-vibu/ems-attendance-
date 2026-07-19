/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { attendanceEngine } from '../state/attendanceMachine';
import { SessionStatus } from '../types';

const SESSION_LABELS: Record<string, string> = {
  NOT_STARTED: 'Not started',
  PENDING_VERIFICATION: 'Verifying',
  ACTIVE: 'Active',
  ON_BREAK: 'On break',
  NEEDS_REVIEW: 'Needs review',
  CLOSED: 'Closed',
  REJECTED: 'Rejected',
  ABSENT: 'Absent',
};

const STATE_COLORS: Record<string, string> = {
  NOT_STARTED: '#8A9089',
  PENDING_VERIFICATION: '#B8873A',
  ACTIVE: '#0F6E5B',
  ON_BREAK: '#2E6F8E',
  NEEDS_REVIEW: '#B8873A',
  CLOSED: '#14805F',
  REJECTED: '#B3432B',
  ABSENT: '#8A9089',
};

export default function BottomNav() {
  const [session, setSession] = useState<SessionStatus>(SessionStatus.NOT_STARTED);

  useEffect(() => {
    const unsub = attendanceEngine.subscribe(() => {
      setSession(attendanceEngine.sessionState);
    });
    setSession(attendanceEngine.sessionState);
    return unsub;
  }, []);

  const scrollToDemo = () => {
    const el = document.getElementById('interactive-demo-panel');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-auto select-none">
      <div className="glass-card rounded-full px-6 py-2 flex items-center gap-4 transition-shadow duration-300" style={{ boxShadow: 'var(--shadow-elevation-2)' }}>

        {/* State tracker */}
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATE_COLORS[session] || '#8A9089' }} />
          <span className="text-[11px] font-bold text-[var(--color-premium-ink)]">
            {SESSION_LABELS[session] || session}
          </span>
        </div>

        {/* Separator line */}
        <div className="w-px h-4 bg-[var(--color-premium-border)]" />

        {/* Action Call Button */}
        <button
          onClick={scrollToDemo}
          className="px-4 py-1.5 rounded-full bg-[var(--color-premium-ink)] text-white font-bold text-[11px] uppercase tracking-wide hover:opacity-90 transition-opacity cursor-pointer"
        >
          Start Free
        </button>

      </div>
    </div>
  );
}
