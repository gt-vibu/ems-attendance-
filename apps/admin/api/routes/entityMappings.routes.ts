import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../db';
import { sendServerError } from '../utils/errors';
import { authenticate } from '../middleware/authenticate';

export const router = Router();

router.use('/api/tenant/entity-mappings', authenticate);

// List external ID mappings for a tenant
router.get('/', async (req: any, res: any) => {
  try {
    const tenantId = req.user?.tenantId || 1;
    const mappings = await db.select().from(schema.federationExternalIdMappings)
      .where(eq(schema.federationExternalIdMappings.tenantId, tenantId));
    res.json({ mappings });
  } catch (err: any) {
    sendServerError(res, err, 'entityMappings.routes.ts');
  }
});

// Upsert external ID mapping
router.post('/', async (req: any, res: any) => {
  try {
    const tenantId = req.user?.tenantId || 1;
    const { entityType, internalId, externalId } = req.body || {};

    if (!entityType || !internalId || !externalId) {
      return res.status(400).json({ error: 'entityType, internalId, and externalId are required.' });
    }

    const existing = await db.select().from(schema.federationExternalIdMappings).where(
      and(
        eq(schema.federationExternalIdMappings.tenantId, tenantId),
        eq(schema.federationExternalIdMappings.entityType, entityType),
        eq(schema.federationExternalIdMappings.internalId, Number(internalId))
      )
    ).limit(1);

    if (existing.length > 0) {
      await db.update(schema.federationExternalIdMappings).set({ externalId }).where(eq(schema.federationExternalIdMappings.id, existing[0].id));
    } else {
      await db.insert(schema.federationExternalIdMappings).values({
        tenantId,
        entityType,
        internalId: Number(internalId),
        externalId,
      });
    }

    res.json({ success: true, message: 'External entity mapping updated.' });
  } catch (err: any) {
    sendServerError(res, err, 'entityMappings.routes.ts');
  }
});
