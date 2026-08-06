import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../../db';

export type FederationEntityType = 'tenant' | 'branch' | 'employee';

// Every federated entity is identified externally by an immutable UUID
// (externalOrganizationId / externalBranchId / externalEmployeeId) and
// internally by this app's own serial id — this service is the only place
// that translates between the two, via federation_external_id_mappings
// (an additive table; no existing tenants/branches/users column is
// touched). Never resolve a federated entity by email/phone/display name.

export async function resolveInternalId(tenantId: number, entityType: FederationEntityType, externalId: string): Promise<number | null> {
  const rows = await db.select().from(schema.federationExternalIdMappings).where(
    and(
      eq(schema.federationExternalIdMappings.entityType, entityType),
      eq(schema.federationExternalIdMappings.externalId, externalId),
      eq(schema.federationExternalIdMappings.tenantId, tenantId),
    )
  ).limit(1);
  return rows[0]?.internalId ?? null;
}

export async function resolveExternalId(tenantId: number, entityType: FederationEntityType, internalId: number): Promise<string | null> {
  const rows = await db.select().from(schema.federationExternalIdMappings).where(
    and(
      eq(schema.federationExternalIdMappings.entityType, entityType),
      eq(schema.federationExternalIdMappings.internalId, internalId),
      eq(schema.federationExternalIdMappings.tenantId, tenantId),
    )
  ).limit(1);
  return rows[0]?.externalId ?? null;
}

// Upsert: called from a PUT /v1/federation/.../{externalId} handler once
// the internal row has been created/located. If this externalId is already
// mapped to a DIFFERENT internal row within the same tenant, that's a
// conflict the caller must handle (never silently repoints an existing
// external identity).
export async function linkExternalId(tenantId: number, entityType: FederationEntityType, internalId: number, externalId: string): Promise<{ ok: true } | { ok: false; conflict: true; existingInternalId: number }> {
  const existing = await resolveInternalId(tenantId, entityType, externalId);
  if (existing !== null) {
    if (existing !== internalId) return { ok: false, conflict: true, existingInternalId: existing };
    return { ok: true };
  }
  try {
    await db.insert(schema.federationExternalIdMappings).values({ tenantId, entityType, internalId, externalId });
  } catch {
    // Unique-constraint race: another concurrent call linked this exact
    // externalId first. Re-check rather than surfacing a 500 for what's
    // functionally an idempotent PUT retry.
    const raced = await resolveInternalId(tenantId, entityType, externalId);
    if (raced !== null && raced !== internalId) return { ok: false, conflict: true, existingInternalId: raced };
  }
  return { ok: true };
}

// For entities that existed before this tenant ever federated (legacy
// employees/branches created through the normal admin UI) — assigns and
// persists a fresh external UUID the first time one is needed, so GET
// responses can always include an externalId even for pre-existing rows.
export async function getOrAssignExternalId(tenantId: number, entityType: FederationEntityType, internalId: number): Promise<string> {
  const existing = await resolveExternalId(tenantId, entityType, internalId);
  if (existing) return existing;
  const generated = crypto.randomUUID();
  await db.insert(schema.federationExternalIdMappings).values({ tenantId, entityType, internalId, externalId: generated });
  return generated;
}
