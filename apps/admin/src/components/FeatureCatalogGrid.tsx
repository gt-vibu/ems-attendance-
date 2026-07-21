import { useState } from 'react';
import {
  Users, Clock, Coffee, ScrollText, Smartphone, Building2, QrCode, Home, AlertTriangle, ChevronDown,
  CalendarDays, Banknote, Users2, Megaphone, ShieldCheck, Ticket,
  type LucideIcon,
} from 'lucide-react';
import type { FeatureCatalogCategory, FeatureDependencies } from '../lib/featureCatalog';

const ICONS: Record<string, LucideIcon> = {
  Users, Clock, Coffee, ScrollText, Smartphone, Building2, QrCode, Home, AlertTriangle, CalendarDays, Banknote, Users2, Megaphone, ShieldCheck, Ticket,
};

export interface FeatureCatalogGridProps {
  catalog: FeatureCatalogCategory[];
  selected: string[];
  onChange: (next: string[]) => void;
  // 'ALL' (tenant_admin/super_admin) sees/can grant every feature. A
  // restricted array is what THIS viewer holds themselves — a manager
  // holding 20 of 82 features only ever sees those 20, in this grid or
  // anywhere else it's rendered, so they can hand any subset of their own
  // features to someone they hire, and nothing beyond that. Enforced again
  // server-side (see rbac.ts getEffectivePrivileges) — this is the visible
  // half of that same rule, not just cosmetic.
  allowedKeys: string[] | 'ALL';
  disabled?: boolean;
  // key -> the key(s) it doesn't work without (see FEATURE_DEPENDENCIES in
  // apps/admin/api/auth/featureCatalog.ts). Optional — grids that don't
  // pass it just skip the interrelation warnings.
  dependencies?: FeatureDependencies;
}

// Renders the shared feature catalog as an accordion of category cards —
// pick a topic to reveal its toggles, rather than dumping every option on
// screen at once. Used by both the Role Permissions editor (editing a
// role's defaults) and the hire form's "additional access" section
// (granting extra privileges on top of the selected role) — one component,
// so the two surfaces can never drift apart.
export default function FeatureCatalogGrid({ catalog, selected, onChange, allowedKeys, disabled, dependencies }: FeatureCatalogGridProps) {
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());

  const isAllowed = (key: string) => allowedKeys === 'ALL' || allowedKeys.includes(key);

  // Only render what this viewer actually holds — categories with nothing
  // grantable disappear entirely rather than showing a wall of greyed-out
  // cards for features the viewer will never be allowed to hand out.
  const visibleCatalog = allowedKeys === 'ALL'
    ? catalog
    : catalog
        .map((cat) => ({ ...cat, features: cat.features.filter((f) => isAllowed(f.key)) }))
        .filter((cat) => cat.features.length > 0);

  const labelFor = (key: string): string => {
    for (const cat of catalog) {
      const f = cat.features.find((f) => f.key === key);
      if (f) return f.label;
    }
    return key;
  };

  // Two interrelated-toggle cases, each confirmed with the admin before the
  // change is applied — never silently cascaded, per the standing rule that
  // an interrelated toggle must warn before it finishes, not after:
  //   1. Turning ON something whose dependency isn't granted yet — offer to
  //      grant both together.
  //   2. Turning OFF something that other currently-granted toggles need —
  //      warn what else will stop working, offer to turn all of it off
  //      together (or cancel and change nothing).
  const toggle = (key: string) => {
    if (disabled || !isAllowed(key)) return;
    const deps = dependencies || {};
    const alreadySelected = selected.includes(key);

    if (!alreadySelected) {
      const missing = (deps[key] || []).filter((dep) => !selected.includes(dep) && isAllowed(dep));
      if (missing.length > 0) {
        const names = missing.map(labelFor).join(', ');
        const ok = window.confirm(`"${labelFor(key)}" doesn't work without "${names}". Grant both?`);
        if (!ok) return;
        onChange([...selected, key, ...missing]);
        return;
      }
      onChange([...selected, key]);
      return;
    }

    const dependents = Object.entries(deps)
      .filter(([depKey, requires]) => depKey !== key && selected.includes(depKey) && requires.includes(key))
      .map(([depKey]) => depKey);
    if (dependents.length > 0) {
      const names = dependents.map(labelFor).join(', ');
      const ok = window.confirm(`"${names}" require${dependents.length === 1 ? 's' : ''} "${labelFor(key)}" — turning this off will also turn ${dependents.length === 1 ? 'it' : 'them'} off. Continue?`);
      if (!ok) return;
      onChange(selected.filter((k) => k !== key && !dependents.includes(k)));
      return;
    }
    onChange(selected.filter((k) => k !== key));
  };

  const toggleCategory = (category: string) => {
    setOpenCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {visibleCatalog.map((cat) => {
        const Icon = ICONS[cat.icon] || Building2;
        const checkedCount = cat.features.filter(f => selected.includes(f.key)).length;
        const isOpen = openCategories.has(cat.category);
        return (
          <div key={cat.category} className="rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] overflow-hidden h-fit">
            <button
              type="button"
              onClick={() => toggleCategory(cat.category)}
              className="w-full flex items-center justify-between px-4 py-3 border-b border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] hover:bg-[var(--color-nexus-primary-fixed)] transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[var(--color-nexus-primary-fixed)] flex items-center justify-center shrink-0">
                  <Icon size={15} className="text-[var(--color-nexus-primary)]" />
                </div>
                <span className="text-xs font-bold text-[var(--color-nexus-ink)]">{cat.category}</span>
              </div>
              <div className="flex items-center gap-2">
                {checkedCount > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--color-nexus-primary)] text-white">{checkedCount}</span>
                )}
                <ChevronDown size={15} className={`text-[var(--color-nexus-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </div>
            </button>
            {isOpen && (
              <div className="p-3 space-y-1">
                {cat.features.map((f) => {
                  const checked = selected.includes(f.key);
                  return (
                    <label
                      key={f.key}
                      title={f.description}
                      className={`flex items-start gap-2.5 p-2 rounded-lg transition-colors ${!disabled ? 'cursor-pointer hover:bg-[var(--color-nexus-primary-fixed)]' : 'cursor-not-allowed opacity-40'}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggle(f.key)}
                        className="mt-0.5 w-3.5 h-3.5 rounded border-[var(--color-nexus-border)] accent-[var(--color-nexus-primary)]"
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-[var(--color-nexus-ink)]">{f.label}</div>
                        <div className="text-[10px] text-[var(--color-nexus-muted)] leading-snug">{f.description}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
