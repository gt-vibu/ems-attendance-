import { useState, useEffect } from 'react';
import { AlertTriangle, Clock, CheckCircle2, LogOut } from 'lucide-react';
import { confirmWorking, type PresenceStatusUpdate } from '../lib/presenceHeartbeat';

export default function PresenceWarningModal({ onCheckout }: { onCheckout?: () => void }) {
  const [warningData, setWarningData] = useState<PresenceStatusUpdate['warning'] | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const handlePresenceUpdate = (e: Event) => {
      const detail = (e as CustomEvent<PresenceStatusUpdate>).detail;
      if (detail && detail.warning && detail.warning.remainingMins >= 0) {
        setWarningData(detail.warning);
      } else {
        setWarningData(null);
      }
    };

    window.addEventListener('presence-status-updated', handlePresenceUpdate);
    return () => window.removeEventListener('presence-status-updated', handlePresenceUpdate);
  }, []);

  if (!warningData) return null;

  const handleContinueWorking = async () => {
    setConfirming(true);
    const success = await confirmWorking();
    if (success) {
      setWarningData(null);
    }
    setConfirming(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-[var(--color-nexus-surface)] border-2 border-amber-500 rounded-2xl shadow-2xl p-6 text-center space-y-5">
        <div className="w-16 h-16 mx-auto bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center justify-center text-amber-500 animate-bounce">
          <AlertTriangle size={32} />
        </div>

        <div className="space-y-2">
          <h3 className="text-xl font-bold text-[var(--color-nexus-ink)]">Auto-Checkout Warning</h3>
          <p className="text-sm text-[var(--color-nexus-secondary)]">
            No activity detected after shift end. You will be automatically checked out in:
          </p>
        </div>

        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center gap-2 text-amber-600 font-mono font-bold text-2xl">
          <Clock size={24} />
          <span>{warningData.remainingMins} minute{warningData.remainingMins === 1 ? '' : 's'}</span>
        </div>

        <p className="text-xs text-[var(--color-nexus-muted)]">
          If you are still working, click below to extend your session. Otherwise, you will be checked out automatically.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            type="button"
            onClick={handleContinueWorking}
            disabled={confirming}
            className="flex-1 px-4 py-3 bg-[var(--color-nexus-primary)] hover:opacity-90 text-white font-bold text-sm rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <CheckCircle2 size={16} />
            {confirming ? 'Extending...' : 'Continue Working'}
          </button>

          {onCheckout && (
            <button
              type="button"
              onClick={onCheckout}
              className="px-4 py-3 bg-[var(--color-nexus-surface-alt)] hover:bg-red-50 text-red-600 border border-red-200 font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogOut size={16} />
              Check Out Now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
