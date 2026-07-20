import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db, schema } from '../../db';

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
export async function getUsersWithPrivilege(tenantId: number, permission: string): Promise<any[]> {
    const tenantUsers = await db.select().from(schema.users).where(eq(schema.users.tenantId, tenantId));
    const roleDefaultRows = await db.select().from(schema.rolePrivilegeDefaults).where(eq(schema.rolePrivilegeDefaults.tenantId, tenantId));
    const defaultsByRole = new Map<string, string[]>(
      roleDefaultRows.map((r: any) => [r.roleName, Array.isArray(r.privileges) ? r.privileges : []])
    );
    return tenantUsers.filter((u: any) => {
      if (u.role === 'tenant_admin') return true;
      const privs = (u.privileges as string[]) || [];
      if (Array.isArray(privs) && privs.includes(permission)) return true;
      const roleDefaults = defaultsByRole.get(u.role) || [];
      return roleDefaults.includes(permission);
    });
  }
