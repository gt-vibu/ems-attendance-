/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef, useState, useEffect, type ReactNode } from 'react';
import { motion, useScroll, useTransform, useReducedMotion } from 'motion/react';

// Desktop-only pinned "story" primitive for the landing page: a tall
// wrapper (220vh) containing a `position: sticky` 100vh panel — the
// background/page itself stays put (sticky, not actually scrolling) while
// scroll progress across the wrapper's own range drives the panel's
// content upward into place, holds it steady while pinned, then slides it
// on out as the next ScrollStory section takes over.
//
// Opacity is deliberately kept at 1 for the whole entrance — only the Y
// position and scale animate in. Fading opacity in from 0 on entry was
// tried first and caused every section, including the very first one
// (Hero) at page load with zero scroll, to render fully invisible until
// scrolled partway into — a blank page, not a cinematic effect. Driving
// the "content moves up into the screen" motion through Y/scale instead
// of opacity means content is always visible, just not yet in its resting
// position, which is both correct and matches "content comes in, page
// doesn't move" — the page's own background never scrolls out of place.
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
  // Content rises up into place from just below its resting position (y:
  // 90 -> 0) as you scroll into the section, holds there while pinned,
  // then continues rising and fading only in the final stretch as the
  // next section takes over. Never fully transparent except right at the
  // very end of the exit — see the module comment above for why.
  const opacity = useTransform(scrollYProgress, [0, 0.9, 1], [1, 1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.18, 0.9, 1], [0.96, 1, 1, 1.02]);
  const y = useTransform(scrollYProgress, [0, 0.18, 0.9, 1], [90, 0, 0, -70]);

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
