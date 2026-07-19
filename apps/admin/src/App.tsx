/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';
import { Quote } from 'lucide-react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { SessionStatus } from './types';
import { attendanceEngine } from './state/attendanceMachine';

// Core layout imports
import LedgerStack from './three/LedgerStack';
import StateOrbit from './three/StateOrbit';
import DemoPanel from './components/DemoPanel';
import PricingSection from './components/PricingSection';
import FeatureGrid from './components/FeatureGrid';
import TestimonialCarousel from './components/TestimonialCarousel';
import FlightPath from './three/FlightPath';
import PartnerSection from './components/PartnerSection';
import Footer from './components/Footer';
import CopyrightBar from './components/CopyrightBar';
import BottomNav from './components/BottomNav';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 28 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, ease: EASE_OUT, delay },
});

const revealOnScroll = (delay = 0) => ({
  initial: { opacity: 0, y: 32 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-15% 0px' },
  transition: { duration: 0.7, ease: EASE_OUT, delay },
});

// Human-readable labels for the live demo status chip — mirrors the state
// naming already used in three/StateOrbit.tsx, kept local since that file
// doesn't export its list.
const SESSION_LABELS: Record<string, string> = {
  NOT_STARTED: 'Not started',
  PENDING_VERIFICATION: 'Verifying',
  ACTIVE: 'Active',
  ON_BREAK: 'On break',
  NEEDS_REVIEW: 'Needs review',
  CLOSED: 'Closed',
  REJECTED: 'Rejected',
  ABSENT: 'Absent',
};

const SESSION_DOT_COLOR: Record<string, string> = {
  NOT_STARTED: '#8A9089',
  PENDING_VERIFICATION: '#B8873A',
  ACTIVE: '#0F6E5B',
  ON_BREAK: '#2E6F8E',
  NEEDS_REVIEW: '#B8873A',
  CLOSED: '#14805F',
  REJECTED: '#B3432B',
  ABSENT: '#8A9089',
};

// Small 3D accent badge for the testimonial section — a slowly spinning
// translucent wireframe, tinted to the new emerald accent.
function ParallaxBadge() {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (meshRef.current) {
      meshRef.current.rotation.y = t * 0.5;
      meshRef.current.rotation.x = Math.sin(t * 0.5) * 0.3;
    }
  });

  return (
    <mesh ref={meshRef}>
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial color="#0F6E5B" wireframe transparent opacity={0.5} />
    </mesh>
  );
}

