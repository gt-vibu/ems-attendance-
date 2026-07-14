import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Lock, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import PageChrome from '../components/PageChrome';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('This reset link is missing its token. Please request a new one.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset password');
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err: any) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen premium-mesh-bg flex items-center justify-center p-6 font-sans relative overflow-hidden">
      <PageChrome fallbackHref="/login" />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-md w-full glass-card rounded-3xl p-8 relative z-10"
      >
        {!done ? (
          <>
            <div className="text-center mb-8">
              <div className="w-14 h-14 rounded-2xl bg-[var(--color-premium-accent-soft)] flex items-center justify-center mx-auto mb-4 float-c">
                <Lock className="w-6 h-6 text-[var(--color-premium-accent)]" />
              </div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-gradient inline-block">Reset Password</h1>
              <p className="text-sm text-[var(--color-premium-muted)] mt-2 font-medium">Choose a new password for your account.</p>
            </div>

            {error && (
              <div className="bg-[var(--color-premium-danger-soft)] text-[var(--color-premium-danger)] text-xs p-3 rounded-lg mb-6 border border-[var(--color-premium-danger)]/20 font-medium">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--color-premium-ink)] mb-1.5 uppercase tracking-wider">New Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    className="w-full px-4 py-3 pr-11 bg-[var(--color-premium-surface-alt)] border border-[var(--color-premium-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-premium-accent)]/20 focus:border-[var(--color-premium-accent)] transition-all font-medium"
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
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--color-premium-ink)] mb-1.5 uppercase tracking-wider">Confirm Password</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-[var(--color-premium-surface-alt)] border border-[var(--color-premium-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-premium-accent)]/20 focus:border-[var(--color-premium-accent)] transition-all font-medium"
                  placeholder="••••••••"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[var(--color-premium-accent)] text-white rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider hover:bg-[var(--color-premium-accent-hover)] transition-colors disabled:opacity-50 mt-2 shadow-[0_8px_24px_rgba(123,92,250,0.3)]"
              >
                {loading ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          </>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center py-4"
          >
            <div className="w-14 h-14 rounded-2xl bg-[var(--color-premium-accent-2-soft)] flex items-center justify-center mx-auto mb-4 pulse-ring">
              <CheckCircle2 className="w-7 h-7 text-[var(--color-premium-accent-2)]" />
            </div>
            <h1 className="font-display text-xl font-bold tracking-tight text-[var(--color-premium-ink)]">Password updated</h1>
            <p className="text-sm text-[var(--color-premium-muted)] mt-2 font-medium">Taking you to sign in...</p>
          </motion.div>
        )}

        {!done && (
          <div className="mt-6 text-center">
            <Link
              to="/forgot-password"
              className="text-xs text-[var(--color-premium-muted)] font-semibold hover:text-[var(--color-premium-accent)] transition-colors uppercase tracking-wider"
            >
              Request a new link
            </Link>
          </div>
        )}
      </motion.div>
    </div>
  );
}
