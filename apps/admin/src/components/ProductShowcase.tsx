/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CheckCircle2, Coffee, LogIn, LogOut, ShieldCheck } from 'lucide-react';

// Static, styled-DOM product mockups — same honest technique as
// HeroPreview.tsx (real Smart Teams branding/copy, no fabricated
// screenshots, no third-party branding copied from reference material).
// Three real surfaces: the attendance timeline, the payroll breakdown, and
// the face/device verification step.

const TIMELINE_EVENTS = [
  { time: '9:02 AM', label: 'Checked In', icon: LogIn, color: 'var(--color-premium-success)' },
  { time: '12:30 PM', label: 'Break Started', icon: Coffee, color: 'var(--color-premium-info)' },
  { time: '1:14 PM', label: 'Break Ended', icon: Coffee, color: 'var(--color-premium-info)' },
  { time: '6:01 PM', label: 'Checked Out', icon: LogOut, color: 'var(--color-premium-accent-2)' },
];

function TimelineCard() {
  return (
    <div className="glass-card rounded-3xl p-6 h-full">
      <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-premium-accent)]">Attendance Timeline</span>
      <h4 className="mt-1 font-display font-semibold text-lg text-[var(--color-premium-ink)]">A day, event by event</h4>
      <div className="mt-5 space-y-4">
        {TIMELINE_EVENTS.map((event, idx) => (
          <div key={event.label} className="flex items-center gap-3">
            <div className="flex flex-col items-center">
              <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ color: event.color, backgroundColor: `color-mix(in srgb, ${event.color} 18%, transparent)` }}>
                <event.icon size={14} />
              </span>
              {idx < TIMELINE_EVENTS.length - 1 && <span className="w-px h-4 bg-[var(--color-premium-border)] mt-1" />}
            </div>
            <div>
              <p className="text-xs font-bold text-[var(--color-premium-ink)]">{event.label}</p>
              <p className="text-[11px] text-[var(--color-premium-muted)]">{event.time}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PayrollCard() {
  // CSS conic-gradient donut — Basic/HRA/PF/Net split, illustrative
  // proportions matching the app's own payroll wizard categories.
  const segments = [
    { label: 'Basic', percent: 50, color: 'var(--color-premium-accent)' },
    { label: 'HRA', percent: 20, color: 'var(--color-premium-accent-2)' },
    { label: 'PF & Tax', percent: 12, color: 'var(--color-premium-warning)' },
    { label: 'Allowances', percent: 18, color: 'var(--color-premium-success)' },
  ];
  let cursor = 0;
  const gradientStops = segments.map((s) => {
    const start = cursor;
    cursor += s.percent;
    return `${s.color} ${start}% ${cursor}%`;
  }).join(', ');

  return (
    <div className="glass-card rounded-3xl p-6 h-full">
      <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-premium-accent)]">Payroll Breakdown</span>
      <h4 className="mt-1 font-display font-semibold text-lg text-[var(--color-premium-ink)]">Every component, itemized</h4>
      <div className="mt-5 flex items-center gap-5">
        <div
          className="w-24 h-24 rounded-full shrink-0"
          style={{ background: `conic-gradient(${gradientStops})` }}
        >
          <div className="w-[62%] h-[62%] rounded-full bg-[var(--color-premium-surface)] m-[19%] flex items-center justify-center">
            <span className="text-[9px] font-bold text-[var(--color-premium-muted)] uppercase tracking-wide">CTC</span>
          </div>
        </div>
        <div className="space-y-1.5">
          {segments.map((s) => (
            <div key={s.label} className="flex items-center gap-2 text-[11px]">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="text-[var(--color-premium-muted)] font-medium">{s.label}</span>
              <span className="text-[var(--color-premium-ink)] font-bold">{s.percent}%</span>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-4 text-[11px] text-[var(--color-premium-muted)] leading-relaxed">HRA and PF are optional per company — configure the split that matches how your organization actually runs payroll.</p>
    </div>
  );
}

function VerificationCard() {
  return (
    <div className="glass-card rounded-3xl p-6 h-full flex flex-col">
      <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-premium-accent)]">Identity Verification</span>
      <h4 className="mt-1 font-display font-semibold text-lg text-[var(--color-premium-ink)]">Face, device, and location, together</h4>
      <div className="mt-5 flex-1 flex flex-col items-center justify-center gap-4">
        <div className="relative w-24 h-24 rounded-full border-2 border-dashed border-[var(--color-premium-accent)]/40 flex items-center justify-center">
          <div className="w-16 h-16 rounded-full bg-[var(--color-premium-accent-soft)] flex items-center justify-center text-[var(--color-premium-accent)]">
            <ShieldCheck size={26} />
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[var(--color-premium-success)] text-xs font-bold">
          <CheckCircle2 size={14} />
          Verified match
        </div>
      </div>
      <p className="mt-2 text-[11px] text-[var(--color-premium-muted)] text-center leading-relaxed">Every check-in independently confirms face liveness, registered device, and geofence — before it's ever recorded as present.</p>
    </div>
  );
}

export default function ProductShowcase() {
  return (
    <div className="max-w-6xl mx-auto px-6">
      <div className="text-center mb-6">
        <span className="text-xs font-bold uppercase tracking-widest text-[var(--color-premium-accent)]">Inside the platform</span>
        <h2 className="mt-2 font-display font-semibold text-2xl md:text-4xl text-[var(--color-premium-ink)] tracking-tight leading-[1.1]">
          Real surfaces, not slideware
        </h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <TimelineCard />
        <VerificationCard />
        <PayrollCard />
      </div>
    </div>
  );
}
