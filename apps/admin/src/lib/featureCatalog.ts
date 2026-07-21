// Thin fetch-and-cache wrapper around GET /api/tenant/feature-catalog — the
// server-driven single source of truth for every delegable feature/
// privilege in the app (see apps/admin/api/auth/featureCatalog.ts). Fetched
// once and reused by both the Role Permissions editor and the hire form's
// "additional access" grid, so they never drift from each other.
export interface FeatureCatalogEntry {
  key: string;
  label: string;
  description: string;
}

export interface FeatureCatalogCategory {
  category: string;
  icon: string;
  features: FeatureCatalogEntry[];
}

// key -> the other key(s) it requires — see FEATURE_DEPENDENCIES in
// apps/admin/api/auth/featureCatalog.ts for what belongs here and why.
export type FeatureDependencies = Record<string, string[]>;

let cachedCatalog: FeatureCatalogCategory[] | null = null;
let cachedDependencies: FeatureDependencies = {};
let inflight: Promise<FeatureCatalogCategory[]> | null = null;

function load(): Promise<FeatureCatalogCategory[]> {
  const token = localStorage.getItem('auth_token');
  return fetch('/api/tenant/feature-catalog', { headers: { Authorization: `Bearer ${token}` } })
    .then(res => res.json())
    .then(data => {
      cachedCatalog = Array.isArray(data.catalog) ? data.catalog : [];
      cachedDependencies = data.dependencies && typeof data.dependencies === 'object' ? data.dependencies : {};
      inflight = null;
      return cachedCatalog;
    })
    .catch(err => {
      inflight = null;
      throw err;
    });
}

export async function fetchFeatureCatalog(): Promise<FeatureCatalogCategory[]> {
  if (cachedCatalog) return cachedCatalog;
  if (inflight) return inflight;
  inflight = load();
  return inflight;
}

// Dependency map is always fetched alongside the catalog (same endpoint) —
// call fetchFeatureCatalog() first (or let this trigger it) so this is
// populated before you need it.
export async function fetchFeatureDependencies(): Promise<FeatureDependencies> {
  if (!cachedCatalog) await fetchFeatureCatalog();
  return cachedDependencies;
}
