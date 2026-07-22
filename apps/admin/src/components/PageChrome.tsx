import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft, Globe } from 'lucide-react';

interface PageChromeProps {
  /** Where "Back" goes if there's no browser history to pop (deep link, opened in a new tab, etc). */
  fallbackHref: string;
  /**
   * 'floating': fixed pill pair in the top-left corner, for standalone pages.
   * 'compact': inline controls meant to be dropped into an existing header/toolbar (Dashboard only).
   */
  variant?: 'floating' | 'compact';
  className?: string;
}

/**
 * Site-wide Back / "visit landing page" controls. Deliberately labeled
 * "Landing Page" with a Globe icon rather than "Home"/Home icon — Dashboard's
 * sidebar already has its own internal "Home" tab (an in-page view switch,
 * not navigation), and reusing that word/icon here would put two different
 * "Home"s with different meanings next to each other.
 */
export default function PageChrome({ fallbackHref, variant = 'floating', className = '' }: PageChromeProps) {
  const navigate = useNavigate();

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(fallbackHref);
  };

  const goToLanding = () => navigate('/');

  if (variant === 'compact') {
    return (
      <div className={`flex items-center gap-1.5 ${className}`}>
        <button
          onClick={goBack}
          aria-label="Back"
          className="p-2 rounded-lg text-[var(--color-nexus-muted,#64748b)] hover:text-[var(--color-nexus-ink,#0f172a)] hover:bg-[var(--color-nexus-primary-fixed)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button
          onClick={goToLanding}
          aria-label="Visit landing page"
          className="p-2 rounded-lg text-[var(--color-nexus-muted,#64748b)] hover:text-[var(--color-nexus-ink,#0f172a)] hover:bg-[var(--color-nexus-primary-fixed)] transition-colors"
        >
          <Globe className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className={`fixed top-4 sm:top-6 left-4 sm:left-6 z-40 flex items-center gap-1.5 sm:gap-2 max-w-[62%] ${className}`}
    >
      {/* Text labels collapse to icon-only below the sm breakpoint — on a
          narrow phone this pair was wide enough to run into whatever's
          independently positioned in the opposite top corner (e.g. a
          "Sign Out" button at top-right, see EmployeeAttendance.tsx/
          EmployeeHome.tsx), since the two are unaware of each other's
          width. Shrinking this side is enough to clear that gap at every
          phone width without needing a shared layout container. */}
      <button
        onClick={goBack}
        aria-label="Back"
        className="flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 rounded-full bg-[var(--color-nexus-surface)]/90 backdrop-blur-md border border-[var(--color-nexus-border)] shadow-[0_4px_20px_rgba(37,99,235,0.08)] text-xs font-semibold text-[var(--color-nexus-ink)] hover:border-[var(--color-nexus-primary)] hover:text-[var(--color-nexus-primary)] transition-colors shrink-0"
      >
        <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden sm:inline">Back</span>
      </button>
      <button
        onClick={goToLanding}
        aria-label="Visit landing page"
        className="flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 rounded-full bg-[var(--color-nexus-surface)]/90 backdrop-blur-md border border-[var(--color-nexus-border)] shadow-[0_4px_20px_rgba(37,99,235,0.08)] text-xs font-semibold text-[var(--color-nexus-ink)] hover:border-[var(--color-nexus-primary)] hover:text-[var(--color-nexus-primary)] transition-colors shrink-0 truncate"
      >
        <Globe className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden sm:inline">Landing Page</span>
      </button>
    </motion.div>
  );
}
