import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { eq, and, gt } from 'drizzle-orm';
import { db, schema } from '../../db';

// Replaces the face-recognition service entirely. Identity proof at
// check-in is now a WebAuthn signature check against a public key generated
// by the device's own secure hardware (Windows Hello, Touch ID, Android
// biometric/PIN, or a roaming security key) — the server never receives or
// stores any biometric data, only this public key, and there is no
// similarity threshold to tune the way FACE_MATCH_THRESHOLD was.

const rpName = process.env.WEBAUTHN_RP_NAME || 'Attendance & HR Suite';
const appBaseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
const rpID = process.env.WEBAUTHN_RP_ID || new URL(appBaseUrl).hostname;
const origin = process.env.WEBAUTHN_ORIGIN || appBaseUrl;

// Single-use challenges expire quickly — long enough for a real
// register/authenticate round trip, short enough that a stale one is
// useless to a replay attempt.
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

async function storeChallenge(userId: number, challenge: string, purpose: 'register' | 'authenticate') {
  // A user can only ever have one outstanding challenge per purpose —
  // starting a new registration/authentication attempt invalidates any
  // previous, unfinished one instead of leaving it around to be replayed.
  await db.delete(schema.webauthnChallenges).where(
    and(eq(schema.webauthnChallenges.userId, userId), eq(schema.webauthnChallenges.purpose, purpose))
  );
  await db.insert(schema.webauthnChallenges).values({ userId, challenge, purpose });
}

async function consumeChallenge(userId: number, purpose: 'register' | 'authenticate'): Promise<string | null> {
  const cutoff = new Date(Date.now() - CHALLENGE_TTL_MS);
  const rows = await db.select().from(schema.webauthnChallenges).where(
    and(
      eq(schema.webauthnChallenges.userId, userId),
      eq(schema.webauthnChallenges.purpose, purpose),
      gt(schema.webauthnChallenges.createdAt, cutoff)
    )
  );
  if (rows.length === 0) return null;
  // Single-use: delete on read regardless of what happens next, so the same
  // challenge can never be presented twice.
  await db.delete(schema.webauthnChallenges).where(eq(schema.webauthnChallenges.id, rows[0].id));
  return rows[0].challenge;
}

export async function getRegistrationOptions(user: { id: number; uid?: string; name: string }) {
  const existing = await db.select().from(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.userId, user.id));

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: new TextEncoder().encode(String(user.id)),
    userName: user.uid || user.name,
    userDisplayName: user.name,
    attestationType: 'none',
    // Prevents re-registering the exact same authenticator twice, but
    // deliberately does NOT block registering a second, different device —
    // switching phones/laptops still goes through the existing device-
    // pinning admin-approval flow (registeredDeviceId / deviceApprovalPending),
    // which is untouched by this change.
    excludeCredentials: existing.map(c => ({ id: c.credentialId, transports: (c.transports as any) || undefined })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required', // forces the device's own biometric/PIN gate, not just "a key is present"
    },
  });

  await storeChallenge(user.id, options.challenge, 'register');
  return options;
}

export async function verifyRegistration(user: { id: number; tenantId: number }, response: any, deviceName?: string) {
  const expectedChallenge = await consumeChallenge(user.id, 'register');
  if (!expectedChallenge) {
    return { verified: false, error: 'Registration challenge expired or missing. Please try again.' };
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch (err: any) {
    return { verified: false, error: err.message || 'Registration verification failed.' };
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { verified: false, error: 'Could not verify this device credential.' };
  }

  const { credential, credentialDeviceType } = verification.registrationInfo;
  await db.insert(schema.webauthnCredentials).values({
    userId: user.id,
    tenantId: user.tenantId,
    credentialId: credential.id,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    deviceType: credentialDeviceType,
    transports: credential.transports || [],
    deviceName: deviceName || null,
  });

  return { verified: true };
}

export async function getAuthenticationOptions(userId: number) {
  const credentials = await db.select().from(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.userId, userId));
  if (credentials.length === 0) {
    return { error: 'No registered device credential on file. Please register this device first.' };
  }

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: credentials.map(c => ({ id: c.credentialId, transports: (c.transports as any) || undefined })),
    userVerification: 'required',
  });

  await storeChallenge(userId, options.challenge, 'authenticate');
  return { options };
}

export async function verifyAuthentication(userId: number, response: any) {
  const expectedChallenge = await consumeChallenge(userId, 'authenticate');
  if (!expectedChallenge) {
    return { verified: false, error: 'Verification challenge expired or missing. Please try again.' };
  }

  const stored = await db.select().from(schema.webauthnCredentials).where(
    and(eq(schema.webauthnCredentials.userId, userId), eq(schema.webauthnCredentials.credentialId, response.id))
  );
  if (stored.length === 0) {
    return { verified: false, error: 'This device credential is not registered to your account.' };
  }
  const cred = stored[0];

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: cred.credentialId,
        publicKey: isoBase64URL.toBuffer(cred.publicKey),
        counter: cred.counter,
        transports: (cred.transports as any) || undefined,
      },
      requireUserVerification: true,
    });
  } catch (err: any) {
    return { verified: false, error: err.message || 'Authentication verification failed.' };
  }

  if (!verification.verified) {
    return { verified: false, error: 'Device verification failed.' };
  }

  // The signature counter must strictly increase on genuine hardware; a
  // counter that goes backwards or repeats is the classic signal a
  // credential's private key material was cloned/extracted.
  await db.update(schema.webauthnCredentials)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(schema.webauthnCredentials.id, cred.id));

  return { verified: true };
}

export async function hasRegisteredCredential(userId: number): Promise<boolean> {
  const rows = await db.select({ id: schema.webauthnCredentials.id }).from(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.userId, userId));
  return rows.length > 0;
}

export const IDENTITY_PASS_PURPOSE = 'attendance_identity_pass';
export const IDENTITY_PASS_TTL = '3m';
