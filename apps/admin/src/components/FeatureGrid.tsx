/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion } from 'motion/react';
import {
  ShieldCheck, Coffee, Map, FileText, Settings, Key
} from 'lucide-react';

interface FeatureItem {
  id: string;
  title: string;
  description: string;
  icon: any;
  color: string;
}

const FEATURES: FeatureItem[] = [
  {
    id: 'attendance',
    title: 'Attendance Sessions',
    description: 'Check-in to check-out, with nowhere for a status to drift.',
    icon: ShieldCheck,
    color: '#0F6E5B',
  },
  {
    id: 'breaks',
    title: 'Breaks',
    description: 'Requested, approved, reconciled against real presence data.',
    icon: Coffee,
    color: '#2E6F8E',
  },
  {
    id: 'presence',
    title: 'Presence',
    description: 'Geofence exits and GPS gaps tracked independently of user action.',
    icon: Map,
    color: '#B8873A',
  },
  {
    id: 'corrections',
    title: 'Corrections',
    description: 'Every edit to a closed record is itself an auditable, approved change.',
    icon: FileText,
    color: '#7C6FB0',
  },
  {
    id: 'policy',
    title: 'Policy Versions',
    description: 'Exactly one active policy per tenant; past sessions never get rewritten.',
    icon: Settings,
    color: '#5B6B63',
  },
  {
    id: 'approvals',
    title: 'Approvals',
    description: 'One reusable approval chain for corrections, device changes, and break requests.',
    icon: Key,
    color: '#14805F',
  }
];

function FeatureCard({ feature, index }: { feature: FeatureItem; index: number }) {
  const Icon = feature.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: index * 0.08 }}
      className="card-3d glass-card rounded-3xl p-6 md:p-8"
    >
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center mb-6"
        style={{ backgroundColor: `${feature.color}16` }}
      >
        <Icon className="w-5 h-5" style={{ color: feature.color }} />
      </div>

      <h4 className="font-display font-semibold text-lg text-[var(--color-premium-ink)] mb-2">
        {feature.title}
      </h4>

      <p className="font-sans text-sm text-[var(--color-premium-muted)] leading-relaxed font-medium">
        {feature.description}
      </p>
    </motion.div>
  );
}

export default function FeatureGrid() {
  return (
    <section className="py-24 md:py-36 px-6 max-w-7xl mx-auto overflow-hidden">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-10% 0px' }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="text-center mb-16"
      >
        <span className="text-xs text-[var(--color-premium-accent)] font-bold tracking-widest block mb-2 uppercase">
          Built for real accountability
        </span>
        <h2 className="font-display font-semibold text-3xl md:text-5xl text-[var(--color-premium-ink)] tracking-tight leading-[1.1]">
          Six systems, one source of truth
        </h2>
        <p className="font-sans text-sm text-[var(--color-premium-muted)] max-w-md mx-auto mt-3 leading-relaxed">
          Every state — attendance, breaks, presence, corrections, policy, approvals — is tracked independently, so nothing can quietly drift.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
        {FEATURES.map((feat, idx) => (
          <FeatureCard key={feat.id} feature={feat} index={idx} />
        ))}
      </div>
    </section>
  );
}
