/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion, animate } from 'motion/react';
import { Layers, ShieldCheck, ScrollText, Settings2 } from 'lucide-react';

// Honest, product-capability numbers only — this is an early-stage product
// without public customer/usage data, so no social-proof/customer-count
// stats belong here. Every number below is a real, structural fact about
// what the platform actually does (verification layers, state count,
// configurable policies, audit coverage), not a measured performance
// benchmark or a fabricated adoption metric.
interface Stat {
  value: number;
  suffix?: string;
  label: string;
  icon: any;
}

const STATS: Stat[] = [
  { value: 9, label: 'Versioned attendance states — every transition is explicit, never a status field quietly edited.', icon: Layers },
  { value: 5, label: 'Independent checks per check-in: face & liveness, GPS geofence, Wi-Fi lock, device pinning, clock-drift detection.', icon: ShieldCheck },
  { value: 100, suffix: '%', label: 'Of state changes captured in the immutable audit ledger — nothing happens off the record.', icon: ScrollText },
  { value: 3, label: 'Configurable working-hours policies (Fixed Shift End, Complete Required Hours, Hybrid) to match how your teams actually work.', icon: Settings2 },
];

function CountUpNumber({ value, suffix }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-10% 0px' });
  const prefersReducedMotion = useReducedMotion();
  const [display, setDisplay] = useState(prefersReducedMotion ? value : 0);

  useEffect(() => {
    if (!isInView) return;
    if (prefersReducedMotion) {
      setDisplay(value);
      return;
    }
    const controls = animate(0, value, {
      duration: 1.4,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [isInView, value, prefersReducedMotion]);

  return (
    <span ref={ref} className="font-display font-black text-3xl md:text-4xl tracking-tight text-[var(--color-premium-ink)] tabular-nums">
      {display}
      {suffix}
    </span>
  );
}

export default function BenefitsStats() {
  return (
    <div className="max-w-6xl mx-auto px-6 text-center">
      <span className="text-xs font-bold uppercase tracking-widest text-[var(--color-premium-accent)]">Built to hold up under scrutiny</span>
      <h2 className="mt-2 font-display font-semibold text-2xl md:text-4xl text-[var(--color-premium-ink)] tracking-tight leading-[1.1]">
        Not vanity metrics — <span className="text-gradient">structural guarantees</span>
      </h2>

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {STATS.map((stat, idx) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-10% 0px' }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: idx * 0.08 }}
            className="glass-card rounded-xl p-6 flex flex-col items-center text-center gap-3"
          >
            <span className="w-10 h-10 rounded-xl bg-[var(--color-premium-accent-soft)] text-[var(--color-premium-accent)] flex items-center justify-center">
              <stat.icon size={18} />
            </span>
            <CountUpNumber value={stat.value} suffix={stat.suffix} />
            <p className="text-xs text-[var(--color-premium-muted)] leading-relaxed font-medium">{stat.label}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
