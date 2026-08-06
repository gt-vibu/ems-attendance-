import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../db';
import { sendServerError } from '../utils/errors';
import { authenticate, requireRole } from '../middleware/authenticate';
import { logToAuditLedger } from '../services/audit';

export const router = Router();

// Super-admin endpoint for viewing and managing connected platform applications for a specific tenant.
router.get('/api/super/tenants/:tenantId/connected-apps', authenticate, requireRole('super_admin'), async (req: any, res: any) => {
  try {
    const tenantId = Number(req.params.tenantId);
    const authRows = await db.select().from(schema.tenantFederationAuthorizations).where(eq(schema.tenantFederationAuthorizations.tenantId, tenantId));
    const allApps = await db.select().from(schema.federationClients);

    const connectedApps = authRows.map((auth: any) => {
      const app = allApps.find((a: any) => a.clientId === auth.clientId);
      return {
        authorizationId: auth.id,
        appId: app?.id || 0,
        appName: app?.name || 'Unknown Application',
        company: app?.company || 'Third-Party Developer',
        clientId: auth.clientId,
        status: auth.status,
        authorizedScopes: Array.isArray(auth.authorizedScopes) ? auth.authorizedScopes : (app?.scopes || []),
        connectionDate: auth.connectionDate,
        lastSyncAt: auth.lastSyncAt,
        syncStatus: auth.syncStatus || 'healthy',
        tokenExpiry: auth.tokenExpiry,
        logoUrl: app?.logoUrl || null,
        environment: app?.environment || 'sandbox',
      };
    });

    res.json({ connectedApps });
  } catch (err: any) {
    sendServerError(res, err, 'tenantConnectedApps.routes.ts');
  }
});

router.post('/api/super/tenants/:tenantId/connected-apps/:appId/authorize', authenticate, requireRole('super_admin'), async (req: any, res: any) => {
  try {
    const tenantId = Number(req.params.tenantId);
    const appId = Number(req.params.appId);
    const { scopes } = req.body || {};

    const appRows = await db.select().from(schema.federationClients).where(eq(schema.federationClients.id, appId)).limit(1);
    if (appRows.length === 0) return res.status(404).json({ error: 'Application not found.' });

    const app = appRows[0];
    const resolvedScopes = Array.isArray(scopes) && scopes.length > 0 ? scopes : app.scopes;

    const existing = await db.select().from(schema.tenantFederationAuthorizations)
      .where(and(eq(schema.tenantFederationAuthorizations.tenantId, tenantId), eq(schema.tenantFederationAuthorizations.clientId, app.clientId)))
      .limit(1);

    if (existing.length > 0) {
      await db.update(schema.tenantFederationAuthorizations).set({
        status: 'authorized',
        authorizedScopes: resolvedScopes,
        updatedAt: new Date(),
      }).where(eq(schema.tenantFederationAuthorizations.id, existing[0].id));
    } else {
      await db.insert(schema.tenantFederationAuthorizations).values({
        tenantId,
        clientId: app.clientId,
        status: 'authorized',
        authorizedScopes: resolvedScopes,
        connectionDate: new Date(),
        syncStatus: 'healthy',
      });
    }

    await logToAuditLedger({
      tenantId,
      actorId: req.user.userId,
      actorName: req.user.name || req.user.email || 'Super Admin',
      action: 'TENANT_APP_AUTHORIZED',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
      details: { tenantId, appId, clientId: app.clientId, scopes: resolvedScopes },
    });

    res.json({ success: true });
  } catch (err: any) {
    sendServerError(res, err, 'tenantConnectedApps.routes.ts');
  }
});

router.delete('/api/super/tenants/:tenantId/connected-apps/:appId', authenticate, requireRole('super_admin'), async (req: any, res: any) => {
  try {
    const tenantId = Number(req.params.tenantId);
    const appId = Number(req.params.appId);

    const appRows = await db.select().from(schema.federationClients).where(eq(schema.federationClients.id, appId)).limit(1);
    if (appRows.length === 0) return res.status(404).json({ error: 'Application not found.' });

    const app = appRows[0];
    await db.update(schema.tenantFederationAuthorizations).set({
      status: 'revoked',
      updatedAt: new Date(),
    }).where(and(eq(schema.tenantFederationAuthorizations.tenantId, tenantId), eq(schema.tenantFederationAuthorizations.clientId, app.clientId)));

    await logToAuditLedger({
      tenantId,
      actorId: req.user.userId,
      actorName: req.user.name || req.user.email || 'Super Admin',
      action: 'TENANT_APP_REVOKED',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
      details: { tenantId, appId, clientId: app.clientId },
    });

    res.json({ success: true });
  } catch (err: any) {
    sendServerError(res, err, 'tenantConnectedApps.routes.ts');
  }
});
