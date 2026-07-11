/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { attendanceEngine } from '../state/attendanceMachine';
import { SessionStatus } from '../types';

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

  const stateColors: Record<string, string> = {
    NOT_STARTED: 'bg-slate-400',
    PENDING_VERIFICATION: 'bg-amber-400 animate-pulse',
    ACTIVE: 'bg-emerald-400',
    ON_BREAK: 'bg-teal-400',
    NEEDS_REVIEW: 'bg-orange-400 animate-bounce',
    PENDING_APPROVAL: 'bg-purple-400',
    CLOSED: 'bg-green-600',
    REJECTED: 'bg-rose-500',
    ABSENT: 'bg-slate-500'
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-auto select-none">
      <div className="bg-white/90 backdrop-blur-xl border border-slate-200/60 rounded-full px-6 py-2 shadow-[0_12px_32px_-6px_rgba(0,0,0,0.12)] flex items-center gap-4 transition-all duration-300 hover:shadow-[0_16px_40px_-8px_rgba(0,0,0,0.16)]">
        
        {/* State LED tracker */}
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${stateColors[session] || 'bg-slate-400'} border border-white`} />
          <span className="font-mono text-[9px] font-extrabold text-slate-800 uppercase tracking-widest block md:inline-block">
            {session}
          </span>
        </div>

        {/* Separator line */}
        <div className="w-[1.5px] h-4 bg-slate-200" />

        {/* Action Call Button */}
        <button
          onClick={scrollToDemo}
          className="px-4 py-1.5 rounded-full bg-slate-950 text-white font-bold text-[10px] uppercase tracking-wider hover:bg-slate-850 transition-colors cursor-pointer"
        >
          Start Free
        </button>

      </div>
    </div>
  );
}
