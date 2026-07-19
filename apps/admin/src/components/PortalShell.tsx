import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, X, LogOut, Building2, Search, MoreHorizontal, type LucideIcon } from 'lucide-react';
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
  const navigate = useNavigate();

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    navigate(`/tenant/directory?q=${encodeURIComponent(searchQuery.trim())}`);
  };

  const bottomNavItems = navItems.slice(0, BOTTOM_NAV_VISIBLE_COUNT);
  const hasOverflow = navItems.length > BOTTOM_NAV_VISIBLE_COUNT;

  const SidebarContent = () => (
    <>
      <div className="px-5 py-5 flex items-center gap-2.5 border-b border-[var(--color-nexus-border)]">
        <div className="w-8 h-8 rounded-lg bg-[var(--color-nexus-primary)] flex items-center justify-center shrink-0">
          <Building2 className="w-4 h-4 text-white" size={16} />
        </div>
        <div className="min-w-0">
          <span className="font-sans font-bold text-sm text-[var(--color-nexus-ink)] tracking-tight block truncate leading-tight">Smart Teams</span>
          <span className="text-[10px] text-[var(--color-nexus-muted)] tracking-wide block leading-tight">{roleLabel || user.role}</span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => { onTabChange(item.id); setMobileOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-[var(--radius-nexus-control)] text-[13px] font-semibold transition-colors ${
                isActive
                  ? 'bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-ink)]'
                  : 'text-[var(--color-nexus-muted)] hover:bg-[var(--color-nexus-surface-alt)] hover:text-[var(--color-nexus-ink)]'
              }`}
            >
              <Icon size={17} className="shrink-0" />
              <span className="flex-1 text-left truncate">{item.label}</span>
              {typeof item.count === 'number' && item.count > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/70 text-[var(--color-nexus-ink)]' : 'bg-[var(--color-nexus-surface-sunken)] text-[var(--color-nexus-muted)]'}`}>
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="px-3 py-3 border-t border-[var(--color-nexus-border)]">
        <div className="flex items-center gap-2.5 px-2 py-1.5 mb-1.5">
          <div className="w-8 h-8 rounded-full bg-[var(--color-nexus-primary)] flex items-center justify-center text-xs font-bold text-white shrink-0">
            {(user.name || user.email || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <span className="text-[12px] font-bold text-[var(--color-nexus-ink)] block truncate leading-tight">{user.name || 'Account'}</span>
            <span className="text-[10px] text-[var(--color-nexus-muted)] block truncate leading-tight">{roleLabel || user.role || user.email}</span>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-2 py-2 rounded-[var(--radius-nexus-control)] text-xs font-semibold text-[var(--color-nexus-muted)] hover:bg-[var(--color-nexus-error-soft)] hover:text-[var(--color-nexus-error)] transition-colors"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-[var(--color-nexus-bg)] font-sans text-[var(--color-nexus-ink)] flex">
      {/* Desktop fixed sidebar */}
      <aside className="hidden md:flex md:flex-col w-64 shrink-0 bg-[var(--color-nexus-surface)] border-r border-[var(--color-nexus-border)] sticky top-0 h-screen z-30">
        <SidebarContent />
      </aside>

      {/* Mobile drawer — full nav list, opened via hamburger or bottom-nav overflow */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-[var(--color-nexus-surface)] border-r border-[var(--color-nexus-border)] flex flex-col shadow-2xl">
            <button onClick={() => setMobileOpen(false)} className="absolute top-5 right-4 text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)]">
              <X size={20} />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-[var(--color-nexus-surface)] border-b border-[var(--color-nexus-border)] px-4 md:px-6 h-14 flex justify-between items-center gap-4 sticky top-0 z-40">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setMobileOpen(true)} className="md:hidden text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)] shrink-0">
              <Menu size={22} />
            </button>
            <div className="min-w-0">
              <h1 className="font-sans font-bold text-lg md:text-xl text-[var(--color-nexus-ink)] tracking-tight truncate">{title}</h1>
              {subtitle && <p className="hidden sm:block text-xs text-[var(--color-nexus-muted)] truncate mt-0.5">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <form onSubmit={submitSearch} className="hidden sm:block relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-nexus-muted)]" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search employees..."
                className="w-56 rounded-full border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] py-2 pl-9 pr-4 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary-fixed)]"
              />
            </form>
            <NotificationBell />
            <PageChrome fallbackHref={fallbackHref} variant="compact" />
            {headerActions}
            <div className="w-8 h-8 rounded-full bg-[var(--color-nexus-primary-fixed)] flex items-center justify-center text-xs font-bold text-[var(--color-nexus-ink)] shrink-0" title={user.email}>
              {(user.name || user.email || '?').charAt(0).toUpperCase()}
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto p-4 md:p-6 mt-2 md:mt-4 w-full mb-16 md:mb-0">
          {children}
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full z-40 flex items-stretch bg-[var(--color-nexus-surface)] border-t border-[var(--color-nexus-border)] shadow-[0_-2px_8px_rgba(25,28,30,0.06)] h-16">
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
              <Icon size={20} />
              <span className="text-[10px] font-semibold truncate max-w-[72px]">{item.label}</span>
            </button>
          );
        })}
        {hasOverflow && (
          <button
            onClick={() => setMobileOpen(true)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[var(--color-nexus-muted)]"
          >
            <MoreHorizontal size={20} />
            <span className="text-[10px] font-semibold">More</span>
          </button>
        )}
      </nav>
    </div>
  );
}
