import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { sendServerError } from '../../utils/errors';
import { authenticateFederation, resolveFederationTenantContext, validateActionAssertion } from '../../middleware/federationAuth';
import { federationLimiter } from '../../middleware/rateLimit';
import { requireIdempotencyKey } from '../../middleware/federationIdempotency';
import { linkExternalId, resolveInternalId, resolveMappingByExternalId } from '../../services/federation/externalId';

export const router = Router();
router.use('/v1/federation', authenticateFederation, federationLimiter);

// PUT /v1/federation/tenants/{externalOrganizationId}
//
// A per-tenant client is already scoped to exactly one tenant (its access
// token carries a fixed tenantId), so for it this call only ever touches
// that same tenant's row; externalOrganizationId is the identity being
// linked, not a selector into some other tenant — unchanged behavior.
//
// A platform-wide client (tenantId: null on its token — see
// federationClients.ts) has no fixed tenant at all. This is deliberately
// the ONE route platform clients call without going through
// resolveFederationTenantContext(), because that middleware can only
// resolve a tenant that already has a mapping — and the very first call
// for a brand-new hotel/tenant has none yet. So this handler does its own
// two-way resolution: if externalOrganizationId is already mapped, it's an
// update to that existing tenant (same as the per-tenant path); if it
// isn't, a platform client is allowed to provision a BRAND NEW tenant row
// here. A per-tenant client hitting an unmapped externalOrganizationId is
// NOT allowed to silently create a second tenant — it only ever owns its
// one.
router.put('/v1/federation/tenants/:externalOrganizationId', requireIdempotencyKey, async (req: any, res: any) => {
  try {
    // This is the one platform-scoped write that intentionally runs before a
    // tenant mapping exists. It still carries the same short-lived assertion
    // as every other privileged federation mutation; `1` is only a sentinel
    // to keep the generic validator's non-null tenant guard meaningful while
    // the path itself binds the brand-new external tenant identity.
    const assertionFailure = validateActionAssertion(req, 1);
    if (assertionFailure) {
      return res.status(401).json({ error: assertionFailure, code: 'INVALID_ACTION_ASSERTION' });
    }
    const { externalOrganizationId } = req.params;
    const { name, timezone, currencyCode, status } = req.body || {};
    if (!name || !timezone || !currencyCode) {
      return res.status(422).json({ error: 'name, timezone, and currencyCode are required.' });
    }
    const resolvedStatus = status && ['active', 'suspended'].includes(status) ? status : undefined;

    let tenantId: number;
    let created = false;

    if (req.federation.isPlatformClient) {
      const existing = await resolveMappingByExternalId('tenant', externalOrganizationId);
      if (existing) {
        tenantId = existing.tenantId;
      } else {
        // Provision a brand-new tenant for this platform credential. Only
        // the tenant shell is created here (no human admin account) —
        // admin-user invitation/onboarding for a newly provisioned hotel
        // is a separate, deliberately out-of-scope concern from this
        // machine-to-machine endpoint; adminUid is a stable, non-guessable
        // placeholder derived from the external id until a real admin user
        // claims the tenant through the normal invite flow.
        const [inserted] = await db.insert(schema.tenants).values({
          name,
          timezone,
          status: resolvedStatus || 'active',
          adminUid: `federation:${externalOrganizationId}`,
        }).returning();
        tenantId = inserted.id;
        created = true;
        const link = await linkExternalId(tenantId, 'tenant', tenantId, externalOrganizationId);
        if (link.ok === false) {
          // Lost a create race to a concurrent identical request — fall
          // back to whichever tenant actually won.
          tenantId = link.existingInternalId;
          created = false;
        }
      }
    } else {
      tenantId = req.federation.tenantId;
    }

    if (!created) {
      const updateData: any = { name, timezone };
      if (resolvedStatus) updateData.status = resolvedStatus;
      await db.update(schema.tenants).set(updateData).where(eq(schema.tenants.id, tenantId));

      const link = await linkExternalId(tenantId, 'tenant', tenantId, externalOrganizationId);
      if (!link.ok) {
        return res.status(409).json({ error: 'externalOrganizationId is already linked to a different tenant.', code: 'EXTERNAL_ID_CONFLICT' });
      }
    }

    // Record tenant authorization in database so UI tracking shows the active connection
    if (req.federation?.clientId) {
      const existingAuth = await db.select().from(schema.tenantFederationAuthorizations)
        .where(and(eq(schema.tenantFederationAuthorizations.tenantId, tenantId), eq(schema.tenantFederationAuthorizations.clientId, req.federation.clientId)))
        .limit(1);
      if (existingAuth.length === 0) {
        await db.insert(schema.tenantFederationAuthorizations).values({
          tenantId,
          clientId: req.federation.clientId,
          status: 'authorized',
          authorizedScopes: req.federation.scopes || ['attendance.read', 'leave.read', 'payroll.read', 'employee.read'],
          connectionDate: new Date(),
          syncStatus: 'healthy',
        });
      }
    }

    res.status(created ? 201 : 200).json({ externalOrganizationId, internalTenantId: `tenant_${tenantId}`, status: resolvedStatus || 'active', aggregateVersion: 1 });
  } catch (err: any) {
    sendServerError(res, err, 'federation/tenants.routes.ts');
  }
});

