import { useState } from 'react';
import {
  Users, Clock, Coffee, ScrollText, Smartphone, Building2, QrCode, Home, AlertTriangle, ChevronDown,
  CalendarDays, Banknote, Users2, Megaphone,
  type LucideIcon,
} from 'lucide-react';
import type { FeatureCatalogCategory } from '../lib/featureCatalog';

const ICONS: Record<string, LucideIcon> = {
  Users, Clock, Coffee, ScrollText, Smartphone, Building2, QrCode, Home, AlertTriangle, CalendarDays, Banknote, Users2, Megaphone,
};

export interface FeatureCatalogGridProps {
  catalog: FeatureCatalogCategory[];
  selected: string[];
  onChange: (next: string[]) => void;
  // 'ALL' (tenant_admin/super_admin) enables every toggle. A restricted
  // array greys out any key not in it — precedence of power made visible,
  // not just enforced silently server-side.
  allowedKeys: string[] | 'ALL';
  disabled?: boolean;
}

// Renders the shared feature catalog as an accordion of category cards —
// pick a topic to reveal its toggles, rather than dumping every option on
// screen at once. Used by both the Role Permissions editor (editing a
// role's defaults) and the hire form's "additional access" section
// (granting extra privileges on top of the selected role) — one component,
// so the two surfaces can never drift apart.
export default function FeatureCatalogGrid({ catalog, selected, onChange, allowedKeys, disabled }: FeatureCatalogGridProps) {
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());

  const isAllowed = (key: string) => allowedKeys === 'ALL' || allowedKeys.includes(key);

  const toggle = (key: string) => {
    if (disabled || !isAllowed(key)) return;
    onChange(selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key]);
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
      {catalog.map((cat) => {
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
                  const allowed = isAllowed(f.key);
                  const checked = selected.includes(f.key);
                  return (
                    <label
                      key={f.key}
                      title={!allowed ? "You don't have this permission to grant" : f.description}
                      className={`flex items-start gap-2.5 p-2 rounded-lg transition-colors ${allowed && !disabled ? 'cursor-pointer hover:bg-[var(--color-nexus-primary-fixed)]' : 'cursor-not-allowed opacity-40'}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!allowed || disabled}
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
