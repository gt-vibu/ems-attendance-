import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db, schema } from '../../db';

// Platform layer, above everything else in the app: tenants.featuresAllowed
// is a super-admin-controlled whitelist of which whole MODULES a tenant is
// even allowed to use — separate from and above the per-employee catalog
// privileges in featureCatalog.ts (a tenant admin can only delegate a
// module if the platform allows it for their tenant at all; see the
// isPlatformFeatureAllowed() call sites in config.routes.ts, qr.routes.ts,
// webhooks.routes.ts, serviceAccounts.routes.ts, and roles.routes.ts).
export const PLATFORM_FEATURES = [
  { key: 'device_identity', label: 'Device Identity Check', description: 'WebAuthn device registration required to check in (fingerprint, Face/Touch ID, or PIN).' },
  { key: 'face_recognition', label: 'Face Recognition Check-in', description: 'Camera-based face + liveness verification as the primary identity check, with device verification available as a fallback if the camera is unavailable.' },
  { key: 'wifi_lock', label: 'Corporate Wi-Fi IP Security', description: 'Restrict check-in to the registered corporate network IP.' },
  { key: 'gps_geofence', label: 'GPS Geofencing Bounds', description: 'Restrict check-in to within a radius of the branch location.' },
  { key: 'documents', label: 'Document Storage', description: 'Employee document upload/storage module.' },
  { key: 'qr_attendance', label: 'QR Attendance', description: 'Rotating-QR-code check-in module.' },
  { key: 'wfh', label: 'Work From Home', description: 'Work-from-home attendance mode.' },
  { key: 'webhooks', label: 'Webhooks & Integrations', description: 'Outbound webhook subscriptions for external integrations.' },
  { key: 'service_accounts', label: 'API Keys (Service Accounts)', description: 'Machine-to-machine API key issuance.' },
  { key: 'custom_rbac', label: 'Custom Roles', description: 'Creating custom roles beyond the built-in ones.' },
] as const;

// Keys that predate this whitelist (the original, never-enforced
// 'e.g. kyc/wifi_lock/gps_geofence' default set). A tenant whose array
// contains ONLY legacy keys was never consciously curated through the new
// module picker — treat it as unrestricted for every key outside that
// legacy set, so no pre-existing tenant is retroactively locked out of a
// module (Documents, QR, WFH, Webhooks, Service Accounts, Custom Roles)
// they were already using. The moment a super admin saves an edit through
// the new picker, the array gains a non-legacy key and strict enforcement
// applies from then on.
const LEGACY_PLATFORM_KEYS = new Set(['device_identity', 'wifi_lock', 'gps_geofence', 'kyc']);

export function isPlatformFeatureAllowed(tenant: { featuresAllowed?: unknown } | null | undefined, key: string): boolean {
  const list = tenant?.featuresAllowed;
  if (!Array.isArray(list)) return true; // no whitelist configured — unrestricted
  const consciouslyCurated = list.some((k) => !LEGACY_PLATFORM_KEYS.has(k as string));
  if (!consciouslyCurated) return true;
  return list.includes(key);
}