router.put('/v1/federation/tenants/:externalOrganizationId/branches/:externalBranchId', requireIdempotencyKey, resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const { externalBranchId } = req.params;
    const { name, address, geofence, status } = req.body || {};
    if (!name) return res.status(422).json({ error: 'name is required.' });

    const tenantId = req.federation.tenantId;
    const existingInternalId = await resolveInternalId(tenantId, 'branch', externalBranchId);

    const branchData: any = { name, tenantId };
    if (geofence?.lat != null) branchData.locationLat = geofence.lat;
    if (geofence?.lng != null) branchData.locationLng = geofence.lng;
    if (geofence?.radiusMeters != null) branchData.locationRadiusMeters = geofence.radiusMeters;
    if (address?.line1) branchData.address = address.line1;
    if (status && ['active', 'inactive'].includes(status)) branchData.status = status;

    let branchId: number;
    if (existingInternalId !== null) {
      await db.update(schema.branches).set(branchData).where(and(eq(schema.branches.id, existingInternalId), eq(schema.branches.tenantId, tenantId)));
      branchId = existingInternalId;
    } else {
      const [inserted] = await db.insert(schema.branches).values(branchData).returning();
      branchId = inserted.id;
      await linkExternalId(tenantId, 'branch', branchId, externalBranchId);
    }

    res.json({ externalBranchId, status: status || 'active', aggregateVersion: 1 });
  } catch (err: any) {
    sendServerError(res, err, 'federation/tenants.routes.ts');
  }
});

router.patch('/v1/federation/branches/:externalBranchId', requireIdempotencyKey, resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const { externalBranchId } = req.params;
    const tenantId = req.federation.tenantId;
    const internalId = await resolveInternalId(tenantId, 'branch', externalBranchId);
    if (internalId === null) return res.status(404).json({ error: 'Unknown externalBranchId.' });

    const { name, geofence } = req.body || {};
    const patch: any = {};
    if (name !== undefined) patch.name = name;
    if (geofence?.lat != null) patch.locationLat = geofence.lat;
    if (geofence?.lng != null) patch.locationLng = geofence.lng;
    if (geofence?.radiusMeters != null) patch.locationRadiusMeters = geofence.radiusMeters;

    if (Object.keys(patch).length > 0) {
      await db.update(schema.branches).set(patch).where(and(eq(schema.branches.id, internalId), eq(schema.branches.tenantId, tenantId)));
    }

    res.json({ externalBranchId, aggregateVersion: 1 });
  } catch (err: any) {
    sendServerError(res, err, 'federation/tenants.routes.ts');
  }
});
