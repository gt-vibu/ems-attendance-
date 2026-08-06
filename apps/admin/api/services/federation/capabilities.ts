import { eq } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { PLATFORM_FEATURES } from '../../auth/rbac';

// GET /v1/federation/capabilities — declares what this SmartTeams tenant
// currently supports so BlizBooks can resolve its canonical permissions
// into SmartTeams grants (see PUT /v1/federation/employees/:id/access) and
// know which optional modules (WFH, payroll batches, lock/adjustments,
// etc.) are actually turned on. Fetched by BlizBooks on connect and at
// least every 24h — Cache-Control below tells it how long it may trust a
// cached copy.
const CAPABILITIES_CACHE_MAX_AGE_SECONDS = 3600;
const CAPABILITIES_SCHEMA_VERSION = 1;

// Fixed catalog of grants a federation client may request via
// PUT /v1/federation/employees/:id/access — deliberately smaller than the
// app's full internal privilege catalog (auth/rbac.ts's per-route strings):
// only the capabilities a federated BlizBooks caller can actually act on
// through this API surface are listed here.
export const FEDERATION_GRANTABLE_CAPABILITIES = [
  'attendance.check_in_out',
  'attendance.view_own',
  'attendance.view_team',
  'attendance.approve',
  'attendance.edit',
  'leave.request',
  'leave.view_own',
  'leave.approve',
  'leave.adjust_balance',
  'payroll.view_own',
  'payroll.manage',
  'payroll.approve',
  'payroll.release',
] as const;

export async function buildCapabilities(tenantId: number) {
  const tenantRows = await db.select({ featuresAllowed: schema.tenants.featuresAllowed }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  const featuresAllowed = tenantRows[0]?.featuresAllowed;
  const featuresEnabled = Array.isArray(featuresAllowed)
    ? PLATFORM_FEATURES.map((f) => f.key).filter((key) => (featuresAllowed as string[]).includes(key))
    : PLATFORM_FEATURES.map((f) => f.key); // no whitelist configured — every platform feature is unrestricted, mirrors isPlatformFeatureAllowed()'s own fallback

  return {
    capabilities: {
      featuresEnabled,
      grantableCapabilities: [...FEDERATION_GRANTABLE_CAPABILITIES],
      version: CAPABILITIES_SCHEMA_VERSION,
    },
    cacheControlMaxAgeSeconds: CAPABILITIES_CACHE_MAX_AGE_SECONDS,
  };
}