export async function isPlatformFeatureAllowedForTenant(tenantId: number, key: string): Promise<boolean> {
  const rows = await db.select({ featuresAllowed: schema.tenants.featuresAllowed }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  return isPlatformFeatureAllowed(rows[0] as any, key);
}

// Role defaults are now fully tenant-editable (see role_privilege_defaults /
// the Role Permissions UI) — this is a live DB read, not a hardcoded
// role-name switch. Returns [] for a role with no configured row yet
// (auto-registration of a brand-new custom role happens at the write site —
// POST /api/tenant/users/create — not here, since this function is also
// used by pure permission checks that shouldn't have side effects).
export async function getDefaultPrivilegesForRole(tenantId: number | null | undefined, role: string): Promise<string[]> {
    if (!tenantId) return [];
    const rows = await db.select().from(schema.rolePrivilegeDefaults).where(
      and(eq(schema.rolePrivilegeDefaults.tenantId, tenantId), eq(schema.rolePrivilegeDefaults.roleName, role))
    ).limit(1);
    if (rows.length === 0) return [];
    const privs = rows[0].privileges;
    return Array.isArray(privs) ? (privs as string[]) : [];
  }

// Convenience for the "specific per-type key OR the general legacy bucket"
// pattern used throughout featureCatalog.ts (Timing Alerts, Attendance
// Approvals) — true if the user holds ANY of the given keys.
export async function hasAnyPrivilege(user: any, permissions: string[]): Promise<boolean> {
  for (const permission of permissions) {
    if (await hasPrivilege(user, permission)) return true;
  }
  return false;
}

export async function hasPrivilege(user: any, permission: string): Promise<boolean> {
    if (!user) return false;
    if (user.role === 'super_admin') return true;
    if (user.role === 'tenant_admin') return true;

    // A service account has no row in `users` — it's granted an explicit
    // privilege list at creation time (see api/routes/serviceAccounts.routes.ts)
    // and never inherits role-based defaults, since there's no "role" for a
    // machine caller to default from.
    if (user.isServiceAccount) {
      return Array.isArray(user.privileges) && user.privileges.includes(permission);
    }

    const userRec = await db.select().from(schema.users).where(eq(schema.users.id, user.userId || 0)).limit(1);
    if (userRec.length === 0) return false;
    const dbUser = userRec[0];

    if (dbUser.role === 'super_admin' || dbUser.role === 'tenant_admin') return true;

    const userPrivileges = dbUser.privileges as string[];
    if (userPrivileges && Array.isArray(userPrivileges) && userPrivileges.includes(permission)) {
      return true;
    }

    const defaultPrivs = await getDefaultPrivilegesForRole(dbUser.tenantId, dbUser.role);
    if (defaultPrivs.includes(permission)) {
      return true;
    }

    return false;
  }

  // A user's full effective privilege set: their own explicitly-granted
  // privileges plus whatever their role gets by default (looked up fresh
  // from role_privilege_defaults every call — editing a role's defaults
  // takes effect immediately for everyone already in that role). 'ALL' for
  // the two admin tiers, who are unrestricted. Used to enforce that power
  // can only ever be delegated downward — nobody can hand out a privilege
  // they don't themselves hold.
export async function getEffectivePrivileges(user: any): Promise<string[] | 'ALL'> {
    if (!user) return [];
    if (user.role === 'super_admin' || user.role === 'tenant_admin') return 'ALL';
    if (user.isServiceAccount) return Array.isArray(user.privileges) ? user.privileges : [];
    const userRec = await db.select().from(schema.users).where(eq(schema.users.id, user.userId || 0)).limit(1);
    if (userRec.length === 0) return [];
    const dbUser = userRec[0];
    if (dbUser.role === 'super_admin' || dbUser.role === 'tenant_admin') return 'ALL';
    const own = Array.isArray(dbUser.privileges) ? (dbUser.privileges as string[]) : [];
    const defaults = await getDefaultPrivilegesForRole(dbUser.tenantId, dbUser.role);
    return Array.from(new Set([...own, ...defaults]));
  }

  // Returns the set of branchIds a caller is restricted to, or null if they
  // have tenant-wide visibility. super_admin/tenant_admin are always
  // unrestricted regardless of their own branchId. Any other role with no
  // branchId set (not yet assigned to a branch) also defaults to
  // unrestricted — the same safe-default reasoning as before branch-scoping
  // shipped. When restricted, the set is the user's primary branchId plus
  // every branch in user_branch_access (populated only when their role has
  // the 'branch.multi_access' feature and specific branches were chosen at
  // onboarding) — a plain single-branch user just gets a one-element array.
export async function getScopedBranchIds(user: any): Promise<number[] | null> {
    if (!user) return null;
    if (user.role === 'super_admin' || user.role === 'tenant_admin') return null;
    const userRec = await db.select().from(schema.users).where(eq(schema.users.id, user.userId || 0)).limit(1);
    if (userRec.length === 0) return null;
    const dbUser = userRec[0];
    if (dbUser.role === 'super_admin' || dbUser.role === 'tenant_admin') return null;
    if (dbUser.branchId == null) return null;

    const extra = await db.select().from(schema.userBranchAccess).where(eq(schema.userBranchAccess.userId, dbUser.id));
    const ids = new Set<number>([dbUser.branchId, ...extra.map((r: any) => r.branchId)]);
    return Array.from(ids);
  }

  // Finds everyone in a tenant who should be notified/can act on alerts for
  // a given permission (e.g. 'alerts.receive'). The tenant admin always
  // qualifies (they can see and do everything); beyond that, matches
  // hasPrivilege()'s own semantics exactly — a user's own explicitly-granted
  // privileges OR their role's current defaults, not just the stored
  // snapshot. Batches the role-defaults lookup once per tenant rather than
  // once per user.
// `permission` accepts either one key or an array (matches ANY of them) —
// used to notify everyone holding a specific per-type privilege (e.g.
// 'attendance.approve.late_arrival') UNION anyone still on the general
// legacy bucket ('attendance.approve'), so splitting a bucket into specific
// toggles never silently drops someone from a notification list who's
// already relying on the old key.
export async function getUsersWithPrivilege(tenantId: number, permission: string | string[]): Promise<any[]> {
    const permissions = Array.isArray(permission) ? permission : [permission];
    const tenantUsers = await db.select().from(schema.users).where(eq(schema.users.tenantId, tenantId));
    const roleDefaultRows = await db.select().from(schema.rolePrivilegeDefaults).where(eq(schema.rolePrivilegeDefaults.tenantId, tenantId));
    const defaultsByRole = new Map<string, string[]>(
      roleDefaultRows.map((r: any) => [r.roleName, Array.isArray(r.privileges) ? r.privileges : []])
    );
    return tenantUsers.filter((u: any) => {
      if (u.role === 'tenant_admin') return true;
      const privs = (u.privileges as string[]) || [];
      if (Array.isArray(privs) && permissions.some((p) => privs.includes(p))) return true;
      const roleDefaults = defaultsByRole.get(u.role) || [];
      return permissions.some((p) => roleDefaults.includes(p));
    });
  }
