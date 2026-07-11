/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ScrollText, ChevronDown, ChevronUp, Clock, History, HelpCircle } from 'lucide-react';
import { useLiveTheme } from '../../hooks/useLiveTheme';

export default function PolicyVersionBar() {
  const theme = useLiveTheme();
  const [isOpen, setIsOpen] = useState(false);

  const history = [
    { version: 'v2.4.1', status: 'ACTIVE', date: 'Effective Jul 01, 2026', desc: 'Added 15m grace limits for Engineering Shift and dual biometric handshakes.' },
    { version: 'v2.4.0', status: 'SUPERSEDED', date: 'May 12, 2026 — Jun 30, 2026', desc: 'Introduced basic Geofencing checks and 30m break reconciliation logs.' },
    { version: 'v1.1.2', status: 'ARCHIVED', date: 'Jan 01, 2026 — May 11, 2026', desc: 'Initial baseline tenant policy specifications with traditional wifi matching.' },
    { version: 'v2.5.0-beta', status: 'DRAFT', date: 'In Review', desc: 'Proposed AI-based continuous micro-spoof challenge pipeline.' }
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 select-none mb-4">
      <div className="glass-panel rounded-2xl border border-slate-200/50 shadow-sm overflow-hidden">
        {/* Banner strip */}
        <div 
          onClick={() => setIsOpen(!isOpen)}
          className="flex justify-between items-center px-5 py-3 cursor-pointer hover:bg-slate-50/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <ScrollText className="w-4 h-4" style={{ color: theme.accentHex }} />
            <span className="font-sans font-bold text-xs text-slate-800 uppercase tracking-tight">
              Tenant Policy Context: <span className="text-slate-950 font-black">HQ Corporate Corp</span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            <span className="font-mono text-xs font-black text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
              ACTIVE_POLICY: v2.4.1
            </span>
            {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
          </div>
        </div>

        {/* Expandable History details */}
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="border-t border-slate-200/40 bg-slate-50/50 p-4 space-y-3"
            >
              <div className="flex justify-between items-center">
                <span className="font-mono text-[9px] tracking-widest text-slate-400 font-extrabold uppercase flex items-center gap-1">
                  <History className="w-3.5 h-3.5 text-slate-400" />
                  Policy Version Ledger & Audit Timeline
                </span>
                <span className="font-mono text-[9px] text-slate-400">
                  Click rules to pin past decisions permanently
                </span>
              </div>

              <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4 pt-1">
                {history.map((item) => (
                  <div 
                    key={item.version}
                    className="p-3 bg-white border border-slate-200/50 rounded-xl space-y-1.5 shadow-xs hover:border-slate-300 transition-all"
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-mono text-xs font-black text-slate-950">{item.version}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[8px] font-mono font-bold uppercase ${
                        item.status === 'ACTIVE' 
                          ? 'bg-emerald-50 border border-emerald-100 text-emerald-800' 
                          : item.status === 'DRAFT'
                            ? 'bg-amber-50 border border-amber-100 text-amber-800'
                            : 'bg-slate-100 border border-slate-200 text-slate-500'
                      }`}>
                        {item.status}
                      </span>
                    </div>
                    <span className="font-mono text-[9px] text-slate-400 block font-semibold">{item.date}</span>
                    <p className="font-sans text-[10px] text-slate-500 leading-normal">{item.desc}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
