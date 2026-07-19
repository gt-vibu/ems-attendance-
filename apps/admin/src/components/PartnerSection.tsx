/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Sparkles } from 'lucide-react';

interface SpawnedToken {
  id: string;
  x: number;
  y: number;
  rotation: number;
  letter: string;
}

const LETTERS = ['S', 'M', 'A', 'R', 'T', 'T', 'E', 'A', 'M', 'S'];

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
    <section id="cta" className="py-24 md:py-32 px-6 max-w-7xl mx-auto relative select-none">
      <motion.div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        initial={{ opacity: 0, y: 28 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-10% 0px' }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="w-full glass-card rounded-[32px] py-28 md:py-32 px-8 relative overflow-hidden flex flex-col items-center justify-center cursor-cell"
        style={{ boxShadow: 'var(--shadow-elevation-2)' }}
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
            className="absolute w-10 h-10 rounded-2xl bg-[var(--color-premium-ink)] text-[#5FBFA0] flex items-center justify-center font-display font-bold text-sm pointer-events-none shadow-md animate-fade-scale-down z-20"
          >
            {t.letter}
          </div>
        ))}

        <div className="text-center z-10 max-w-3xl space-y-8 pointer-events-none">
          <span className="text-xs text-[var(--color-premium-accent)] font-bold block uppercase tracking-widest">
            Set up in an afternoon
          </span>

          <h2 className="font-display font-semibold text-4xl md:text-6xl lg:text-7xl text-[var(--color-premium-ink)] tracking-tight leading-[1.05]">
            Deploy Smart Teams today
          </h2>

          <p className="font-sans text-sm md:text-base text-[var(--color-premium-muted)] max-w-lg mx-auto leading-relaxed">
            Invite your team, set up branch geofences, and let the state engine audit your hours. Free for up to 10 employees.
          </p>

          <div className="pt-4 flex justify-center">
            <button className="px-8 py-4 rounded-full bg-[var(--color-premium-ink)] text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2 hover:opacity-90 transition-opacity cursor-pointer shadow-xl pointer-events-auto">
              <Sparkles className="w-4 h-4 text-[#5FBFA0]" />
              Start free — no card required
              <ArrowRight className="w-4 h-4 text-white/60" />
            </button>
          </div>
        </div>

      </motion.div>
    </section>
  );
}
