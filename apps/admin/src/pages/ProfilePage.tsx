import { useState, useEffect } from 'react';
import { User, Mail, Phone, Calendar, Building, ShieldCheck, Clock, MapPin, Key, Bell, LogOut, CheckCircle2, Lock } from 'lucide-react';

interface ProfilePageProps {
  user: any;
  tenant: any;
  authHeaders: Record<string, string>;
  onLogout: () => void;
}

export default function ProfilePage({ user, tenant, authHeaders, onLogout }: ProfilePageProps) {
  const [notificationPrefs, setNotificationPrefs] = useState<{ email: boolean; in_app: boolean }>({ email: true, in_app: true });
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefStatusMsg, setPrefStatusMsg] = useState('');

  useEffect(() => {
    fetch('/api/employees/me/profile', { headers: authHeaders })
      .then(async (r) => {
        let body: any = null;
        try { body = await r.json(); } catch {}
        if (r.ok && body?.preferences) {
          setNotificationPrefs(body.preferences);
        }
      })
      .catch(() => {});
  }, [authHeaders]);

  const handleTogglePref = async (channel: 'email' | 'in_app', checked: boolean) => {
    const next = { ...notificationPrefs, [channel]: checked };
    setNotificationPrefs(next);
    setSavingPrefs(true);
    setPrefStatusMsg('');
    try {
      const res = await fetch('/api/employees/me/notification-preferences', {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (res.ok) {
        setPrefStatusMsg('Saved preferences');
        setTimeout(() => setPrefStatusMsg(''), 3000);
      }
    } catch {
      setPrefStatusMsg('Failed to save');
    } finally {
      setSavingPrefs(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-6 md:pb-6">
      {/* Top Banner / Hero Card */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 text-white shadow-xl border border-slate-800">
        <div className="flex flex-col sm:flex-row items-center gap-5">
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-indigo-600/30 border-2 border-indigo-400/40 flex items-center justify-center text-2xl font-bold text-white shadow-inner uppercase">
              {user.name ? user.name.slice(0, 2) : (user.email ? user.email.slice(0, 2) : 'EM')}
            </div>
            <span className="absolute bottom-0 right-0 w-5 h-5 rounded-full bg-emerald-500 border-2 border-slate-900" title="Active Employee" />
          </div>

          <div className="text-center sm:text-left space-y-1">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
              <h1 className="text-xl sm:text-2xl font-extrabold text-white">{user.name || 'Employee'}</h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 uppercase tracking-wide">
                {user.role || 'Staff'}
              </span>
            </div>
            <p className="text-xs text-slate-300 font-medium">{user.designation || user.role} • {user.department || 'General Department'}</p>
            <p className="text-[11px] text-slate-400">{user.email} • ID: #{user.id || 'EMP-001'}</p>
          </div>
        </div>
      </div>

      {/* Grid of Profile Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Personal Information */}
        <div className="nexus-card p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-[var(--color-nexus-border)] pb-3">
            <User className="text-[var(--color-nexus-primary)]" size={18} />
            <h2 className="text-sm font-bold text-[var(--color-nexus-ink)] uppercase tracking-wide">Personal Information</h2>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase">Full Name</span>
              <span className="font-semibold text-[var(--color-nexus-ink)]">{user.name || '—'}</span>
            </div>

            <div>
              <span className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase">Employee ID</span>
              <span className="font-mono font-semibold text-[var(--color-nexus-ink)]">#{user.id || '—'}</span>
            </div>

            <div>
              <span className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase">Work Email</span>
              <span className="font-semibold text-[var(--color-nexus-ink)] truncate block">{user.email || '—'}</span>
            </div>

            <div>
              <span className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase">Phone Number</span>
              <span className="font-semibold text-[var(--color-nexus-ink)]">{user.phone || '+91 (Configured)'}</span>
            </div>

            <div>
              <span className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase">Date of Joining</span>
              <span className="font-semibold text-[var(--color-nexus-ink)]">{user.dateOfJoining || 'Jul 12, 2026'}</span>
            </div>

            <div>
              <span className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase">Branch / Office</span>
              <span className="font-semibold text-[var(--color-nexus-ink)]">{user.branchName || tenant?.name || 'Headquarters'}</span>
            </div>
          </div>
        </div>

        {/* Employment Details */}
        <div className="nexus-card p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-[var(--color-nexus-border)] pb-3">
            <Building className="text-[var(--color-nexus-primary)]" size={18} />
            <h2 className="text-sm font-bold text-[var(--color-nexus-ink)] uppercase tracking-wide">Employment Details</h2>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase">Employment Type</span>
              <span className="font-semibold text-[var(--color-nexus-ink)] uppercase">{user.employmentType || 'Full-Time'}</span>
            </div>

            <div>
              <span className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase">Reporting Manager</span>
              <span className="font-semibold text-[var(--color-nexus-ink)]">{user.managerName || 'Direct Supervisor'}</span>
            </div>

            <div>
              <span className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase">Assigned Shift</span>
              <span className="font-semibold text-[var(--color-nexus-ink)]">{tenant?.shiftStart || '09:00'} - {tenant?.shiftEnd || '18:00'}</span>
            </div>

            <div>
              <span className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase">Work Location</span>
              <span className="font-semibold text-[var(--color-nexus-ink)]">{tenant?.name || 'Main Campus'}</span>
            </div>

            <div>
              <span className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase">Employment Status</span>
              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600">
                <CheckCircle2 size={12} /> Active
              </span>
            </div>

            <div>
              <span className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase">Role Privileges</span>
              <span className="font-semibold text-[var(--color-nexus-ink)]">{user.role === 'admin' ? 'Full HRMS Access' : 'Standard Employee'}</span>
            </div>
          </div>
        </div>

        {/* Notification Preferences */}
        <div className="nexus-card p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--color-nexus-border)] pb-3">
            <div className="flex items-center gap-2">
              <Bell className="text-[var(--color-nexus-primary)]" size={18} />
              <h2 className="text-sm font-bold text-[var(--color-nexus-ink)] uppercase tracking-wide">Notification Preferences</h2>
            </div>
            {prefStatusMsg && <span className="text-[10px] font-bold text-emerald-600">{prefStatusMsg}</span>}
          </div>

          <p className="text-xs text-[var(--color-nexus-muted)]">Configure how you receive automated payroll, attendance, and leave updates.</p>

          <div className="space-y-3 pt-1">
            <label className="flex items-center justify-between text-xs font-semibold text-[var(--color-nexus-ink)] cursor-pointer">
              <span>Email Notifications</span>
              <input
                type="checkbox"
                checked={notificationPrefs.email}
                disabled={savingPrefs}
                onChange={(e) => handleTogglePref('email', e.target.checked)}
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
              />
            </label>

            <label className="flex items-center justify-between text-xs font-semibold text-[var(--color-nexus-ink)] cursor-pointer">
              <span>In-App Notifications</span>
              <input
                type="checkbox"
                checked={notificationPrefs.in_app}
                disabled={savingPrefs}
                onChange={(e) => handleTogglePref('in_app', e.target.checked)}
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
              />
            </label>

            <div className="flex items-center justify-between text-xs text-slate-400 opacity-60">
              <span>SMS Notifications</span>
              <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">Coming Soon</span>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-400 opacity-60">
              <span>Push Notifications</span>
              <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">Coming Soon</span>
            </div>
          </div>
        </div>

        {/* Security & Authentication */}
        <div className="nexus-card p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-[var(--color-nexus-border)] pb-3">
            <Lock className="text-[var(--color-nexus-primary)]" size={18} />
            <h2 className="text-sm font-bold text-[var(--color-nexus-ink)] uppercase tracking-wide">Security & Authentication</h2>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[var(--color-nexus-muted)]">Last Login</span>
              <span className="font-semibold text-[var(--color-nexus-ink)]">{new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[var(--color-nexus-muted)]">Password Status</span>
              <span className="font-semibold text-emerald-600 font-medium">Secured</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[var(--color-nexus-muted)]">Two-Factor Authentication (2FA)</span>
              <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-500 px-2 py-0.5 rounded">Disabled</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[var(--color-nexus-muted)]">Active Session</span>
              <span className="font-mono text-[11px] text-[var(--color-nexus-ink)]">Current Device</span>
            </div>
          </div>
        </div>
      </div>

      {/* Account Actions & Sign Out */}
      <div className="nexus-card p-5 flex flex-col sm:flex-row items-center justify-between gap-4 border border-rose-200 dark:border-rose-900/30 bg-rose-50/30 dark:bg-rose-950/10">
        <div>
          <h3 className="text-sm font-bold text-rose-700 dark:text-rose-400">Account Session</h3>
          <p className="text-xs text-[var(--color-nexus-muted)]">Sign out of Smart Teams EMS on this browser session.</p>
        </div>

        <button
          onClick={onLogout}
          className="w-full sm:w-auto px-6 py-2.5 rounded-xl font-bold text-xs bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center gap-2 shadow-md transition"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </div>
  );
}
