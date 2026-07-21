import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Eye, EyeOff } from 'lucide-react';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { User } from '../lib/auth';
import { GOOGLE_CLIENT_ID, loginWithGoogleCredential } from '../lib/googleAuth';
import PageChrome from '../components/PageChrome';
import AuroraField from '../three/AuroraField';
import AnimatedLogo from '../components/AnimatedLogo';

export default function EmployeeLogin({ onLogin }: { onLogin: (u: User) => void }) {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // States for resetting password. 'transition' is the brief animated
  // hand-off shown after a successful login, before routeAfterLogin
  // actually navigates — see completeLogin below.
  const [viewState, setViewState] = useState<'login' | 'reset_password' | 'transition'>('login');
  const [tempToken, setTempToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  const navigate = useNavigate();

  // Get or create unique device ID
  const getDeviceFingerprint = () => {
    let deviceId = localStorage.getItem('device_fingerprint');
    if (!deviceId) {
      deviceId = 'device_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('device_fingerprint', deviceId);
    }
    return deviceId;
  };

  // Prefill email and password from URL
  useEffect(() => {
    const urlEmail = searchParams.get('email');
    const urlTemp = searchParams.get('temp');
    if (urlEmail) setEmail(urlEmail);
    if (urlTemp) setPassword(urlTemp);
  }, [searchParams]);

  const routeAfterLogin = (user: User) => {
    // Device registration is a company-wide switch — skip it entirely for a
    // company that has turned it off, regardless of isKycCompleted.
    if (user.kycEnabled !== false && !user.isKycCompleted) {
      navigate('/employee/register-device');
      return;
    }
    // Preserves a QR Attendance deep link across the login detour ("do not
    // lose QR session during login") — only honored once device registration
    // is already done, since every attendance mode requires that regardless.
    const next = searchParams.get('next');
    if (next && next.startsWith('/qr/')) {
      navigate(next);
    } else {
      navigate('/employee/attendance');
    }
  };

  const completeLogin = (data: { token: string; user: User }) => {
    localStorage.setItem('auth_token', data.token);
    onLogin(data.user);
    // Brief animated hand-off before routing to device registration/
    // attendance/QR, rather than navigating instantly.
    setViewState('transition');
    setTimeout(() => routeAfterLogin(data.user), 1800);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const deviceId = getDeviceFingerprint();

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, deviceId })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to authenticate');

      if (data.requirePasswordChange) {
        setTempToken(data.tempToken);
        setViewState('reset_password');
        return;
      }

      completeLogin(data);
    } catch (err: any) {
      setError(err.message || 'Failed to authenticate');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSuccess = async (credentialResponse: { credential?: string }) => {
    setError('');
    if (!credentialResponse.credential) {
      setError('Google sign-in did not return a credential. Please try again.');
      return;
    }
    setLoading(true);
    try {
      const data = await loginWithGoogleCredential(credentialResponse.credential, getDeviceFingerprint());
      completeLogin(data);
    } catch (err: any) {
      setError(err.message || 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tempToken}`
        },
        body: JSON.stringify({ newPassword })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset password');

      completeLogin(data);
    } catch (err: any) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  const inputClasses = "w-full px-4 py-3 bg-[var(--color-premium-surface-alt)] border border-[var(--color-premium-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-premium-accent)]/20 focus:border-[var(--color-premium-accent)] transition-all font-medium text-[var(--color-premium-ink)]";
  const labelClasses = "block text-xs font-semibold text-[var(--color-premium-ink)] mb-1.5 uppercase tracking-wider";
  const buttonClasses = "w-full bg-[var(--color-premium-accent)] text-white rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider hover:bg-[var(--color-premium-accent-hover)] transition-colors disabled:opacity-50 mt-4 shadow-[0_8px_24px_rgba(37,99,235,0.3)]";

  return (
    <div className="min-h-screen premium-mesh-bg flex items-center justify-center p-6 font-sans relative overflow-hidden">
      <AuroraField />
      <PageChrome fallbackHref="/" />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-md w-full glass-card rounded-3xl p-8 relative z-10"
      >
        <AnimatePresence mode="wait">
        {viewState === 'login' && (
          <motion.div key="login" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="text-center mb-8">
              <h1 className="font-display text-2xl font-bold tracking-tight text-gradient inline-block">Employee Login</h1>
              <p className="text-sm text-[var(--color-premium-muted)] mt-2 font-medium">Verify your device and clock in</p>
            </div>

            {error && (
              <div className="bg-[var(--color-premium-danger-soft)] text-[var(--color-premium-danger)] text-xs p-3 rounded-lg mb-6 border border-[var(--color-premium-danger)]/20 font-medium">
                {error}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className={labelClasses}>Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className={inputClasses}
                  placeholder="jane@company.com"
                  required
                />
              </div>
              <div>
                <label className={labelClasses}>Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className={`${inputClasses} pr-11`}
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(s => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-premium-muted)] hover:text-[var(--color-premium-accent)] transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <div className="text-right mt-1.5">
                  <button
                    type="button"
                    onClick={() => navigate('/forgot-password')}
                    className="text-xs text-[var(--color-premium-muted)] font-semibold hover:text-[var(--color-premium-accent)] transition-colors"
                  >
                    Forgot password?
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className={buttonClasses}
              >
                {loading ? 'Authenticating...' : 'Sign In'}
              </button>
            </form>

            {GOOGLE_CLIENT_ID && (
              <>
                <div className="flex items-center gap-3 my-5">
                  <div className="h-px flex-1 bg-[var(--color-premium-border)]" />
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--color-premium-muted)]">or</span>
                  <div className="h-px flex-1 bg-[var(--color-premium-border)]" />
                </div>
                <div className="flex justify-center">
                  <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
                    <GoogleLogin onSuccess={handleGoogleSuccess} onError={() => setError('Google sign-in failed')} />
                  </GoogleOAuthProvider>
                </div>
              </>
            )}
          </motion.div>
        )}

        {viewState === 'reset_password' && (
          <motion.div key="reset" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="text-center mb-8">
              <h1 className="font-display text-2xl font-bold tracking-tight text-gradient inline-block">Set Permanent Password</h1>
              <p className="text-sm text-[var(--color-premium-muted)] mt-2 font-medium">Create your secure password to complete activation</p>
            </div>

            {error && (
              <div className="bg-[var(--color-premium-danger-soft)] text-[var(--color-premium-danger)] text-xs p-3 rounded-lg mb-6 border border-[var(--color-premium-danger)]/20 font-medium">
                {error}
              </div>
            )}

            <form onSubmit={handlePasswordReset} className="space-y-4">
              <div>
                <label className={labelClasses}>New Password</label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    className={`${inputClasses} pr-11`}
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(s => !s)}
                    aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-premium-muted)] hover:text-[var(--color-premium-accent)] transition-colors"
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className={labelClasses}>Confirm Password</label>
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className={inputClasses}
                  placeholder="••••••••"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className={buttonClasses}
              >
                {loading ? 'Activating Account...' : 'Confirm password'}
              </button>
            </form>
          </motion.div>
        )}

        {viewState === 'transition' && (
          <motion.div key="transition" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-8">
            <AnimatedLogo subtitle="Signing you in…" />
          </motion.div>
        )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
