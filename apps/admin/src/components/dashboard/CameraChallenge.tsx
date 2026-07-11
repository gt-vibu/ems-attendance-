/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Camera, ShieldCheck, Eye, RefreshCw, Smartphone, MapPin, Sparkles, AlertCircle, Info, Coffee, LogOut } from 'lucide-react';
import { SessionStatus } from '../../types';
import { useLiveTheme } from '../../hooks/useLiveTheme';

interface CameraChallengeProps {
  currentStatus: SessionStatus;
  onCheckInCompleted: (confidence: number) => void;
  onReset: () => void;
}

type LivenessTask = 'LOOK_CENTER' | 'BLINK_TWICE' | 'TURN_LEFT' | 'SMILE' | 'SUCCESS';

export default function CameraChallenge({ currentStatus, onCheckInCompleted, onReset }: CameraChallengeProps) {
  const theme = useLiveTheme();
  const [task, setTask] = useState<LivenessTask>('LOOK_CENTER');
  const [taskTimer, setTaskTimer] = useState(3);
  const [simulating, setSimulating] = useState(false);
  const [successScore, setSuccessScore] = useState<number | null>(null);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (simulating && taskTimer > 0) {
      timer = setTimeout(() => setTaskTimer(prev => prev - 1), 1000);
    } else if (simulating && taskTimer === 0) {
      // Move to next challenge
      if (task === 'LOOK_CENTER') {
        setTask('BLINK_TWICE');
        setTaskTimer(3);
      } else if (task === 'BLINK_TWICE') {
        setTask('TURN_LEFT');
        setTaskTimer(4);
      } else if (task === 'TURN_LEFT') {
        setTask('SMILE');
        setTaskTimer(3);
      } else if (task === 'SMILE') {
        setTask('SUCCESS');
        setSimulating(false);
        const randomScore = Number((0.95 + Math.random() * 0.04).toFixed(3)); // 95% to 99%
        setSuccessScore(randomScore);
        onCheckInCompleted(randomScore);
      }
    }
    return () => clearTimeout(timer);
  }, [simulating, taskTimer, task]);

  const startKYC = () => {
    setSimulating(true);
    setTask('LOOK_CENTER');
    setTaskTimer(3);
    setSuccessScore(null);
  };

  // State-chip render helper as specified in the brief
  const renderStateChip = (status: SessionStatus) => {
    switch (status) {
      case SessionStatus.ACTIVE:
        return (
          <span className="relative inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200/60 text-[10px] font-mono font-bold text-emerald-800 shadow-xs">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            ACTIVE (CONTINUOUS AUDIT)
          </span>
        );
      case SessionStatus.ON_BREAK:
        return (
          <span className="relative inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200/60 text-[10px] font-mono font-bold text-amber-800 shadow-xs">
            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-ping" />
            ON_BREAK (PAUSED)
          </span>
        );
      case SessionStatus.NEEDS_REVIEW:
        return (
          <span className="relative inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-200/60 text-[10px] font-mono font-bold text-indigo-800 shadow-xs animate-pulse">
            <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full" />
            NEEDS_REVIEW
          </span>
        );
      case SessionStatus.PENDING_VERIFICATION:
        return (
          <span className="relative inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-50 border border-sky-200/60 text-[10px] font-mono font-bold text-sky-800 shadow-xs">
            <span className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-spin" />
            VERIFYING
          </span>
        );
      case SessionStatus.CLOSED:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-[10px] font-mono font-bold text-slate-500">
            CLOSED
          </span>
        );
      case SessionStatus.REJECTED:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 border border-rose-200 text-[10px] font-mono font-bold text-rose-600">
            REJECTED
          </span>
        );
      case SessionStatus.ABSENT:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-100 border border-zinc-200 text-[10px] font-mono font-bold text-zinc-500">
            ABSENT
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-50 border border-slate-200 text-[10px] font-mono font-bold text-slate-400">
            NOT_STARTED
          </span>
        );
    }
  };

  return (
    <div className="glass-panel-heavy p-6 rounded-3xl shadow-xl border border-slate-200/60 space-y-6">
      
      {/* Header */}
      <div className="flex justify-between items-center border-b border-slate-200/40 pb-3">
        <div>
          <h4 className="font-sans font-bold text-sm tracking-tight text-slate-950 uppercase flex items-center gap-1.5">
            <Camera className="w-4 h-4" style={{ color: theme.accentHex }} />
            Active Liveness Camera Gate
          </h4>
          <span className="font-mono text-[9px] tracking-widest text-slate-400 font-extrabold uppercase">
            3D Face Verification Core
          </span>
        </div>
        {renderStateChip(currentStatus)}
      </div>

      {/* Viewfinder Window */}
      <div className="relative aspect-video w-full rounded-2xl bg-slate-950 border-2 border-slate-900 shadow-inner overflow-hidden flex items-center justify-center text-white">
        
        {/* Dynamic scanning green laser scanner */}
        {simulating && (
          <motion.div
            animate={{ y: ['0%', '100%', '0%'] }}
            transition={{ repeat: Infinity, duration: 3.5, ease: 'linear' }}
            className="absolute top-0 left-0 right-0 h-[2.5px] z-10"
            style={{ 
              backgroundColor: theme.accentHex,
              boxShadow: `0 0 10px ${theme.accentHex}` 
            }}
          />
        )}

        {/* 3D Wireframe Face Overlay */}
        {simulating && (
          <div className="absolute inset-0 bg-radial-[circle_at_center,transparent_30%,rgba(0,0,0,0.5)_100%] flex items-center justify-center opacity-80">
            <motion.div
              animate={{ scale: [1, 1.05, 1], opacity: [0.5, 0.8, 0.5] }}
              transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
              className="w-32 h-32 border-2 border-dashed rounded-full flex items-center justify-center"
              style={{ borderColor: theme.accentHex }}
            >
              <div className="w-20 h-20 border border-dotted rounded-full flex items-center justify-center opacity-50">
                <Eye className="w-6 h-6 animate-pulse" style={{ color: theme.accentHex }} />
              </div>
            </motion.div>
          </div>
        )}

        {/* Challenge Instructions Prompts */}
        <AnimatePresence mode="wait">
          {simulating && (
            <motion.div
              key={task}
              initial={{ y: 15, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -15, opacity: 0 }}
              className="absolute bottom-4 left-4 right-4 bg-slate-950/90 border border-slate-800 backdrop-blur-md py-2.5 px-4 rounded-xl text-center z-20"
            >
              <p className="font-mono text-[9px] tracking-widest uppercase font-extrabold mb-0.5" style={{ color: theme.accentHex }}>
                CHALLENGE ACTIVE ({taskTimer}s)
              </p>
              <h5 className="font-sans font-bold text-xs tracking-tight text-white uppercase">
                {task === 'LOOK_CENTER' && 'Center Profile: Look directly into lens'}
                {task === 'BLINK_TWICE' && 'Liveness Challenge: Blink twice now'}
                {task === 'TURN_LEFT' && 'Perspective Map: Turn head slowly left'}
                {task === 'SMILE' && 'Expression Audit: Smile naturally'}
              </h5>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Inactive State */}
        {!simulating && successScore === null && (
          <div className="text-center p-6 space-y-2">
            <div className="inline-flex p-3 bg-slate-900 border border-slate-800 rounded-full text-slate-400">
              <Camera className="w-6 h-6" />
            </div>
            <p className="font-sans text-xs text-slate-400 max-w-xs">
              Hardware signature bound. Click below to launch verification cycle.
            </p>
          </div>
        )}

        {/* Success / Finalized results */}
        {successScore !== null && (
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="absolute inset-0 bg-emerald-950/95 flex flex-col items-center justify-center text-center p-6 z-20"
          >
            <motion.div
              animate={{ scale: [1, 1.12, 1] }}
              transition={{ repeat: Infinity, repeatDelay: 3, duration: 0.5 }}
              className="p-2.5 bg-emerald-500 text-white rounded-full mb-3 shadow-lg"
            >
              <ShieldCheck className="w-6 h-6" />
            </motion.div>
            <h5 className="font-sans font-bold text-xs tracking-tight text-white mb-0.5 uppercase">
              Identity Verified
            </h5>
            <span className="font-mono text-xl font-black text-emerald-300 tracking-tight block">
              {(successScore * 100).toFixed(1)}% Matching Embedding
            </span>
            <span className="font-mono text-[8px] tracking-widest text-emerald-400/80 uppercase font-bold mt-1">
              KYC_CHALLENGE_MATCH_OK
            </span>
          </motion.div>
        )}
      </div>

      {/* Button controls */}
      <div className="space-y-3">
        {currentStatus === SessionStatus.NOT_STARTED && !simulating && (
          <button
            onClick={startKYC}
            id="btn-invoke-kyc"
            className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-white hover:opacity-90 transition-all duration-300 font-semibold text-xs shadow-md cursor-pointer"
            style={{ backgroundColor: theme.accentHex }}
          >
            <Camera className="w-4 h-4" />
            Start Facial Challenge
          </button>
        )}

        {simulating && (
          <div className="w-full text-center py-2 text-xs font-mono font-medium text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            Evaluating neural embeddings...
          </div>
        )}

        {successScore !== null && (
          <div className="space-y-2">
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/50 text-[11px] space-y-1.5 font-sans">
              <div className="flex justify-between items-center text-slate-500 font-medium">
                <span className="flex items-center gap-1"><Smartphone className="w-3.5 h-3.5 text-slate-400" /> Device Handshake:</span>
                <span className="text-emerald-600 font-semibold font-mono">Verified Cryptographic Key</span>
              </div>
              <div className="flex justify-between items-center text-slate-500 font-medium">
                <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-slate-400" /> Boundary Check:</span>
                <span className="text-emerald-600 font-semibold font-mono">HQ In-Bounds (±12m)</span>
              </div>
            </div>
            
            <button
              onClick={onReset}
              id="btn-reset-kyc"
              className="w-full flex items-center justify-center gap-2 px-5 py-2 rounded-2xl bg-slate-100 hover:bg-slate-200 transition-all duration-300 font-semibold text-xs text-slate-600 border border-slate-200 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reset Biometric Gate
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
