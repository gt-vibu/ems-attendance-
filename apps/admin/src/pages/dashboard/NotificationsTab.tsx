import PushNotificationToggle from '../../components/PushNotificationToggle';
import { BellRing, Clock } from 'lucide-react';

// Shared "System Notifications" panel — shown at Super Admin > Admin Inbox
// and Tenant Admin > Administration > Notifications. Clean compact enterprise style.
export default function NotificationsTab({ notifications }: { notifications: any[] }) {
  return (
    <div className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl p-5 shadow-xs space-y-4">
      <div className="flex items-center justify-between border-b border-[var(--color-nexus-border)] pb-4">
        <div>
          <h2 className="text-base font-extrabold text-[var(--color-nexus-ink)] font-sans flex items-center gap-2">
            <BellRing size={18} className="text-[var(--color-nexus-primary)]" />
            System Notifications
          </h2>
          <p className="text-xs text-[var(--color-nexus-muted)] mt-0.5">Real-time platform logs, escalations, and automated operational updates.</p>
        </div>
        <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] border border-[var(--color-nexus-primary)]/20">
          {notifications.length} Total
        </span>
      </div>

      <div className="mb-2">
        <PushNotificationToggle />
      </div>

      {notifications.length === 0 ? (
        <p className="text-xs text-[var(--color-nexus-muted)] text-center py-10 font-medium">No notifications recorded.</p>
      ) : (
        <div className="divide-y divide-[var(--color-nexus-border)] border border-[var(--color-nexus-border)] rounded-xl overflow-hidden bg-[var(--color-nexus-surface)]">
          {notifications.map((notif) => (
            <div key={notif.id} className="p-3.5 hover:bg-[var(--color-nexus-surface-alt)]/60 transition-colors flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[var(--color-nexus-primary)] shrink-0 mt-1.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-bold text-[var(--color-nexus-ink)] uppercase tracking-wider truncate">{notif.title}</h4>
                  <span className="text-[10px] text-[var(--color-nexus-muted)] font-mono shrink-0 flex items-center gap-1">
                    <Clock size={11} />
                    {new Date(notif.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-[12px] text-[var(--color-nexus-secondary)] mt-1 leading-normal font-medium">{notif.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
