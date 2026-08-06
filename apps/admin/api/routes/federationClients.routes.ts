import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../db';
import { sendServerError } from '../utils/errors';
import { authenticate, requireRole } from '../middleware/authenticate';
import { generateClientId, generateClientSecret } from '../auth/federationClients';
import { logToAuditLedger } from '../services/audit';

// Super-admin-only management of federation machine credentials (the
// provisioning side of /v1/federation/*), scoped by an explicit
// :tenantId path param rather than req.user.tenantId — a super_admin
// session isn't bound to one tenant, so every route here is nested under
// a specific tenant the same way GET /api/super/tenants/:tenantId/admins
// already is. Deliberately not exposed to tenant admins: federation is a
// platform-level integration capability the super admin provisions on a
// tenant's behalf, same posture as Plan Features.
export const router = Router();

router.get('/api/super/tenants/:tenantId/federation-clients', authenticate, requireRole('super_admin'), async (req: any, res: any) => {
  try {
    const tenantId = Number(req.params.tenantId);
    const rows = await db.select().from(schema.federationClients).where(eq(schema.federationClients.tenantId, tenantId));
    res.json({
      federationClients: rows.map((r: any) => ({
        id: r.id, name: r.name, clientId: r.clientId, environment: r.environment, scopes: r.scopes,
        status: r.status, lastUsedAt: r.lastUsedAt, revokedAt: r.revokedAt, createdAt: r.createdAt,
      })),
    });
  } catch (err: any) {
    sendServerError(res, err, 'federationClients.routes.ts');
  }
});

router.post('/api/super/tenants/:tenantId/federation-clients', authenticate, requireRole('super_admin'), async (req: any, res: any) => {
  try {
    const tenantId = Number(req.params.tenantId);
    const tenantRows = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
    if (tenantRows.length === 0) return res.status(404).json({ error: 'Tenant not found.' });

    const { name, environment, scopes } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const resolvedEnvironment = ['sandbox', 'staging', 'production'].includes(environment) ? environment : 'sandbox';
    const resolvedScopes = Array.isArray(scopes) && scopes.length > 0 ? scopes : ['attendance', 'leave', 'payroll', 'employees'];

    const clientId = generateClientId();
    const { rawSecret, secretHash } = await generateClientSecret();
    const [created] = await db.insert(schema.federationClients).values({
      tenantId,
      name: name.trim(),
      clientId,
      clientSecretHash: secretHash,
      environment: resolvedEnvironment,
      scopes: resolvedScopes,
      createdByUserId: req.user.userId,
    }).returning();

    await logToAuditLedger({
      tenantId,
      actorId: req.user.userId,
      actorName: req.user.name || req.user.email || 'Super Admin',
      action: 'FEDERATION_CLIENT_CREATED',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
      details: { federationClientId: created.id, name: created.name, environment: resolvedEnvironment, scopes: resolvedScopes },
    });

    res.status(201).json({
      federationClient: { id: created.id, name: created.name, clientId: created.clientId, environment: created.environment, scopes: created.scopes, createdAt: created.createdAt },
      // Shown once — same "copy now" contract as a service account key.
      clientSecret: rawSecret,
    });
  } catch (err: any) {
    sendServerError(res, err, 'federationClients.routes.ts');
  }
});

router.delete('/api/super/tenants/:tenantId/federation-clients/:id', authenticate, requireRole('super_admin'), async (req: any, res: any) => {
  try {
    const tenantId = Number(req.params.tenantId);
    const id = Number(req.params.id);
    const rows = await db.select().from(schema.federationClients).where(and(eq(schema.federationClients.id, id), eq(schema.federationClients.tenantId, tenantId))).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Federation client not found' });
    if (rows[0].status === 'revoked') return res.json({ success: true });

    await db.update(schema.federationClients).set({ status: 'revoked', revokedAt: new Date() }).where(eq(schema.federationClients.id, id));
    await logToAuditLedger({
      tenantId,
      actorId: req.user.userId,
      actorName: req.user.name || req.user.email || 'Super Admin',
      action: 'FEDERATION_CLIENT_REVOKED',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
      details: { federationClientId: id, name: rows[0].name },
    });
    res.json({ success: true });
  } catch (err: any) {
    sendServerError(res, err, 'federationClients.routes.ts');
  }
});
