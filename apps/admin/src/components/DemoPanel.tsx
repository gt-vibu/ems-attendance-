/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { 
  Play, RefreshCw, AlertTriangle, Coffee, MapPin, Check, 
  Settings, ShieldAlert, ArrowRight, CheckCircle, Smartphone 
} from 'lucide-react';
import { attendanceEngine, LogEvent, CorrectionState } from '../state/attendanceMachine';
import { SessionStatus, BreakStatus, PresenceStatus } from '../types';
import { useLiveTheme } from '../hooks/useLiveTheme';
import EventLog from './EventLog';

function DemoBadge({ state, correctionState, presenceState }: { state: SessionStatus; correctionState: CorrectionState; presenceState: PresenceStatus }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((r3fState) => {
    const t = r3fState.clock.getElapsedTime();
    if (!meshRef.current) return;

    // Fast rotation when verifying
    if (state === SessionStatus.PENDING_VERIFICATION) {
      meshRef.current.rotation.y = t * 6.5;
      meshRef.current.rotation.x = t * 2.5;
      const pulse = 1.0 + Math.sin(t * 15) * 0.12;
      meshRef.current.scale.set(pulse, pulse, pulse);
    } else if (state === SessionStatus.ACTIVE) {
      // Normal gentle drift rotation
      meshRef.current.rotation.y = t * 0.8;
      meshRef.current.rotation.x = Math.sin(t * 0.4) * 0.4;
      meshRef.current.scale.set(1, 1, 1);
    } else if (state === SessionStatus.ON_BREAK) {
      // slow orbit-bobbing
      meshRef.current.rotation.y = t * 0.4;
      meshRef.current.position.y = Math.sin(t * 1.5) * 0.15;
      meshRef.current.scale.set(0.85, 0.85, 0.85);
    } else if (state === SessionStatus.NEEDS_REVIEW) {
      // Shaking wobble rotation
      meshRef.current.rotation.y = t * 1.8;
      meshRef.current.position.x = Math.sin(t * 22) * 0.04;
      meshRef.current.scale.set(1.05, 1.05, 1.05);
    } else {
      meshRef.current.rotation.y = t * 0.5;
      meshRef.current.position.set(0, 0, 0);
      meshRef.current.scale.set(0.9, 0.9, 0.9);
    }
  });

  // State colors corresponding to the Ledger palette
  let badgeColor = '#8A9089'; // NOT_STARTED
  if (state === SessionStatus.PENDING_VERIFICATION) badgeColor = '#B8873A';
  else if (state === SessionStatus.ACTIVE) badgeColor = '#0F6E5B';
  else if (state === SessionStatus.ON_BREAK) badgeColor = '#2E6F8E';
  else if (state === SessionStatus.NEEDS_REVIEW) badgeColor = '#B8873A';
  else if (state === SessionStatus.CLOSED) badgeColor = '#14805F';
  else if (state === SessionStatus.REJECTED) badgeColor = '#B3432B';
  else if (state === SessionStatus.ABSENT) badgeColor = '#8A9089';

  return (
    <mesh ref={meshRef}>
      {state === SessionStatus.CLOSED ? (
        <torusGeometry args={[0.7, 0.2, 16, 100]} />
      ) : state === SessionStatus.ON_BREAK ? (
        <cylinderGeometry args={[0.5, 0.5, 0.8, 16]} />
      ) : (
        <octahedronGeometry args={[0.8, 0]} />
      )}
      <meshStandardMaterial 
        color={badgeColor} 
        roughness={0.15} 
        metalness={0.8}
        emissive={badgeColor}
        emissiveIntensity={0.35}
      />
    </mesh>
  );
}

