import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { signShortLivedToken } from '../../jwt';
import { signToken } from '../../jwt';
import { authenticate } from '../middleware/authenticate';
import {
  getRegistrationOptions,
  verifyRegistration,
  getAuthenticationOptions,
  verifyAuthentication,
  IDENTITY_PASS_PURPOSE,
  IDENTITY_PASS_TTL,
} from '../services/webauthn';
import { logToAuditLedger } from '../services/audit';

export const router = Router();

// STEP 1 of "Register This Device" — replaces the old camera-based KYC
// enrollment. Mints a challenge for navigator.credentials.create().
router.post('/api/webauthn/register/options', authenticate, async (req: any, res: any) => {
  try {
    const usersList = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
    if (usersList.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = usersList[0];

    const options = await getRegistrationOptions({ id: user.id, uid: user.uid, name: user.name });
    res.json(options);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// STEP 2 — verifies the signed attestation from navigator.credentials.create(),
// stores the public key, and marks KYC/device registration complete (mirrors
// exactly what the old POST /api/kyc did on success).
router.post('/api/webauthn/register/verify', authenticate, async (req: any, res: any) => {
  try {
    const { response, deviceId, deviceName } = req.body;
    if (!response || !deviceId) {
      return res.status(400).json({ error: 'response (the signed credential) and deviceId are required.' });
    }

    const usersList = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
    if (usersList.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = usersList[0];

    const result = await verifyRegistration({ id: user.id, tenantId: user.tenantId || 1 }, response, deviceName);
    if (!result.verified) {
      return res.status(422).json({ error: result.error || 'Device registration failed.' });
    }

    await db.update(schema.users)
      .set({
        isKycCompleted: true,
        registeredDeviceId: deviceId,
        deviceApprovalPending: false,
      })
      .where(eq(schema.users.id, user.id));

    await logToAuditLedger({
      tenantId: user.tenantId,
      actorId: user.id,
      actorName: user.name,
      action: 'WEBAUTHN_DEVICE_REGISTERED',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
      details: { deviceId, deviceName: deviceName || null }
    });

    const updatedUser = {
      id: user.id,
      uid: user.uid,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
      isKycCompleted: true
    };
    const token = signToken(updatedUser);

    res.json({ success: true, token, user: updatedUser });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// STEP 1 of daily attendance identity check — replaces /api/attendance/verify-face.
// Mints a challenge for navigator.credentials.get().
router.post('/api/webauthn/authenticate/options', authenticate, async (req: any, res: any) => {
  try {
    const usersList = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
    if (usersList.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = usersList[0];
    if (!user.isKycCompleted) {
      return res.status(400).json({ error: 'Device registration not completed yet.' });
    }

    const result = await getAuthenticationOptions(user.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result.options);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// STEP 2 — verifies the signed assertion from navigator.credentials.get() and,
// on success, mints the same short-lived "identity pass" token the old
// /verify-face endpoint used to hand the final /api/attendance submit — every
// downstream check (device pinning, GPS geofence, Wi-Fi, shift rules,
// approvals) is completely unchanged.
router.post('/api/webauthn/authenticate/verify', authenticate, async (req: any, res: any) => {
  try {
    const { response } = req.body;
    if (!response) {
      return res.status(400).json({ error: 'response (the signed assertion) is required.' });
    }

    const usersList = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
    if (usersList.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = usersList[0];
    if (!user.isKycCompleted) {
      return res.status(400).json({ error: 'Device registration not completed yet.' });
    }

    const result = await verifyAuthentication(user.id, response);
    if (!result.verified) {
      return res.status(403).json({ passed: false, error: result.error || 'Device verification failed.' });
    }

    const token = signShortLivedToken({
      purpose: IDENTITY_PASS_PURPOSE,
      userId: user.id,
    }, IDENTITY_PASS_TTL);

    res.json({ passed: true, token });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/webauthn/credentials', authenticate, async (req: any, res: any) => {
  try {
    const rows = await db.select().from(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.userId, req.user.userId));
    res.json({
      credentials: rows.map(c => ({
        id: c.id,
        deviceName: c.deviceName,
        deviceType: c.deviceType,
        createdAt: c.createdAt,
        lastUsedAt: c.lastUsedAt,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
