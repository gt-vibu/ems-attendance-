import { Router } from 'express';
import { eq, and, inArray } from 'drizzle-orm';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege, getEffectivePrivileges, getScopedBranchIds, isPlatformFeatureAllowedForTenant } from '../auth/rbac';
import { logToAuditLedger } from '../services/audit';
import { FEATURE_CATALOG, FEATURE_CATALOG_KEYS, FEATURE_DEPENDENCIES } from '../auth/featureCatalog';

export const router = Router();

// Server-driven feature catalog — the Role Permissions editor and the
// hire-form's "additional access" grid both render from this one endpoint,
// so adding a feature later means editing only featureCatalog.ts.
// 'dependencies' lets the frontend warn before an interrelated toggle is
// left in a broken state (see FeatureCatalogGrid.tsx) — e.g. resolving
// break-violation alerts with the ability to even receive them revoked.
router.get('/api/tenant/feature-catalog', authenticate, async (req: any, res: any) => {
  res.json({ catalog: FEATURE_CATALOG, dependencies: FEATURE_DEPENDENCIES });
});

// A caller's own effective privileges — lets the frontend know which
// catalog toggles it's even allowed to grant to someone else (precedence of
// power), without duplicating that logic client-side.
router.get('/api/tenant/my-privileges', authenticate, async (req: any, res: any) => {
  try {
    const privileges = await getEffectivePrivileges(req.user);
    res.json({ privileges });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// The branches a caller can manage — every branch for an unrestricted
// caller (tenant_admin/super_admin, or anyone not yet branch-scoped), else
// exactly their accessible set (primary branch + any 'branch.multi_access'
// grants). Branches.tsx and the hire form's branch dropdown use this
// instead of the unscoped GET /api/branches, so a scoped GM only ever sees
// branches they actually manage.
router.get('/api/tenant/my-branches', authenticate, async (req: any, res: any) => {
  try {
    const scopedBranchIds = await getScopedBranchIds(req.user);
    const filter = scopedBranchIds !== null
      ? and(eq(schema.branches.tenantId, req.user.tenantId), eq(schema.branches.status, 'active'), inArray(schema.branches.id, scopedBranchIds))
      : and(eq(schema.branches.tenantId, req.user.tenantId), eq(schema.branches.status, 'active'));
    const branchList = await db.select().from(schema.branches).where(filter);
    res.json({ branches: branchList });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Any authenticated tenant user can list roles — needed for the onboarding
// role dropdown (and to know what a role currently grants, for the
// pre-checked hire-form grid).
router.get('/api/tenant/roles', authenticate, async (req: any, res: any) => {
  try {
    const roles = await db.select().from(schema.rolePrivilegeDefaults).where(eq(schema.rolePrivilegeDefaults.tenantId, req.user.tenantId));
    res.json({ roles });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function validatePrivilegesList(privileges: any): string[] | null {
  if (!Array.isArray(privileges)) return null;
  for (const p of privileges) {
    if (typeof p !== 'string' || !FEATURE_CATALOG_KEYS.has(p)) return null;
  }
  return privileges as string[];
}

// Defining what a role can do is powerful (it cascades to everyone hired
// into it, immediately) — gated by 'roles.manage', which no role holds by
// default except tenant_admin (unrestricted). A tenant admin can delegate it
// to a trusted user later via the same grant mechanism as any other feature.
router.post('/api/tenant/roles', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'roles.manage')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    if (req.user.role !== 'super_admin' && !(await isPlatformFeatureAllowedForTenant(req.user.tenantId, 'custom_rbac'))) {
      return res.status(403).json({ error: "Custom Roles is not included in your organization's plan. Contact your platform provider to enable it." });
    }
    const { roleName, privileges } = req.body;
    if (!roleName || typeof roleName !== 'string' || !roleName.trim()) {
      return res.status(400).json({ error: 'roleName is required' });
    }
    const validated = validatePrivilegesList(privileges ?? []);
    if (validated === null) {
      return res.status(400).json({ error: 'privileges must be an array of known feature keys' });
    }

    // PRECEDENCE OF POWER: same rule as hiring — can't grant a role a
    // privilege the requester doesn't themselves effectively hold.
    const requesterPrivileges = await getEffectivePrivileges(req.user);
    const grantable = requesterPrivileges === 'ALL' ? validated : validated.filter((p) => requesterPrivileges.includes(p));

    const existing = await db.select().from(schema.rolePrivilegeDefaults).where(
      and(eq(schema.rolePrivilegeDefaults.tenantId, req.user.tenantId), eq(schema.rolePrivilegeDefaults.roleName, roleName.trim()))
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: 'A role with this name already exists' });
    }

    const [role] = await db.insert(schema.rolePrivilegeDefaults).values({
      tenantId: req.user.tenantId,
      roleName: roleName.trim(),
      privileges: grantable,
    }).returning();

    await logToAuditLedger({
      tenantId: req.user.tenantId,
      actorId: req.user.userId,
      actorName: req.user.name,
      action: 'ROLE_CREATED',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
      details: { roleId: role.id, roleName: role.roleName, privileges: grantable },
    });

    res.json({ success: true, role });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/api/tenant/roles/:id', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'roles.manage')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const roleId = parseInt(req.params.id, 10);
    const roleRows = await db.select().from(schema.rolePrivilegeDefaults).where(eq(schema.rolePrivilegeDefaults.id, roleId));
    if (roleRows.length === 0) return res.status(404).json({ error: 'Role not found' });
    if (roleRows[0].tenantId !== req.user.tenantId) {
      return res.status(403).json({ error: 'Access denied: This role does not belong to your organization.' });
    }

    const { privileges } = req.body;
    const validated = validatePrivilegesList(privileges);
    if (validated === null) {
      return res.status(400).json({ error: 'privileges must be an array of known feature keys' });
    }

    // PRECEDENCE OF POWER: only newly-added privileges (ones not already on
    // the role) need to be checked against what the requester holds —
    // removing a privilege the requester might not personally have is
    // always safe (it's strictly reducing power).
    const currentPrivileges: string[] = Array.isArray(roleRows[0].privileges) ? (roleRows[0].privileges as string[]) : [];
    const requesterPrivileges = await getEffectivePrivileges(req.user);
    const finalPrivileges = validated.filter((p) => {
      const isNew = !currentPrivileges.includes(p);
      if (!isNew) return true;
      return requesterPrivileges === 'ALL' || requesterPrivileges.includes(p);
    });

    const [updated] = await db.update(schema.rolePrivilegeDefaults)
      .set({ privileges: finalPrivileges, updatedAt: new Date() })
      .where(eq(schema.rolePrivilegeDefaults.id, roleId))
      .returning();

    await logToAuditLedger({
      tenantId: req.user.tenantId,
      actorId: req.user.userId,
      actorName: req.user.name,
      action: 'ROLE_UPDATED',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
      details: { roleId, roleName: roleRows[0].roleName, privileges: finalPrivileges },
    });

    res.json({ success: true, role: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
