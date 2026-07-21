import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

type PushState = 'unsupported' | 'unconfigured' | 'loading' | 'subscribed' | 'unsubscribed' | 'denied';

// Self-service push opt-in — same "every user does this for themselves"
// convention as WebAuthn device registration. Works via the browser Web
// Push API (VAPID), delivered through the existing service worker (see
// public/sw.js's 'push' handler) — a real native FCM/APNs integration
// would need this app published to the App/Play stores with its own push
// credentials, which is a separate undertaking; this is what's actually
// deliverable as a web app plus the Capacitor wrapper already in the repo.
export default function PushNotificationToggle() {
  const token = localStorage.getItem('auth_token');
  const [state, setState] = useState<PushState>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const check = async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setState('unsupported');
        return;
      }
      const configRes = await fetch('/api/push/vapid-public-key', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()).catch(() => null);
      if (!configRes?.configured) {
        setState('unconfigured');
        return;
      }
      if (Notification.permission === 'denied') {
        setState('denied');
        return;
      }
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      const existing = reg ? await reg.pushManager.getSubscription() : null;
      setState(existing ? 'subscribed' : 'unsubscribed');
    };
    check();
  }, [token]);

  const handleSubscribe = async () => {
    setBusy(true);
    setError('');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'unsubscribed');
        return;
      }
      const { publicKey } = await fetch('/api/push/vapid-public-key', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!res.ok) throw new Error('Failed to save subscription.');
      setState('subscribed');
    } catch (err: any) {
      setError(err.message || 'Could not enable push notifications.');
    } finally {
      setBusy(false);
    }
  };

  const handleUnsubscribe = async () => {
    setBusy(true);
    setError('');
    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();
      if (subscription) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setState('unsubscribed');
    } catch (err: any) {
      setError(err.message || 'Could not disable push notifications.');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading' || state === 'unsupported' || state === 'unconfigured') return null;

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-[var(--color-nexus-surface-alt)] px-4 py-3">
      {state === 'subscribed' ? <Bell size={16} className="text-[var(--color-nexus-primary)] shrink-0" /> : <BellOff size={16} className="text-[var(--color-nexus-muted)] shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-[var(--color-nexus-ink)]">Push Notifications</p>
        <p className="text-[10px] text-[var(--color-nexus-muted)]">
          {state === 'denied' ? 'Blocked in your browser settings — enable notifications for this site to turn this on.'
            : state === 'subscribed' ? 'Enabled on this device.' : 'Get tickets, alerts, and approvals as push notifications, even when this tab is closed.'}
        </p>
        {error && <p className="text-[10px] text-[var(--color-nexus-error)] mt-1">{error}</p>}
      </div>
      {state !== 'denied' && (
        <button
          type="button"
          onClick={state === 'subscribed' ? handleUnsubscribe : handleSubscribe}
          disabled={busy}
          className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-3.5 py-2 rounded-xl transition-colors disabled:opacity-50 ${
            state === 'subscribed' ? 'bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] text-[var(--color-nexus-ink)]' : 'bg-[var(--color-nexus-primary)] text-white hover:bg-[var(--color-nexus-primary-hover)]'
          }`}
        >
          {busy ? '...' : state === 'subscribed' ? 'Disable' : 'Enable'}
        </button>
      )}
    </div>
  );
}
