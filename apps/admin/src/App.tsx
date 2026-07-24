/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Quote, ShieldCheck } from 'lucide-react';

import { SessionStatus } from './types';
import { attendanceEngine } from './state/attendanceMachine';

// Core layout imports
import HeroPreview from './components/HeroPreview';
import StateFlowStrip from './components/StateFlowStrip';
import ProcessSteps from './components/ProcessSteps';
import DemoPanel from './components/DemoPanel';
import PricingSection from './components/PricingSection';
import FeatureGrid from './components/FeatureGrid';
import TestimonialCarousel from './components/TestimonialCarousel';
import PartnerSection from './components/PartnerSection';
import Footer from './components/Footer';
import CopyrightBar from './components/CopyrightBar';
import BottomNav from './components/BottomNav';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

// A one-time fade + slight rise as each section scrolls into view — this is
// the one deliberately-kept motion effect. It's not a continuous loop or a
// scroll-linked parallax: `viewport: { once: true }` means it plays once
// and then the section just sits there like a normal static page, which is
// what "content must move up as we scroll" is asking for.
const revealOnScroll = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-10% 0px' },
  transition: { duration: 0.6, ease: EASE_OUT, delay },
});

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
  NOT_STARTED: '#64748B',
  PENDING_VERIFICATION: '#D97706',
  ACTIVE: '#16A34A',
  ON_BREAK: '#2563EB',
  NEEDS_REVIEW: '#D97706',
  CLOSED: '#16A34A',
  REJECTED: '#DC2626',
  ABSENT: '#64748B',
};

