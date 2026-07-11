/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ArrowUpRight, ShieldCheck, Zap } from 'lucide-react';
import { useInViewAnimation } from '../hooks/useInViewAnimation';

export default function PricingSection() {
  const { ref, className } = useInViewAnimation<HTMLDivElement>();

  return (
    <section id="pricing" className="py-20 px-6 max-w-7xl mx-auto overflow-hidden">
      <div className="text-center mb-16">
        <span className="font-mono text-xs text-[#8FE3C0] font-bold uppercase tracking-widest block mb-2">
          TRANSPARENT VALUE ENGINE
        </span>
        <h2 className="font-display font-black text-3xl md:text-4xl text-slate-950 tracking-tight leading-none">
          Simple pricing. Massive audit security.
        </h2>
        <p className="font-sans text-xs text-slate-500 max-w-md mx-auto mt-2">
          Verifiable geofenced attendance starting at $0 for up to 10 employees. Scale secure compliance rules in an afternoon.
        </p>
      </div>

      <div 
        ref={ref}
        className={`${className} flex flex-col md:flex-row gap-8 justify-end max-w-5xl ml-auto`}
      >
        {/* Card 1: Team (Dark) */}
        <div className="w-full md:w-[420px] bg-[#0B1E22] rounded-[40px] px-8 md:px-10 py-10 text-white border border-[#112d33] flex flex-col justify-between shadow-2xl relative overflow-hidden group">
          {/* Subtle spinning background 3D-like asset */}
          <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-gradient-to-tr from-emerald-500/10 to-[#8FE3C0]/10 blur-xl group-hover:scale-125 transition-transform duration-1000" />
          <div className="absolute top-6 right-6 opacity-10 group-hover:rotate-12 transition-transform duration-700">
            <Zap className="w-20 h-20 text-[#8FE3C0]" />
          </div>

          <div className="space-y-6 z-10">
            <div>
              <span className="font-mono text-[9px] text-[#8FE3C0] font-black tracking-widest uppercase">TEAM BUNDLE</span>
              <h3 className="text-[26px] font-display font-black text-[#F4FBFF] mt-1">Team</h3>
            </div>

            <div className="space-y-2 font-sans text-sm text-[#DDEDF0] leading-relaxed font-medium">
              <p>• Single-stage approvals workflow.</p>
              <p>• Up to 3 configurable break types.</p>
              <p>• Offline-first geofence log replication.</p>
            </div>

            <div className="pt-4 border-t border-white/10">
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-display font-black text-[#F4FBFF]">$4</span>
                <span className="text-sm font-sans text-[#9FB4BC]">/ employee / month</span>
              </div>
              <span className="text-[10px] font-mono text-[#8FE3C0] block mt-1 uppercase tracking-wider">BILLED MONTHLY</span>
            </div>
          </div>

          <div className="flex flex-col gap-3 mt-8 z-10">
            <a href="#interactive-demo-panel" className="w-full py-3 px-6 rounded-full bg-[#8FE3C0] hover:bg-[#a6ecce] text-[#081418] font-bold text-xs uppercase tracking-wider transition-all duration-200 cursor-pointer text-center shadow-lg">
              Start Free Trial
            </a>
            <a href="#interactive-demo-panel" className="w-full py-3 px-6 rounded-full bg-white/5 hover:bg-white/10 text-[#DDEDF0] font-bold text-xs uppercase tracking-wider transition-all duration-200 cursor-pointer text-center border border-white/10">
              See Pricing Details
            </a>
          </div>
        </div>

        {/* Card 2: Enterprise (Light) */}
        <div className="w-full md:w-[420px] bg-white rounded-[40px] px-8 md:px-10 py-10 text-slate-900 flex flex-col justify-between shadow-[0_16px_48px_rgba(0,0,0,0.06)] border border-slate-100 relative overflow-hidden group">
          {/* Subtle spinning background 3D-like asset */}
          <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-gradient-to-tr from-indigo-500/5 to-purple-500/5 blur-xl group-hover:scale-125 transition-transform duration-1000" />
          <div className="absolute top-6 right-6 opacity-5 group-hover:-rotate-12 transition-transform duration-700">
            <ShieldCheck className="w-20 h-20 text-indigo-600" />
          </div>

          <div className="space-y-6 z-10">
            <div>
              <span className="font-mono text-[9px] text-indigo-600 font-black tracking-widest uppercase">ENTERPRISE SCALE</span>
              <h3 className="text-[26px] font-display font-black text-slate-950 mt-1">Enterprise</h3>
            </div>

            <div className="space-y-2 font-sans text-sm text-slate-600 leading-relaxed font-medium">
              <p>• Dual-stage approvals & custom SLAs escalation.</p>
              <p>• Custom policy versioning & rollback ledger.</p>
              <p>• Dedicated account engineer & SSO integration.</p>
            </div>

            <div className="pt-4 border-t border-slate-100">
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-display font-black text-slate-950">Custom</span>
              </div>
              <span className="text-[10px] font-mono text-indigo-600 block mt-1 uppercase tracking-wider">TALK TO COMPLIANCE SALES</span>
            </div>
          </div>

          <div className="flex flex-col mt-8 z-10">
            <a href="#interactive-demo-panel" className="w-full py-3.5 px-6 rounded-full bg-slate-950 hover:bg-slate-850 text-white font-bold text-xs uppercase tracking-wider transition-all duration-200 cursor-pointer text-center shadow-lg">
              Book a Call
            </a>
          </div>
        </div>

      </div>
    </section>
  );
}
