/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { LogEvent } from '../state/attendanceMachine';

interface EventLogProps {
  logs: LogEvent[];
}

export default function EventLog({ logs }: EventLogProps) {
  return (
    <div className="mt-4 border border-slate-200/50 rounded-2xl bg-slate-950 p-4 select-none flex flex-col items-stretch">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[9px] text-[#8FE3C0] font-black tracking-widest uppercase">
          PERIMETER IMMUTABLE LEDGER STREAM
        </span>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#8FE3C0] animate-ping" />
          <span className="font-mono text-[8px] text-slate-500 font-extrabold uppercase">
            LIVE EVENTS LOGS
          </span>
        </div>
      </div>

      {/* Scrolling Log Area */}
      <div className="h-[120px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent font-mono text-[10px] text-[#8FE3C0] space-y-1 pr-2">
        {logs.length === 0 ? (
          <div className="text-slate-600 italic py-2 text-center text-[9px] uppercase tracking-wider">
            NO ACTIONS LOGGED ON LEDGER YET. RUN A SHIFT SIMULATION ABOVE.
          </div>
        ) : (
          logs.map((log, idx) => (
            <div 
              key={`${log.timestamp}-${idx}`} 
              className="flex items-start gap-2.5 py-1 px-1.5 hover:bg-white/5 rounded transition-all duration-150 border-b border-white/5 last:border-0"
            >
              <span className="text-slate-500 shrink-0 font-bold">
                [{log.timestamp}]
              </span>
              <span className="font-black shrink-0 uppercase tracking-tight text-[9px]" style={{ color: log.name.includes('anomaly') ? '#E8843F' : '#4FD1A5' }}>
                {log.name}:
              </span>
              <span className="text-slate-300 leading-tight">
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
