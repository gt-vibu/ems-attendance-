import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import {
  ShieldCheck, Clock, Building2, Users, Users2, CalendarDays, BarChart2,
  Bell, ScrollText, UserX, Ticket, LayoutDashboard, ChevronRight, ChevronDown, Search,
  Settings, LogOut, ArrowLeft, Layers, UserCheck, AlertCircle, FileText, Layers3, Briefcase, Activity
} from 'lucide-react';
import type { User } from '../lib/auth';

interface AdminWorkspaceLayoutProps {
  user: User;
  onLogout?: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}

export interface NavCategory {
  id: string;
  name: string;
  icon: React.ElementType;
  items: {
    id: string;
    label: string;
    icon: React.ElementType;
    path: string;
    badge?: string;
  }[];
}

export const ADMIN_CATEGORIES: NavCategory[] = [
  {
    id: 'organization',
    name: 'Organization',
    icon: Building2,
    items: [
      { id: 'company-profile', label: 'Company Profile', icon: Building2, path: '/tenant/company-profile' },
      { id: 'branches', label: 'Branches', icon: Building2, path: '/tenant/branches' },
      { id: 'teams', label: 'Teams & Structure', icon: Users2, path: '/tenant/teams' },
      { id: 'directory', label: 'Employee Directory', icon: UserCheck, path: '/tenant/directory' },
      { id: 'org-chart', label: 'Org Chart', icon: Users2, path: '/tenant/org-chart' },
      { id: 'boundaries', label: 'Workspace Boundaries', icon: ShieldCheck, path: '/tenant/workspace-boundaries' },
    ],
  },
  {
    id: 'workforce',
    name: 'Workforce',
    icon: Briefcase,
    items: [
      { id: 'attendance-prefs', label: 'Attendance Preferences', icon: Clock, path: '/tenant/attendance-preferences' },
      { id: 'roles', label: 'Roles & Permissions', icon: Users, path: '/tenant/roles' },
      { id: 'delegation', label: 'Delegation', icon: Users2, path: '/tenant/delegation' },
      { id: 'shift-swaps', label: 'Shift Swaps', icon: Clock, path: '/tenant/shift-swaps' },
      { id: 'terminations', label: 'Terminations', icon: UserX, path: '/tenant/terminations' },
    ],
  },
  {
    id: 'operations',
    name: 'Operations',
    icon: Layers3,
    items: [
      { id: 'business-calendar', label: 'Business Calendar', icon: CalendarDays, path: '/tenant/business-calendar' },
      { id: 'approval-routing', label: 'Approval Routing', icon: Layers, path: '/tenant/approval-routing' },
      { id: 'notifications', label: 'Notifications Center', icon: Bell, path: '/tenant/notification-center' },
      { id: 'tickets', label: 'Support Tickets', icon: Ticket, path: '/tenant/tickets' },
    ],
  },
  {
    id: 'insights',
    name: 'Insights',
    icon: Activity,
    items: [
      { id: 'reports', label: 'Reports & Analytics', icon: BarChart2, path: '/tenant/reports' },
      { id: 'ledger', label: 'Audit Ledger', icon: ScrollText, path: '/tenant/audit-ledger' },
    ],
  },
  {
    id: 'settings',
    name: 'Settings & Admin',
    icon: Settings,
    items: [
      { id: 'overview', label: 'Admin Hub', icon: LayoutDashboard, path: '/tenant/admin' },
    ],
  },
];

