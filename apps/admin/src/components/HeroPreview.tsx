/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ShieldCheck, MapPin, Users, TrendingUp } from 'lucide-react';

// Static hero visual for the landing page — a real (non-3D, non-animated)
// preview of the Smart Teams dashboard, replacing the previous abstract
// rotating-glass-cards 3D scene. The client asked for the landing page to
// be static and to "display something related to the website" instead of
// an animation, so this shows actual product surfaces (attendance rate,
// live check-in status, staff count) with real Smart Teams branding rather
// than a generic mockup.
const LIVE_CHECKINS = [
  { name: 'Priya Nair', role: 'Field Technician', status: 'Active', color: '#16A34A' },
  { name: 'Arjun Mehta', role: 'Site Supervisor', status: 'On Break', color: '#2563EB' },
  { name: 'Kavya Rao', role: 'Delivery Lead', status: 'Verifying', color: '#D97706' },
];

export default function HeroPreview() {
  return (
    <div className="w-full max-w-md mx-auto select-none">
      <div className="bg-[var(--color-premium-surface)] border border-[var(--color-premium-border)] rounded-[20px] shadow-[var(--shadow-elevation-2)] overflow-hidden">
        {/* Window chrome */}
        <div className="flex items-center gap-1.5 px-4 py-3 border-b border-[var(--color-premium-border)]">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-premium-border)]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-premium-border)]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-premium-border)]" />
          <span className="ml-3 text-[11px] font-semibold text-[var(--color-premium-muted)]">Smart Teams — Live Overview</span>
        </div>

        <div className="p-5 space-y-4">
          {/* Stat tiles */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-[var(--color-premium-border)] p-3.5">
              <div className="flex items-center gap-1.5 text-[var(--color-premium-muted)]">
                <Users size={14} />
                <span className="text-[10px] font-bold uppercase tracking-wider">Active Now</span>
              </div>
              <p className="mt-1.5 text-2xl font-display font-bold text-[var(--color-premium-ink)]">128</p>
            </div>
            <div className="rounded-2xl border border-[var(--color-premium-border)] p-3.5">
              <div className="flex items-center gap-1.5 text-[var(--color-premium-muted)]">
                <TrendingUp size={14} />
                <span className="text-[10px] font-bold uppercase tracking-wider">Attendance</span>
              </div>
              <p className="mt-1.5 text-2xl font-display font-bold text-[var(--color-premium-ink)]">97.2%</p>
            </div>
          </div>

          {/* Live check-in list */}
          <div className="rounded-2xl border border-[var(--color-premium-border)] p-3.5 space-y-2.5">
            <div className="flex items-center gap-1.5 text-[var(--color-premium-muted)]">
              <ShieldCheck size={14} />
              <span className="text-[10px] font-bold uppercase tracking-wider">Verified Check-Ins</span>
            </div>
            {LIVE_CHECKINS.map((person) => (
              <div key={person.name} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-[var(--color-premium-ink)]">{person.name}</p>
                  <p className="text-[11px] text-[var(--color-premium-muted)]">{person.role}</p>
                </div>
                <span
                  className="text-[10px] font-bold px-2.5 py-1 rounded-full"
                  style={{ color: person.color, backgroundColor: `${person.color}18` }}
                >
                  {person.status}
                </span>
              </div>
            ))}
          </div>

          {/* Geofence chip */}
          <div className="flex items-center gap-2 text-[11px] font-semibold text-[var(--color-premium-muted)]">
            <MapPin size={13} className="text-[var(--color-premium-accent)]" />
            All check-ins matched to registered site geofence
          </div>
        </div>
      </div>
    </div>
  );
}
