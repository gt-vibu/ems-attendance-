/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Play, Check, ShieldCheck, Smartphone, MapPin, Wifi, RefreshCw } from 'lucide-react';
import { useLiveTheme } from '../../hooks/useLiveTheme';

export default function ConfidenceSandbox() {
  const theme = useLiveTheme();
  const [stage, setStage] = useState<'idle' | 'running' | 'completed'>('idle');
  const [progress, setProgress] = useState({
    face: 0,
    gps: 0,
    device: 0,
    network: 0
  });

  const runSimulation = () => {
    if (stage === 'running') return;
    
    setStage('running');
    setProgress({ face: 0, gps: 0, device: 0, network: 0 });

    // Cascade stages sequentially
    setTimeout(() => {
      let interval = setInterval(() => {
        setProgress(prev => {
          if (prev.face >= 98) {
            clearInterval(interval);
            return { ...prev, face: 98.4 };
          }
          return { ...prev, face: prev.face + 4 };
        });
      }, 30);
    }, 200);

    setTimeout(() => {
      let interval = setInterval(() => {
        setProgress(prev => {
          if (prev.gps >= 95) {
            clearInterval(interval);
            return { ...prev, gps: 95.8 };
          }
          return { ...prev, gps: prev.gps + 5 };
        });
      }, 30);
    }, 1000);

    setTimeout(() => {
      let interval = setInterval(() => {
        setProgress(prev => {
          if (prev.device >= 100) {
            clearInterval(interval);
            return { ...prev, device: 100 };
          }
          return { ...prev, device: prev.device + 8 };
        });
      }, 30);
    }, 1800);

    setTimeout(() => {
      let interval = setInterval(() => {
        setProgress(prev => {
          if (prev.network >= 92) {
            clearInterval(interval);
            setStage('completed');
            return { ...prev, network: 92.2 };
          }
          return { ...prev, network: prev.network + 6 };
        });
      }, 30);
    }, 2500);
  };

  const overallConfidence = stage === 'idle' 
    ? 0 
    : stage === 'running' 
      ? Number(((progress.face + progress.gps + progress.device + progress.network) / 4).toFixed(1))
      : 97.2;

  return (
    <div className="bg-white/85 border border-slate-200/60 rounded-3xl p-6 md:p-8 shadow-xl max-w-4xl mx-auto backdrop-blur-md relative overflow-hidden">
      <div className="absolute top-0 right-0 p-3 text-[9px] font-mono tracking-widest text-slate-300">
        SANDBOX_v2.0
      </div>

      <div className="mb-8 text-center">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100/50 text-[10px] font-mono tracking-wider font-bold uppercase mb-2" style={{ color: theme.accentHex, borderColor: theme.accentHex + '20' }}>
          Interactive Demonstration
        </span>
        <h3 className="font-display font-extrabold text-xl text-slate-950 tracking-tight mb-2">
          Multi-Signal Score Assembler
        </h3>
        <p className="font-sans text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
          Trigger a secure mock verify event to watch telemetry layers gather, evaluate coordinates, and combine into an immutable overall score.
        </p>
      </div>

      {/* Grid Columns */}
      <div className="grid md:grid-cols-12 gap-8 items-center mb-8">
        
        {/* Left Column: Progress Layers */}
        <div className="md:col-span-7 space-y-4">
          
          {/* Signal 1 */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <span className="flex items-center gap-1.5 font-sans font-semibold text-slate-700">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                Identity Match & Liveness Check
              </span>
              <span className="font-mono text-[11px] text-slate-500 font-bold">
                {progress.face.toFixed(1)}%
              </span>
            </div>
            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-emerald-500 rounded-full"
                animate={{ width: `${progress.face}%` }}
                transition={{ ease: "easeOut" }}
              />
            </div>
          </div>

          {/* Signal 2 */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <span className="flex items-center gap-1.5 font-sans font-semibold text-slate-700 font-sans">
                <MapPin className="w-3.5 h-3.5" style={{ color: theme.accentHex }} />
                Boundary GPS Geofence Check
              </span>
              <span className="font-mono text-[11px] text-slate-500 font-bold">
                {progress.gps.toFixed(1)}%
              </span>
            </div>
            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
              <motion.div 
                className="h-full rounded-full"
                style={{ backgroundColor: theme.accentHex }}
                animate={{ width: `${progress.gps}%` }}
                transition={{ ease: "easeOut" }}
              />
            </div>
          </div>

          {/* Signal 3 */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <span className="flex items-center gap-1.5 font-sans font-semibold text-slate-700">
                <Smartphone className="w-3.5 h-3.5 text-indigo-500" />
                IMEI Trusted Device Key Handshake
              </span>
              <span className="font-mono text-[11px] text-slate-500 font-bold">
                {progress.device.toFixed(0)}%
              </span>
            </div>
            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-indigo-500 rounded-full"
                animate={{ width: `${progress.device}%` }}
                transition={{ ease: "easeOut" }}
              />
            </div>
          </div>

          {/* Signal 4 */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <span className="flex items-center gap-1.5 font-sans font-semibold text-slate-700">
                <Wifi className="w-3.5 h-3.5 text-teal-500" />
                Enterprise Router SSID/MAC Match
              </span>
              <span className="font-mono text-[11px] text-slate-500 font-bold">
                {progress.network.toFixed(1)}%
              </span>
            </div>
            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-teal-500 rounded-full"
                animate={{ width: `${progress.network}%` }}
                transition={{ ease: "easeOut" }}
              />
            </div>
          </div>
        </div>

        {/* Right Column: Dynamic Circular Score Output */}
        <div className="md:col-span-5 flex flex-col items-center justify-center">
          <div className="relative w-44 h-44 flex items-center justify-center bg-slate-50 border border-slate-200/50 rounded-full shadow-inner">
            
            {/* Pulsing ring during completion */}
            {stage === 'completed' && (
              <motion.div
                initial={{ scale: 0.9, opacity: 0.5 }}
                animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0, 0.5] }}
                transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }}
                className="absolute inset-0 rounded-full -z-10"
                style={{ backgroundColor: theme.accentHex + '15' }}
              />
            )}

            {/* Circular score display */}
            <div className="text-center z-10">
              <span className="block text-[9px] font-mono tracking-widest text-slate-400 uppercase font-black">
                SCORE FUSION
              </span>
              <motion.span 
                className="block text-4xl font-display font-black text-slate-950 tracking-tighter"
                animate={{ scale: stage === 'completed' ? [1, 1.08, 1] : 1 }}
                transition={{ duration: 0.4 }}
              >
                {stage === 'idle' ? '0.0%' : `${overallConfidence.toFixed(1)}%`}
              </motion.span>
              <span className="block mt-1 text-[8px] font-mono uppercase tracking-widest font-extrabold" style={{ color: stage === 'completed' ? '#059669' : theme.accentHex }}>
                {stage === 'idle' && 'READY'}
                {stage === 'running' && 'PROCESSING_SIGNALS'}
                {stage === 'completed' && 'SECURE_RECONCILED'}
              </span>
            </div>

            {/* Success icon check badge */}
            {stage === 'completed' && (
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                className="absolute -bottom-1.5 right-6 w-8 h-8 bg-emerald-500 text-white rounded-full flex items-center justify-center shadow-lg border-2 border-white"
              >
                <Check className="w-4 h-4" />
              </motion.div>
            )}
          </div>
        </div>
      </div>

      {/* Primary Action Button */}
      <div className="flex justify-center">
        <button
          onClick={runSimulation}
          id="btn-trigger-sandbox"
          className="flex items-center gap-2 px-6 py-3 rounded-full text-white text-xs font-semibold tracking-wide transition-all duration-300 shadow-md cursor-pointer hover:scale-[1.03] active:scale-[0.97]"
          style={{ backgroundColor: theme.accentHex }}
          disabled={stage === 'running'}
        >
          {stage === 'completed' ? (
            <>
              <RefreshCw className="w-3.5 h-3.5" />
              Re-evaluate Signals
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              {stage === 'running' ? 'Compiling Scores...' : 'Simulate Score Fusion'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
