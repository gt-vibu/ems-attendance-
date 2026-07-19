import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';

type Notification = {
  id: number;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
};

// Self-contained notification bell — fetches the caller's own real
// notifications (holiday declared, shift changed, salary changed; see
// api/services/notifications.ts for the writers and
// GET/POST /api/tenant/notifications* in tenant.routes.ts for the reads),
// polls for new ones, and lets the user mark them read. Dropped into
// PortalShell's header so it's available on every authenticated page.
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const token = localStorage.getItem('auth_token');
  const authHeaders = { Authorization: `Bearer ${token}` };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const fetchNotifications = async () => {
    try {
      const res = await fetch('/api/tenant/notifications', { headers: authHeaders });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
    } catch {
      // Best-effort — the bell just stays at its last known state on a network hiccup.
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const markRead = async (id: number) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    try {
      await fetch(`/api/tenant/notifications/${id}/read`, { method: 'POST', headers: authHeaders });
    } catch {
      // Non-critical — local state already reflects read, worst case it re-shows as unread next poll.
    }
  };

  const markAllRead = async () => {
    setLoading(true);
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    try {
      await fetch('/api/tenant/notifications/read-all', { method: 'POST', headers: authHeaders });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-full text-[var(--color-nexus-muted)] hover:bg-[var(--color-nexus-surface-alt)] hover:text-[var(--color-nexus-ink)]"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--color-nexus-error)] text-white text-[9px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-h-[28rem] overflow-y-auto rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] shadow-xl z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-nexus-border)]">
            <h3 className="text-sm font-bold text-[var(--color-nexus-ink)]">Notifications</h3>
            {unreadCount > 0 && (
              <button type="button" disabled={loading} onClick={markAllRead} className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-nexus-primary)] hover:underline disabled:opacity-50">
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-[var(--color-nexus-muted)]">No notifications yet.</div>
          ) : (
            <div className="divide-y divide-[var(--color-nexus-border)]">
              {notifications.map((n) => (
                <button
                  type="button"
                  key={n.id}
                  onClick={() => !n.isRead && markRead(n.id)}
                  className={`w-full text-left px-4 py-3 hover:bg-[var(--color-nexus-surface-alt)] transition-colors ${!n.isRead ? 'bg-[var(--color-nexus-primary-fixed)]/40' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    {!n.isRead && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[var(--color-nexus-primary)] shrink-0" />}
                    <div className="min-w-0">
                      <span className="block text-xs font-bold text-[var(--color-nexus-ink)]">{n.title}</span>
                      <span className="block text-[11px] text-[var(--color-nexus-muted)] mt-0.5">{n.message}</span>
                      <span className="block text-[10px] text-[var(--color-nexus-muted)]/70 mt-1">{new Date(n.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
