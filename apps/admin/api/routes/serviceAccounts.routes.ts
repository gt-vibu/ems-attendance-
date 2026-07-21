import { Router } from 'express';
import { eq, and, isNull } from 'drizzle-orm';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege, isPlatformFeatureAllowedForTenant } from '../auth/rbac';
import { generateServiceAccountKey } from '../auth/serviceAccounts';
import { logToAuditLedger } from '../services/audit';

export const router = Router();

// Gated two ways: the platform must allow the 'service_accounts' module for
// this tenant at all (super admin's plan), AND the caller must hold the
// delegable 'serviceAccounts.manage' privilege within that tenant. A
// service account can still only ever be granted privileges its creator
// already holds (see the check below), so delegating this doesn't let a
// grantee mint a more powerful credential than they themselves have.
async function canManageServiceAccounts(user: any): Promise<boolean> {
  if (user?.role !== 'super_admin' && (!user?.tenantId || !(await isPlatformFeatureAllowedForTenant(user.tenantId, 'service_accounts')))) return false;
  return hasPrivilege(user, 'serviceAccounts.manage');
}

// List — never returns the key itself (it isn't stored anywhere retrievable
// after creation), only metadata useful for auditing/rotation decisions.
router.get('/api/tenant/service-accounts', authenticate, async (req: any, res: any) => {
  try {
    if (!await canManageServiceAccounts(req.user)) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const rows = await db.select().from(schema.serviceAccounts).where(eq(schema.serviceAccounts.tenantId, req.user.tenantId));
    res.json({
      serviceAccounts: rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        keyPrefix: r.keyPrefix,
        privileges: r.privileges,
        lastUsedAt: r.lastUsedAt,
        revokedAt: r.revokedAt,
        createdAt: r.createdAt,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create — returns the raw key exactly once. The client must capture it
// immediately; there is no way to retrieve it again (only revoke + reissue).
router.post('/api/tenant/service-accounts', authenticate, async (req: any, res: any) => {
  try {
    if (!await canManageServiceAccounts(req.user)) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const { name, privileges } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!Array.isArray(privileges) || privileges.length === 0) {
      return res.status(400).json({ error: 'privileges must be a non-empty array — a service account with no privileges cannot call anything.' });
    }
    // A service account can only ever be granted privileges its creator
    // actually holds themselves — same "can't delegate more than you have"
    // rule the rest of the RBAC system enforces (see rbac.ts).
    if (req.user.role !== 'super_admin') {
      const { getEffectivePrivileges } = await import('../auth/rbac');
      const callerPrivileges = await getEffectivePrivileges(req.user);
      if (callerPrivileges !== 'ALL') {
        const disallowed = privileges.filter((p: string) => !callerPrivileges.includes(p));
        if (disallowed.length > 0) {
          return res.status(403).json({ error: `Cannot grant privileges you don't hold: ${disallowed.join(', ')}` });
        }
      }
    }

    const { rawKey, keyPrefix, keyHash } = await generateServiceAccountKey();
    const [created] = await db.insert(schema.serviceAccounts).values({
      tenantId: req.user.tenantId,
      name: name.trim(),
      keyPrefix,
      keyHash,
      privileges,
      createdByUserId: req.user.userId,
    }).returning();

    await logToAuditLedger({
      tenantId: req.user.tenantId,
      actorId: req.user.userId,
      actorName: req.user.name || req.user.email || 'Tenant Admin',
      action: 'SERVICE_ACCOUNT_CREATED',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
      details: { serviceAccountId: created.id, name: created.name, privileges },
    });

    res.status(201).json({
      serviceAccount: { id: created.id, name: created.name, keyPrefix: created.keyPrefix, privileges: created.privileges, createdAt: created.createdAt },
      // Shown once. The frontend must present this prominently with a
      // "copy now, you won't see it again" warning.
      apiKey: rawKey,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Revoke — soft delete (revokedAt), so past usage stays in lastUsedAt/audit
// history instead of a foreign-key-cascaded row disappearing.
router.delete('/api/tenant/service-accounts/:id', authenticate, async (req: any, res: any) => {
  try {
    if (!await canManageServiceAccounts(req.user)) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const id = Number(req.params.id);
    const rows = await db.select().from(schema.serviceAccounts).where(
      and(eq(schema.serviceAccounts.id, id), eq(schema.serviceAccounts.tenantId, req.user.tenantId))
    ).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Service account not found' });
    if (rows[0].revokedAt) return res.json({ success: true }); // already revoked, idempotent

    await db.update(schema.serviceAccounts).set({ revokedAt: new Date() }).where(eq(schema.serviceAccounts.id, id));
    await logToAuditLedger({
      tenantId: req.user.tenantId,
      actorId: req.user.userId,
      actorName: req.user.name || req.user.email || 'Tenant Admin',
      action: 'SERVICE_ACCOUNT_REVOKED',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
      details: { serviceAccountId: id, name: rows[0].name },
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
