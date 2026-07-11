import { useState, type ReactNode } from 'react';
import { Menu, X, LogOut, Fingerprint, type LucideIcon } from 'lucide-react';
import PageChrome from './PageChrome';

export interface PortalNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  count?: number;
}

interface PortalShellProps {
  user: { name?: string; email?: string; role?: string };
  roleLabel?: string;
  navItems: PortalNavItem[];
  activeTab: string;
  onTabChange: (id: string) => void;
  onLogout: () => void;
  title: string;
  fallbackHref?: string;
  children: ReactNode;
}

// Reusable premium app shell (glass sidebar + sticky header + main), modeled
// on the admin Dashboard's shell but restyled with the --color-premium-*
// palette and the CSS-3D/glass treatment. Used by the employee portal so it
// feels like the same product as the admin dashboard, scoped to only what the
// signed-in employee can see/do. Deliberately WebGL-free itself — the ambient
// AuroraField (heavier) is mounted by the page behind it only where safe.
export default function PortalShell({
  user, roleLabel, navItems, activeTab, onTabChange, onLogout, title, fallbackHref = '/', children,
}: PortalShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const SidebarContent = () => (
    <>
      <div className="px-6 py-6 flex items-center gap-2.5 border-b border-[var(--color-premium-border)]">
        <div className="w-9 h-9 rounded-xl bg-[var(--color-premium-accent)] flex items-center justify-center shrink-0 shadow-[0_6px_16px_rgba(123,92,250,0.35)] float-c">
          <Fingerprint className="w-5 h-5 text-white" size={18} />
        </div>
        <div className="min-w-0">
          <span className="font-display font-bold text-sm text-[var(--color-premium-ink)] tracking-tight block truncate">Smart Teams</span>
          <span className="text-[9px] uppercase font-bold text-[var(--color-premium-muted)] tracking-wider">{roleLabel || user.role}</span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => { onTabChange(item.id); setMobileOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                isActive
                  ? 'bg-[var(--color-premium-accent)] text-white shadow-[0_8px_20px_rgba(123,92,250,0.32)]'
                  : 'text-[var(--color-premium-muted)] hover:bg-[var(--color-premium-accent-soft)] hover:text-[var(--color-premium-accent)]'
              }`}
            >
              <Icon size={16} className="shrink-0" />
              <span className="flex-1 text-left truncate">{item.label}</span>
              {typeof item.count === 'number' && item.count > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/25 text-white' : 'bg-[var(--color-premium-accent-soft)] text-[var(--color-premium-accent)]'}`}>
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-[var(--color-premium-border)]">
        <div className="flex items-center gap-2.5 px-3 py-2 mb-2">
          <div className="w-8 h-8 rounded-full bg-[var(--color-premium-accent-soft)] flex items-center justify-center text-xs font-bold text-[var(--color-premium-accent)] shrink-0">
            {(user.name || user.email || '?').charAt(0).toUpperCase()}
          </div>
          <span className="text-[11px] text-[var(--color-premium-muted)] font-medium truncate">{user.email}</span>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-[var(--color-premium-muted)] hover:bg-[var(--color-premium-danger-soft)] hover:text-[var(--color-premium-danger)] transition-colors"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen premium-mesh-bg font-sans text-[var(--color-premium-ink)] flex">
      {/* Desktop glass sidebar */}
      <aside className="hidden md:flex md:flex-col w-64 shrink-0 glass-card !rounded-none border-r border-[var(--color-premium-border)] sticky top-0 h-screen z-30">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-[var(--color-premium-surface)] border-r border-[var(--color-premium-border)] flex flex-col shadow-2xl">
            <button onClick={() => setMobileOpen(false)} className="absolute top-5 right-4 text-[var(--color-premium-muted)] hover:text-[var(--color-premium-ink)]">
              <X size={20} />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="glass-card !rounded-none border-b border-[var(--color-premium-border)] px-4 md:px-6 py-4 flex justify-between items-center sticky top-0 z-40">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setMobileOpen(true)} className="md:hidden text-[var(--color-premium-muted)] hover:text-[var(--color-premium-ink)] shrink-0">
              <Menu size={22} />
            </button>
            <h1 className="font-display font-bold text-base md:text-lg text-[var(--color-premium-ink)] tracking-tight truncate">{title}</h1>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <PageChrome fallbackHref={fallbackHref} variant="compact" />
            <span className="hidden sm:block text-xs text-[var(--color-premium-muted)] font-semibold">{user.email}</span>
          </div>
        </header>

        <main className="max-w-5xl mx-auto p-4 md:p-6 mt-2 md:mt-4 w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
