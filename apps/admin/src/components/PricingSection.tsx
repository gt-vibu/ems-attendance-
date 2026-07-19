/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion } from 'motion/react';
import { ShieldCheck, Zap } from 'lucide-react';

export default function PricingSection() {
  return (
    <section className="py-24 md:py-36 px-6 max-w-7xl mx-auto overflow-hidden">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-10% 0px' }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="text-center mb-16"
      >
        <span className="text-xs text-[var(--color-premium-accent)] font-bold uppercase tracking-widest block mb-2">
          Simple, transparent pricing
        </span>
        <h2 className="font-display font-semibold text-3xl md:text-4xl text-[var(--color-premium-ink)] tracking-tight leading-[1.1]">
          Pay for headcount, not for peace of mind
        </h2>
        <p className="font-sans text-sm text-[var(--color-premium-muted)] max-w-md mx-auto mt-3">
          Verifiable geofenced attendance starting free for up to 10 employees. Scale compliance rules in an afternoon.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 28 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-10% 0px' }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col md:flex-row gap-8 justify-end max-w-5xl ml-auto"
      >
        {/* Card 1: Team — dark accent card for contrast */}
        <div className="card-3d w-full md:w-[420px] bg-[var(--color-premium-ink)] rounded-[32px] px-8 md:px-10 py-10 text-white flex flex-col justify-between relative overflow-hidden" style={{ boxShadow: 'var(--shadow-elevation-2)' }}>
          <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-[#0F6E5B]/20 blur-2xl" />
          <div className="absolute top-6 right-6 opacity-10">
            <Zap className="w-20 h-20" />
          </div>

          <div className="space-y-6 z-10">
            <div>
              <span className="text-[10px] text-[#5FBFA0] font-bold tracking-widest uppercase">Team</span>
              <h3 className="text-[26px] font-display font-semibold text-white mt-1">Team</h3>
            </div>

            <div className="space-y-2 font-sans text-sm text-white/80 leading-relaxed font-medium">
              <p>Single-stage approvals workflow.</p>
              <p>Up to 3 configurable break types.</p>
              <p>Offline-first geofence log replication.</p>
            </div>

            <div className="pt-4 border-t border-white/10">
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-display font-semibold text-white">$4</span>
                <span className="text-sm font-sans text-white/60">/ employee / month</span>
              </div>
              <span className="text-[11px] text-white/50 block mt-1 font-medium">Billed monthly</span>
            </div>
          </div>

          <div className="flex flex-col gap-3 mt-8 z-10">
            <a href="#interactive-demo-panel" className="w-full py-3 px-6 rounded-full bg-[#5FBFA0] hover:bg-[#78CDB2] text-[var(--color-premium-ink)] font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer text-center shadow-lg">
              Start Free Trial
            </a>
            <a href="#interactive-demo-panel" className="w-full py-3 px-6 rounded-full bg-white/10 hover:bg-white/15 text-white font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer text-center border border-white/10">
              See Pricing Details
            </a>
          </div>
        </div>

        {/* Card 2: Enterprise — light card */}
        <div className="card-3d w-full md:w-[420px] glass-card rounded-[32px] px-8 md:px-10 py-10 text-[var(--color-premium-ink)] flex flex-col justify-between relative overflow-hidden">
          <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-[var(--color-premium-accent-2)]/10 blur-2xl" />
          <div className="absolute top-6 right-6 opacity-[0.06]">
            <ShieldCheck className="w-20 h-20 text-[var(--color-premium-accent-2)]" />
          </div>

          <div className="space-y-6 z-10">
            <div>
              <span className="text-[10px] text-[var(--color-premium-accent-2)] font-bold tracking-widest uppercase">Enterprise</span>
              <h3 className="text-[26px] font-display font-semibold text-[var(--color-premium-ink)] mt-1">Enterprise</h3>
            </div>

            <div className="space-y-2 font-sans text-sm text-[var(--color-premium-muted)] leading-relaxed font-medium">
              <p>Dual-stage approvals and custom SLA escalation.</p>
              <p>Custom policy versioning and rollback ledger.</p>
              <p>Dedicated account engineer and SSO integration.</p>
            </div>

            <div className="pt-4 border-t border-[var(--color-premium-border)]">
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-display font-semibold text-[var(--color-premium-ink)]">Custom</span>
              </div>
              <span className="text-[11px] text-[var(--color-premium-muted)] block mt-1 font-medium">Talk to our compliance team</span>
            </div>
          </div>

          <div className="flex flex-col mt-8 z-10">
            <a href="#interactive-demo-panel" className="w-full py-3.5 px-6 rounded-full bg-[var(--color-premium-ink)] hover:opacity-90 text-white font-bold text-xs uppercase tracking-wider transition-opacity cursor-pointer text-center shadow-lg">
              Book a Call
            </a>
          </div>
        </div>

      </motion.div>
    </section>
  );
}