export default function DemoPanel() {
  const theme = useLiveTheme();

  // Local state mirrored from atomic store engine
  const [session, setSession] = useState<SessionStatus>(SessionStatus.NOT_STARTED);
  const [breaks, setBreaks] = useState<BreakStatus>(BreakStatus.IDLE);
  const [presence, setPresence] = useState<PresenceStatus>(PresenceStatus.INSIDE_OFFICE);
  const [correction, setCorrection] = useState<CorrectionState>('NONE');
  const [lowConfidence, setLowConfidence] = useState(false);
  const [logs, setLogs] = useState<LogEvent[]>([]);

  // Toast and correction animated coordinates states
  const [activeToast, setActiveToast] = useState<string | null>(null);

  useEffect(() => {
    const unsub = attendanceEngine.subscribe(() => {
      setSession(attendanceEngine.sessionState);
      setBreaks(attendanceEngine.breakState);
      setPresence(attendanceEngine.presenceState);
      setCorrection(attendanceEngine.correctionState);
      setLogs(attendanceEngine.logs);

      // Trigger standard notifications or toast banners
      const latestLog = attendanceEngine.logs[0];
      if (latestLog && latestLog.name.includes('anomaly')) {
        setActiveToast(latestLog.message);
        setTimeout(() => setActiveToast(null), 4500);
      }
    });

    // Seed initial engine sync
    attendanceEngine.subscribe(() => {})();

    return unsub;
  }, []);

  const handleCheckIn = () => {
    attendanceEngine.lowConfidenceToggle = lowConfidence;
    attendanceEngine.checkIn();
  };

  const handleBreak = () => {
    if (session === SessionStatus.ACTIVE) {
      attendanceEngine.startBreak();
    } else {
      attendanceEngine.endBreak();
    }
  };

  const handleGeofenceToggle = () => {
    const isInside = presence === PresenceStatus.INSIDE_OFFICE;
    attendanceEngine.toggleGeofence(isInside);
  };

  const handleCheckOut = () => {
    attendanceEngine.checkOut();
  };

  const handleStartCorrection = () => {
    attendanceEngine.startCorrection();
  };

  const handleManagerDecision = (approve: boolean) => {
    attendanceEngine.approveManager(approve);
  };

  const handleHRAudit = () => {
    attendanceEngine.approveHR();
  };

  const handleReset = () => {
    attendanceEngine.reset();
  };

  // State palette map
  const stateColorMap: Record<string, string> = {
    NOT_STARTED: '#8A9089',
    PENDING_VERIFICATION: '#B8873A',
    ACTIVE: '#0F6E5B',
    ON_BREAK: '#2E6F8E',
    NEEDS_REVIEW: '#B8873A',
    PENDING_APPROVAL: '#7C6FB0',
    CLOSED: '#14805F',
    REJECTED: '#B3432B',
    ABSENT: '#8A9089'
  };

  const SESSION_LABELS: Record<string, string> = {
    NOT_STARTED: 'Not started', PENDING_VERIFICATION: 'Verifying', ACTIVE: 'Active',
    ON_BREAK: 'On break', NEEDS_REVIEW: 'Needs review', CLOSED: 'Closed',
    REJECTED: 'Rejected', ABSENT: 'Absent',
  };

  return (
    <div id="interactive-demo-panel" className="scroll-mt-28 py-12 px-4 max-w-4xl mx-auto select-none space-y-8 animate-fade-in">
      <div className="text-center">
        <span className="inline-block px-4 py-1.5 rounded-full bg-[var(--color-premium-ink)] text-[#5FBFA0] text-xs font-bold uppercase tracking-wider">
          Shift Simulator
        </span>
      </div>

      <div className="glass-card rounded-[32px] p-6 md:p-10 relative overflow-hidden flex flex-col items-stretch" style={{ boxShadow: 'var(--shadow-elevation-2)' }}>

        {/* Toast Warning Anomaly overlay banner */}
        {activeToast && (
          <div className="absolute top-4 left-4 right-4 bg-[var(--color-premium-warning)] text-white rounded-2xl py-3 px-5 shadow-xl flex items-center gap-3 z-50">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div className="text-xs font-sans">
              <span className="font-bold block uppercase tracking-wider text-[10px] text-white/80">Anomaly flagged</span>
              {activeToast}
            </div>
          </div>
        )}

        {/* Column layout: Top 3D Badge Canvas */}
        <div className="grid md:grid-cols-12 gap-8 items-center border-b border-[var(--color-premium-border)] pb-8 mb-8">

          <div className="md:col-span-4 flex flex-col items-center justify-center">
            <div className="relative w-40 h-40 bg-[var(--color-premium-ink)] rounded-full shadow-inner flex items-center justify-center overflow-hidden">
              <div className="absolute inset-0 bg-radial-[circle_at_center,transparent_30%,rgba(0,0,0,0.6)_100%]" />

              <Canvas camera={{ position: [0, 0, 2.5] }} style={{ pointerEvents: 'none' }}>
                <ambientLight intensity={1.5} />
                <directionalLight position={[2, 3, 2]} intensity={2.0} />
                <DemoBadge state={session} correctionState={correction} presenceState={presence} />
              </Canvas>

              {/* Small live colored chip overlay */}
              <div
                style={{ backgroundColor: stateColorMap[session] }}
                className="absolute bottom-2 px-2.5 py-0.5 rounded-full text-[9px] text-white tracking-wide font-bold uppercase border border-white/20 shadow-md"
              >
                {SESSION_LABELS[session] || session}
              </div>
            </div>
          </div>

          <div className="md:col-span-8 space-y-4">
            <div>
              <span className="text-[11px] tracking-wide text-[var(--color-premium-accent)] font-bold uppercase block mb-1">
                Interactive demo
              </span>
              <h3 className="font-display font-semibold text-2xl text-[var(--color-premium-ink)] tracking-tight leading-tight">
                Run a shift simulation
              </h3>
              <p className="font-sans text-sm text-[var(--color-premium-muted)] max-w-lg leading-relaxed mt-1">
                Interact with the real-time attendance state machines. Toggle geofences, trigger breaks, and review correction requests as Manager or HR.
              </p>
            </div>

            {/* Simulated environment switches */}
            <div className="flex flex-wrap gap-4 items-center pt-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input 
                  type="checkbox" 
                  checked={lowConfidence}
                  onChange={(e) => setLowConfidence(e.target.checked)}
                  className="rounded text-orange-500 focus:ring-orange-500 w-3.5 h-3.5"
                />
                <span className="font-sans text-xs font-semibold text-[var(--color-premium-muted)] flex items-center gap-1">
                  <Smartphone className="w-3.5 h-3.5 text-[var(--color-premium-muted)]" />
                  Simulate low confidence check-in (62%)
                </span>
              </label>

              <button
                onClick={handleGeofenceToggle}
                disabled={session === SessionStatus.NOT_STARTED || session === SessionStatus.CLOSED}
                className={`px-3 py-1.5 rounded-full text-[11px] font-bold tracking-wide uppercase transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border ${
                  presence === PresenceStatus.OUTSIDE_OFFICE
                    ? 'bg-[var(--color-premium-danger-soft)] border-[var(--color-premium-danger)]/20 text-[var(--color-premium-danger)]'
                    : 'bg-[var(--color-premium-success-soft)] border-[var(--color-premium-success)]/20 text-[var(--color-premium-success)]'
                }`}
              >
                <MapPin className="w-3.5 h-3.5" />
                Presence: {presence === PresenceStatus.INSIDE_OFFICE ? 'Inside Office' : 'Outside Geofence'}
              </button>
            </div>
          </div>

        </div>

        {/* Primary State Machine Controls */}
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4 mb-8">

          {/* Action 1: Check In */}
          <button
            onClick={handleCheckIn}
            disabled={session !== SessionStatus.NOT_STARTED && session !== SessionStatus.CLOSED}
            className="card-3d flex flex-col items-center justify-center p-5 rounded-2xl border border-[var(--color-premium-border)] bg-white hover:bg-[var(--color-premium-surface-alt)] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed group text-center"
          >
            <div className="w-10 h-10 rounded-full bg-[var(--color-premium-success-soft)] flex items-center justify-center text-[var(--color-premium-success)] mb-3 group-hover:scale-105 transition-transform">
              <Play className="w-4 h-4 fill-current" />
            </div>
            <span className="font-display font-semibold text-xs text-[var(--color-premium-ink)] uppercase tracking-tight">Check-In</span>
            <span className="text-[10px] text-[var(--color-premium-muted)] mt-1">Start verification</span>
          </button>

          {/* Action 2: Coffee break toggle */}
          <button
            onClick={handleBreak}
            disabled={session !== SessionStatus.ACTIVE && session !== SessionStatus.ON_BREAK}
            className="card-3d flex flex-col items-center justify-center p-5 rounded-2xl border border-[var(--color-premium-border)] bg-white hover:bg-[var(--color-premium-surface-alt)] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed group text-center"
          >
            <div className="w-10 h-10 rounded-full bg-[var(--color-premium-info-soft)] flex items-center justify-center text-[var(--color-premium-info)] mb-3 group-hover:scale-105 transition-transform">
              <Coffee className="w-4 h-4" />
            </div>
            <span className="font-display font-semibold text-xs text-[var(--color-premium-ink)] uppercase tracking-tight">
              {session === SessionStatus.ON_BREAK ? 'End Break' : 'Start Break'}
            </span>
            <span className="text-[10px] text-[var(--color-premium-muted)] mt-1">Suspends geofence</span>
          </button>

          {/* Action 3: Checkout */}
          <button
            onClick={handleCheckOut}
            disabled={session !== SessionStatus.ACTIVE && session !== SessionStatus.ON_BREAK}
            className="card-3d flex flex-col items-center justify-center p-5 rounded-2xl border border-[var(--color-premium-border)] bg-white hover:bg-[var(--color-premium-surface-alt)] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed group text-center"
          >
            <div className="w-10 h-10 rounded-full bg-[var(--color-premium-accent-2-soft)] flex items-center justify-center text-[var(--color-premium-accent-2)] mb-3 group-hover:scale-105 transition-transform">
              <CheckCircle className="w-4 h-4" />
            </div>
            <span className="font-display font-semibold text-xs text-[var(--color-premium-ink)] uppercase tracking-tight">Check-Out</span>
            <span className="text-[10px] text-[var(--color-premium-muted)] mt-1">Seals the shift record</span>
          </button>

          {/* Action 4: Reset platform */}
          <button
            onClick={handleReset}
            className="card-3d flex flex-col items-center justify-center p-5 rounded-2xl border border-dashed border-[var(--color-premium-border)] bg-white hover:bg-[var(--color-premium-surface-alt)] transition-colors cursor-pointer group text-center"
          >
            <div className="w-10 h-10 rounded-full bg-[var(--color-premium-surface-alt)] flex items-center justify-center text-[var(--color-premium-muted)] mb-3 group-hover:scale-105 transition-transform">
              <RefreshCw className="w-4 h-4" />
            </div>
            <span className="font-display font-semibold text-xs text-[var(--color-premium-ink)] uppercase tracking-tight">Reset Demo</span>
            <span className="text-[10px] text-[var(--color-premium-muted)] mt-1">Clears the simulator</span>
          </button>

        </div>

        {/* Manager Review Stepper Flow panel (displays if NEEDS_REVIEW is active) */}
        {session === SessionStatus.NEEDS_REVIEW && (
          <div className="bg-[var(--color-premium-surface-alt)] border border-[var(--color-premium-border)] rounded-2xl p-5 mb-8 space-y-4">
            <div className="flex justify-between items-center border-b border-[var(--color-premium-border)] pb-2">
              <span className="text-[11px] text-[var(--color-premium-warning)] font-bold uppercase flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                Verification needs review
              </span>
              <span className="text-[10px] text-[var(--color-premium-muted)] font-semibold uppercase tracking-wide">Correction workflow</span>
            </div>

            <div className="flex flex-wrap gap-4 items-center justify-between">
              <div className="space-y-1">
                <h5 className="font-display font-semibold text-xs text-[var(--color-premium-ink)] tracking-tight">
                  Manager &amp; HR correction approval chain
                </h5>
                <p className="text-[11px] font-sans text-[var(--color-premium-muted)] max-w-md">
                  A coordinate discrepancy needs correcting. The employee files a request, a manager checks the timeline evidence, and HR approves the final record.
                </p>
              </div>

              {correction === 'NONE' && (
                <button
                  onClick={handleStartCorrection}
                  className="px-4 py-2 rounded-full bg-[var(--color-premium-ink)] text-white text-xs font-semibold cursor-pointer shadow-md hover:opacity-90 flex items-center gap-1"
                >
                  File Correction
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {correction !== 'NONE' && (
              <div className="pt-2 space-y-4">
                {/* Micro avatar-actor nodes path */}
                <div className="flex items-center justify-between relative px-4 max-w-md mx-auto py-2">
                  <div className="absolute top-1/2 left-0 right-0 h-[1.5px] bg-[var(--color-premium-border)] -translate-y-1/2 z-0" />

                  {/* Node 1: Employee */}
                  <div className="flex flex-col items-center relative z-10">
                    <div className="w-7 h-7 rounded-full bg-[var(--color-premium-ink)] border-2 border-white flex items-center justify-center text-[10px] font-bold text-white shadow-sm">
                      EM
                    </div>
                    <span className="font-sans text-[9px] font-bold text-[var(--color-premium-muted)] mt-1 uppercase">Employee</span>
                  </div>

                  {/* Connector arrow */}
                  <div className="text-[var(--color-premium-muted)] text-[10px]">···</div>

                  {/* Node 2: Manager */}
                  <div className="flex flex-col items-center relative z-10">
                    <div className={`w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-bold text-white shadow-sm transition-colors ${
                      correction === 'SUBMITTED' ? 'bg-[var(--color-premium-warning)]' : correction === 'MANAGER_APPROVED' || correction === 'HR_APPROVED' || correction === 'APPLIED' ? 'bg-[var(--color-premium-success)]' : 'bg-[var(--color-premium-border)] text-[var(--color-premium-muted)]'
                    }`}>
                      MN
                    </div>
                    <span className="font-sans text-[9px] font-bold text-[var(--color-premium-muted)] mt-1 uppercase">Manager</span>
                  </div>

                  {/* Connector arrow */}
                  <div className="text-[var(--color-premium-muted)] text-[10px]">···</div>

                  {/* Node 3: HR Compliance */}
                  <div className="flex flex-col items-center relative z-10">
                    <div className={`w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-bold text-white shadow-sm transition-colors ${
                      correction === 'MANAGER_APPROVED' ? 'bg-[#7C6FB0]' : correction === 'HR_APPROVED' || correction === 'APPLIED' ? 'bg-[var(--color-premium-success)]' : 'bg-[var(--color-premium-border)] text-[var(--color-premium-muted)]'
                    }`}>
                      HR
                    </div>
                    <span className="font-sans text-[9px] font-bold text-[var(--color-premium-muted)] mt-1 uppercase">HR</span>
                  </div>
                </div>

                {/* Approver decision action buttons */}
                <div className="flex justify-center gap-3 pt-2">
                  {correction === 'SUBMITTED' && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleManagerDecision(true)}
                        className="px-3.5 py-1.5 rounded-full bg-[var(--color-premium-success)] text-white text-[11px] font-semibold cursor-pointer shadow-sm hover:opacity-90"
                      >
                        Manager Approve
                      </button>
                      <button
                        onClick={() => handleManagerDecision(false)}
                        className="px-3.5 py-1.5 rounded-full bg-[var(--color-premium-danger)] text-white text-[11px] font-semibold cursor-pointer shadow-sm hover:opacity-90"
                      >
                        Manager Reject
                      </button>
                    </div>
                  )}

                  {correction === 'MANAGER_APPROVED' && (
                    <button
                      onClick={handleHRAudit}
                      className="px-4 py-1.5 rounded-full bg-[#7C6FB0] text-white text-[11px] font-semibold cursor-pointer shadow-sm hover:opacity-90"
                    >
                      HR Audit &amp; Approve
                    </button>
                  )}

                  {correction === 'HR_APPROVED' && (
                    <div className="text-[11px] text-[var(--color-premium-success)] font-bold">
                      Applying the correction to the record...
                    </div>
                  )}

                  {correction === 'APPLIED' && (
                    <div className="text-[11px] text-[var(--color-premium-success)] font-bold flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" />
                      Correction applied. Record sealed.
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>
        )}

        {/* Live Event Log Strip */}
        <EventLog logs={logs} />

      </div>
    </div>
  );
}
