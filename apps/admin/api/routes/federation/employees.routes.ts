import { Router } from 'express';
import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { sendServerError } from '../../utils/errors';
import { authenticateFederation } from '../../middleware/federationAuth';
import { federationLimiter } from '../../middleware/rateLimit';
import { requireIdempotencyKey } from '../../middleware/federationIdempotency';
import { linkExternalId, resolveInternalId, resolveExternalId } from '../../services/federation/externalId';
import { FEDERATION_GRANTABLE_CAPABILITIES } from '../../services/federation/capabilities';
import { writeOutboxEvent } from '../../services/federation/outbox';

export const router = Router();
router.use('/v1/federation', authenticateFederation, federationLimiter);

// Placeholder-login-domain: this app's users.email column is NOT NULL +
// UNIQUE, but the federation employee-upsert payload deliberately carries
// no email (BlizBooks remains the identity system of record — see the
// plan's "Employee create" row). A synthetic, non-routable address keyed
// by the immutable externalEmployeeId keeps the column populated and
// unique without ever being a usable login identity (password stays
// unset — see below).
function placeholderEmail(externalEmployeeId: string): string {
  return `fed-${externalEmployeeId}@federation.smartteams.invalid`;
}

router.put('/v1/federation/employees/:externalEmployeeId', requireIdempotencyKey, async (req: any, res: any) => {
  try {
    const { externalEmployeeId } = req.params;
    const { name, employmentType, dateOfJoining, status } = req.body || {};
    if (!name) return res.status(422).json({ error: 'name is required.' });

    const tenantId = req.federation.tenantId;
    const existingInternalId = await resolveInternalId(tenantId, 'employee', externalEmployeeId);
    const employeeStatus = ['active', 'inactive', 'terminated'].includes(status) ? status : undefined;

    let internalId: number;
    if (existingInternalId !== null) {
      const patch: any = { name };
      if (employmentType !== undefined) patch.employmentType = employmentType;
      if (dateOfJoining !== undefined) patch.dateOfJoining = dateOfJoining;
      if (employeeStatus !== undefined) patch.employeeStatus = employeeStatus;
      await db.update(schema.users).set(patch).where(and(eq(schema.users.id, existingInternalId), eq(schema.users.tenantId, tenantId)));
      internalId = existingInternalId;
    } else {
      // No password is set — this shadow profile authenticates through
      // BlizBooks, never through this app's own /api/auth/login. uid uses
      // the externalEmployeeId itself since it's already a guaranteed-
      // unique immutable UUID.
      const [inserted] = await db.insert(schema.users).values({
        uid: externalEmployeeId,
        email: placeholderEmail(externalEmployeeId),
        password: '',
        name,
        tenantId,
        role: 'employee',
        employmentType: employmentType || 'full_time',
        dateOfJoining: dateOfJoining || null,
        employeeStatus: employeeStatus || 'active',
      }).returning();
      internalId = inserted.id;
      await linkExternalId(tenantId, 'employee', internalId, externalEmployeeId);
    }

    await writeOutboxEvent({
      tenantId,
      eventType: 'workforce.employee.changed',
      aggregateType: 'employee',
      aggregateId: externalEmployeeId,
      data: { externalEmployeeId, name, employmentType, status: employeeStatus || 'active' },
    });

    res.json({ externalEmployeeId, status: employeeStatus || 'active', aggregateVersion: 1 });
  } catch (err: any) {
    sendServerError(res, err, 'federation/employees.routes.ts');
  }
});