export default function App() {
  const [session, setSession] = useState<SessionStatus>(SessionStatus.NOT_STARTED);
  const [timeStr, setTimeStr] = useState('');

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
    <div className="min-h-screen premium-mesh-bg text-[var(--color-premium-ink)] font-sans antialiased">

      {/* HEADER BAR — a plain sticky nav (glass-panel-heavy: white/90% +
          blur), not pinned over any background scene. */}
      <header className="sticky top-0 z-30 glass-panel-heavy">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center text-xs select-none">
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
        </div>
      </header>

      {/* HERO — a normal (non-sticky, non-pinned) section. Copy on the left,
          a static product preview on the right instead of a 3D scene. */}
      <section className="max-w-7xl mx-auto px-6 pt-16 pb-20 md:pt-24 md:pb-28 grid md:grid-cols-2 gap-12 items-center">
        <div className="space-y-8 text-center md:text-left">
          <div className="space-y-4">
            <span className="text-xs text-[var(--color-premium-accent)] font-bold uppercase tracking-widest">
              Attendance you can prove
            </span>

            <h1 className="font-display font-semibold text-[38px] md:text-[46px] leading-[1.1] text-[var(--color-premium-ink)] tracking-tight">
              Know who's on the clock, <span className="text-gradient">and where.</span>
            </h1>
          </div>

          <div className="space-y-5 text-sm md:text-base text-[var(--color-premium-muted)] leading-relaxed font-medium">
            <p>
              Smart Teams verifies every check-in against geofence, device, and confidence signals — so "present" actually means present.
            </p>
            <p>
              Every state change — check-in, break, anomaly, correction, approval — is a versioned, auditable transition, not a status field someone can quietly edit.
            </p>
            <p className="inline-block text-xs font-bold text-[var(--color-premium-accent)] bg-[var(--color-premium-accent-soft)] rounded-full px-4 py-1.5">
              Plans start free for up to 10 employees
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start items-center">
            <button
              onClick={scrollToDemo}
              className="w-full sm:w-auto bg-[var(--color-premium-accent)] text-white rounded-full px-8 py-3.5 font-bold text-xs uppercase tracking-wider transition-colors hover:bg-[var(--color-premium-accent-hover)] cursor-pointer"
            >
              Try live demo
            </button>

            <button
              onClick={scrollToHow}
              className="w-full sm:w-auto bg-white text-[var(--color-premium-ink)] rounded-full px-8 py-3.5 font-bold text-xs uppercase tracking-wider shadow-sm border border-[var(--color-premium-border)] transition-colors hover:bg-[var(--color-premium-surface-alt)] cursor-pointer"
            >
              See how it works
            </button>
          </div>

          <div className="flex justify-center md:justify-start">
            <div className="inline-flex items-center gap-2.5 bg-white border border-[var(--color-premium-border)] rounded-full px-5 py-2 shadow-sm">
              <span className="relative flex h-2 w-2">
                <span
                  className="absolute inline-flex h-full w-full animate-ping motion-reduce:animate-none rounded-full opacity-60"
                  style={{ backgroundColor: SESSION_DOT_COLOR[session] || '#64748B' }}
                />
                <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: SESSION_DOT_COLOR[session] || '#64748B' }} />
              </span>
              <span className="text-[11px] font-semibold text-[var(--color-premium-muted)]">
                Live demo status: <span className="text-[var(--color-premium-ink)]">{SESSION_LABELS[session] || session}</span>
              </span>
            </div>
          </div>
        </div>

        <HeroPreview />
      </section>

      {/* STATE FLOW — static grid replacing the previous 3D orbit. */}
      <motion.section {...revealOnScroll()} className="py-16 md:py-20">
        <StateFlowStrip />
      </motion.section>

      {/* INTERACTIVE DEMO PANEL */}
      <section className="py-12">
        <DemoPanel />
      </section>

      {/* TESTIMONIAL */}
      <section className="py-24 px-6 max-w-3xl mx-auto text-center space-y-8 select-none">
        <motion.div {...revealOnScroll()} className="flex justify-center">
          <Quote className="w-8 h-8 text-[var(--color-premium-accent)] opacity-80" />
        </motion.div>

        <motion.h3 {...revealOnScroll(0.08)} className="font-display text-[32px] md:text-[40px] leading-[1.1] text-[var(--color-premium-ink)] tracking-tight">
          We stopped arguing about <br />
          <span className="italic text-gradient">"who was actually on site"</span>
        </motion.h3>

        <motion.p {...revealOnScroll(0.14)} className="font-sans text-xs italic text-[var(--color-premium-muted)] font-medium">
          — Head of Workforce Ops, a 400-person field-services company
        </motion.p>

        <motion.div {...revealOnScroll(0.2)} className="flex justify-center gap-8 pt-4 border-t border-[var(--color-premium-border)] max-w-md mx-auto">
          <span className="text-[10px] tracking-widest text-[var(--color-premium-muted)] font-bold uppercase">SOC 2 Compliant</span>
          <span className="text-[10px] tracking-widest text-[var(--color-premium-muted)] font-bold uppercase">GDPR Ready</span>
          <span className="text-[10px] tracking-widest text-[var(--color-premium-muted)] font-bold uppercase">Audit-Trail Certified</span>
        </motion.div>

        <motion.div {...revealOnScroll(0.26)} className="pt-12 flex justify-center">
          <div className="w-64 glass-card rounded-3xl p-5 flex items-center gap-3 text-left">
            <span className="shrink-0 w-10 h-10 rounded-full bg-[var(--color-premium-accent-soft)] text-[var(--color-premium-accent)] flex items-center justify-center">
              <ShieldCheck size={18} />
            </span>
            <div>
              <span className="text-[10px] text-[var(--color-premium-accent)] font-bold uppercase tracking-widest block">
                Verified &amp; tamper-proof
              </span>
              <p className="text-[11px] text-[var(--color-premium-muted)] leading-normal font-medium mt-1">
                Every face log is cryptographically pinned inside the device's secure enclave.
              </p>
            </div>
          </div>
        </motion.div>
      </section>

      {/* FEATURE GRID */}
      <section id="features">
        <FeatureGrid />
      </section>

      {/* HOW IT WORKS — static step flow replacing the previous 3D path. */}
      <motion.section {...revealOnScroll()} id="how-it-works" className="py-20 px-6 max-w-7xl mx-auto scroll-mt-28">
        <ProcessSteps />
      </motion.section>

      {/* PRICING */}
      <section id="pricing">
        <PricingSection />
      </section>

      {/* TESTIMONIAL CAROUSEL */}
      <section>
        <TestimonialCarousel />
      </section>

      {/* PARTNER / CTA */}
      <section>
        <PartnerSection />
      </section>

      <Footer />
      <CopyrightBar />
      <BottomNav />

    </div>
  );
}
