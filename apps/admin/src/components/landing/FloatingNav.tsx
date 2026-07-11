/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Compass, ShieldCheck, Cpu, User, LayoutDashboard, KeyRound, DollarSign, Fingerprint } from 'lucide-react';
import { useLiveTheme } from '../../hooks/useLiveTheme';

interface FloatingNavProps {
  currentView: 'landing' | 'dashboard';
  setView: (view: 'landing' | 'dashboard') => void;
  userRole: 'EMPLOYEE' | 'MANAGER' | 'ADMIN';
  setRole: (role: 'EMPLOYEE' | 'MANAGER' | 'ADMIN') => void;
}

export default function FloatingNav({ currentView, setView, userRole, setRole }: FloatingNavProps) {
  const theme = useLiveTheme();
  const [scrolled, setScrolled] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [showRoleSelector, setShowRoleSelector] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 120);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Landing Page links specified in prompt: Product, Verification Engine, Security, Pricing, Log in
  const landingNavItems = [
    { label: 'Product', icon: Cpu, href: '#product-hero' },
    { label: 'Verification Engine', icon: Fingerprint, href: '#verification-engine' },
    { label: 'Security', icon: ShieldCheck, href: '#security-details' },
    { label: 'Pricing', icon: DollarSign, href: '#pricing-tiers' }
  ];

  const dashboardNavItems = [
    { label: 'Home Console', icon: LayoutDashboard, view: 'dashboard' }
  ];

  const handleNavClick = (href: string) => {
    setView('landing');
    setTimeout(() => {
      const element = document.querySelector(href);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  };

  const roles: ('EMPLOYEE' | 'MANAGER' | 'ADMIN')[] = ['EMPLOYEE', 'MANAGER', 'ADMIN'];

  return (
    <motion.header
      initial={{ y: -100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', damping: 20, stiffness: 120, delay: 0.2 }}
      className="fixed top-6 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none"
    >
      <motion.div
        animate={{
          y: scrolled ? 0 : [0, -3, 0],
          scale: scrolled ? 0.95 : 1,
        }}
        transition={{
          y: scrolled 
            ? { duration: 0.1 } 
            : { repeat: Infinity, duration: 5, ease: "easeInOut" },
          scale: { duration: 0.3 }
        }}
        className={`flex items-center gap-3 md:gap-5 px-4 py-2.5 rounded-full shadow-lg pointer-events-auto border backdrop-blur-xl transition-all duration-500 max-w-full ${
          scrolled 
            ? 'bg-white/90 border-slate-200/60 shadow-slate-200/40' 
            : 'bg-white/80 border-slate-200/40 shadow-slate-100/40'
        }`}
      >
        {/* Brand Trigger Logo */}
        <div 
          onClick={() => { setView('landing'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          className="flex items-center gap-2 pr-3 border-r border-slate-200/60 cursor-pointer select-none"
        >
          <div className="relative flex items-center justify-center w-8 h-8 rounded-full bg-slate-950 text-white shadow-md">
            <Compass className="w-4 h-4 animate-spin-slow" />
            <span className="absolute -top-1 -right-1 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-emerald-400"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          </div>
          {/* Hide text on scrolled/mobile to condense beautifully */}
          {!scrolled && (
            <span className="font-display font-bold text-xs tracking-wider text-slate-950 block">
              PERIMETER
            </span>
          )}
        </div>

        {/* Dynamic Navigation Items */}
        <nav className="flex items-center gap-1">
          {currentView === 'landing' ? (
            // Landing Nav
            landingNavItems.map((item, idx) => (
              <button
                key={item.label}
                id={`nav-landing-${idx}`}
                onClick={() => handleNavClick(item.href)}
                onMouseEnter={() => setHoveredIndex(idx)}
                onMouseLeave={() => setHoveredIndex(null)}
                className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium tracking-tight text-slate-500 hover:text-slate-900 transition-all duration-300 cursor-pointer"
              >
                {hoveredIndex === idx && (
                  <motion.div
                    layoutId="hover-glow"
                    className="absolute inset-0 bg-slate-100/80 rounded-full -z-10"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <item.icon className="w-3.5 h-3.5 text-slate-400" />
                <span className="hidden md:inline font-sans font-medium">{item.label}</span>
              </button>
            ))
          ) : (
            // Dashboard Nav
            dashboardNavItems.map((item, idx) => (
              <button
                key={item.label}
                id={`nav-dash-${idx}`}
                onClick={() => setView('dashboard')}
                className="relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold tracking-tight text-slate-900 bg-slate-100/80 border border-slate-200/50 cursor-pointer"
              >
                <item.icon className="w-3.5 h-3.5 text-slate-950" />
                <span className="font-sans">{item.label}</span>
              </button>
            ))
          )}
        </nav>

        {/* Navigation Action Buttons (Login & CTA) */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-200/60">
          {currentView === 'landing' ? (
            <>
              <button
                onClick={() => setView('dashboard')}
                className="px-3 py-1.5 rounded-full hover:bg-slate-100/80 text-slate-600 hover:text-slate-900 text-xs font-medium font-sans cursor-pointer transition-colors"
              >
                Log in
              </button>
              <button
                onClick={() => setView('dashboard')}
                id="btn-nav-cta"
                className={`px-4 py-1.5 rounded-full text-white text-xs font-semibold tracking-wide shadow-md hover:shadow-lg transition-all duration-300 cursor-pointer hover:scale-[1.03] active:scale-[0.97] flex items-center gap-1`}
                style={{ backgroundColor: theme.accentHex }}
              >
                <KeyRound className="w-3.5 h-3.5" />
                Console
              </button>
            </>
          ) : (
            <button
              onClick={() => setView('landing')}
              className="px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200/80 text-slate-700 text-xs font-medium cursor-pointer transition-all"
            >
              Public Hub
            </button>
          )}

          {/* Quick Role Switcher Cog */}
          <div className="relative">
            <button
              onClick={() => setShowRoleSelector(!showRoleSelector)}
              id="btn-toggle-role-menu"
              className="p-1.5 rounded-full bg-slate-50 border border-slate-200 hover:bg-slate-100 cursor-pointer text-slate-500 transition-all flex items-center justify-center"
              title="Switch user roles for live demo representation"
            >
              <User className="w-3.5 h-3.5" />
            </button>
            
            <AnimatePresence>
              {showRoleSelector && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 10 }}
                  className="absolute right-0 mt-2 p-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl w-36 flex flex-col gap-1 z-50"
                >
                  <span className="block px-2.5 py-1 text-[8px] font-mono uppercase font-black text-slate-400 border-b border-slate-100 mb-1">
                    Demo Role Gate
                  </span>
                  {roles.map((role) => (
                    <button
                      key={role}
                      id={`role-select-${role}`}
                      onClick={() => {
                        setRole(role);
                        setView('dashboard');
                        setShowRoleSelector(false);
                      }}
                      className={`text-left px-2.5 py-1.5 rounded-xl text-xs font-medium font-sans cursor-pointer transition-all ${
                        userRole === role
                          ? 'bg-slate-950 text-white font-bold'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                    >
                      {role === 'EMPLOYEE' ? '🙋‍♂️ Employee' : role === 'MANAGER' ? '👔 Manager' : '⚙️ Admin'}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </motion.header>
  );
}
