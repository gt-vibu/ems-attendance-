import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { sendServerError } from '../../utils/errors';
import { authenticateFederation } from '../../middleware/federationAuth';
import { federationLimiter } from '../../middleware/rateLimit';
import { requireIdempotencyKey } from '../../middleware/federationIdempotency';
import { linkExternalId, resolveInternalId } from '../../services/federation/externalId';

export const router = Router();
router.use('/v1/federation', authenticateFederation, federationLimiter);

// PUT /v1/federation/tenants/{externalOrganizationId} — a federation client
// is already scoped to exactly one tenant (its access token carries
// tenantId), so this call only ever touches that same tenant's row; the
// externalOrganizationId path param is the identity being linked, not a
// selector into some other tenant.
router.put('/v1/federation/tenants/:externalOrganizationId', requireIdempotencyKey, async (req: any, res: any) => {
  try {
    const { externalOrganizationId } = req.params;
    const { name, timezone, currencyCode, status } = req.body || {};
    if (!name || !timezone || !currencyCode) {
      return res.status(422).json({ error: 'name, timezone, and currencyCode are required.' });
    }

    const tenantId = req.federation.tenantId;
    const updateData: any = { name, timezone };
    if (status && ['active', 'suspended'].includes(status)) updateData.status = status;
    // currencyCode has no existing tenants column — accepted and
    // acknowledged in the response, but this app doesn't yet have a
    // multi-currency concept to persist it against (see the entitlement
    // architecture memo's deliberately-deferred multi-currency FX work).

    await db.update(schema.tenants).set(updateData).where(eq(schema.tenants.id, tenantId));

    const link = await linkExternalId(tenantId, 'tenant', tenantId, externalOrganizationId);
    if (!link.ok) {
      return res.status(409).json({ error: 'externalOrganizationId is already linked to a different tenant.', code: 'EXTERNAL_ID_CONFLICT' });
    }

    res.json({ externalOrganizationId, internalTenantId: `tenant_${tenantId}`, status: updateData.status || 'active', aggregateVersion: 1 });
  } catch (err: any) {
    sendServerError(res, err, 'federation/tenants.routes.ts');
  }
});

router.put('/v1/federation/tenants/:externalOrganizationId/branches/:externalBranchId', requireIdempotencyKey, async (req: any, res: any) => {
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

router.patch('/v1/federation/branches/:externalBranchId', requireIdempotencyKey, async (req: any, res: any) => {
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