router.put('/v1/federation/employees/:externalEmployeeId/branches/:externalBranchId', requireIdempotencyKey, async (req: any, res: any) => {
  try {
    const { externalEmployeeId, externalBranchId } = req.params;
    const { isPrimary } = req.body || {};
    const tenantId = req.federation.tenantId;

    const employeeInternalId = await resolveInternalId(tenantId, 'employee', externalEmployeeId);
    const branchInternalId = await resolveInternalId(tenantId, 'branch', externalBranchId);
    if (employeeInternalId === null) return res.status(404).json({ error: 'Unknown externalEmployeeId.' });
    if (branchInternalId === null) return res.status(404).json({ error: 'Unknown externalBranchId.' });

    if (isPrimary !== false) {
      // Primary assignment — mirrors PUT /api/tenant/employees/:id's
      // branchId field. Secondary/multi-branch assignments reuse the
      // existing userBranchAccess table (the same one branch.multi_access
      // already writes to internally).
      await db.update(schema.users).set({ branchId: branchInternalId }).where(and(eq(schema.users.id, employeeInternalId), eq(schema.users.tenantId, tenantId)));
    } else {
      const existing = await db.select().from(schema.userBranchAccess).where(
        and(eq(schema.userBranchAccess.userId, employeeInternalId), eq(schema.userBranchAccess.branchId, branchInternalId))
      ).limit(1);
      if (existing.length === 0) {
        await db.insert(schema.userBranchAccess).values({ userId: employeeInternalId, branchId: branchInternalId });
      }
    }

    const assignedBranchIds = new Set<number>();
    const userRow = (await db.select({ branchId: schema.users.branchId }).from(schema.users).where(eq(schema.users.id, employeeInternalId)).limit(1))[0];
    if (userRow?.branchId) assignedBranchIds.add(userRow.branchId);
    const accessRows = await db.select({ branchId: schema.userBranchAccess.branchId }).from(schema.userBranchAccess).where(eq(schema.userBranchAccess.userId, employeeInternalId));
    accessRows.forEach((r: any) => assignedBranchIds.add(r.branchId));

    const branchAssignments = await Promise.all(Array.from(assignedBranchIds).map(async (bId) => ({
      externalBranchId: await resolveExternalId(tenantId, 'branch', bId),
      isPrimary: bId === userRow?.branchId,
    })));

    res.json({ externalEmployeeId, branchAssignments: branchAssignments.filter((b) => b.externalBranchId) });
  } catch (err: any) {
    sendServerError(res, err, 'federation/employees.routes.ts');
  }
});

router.put('/v1/federation/employees/:externalEmployeeId/access', requireIdempotencyKey, async (req: any, res: any) => {
  try {
    const { externalEmployeeId } = req.params;
    const { grantVersion, grants } = req.body || {};
    if (!Number.isInteger(grantVersion)) return res.status(422).json({ error: 'grantVersion (integer) is required.' });
    if (!Array.isArray(grants)) return res.status(422).json({ error: 'grants (string array) is required.' });

    const tenantId = req.federation.tenantId;
    const employeeInternalId = await resolveInternalId(tenantId, 'employee', externalEmployeeId);
    if (employeeInternalId === null) return res.status(404).json({ error: 'Unknown externalEmployeeId.' });

    const grantRows = await db.select().from(schema.federationEmployeeAccessGrants).where(eq(schema.federationEmployeeAccessGrants.userId, employeeInternalId)).limit(1);
    const currentVersion = grantRows[0]?.grantVersion ?? 0;
    if (grantVersion <= currentVersion) {
      return res.status(409).json({ error: 'grantVersion must be newer than the currently stored version.', code: 'STALE_RESOURCE_VERSION' });
    }

    // Declared grants are intersected against FEDERATION_GRANTABLE_CAPABILITIES
    // so an unrecognized string can never sneak a real internal privilege
    // in. Stored in their own table (federation_employee_access_grants),
    // deliberately separate from users.privileges — provider-only
    // break-glass grants made directly through this app's own admin UI
    // stay on users.privileges untouched, exactly as the plan requires
    // ("preserve provider-only break-glass grants separately").
    const declaredGrants = grants.filter((g: string) => (FEDERATION_GRANTABLE_CAPABILITIES as readonly string[]).includes(g));

    if (grantRows.length > 0) {
      await db.update(schema.federationEmployeeAccessGrants).set({ grantVersion, grants: declaredGrants, updatedAt: new Date() }).where(eq(schema.federationEmployeeAccessGrants.id, grantRows[0].id));
    } else {
      await db.insert(schema.federationEmployeeAccessGrants).values({ tenantId, userId: employeeInternalId, grantVersion, grants: declaredGrants });
    }

    res.json({ externalEmployeeId, effectiveGrants: declaredGrants, grantVersion });
  } catch (err: any) {
    sendServerError(res, err, 'federation/employees.routes.ts');
  }
});

router.post('/v1/federation/employees/:externalEmployeeId/sessions/revoke', requireIdempotencyKey, async (req: any, res: any) => {
  try {
    const { externalEmployeeId } = req.params;
    const tenantId = req.federation.tenantId;
    const employeeInternalId = await resolveInternalId(tenantId, 'employee', externalEmployeeId);
    if (employeeInternalId === null) return res.status(404).json({ error: 'Unknown externalEmployeeId.' });

    // Same effect as the existing session-revocation mechanism the
    // authenticate middleware already checks on every request
    // (activeSessionId mismatch => 401) — no separate "sessions" table to
    // enumerate, so revokedSessions is 0 or 1.
    const [updated] = await db.update(schema.users).set({ activeSessionId: crypto.randomUUID() }).where(eq(schema.users.id, employeeInternalId)).returning({ id: schema.users.id });

    res.json({ externalEmployeeId, revokedSessions: updated ? 1 : 0, revokedAt: new Date().toISOString() });
  } catch (err: any) {
    sendServerError(res, err, 'federation/employees.routes.ts');
  }
});
