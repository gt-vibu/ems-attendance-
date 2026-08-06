import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../db';
import { sendServerError } from '../utils/errors';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege, isPlatformFeatureAllowedForTenant } from '../auth/rbac';
import { generateClientId, generateClientSecret } from '../auth/federationClients';
import { logToAuditLedger } from '../services/audit';

// Human-facing (tenant admin) management of federation machine credentials
// — the provisioning side of the /v1/federation/* API, same
// gate-by-platform-feature-then-privilege shape as
// serviceAccounts.routes.ts, since a federation client is the same kind of
// thing (a machine credential) scoped to a narrower purpose.
export const router = Router();

async function canManageFederationClients(user: any): Promise<boolean> {
  if (user?.role !== 'super_admin' && (!user?.tenantId || !(await isPlatformFeatureAllowedForTenant(user.tenantId, 'smartteams_federation')))) return false;
  return hasPrivilege(user, 'serviceAccounts.manage');
}

router.get('/api/tenant/federation-clients', authenticate, async (req: any, res: any) => {
  try {
    if (!await canManageFederationClients(req.user)) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const rows = await db.select().from(schema.federationClients).where(eq(schema.federationClients.tenantId, req.user.tenantId));
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

router.post('/api/tenant/federation-clients', authenticate, async (req: any, res: any) => {
  try {
    if (!await canManageFederationClients(req.user)) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const { name, environment, scopes } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const resolvedEnvironment = ['sandbox', 'staging', 'production'].includes(environment) ? environment : 'sandbox';
    const resolvedScopes = Array.isArray(scopes) && scopes.length > 0 ? scopes : ['attendance', 'leave', 'payroll', 'employees'];

    const clientId = generateClientId();
    const { rawSecret, secretHash } = await generateClientSecret();
    const [created] = await db.insert(schema.federationClients).values({
      tenantId: req.user.tenantId,
      name: name.trim(),
      clientId,
      clientSecretHash: secretHash,
      environment: resolvedEnvironment,
      scopes: resolvedScopes,
      createdByUserId: req.user.userId,
    }).returning();

    await logToAuditLedger({
      tenantId: req.user.tenantId,
      actorId: req.user.userId,
      actorName: req.user.name || req.user.email || 'Tenant Admin',
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

router.delete('/api/tenant/federation-clients/:id', authenticate, async (req: any, res: any) => {
  try {
    if (!await canManageFederationClients(req.user)) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const id = Number(req.params.id);
    const rows = await db.select().from(schema.federationClients).where(and(eq(schema.federationClients.id, id), eq(schema.federationClients.tenantId, req.user.tenantId))).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Federation client not found' });
    if (rows[0].status === 'revoked') return res.json({ success: true });

    await db.update(schema.federationClients).set({ status: 'revoked', revokedAt: new Date() }).where(eq(schema.federationClients.id, id));
    await logToAuditLedger({
      tenantId: req.user.tenantId,
      actorId: req.user.userId,
      actorName: req.user.name || req.user.email || 'Tenant Admin',
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
