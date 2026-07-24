/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion } from 'motion/react';
import { HelpCircle, Clock, MapPin, AlertTriangle, ShieldCheck } from 'lucide-react';

interface TimelineEvent {
  time: string;
  label: string;
  status: 'PRESENT' | 'BREAK' | 'GPS_DISABLED' | 'UNRECONCILED';
  desc: string;
  position: number; // percentage coordinate on timeline (0 to 100)
  width: number; // width percentage
}

export default function TimelineRibbon() {
  const [hoveredEvent, setHoveredEvent] = useState<TimelineEvent | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const events: TimelineEvent[] = [
    { time: '09:00 AM', label: 'Shift Checked-In', status: 'PRESENT', desc: 'Verified within HQ Tower geofence. Confidence: 98%.', position: 0, width: 20 },
    { time: '10:30 AM', label: 'Coffee Break (Declared)', status: 'BREAK', desc: 'Declared via Break Engine. Approved grace duration.', position: 20, width: 10 },
    { time: '11:15 AM', label: 'In-office Duty', status: 'PRESENT', desc: 'Coherent Geofence coordinates and active Wi-Fi MAC checks.', position: 30, width: 15 },
    { time: '12:00 PM', label: 'Lunch Break (Observed exit)', status: 'BREAK', desc: 'Out of Geofence bounds. Matches declared break ledger.', position: 45, width: 20 },
    { time: '02:00 PM', label: 'GPS Telemetry Lost', status: 'GPS_DISABLED', desc: 'Device location services toggled off. Anomaly recorded.', position: 65, width: 10 },
    { time: '02:45 PM', label: 'Unreconciled Absence Gap', status: 'UNRECONCILED', desc: 'Presence telemetry indicates outside boundary with no break requested.', position: 75, width: 15 },
    { time: '04:15 PM', label: 'Office Re-entry', status: 'PRESENT', desc: 'Re-acquired geofence connection. Status: Present.', position: 90, width: 10 }
  ];

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
  };

  const statusMeta = {
    PRESENT: { color: 'bg-[var(--color-nexus-success-text)] border-[var(--color-nexus-success-text)]', label: 'Geofence Present' },
    BREAK: { color: 'bg-[var(--color-nexus-warning)] border-[var(--color-nexus-warning)]', label: 'Declared Break' },
    GPS_DISABLED: { color: 'bg-[var(--color-nexus-muted)] border-[var(--color-nexus-muted)]', label: 'GPS Offline / Unknown' },
    UNRECONCILED: { color: 'bg-[var(--color-nexus-error)] border-[var(--color-nexus-error)]', label: 'Presence Discrepancy' }
  };

  return (
    <div className="bg-[var(--color-nexus-surface)]/80 border border-[var(--color-nexus-border)]/50 rounded-3xl p-6 shadow-lg max-w-4xl mx-auto backdrop-blur-md">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h4 className="font-sans font-bold text-sm tracking-tight text-[var(--color-nexus-ink)] uppercase flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-[var(--color-nexus-muted)]" />
            Presence Timeline Ribbon
          </h4>
          <span className="font-mono text-[9px] tracking-widest text-[var(--color-nexus-muted)] font-semibold uppercase block">
            12-Hour Continuous Telemetry Stream (09:00 AM - 05:00 PM)
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-nexus-success-text)]" />
            <span className="font-mono text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold">Present</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-nexus-warning)]" />
            <span className="font-mono text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold">Break</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-nexus-muted)]" />
            <span className="font-mono text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold">Offline</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-nexus-error)]" />
            <span className="font-mono text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold">Anomaly</span>
          </div>
        </div>
      </div>

      {/* Main timeline interactive ribbon track container */}
      <div
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredEvent(null)}
        className="relative h-12 w-full bg-[var(--color-nexus-surface-alt)] rounded-2xl border border-[var(--color-nexus-border)]/30 shadow-inner overflow-hidden cursor-crosshair flex"
      >
        {events.map((event, index) => (
          <div
            key={index}
            id={`timeline-event-seg-${index}`}
            onMouseEnter={() => setHoveredEvent(event)}
            className={`h-full border-r border-[var(--color-nexus-surface)]/20 transition-all duration-300 ${statusMeta[event.status].color}`}
            style={{ width: `${event.width}%` }}
          />
        ))}

        {/* Moving vertical timeline line scrubber */}
        {hoveredEvent && (
          <motion.div
            className="absolute top-0 bottom-0 w-[1.5px] bg-[var(--color-nexus-ink)]/80 shadow-[0_0_8px_#020617] pointer-events-none"
            style={{ left: mousePos.x }}
            animate={{ x: 0 }}
          />
        )}
      </div>

      {/* Ribbon Axis Tick Marks */}
      <div className="flex justify-between px-1.5 mt-2 text-[9px] font-mono text-[var(--color-nexus-muted)] font-semibold tracking-wider border-b border-[var(--color-nexus-border)] pb-2 mb-3">
        <span>09:00 AM</span>
        <span>11:00 AM</span>
        <span>01:00 PM</span>
        <span>03:00 PM</span>
        <span>05:00 PM</span>
      </div>

      {/* Scrubber Dynamic Hover Details card */}
      <div className="min-h-[56px] flex items-center justify-center">
        {hoveredEvent ? (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full flex items-start gap-3 p-3 rounded-xl bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)]/50"
          >
            {hoveredEvent.status === 'PRESENT' && <ShieldCheck className="w-4.5 h-4.5 text-[var(--color-nexus-success-text)] shrink-0 mt-0.5" />}
            {hoveredEvent.status === 'BREAK' && <Clock className="w-4.5 h-4.5 text-[var(--color-nexus-warning)] shrink-0 mt-0.5" />}
            {hoveredEvent.status === 'GPS_DISABLED' && <HelpCircle className="w-4.5 h-4.5 text-[var(--color-nexus-muted)] shrink-0 mt-0.5" />}
            {hoveredEvent.status === 'UNRECONCILED' && <AlertTriangle className="w-4.5 h-4.5 text-[var(--color-nexus-error)] shrink-0 mt-0.5" />}

            <div className="grid grid-cols-3 w-full gap-4 text-xs">
              <div className="col-span-1">
                <span className="block font-mono text-[9px] text-[var(--color-nexus-muted)] font-bold uppercase">TELEMETRY_TIMESTAMP</span>
                <span className="font-mono font-black text-[var(--color-nexus-ink)]">{hoveredEvent.time}</span>
              </div>
              <div className="col-span-1">
                <span className="block font-mono text-[9px] text-[var(--color-nexus-muted)] font-bold uppercase">STATUS_INTERPRETER</span>
                <span className="font-sans font-semibold text-[var(--color-nexus-ink)]">{hoveredEvent.label}</span>
              </div>
              <div className="col-span-1">
                <span className="block font-mono text-[9px] text-[var(--color-nexus-muted)] font-bold uppercase">ACTIVE_EVIDENCE</span>
                <span className="font-sans text-[var(--color-nexus-muted)] leading-tight block">{hoveredEvent.desc}</span>
              </div>
            </div>
          </motion.div>
        ) : (
          <p className="font-sans text-xs text-[var(--color-nexus-muted)] flex items-center gap-1.5 italic">
            <Clock className="w-3.5 h-3.5" />
            Hover or scrub over any segment of the ribbon to inspect exact presence logs.
          </p>
        )}
      </div>
    </div>
  );
}
