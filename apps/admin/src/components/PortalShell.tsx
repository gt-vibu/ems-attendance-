import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, LogOut, Building2, Search, MoreHorizontal, User as UserIcon, Settings, ChevronDown, type LucideIcon } from 'lucide-react';
import PageChrome from './PageChrome';
import NotificationBell from './NotificationBell';

export interface PortalNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  count?: number;
}

// How many nav items fit comfortably in the mobile bottom tab bar before the
// remainder collapse into a "More" button that opens the same drawer used on
// desktop overflow. 4 keeps each tab wide enough to tap reliably; a 5th slot
// is reserved for "More" whenever there's more than 4 real destinations.
const BOTTOM_NAV_VISIBLE_COUNT = 4;

interface PortalShellProps {
  user: { name?: string; email?: string; role?: string };
  roleLabel?: string;
  navItems: PortalNavItem[];
  activeTab: string;
  onTabChange: (id: string) => void;
  onLogout: () => void;
  title: string;
  subtitle?: string;
  fallbackHref?: string;
  headerActions?: ReactNode;
  children: ReactNode;
}

// Reusable app shell (fixed sidebar + sticky top bar + mobile bottom nav)
// implementing the "Nexus Enterprise" design system approved to replace the
// app's prior "Ledger" look. Used by every authenticated screen (Dashboard,
// EmployeeDashboard, Payroll, Leave Management, Teams, Directory, Branches,
// Role Permissions) so restyling this one shell cascades everywhere at once.
export default function PortalShell({
  user, roleLabel, navItems, activeTab, onTabChange, onLogout, title, subtitle, fallbackHref = '/', headerActions, children,
}: PortalShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    navigate(`/tenant/directory?q=${encodeURIComponent(searchQuery.trim())}`);
  };

  // Close profile dropdown when clicking outside
  useEffect(() => {
    if (!profileDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(e.target as Node)) {
        setProfileDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [profileDropdownOpen]);

  const bottomNavItems = navItems.slice(0, BOTTOM_NAV_VISIBLE_COUNT);
  const moreNavItems = navItems.filter((item) => !bottomNavItems.some((b) => b.id === item.id) && item.id !== 'profile');
  const drawerItems = (moreNavItems.length > 0 ? moreNavItems : navItems).filter((item) => item.id !== 'profile');
  const hasOverflow = drawerItems.length > 0;

  const userInitial = (user.name || user.email || '?').charAt(0).toUpperCase();

  const SidebarContent = () => (
    <>
      <div className="px-4 py-4 flex items-center gap-2.5 border-b border-[var(--color-nexus-border)]">
        <div className="w-8 h-8 rounded-lg bg-[var(--color-nexus-primary)] flex items-center justify-center shrink-0">
          <Building2 className="w-4 h-4 text-white" size={15} />
        </div>
        <div className="min-w-0">
          <span className="font-sans font-bold text-[13px] text-[var(--color-nexus-ink)] tracking-tight block truncate leading-tight">Smart Teams EMS</span>
          <span className="text-[10.5px] text-[var(--color-nexus-muted)] tracking-wide block leading-tight mt-0.5">Enterprise Management Suite</span>
        </div>
      </div>

      <nav className="flex-1 px-2.5 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => { onTabChange(item.id); setMobileOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-[var(--radius-nexus-control)] text-[13px] font-medium transition-colors ${
                isActive
                  ? 'bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] font-semibold'
                  : 'text-[var(--color-nexus-secondary)] hover:bg-[var(--color-nexus-surface-alt)] hover:text-[var(--color-nexus-ink)]'
              }`}
            >
              <Icon size={16} strokeWidth={2} className="shrink-0" />
              <span className="flex-1 text-left truncate">{item.label}</span>
              {typeof item.count === 'number' && item.count > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/70 text-[var(--color-nexus-primary)]' : 'bg-[var(--color-nexus-surface-sunken)] text-[var(--color-nexus-muted)]'}`}>
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="px-2.5 py-2.5 border-t border-[var(--color-nexus-border)]">
        <div className="flex items-center gap-2.5 px-1.5 py-1.5 mb-1">
          <div className="w-8 h-8 rounded-full bg-[var(--color-nexus-primary)] flex items-center justify-center text-xs font-bold text-white shrink-0">
            {userInitial}
          </div>
          <div className="min-w-0">
            <span className="text-[12.5px] font-semibold text-[var(--color-nexus-ink)] block truncate leading-tight">{user.name || 'Account'}</span>
            <span className="text-[10.5px] text-[var(--color-nexus-muted)] block truncate leading-tight mt-0.5">{roleLabel || user.role || user.email}</span>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-2.5 px-1.5 py-1.5 rounded-[var(--radius-nexus-control)] text-[12.5px] font-medium text-[var(--color-nexus-muted)] hover:bg-[var(--color-nexus-error-soft)] hover:text-[var(--color-nexus-error)] transition-colors"
        >
          <LogOut size={15} />
          Sign Out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-dvh bg-[var(--color-nexus-bg)] font-sans text-[var(--color-nexus-ink)] flex flex-col md:flex-row">
      {/* Desktop fixed sidebar */}
      <aside className="hidden md:flex md:flex-col w-[236px] shrink-0 bg-[var(--color-nexus-surface)] border-r border-[var(--color-nexus-border)] sticky top-0 h-screen z-30">
        <SidebarContent />
      </aside>

      {/* Mobile Bottom Sheet Modal — Slack/Teams/Linear style */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-xs transition-opacity" onClick={() => setMobileOpen(false)} />
          <div className="relative bg-[var(--color-nexus-surface)] border-t border-[var(--color-nexus-border)] rounded-t-2xl max-h-[85vh] overflow-y-auto p-5 shadow-2xl space-y-4 animate-in slide-in-from-bottom duration-200">
            <div className="w-12 h-1.5 rounded-full bg-[var(--color-nexus-border)] mx-auto" />
            
            <div className="flex items-center justify-between border-b border-[var(--color-nexus-border)] pb-3">
              <div>
                <h3 className="text-base font-extrabold text-[var(--color-nexus-ink)]">Navigation & Tools</h3>
                <p className="text-xs text-[var(--color-nexus-muted)]">Smart Teams EMS Enterprise Suite</p>
              </div>
              <button onClick={() => setMobileOpen(false)} className="p-1.5 rounded-full text-[var(--color-nexus-muted)] hover:bg-[var(--color-nexus-surface-alt)]">
                <X size={20} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1 pb-4">
              {drawerItems.map((item) => {
                const isActive = activeTab === item.id;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => { onTabChange(item.id); setMobileOpen(false); }}
                    className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                      isActive
                        ? 'bg-blue-50 border-blue-200 text-blue-700 font-bold shadow-xs'
                        : 'bg-slate-50/80 border-slate-200/80 text-slate-800 hover:bg-blue-50/50 hover:border-blue-200'
                    }`}
                  >
                    <div className="p-2.5 rounded-xl bg-blue-600 text-white shadow-2xs shrink-0 flex items-center justify-center">
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-bold block truncate">{item.label}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-[var(--color-nexus-surface)] border-b border-[var(--color-nexus-border)] px-3 md:px-6 h-14 md:h-16 flex justify-between items-center gap-3 md:gap-4 sticky top-0 z-40">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <h1 className="font-sans font-bold text-[15px] md:text-[19px] text-[var(--color-nexus-ink)] tracking-tight truncate leading-tight">{title}</h1>
              {subtitle && <p className="hidden sm:block text-[12px] text-[var(--color-nexus-muted)] truncate mt-0.5">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            <form onSubmit={submitSearch} className="hidden sm:block relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-nexus-muted)]" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search employees, modules, reports…"
                className="w-64 rounded-lg border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] py-[7px] pl-9 pr-12 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary-fixed)] focus:bg-[var(--color-nexus-surface)]"
              />
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-[var(--color-nexus-muted)] bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded px-1.5 py-0.5">⌘K</kbd>
            </form>
            <NotificationBell />
            {/* Back + Landing buttons: desktop only */}
            <div className="hidden md:block">
              <PageChrome fallbackHref={fallbackHref} variant="compact" />
            </div>
            {headerActions}

            {/* Desktop: inline user info */}
            <div className="hidden md:flex items-center gap-2.5 pl-3 border-l border-[var(--color-nexus-border)]">
              <div className="w-8 h-8 rounded-full bg-[var(--color-nexus-primary-fixed)] flex items-center justify-center text-xs font-bold text-[var(--color-nexus-primary)] shrink-0" title={user.email}>
                {userInitial}
              </div>
              <div className="min-w-0 leading-tight">
                <span className="text-[12.5px] font-semibold text-[var(--color-nexus-ink)] block truncate max-w-[120px]">{user.name || 'Account'}</span>
                <span className="text-[10.5px] text-[var(--color-nexus-muted)] block truncate max-w-[120px]">{roleLabel || user.role}</span>
              </div>
            </div>

            {/* Mobile: profile avatar button → dropdown with Sign Out */}
            <div className="md:hidden relative" ref={profileDropdownRef}>
              <button
                onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                className="w-8 h-8 rounded-full bg-[var(--color-nexus-primary)] flex items-center justify-center text-[11px] font-bold text-white shrink-0 active:scale-95 transition-transform"
                aria-label="Account menu"
              >
                {userInitial}
              </button>
              {profileDropdownOpen && (
                <div className="absolute right-0 top-[calc(100%+8px)] w-56 max-w-[calc(100vw-2rem)] bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                  {/* User info */}
                  <div className="px-4 py-3 border-b border-[var(--color-nexus-border)]">
                    <p className="text-[13px] font-semibold text-[var(--color-nexus-ink)] truncate">{user.name || 'Account'}</p>
                    <p className="text-[11px] text-[var(--color-nexus-muted)] truncate mt-0.5">{roleLabel || user.role}</p>
                    {user.email && <p className="text-[10px] text-[var(--color-nexus-muted)] truncate mt-0.5">{user.email}</p>}
                  </div>
                  {/* Actions */}
                  <div className="py-1">
                    <button
                      onClick={() => { setProfileDropdownOpen(false); onTabChange('profile'); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12.5px] font-medium text-[var(--color-nexus-ink)] hover:bg-[var(--color-nexus-surface-alt)] transition-colors"
                    >
                      <UserIcon size={14} className="text-[var(--color-nexus-muted)]" />
                      Profile
                    </button>
                  </div>
                  {/* Sign Out */}
                  <div className="border-t border-[var(--color-nexus-border)] py-1">
                    <button
                      onClick={() => { setProfileDropdownOpen(false); onLogout(); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12.5px] font-medium text-[var(--color-nexus-error)] hover:bg-[var(--color-nexus-error-soft)] transition-colors"
                    >
                      <LogOut size={14} />
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto p-3 md:p-6 w-full pb-16 md:pb-6">
          {children}
        </main>
      </div>

      {/* Mobile bottom tab bar — Sign Out removed; now lives in the
          profile avatar dropdown in the top-right header. */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full z-40 flex items-stretch bg-[var(--color-nexus-surface)] border-t border-[var(--color-nexus-border)] shadow-[0_-2px_8px_rgba(25,28,30,0.06)] h-14">
        {bottomNavItems.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                isActive ? 'text-[var(--color-nexus-primary)] font-bold' : 'text-[var(--color-nexus-muted)]'
              }`}
            >
              <Icon size={18} />
              <span className="text-[9px] font-semibold truncate max-w-[72px]">{item.label}</span>
            </button>
          );
        })}
        {hasOverflow && (
          <button
            onClick={() => setMobileOpen(true)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[var(--color-nexus-muted)]"
          >
            <MoreHorizontal size={18} />
            <span className="text-[9px] font-semibold">More</span>
          </button>
        )}
      </nav>
    </div>
  );
}
