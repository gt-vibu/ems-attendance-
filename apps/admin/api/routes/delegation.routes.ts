import { Router } from 'express';
import { eq, and, or, desc } from 'drizzle-orm';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { getEffectivePrivileges } from '../auth/rbac';
import { logToAuditLedger } from '../services/audit';
import { notifyUser } from '../services/notifications';
import { tenantDateKey } from '../services/tenantTime';

export const router = Router();

// Delegation: fine-grained, time-bounded privilege handoff, not identity
// impersonation. Anyone can delegate a subset of privileges THEY hold
// (enforced below via getEffectivePrivileges — you can never hand out power
// you don't have) to a co-worker for a bounded date range; it auto-expires,
// no manual cleanup. Tenant admin/super admin already bypass every
// privilege check (see hasPrivilege), so they're never blocked by anyone
// else's delegation — that's the "emergency override" guarantee for free.

router.post('/api/tenant/delegations', authenticate, async (req: any, res: any) => {
  try {
    const { delegatedToUserId, privilegeKeys, startDate, endDate, reason } = req.body || {};
    if (!delegatedToUserId || !Array.isArray(privilegeKeys) || privilegeKeys.length === 0 || !startDate || !endDate) {
      return res.status(400).json({ error: 'delegatedToUserId, privilegeKeys (non-empty), startDate, and endDate are required.' });
    }
    if (startDate > endDate) {
      return res.status(400).json({ error: 'startDate must be on or before endDate.' });
    }
    if (Number(delegatedToUserId) === req.user.userId) {
      return res.status(400).json({ error: 'You cannot delegate to yourself.' });
    }
    const toUserRows = await db.select().from(schema.users).where(eq(schema.users.id, Number(delegatedToUserId))).limit(1);
    if (toUserRows.length === 0 || toUserRows[0].tenantId !== req.user.tenantId) {
      return res.status(404).json({ error: 'Delegate not found in your organization.' });
    }

    // Can only delegate privileges you yourself actually hold — same
    // "power flows downward only" guarantee role editing already enforces.
    const myPrivileges = await getEffectivePrivileges(req.user);
    if (myPrivileges !== 'ALL') {
      const notMine = privilegeKeys.filter((k: string) => !myPrivileges.includes(k));
      if (notMine.length > 0) {
        return res.status(403).json({ error: `You cannot delegate privileges you don't hold: ${notMine.join(', ')}` });
      }
    }

    const [created] = await db.insert(schema.delegations).values({
      tenantId: req.user.tenantId,
      delegatedByUserId: req.user.userId,
      delegatedToUserId: Number(delegatedToUserId),
      privilegeKeys,
      startDate,
      endDate,
      reason: reason || null,
    }).returning();

    await logToAuditLedger({
      tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name,
      action: 'DELEGATION_CREATED',
      details: { delegationId: created.id, delegatedToUserId: Number(delegatedToUserId), privilegeKeys, startDate, endDate },
    });
    await notifyUser(
      Number(delegatedToUserId),
      'You were delegated new access',
      `${req.user.name} delegated ${privilegeKeys.length} privilege(s) to you from ${startDate} to ${endDate}${reason ? `: ${reason}` : '.'}`
    );

    res.json({ delegation: created });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/tenant/delegations', authenticate, async (req: any, res: any) => {
  try {
    // Everyone sees delegations they gave or received — no separate
    // privilege needed, this is your own data either way.
    const rows = await db.select().from(schema.delegations).where(
      and(
        eq(schema.delegations.tenantId, req.user.tenantId),
        or(eq(schema.delegations.delegatedByUserId, req.user.userId), eq(schema.delegations.delegatedToUserId, req.user.userId)),
      )
    ).orderBy(desc(schema.delegations.createdAt));

    const userIds = Array.from(new Set(rows.flatMap((r: any) => [r.delegatedByUserId, r.delegatedToUserId])));
    const users = userIds.length
      ? await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(eq(schema.users.tenantId, req.user.tenantId))
      : [];
    const nameById = new Map(users.map((u: any) => [u.id, u.name]));

    const tenantRows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId)).limit(1);
    const today = tenantDateKey(tenantRows[0] || null);
    const enriched = rows.map((r: any) => ({
      ...r,
      delegatedByName: nameById.get(r.delegatedByUserId) || 'Unknown',
      delegatedToName: nameById.get(r.delegatedToUserId) || 'Unknown',
      effectiveStatus: r.status !== 'active' ? r.status : (r.endDate < today ? 'expired' : 'active'),
    }));

    res.json({ delegations: enriched });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/tenant/delegations/:id/revoke', authenticate, async (req: any, res: any) => {
  try {
    const rows = await db.select().from(schema.delegations).where(eq(schema.delegations.id, parseInt(req.params.id, 10)));
    if (rows.length === 0) return res.status(404).json({ error: 'Delegation not found.' });
    const delegation = rows[0];
    if (delegation.tenantId !== req.user.tenantId) return res.status(403).json({ error: 'Access denied.' });
    // Only the delegator, the tenant admin (via hasPrivilege bypass — this
    // route intentionally also allows any tenant_admin), or the delegate
    // themself (declining) can revoke.
    const isDelegator = delegation.delegatedByUserId === req.user.userId;
    const isDelegate = delegation.delegatedToUserId === req.user.userId;
    const isAdmin = req.user.role === 'tenant_admin' || req.user.role === 'super_admin';
    if (!isDelegator && !isDelegate && !isAdmin) {
      return res.status(403).json({ error: 'Only the delegator, the delegate, or a tenant admin can revoke this delegation.' });
    }
    if (delegation.status !== 'active') {
      return res.status(400).json({ error: 'This delegation is not active.' });
    }
    await db.update(schema.delegations).set({
      status: 'revoked', revokedAt: new Date(), revokedByUserId: req.user.userId,
    }).where(eq(schema.delegations.id, delegation.id));
    await logToAuditLedger({
      tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name,
      action: 'DELEGATION_REVOKED', details: { delegationId: delegation.id },
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
