/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';

interface SpawnedToken {
  id: string;
  x: number;
  y: number;
  rotation: number;
  letter: string;
}

const LETTERS = ['P', 'E', 'R', 'I', 'M', 'E', 'T', 'E', 'R'];

export default function PartnerSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tokens, setTokens] = useState<SpawnedToken[]>([]);
  const lastSpawnTime = useRef<number>(0);
  const spawnCounter = useRef<number>(0);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const now = Date.now();
    if (now - lastSpawnTime.current < 80) return; // min 80ms interval

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const rotation = (Math.random() * 20) - 10; // random rotation -10 to +10 degrees
    const letter = LETTERS[spawnCounter.current % LETTERS.length];
    
    spawnCounter.current += 1;
    lastSpawnTime.current = now;

    const newToken: SpawnedToken = {
      id: `token-${now}-${spawnCounter.current}`,
      x,
      y,
      rotation,
      letter
    };

    setTokens((prev) => [...prev, newToken]);

    // Cleanup after 900ms
    setTimeout(() => {
      setTokens((prev) => prev.filter((t) => t.id !== newToken.id));
    }, 900);
  };

  return (
    <section id="cta" className="py-20 px-6 max-w-7xl mx-auto relative select-none">
      <div 
        ref={containerRef}
        onMouseMove={handleMouseMove}
        className="w-full bg-white rounded-[40px] py-32 px-8 shadow-2xl relative overflow-hidden flex flex-col items-center justify-center border border-slate-100 cursor-cell group"
      >
        {/* Particle tokens track */}
        {tokens.map((t) => (
          <div
            key={t.id}
            style={{
              left: `${t.x}px`,
              top: `${t.y}px`,
              transform: `translate(-50%, -50%) rotate(${t.rotation}deg)`,
            }}
            className="absolute w-10 h-10 rounded-2xl bg-slate-900 text-[#8FE3C0] flex items-center justify-center font-display font-black text-sm pointer-events-none shadow-md animate-fade-scale-down z-20 border border-white/10"
          >
            {t.letter}
          </div>
        ))}

        {/* Ambient background blur circles */}
        <div className="absolute inset-0 bg-radial-[circle_at_center,transparent_40%,rgba(240,248,255,0.4)_100%] opacity-50 pointer-events-none" />

        <div className="text-center z-10 max-w-3xl space-y-8 pointer-events-none">
          <span className="font-mono text-xs text-indigo-600 font-bold block uppercase tracking-widest">
            ZERO-TRUST COMPLIANCE IN HOURS
          </span>
          
          <h2 className="font-display font-black text-4xl md:text-6xl lg:text-7xl text-slate-950 tracking-tight leading-none">
            Deploy Perimeter in an afternoon
          </h2>

          <p className="font-sans text-sm md:text-base text-slate-500 max-w-lg mx-auto leading-relaxed">
            Invite your team, set up branch geofences, and let the secure state engines audit your hours. Free for up to 10 employees.
          </p>

          <div className="pt-4 flex justify-center">
            <button className="px-8 py-4 rounded-full bg-slate-950 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2 group-hover:scale-105 transition-all cursor-pointer shadow-xl border border-white/5 pointer-events-auto">
              <Sparkles className="w-4 h-4 text-[#8FE3C0] animate-pulse" />
              Start Free — no card required
              <ArrowRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>

      </div>
    </section>
  );
}
