/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, useMotionValue, useTransform, AnimatePresence } from 'motion/react';
import { 
  ShieldCheck, MapPin, Smartphone, ScrollText, 
  Clock, CheckCircle, AlertTriangle, ArrowRight, CheckCircle2, ShieldAlert, FileDiff, Sparkles, ChevronRight
} from 'lucide-react';
import { useLiveTheme } from '../../hooks/useLiveTheme';

// Parallax card wrapper
function TiltCard({ children, className }: { children: React.ReactNode; className?: string }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const rotateX = useTransform(y, [-100, 100], [10, -10]);
  const rotateY = useTransform(x, [-100, 100], [-10, 10]);

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const mouseX = event.clientX - rect.left - width / 2;
    const mouseY = event.clientY - rect.top - height / 2;
    x.set(mouseX);
    y.set(mouseY);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
      transition={{ type: "spring", stiffness: 350, damping: 25 }}
      className={`glass-panel rounded-3xl p-6 sm:p-8 shadow-xl relative overflow-hidden transition-shadow duration-300 hover:shadow-2xl ${className}`}
    >
      <div style={{ transform: "translateZ(30px)" }}>
        {children}
      </div>
    </motion.div>
  );
}

export default function LandingFeatures() {
  const theme = useLiveTheme();

  // Animations State
  const [presenceCycle, setPresenceCycle] = useState<'INSIDE' | 'OUTSIDE' | 'RECONCILING'>('INSIDE');
  const [faceScanActive, setFaceScanActive] = useState(true);
  const [faceScanProgress, setFaceScanProgress] = useState(0);
  const [faceScanChallenge, setFaceScanChallenge] = useState('BLINK NOW');
  const [workflowStep, setWorkflowStep] = useState(0);

  // Presence Cycle Loop
  useEffect(() => {
    const interval = setInterval(() => {
      setPresenceCycle(prev => {
        if (prev === 'INSIDE') return 'OUTSIDE';
        if (prev === 'OUTSIDE') return 'RECONCILING';
        return 'INSIDE';
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Face Scan Loop
  useEffect(() => {
    const interval = setInterval(() => {
      setFaceScanProgress(prev => {
        if (prev >= 97) {
          // cycle challenge instructions
          setFaceScanChallenge(c => c === 'BLINK NOW' ? 'TURN SLOWLY LEFT' : 'BLINK NOW');
          return 0;
        }
        return prev + 1.2;
      });
    }, 60);
    return () => clearInterval(interval);
  }, []);

  // Workflow Stepper Loop
  useEffect(() => {
    const interval = setInterval(() => {
      setWorkflowStep(prev => (prev + 1) % 5);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const workflowSteps = ['Draft', 'Submitted', 'Manager', 'HR Partner', 'Applied'];

  return (
    <div className="space-y-16 max-w-7xl mx-auto px-4 select-none">
      
      {/* Grid containing Feature Sections as floating cards */}
      <div className="grid lg:grid-cols-2 gap-8 items-stretch">
        
        {/* Card 1: Presence Verification */}
        <TiltCard className="flex flex-col justify-between h-full">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-200/50 flex items-center justify-center text-emerald-600">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-sans font-bold text-base text-slate-950 tracking-tight">
                  Presence Verification
                </h4>
                <span className="font-mono text-[9px] tracking-widest text-slate-400 font-extrabold uppercase block">
                  INTEGRATED GEOLOCATION STREAMING
                </span>
              </div>
            </div>
            <p className="font-sans text-xs text-slate-500 leading-relaxed">
              Maintains an active presence audit. Coordinates are gathered securely at the hardware level, verified against registered boundary perimeters, and reconciled against active schedules in real time.
            </p>
          </div>

          {/* Looping Loop Diagram */}
          <div className="mt-8 bg-slate-50 border border-slate-200/50 p-4 rounded-2xl flex flex-col items-center justify-center space-y-4 relative min-h-[140px]">
            <div className="absolute top-2 right-2 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
              <span className="font-mono text-[8px] text-slate-400 font-bold uppercase">LIVE_RADIAL_GPS</span>
            </div>

            <div className="flex items-center gap-8">
              {/* Device Bubble */}
              <div className="flex flex-col items-center space-y-1">
                <div className="w-12 h-12 rounded-full bg-slate-900 text-white flex items-center justify-center shadow-md relative">
                  <Smartphone className="w-5 h-5" />
                  {presenceCycle === 'INSIDE' && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full text-white text-[8px] font-black flex items-center justify-center">✓</span>
                  )}
                </div>
                <span className="font-mono text-[9px] text-slate-500 font-bold">DEVICE_A</span>
              </div>

              {/* Connected Connector arrow line */}
              <div className="w-24 h-2 bg-slate-200 rounded-full relative overflow-hidden flex items-center justify-center">
                <motion.div 
                  className="h-full bg-emerald-400 absolute left-0"
                  animate={{ 
                    width: presenceCycle === 'INSIDE' ? '100%' : presenceCycle === 'RECONCILING' ? '50%' : '15%',
                    backgroundColor: presenceCycle === 'INSIDE' ? '#10b981' : presenceCycle === 'RECONCILING' ? '#f59e0b' : '#94a3b8'
                  }}
                  transition={{ duration: 1 }}
                />
              </div>

              {/* Boundary Hub Bubble */}
              <div className="flex flex-col items-center space-y-1">
                <div className="w-12 h-12 rounded-full bg-slate-100 border-2 border-slate-300 border-dashed flex items-center justify-center relative">
                  <MapPin className="w-5 h-5 text-slate-500" />
                </div>
                <span className="font-mono text-[9px] text-slate-500 font-bold">HQ_FENCE</span>
              </div>
            </div>

            {/* State indicators text */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase font-bold text-slate-400">STATUS:</span>
              <AnimatePresence mode="wait">
                <motion.span
                  key={presenceCycle}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className={`px-2.5 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase ${
                    presenceCycle === 'INSIDE' 
                      ? 'bg-emerald-50 border border-emerald-100 text-emerald-800' 
                      : presenceCycle === 'RECONCILING' 
                        ? 'bg-amber-50 border border-amber-100 text-amber-800' 
                        : 'bg-slate-100 border border-slate-200 text-slate-500'
                  }`}
                >
                  {presenceCycle === 'INSIDE' && 'In Office (Perimeter Bound)'}
                  {presenceCycle === 'OUTSIDE' && 'Outside Perimeter bounds'}
                  {presenceCycle === 'RECONCILING' && 'Reconciling shift record'}
                </motion.span>
              </AnimatePresence>
            </div>
          </div>
        </TiltCard>

        {/* Card 2: Break Reconciliation */}
        <TiltCard className="flex flex-col justify-between h-full">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-200/50 flex items-center justify-center text-amber-600">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-sans font-bold text-base text-slate-950 tracking-tight">
                  Break Reconciliation Engine
                </h4>
                <span className="font-mono text-[9px] tracking-widest text-slate-400 font-extrabold uppercase block">
                  DECLARATION VS OBSERVED REALITY
                </span>
              </div>
            </div>
            <p className="font-sans text-xs text-slate-500 leading-relaxed">
              Perimeter never trusts manual client-declared shift timings. It overlays the manual employee break ledger with the observed geofence Exit & Entry coordinates. Gaps are highlighted instantly as discrepancies without creating finger-pointing accusations.
            </p>
          </div>

          {/* Double track animation diagram */}
          <div className="mt-8 space-y-3.5 bg-slate-50 border border-slate-200/50 p-4 rounded-2xl relative min-h-[140px] flex flex-col justify-center">
            {/* Track 1: Declared */}
            <div className="space-y-1">
              <div className="flex justify-between text-[9px] font-mono text-slate-400 font-bold uppercase">
                <span>Declared Break Period</span>
                <span className="text-amber-600">30 Mins Block</span>
              </div>
              <div className="h-4 w-full bg-slate-200/80 rounded-md overflow-hidden relative flex items-center">
                <div className="absolute h-full bg-amber-500/80 w-[40%] left-[25%] rounded-md flex items-center justify-center border-x border-amber-600/30">
                  <span className="text-[8px] font-mono text-white font-bold">12:00 PM - 12:30 PM</span>
                </div>
              </div>
            </div>

            {/* Track 2: Observed exit */}
            <div className="space-y-1">
              <div className="flex justify-between text-[9px] font-mono text-slate-400 font-bold uppercase">
                <span>Observed Geofence Gaps</span>
                <span className="text-rose-500">55 Mins Absence Detected</span>
              </div>
              <div className="h-4 w-full bg-slate-200/80 rounded-md overflow-hidden relative flex items-center">
                {/* Visual gap highlight */}
                <div className="absolute h-full bg-rose-500/75 w-[55%] left-[20%] rounded-md flex items-center justify-center border-x border-rose-600/30">
                  <span className="text-[8px] font-mono text-white font-bold">11:50 AM - 12:45 PM</span>
                </div>
              </div>
            </div>

            {/* Divergence feedback node indicator */}
            <div className="pt-2 border-t border-slate-200/40 flex justify-between items-center text-[10px] font-mono">
              <span className="text-rose-600 font-bold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                Unreconciled discrepancy: +25 mins
              </span>
              <span className="text-slate-400">Divergence flag raised</span>
            </div>
          </div>
        </TiltCard>

        {/* Card 3: Face Verification & Liveness */}
        <TiltCard className="flex flex-col justify-between h-full">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-200/50 flex items-center justify-center text-indigo-600">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-sans font-bold text-base text-slate-950 tracking-tight">
                  Active Biometric Liveness
                </h4>
                <span className="font-mono text-[9px] tracking-widest text-slate-400 font-extrabold uppercase block">
                  ANTI-SPOOF EMBEDDING VERIFICATION
                </span>
              </div>
            </div>
            <p className="font-sans text-xs text-slate-500 leading-relaxed">
              Provides daily verification. Randomized blinking, head tracking, and gaze angles verify actual physical liveness before matching biometric embeddings. Raw photos are never stored — only encrypted mathematical vectors.
            </p>
          </div>

          {/* Viewfinder scanner animation */}
          <div className="mt-8 bg-slate-950 border border-slate-900 p-4 rounded-2xl flex flex-col justify-center items-center min-h-[140px] text-white relative overflow-hidden">
            <div className="absolute top-2 left-2 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-ping" />
              <span className="font-mono text-[8px] text-slate-400 font-semibold uppercase">Liveness Engine v3</span>
            </div>

            {/* Scanning viewfinder coordinates */}
            <div className="w-24 h-24 border border-indigo-500/30 rounded-full relative flex items-center justify-center">
              <motion.div
                animate={{ scale: [1, 1.08, 1], opacity: [0.3, 0.7, 0.3] }}
                transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                className="absolute inset-2 border border-dashed border-indigo-400/40 rounded-full"
              />
              <ShieldCheck className="w-8 h-8 text-indigo-400 animate-pulse" />
            </div>

            {/* Face scan progress readout */}
            <div className="mt-3 text-center space-y-1">
              <span className="block font-mono text-[9px] text-indigo-300 font-black tracking-widest uppercase">
                Challenge: {faceScanChallenge}
              </span>
              <span className="block font-mono text-[11px] text-emerald-400 font-black">
                Similarity Score: {(92 + faceScanProgress / 20).toFixed(1)}% Matching Vector
              </span>
            </div>
          </div>
        </TiltCard>

        {/* Card 4: Policy Engine */}
        <TiltCard className="flex flex-col justify-between h-full">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-50 border border-rose-200/50 flex items-center justify-center text-rose-600">
                <ScrollText className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-sans font-bold text-base text-slate-950 tracking-tight">
                  Policy Version Rule Engine
                </h4>
                <span className="font-mono text-[9px] tracking-widest text-slate-400 font-extrabold uppercase block">
                  VERSIONED COMPLIANCE RULES
                </span>
              </div>
            </div>
            <p className="font-sans text-xs text-slate-500 leading-relaxed">
              Every single evaluation pins the exact PolicyVersion tenant-wide regulations active at the precise check-in timestamp. Changes in rules do not modify past evaluations retroactively, maintaining immutable records.
            </p>
          </div>

          {/* Timeline visualization */}
          <div className="mt-8 bg-slate-50 border border-slate-200/50 p-4 rounded-2xl flex flex-col justify-center min-h-[140px] space-y-4">
            <div className="flex items-center justify-between font-mono text-[10px]">
              <span className="text-slate-400 font-bold uppercase">Policy Versions Activation</span>
              <span className="px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-800 font-black">
                1 ACTIVE ONLY
              </span>
            </div>

            <div className="flex justify-between items-center relative px-2">
              <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-slate-200 -translate-y-1/2 z-0" />

              {/* Version Node 1 */}
              <div className="flex flex-col items-center relative z-10">
                <div className="w-6 h-6 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center text-[10px] font-mono text-slate-500">
                  v1.2
                </div>
                <span className="font-mono text-[8px] text-slate-400 font-bold mt-1 uppercase">SUPERSEDED</span>
              </div>

              {/* Version Node 2 (ACTIVE) */}
              <div className="flex flex-col items-center relative z-10">
                <div className="w-8 h-8 rounded-full bg-slate-950 border border-indigo-500 flex items-center justify-center text-xs font-mono font-bold text-white shadow-md relative">
                  <motion.div
                    className="absolute inset-0 rounded-full bg-indigo-500/20 -z-10"
                    animate={{ scale: [1, 1.3, 1] }}
                    transition={{ repeat: Infinity, duration: 2.5 }}
                  />
                  v2.4
                </div>
                <span className="font-mono text-[8px] text-indigo-600 font-black mt-1 uppercase">CURRENT ACTIVE</span>
              </div>

              {/* Version Node 3 */}
              <div className="flex flex-col items-center relative z-10">
                <div className="w-6 h-6 rounded-full bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center text-[10px] font-mono text-slate-400">
                  v2.5
                </div>
                <span className="font-mono text-[8px] text-slate-400 font-semibold mt-1 uppercase">DRAFT</span>
              </div>
            </div>

            <p className="text-[10px] text-center font-sans text-slate-400 italic">
              *Historical audits pin evaluation schema permanently to v1.2 or v2.4 respectively.
            </p>
          </div>
        </TiltCard>

      </div>

      {/* Card 5: Horizontal Correction & Approval Workflow Stepper */}
      <TiltCard className="w-full">
        <div className="grid md:grid-cols-12 gap-8 items-center">
          
          {/* Details */}
          <div className="md:col-span-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-200/50 flex items-center justify-center text-indigo-600">
                <FileDiff className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-sans font-bold text-base text-slate-950 tracking-tight">
                  Correction Workflow
                </h4>
                <span className="font-mono text-[9px] tracking-widest text-slate-400 font-extrabold uppercase block">
                  SECURE DUAL-APPROVAL FLOW
                </span>
              </div>
            </div>
            <p className="font-sans text-xs text-slate-500 leading-relaxed">
              When hardware failures or anomalous GPS drops occur, employees submit a Correction Request. This triggers an immutable audit stepper requiring Manager sign-off and HR compliance audit before overriding.
            </p>
          </div>

          {/* Stepper graphics */}
          <div className="md:col-span-7 bg-slate-50 border border-slate-200/50 rounded-2xl p-6 flex flex-col justify-center space-y-5">
            <div className="flex justify-between items-center border-b border-slate-200/40 pb-2 mb-1">
              <span className="font-mono text-[9px] text-slate-400 font-bold uppercase">LIVE_WORKFLOW_STATE</span>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-indigo-600 animate-ping" />
                <span className="font-mono text-[9px] text-indigo-600 font-black">STEP_EVAL_CYCLE</span>
              </div>
            </div>

            <div className="flex justify-between items-center relative">
              <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-slate-200 -translate-y-1/2 z-0" />
              
              {workflowSteps.map((step, idx) => {
                const isActive = workflowStep === idx;
                const isPast = idx < workflowStep;
                return (
                  <div key={step} className="flex flex-col items-center relative z-10">
                    <motion.div
                      animate={{
                        scale: isActive ? 1.15 : 1,
                        backgroundColor: isPast ? '#059669' : isActive ? theme.accentHex : '#e2e8f0',
                        color: isPast || isActive ? '#ffffff' : '#64748b'
                      }}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-mono font-bold transition-all shadow-sm"
                    >
                      {isPast ? <CheckCircle2 className="w-4 h-4 text-white" /> : idx + 1}
                    </motion.div>
                    <span className="font-sans text-[9px] font-bold mt-1.5 text-slate-500 uppercase">
                      {step}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </TiltCard>
    </div>
  );
}
