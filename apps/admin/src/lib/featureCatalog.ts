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

let cached: FeatureCatalogCategory[] | null = null;
let inflight: Promise<FeatureCatalogCategory[]> | null = null;

export async function fetchFeatureCatalog(): Promise<FeatureCatalogCategory[]> {
  if (cached) return cached;
  if (inflight) return inflight;
  const token = localStorage.getItem('auth_token');
  inflight = fetch('/api/tenant/feature-catalog', { headers: { Authorization: `Bearer ${token}` } })
    .then(res => res.json())
    .then(data => {
      cached = Array.isArray(data.catalog) ? data.catalog : [];
      inflight = null;
      return cached;
    })
    .catch(err => {
      inflight = null;
      throw err;
    });
  return inflight;
}
