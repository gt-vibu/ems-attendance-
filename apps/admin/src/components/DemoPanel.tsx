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
import EnterpriseSandbox from './EnterpriseSandbox';

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

  // State colors corresponding to palette
  let badgeColor = '#6B7A80'; // NOT_STARTED
  if (state === SessionStatus.PENDING_VERIFICATION) badgeColor = '#E8B95B';
  else if (state === SessionStatus.ACTIVE) badgeColor = '#4FD1A5';
  else if (state === SessionStatus.ON_BREAK) badgeColor = '#3FA9C9';
  else if (state === SessionStatus.NEEDS_REVIEW) badgeColor = '#E8843F';
  else if (state === SessionStatus.CLOSED) badgeColor = '#2E7D5B';
  else if (state === SessionStatus.REJECTED) badgeColor = '#E05959';
  else if (state === SessionStatus.ABSENT) badgeColor = '#8A8F92';

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
  
  // Choose between interactive developer shift simulator and multi-tenant enterprise suite
  const [activeMode, setActiveMode] = useState<'SIMULATOR' | 'ENTERPRISE'>('ENTERPRISE');

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
    NOT_STARTED: '#6B7A80',
    PENDING_VERIFICATION: '#E8B95B',
    ACTIVE: '#4FD1A5',
    ON_BREAK: '#3FA9C9',
    NEEDS_REVIEW: '#E8843F',
    PENDING_APPROVAL: '#9C8CE8',
    CLOSED: '#2E7D5B',
    REJECTED: '#E05959',
    ABSENT: '#8A8F92'
  };

  if (activeMode === 'ENTERPRISE') {
    return (
      <div id="interactive-demo-panel" className="scroll-mt-28 py-12 px-4 max-w-6xl mx-auto select-none space-y-8 animate-fade-in">
        {/* Toggle Mode */}
        <div className="flex justify-center">
          <div className="inline-flex bg-slate-950/85 border border-[#143239]/50 rounded-full p-1.5 shadow-xl backdrop-blur-md">
            <button
              onClick={() => setActiveMode('SIMULATOR')}
              className="px-5 py-2 rounded-full text-xs font-mono font-bold uppercase tracking-wider transition-all cursor-pointer text-slate-400 hover:text-[#8FE3C0]"
            >
              🕹️ Shift Simulator
            </button>
            <button
              onClick={() => setActiveMode('ENTERPRISE')}
              className="px-5 py-2 rounded-full text-xs font-mono font-bold uppercase tracking-wider transition-all cursor-pointer bg-[#0B2A2E] text-[#8FE3C0] border border-[#8FE3C0]/15"
            >
              🏢 Enterprise SaaS Console
            </button>
          </div>
        </div>
        <EnterpriseSandbox />
      </div>
    );
  }

  return (
    <div id="interactive-demo-panel" className="scroll-mt-28 py-12 px-4 max-w-4xl mx-auto select-none space-y-8 animate-fade-in">
      {/* Toggle Mode */}
      <div className="flex justify-center">
        <div className="inline-flex bg-slate-950/85 border border-slate-900 rounded-full p-1.5 shadow-xl backdrop-blur-md">
          <button
            onClick={() => setActiveMode('SIMULATOR')}
            className="px-5 py-2 rounded-full text-xs font-mono font-bold uppercase tracking-wider transition-all cursor-pointer bg-[#0B2A2E] text-[#8FE3C0] border border-[#8FE3C0]/15"
          >
            🕹️ Shift Simulator
          </button>
          <button
            onClick={() => setActiveMode('ENTERPRISE')}
            className="px-5 py-2 rounded-full text-xs font-mono font-bold uppercase tracking-wider transition-all cursor-pointer text-slate-400 hover:text-[#8FE3C0]"
          >
            🏢 Enterprise SaaS Console
          </button>
        </div>
      </div>

      <div className="glass-panel-heavy rounded-[32px] border border-slate-200/50 p-6 md:p-10 shadow-2xl relative overflow-hidden flex flex-col items-stretch">
        
        {/* Toast Warning Anomaly overlay banner */}
        {activeToast && (
          <div className="absolute top-4 left-4 right-4 bg-orange-500 border border-orange-600/30 text-white rounded-2xl py-3 px-5 shadow-xl flex items-center gap-3 animate-pulse z-50">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div className="text-xs font-sans">
              <span className="font-bold block uppercase tracking-wider text-[10px] text-orange-100">SYSTEM ANOMALY REJECTED</span>
              {activeToast}
            </div>
          </div>
        )}

        {/* Column layout: Top 3D Badge Canvas */}
        <div className="grid md:grid-cols-12 gap-8 items-center border-b border-slate-200/40 pb-8 mb-8">
          
          <div className="md:col-span-4 flex flex-col items-center justify-center">
            <div className="relative w-40 h-40 bg-slate-950 border border-slate-900 rounded-full shadow-inner flex items-center justify-center overflow-hidden">
              <div className="absolute inset-0 bg-radial-[circle_at_center,transparent_30%,rgba(0,0,0,0.8)_100%]" />
              
              <Canvas camera={{ position: [0, 0, 2.5] }} style={{ pointerEvents: 'none' }}>
                <ambientLight intensity={1.5} />
                <directionalLight position={[2, 3, 2]} intensity={2.0} />
                <DemoBadge state={session} correctionState={correction} presenceState={presence} />
              </Canvas>

              {/* Small live colored chip overlay */}
              <div 
                style={{ backgroundColor: stateColorMap[session] }} 
                className="absolute bottom-2 px-2.5 py-0.5 rounded-full text-[8px] font-mono text-white tracking-widest font-extrabold uppercase border border-white/20 shadow-md"
              >
                {session}
              </div>
            </div>
          </div>

          <div className="md:col-span-8 space-y-4">
            <div>
              <span className="font-mono text-[9px] tracking-widest text-slate-400 font-extrabold uppercase block mb-1">
                IMMUTABLE CONSOLE CONTROLLER
              </span>
              <h3 className="font-display font-black text-2xl text-slate-950 tracking-tight leading-tight">
                Run a shift simulation
              </h3>
              <p className="font-sans text-xs text-slate-500 max-w-lg leading-relaxed mt-1">
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
                <span className="font-sans text-xs font-semibold text-slate-600 flex items-center gap-1">
                  <Smartphone className="w-3.5 h-3.5 text-slate-400" />
                  Simulate low confidence check-in (62%)
                </span>
              </label>

              <button
                onClick={handleGeofenceToggle}
                disabled={session === SessionStatus.NOT_STARTED || session === SessionStatus.CLOSED}
                className={`px-3 py-1.5 rounded-full text-[10px] font-mono font-bold tracking-wider uppercase transition-all flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border ${
                  presence === PresenceStatus.OUTSIDE_OFFICE
                    ? 'bg-rose-50 border-rose-200 text-rose-700'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-700'
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
            className="flex flex-col items-center justify-center p-5 rounded-2xl border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50/50 shadow-xs hover:shadow-md transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed group text-center"
          >
            <div className="w-10 h-10 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 mb-3 group-hover:scale-105 transition-transform">
              <Play className="w-4 h-4 fill-current" />
            </div>
            <span className="font-display font-extrabold text-xs text-slate-950 uppercase tracking-tight">Check-In</span>
            <span className="font-mono text-[8px] text-slate-400 mt-1">START VERIFICATION</span>
          </button>

          {/* Action 2: Coffee break toggle */}
          <button
            onClick={handleBreak}
            disabled={session !== SessionStatus.ACTIVE && session !== SessionStatus.ON_BREAK}
            className="flex flex-col items-center justify-center p-5 rounded-2xl border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50/50 shadow-xs hover:shadow-md transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed group text-center"
          >
            <div className="w-10 h-10 rounded-full bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-600 mb-3 group-hover:scale-105 transition-transform">
              <Coffee className="w-4 h-4" />
            </div>
            <span className="font-display font-extrabold text-xs text-slate-950 uppercase tracking-tight">
              {session === SessionStatus.ON_BREAK ? 'End Break' : 'Start Break'}
            </span>
            <span className="font-mono text-[8px] text-slate-400 mt-1">SUSPEND GEOFENCE</span>
          </button>

          {/* Action 3: Checkout */}
          <button
            onClick={handleCheckOut}
            disabled={session !== SessionStatus.ACTIVE && session !== SessionStatus.ON_BREAK}
            className="flex flex-col items-center justify-center p-5 rounded-2xl border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50/50 shadow-xs hover:shadow-md transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed group text-center"
          >
            <div className="w-10 h-10 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mb-3 group-hover:scale-105 transition-transform">
              <CheckCircle className="w-4 h-4" />
            </div>
            <span className="font-display font-extrabold text-xs text-slate-950 uppercase tracking-tight">Check-Out</span>
            <span className="font-mono text-[8px] text-slate-400 mt-1">SEAL SHIFT RECORD</span>
          </button>

          {/* Action 4: Reset platform */}
          <button
            onClick={handleReset}
            className="flex flex-col items-center justify-center p-5 rounded-2xl border border-dashed border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50/50 shadow-xs hover:shadow-md transition-all cursor-pointer group text-center"
          >
            <div className="w-10 h-10 rounded-full bg-slate-50 border border-slate-150 flex items-center justify-center text-slate-600 mb-3 group-hover:scale-105 transition-transform">
              <RefreshCw className="w-4 h-4" />
            </div>
            <span className="font-display font-extrabold text-xs text-slate-950 uppercase tracking-tight">Reset Ledger</span>
            <span className="font-mono text-[8px] text-slate-400 mt-1">FLUSH SIMULATOR</span>
          </button>

        </div>

        {/* Manager Review Stepper Flow panel (displays if NEEDS_REVIEW is active) */}
        {session === SessionStatus.NEEDS_REVIEW && (
          <div className="bg-slate-50 border border-slate-200/50 rounded-2xl p-5 mb-8 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-200/40 pb-2">
              <span className="font-mono text-[9px] text-[#E8843F] font-black uppercase flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-[#E8843F]" />
                Verification Anomaly unresolved
              </span>
              <span className="font-mono text-[9px] text-slate-400 font-bold uppercase">SECURE_CORRECTION_WORKFLOW</span>
            </div>

            <div className="flex flex-wrap gap-4 items-center justify-between">
              <div className="space-y-1">
                <h5 className="font-display font-bold text-xs text-slate-950 tracking-tight">
                  Manager & HR Correction approval chain
                </h5>
                <p className="text-[11px] font-sans text-slate-500 max-w-md">
                  Correct coordinates discrepancy. Employee files request, Manager checks timeline evidence, and HR injects block into timesheet database.
                </p>
              </div>

              {correction === 'NONE' && (
                <button
                  onClick={handleStartCorrection}
                  className="px-4 py-2 rounded-full bg-[#0B2A2E] text-[#EAF6FB] text-xs font-semibold cursor-pointer shadow-md hover:opacity-90 flex items-center gap-1"
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
                  <div className="absolute top-1/2 left-0 right-0 h-[1.5px] bg-slate-200 -translate-y-1/2 z-0" />

                  {/* Node 1: Employee */}
                  <div className="flex flex-col items-center relative z-10">
                    <div className="w-7 h-7 rounded-full bg-[#0B2A2E] border-2 border-white flex items-center justify-center text-[10px] font-bold text-white shadow-sm">
                      EM
                    </div>
                    <span className="font-sans text-[8px] font-bold text-slate-500 mt-1 uppercase">Employee</span>
                  </div>

                  {/* Connector arrow */}
                  <div className="text-slate-400 font-mono text-[10px]">···</div>

                  {/* Node 2: Manager */}
                  <div className="flex flex-col items-center relative z-10">
                    <div className={`w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-bold text-white shadow-sm transition-all ${
                      correction === 'SUBMITTED' ? 'bg-[#E8B95B] animate-pulse' : correction === 'MANAGER_APPROVED' || correction === 'HR_APPROVED' || correction === 'APPLIED' ? 'bg-[#4FD1A5]' : 'bg-slate-200 text-slate-500'
                    }`}>
                      MN
                    </div>
                    <span className="font-sans text-[8px] font-bold text-slate-500 mt-1 uppercase">Manager</span>
                  </div>

                  {/* Connector arrow */}
                  <div className="text-slate-400 font-mono text-[10px]">···</div>

                  {/* Node 3: HR Compliance */}
                  <div className="flex flex-col items-center relative z-10">
                    <div className={`w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-bold text-white shadow-sm transition-all ${
                      correction === 'MANAGER_APPROVED' ? 'bg-[#9C8CE8] animate-pulse' : correction === 'HR_APPROVED' || correction === 'APPLIED' ? 'bg-[#4FD1A5]' : 'bg-slate-200 text-slate-500'
                    }`}>
                      HR
                    </div>
                    <span className="font-sans text-[8px] font-bold text-slate-500 mt-1 uppercase">HR BP</span>
                  </div>
                </div>

                {/* Approver decision action buttons */}
                <div className="flex justify-center gap-3 pt-2">
                  {correction === 'SUBMITTED' && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleManagerDecision(true)}
                        className="px-3.5 py-1.5 rounded-full bg-emerald-500 text-white text-[11px] font-semibold cursor-pointer shadow-sm hover:bg-emerald-600"
                      >
                        Manager Approve
                      </button>
                      <button
                        onClick={() => handleManagerDecision(false)}
                        className="px-3.5 py-1.5 rounded-full bg-rose-500 text-white text-[11px] font-semibold cursor-pointer shadow-sm hover:bg-rose-600"
                      >
                        Manager Reject
                      </button>
                    </div>
                  )}

                  {correction === 'MANAGER_APPROVED' && (
                    <button
                      onClick={handleHRAudit}
                      className="px-4 py-1.5 rounded-full bg-indigo-500 text-white text-[11px] font-semibold cursor-pointer shadow-sm hover:bg-indigo-600"
                    >
                      HR Audit & Inject Ledger
                    </button>
                  )}

                  {correction === 'HR_APPROVED' && (
                    <div className="text-[10px] font-mono text-[#4FD1A5] font-black animate-pulse uppercase">
                      Queueing block insertion into timesheet database...
                    </div>
                  )}

                  {correction === 'APPLIED' && (
                    <div className="text-[10px] font-mono text-emerald-600 font-black flex items-center gap-1 uppercase">
                      <Check className="w-3.5 h-3.5" />
                      Correction applied. Ledger sealed.
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
