import PushNotificationToggle from '../../components/PushNotificationToggle';

// Shared "System Notifications" panel — shown at Super Admin > Admin Inbox
// and Tenant Admin > Administration > Notifications. Extracted verbatim.
export default function NotificationsTab({ notifications }: { notifications: any[] }) {
  return (
    <div className="nexus-card rounded-3xl p-6">
      <h2 className="text-lg font-bold text-gradient mb-4 font-sans">System Notifications</h2>
      <div className="mb-6"><PushNotificationToggle /></div>
      {notifications.length === 0 ? (
        <p className="text-sm text-[var(--color-nexus-muted)] text-center py-12">No notifications found.</p>
      ) : (
        <div className="space-y-4">
          {notifications.map((notif) => (
            <div key={notif.id} className="p-4 bg-[var(--color-nexus-surface-alt)] rounded-2xl border border-[var(--color-nexus-border)] flex justify-between items-start gap-4">
              <div>
                <h4 className="text-xs font-bold text-[var(--color-nexus-ink)] uppercase tracking-wider">{notif.title}</h4>
                <p className="text-xs text-[var(--color-nexus-muted)] mt-1">{notif.message}</p>
                <span className="text-[10px] text-[var(--color-nexus-muted)] mt-2 block">{new Date(notif.createdAt).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