export default function App() {
  const [session, setSession] = useState<SessionStatus>(SessionStatus.NOT_STARTED);
  const [timeStr, setTimeStr] = useState('');
  const testimonialRef = useRef<HTMLDivElement>(null);
  const heroPinRef = useRef<HTMLDivElement>(null);

  // Same matchMedia pattern already used by three/LedgerStack.tsx — the new
  // idle-float/glow-pulse loops below are purely decorative, so they should
  // fully stand down for anyone who's asked the OS for less motion.
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(media.matches);
  }, []);

  // Scroll-linked parallax for the testimonial section's floating card,
  // replacing the previous hand-rolled window-scroll listener with
  // `motion`'s idiomatic scroll API.
  const { scrollYProgress } = useScroll({
    target: testimonialRef,
    offset: ['start end', 'end start'],
  });
  const badgeY = useTransform(scrollYProgress, [0, 1], [40, -40]);

  // The hero is pinned (position: sticky) so it holds still while the next
  // section scrolls up over it — but "holds still" was reading as inert.
  // This maps raw window scroll to progress across exactly that pin span
  // (0 = pin engages, 1 = fully covered), then uses it to make the hero
  // recede — fading, shrinking, and drifting up — as if sinking into depth
  // rather than just vanishing under a hard edge.
  //
  // Deliberately NOT `useScroll({ target: heroPinRef })`: a `position:
  // sticky` element's own getBoundingClientRect() is frozen (pinned to
  // top:0) for its entire stuck duration — that's the whole point of
  // sticky — so tracking scroll progress against the sticky element's OWN
  // rect never produces a changing value during the exact phase we want to
  // animate. Tracking raw window scroll against the pin's fixed height
  // (one viewport, since it's h-screen) sidesteps that entirely.
  const { scrollY } = useScroll();
  const heroPinProgress = useTransform(scrollY, (v) => {
    const pinHeight = heroPinRef.current?.offsetHeight || (typeof window !== 'undefined' ? window.innerHeight : 800);
    return Math.min(1, Math.max(0, v / pinHeight));
  });
  const heroContentOpacity = useTransform(heroPinProgress, [0, 0.7], [1, 0]);
  const heroContentY = useTransform(heroPinProgress, [0, 1], [0, -90]);
  const heroContentScale = useTransform(heroPinProgress, [0, 1], [1, 0.92]);
  const heroSceneOpacity = useTransform(heroPinProgress, [0, 0.85], [1, 0]);

  // Subscribe to state engine changes
  useEffect(() => {
    const unsub = attendanceEngine.subscribe(() => {
      setSession(attendanceEngine.sessionState);
    });

    const updateTime = () => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);

    return () => {
      unsub();
      clearInterval(interval);
    };
  }, []);

  const scrollToDemo = () => {
    const el = document.getElementById('interactive-demo-panel');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
      // Auto-trigger simulated check-in as requested
      setTimeout(() => {
        if (attendanceEngine.sessionState === SessionStatus.NOT_STARTED || attendanceEngine.sessionState === SessionStatus.CLOSED) {
          attendanceEngine.checkIn();
        }
      }, 500);
    }
  };

  const scrollToHow = () => {
    const el = document.getElementById('how-it-works');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen premium-mesh-bg text-[var(--color-premium-ink)] font-sans antialiased relative">

      {/* PINNED HERO — the 3D backdrop + hero copy stay fixed in the
          viewport (position: sticky, full-height) while every section below
          scrolls up over it. The next section (State Orbit) carries its own
          opaque premium-mesh-bg so it visually covers the pinned hero as it
          slides past, instead of leaving a transparent gap the fixed layer
          would show through. */}
      <div ref={heroPinRef} className="sticky top-0 h-screen overflow-hidden z-0">
        <motion.div style={{ opacity: heroSceneOpacity }} className="absolute inset-0">
          <LedgerStack />
        </motion.div>

        {/* HEADER BAR */}
        <header className="max-w-7xl mx-auto px-6 pt-6 flex justify-between items-center text-xs select-none relative z-30">
          <span className="font-display font-semibold text-xl md:text-2xl text-[var(--color-premium-ink)] tracking-tight">
            Smart Teams
          </span>

          <div className="flex items-center gap-6">
            <a href="#features" className="font-semibold text-[var(--color-premium-muted)] hover:text-[var(--color-premium-ink)] transition-colors">Features</a>
            <a href="#pricing" className="font-semibold text-[var(--color-premium-muted)] hover:text-[var(--color-premium-ink)] transition-colors">Pricing</a>
            <a href="/login" className="font-bold text-[var(--color-premium-accent)] hover:text-[var(--color-premium-accent-hover)] transition-colors">Admin Login</a>
            <a href="/employee/login" className="font-bold text-[var(--color-premium-accent)] hover:text-[var(--color-premium-accent-hover)] transition-colors">Employee Portal</a>
            <span className="hidden sm:block font-semibold text-[var(--color-premium-muted)] tabular-nums">
              {timeStr || '12:00 PM'}
            </span>
          </div>
        </header>

        {/* SECTION 1: HERO CONTAINER — the outer motion.div answers to scroll
            (fades/shrinks/drifts up as the pin gets covered); the inner one
            runs a slow, independent idle float so the hero still reads as
            "alive" even before the visitor has scrolled at all. */}
        <motion.section
          style={{ opacity: heroContentOpacity, y: heroContentY, scale: heroContentScale }}
          className="relative z-10 max-w-[620px] mx-auto px-6 text-center select-none h-[calc(100%-88px)] flex flex-col justify-center"
        >
          <motion.div
            animate={reducedMotion ? undefined : { y: [0, -10, 0] }}
            transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
            className="space-y-8"
          >
            <motion.div {...fadeUp(0)} className="space-y-4">
              <span className="relative inline-block text-xs text-[var(--color-premium-accent)] font-bold uppercase tracking-widest">
                Attendance you can prove
                <motion.span
                  className="absolute left-0 -bottom-1 h-px bg-[var(--color-premium-accent)]"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: '100%', opacity: [0, 1, 1, 0.4] }}
                  transition={{ duration: 1.8, delay: 0.6, ease: EASE_OUT }}
                />
              </span>

              <h1 className="font-display font-semibold text-[38px] md:text-[50px] lg:text-[54px] leading-[1.08] text-[var(--color-premium-ink)] tracking-tight">
                Know who's on the clock, <br />
                <span className="italic font-normal text-gradient bg-[length:200%_auto] animate-[gradient-shimmer_6s_ease-in-out_infinite] motion-reduce:animate-none">and where.</span>
              </h1>
            </motion.div>

            <motion.div {...fadeUp(0.12)} className="space-y-5 text-sm md:text-base text-[var(--color-premium-muted)] leading-relaxed max-w-[520px] mx-auto font-medium">
              <p>
                Smart Teams verifies every check-in against geofence, device, and confidence signals — so "present" actually means present.
              </p>
              <p>
                Every state change — check-in, break, anomaly, correction, approval — is a versioned, auditable transition, not a status field someone can quietly edit.
              </p>
              <p className="inline-block text-xs font-bold text-[var(--color-premium-accent)] bg-[var(--color-premium-accent-soft)] rounded-full px-4 py-1.5">
                Plans start free for up to 10 employees
              </p>
            </motion.div>

            {/* Buttons */}
            <motion.div {...fadeUp(0.24)} className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <div className="relative w-full sm:w-auto">
                {!reducedMotion && (
                  <motion.span
                    className="absolute inset-0 rounded-full bg-[var(--color-premium-accent)]/40 blur-lg -z-10"
                    animate={{ opacity: [0.35, 0.65, 0.35], scale: [1, 1.08, 1] }}
                    transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
                <button
                  onClick={scrollToDemo}
                  className="relative w-full sm:w-auto bg-[var(--color-premium-ink)] text-white rounded-full px-8 py-3.5 font-bold text-xs uppercase tracking-wider transition-all duration-300 shadow-[0_8px_24px_rgba(20,35,30,0.18)] hover:opacity-90 hover:scale-[1.03] cursor-pointer"
                >
                  Try live demo
                </button>
              </div>

              <button
                onClick={scrollToHow}
                className="w-full sm:w-auto bg-white text-[var(--color-premium-ink)] rounded-full px-8 py-3.5 font-bold text-xs uppercase tracking-wider shadow-sm border border-[var(--color-premium-border)] transition-all hover:bg-[var(--color-premium-surface-alt)] hover:scale-[1.03] cursor-pointer"
              >
                See how it works
              </button>
            </motion.div>

            {/* Floating Live Status chip anchored below Hero */}
            <motion.div {...fadeUp(0.36)} className="pt-6 flex justify-center">
              <div className="inline-flex items-center gap-2.5 bg-white border border-[var(--color-premium-border)] rounded-full px-5 py-2 shadow-sm">
                <span className="relative flex h-2 w-2">
                  <span
                    className="absolute inline-flex h-full w-full animate-ping motion-reduce:animate-none rounded-full opacity-60"
                    style={{ backgroundColor: SESSION_DOT_COLOR[session] || '#8A9089' }}
                  />
                  <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: SESSION_DOT_COLOR[session] || '#8A9089' }} />
                </span>
                <span className="text-[11px] font-semibold text-[var(--color-premium-muted)]">
                  Live demo status: <span className="text-[var(--color-premium-ink)]">{SESSION_LABELS[session] || session}</span>
                </span>
              </div>
            </motion.div>
          </motion.div>
        </motion.section>
      </div>

      {/* SECTION 2: STATE ORBIT — opaque premium-mesh-bg so this section
          visually covers the pinned hero above as it scrolls up over it. */}
      <motion.section {...revealOnScroll()} className="premium-mesh-bg pt-20 md:pt-28 pb-16 relative z-10">
        <StateOrbit />
      </motion.section>

      {/* SECTION 3: INTERACTIVE DEMO PANEL */}
      <section className="py-12 relative z-20">
        <DemoPanel />
      </section>

      {/* SECTION 4: TESTIMONIAL QUOTE SECTION */}
      <section ref={testimonialRef} className="py-24 px-6 max-w-3xl mx-auto text-center space-y-8 select-none relative z-20">
        <motion.div {...revealOnScroll()} className="flex justify-center">
          <Quote className="w-8 h-8 text-[var(--color-premium-accent)] opacity-80" />
        </motion.div>

        <motion.h3 {...revealOnScroll(0.08)} className="font-display text-[32px] md:text-[40px] lg:text-[44px] leading-[1.1] text-[var(--color-premium-ink)] tracking-tight">
          We stopped arguing about <br />
          <span className="italic text-gradient">"who was actually on site"</span>
        </motion.h3>

        <motion.p {...revealOnScroll(0.14)} className="font-sans text-xs italic text-[var(--color-premium-muted)] font-medium">
          — Head of Workforce Ops, a 400-person field-services company
        </motion.p>

        {/* Trust badges */}
        <motion.div {...revealOnScroll(0.2)} className="flex justify-center gap-8 pt-4 border-t border-[var(--color-premium-border)] max-w-md mx-auto">
          <span className="text-[10px] tracking-widest text-[var(--color-premium-muted)] font-bold uppercase">SOC 2 Compliant</span>
          <span className="text-[10px] tracking-widest text-[var(--color-premium-muted)] font-bold uppercase">GDPR Ready</span>
          <span className="text-[10px] tracking-widest text-[var(--color-premium-muted)] font-bold uppercase">Audit-Trail Certified</span>
        </motion.div>

        {/* Parallax 3D render card */}
        <div className="pt-12 flex justify-center overflow-visible">
          <motion.div
            style={{ y: badgeY }}
            className="w-64 h-40 glass-card rounded-3xl p-4 relative overflow-hidden flex items-center justify-center group"
          >
            <div className="absolute inset-0 z-0 opacity-40 pointer-events-none">
              <Canvas camera={{ position: [0, 0, 2] }}>
                <ambientLight intensity={1.5} />
                <pointLight position={[5, 5, 5]} />
                <ParallaxBadge />
              </Canvas>
            </div>
            <div className="z-10 text-center space-y-1">
              <span className="text-[10px] text-[var(--color-premium-accent)] font-bold uppercase tracking-widest">
                Verified & tamper-proof
              </span>
              <p className="font-sans text-[11px] text-[var(--color-premium-muted)] leading-normal font-medium max-w-[180px] mx-auto">
                Every face log is cryptographically pinned inside the device's secure enclave.
              </p>
            </div>
          </motion.div>
        </div>

      </section>

      {/* SECTION 6: FEATURE GRID */}
      <section id="features" className="relative z-20">
        <FeatureGrid />
      </section>

      {/* SECTION 8: HOW IT WORKS — flow diagram */}
      <section id="how-it-works" className="py-20 px-6 max-w-7xl mx-auto scroll-mt-28 relative z-20">
        <FlightPath />
      </section>

      {/* SECTION 5: PRICING SECTION */}
      <section id="pricing" className="relative z-20">
        <PricingSection />
      </section>

      {/* SECTION 7: TESTIMONIAL CAROUSEL */}
      <section className="relative z-20">
        <TestimonialCarousel />
      </section>

      {/* SECTION 9: PARTNER / CTA SECTION */}
      <section className="relative z-20">
        <PartnerSection />
      </section>

      {/* SECTION 10 & 11: FOOTER & COPYRIGHT */}
      <Footer />
      <CopyrightBar />

      {/* SECTION 12: FIXED BOTTOM NAV */}
      <BottomNav />

    </div>
  );
}
