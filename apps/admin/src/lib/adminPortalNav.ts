import {
  Home,
  ShieldCheck,
  Building2,
  Users,
  Users2,
  Smartphone,
  ClipboardCheck,
  Clock,
  CalendarDays,
  Banknote,
  MapPin,
  QrCode,
  ScanLine,
  AlertTriangle,
  Bell,
  ScrollText,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface AdminPortalNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

const allAdminPortalNavItems: AdminPortalNavItem[] = [
  { id: 'home', label: 'Overview', icon: Home },
  { id: 'attendance', label: 'Attendance', icon: Clock },
  { id: 'leave-management', label: 'Leave Management', icon: CalendarDays },
  { id: 'payroll', label: 'Payroll', icon: Banknote },
  { id: 'directory', label: 'Directory', icon: Users },
  { id: 'recruitment', label: 'Recruitment', icon: ClipboardCheck },
  { id: 'teams', label: 'Teams', icon: Users2 },
  { id: 'administration', label: 'Administration', icon: ShieldCheck },
];

// Teams is a personal "my team" workspace for whoever holds the
// 'team.manage' privilege — the tenant admin already administers the whole
// org via Administration, so it's excluded for that role specifically (see
// Dashboard.tsx's own nav list, which applies the same rule).
export function getAdminPortalNavItems(role?: string): AdminPortalNavItem[] {
  return role === 'tenant_admin'
    ? allAdminPortalNavItems.filter((item) => item.id !== 'teams')
    : allAdminPortalNavItems;
}

export function routeForAdminNav(id: string): string {
  if (id === 'home') return '/dashboard';
  if (id === 'attendance') return '/dashboard?tab=attendance';
  if (id === 'leave-management') return '/tenant/leave';
  if (id === 'payroll') return '/tenant/payroll';
  if (id === 'directory') return '/tenant/directory';
  if (id === 'teams') return '/tenant/teams';
  if (id === 'administration') return '/dashboard?tab=administration';
  return `/dashboard?tab=${encodeURIComponent(id)}`;
}
