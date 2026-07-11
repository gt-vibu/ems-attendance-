/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';

export interface ThemeConfig {
  accentColor: string; // Tailwind prefix (e.g., "indigo")
  accentHex: string;   // Hex code for styles / canvas
  bgGradient: string;  // Light, airy background gradient
  accentBg: string;    // bg utility class for active elements
  accentText: string;  // text utility class for active highlights
  accentBorder: string; // border utility class
  accentRing: string;   // ring utility class
  shouldAnimate: boolean; // if ambient motion should run (based on focus & reduced motion)
  dayName: string;
}

const BRAND_PALETTE = [
  { name: 'indigo', hex: '#6366f1', bg: 'bg-indigo-600', text: 'text-indigo-600', border: 'border-indigo-200', ring: 'ring-indigo-500/20' },
  { name: 'emerald', hex: '#10b981', bg: 'bg-emerald-600', text: 'text-emerald-600', border: 'border-emerald-200', ring: 'ring-emerald-500/20' },
  { name: 'violet', hex: '#8b5cf6', bg: 'bg-violet-600', text: 'text-violet-600', border: 'border-violet-200', ring: 'ring-violet-500/20' },
  { name: 'teal', hex: '#14b8a6', bg: 'bg-teal-600', text: 'text-teal-600', border: 'border-teal-200', ring: 'ring-teal-500/20' },
  { name: 'rose', hex: '#f43f5e', bg: 'bg-rose-600', text: 'text-rose-600', border: 'border-rose-200', ring: 'ring-rose-500/20' },
  { name: 'blue', hex: '#3b82f6', bg: 'bg-blue-600', text: 'text-blue-600', border: 'border-blue-200', ring: 'ring-blue-500/20' },
  { name: 'cyan', hex: '#06b6d4', bg: 'bg-cyan-600', text: 'text-cyan-600', border: 'border-cyan-200', ring: 'ring-cyan-500/20' },
  { name: 'sky', hex: '#0ea5e9', bg: 'bg-sky-600', text: 'text-sky-600', border: 'border-sky-200', ring: 'ring-sky-500/20' },
  { name: 'amber', hex: '#f59e0b', bg: 'bg-amber-600', text: 'text-amber-600', border: 'border-amber-200', ring: 'ring-amber-500/20' },
  { name: 'fuchsia', hex: '#d946ef', bg: 'bg-fuchsia-600', text: 'text-fuchsia-600', border: 'border-fuchsia-200', ring: 'ring-fuchsia-500/20' }
];

export function useLiveTheme(): ThemeConfig {
  const [isFocused, setIsFocused] = useState(true);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [currentDate, setCurrentDate] = useState(() => new Date());

  useEffect(() => {
    // Focus tracking
    const handleFocus = () => setIsFocused(true);
    const handleBlur = () => setIsFocused(false);

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    // Reduced motion media query
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);
    const handleMediaChange = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handleMediaChange);

    // Dynamic date updates (e.g. check date every 10 seconds to detect day change)
    const interval = setInterval(() => {
      setCurrentDate(new Date());
    }, 10000);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      mediaQuery.removeEventListener('change', handleMediaChange);
      clearInterval(interval);
    };
  }, []);

  // Compute deterministic index based on year, month and day of current date
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const day = currentDate.getDate();
  const seed = (year + month * 31 + day) % BRAND_PALETTE.length;
  const accent = BRAND_PALETTE[seed];

  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = daysOfWeek[currentDate.getDay()];

  return {
    accentColor: accent.name,
    accentHex: accent.hex,
    accentBg: accent.bg,
    accentText: accent.text,
    accentBorder: accent.border,
    accentRing: accent.ring,
    bgGradient: 'from-slate-50 via-slate-100/50 to-indigo-50/20', // Always light and clean
    shouldAnimate: isFocused && !prefersReducedMotion,
    dayName
  };
}
