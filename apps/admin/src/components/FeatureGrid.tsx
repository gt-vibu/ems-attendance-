/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { 
  ShieldCheck, Coffee, Map, FileText, Settings, Key 
} from 'lucide-react';
import { useInViewAnimation } from '../hooks/useInViewAnimation';

interface FeatureItem {
  id: string;
  title: string;
  description: string;
  icon: any;
  color: string;
  bgColor: string;
}

const FEATURES: FeatureItem[] = [
  {
    id: 'attendance',
    title: 'Attendance Sessions',
    description: 'Check-in to check-out, with nowhere for a status to drift.',
    icon: ShieldCheck,
    color: '#4FD1A5',
    bgColor: 'bg-emerald-500/10'
  },
  {
    id: 'breaks',
    title: 'Breaks',
    description: 'Requested, approved, reconciled against real presence data.',
    icon: Coffee,
    color: '#3FA9C9',
    bgColor: 'bg-teal-500/10'
  },
  {
    id: 'presence',
    title: 'Presence',
    description: 'Geofence exits and GPS gaps tracked independently of user action.',
    icon: Map,
    color: '#E8843F',
    bgColor: 'bg-orange-500/10'
  },
  {
    id: 'corrections',
    title: 'Corrections',
    description: 'Every edit to a closed record is itself an auditable, approved change.',
    icon: FileText,
    color: '#9C8CE8',
    bgColor: 'bg-purple-500/10'
  },
  {
    id: 'policy',
    title: 'Policy versions',
    description: 'Exactly one active policy per tenant; past sessions never get rewritten.',
    icon: Settings,
    color: '#6B7A80',
    bgColor: 'bg-slate-500/10'
  },
  {
    id: 'approvals',
    title: 'Approvals',
    description: 'One reusable approval chain for corrections, device changes, and break requests.',
    icon: Key,
    color: '#2E7D5B',
    bgColor: 'bg-green-500/10'
  }
];

const FeatureCard: React.FC<{ feature: FeatureItem; index: number }> = ({ feature, index }) => {
  const { ref, className } = useInViewAnimation<HTMLDivElement>();
  const Icon = feature.icon;

  return (
    <div 
      ref={ref}
      style={{ animationDelay: `${index * 0.15}s` }}
      className={`${className} group bg-[#0B1E22]/65 backdrop-blur-md border border-[#143239] rounded-3xl p-6 md:p-8 hover:border-slate-400 transition-all duration-300 relative overflow-hidden`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/2 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      
      {/* Small looping 3D icon */}
      <div className={`w-12 h-12 rounded-2xl ${feature.bgColor} border border-white/5 flex items-center justify-center mb-6 animate-bounce-slow`}>
        <Icon className="w-5 h-5" style={{ color: feature.color }} />
      </div>

      <h4 className="font-display font-black text-lg text-white mb-2 uppercase tracking-tight">
        {feature.title}
      </h4>

      <p className="font-sans text-xs text-[#9FB4BC] leading-relaxed font-medium">
        {feature.description}
      </p>
    </div>
  );
};

export default function FeatureGrid() {
  return (
    <section id="features" className="py-20 px-6 max-w-7xl mx-auto overflow-hidden">
      <div className="text-center mb-16">
        <span className="font-mono text-xs text-[#8FE3C0] font-black tracking-widest block mb-2 uppercase">
          PERIMETER CORE ENGINE
        </span>
        <h2 className="font-display font-black text-3xl md:text-5xl text-white tracking-tight leading-none">
          Six machines, one source of truth
        </h2>
        <p className="font-sans text-xs text-[#9FB4BC] max-w-md mx-auto mt-2 leading-relaxed">
          Forget vulnerable database rows. Perimeter governs user presence and timeline states with isolated state machines that never leak.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
        {FEATURES.map((feat, idx) => (
          <FeatureCard key={feat.id} feature={feat} index={idx} />
        ))}
      </div>
    </section>
  );
}
