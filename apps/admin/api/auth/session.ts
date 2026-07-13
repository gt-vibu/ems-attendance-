import crypto from 'crypto';
import { eq, and, desc, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { signToken, verifyToken } from '../../jwt';
import { logger } from '../../logger';
import { sendEmail, sendPasswordResetEmail } from '../../mail.js';

// Unconditionally establishes a brand-new session for `user`, overwriting any
// existing activeSessionId. Used by finalizeLogin (after its own
// already-logged-in check passes) and by /api/auth/reset-password (where a
// successful password reset is itself strong proof of identity, so it
// shouldn't be blocked by a stale/forgotten session).
export async function issueNewSession(user: any) {
  const sessionId = crypto.randomUUID();
  const sessionExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // matches signToken's 24h expiresIn
  await db.update(schema.users)
    .set({ activeSessionId: sessionId, sessionExpiresAt })
    .where(eq(schema.users.id, user.id));
  return signToken({
    userId: user.id, uid: user.uid, email: user.email, role: user.role,
    name: user.name, tenantId: user.tenantId, sid: sessionId
  });
}

// Shared tail of a successful authentication (password login and Google
// Sign-In both end here): tenant-suspension check, device-pinning, and JWT
// issuance. Factored out so the two routes can't silently drift apart on
// this security-sensitive logic.
export async function finalizeLogin(user: any, deviceId: string | undefined):
  Promise<{ ok: true; token: string; user: any } | { ok: false; status: number; body: any }> {
  // Block access for users of a suspended tenant (super_admin has no
  // tenantId and is exempt).
  if (user.tenantId) {
    const tenantCheck = await db.select().from(schema.tenants).where(eq(schema.tenants.id, user.tenantId));
    if (tenantCheck.length > 0 && tenantCheck[0].status === 'suspended') {
      return { ok: false, status: 403, body: { error: 'Your organization\'s access has been suspended. Please contact your administrator.' } };
    }
  }

  // Device Pinning Check (for anyone who can clock in — every role except
  // the two admin tiers, who manage the org but don't themselves check in
  // via the biometric/GPS flow).
  const isClockInRole = user.role !== 'super_admin' && user.role !== 'tenant_admin';
  if (isClockInRole && deviceId) {
    if (user.registeredDeviceId && user.registeredDeviceId !== deviceId) {
      const pendingRequest = await db.select().from(schema.deviceChangeRequests).where(
        and(
          eq(schema.deviceChangeRequests.userId, user.id),
          eq(schema.deviceChangeRequests.status, 'pending')
        )
      );

      if (pendingRequest.length === 0) {
        await db.insert(schema.deviceChangeRequests).values({
          userId: user.id,
          tenantId: user.tenantId || 1,
          oldDeviceId: user.registeredDeviceId,
          newDeviceId: deviceId,
          status: 'pending'
        });

        await db.update(schema.users)
          .set({ deviceApprovalPending: true })
          .where(eq(schema.users.id, user.id));

        await db.insert(schema.notifications).values({
          userId: user.tenantId,
          title: 'Device Change Request',
          message: `${user.name} is attempting to log in from a new device. Approval required.`
        });
      }

      return {
        ok: false, status: 403, body: {
          error: 'device_change_pending',
          message: 'This device is unauthorized. A device migration request has been submitted to your administrator.'
        }
      };
    }

    if (!user.registeredDeviceId) {
      await db.update(schema.users)
        .set({ registeredDeviceId: deviceId })
        .where(eq(schema.users.id, user.id));
      user.registeredDeviceId = deviceId;
    }
  }

  // Single-active-session enforcement: reject a second login attempt while a
  // still-valid session exists. A naturally-expired session (or no prior
  // session) is treated as "not logged in" so a crashed browser that never
  // hit /logout doesn't lock the account out beyond the token's own 24h life.
  const now = new Date();
  if (user.activeSessionId && user.sessionExpiresAt && new Date(user.sessionExpiresAt) > now) {
    return { ok: false, status: 409, body: {
      error: 'already_logged_in',
      message: 'This account is already logged in. Please log out first.'
    }};
  }

  const token = await issueNewSession(user);

  return {
    ok: true,
    token,
    user: { id: user.id, uid: user.uid, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId, isKycCompleted: user.isKycCompleted }
  };
}
