/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  ShieldCheck, MapPin, Smartphone, ScrollText, Clock, CheckCircle2, 
  AlertTriangle, ArrowRight, ShieldAlert, Quote, Sparkles, ChevronRight 
} from 'lucide-react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { SessionStatus, BreakStatus, PresenceStatus } from './types';
import { attendanceEngine } from './state/attendanceMachine';
import { useInViewAnimation } from './hooks/useInViewAnimation';

// Core layout imports
import PerimeterField from './three/PerimeterField';
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

// Mini 3D Badge for Parallax Testimonial section
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
      <meshStandardMaterial color="#8FE3C0" wireframe transparent opacity={0.6} />
    </mesh>
  );
}

export default function App() {
  const [session, setSession] = useState<SessionStatus>(SessionStatus.NOT_STARTED);
  const [presence, setPresence] = useState<PresenceStatus>(PresenceStatus.INSIDE_OFFICE);
  const [timeStr, setTimeStr] = useState('');
  const [parallaxY, setParallaxY] = useState(0);

  // Subscribe to state engine changes
  useEffect(() => {
    const unsub = attendanceEngine.subscribe(() => {
      setSession(attendanceEngine.sessionState);
      setPresence(attendanceEngine.presenceState);
    });

    // Clock update
    const updateTime = () => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);

    // Scroll parallax event for testimonial section
    const handleScroll = () => {
      const offset = window.scrollY;
      setParallaxY(Math.min(160, offset * 0.15));
    };
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      unsub();
      clearInterval(interval);
      window.removeEventListener('scroll', handleScroll);
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

  // State colors maps
  const stateColorMap: Record<string, string> = {
    NOT_STARTED: 'bg-slate-400 text-slate-200',
    PENDING_VERIFICATION: 'bg-amber-400 text-amber-950 animate-pulse',
    ACTIVE: 'bg-[#4FD1A5] text-[#081418]',
    ON_BREAK: 'bg-[#3FA9C9] text-white',
    NEEDS_REVIEW: 'bg-[#E8843F] text-white animate-bounce',
    PENDING_APPROVAL: 'bg-[#9C8CE8] text-white',
    CLOSED: 'bg-[#2E7D5B] text-white',
    REJECTED: 'bg-[#E05959] text-white',
    ABSENT: 'bg-[#8A8F92] text-white'
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased relative overflow-x-hidden">
      
      {/* 3D CANVAS LAYER (Behind the main content, pass events through) */}
      <PerimeterField 
        sessionState={session} 
        outsideToggle={presence === PresenceStatus.OUTSIDE_OFFICE} 
      />

      {/* HEADER BAR */}
      <header className="max-w-7xl mx-auto px-6 pt-6 flex justify-between items-center text-xs select-none relative z-30">
        <span className="font-display font-semibold text-xl md:text-2xl text-slate-950 tracking-tight">
          Smart Teams
        </span>

        <div className="flex items-center gap-6">
          <a href="#features" className="hover:opacity-70 transition-opacity">Features</a>
          <a href="#pricing" className="hover:opacity-70 transition-opacity">Pricing</a>
          <a href="/login" className="hover:opacity-70 transition-opacity text-emerald-600 font-bold">Admin Login</a>
          <a href="/employee/login" className="hover:opacity-70 transition-opacity text-emerald-600 font-bold">Employee Portal</a>
          <div className="text-right hidden sm:block">
            <span className="font-mono font-black text-slate-950 block">
              {timeStr || '12:00:00 PM'}
            </span>
            <span className="font-mono text-[9px] text-slate-500 block uppercase tracking-widest">
              UTC COHERENCE SECURE
            </span>
          </div>
        </div>
      </header>

      {/* SECTION 1: HERO CONTAINER */}
      <section className="relative z-10 max-w-[620px] mx-auto px-6 pt-16 md:pt-24 text-center space-y-8 select-none">
        
        <div className="space-y-4">
          <span className="inline-block font-mono text-xs text-emerald-600 font-black uppercase tracking-widest animate-pulse">
            Attendance you can prove.
          </span>

          <h1 className="font-display font-semibold text-[38px] md:text-[50px] lg:text-[54px] leading-[1.08] text-slate-950 tracking-tight">
            Know who's on the clock, <br />
            <span className="italic font-normal text-emerald-600">and where.</span>
          </h1>
        </div>

        <div className="space-y-5 text-sm md:text-base text-slate-600 leading-relaxed max-w-[520px] mx-auto font-medium">
          <p>
            Smart Teams verifies every check-in against geofence, device, and confidence signals — so "present" actually means present.
          </p>
          <p>
            Every state change — check-in, break, anomaly, correction, approval — is a versioned, auditable transition, not a status field someone can quietly edit.
          </p>
          <p className="text-xs font-mono text-emerald-600 uppercase font-bold">
            Plans start at $0 for up to 10 employees.
          </p>
        </div>

        {/* Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <button
            onClick={scrollToDemo}
            className="w-full sm:w-auto bg-slate-900 text-white rounded-full px-8 py-3.5 font-bold text-xs uppercase tracking-wider transition-all duration-300 shadow-[0_4px_14px_rgba(15,23,42,0.15)] hover:bg-slate-800 cursor-pointer"
          >
            Try live demo
          </button>
          
          <button
            onClick={scrollToHow}
            className="w-full sm:w-auto bg-white text-slate-700 rounded-full px-8 py-3.5 font-bold text-xs uppercase tracking-wider shadow-sm border border-slate-200 transition-all hover:bg-slate-50 cursor-pointer"
          >
            See how it works
          </button>
        </div>

        {/* Floating Live Status chip anchored below Hero */}
        <div className="pt-6 flex justify-center">
          <div className="inline-flex items-center gap-2.5 bg-white border border-slate-200 rounded-full px-5 py-2 shadow-sm animate-pulse">
            <span className={`w-2 h-2 rounded-full ${stateColorMap[session]?.split(' ')[0] || 'bg-slate-400'}`} />
            <span className="font-mono text-[9px] font-extrabold text-slate-500 uppercase tracking-widest">
              SIMULATOR_STATE: {session}
            </span>
          </div>
        </div>

      </section>

      {/* SECTION 2: STATE ORBIT */}
      <section className="mt-20 md:mt-28 mb-16 relative z-20">
        <StateOrbit />
      </section>

      {/* SECTION 3: INTERACTIVE DEMO PANEL */}
      <section className="py-12 relative z-20">
        <DemoPanel />
      </section>

      {/* SECTION 4: TESTIMONIAL QUOTE SECTION */}
      <section className="py-24 px-6 max-w-3xl mx-auto text-center space-y-8 select-none relative z-20">
        <div className="flex justify-center">
          <Quote className="w-8 h-8 text-emerald-600 opacity-80" />
        </div>

        <h3 className="font-display text-[32px] md:text-[40px] lg:text-[44px] leading-[1.1] text-slate-900 tracking-tight">
          We stopped arguing about <br />
          <span className="italic text-emerald-600">"who was actually on site"</span>
        </h3>

        <p className="font-sans text-xs italic text-slate-500 font-medium">
          — Head of Workforce Ops, a 400-person field-services company
        </p>

        {/* Three trust logos as text */}
        <div className="flex justify-center gap-8 pt-4 border-t border-slate-200 max-w-md mx-auto">
          <span className="text-[10px] font-mono tracking-widest text-slate-500 font-extrabold uppercase">SOC 2 COMPLIANT</span>
          <span className="text-[10px] font-mono tracking-widest text-slate-500 font-extrabold uppercase">GDPR-READY</span>
          <span className="text-[10px] font-mono tracking-widest text-slate-500 font-extrabold uppercase">AUDIT-TRAIL CERTIFIED</span>
        </div>

        {/* Parallax 3D Render geofence dome card */}
        <div className="pt-12 flex justify-center overflow-visible">
          <div 
            style={{ transform: `translateY(${-parallaxY * 0.4}px)` }}
            className="w-64 h-40 bg-white border border-slate-200 rounded-3xl p-4 shadow-xl relative overflow-hidden backdrop-blur-md transition-transform duration-100 ease-out flex items-center justify-center group"
          >
            <div className="absolute inset-0 z-0 opacity-45 pointer-events-none">
              <Canvas camera={{ position: [0, 0, 2] }}>
                <ambientLight intensity={1.5} />
                <pointLight position={[5, 5, 5]} />
                <ParallaxBadge />
              </Canvas>
            </div>
            <div className="z-10 text-center space-y-1">
              <span className="font-mono text-[9px] text-emerald-600 font-black uppercase tracking-widest">
                IMMUTABLE EVIDENCE SHIELD
              </span>
              <p className="font-sans text-[11px] text-slate-700 leading-normal font-medium max-w-[180px] mx-auto">
                Hardware-bound cryptography pins face logs inside device secure enclaves.
              </p>
            </div>
          </div>
        </div>

      </section>

      {/* SECTION 6: FEATURE GRID */}
      <section className="relative z-20">
        <FeatureGrid />
      </section>

      {/* SECTION 8: HOW IT WORKS — flow diagram */}
      <section id="how-it-works" className="py-20 px-6 max-w-7xl mx-auto scroll-mt-28 relative z-20">
        <FlightPath />
      </section>

      {/* SECTION 5: PRICING SECTION */}
      <section className="relative z-20">
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
