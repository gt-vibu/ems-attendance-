import React from 'react';
import {
  BarChart2,
  Clock,
  Calendar,
  FileText,
  TrendingUp,
  ShieldAlert,
  Sliders,
  Save,
  Mail,
  Lock,
  ChevronRight
} from 'lucide-react';

export interface ReportsSidebarProps {
  activeCategory: string;
  onSelectCategory: (catId: string) => void;
  userRole?: string;
  hasPayrollPermission?: boolean;
}

export interface ReportCategoryItem {
  id: string;
  label: string;
  icon: React.ElementType;
  requiresPermission?: string;
  restrictedTag?: string;
}

export const ReportsSidebar: React.FC<ReportsSidebarProps> = ({
  activeCategory,
  onSelectCategory,
  userRole = 'staff',
  hasPayrollPermission = false
}) => {
  const ALL_ANALYTICS_CATEGORIES: ReportCategoryItem[] = [
    { id: 'executive', label: 'Executive Dashboard', icon: BarChart2 },
    { id: 'attendance', label: 'Attendance Reports', icon: Clock },
    { id: 'leave', label: 'Leave Reports', icon: Calendar },
    {
      id: 'payroll',
      label: 'Payroll Reports',
      icon: FileText,
      requiresPermission: 'payroll.read',
      restrictedTag: 'RBAC Restricted'
    },
    { id: 'overtime', label: 'Shift & Overtime', icon: TrendingUp },
    { id: 'compliance', label: 'Compliance & Audit', icon: ShieldAlert }
  ];

  const TOOLS_CATEGORIES: ReportCategoryItem[] = [
    { id: 'builder', label: 'Report Designer', icon: Sliders },
    { id: 'saved', label: 'Saved Templates', icon: Save },
    { id: 'schedules', label: 'Scheduled Delivery', icon: Mail }
  ];

  // Dynamically filter categories based on RBAC permissions
  const visibleAnalyticsCategories = ALL_ANALYTICS_CATEGORIES.filter((cat) => {
    if (cat.requiresPermission === 'payroll.read' && !hasPayrollPermission) {
      return false;
    }
    return true;
  });

  return (
    <aside className="w-full lg:w-64 shrink-0 bg-white border border-slate-200 rounded-xl p-3 shadow-xs space-y-4 font-sans">
      {/* Role Badge Indicator */}
      <div className="px-3 py-2 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Access Mode
        </span>
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">
          {userRole.replace(/_/g, ' ')}
        </span>
      </div>

      {/* Analytics & Operations Section */}
      <div>
        <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 px-3 py-1.5 flex items-center justify-between">
          <span>Analytics & Operations</span>
        </div>
        <nav className="space-y-1 mt-1">
          {visibleAnalyticsCategories.map((cat) => {
            const Icon = cat.icon;
            const active = activeCategory === cat.id;

            return (
              <button
                key={cat.id}
                onClick={() => onSelectCategory(cat.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold transition ${
                  active
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-white' : 'text-slate-500'}`} />
                  <span className="truncate">{cat.label}</span>
                </div>
                {cat.restrictedTag && (
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase shrink-0 ${
                      active
                        ? 'bg-indigo-700 text-indigo-100'
                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    }`}
                  >
                    Restricted
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Report Studio & Tools Section */}
      <div className="pt-2 border-t border-slate-100">
        <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 px-3 py-1.5">
          Report Studio & Tools
        </div>
        <nav className="space-y-1 mt-1">
          {TOOLS_CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const active = activeCategory === cat.id;

            return (
              <button
                key={cat.id}
                onClick={() => onSelectCategory(cat.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold transition ${
                  active
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-white' : 'text-slate-500'}`} />
                  <span className="truncate">{cat.label}</span>
                </div>
                <ChevronRight className={`w-3.5 h-3.5 ${active ? 'text-indigo-200' : 'text-slate-300'}`} />
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
};

export default ReportsSidebar;
