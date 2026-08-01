/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion } from 'motion/react';
import {
  ShieldCheck, ScanFace, Wifi, QrCode, Home, CalendarDays, Wallet, KeyRound, FileCheck2
} from 'lucide-react';

interface FeatureItem {
  id: string;
  title: string;
  description: string;
  icon: any;
  color: string;
}

// Every card below is a real, shipped module (confirmed against the app's
// own routes), not aspirational copy — deliberately covering the modules
// that had zero presence in the landing page's marketing copy before this
// pass: face/device verification, Wi-Fi lock, QR attendance, WFH, leave,
// payroll, and roles/RBAC, alongside the attendance/approvals story that
// was already here.
const FEATURES: FeatureItem[] = [
  {
    id: 'attendance',
    title: 'Attendance Sessions',
    description: 'Check-in to check-out, with breaks reconciled against real presence data — nowhere for a status to drift.',
    icon: ShieldCheck,
    color: '#2563EB',
  },
  {
    id: 'face',
    title: 'Face & Device Verification',
    description: 'A liveness-checked face match, pinned to the employee’s registered device — not a self-reported check-in.',
    icon: ScanFace,
    color: '#8B5CF6',
  },
  {
    id: 'geofence',
    title: 'Geofencing & Wi-Fi Lock',
    description: 'GPS geofence and corporate Wi-Fi checks run independently of user action, per branch.',
    icon: Wifi,
    color: '#22C55E',
  },
  {
    id: 'qr',
    title: 'QR Attendance',
    description: 'A privileged team member displays a rotating code; anyone scans it with their own device to check in.',
    icon: QrCode,
    color: '#8B5CF6',
  },
  {
    id: 'wfh',
    title: 'Work From Home',
    description: 'Home-location-verified remote check-ins, fully optional and policy-gated per tenant.',
    icon: Home,
    color: '#22C55E',
  },
  {
    id: 'leave',
    title: 'Leave Management',
    description: 'Policies, balances, approvals, and encashment in one ledger — no spreadsheet reconciliation.',
    icon: CalendarDays,
    color: '#F59E0B',
  },
  {
    id: 'payroll',
    title: 'Payroll & Statutory',
    description: 'Basic, HRA, and PF configured the way your company actually runs — not a fixed template everyone gets whether it applies or not.',
    icon: Wallet,
    color: '#2563EB',
  },
  {
    id: 'rbac',
    title: 'Roles & Permissions',
    description: 'Every capability is a delegable privilege, not a hardcoded role — grant exactly what each person needs.',
    icon: KeyRound,
    color: '#8B5CF6',
  },
  {
    id: 'corrections',
    title: 'Corrections & Approvals',
    description: 'Every edit to a closed record is itself an auditable, approved change — never a quiet database override.',
    icon: FileCheck2,
    color: '#22C55E',
  },
];

function FeatureCard({ feature, index }: { feature: FeatureItem; index: number }) {
  const Icon = feature.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: index * 0.08 }}
      className="card-3d glass-card rounded-xl p-4 md:p-5"
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center mb-3"
        style={{ backgroundColor: `${feature.color}16` }}
      >
        <Icon className="w-4 h-4" style={{ color: feature.color }} />
      </div>

      <h4 className="font-display font-semibold text-sm text-[var(--color-premium-ink)] mb-1.5">
        {feature.title}
      </h4>

      <p className="font-sans text-[11px] text-[var(--color-premium-muted)] leading-relaxed font-medium">
        {feature.description}
      </p>
    </motion.div>
  );
}

export default function FeatureGrid() {
  return (
    <section className="py-6 px-6 max-w-6xl mx-auto overflow-hidden">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-10% 0px' }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="text-center mb-6"
      >
        <span className="text-xs text-[var(--color-premium-accent)] font-bold tracking-widest block mb-2 uppercase">
          Built for real accountability
        </span>
        <h2 className="font-display font-semibold text-2xl md:text-4xl text-[var(--color-premium-ink)] tracking-tight leading-[1.1]">
          Nine systems, one source of truth
        </h2>
        <p className="font-sans text-xs text-[var(--color-premium-muted)] max-w-lg mx-auto mt-2 leading-relaxed">
          Attendance, identity, geofencing, WFH, leave, payroll, and permissions — every module is tracked independently, so nothing can quietly drift.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
        {FEATURES.map((feat, idx) => (
          <FeatureCard key={feat.id} feature={feat} index={idx} />
        ))}
      </div>
    </section>
  );
}
