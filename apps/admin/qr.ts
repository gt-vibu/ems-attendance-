// Dynamic QR Attendance — policy evaluation and pure helpers. Kept as a
// standalone module of pure functions (no db/express imports), mirroring
// the wfh.ts convention in this same directory, so the rotation/expiry/
// geofence logic is unit-testable in isolation from the much larger
// server.ts.

export const QR_ROTATION_OPTIONS = [15, 30, 60, 120] as const;
export type QrRotationSeconds = (typeof QR_ROTATION_OPTIONS)[number];

// Every action a tenant admin can delegate, independent of role name — see
// getDefaultPrivilegesForRole()/hasPrivilege() in server.ts, the same
// privilege system every other module in this app already uses.
export const QR_PERMISSIONS = {
  GENERATE: 'attendance.qr.generate', // start a display session
  DISPLAY: 'attendance.qr.display',   // view the live rotating code + counts
  CLOSE: 'attendance.qr.close',       // stop a session
  SCAN: 'attendance.qr.scan',         // scan a code to mark OWN attendance (not gated by default — see server.ts)
  OVERRIDE: 'attendance.qr.override', // manually approve a failed scan
  VIEW_LOGS: 'attendance.qr.view_logs',
} as const;

export interface QrPolicy {
  qrEnabled: boolean;
  rotationSeconds: QrRotationSeconds;
  requireGps: boolean;
  requireWifi: boolean;
  requireFace: boolean;
  geofenceRadiusMeters: number; // resolved: qrGeofenceRadiusMeters ?? locationRadiusMeters ?? 100
  requireDeviceTrust: boolean;
}

export function extractQrPolicy(tenant: any): QrPolicy {
  const rotation = QR_ROTATION_OPTIONS.includes(tenant?.qrRotationSeconds) ? tenant.qrRotationSeconds : 30;
  return {
    qrEnabled: !!tenant?.qrEnabled,
    rotationSeconds: rotation,
    requireGps: tenant?.qrRequireGps !== false,
    requireWifi: !!tenant?.qrRequireWifi,
    requireFace: tenant?.qrRequireFace !== false,
    geofenceRadiusMeters: tenant?.qrGeofenceRadiusMeters || tenant?.locationRadiusMeters || 100,
    requireDeviceTrust: !!tenant?.qrRequireDeviceTrust,
  };
}

// Standalone haversine implementation (intentionally not imported from
// server.ts/wfh.ts's own copies) so this module has zero dependency on
// anything else and can be reasoned about/tested in isolation.
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export interface QrGeofenceResult {
  passed: boolean;
  distanceMeters: number;
  error?: string;
}

export function evaluateQrGeofence(params: {
  currentLat: number;
  currentLng: number;
  officeLat: number;
  officeLng: number;
  radiusMeters: number;
}): QrGeofenceResult {
  const { currentLat, currentLng, officeLat, officeLng, radiusMeters } = params;
  const distance = haversineMeters(currentLat, currentLng, officeLat, officeLng);
  if (distance > radiusMeters) {
    return {
      passed: false,
      distanceMeters: distance,
      error: `GPS Geofence violation: Out of QR check-in radius by ${Math.round(distance - radiusMeters)} meters.`,
    };
  }
  return { passed: true, distanceMeters: distance };
}

// --- QR session token lifecycle (pure state-transition logic; the actual
// JWT signing/verification and DB row live in server.ts, which calls these
// pure predicates so the branching itself is testable without a server). ---

export type QrValidationOutcome = 'VALID' | 'QR_EXPIRED' | 'QR_ALREADY_USED' | 'SESSION_CLOSED' | 'QR_INVALID';

export interface QrSessionRow {
  status: 'active' | 'closed';
  currentNonce: string;
  currentNonceUsed: boolean;
  currentTokenExpiresAt: Date | string;
}

// Decides the outcome of a scan attempt against the session's current live
// state — does NOT mutate anything; the caller is responsible for the
// atomic "claim this nonce" UPDATE (see validateAndConsumeQrToken in
// server.ts) once this says VALID, to close the race between two
// concurrent scans of the same still-valid code.
export function evaluateQrScan(params: {
  session: QrSessionRow | null;
  tokenNonce: string;
  now?: Date;
}): QrValidationOutcome {
  const { session, tokenNonce, now = new Date() } = params;
  if (!session) return 'QR_INVALID';
  if (session.status !== 'active') return 'SESSION_CLOSED';
  if (session.currentNonce !== tokenNonce) return 'QR_EXPIRED'; // a newer code has since rotated in
  if (session.currentNonceUsed) return 'QR_ALREADY_USED';
  if (new Date(session.currentTokenExpiresAt).getTime() < now.getTime()) return 'QR_EXPIRED';
  return 'VALID';
}

// Whether the CURRENT token on a session is still worth showing, or the
// display should fetch/generate a fresh rotation. True as soon as either
// the clock runs out OR the code has been claimed by a scan — matches the
// "old QR immediately becomes invalid" / "previously scanned QR cannot be
// reused" requirements without waiting out the full rotation window after
// a scan.
export function shouldRotateQrToken(session: QrSessionRow, now: Date = new Date()): boolean {
  if (session.status !== 'active') return false;
  if (session.currentNonceUsed) return true;
  return new Date(session.currentTokenExpiresAt).getTime() <= now.getTime();
}

export const QR_TOKEN_PURPOSE = 'qr_attendance_code';
export const QR_SCAN_PASS_PURPOSE = 'qr_scan_pass';
