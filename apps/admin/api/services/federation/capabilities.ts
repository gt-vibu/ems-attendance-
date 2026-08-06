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

// BlizBooks (and any other federation consumer) resolves which of its own
// workforce modules to enable purely from capabilities.featuresEnabled, and
// treats it as a closed, fixed vocabulary it was contractually given up
// front — employees, attendance, leave, payroll, shifts,
// device_verification. It has no idea what SmartTeams's own internal
// PLATFORM_FEATURES keys (payroll_batches, gps_geofence, teams, ...) mean,
// and was never given a list of them. Returning those raw internal keys
// here (as this used to do) makes every module BlizBooks tries to select
// look unrecognized — connection/provisioning rejects them all. This map
// is the ONLY place internal SmartTeams feature keys get translated into
// the fixed external module vocabulary the federation contract promises.
//
// employees/attendance/leave/shifts are core federation modules — every
// federation-enabled tenant can use them (the corresponding routes have no
// separate PLATFORM_FEATURES gate of their own), so they're always
// reported enabled. payroll and device_verification DO have a real
// internal on/off switch, so those two are conditional.
export const BLIZBOOKS_WORKFORCE_MODULES = ['employees', 'attendance', 'leave', 'payroll', 'shifts', 'device_verification'] as const;
export type BlizBooksWorkforceModule = typeof BLIZBOOKS_WORKFORCE_MODULES[number];

function resolveWorkforceModules(featuresAllowed: unknown): BlizBooksWorkforceModule[] {
  const allowed = Array.isArray(featuresAllowed) ? (featuresAllowed as string[]) : null; // null = unrestricted (no whitelist configured), mirrors isPlatformFeatureAllowed()'s own fallback
  const has = (key: string) => allowed === null || allowed.includes(key);

  const modules: BlizBooksWorkforceModule[] = ['employees', 'attendance', 'leave', 'shifts'];
  // Base payroll (salary components, runs, ledger — routes/federation/payroll.routes.ts)
  // has no dedicated PLATFORM_FEATURES gate of its own; the advanced
  // payroll_batches/payroll_lock_adjustments toggles layer ON TOP of it
  // rather than gating the module's existence, so payroll is also
  // unconditional here — a tenant with federation enabled but neither
  // advanced toggle on can still resolve base payroll via the API. This
  // matches the routes themselves, which never check those flags before
  // serving a request.
  modules.push('payroll');
  // device_verification maps to whichever identity-check method(s) this
  // tenant actually has switched on — WebAuthn (device_identity) or
  // face+liveness (face_recognition). Either is sufficient.
  if (has('device_identity') || has('face_recognition')) modules.push('device_verification');

  return modules;
}

export async function buildCapabilities(tenantId: number) {
  const tenantRows = await db.select({ featuresAllowed: schema.tenants.featuresAllowed }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  const featuresAllowed = tenantRows[0]?.featuresAllowed;
  const featuresEnabled = resolveWorkforceModules(featuresAllowed);

  const providerCapabilities: Record<string, boolean> = {};
  if (Array.isArray(featuresAllowed)) {
    const allowed = featuresAllowed as string[];
    for (const f of PLATFORM_FEATURES) {
      providerCapabilities[f.key] = allowed.includes(f.key);
    }
  } else {
    for (const f of PLATFORM_FEATURES) {
      providerCapabilities[f.key] = true;
    }
  }
  const smartTeamsFeatures = Object.keys(providerCapabilities).filter((key) => providerCapabilities[key]);

  return {
    capabilities: {
      featuresEnabled,
      providerCapabilities,
      smartTeamsFeatures,
      grantableCapabilities: [...FEDERATION_GRANTABLE_CAPABILITIES],
      version: CAPABILITIES_SCHEMA_VERSION,
    },
    providerCapabilities,
    cacheControlMaxAgeSeconds: CAPABILITIES_CACHE_MAX_AGE_SECONDS,
  };
}
