import { Fingerprint } from 'lucide-react';

interface AnimatedLogoProps {
  size?: number;
  label?: string;
  subtitle?: string;
  className?: string;
}

// Brand mark: the same Fingerprint glyph already used as the app's logo in
// PortalShell's sidebar, promoted to a full animated seal — a gradient ring
// traces itself in (.draw-in, index.css), the badge underneath pulses like
// an active biometric scan (.pulse-ring), and the whole thing gently floats
// (.float-c). Reused wherever a login needs to hand off to its destination
// (see the 'transition' view in Login.tsx / EmployeeLogin.tsx) rather than
// building a one-off splash per page.
export default function AnimatedLogo({ size = 96, label = 'Smart Teams', subtitle, className = '' }: AnimatedLogoProps) {
  const ringRadius = 46;
  const circumference = 2 * Math.PI * ringRadius;

  return (
    <div className={`flex flex-col items-center gap-4 ${className}`}>
      <div className="relative float-c" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" width={size} height={size} className="absolute inset-0 -rotate-90">
          <circle
            cx="50" cy="50" r={ringRadius}
            fill="none" stroke="url(#animatedLogoGradient)" strokeWidth="3" strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference}
            className="draw-in"
          />
          <defs>
            <linearGradient id="animatedLogoGradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#7B5CFA" />
              <stop offset="60%" stopColor="#22C7B8" />
              <stop offset="100%" stopColor="#F5B94D" />
            </linearGradient>
          </defs>
        </svg>
        <div
          className="absolute inset-[12%] rounded-full flex items-center justify-center pulse-ring shadow-[0_10px_36px_-8px_rgba(123,92,250,0.55)]"
          style={{ background: 'linear-gradient(135deg, var(--color-premium-accent), var(--color-premium-accent-2))' }}
        >
          <Fingerprint className="text-white" size={size * 0.42} strokeWidth={1.75} />
        </div>
      </div>
      <div className="text-center">
        <span className="block font-display font-extrabold text-xl text-gradient">{label}</span>
        {subtitle && (
          <span className="block text-[11px] text-[var(--color-premium-muted)] font-mono uppercase tracking-widest mt-1">
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
}