export default function AdminWorkspaceLayout({
  user, onLogout, title, subtitle, children
}: AdminWorkspaceLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    organization: true,
    workforce: true,
    operations: true,
    insights: true,
    settings: true,
  });

  const toggleCategory = (catId: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [catId]: !prev[catId]
    }));
  };

  return (
    <div className="min-h-dvh bg-[var(--color-nexus-bg)] flex flex-col font-sans">
      {/* ── Top Workspace Header ── */}
      <header className="h-12 bg-[var(--color-nexus-surface)] border-b border-[var(--color-nexus-border)] px-4 flex items-center justify-between sticky top-0 z-30 shadow-xs">
        <div className="flex items-center gap-3">
          <Link to="/dashboard" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
            <img src="/smart-teams-icon.png" alt="Smart Teams" className="w-7 h-7 object-contain" />
            <span className="text-xs font-bold text-[var(--color-nexus-ink)] hidden sm:inline">
              Smart Teams <span className="text-[10px] text-[var(--color-nexus-primary)] font-mono">Enterprise Console</span>
            </span>
          </Link>

          <span className="text-[var(--color-nexus-border)] font-light">/</span>

          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-nexus-muted)]">
            <ShieldCheck size={14} className="text-[var(--color-nexus-primary)]" />
            <span className="text-[var(--color-nexus-ink)] font-bold text-xs">Administration Workspace</span>
          </div>
        </div>

        {/* Global Search & User Profile */}
        <div className="flex items-center gap-3">
          <div className="relative hidden md:block w-64">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-nexus-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search administration settings..."
              className="w-full pl-8 pr-3 py-1 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-lg text-xs text-[var(--color-nexus-ink)] focus:outline-none focus:border-[var(--color-nexus-primary)]"
            />
          </div>

          <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-nexus-ink)] pl-3 border-l border-[var(--color-nexus-border)]">
            <div className="w-6 h-6 rounded-full bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] flex items-center justify-center font-bold text-xs">
              {user.name?.[0]?.toUpperCase() || 'A'}
            </div>
            <div className="hidden lg:block">
              <span className="block font-bold text-[11px] leading-none">{user.name}</span>
              <span className="text-[9px] text-[var(--color-nexus-muted)] font-mono uppercase">Tenant Admin</span>
            </div>
          </div>

          {onLogout && (
            <button
              onClick={onLogout}
              className="p-1 text-[var(--color-nexus-muted)] hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
              title="Sign Out"
            >
              <LogOut size={15} />
            </button>
          )}
        </div>
      </header>

      {/* ── Main Workspace Body (Category Navigation Sidebar + Content) ── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Persistent Category Navigation Sidebar */}
        <aside className={`${sidebarCollapsed ? 'w-14' : 'w-60'} bg-[var(--color-nexus-surface)] border-r border-[var(--color-nexus-border)] transition-all duration-200 shrink-0 flex flex-col justify-between overflow-y-auto h-[calc(100vh-3rem)] sticky top-12 z-20`}>
          <div className="p-2 space-y-3">
            {/* Back to Home Dashboard Button */}
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="w-full mb-1 px-2.5 py-2 rounded-lg bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary)] hover:text-white font-bold text-xs flex items-center gap-2 transition-all shadow-xs cursor-pointer"
              title="Back to Home Dashboard"
            >
              <ArrowLeft size={15} />
              {!sidebarCollapsed && <span>Back to Home</span>}
            </button>

            <div className="px-2 py-1 flex items-center justify-between">
              {!sidebarCollapsed && (
                <span className="text-[9.5px] font-mono uppercase tracking-widest font-bold text-[var(--color-nexus-muted)]">
                  WORKFLOW CATEGORIES
                </span>
              )}
              <button
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)] text-[10px] font-mono p-1 rounded hover:bg-[var(--color-nexus-surface-alt)]"
                title="Toggle Sidebar"
              >
                {sidebarCollapsed ? '→' : '←'}
              </button>
            </div>

            {/* Render Workflow Categories */}
            {ADMIN_CATEGORIES.map((cat) => {
              const CatIcon = cat.icon;
              const isExpanded = expandedCategories[cat.id] !== false;
              
              // Filter items based on search query
              const matchingItems = cat.items.filter(i => 
                i.label.toLowerCase().includes(searchQuery.toLowerCase())
              );

              if (searchQuery && matchingItems.length === 0) return null;

              return (
                <div key={cat.id} className="space-y-0.5">
                  {!sidebarCollapsed && (
                    <button
                      type="button"
                      onClick={() => toggleCategory(cat.id)}
                      className="w-full px-2 py-1 flex items-center justify-between text-[11px] font-extrabold text-[var(--color-nexus-ink)] uppercase tracking-wider hover:bg-[var(--color-nexus-surface-alt)] rounded"
                    >
                      <div className="flex items-center gap-1.5 text-[var(--color-nexus-secondary)]">
                        <CatIcon size={13} />
                        <span>{cat.name}</span>
                      </div>
                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                  )}

                  {(isExpanded || sidebarCollapsed || searchQuery) && (
                    <div className="space-y-0.5 pl-1">
                      {matchingItems.map((item) => {
                        const Icon = item.icon;
                        const active = location.pathname === item.path || (item.path !== '/tenant/admin' && location.pathname.startsWith(item.path));

                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => navigate(item.path)}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors duration-150 cursor-pointer select-none ${
                              active
                                ? 'bg-[var(--color-nexus-primary)] text-white shadow-xs font-bold'
                                : 'text-[var(--color-nexus-secondary)] hover:bg-[var(--color-nexus-surface-alt)] hover:text-[var(--color-nexus-ink)]'
                            }`}
                            title={sidebarCollapsed ? item.label : undefined}
                          >
                            <Icon size={14} className={active ? 'text-white' : 'text-[var(--color-nexus-muted)]'} />
                            {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {!sidebarCollapsed && (
            <div className="p-2.5 m-2 rounded-lg bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] text-[10px] text-[var(--color-nexus-muted)] space-y-0.5">
              <div className="flex items-center gap-1.5 text-[var(--color-nexus-primary)] font-bold">
                <AlertCircle size={12} /> Enterprise Workspace
              </div>
              <p className="text-[9.5px] leading-tight">
                Contextual workspace navigation. All modules remain persistent in current shell.
              </p>
            </div>
          )}
        </aside>

        {/* Dynamic Admin Content View */}
        <main className="flex-1 overflow-y-auto h-[calc(100vh-3rem)] bg-[var(--color-nexus-bg)] min-w-0">
          {(title || subtitle) && (
            <div className="bg-[var(--color-nexus-surface)] border-b border-[var(--color-nexus-border)] px-5 py-2.5">
              {title && <h1 className="text-base font-bold text-[var(--color-nexus-ink)] leading-snug">{title}</h1>}
              {subtitle && <p className="text-[11px] text-[var(--color-nexus-muted)] mt-0.5">{subtitle}</p>}
            </div>
          )}
          <div className="p-4 sm:p-5">{children}</div>
        </main>
      </div>
    </div>
  );
}
