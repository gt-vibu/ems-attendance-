import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db, schema } from '../../db';
import { tenantDateKey } from '../services/tenantTime';

// Platform layer, above everything else in the app: tenants.featuresAllowed
// is a super-admin-controlled whitelist of which whole MODULES a tenant is
// even allowed to use.
export const PLATFORM_FEATURES = [
  { key: 'device_identity', label: 'Device Identity Check', description: 'WebAuthn device registration required to check in (fingerprint, Face/Touch ID, or PIN).' },
  { key: 'face_recognition', label: 'Face Recognition Check-in', description: 'Camera-based face + liveness verification as the primary identity check.' },
  { key: 'wifi_lock', label: 'Corporate Wi-Fi IP Security', description: 'Restrict check-in to the registered corporate network IP.' },
  { key: 'gps_geofence', label: 'GPS Geofencing Bounds', description: 'Restrict check-in to within a radius of the branch location.' },
  { key: 'documents', label: 'Document Storage', description: 'Employee document upload/storage module.' },
  { key: 'qr_attendance', label: 'QR Attendance', description: 'Rotating-QR-code check-in module.' },
  { key: 'wfh', label: 'Work From Home', description: 'Work-from-home attendance mode.' },
  { key: 'teams', label: 'Teams & Hierarchy Workspace', description: 'Enterprise team management, reporting tree, and leadership routing workspace.' },
  { key: 'webhooks', label: 'Webhooks & Integrations', description: 'Outbound webhook subscriptions for external integrations.' },
  { key: 'service_accounts', label: 'API Keys (Service Accounts)', description: 'Machine-to-machine API key issuance.' },
  { key: 'custom_rbac', label: 'Custom Roles', description: 'Creating custom roles beyond the built-in ones.' },
  { key: 'device_change', label: 'Device Change Requests', description: 'Lets an admin reset an employee\'s registered device.' },
  { key: 'notification_routing', label: 'Configurable Approval Routing', description: 'Admin-configurable approval routing chains.' },
  { key: 'attendance_freeze', label: 'Attendance Freeze', description: 'HR can manually close a month\'s attendance.' },
  { key: 'missed_checkout_verification', label: 'Missed Checkout Verification', description: 'Waits a configurable grace period past shift end.' },
  { key: 'payroll_attendance_driven', label: 'Attendance-Driven Payroll', description: 'Payroll working days become calendar-derived.' },
  { key: 'payroll_lock_adjustments', label: 'Payroll Lock & Adjustments', description: 'Lets a payroll period be locked so it can never be silently recalculated.' },
  { key: 'unified_notifications', label: 'Unified Notification Policies', description: 'Routes attendance/leave/payroll/reports/approval events through one policy.' },
  { key: 'payroll_batches', label: 'Payroll Batches (Full Lifecycle)', description: 'Runs payroll for a whole period as a single tracked batch.' },
  { key: 'smartteams_federation', label: 'SmartTeams Federation API', description: 'Exposes the /v1/federation/* provider API for a headless BlizBooks integration (Employees, Attendance, Leave, Payroll).' },
];

export const PLATFORM_FEATURE_DEPENDENCIES: Record<string, string[]> = {
  payroll_attendance_driven: ['attendance_freeze'],
  payroll_lock_adjustments: ['payroll_attendance_driven'],
};

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

export function isFaceIdEnabledForTenant(tenant: { featuresAllowed?: unknown; faceIdEnabled?: boolean | null } | null | undefined): boolean {
  if (tenant?.faceIdEnabled === false) return false;
  return isPlatformFeatureAllowed(tenant, 'face_recognition');
}

export async function isFaceIdEnabledForTenantId(tenantId: number): Promise<boolean> {
  const rows = await db.select({ featuresAllowed: schema.tenants.featuresAllowed, faceIdEnabled: schema.tenants.faceIdEnabled }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  return isFaceIdEnabledForTenant(rows[0] as any);
}

export async function getDefaultPrivilegesForRole(tenantId: number | null | undefined, role: string): Promise<string[]> {
  if (!tenantId) return [];
  const rows = await db.select().from(schema.rolePrivilegeDefaults).where(
    and(eq(schema.rolePrivilegeDefaults.tenantId, tenantId), eq(schema.rolePrivilegeDefaults.roleName, role))
  ).limit(1);
  if (rows.length === 0) return [];
  const privs = rows[0].privileges;
  return Array.isArray(privs) ? (privs as string[]) : [];
}

export async function hasAnyPrivilege(user: any, permissions: string[]): Promise<boolean> {
  for (const permission of permissions) {
    if (await hasPrivilege(user, permission)) return true;
  }
  return false;
}

export async function hasPrivilege(user: any, permission: string): Promise<boolean> {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role === 'tenant_admin') return true;

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

  if (await hasActiveDelegatedPrivilege(dbUser.id, dbUser.tenantId, permission)) {
    return true;
  }

  return false;
}

export async function hasActiveDelegatedPrivilege(userId: number, tenantId: number, permission: string): Promise<boolean> {
  const tenantRows = await db.select({ timezone: schema.tenants.timezone }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  const today = tenantDateKey(tenantRows[0] || null);
  const rows = await db.select().from(schema.delegations).where(
    and(
      eq(schema.delegations.tenantId, tenantId),
      eq(schema.delegations.delegatedToUserId, userId),
      eq(schema.delegations.status, 'active'),
      sql`${schema.delegations.startDate} <= ${today}`,
      sql`${schema.delegations.endDate} >= ${today}`,
    )
  );
  return rows.some((d: any) => Array.isArray(d.privilegeKeys) && d.privilegeKeys.includes(permission));
}

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
