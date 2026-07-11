/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldCheck, MapPin, Smartphone, ScrollText, CheckCircle2, RefreshCw } from 'lucide-react';
import { useLiveTheme } from '../../hooks/useLiveTheme';

export default function VerificationCore() {
  const theme = useLiveTheme();
  const [activeLayer, setActiveLayer] = useState<number | null>(0);
  const [isAligned, setIsAligned] = useState(false);

  // Auto trigger alignment demo loop every few seconds
  useEffect(() => {
    const alignInterval = setInterval(() => {
      setIsAligned(prev => !prev);
    }, 6000);

    return () => clearInterval(alignInterval);
  }, []);

  const layers = [
    {
      id: 1,
      name: 'Facial Biometrics & Liveness',
      icon: ShieldCheck,
      desc: 'Active head-turn challenges, blink confirmation, and convolutional embedding comparison matching localized signatures.',
      color: 'border-emerald-500/40 shadow-emerald-100',
      glow: 'bg-emerald-500/10',
      size: 'w-48 h-48',
      text: 'text-emerald-500',
      signal: 'Identity Verified 98.4%',
      badge: 'LIVENESS_OK'
    },
    {
      id: 2,
      name: 'Registered Device Trust',
      icon: Smartphone,
      desc: 'IMEI secure bonding registers a singular cryptographic device token on the device Trust Zone.',
      color: 'border-indigo-500/40 shadow-indigo-100',
      glow: 'bg-indigo-500/10',
      size: 'w-64 h-64',
      text: 'text-indigo-500',
      signal: 'Device Fingerprint Handshake',
      badge: 'DEVICE_SECURE'
    },
    {
      id: 3,
      name: 'Geofence Coherence',
      icon: MapPin,
      desc: 'Audits physical office building coordinates and Wi-Fi access point BSSID logs. Prevents coordinates spoofing.',
      color: 'border-teal-500/40 shadow-teal-100',
      glow: 'bg-teal-500/10',
      size: 'w-80 h-80',
      text: 'text-teal-500',
      signal: 'HQ Perimeter In-Bounds (±3m)',
      badge: 'GEOFENCE_MATCH'
    },
    {
      id: 4,
      name: 'Shift Policy Alignment',
      icon: ScrollText,
      desc: 'Validates time boundaries and shift grace tolerances against the immutable policy tenant version pinned at check-in.',
      color: 'border-rose-500/40 shadow-rose-100',
      glow: 'bg-rose-500/10',
      size: 'w-96 h-96',
      text: 'text-rose-500',
      signal: 'Policy Rule Version: v2.4.1',
      badge: 'POLICY_VALID'
    }
  ];

  return (
    <div className="relative flex flex-col items-center justify-center h-[540px] w-full select-none overflow-visible">
      {/* Dynamic Background Particle Field */}
      <div className="absolute inset-0 bg-radial-[circle_at_center,rgba(255,255,255,0.4)_0%,transparent_80%] -z-10" />

      {/* Decorative Outer Compass Rings */}
      <div className="absolute w-[460px] h-[460px] border border-dashed border-slate-200/60 rounded-full animate-spin-slow opacity-60" />
      <div className="absolute w-[530px] h-[530px] border border-dotted border-slate-300/40 rounded-full opacity-40" />

      {/* 3D-feeling Tilt Container */}
      <div className="relative w-full h-[380px] flex items-center justify-center scale-90 sm:scale-100">
        
        {/* Connection Link Rays between rings */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-40 z-0">
          <defs>
            <linearGradient id="ray-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={theme.accentHex} stopOpacity="0.4" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="50%" y1="50%" x2="50%" y2="5%" stroke="url(#ray-grad)" strokeWidth="1.5" strokeDasharray="3 3" />
          <line x1="50%" y1="50%" x2="95%" y2="50%" stroke="url(#ray-grad)" strokeWidth="1.5" strokeDasharray="3 3" />
          <line x1="50%" y1="50%" x2="50%" y2="95%" stroke="url(#ray-grad)" strokeWidth="1.5" strokeDasharray="3 3" />
          <line x1="50%" y1="50%" x2="5%" y2="50%" stroke="url(#ray-grad)" strokeWidth="1.5" strokeDasharray="3 3" />
        </svg>

        {/* Core center node - represents the combined Attendance Score */}
        <div className="absolute w-12 h-12 flex items-center justify-center rounded-full bg-slate-950 text-white shadow-2xl z-20 border-2 border-white">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 20, ease: 'linear' }}
            className="absolute inset-0 rounded-full border border-dashed border-white/40"
          />
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
        </div>

        {/* Isometric 3D concentric panels */}
        {layers.map((layer, index) => {
          const LayerIcon = layer.icon;
          const isActive = activeLayer === index;
          
          // Compute rotation offsets and scales depending on whether aligned state is triggered
          const scaleOffset = isAligned ? 1.0 : (index * 0.15 + 0.65);
          const rotationAngle = isAligned ? 0 : (index % 2 === 0 ? index * 8 + 10 : -(index * 8 + 10));

          return (
            <motion.div
              key={layer.id}
              onClick={() => setActiveLayer(index)}
              onMouseEnter={() => setActiveLayer(index)}
              className={`absolute rounded-full border-2 ${layer.color} shadow-lg flex items-center justify-center cursor-pointer transition-all duration-700 ${layer.size}`}
              style={{
                background: 'rgba(255, 255, 255, 0.45)',
                backdropFilter: 'blur(8px)',
                boxShadow: `0 15px 35px -5px rgba(15, 23, 42, 0.04), 0 0 12px 1px ${isActive ? theme.accentHex + '25' : 'transparent'}`,
                borderWidth: isActive ? '2px' : '1px',
                borderColor: isActive ? theme.accentHex : undefined
              }}
              animate={{
                scale: isActive ? scaleOffset * 1.05 : scaleOffset,
                rotate: rotationAngle,
                opacity: 1
              }}
              transition={{
                type: 'spring',
                stiffness: 110,
                damping: 18
              }}
            >
              {/* Animated scanning glow element */}
              {isActive && (
                <motion.div
                  className="absolute inset-0 rounded-full border-2 border-dashed pointer-events-none"
                  style={{ borderColor: theme.accentHex }}
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 8, ease: 'linear' }}
                />
              )}

              {/* Top and bottom compass tick points */}
              <div className="absolute top-0 w-1.5 h-1.5 rounded-full bg-slate-400/80 -translate-y-1.5" />
              <div className="absolute bottom-0 w-1.5 h-1.5 rounded-full bg-slate-400/80 translate-y-1.5" />

              {/* Float-above text overlay */}
              <motion.div
                animate={{ opacity: isActive ? 1 : 0.5, y: isActive ? -8 : 0 }}
                className="absolute -top-7 bg-white/95 border border-slate-200/60 rounded-full px-2.5 py-0.5 shadow-sm text-[9px] font-mono font-bold tracking-wider whitespace-nowrap"
              >
                <span style={{ color: isActive ? theme.accentHex : '#64748b' }}>
                  {layer.badge}
                </span>
              </motion.div>
            </motion.div>
          );
        })}
      </div>

      {/* Control alignment toggle and current status text */}
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => setIsAligned(!isAligned)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-slate-200 hover:bg-slate-50 text-[10px] font-mono font-bold text-slate-600 transition-all shadow-xs cursor-pointer"
        >
          <RefreshCw className="w-3 h-3 text-indigo-500" />
          {isAligned ? 'Scatter Signals' : 'Align Security Core'}
        </button>
        <span className="text-[10px] font-mono text-slate-400 font-semibold uppercase">
          Status: {isAligned ? 'ALIGNED_COHERENCE' : 'AMBIENT_DRIFTING'}
        </span>
      </div>

      {/* Focus detail cards below */}
      <div className="h-32 w-full max-w-lg relative flex items-center justify-center px-4">
        <AnimatePresence mode="wait">
          {activeLayer !== null && (
            <motion.div
              key={activeLayer}
              initial={{ opacity: 0, y: 15, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -15, scale: 0.95 }}
              transition={{ type: 'spring', damping: 20, stiffness: 140 }}
              className="absolute w-full bg-white/90 border border-slate-200/60 backdrop-blur-md px-6 py-4 rounded-2xl shadow-xl text-center space-y-1"
            >
              <div className="flex items-center justify-center gap-2">
                {React.createElement(layers[activeLayer].icon, { className: 'w-4 h-4 text-slate-700' })}
                <h4 className="font-sans font-bold text-xs tracking-tight text-slate-950 uppercase">
                  {layers[activeLayer].name}
                </h4>
              </div>
              <p className="font-sans text-[11px] text-slate-500 leading-relaxed">
                {layers[activeLayer].desc}
              </p>
              <div className="pt-1.5 inline-flex items-center gap-1.5 text-[9px] font-mono tracking-wider font-extrabold uppercase" style={{ color: theme.accentHex }}>
                <span>Signal Strength: 100% Secure Handshake</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
