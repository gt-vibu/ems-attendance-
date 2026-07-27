import crypto from 'crypto';
import { eq, and, desc, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { signToken, verifyToken } from '../../jwt';
import { logger } from '../../logger';
import { sendEmail, sendPasswordResetEmail } from '../../mail.js';
import { isPlatformFeatureAllowed, isFaceIdEnabledForTenant } from './rbac';

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

// The session-shaped view of a user sent to the frontend — tenant-level
// feature flags (faceRecognitionEnabled, deviceChangeEnabled, kycEnabled,
// branchSetupCompleted) computed fresh from `tenant` each call. Shared by
// finalizeLogin (login) and GET /api/auth/session (mid-session refresh) so
// the two can never drift apart on what fields a "user" response contains.
export function buildSessionUser(user: any, tenant: any) {
  return {
    id: user.id, uid: user.uid, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId,
    isKycCompleted: user.isKycCompleted,
    kycEnabled: tenant ? tenant.kycEnabled !== false : true,
    branchSetupCompleted: tenant ? !!tenant.branchSetupCompleted : true,
    faceRecognitionEnabled: isFaceIdEnabledForTenant(tenant),
    verificationMethod: user.verificationMethod || null,
    deviceChangeEnabled: isPlatformFeatureAllowed(tenant, 'device_change'),
  };
}

// Shared tail of a successful authentication (password login and Google
// Sign-In both end here): tenant-suspension check, device-pinning, and JWT
// issuance. Factored out so the two routes can't silently drift apart on
// this security-sensitive logic.
export async function finalizeLogin(user: any, deviceId: string | undefined):
  Promise<{ ok: true; token: string; user: any } | { ok: false; status: number; body: any }> {
  // Block access for users of a suspended tenant (super_admin has no
  // tenantId and is exempt).
  let tenant: any = null;
  if (user.tenantId) {
    const tenantCheck = await db.select().from(schema.tenants).where(eq(schema.tenants.id, user.tenantId));
    if (tenantCheck.length > 0 && tenantCheck[0].status === 'suspended') {
      return { ok: false, status: 403, body: { error: 'Your organization\'s access has been suspended. Please contact your administrator.' } };
    }
    tenant = tenantCheck[0] || null;
  }

  // Device Pinning Check (for anyone who can clock in — every role except
  // the two admin tiers, who manage the org but don't themselves check in
  // via the biometric/GPS flow).
  //
  // A device-ID mismatch here just means "logging in from a different
  // browser/device than last time" — not proof of fraud. It self-service
  // re-pins to the new device immediately rather than blocking the login on
  // a manager's approval: the pending-approval flow this used to go through
  // made switching browsers/tabs (or a legitimate new phone) painful for
  // ordinary employees, and login itself carries no attendance-fraud risk —
  // that's independently and more strictly enforced at actual check-in time
  // (see the device pinning check in attendance.routes.ts, which still hard
  // -blocks a mismatch there). A notification still goes to the tenant so
  // device switches stay visible, just non-blocking.
  const isClockInRole = user.role !== 'super_admin' && user.role !== 'tenant_admin';
  if (isClockInRole && deviceId) {
    if (user.registeredDeviceId && user.registeredDeviceId !== deviceId) {
      await db.update(schema.users)
        .set({ registeredDeviceId: deviceId })
        .where(eq(schema.users.id, user.id));
      user.registeredDeviceId = deviceId;

      await db.insert(schema.notifications).values({
        userId: user.tenantId,
        title: 'Device Changed',
        message: `${user.name} logged in from a new device/browser. Their registered device was updated automatically.`
      });
    }

    if (!user.registeredDeviceId) {
      await db.update(schema.users)
        .set({ registeredDeviceId: deviceId })
        .where(eq(schema.users.id, user.id));
      user.registeredDeviceId = deviceId;
    }
  }

  // A fresh, successful login (correct password just verified above) is
  // itself strong proof of identity — same reasoning /api/auth/reset-password
  // already relies on. So rather than blocking a second login attempt with a
  // 409 "already logged in" (which false-positived whenever a browser was
  // closed without hitting /logout, since activeSessionId/sessionExpiresAt
  // stay set until the token's own 24h expiry), a new login simply issues a
  // fresh session outright. issueNewSession() overwrites activeSessionId, so
  // the previous session's sid stops matching on its very next request and
  // is invalidated by authenticate() — at most one session is ever live,
  // just without ever hard-blocking a legitimate re-login.
  const token = await issueNewSession(user);

  return {
    ok: true,
    token,
    // Frontend needs kycEnabled/branchSetupCompleted to decide the
    // post-login redirect (skip the KYC wizard when the company has turned
    // it off; only ever send a tenant_admin to branch setup, once).
    user: buildSessionUser(user, tenant),
  };
}
