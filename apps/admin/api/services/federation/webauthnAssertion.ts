import { signShortLivedToken, verifyToken } from '../../../jwt';

// Bridges POST /v1/federation/attendance/assertions/complete (which
// verifies a WebAuthn signature via the existing internal webauthn
// service, see services/webauthn.ts) to POST /v1/federation/attendance/
// check-ins|check-outs, which requires proof that verification already
// happened without re-exposing any WebAuthn material to the caller — an
// opaque, short-lived, server-signed token is exactly what the internal
// /api/attendance route already does with its own "identity-pass" token
// (services/webauthn.ts's IDENTITY_PASS_PURPOSE); this is that same
// pattern, scoped to the federation surface.
const FEDERATION_ASSERTION_PURPOSE = 'federation_attendance_assertion';
const FEDERATION_ASSERTION_TTL = '3m';

export type FederationAssertionOutcome = 'allowed' | 'denied' | 'requires_manager_review';

export function issueFederationAssertionToken(userId: number, outcome: FederationAssertionOutcome, reasonCode: string): string {
  return signShortLivedToken({ purpose: FEDERATION_ASSERTION_PURPOSE, userId, outcome, reasonCode }, FEDERATION_ASSERTION_TTL);
}

export function verifyFederationAssertion(assertionId: string): { userId: number; outcome: FederationAssertionOutcome; reasonCode: string } | null {
  const decoded = verifyToken(assertionId);
  if (!decoded || decoded.purpose !== FEDERATION_ASSERTION_PURPOSE) return null;
  return { userId: decoded.userId, outcome: decoded.outcome, reasonCode: decoded.reasonCode };
}
