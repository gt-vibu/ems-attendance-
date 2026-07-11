import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Mail, CheckCircle2, ArrowLeft } from 'lucide-react';
import PageChrome from '../components/PageChrome';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      // Always treat as success — the backend deliberately returns a
      // generic response regardless of whether the email matched, to avoid
      // leaking which emails have accounts.
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Something went wrong. Please try again.');
      }
      setSent(true);
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
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
        {!sent ? (
          <>
            <div className="text-center mb-8">
              <div className="w-14 h-14 rounded-2xl bg-[var(--color-premium-accent-soft)] flex items-center justify-center mx-auto mb-4">
                <Mail className="w-6 h-6 text-[var(--color-premium-accent)]" />
              </div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--color-premium-ink)]">Forgot Password</h1>
              <p className="text-sm text-[var(--color-premium-muted)] mt-2 font-medium">
                Enter your email and we'll send you a link to reset your password.
              </p>
            </div>

            {error && (
              <div className="bg-[var(--color-premium-danger-soft)] text-[var(--color-premium-danger)] text-xs p-3 rounded-lg mb-6 border border-[var(--color-premium-danger)]/20 font-medium">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--color-premium-ink)] mb-1.5 uppercase tracking-wider">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-[var(--color-premium-surface-alt)] border border-[var(--color-premium-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-premium-accent)]/20 focus:border-[var(--color-premium-accent)] transition-all font-medium"
                  placeholder="admin@smartteams.com"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[var(--color-premium-accent)] text-white rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider hover:bg-[var(--color-premium-accent-hover)] transition-colors disabled:opacity-50 mt-2 shadow-[0_8px_24px_rgba(123,92,250,0.3)]"
              >
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </form>
          </>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center py-4"
          >
            <div className="w-14 h-14 rounded-2xl bg-[var(--color-premium-accent-2-soft)] flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-7 h-7 text-[var(--color-premium-accent-2)]" />
            </div>
            <h1 className="font-display text-xl font-bold tracking-tight text-[var(--color-premium-ink)]">Check your inbox</h1>
            <p className="text-sm text-[var(--color-premium-muted)] mt-2 font-medium">
              If an account exists for <span className="font-semibold text-[var(--color-premium-ink)]">{email}</span>, a password reset link has been sent.
            </p>
          </motion.div>
        )}

        <div className="mt-6 text-center">
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-xs text-[var(--color-premium-muted)] font-semibold hover:text-[var(--color-premium-accent)] transition-colors uppercase tracking-wider"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Sign In
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
