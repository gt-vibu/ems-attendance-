import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, LogOut, Building2, Search, MoreHorizontal, User as UserIcon, Settings, ChevronDown, type LucideIcon } from 'lucide-react';
import PageChrome from './PageChrome';
import NotificationBell from './NotificationBell';
import { getCompanyIdentity } from '../lib/companyIdentity';

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
  user: { name?: string; email?: string; role?: string; id?: number; tenantName?: string };
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
    const q = searchQuery.trim().toLowerCase();
    if (!q) return;

    if (['gps', 'geofence', 'face', 'verification', 'liveness', 'presence', 'auto checkout', 'shift'].some(k => q.includes(k))) {
      navigate('/tenant/attendance-preferences');
    } else if (['payroll', 'salary', 'pf', 'esi', 'tax', 'payslip'].some(k => q.includes(k))) {
      navigate('/tenant/payroll');
    } else if (['branch', 'location', 'geofence', 'office'].some(k => q.includes(k))) {
      navigate('/tenant/branches');
    } else if (['leave', 'holiday', 'vacation', 'time off'].some(k => q.includes(k))) {
      navigate('/tenant/leave');
    } else if (['report', 'analytics', 'audit', 'chart'].some(k => q.includes(k))) {
      navigate('/tenant/reports');
    } else {
      navigate(`/tenant/directory?q=${encodeURIComponent(searchQuery.trim())}`);
    }
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

  return (
    <div className="min-h-dvh bg-[var(--color-nexus-bg)] font-sans text-[var(--color-nexus-ink)] flex flex-col md:flex-row">
      {/* Desktop fixed sidebar — DOM node identity preserved to eliminate hover flickering */}
      <aside className="hidden md:flex md:flex-col w-[236px] shrink-0 bg-[var(--color-nexus-surface)] border-r border-[var(--color-nexus-border)] sticky top-0 h-screen z-30">
        <div className="px-4 py-3.5 flex items-center gap-3 border-b border-[var(--color-nexus-border)] min-h-[64px]">
          <img
            src="/smart-teams-icon.png"
            alt="Smart Teams"
            className="w-10 h-10 object-contain shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).src = '/smart-teams-icon.png'; }}
          />
          <div className="min-w-0">
            <span className="font-sans font-black text-[14px] text-[var(--color-nexus-ink)] tracking-tight block truncate leading-tight">Smart Teams EMS</span>
            <span className="text-[10.5px] text-[var(--color-nexus-muted)] font-semibold tracking-wide block leading-tight mt-0.5">Enterprise Management Suite</span>
          </div>
        </div>

        <nav className="flex-1 px-2.5 py-3 space-y-0.5 overflow-y-auto select-none">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => { onTabChange(item.id); setMobileOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-[var(--radius-nexus-control)] text-[13px] font-semibold transition-colors duration-150 cursor-pointer ${
                  isActive
                    ? 'bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)]'
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

        {/* Navigation Footer links or info */}
        <div className="px-3 py-2 border-t border-[var(--color-nexus-border)] text-center text-[10px] text-[var(--color-nexus-muted)] font-mono">
          Smart Teams EMS v2.4
        </div>
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
            {headerActions}

            {/* Desktop & Mobile: Unified Top Header Profile Dropdown */}
            {(() => {
              const identityLogo = getCompanyIdentity().logo;
              return (
                <div className="relative" ref={profileDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                    className="flex items-center gap-2.5 p-1 rounded-full hover:bg-[var(--color-nexus-surface-alt)] transition-colors cursor-pointer"
                    aria-label="Account menu"
                  >
                    <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-xs font-bold text-[var(--color-nexus-primary)] shrink-0 border border-[var(--color-nexus-border)] overflow-hidden shadow-2xs" title={user.email}>
                      {identityLogo ? (
                        <img src={identityLogo} alt="Avatar" className="w-full h-full object-contain p-0.5" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : (
                        <span>{userInitial}</span>
                      )}
                    </div>
                    <div className="hidden md:block min-w-0 text-left leading-tight pr-1">
                      <span className="text-[12.5px] font-semibold text-[var(--color-nexus-ink)] block truncate max-w-[120px]">{user.name || 'Account'}</span>
                      <span className="text-[10.5px] text-[var(--color-nexus-muted)] block truncate max-w-[120px]">{roleLabel || user.role}</span>
                    </div>
                  </button>

                  {profileDropdownOpen && (
                    <div className="absolute right-0 top-[calc(100%+8px)] w-64 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                      {/* Detailed User & Company Header Info */}
                      <div className="p-4 border-b border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)]/50">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-white border border-[var(--color-nexus-border)] flex items-center justify-center shrink-0 shadow-xs overflow-hidden">
                            {identityLogo ? (
                              <img src={identityLogo} alt="Avatar" className="w-full h-full object-contain p-1" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            ) : (
                              <span className="text-sm font-extrabold text-[var(--color-nexus-primary)]">{userInitial}</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-extrabold text-[var(--color-nexus-ink)] truncate leading-tight">{user.name || 'Account'}</p>
                            <p className="text-[11px] font-semibold text-[var(--color-nexus-primary)] truncate mt-0.5">{roleLabel || user.role}</p>
                            {(user.role !== 'tenant_admin' && user.role !== 'super_admin') && (
                              <p className="text-[10px] text-[var(--color-nexus-muted)] truncate mt-0.5 font-mono">ID: EMP-10{user.id || '1'}</p>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 pt-2.5 border-t border-[var(--color-nexus-border)]/60 space-y-1">
                          <p className="text-[11px] text-[var(--color-nexus-muted)] flex items-center gap-1.5 truncate">
                            <span className="font-semibold text-[var(--color-nexus-ink)]">Organization:</span> {localStorage.getItem('company_name') || user.tenantName || 'Smart Teams EMS'}
                          </p>
                          {user.email && (
                            <p className="text-[11px] text-[var(--color-nexus-muted)] flex items-center gap-1.5 truncate">
                              <span className="font-semibold text-[var(--color-nexus-ink)]">Email:</span> {user.email}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Primary Profile Action */}
                      <div className="p-2">
                        <button
                          type="button"
                          onClick={() => { setProfileDropdownOpen(false); navigate('/tenant/profile'); }}
                          className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-[12.5px] font-semibold text-[var(--color-nexus-ink)] bg-[var(--color-nexus-surface-alt)] hover:bg-[var(--color-nexus-primary-fixed)] hover:text-[var(--color-nexus-primary)] border border-[var(--color-nexus-border)] transition-all group cursor-pointer"
                        >
                          <span className="flex items-center gap-2">
                            <UserIcon size={15} />
                            View Profile
                          </span>
                          <span className="text-xs group-hover:translate-x-0.5 transition-transform text-[var(--color-nexus-muted)] group-hover:text-[var(--color-nexus-primary)]">→</span>
                        </button>
                      </div>

                      {/* Divider & Danger Sign Out */}
                      <div className="border-t border-[var(--color-nexus-border)] p-2">
                        <button
                          type="button"
                          onClick={() => { setProfileDropdownOpen(false); onLogout(); }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[12.5px] font-bold text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <LogOut size={15} />
                          Sign Out
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
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
          const displayLabel = item.id === 'admin' ? 'Admin' : item.label;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                isActive ? 'text-[var(--color-nexus-primary)] font-bold' : 'text-[var(--color-nexus-muted)]'
              }`}
            >
              <Icon size={18} />
              <span className="text-[9.5px] font-bold tracking-tight truncate max-w-[80px] text-center">{displayLabel}</span>
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
