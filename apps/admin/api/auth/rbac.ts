import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db, schema } from '../../db';

export function getDefaultPrivilegesForRole(role: string): string[] {
    switch (role) {
      case 'HR':
        return ['employee.create', 'employee.read', 'attendance.read', 'reports.view', 'breaks.manage', 'settings.edit'];
      case 'GM':
        return ['attendance.read', 'attendance.approve', 'reports.view', 'breaks.manage', 'settings.edit'];
      case 'manager':
        return ['attendance.read', 'attendance.approve', 'reports.view'];
      case 'employee':
        return ['attendance.create', 'breaks.create', 'reports.view'];
      default:
        return [];
    }
  }

export async function hasPrivilege(user: any, permission: string): Promise<boolean> {
    if (!user) return false;
    if (user.role === 'super_admin') return true;
    if (user.role === 'tenant_admin') return true;

    const userRec = await db.select().from(schema.users).where(eq(schema.users.id, user.userId || 0)).limit(1);
    if (userRec.length === 0) return false;
    const dbUser = userRec[0];

    if (dbUser.role === 'super_admin' || dbUser.role === 'tenant_admin') return true;

    const userPrivileges = dbUser.privileges as string[];
    if (userPrivileges && Array.isArray(userPrivileges) && userPrivileges.includes(permission)) {
      return true;
    }

    const defaultPrivs = getDefaultPrivilegesForRole(dbUser.role);
    if (defaultPrivs.includes(permission)) {
      return true;
    }

    return false;
  }

  // A user's full effective privilege set: their own explicitly-granted
  // privileges plus whatever their role gets by default. 'ALL' for the two
  // admin tiers, who are unrestricted. Used to enforce that power can only
  // ever be delegated downward — nobody can hand out a privilege they don't
  // themselves hold.
export async function getEffectivePrivileges(user: any): Promise<string[] | 'ALL'> {
    if (!user) return [];
    if (user.role === 'super_admin' || user.role === 'tenant_admin') return 'ALL';
    const userRec = await db.select().from(schema.users).where(eq(schema.users.id, user.userId || 0)).limit(1);
    if (userRec.length === 0) return [];
    const dbUser = userRec[0];
    if (dbUser.role === 'super_admin' || dbUser.role === 'tenant_admin') return 'ALL';
    const own = Array.isArray(dbUser.privileges) ? (dbUser.privileges as string[]) : [];
    const defaults = getDefaultPrivilegesForRole(dbUser.role);
    return Array.from(new Set([...own, ...defaults]));
  }

  // Finds everyone in a tenant who should be notified/can act on alerts for
  // a given permission (e.g. 'alerts.receive'). The tenant admin always
  // qualifies (they can see and do everything); beyond that, only users the
  // tenant admin has explicitly toggled the permission on for are included —
  // these are opt-in, not role defaults.
export async function getUsersWithPrivilege(tenantId: number, permission: string): Promise<any[]> {
    const tenantUsers = await db.select().from(schema.users).where(eq(schema.users.tenantId, tenantId));
    return tenantUsers.filter((u: any) => {
      if (u.role === 'tenant_admin') return true;
      const privs = (u.privileges as string[]) || [];
      return Array.isArray(privs) && privs.includes(permission);
    });
  }
