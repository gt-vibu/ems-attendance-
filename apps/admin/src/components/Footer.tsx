/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ArrowUpRight, Sparkles } from 'lucide-react';

export default function Footer() {
  const scrollToDemo = () => {
    const el = document.getElementById('interactive-demo-panel');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <footer className="w-full bg-slate-50 border-t border-slate-200 py-16 px-6 relative overflow-hidden select-none">
      <div className="max-w-7xl mx-auto grid md:grid-cols-12 gap-12 items-start">
        
        {/* Left Column: CTA */}
        <div className="md:col-span-5 space-y-6">
          <h3 className="font-display font-black text-2xl text-slate-950 tracking-tight">
            Smart Teams
          </h3>
          <p className="text-xs text-slate-500 font-sans max-w-sm leading-relaxed">
            Attendance verification that is simple to run and impossible to cheat. Governed by isolated, secure state machine blocks.
          </p>

          <button
            onClick={scrollToDemo}
            className="px-6 py-3 rounded-full bg-slate-900 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2 hover:bg-slate-800 transition-all cursor-pointer shadow-md"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            Try Live Simulator
          </button>
        </div>

        {/* Right Columns: Links */}
        <div className="md:col-span-7 grid grid-cols-2 md:grid-cols-3 gap-8 md:justify-items-end">
          
          <div className="space-y-4">
            <h5 className="font-mono text-[9px] text-slate-500 font-extrabold tracking-widest uppercase">
              PRODUCT
            </h5>
            <ul className="space-y-2">
              <li>
                <a href="#features" className="text-sm font-sans text-slate-700 hover:text-slate-950 transition-opacity">
                  Features
                </a>
              </li>
              <li>
                <a href="#pricing" className="text-sm font-sans text-slate-700 hover:text-slate-950 transition-opacity">
                  Pricing
                </a>
              </li>
              <li>
                <a href="#testimonials" className="text-sm font-sans text-slate-700 hover:text-slate-950 transition-opacity">
                  Operators Voice
                </a>
              </li>
            </ul>
          </div>

          <div className="space-y-4">
            <h5 className="font-mono text-[9px] text-slate-500 font-extrabold tracking-widest uppercase">
              RESOURCES
            </h5>
            <ul className="space-y-2">
              <li>
                <a href="#how-it-works" className="text-sm font-sans text-slate-700 hover:text-slate-950 transition-opacity flex items-center gap-1">
                  Docs
                  <ArrowUpRight className="w-3.5 h-3.5 opacity-50" />
                </a>
              </li>
              <li>
                <a href="https://status.perimeter.systems" target="_blank" rel="noreferrer" className="text-sm font-sans text-slate-700 hover:text-slate-950 transition-opacity flex items-center gap-1">
                  Status Page
                  <ArrowUpRight className="w-3.5 h-3.5 opacity-50" />
                </a>
              </li>
              <li>
                <a href="https://linkedin.com" target="_blank" rel="noreferrer" className="text-sm font-sans text-slate-700 hover:text-slate-950 transition-opacity flex items-center gap-1">
                  LinkedIn
                  <ArrowUpRight className="w-3.5 h-3.5 opacity-50" />
                </a>
              </li>
            </ul>
          </div>

        </div>

      </div>
    </footer>
  );
}
