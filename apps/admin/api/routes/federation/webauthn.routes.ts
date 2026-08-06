import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { sendServerError } from '../../utils/errors';
import { authenticateFederation, requireFederationScope, resolveFederationTenantContext } from '../../middleware/federationAuth';
import { federationLimiter } from '../../middleware/rateLimit';
import { resolveInternalId } from '../../services/federation/externalId';
import {
  getRegistrationOptions,
  verifyRegistration,
  getAuthenticationOptions,
  verifyAuthentication,
  resolveRpFromOrigin,
} from '../../services/webauthn';
import { issueFederationAssertionToken } from '../../services/federation/webauthnAssertion';

export const router = Router();
router.use('/v1/federation', authenticateFederation, federationLimiter, requireFederationScope('attendance'), resolveFederationTenantContext());

// SmartTeams must configure the approved BlizBooks origins (production,
// staging, local dev) it will accept a WebAuthn ceremony against — this
// reads FEDERATION_WEBAUTHN_ORIGIN (falls back to the same default the
// internal RP config already uses via resolveRpFromOrigin(undefined)) so
// the relying-party identity is explicit rather than inferred from a
// server-to-server request that has no browser Origin header of its own.
function federationRp() {
  return resolveRpFromOrigin(process.env.FEDERATION_WEBAUTHN_ORIGIN);
}

router.post('/v1/federation/employees/:externalEmployeeId/webauthn/enrollments/begin', async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const userId = await resolveInternalId(tenantId, 'employee', req.params.externalEmployeeId);
    if (userId === null) return res.status(404).json({ error: 'Unknown externalEmployeeId.' });

    const userRow = (await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1))[0];
    const options = await getRegistrationOptions({ id: userRow.id, uid: userRow.uid, name: userRow.name }, federationRp());
    res.json({ challenge: options, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() });
  } catch (err: any) {
    sendServerError(res, err, 'federation/webauthn.routes.ts');
  }
});

router.post('/v1/federation/employees/:externalEmployeeId/webauthn/enrollments/complete', async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const userId = await resolveInternalId(tenantId, 'employee', req.params.externalEmployeeId);
    if (userId === null) return res.status(404).json({ error: 'Unknown externalEmployeeId.' });

    const { credentialResponse } = req.body || {};
    if (!credentialResponse) return res.status(422).json({ error: 'credentialResponse is required.' });

    const result = await verifyRegistration({ id: userId, tenantId }, credentialResponse, undefined, federationRp());
    if (!result.verified) {
      return res.json({ externalEmployeeId: req.params.externalEmployeeId, enrollmentState: 'failed' });
    }
    await db.update(schema.users).set({ isKycCompleted: true, verificationMethod: 'webauthn' }).where(eq(schema.users.id, userId));
    res.json({ externalEmployeeId: req.params.externalEmployeeId, enrollmentState: 'enrolled' });
  } catch (err: any) {
    sendServerError(res, err, 'federation/webauthn.routes.ts');
  }
});

router.post('/v1/federation/attendance/assertions/begin', async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const { externalEmployeeId } = req.body || {};
    if (!externalEmployeeId) return res.status(422).json({ error: 'externalEmployeeId is required.' });
    const userId = await resolveInternalId(tenantId, 'employee', externalEmployeeId);
    if (userId === null) return res.status(404).json({ error: 'Unknown externalEmployeeId.' });

    const result = await getAuthenticationOptions(userId, federationRp());
    if ('error' in result) return res.status(422).json({ error: result.error });
    res.json({ challenge: result.options, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() });
  } catch (err: any) {
    sendServerError(res, err, 'federation/webauthn.routes.ts');
  }
});

router.post('/v1/federation/attendance/assertions/complete', async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const { externalEmployeeId, assertionResponse } = req.body || {};
    if (!externalEmployeeId || !assertionResponse) return res.status(422).json({ error: 'externalEmployeeId and assertionResponse are required.' });
    const userId = await resolveInternalId(tenantId, 'employee', externalEmployeeId);
    if (userId === null) return res.status(404).json({ error: 'Unknown externalEmployeeId.' });

    const result = await verifyAuthentication(userId, assertionResponse, federationRp());
    if (!result.verified) {
      const assertionId = issueFederationAssertionToken(userId, 'denied', 'ASSERTION_VERIFICATION_FAILED');
      return res.json({ outcome: 'denied', reasonCode: 'ASSERTION_VERIFICATION_FAILED', assertionId });
    }

    const assertionId = issueFederationAssertionToken(userId, 'allowed', 'VERIFIED');
    res.json({ outcome: 'allowed', reasonCode: 'VERIFIED', assertionId });
  } catch (err: any) {
    // Never expose raw security material on failure — an opaque denial,
    // same as a normal failed-verification response.
    sendServerError(res, err, 'federation/webauthn.routes.ts');
  }
});
