/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef, useState, useEffect, type ReactNode } from 'react';
import { motion, useScroll, useTransform, useReducedMotion } from 'motion/react';

// Desktop-only pinned "story" primitive for the landing page: a tall
// wrapper (220vh) containing a `position: sticky` 100vh panel. Scroll
// progress across that wrapper's own range drives the panel's
// opacity/scale/y — it's fully visible the instant its sticky range
// begins, holds steady while pinned, then fades+scales out only in the
// final stretch as the next ScrollStory section takes over.
//
// Deliberately NOT fading in from 0 on entry: since each ScrollStory's
// scroll range is its own independent wrapper (not overlapping the
// previous one), an entrance fade meant every section — including the
// very first one, Hero, at page load with zero scroll — started fully
// transparent and only became visible after scrolling partway into it.
// That's a blank page on load, not a cinematic effect. Only animating the
// exit keeps content on-screen at all times; the trade-off is a slightly
// harder cut into the next section instead of a true cross-dissolve,
// which is the right trade against ever rendering nothing.
// This uses native scroll the whole time (no scroll-jacking library,
// nothing intercepts the wheel/trackpad/touch input, back/forward still
// works) — only `transform`/`opacity` are animated, both GPU-accelerated.
//
// Below the desktop breakpoint, or when the user has asked for reduced
// motion, this renders as a plain stacked block with the same one-time
// fade-up every other section on this page already uses (see App.tsx's
// `revealUp`) — same content, same copy, just the simpler animation. This
// fallback is what actually satisfies "don't break responsiveness" and
// "respect reduced motion," not just a stated intention.
function useIsDesktopViewport(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isDesktop;
}

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export default function ScrollStory({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const isDesktop = useIsDesktopViewport();
  const pinned = isDesktop && !prefersReducedMotion;

  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const opacity = useTransform(scrollYProgress, [0, 0.85, 1], [1, 1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.85, 1], [1, 1, 1.04]);
  const y = useTransform(scrollYProgress, [0, 0.85, 1], [0, 0, -40]);

  if (!pinned) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 28 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-10% 0px' }}
        transition={{ duration: 0.6, ease: EASE_OUT }}
        className={className}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <div ref={ref} className="relative" style={{ height: '220vh' }}>
      <div className="sticky top-0 h-screen flex items-center justify-center overflow-hidden">
        <motion.div style={{ opacity, scale, y }} className={`w-full ${className}`}>
          {children}
        </motion.div>
      </div>
    </div>
  );
}
