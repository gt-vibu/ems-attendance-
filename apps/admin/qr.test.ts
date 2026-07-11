import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractQrPolicy,
  haversineMeters,
  evaluateQrGeofence,
  evaluateQrScan,
  shouldRotateQrToken,
  QR_ROTATION_OPTIONS,
} from './qr.ts';

describe('extractQrPolicy', () => {
  test('defaults a bare tenant row to QR disabled with sane fallbacks', () => {
    const policy = extractQrPolicy({});
    assert.equal(policy.qrEnabled, false);
    assert.equal(policy.rotationSeconds, 30);
    assert.equal(policy.requireGps, true);
    assert.equal(policy.requireWifi, false);
    assert.equal(policy.requireFace, true);
    assert.equal(policy.geofenceRadiusMeters, 100);
    assert.equal(policy.requireDeviceTrust, false);
  });

  test('falls back to the office locationRadiusMeters when no QR-specific radius is set', () => {
    const policy = extractQrPolicy({ locationRadiusMeters: 150 });
    assert.equal(policy.geofenceRadiusMeters, 150);
  });

  test('a QR-specific radius overrides the office radius', () => {
    const policy = extractQrPolicy({ locationRadiusMeters: 150, qrGeofenceRadiusMeters: 25 });
    assert.equal(policy.geofenceRadiusMeters, 25);
  });

  test('rejects an out-of-range rotation value and falls back to 30s', () => {
    const policy = extractQrPolicy({ qrRotationSeconds: 999 });
    assert.equal(policy.rotationSeconds, 30);
  });

  test('accepts every documented rotation option', () => {
    for (const seconds of QR_ROTATION_OPTIONS) {
      const policy = extractQrPolicy({ qrRotationSeconds: seconds });
      assert.equal(policy.rotationSeconds, seconds);
    }
  });

  test('passes through explicit false values instead of falling back to defaults', () => {
    const policy = extractQrPolicy({ qrRequireGps: false, qrRequireFace: false });
    assert.equal(policy.requireGps, false);
    assert.equal(policy.requireFace, false);
  });
});

describe('haversineMeters / evaluateQrGeofence', () => {
  test('same point is zero distance and passes', () => {
    const result = evaluateQrGeofence({ currentLat: 12.9716, currentLng: 77.5946, officeLat: 12.9716, officeLng: 77.5946, radiusMeters: 100 });
    assert.equal(result.passed, true);
    assert.equal(result.distanceMeters, 0);
  });

  test('outside radius fails with a distance-aware message', () => {
    const result = evaluateQrGeofence({ currentLat: 12.9716, currentLng: 77.5946, officeLat: 12.9816, officeLng: 77.5946, radiusMeters: 100 });
    assert.equal(result.passed, false);
    assert.match(result.error!, /Out of QR check-in radius/);
    assert.ok(result.distanceMeters > 1000);
  });
});

describe('evaluateQrScan', () => {
  const activeSession = { status: 'active' as const, currentNonce: 'abc123', currentNonceUsed: false, currentTokenExpiresAt: new Date(Date.now() + 30_000) };

  test('no session at all is invalid', () => {
    assert.equal(evaluateQrScan({ session: null, tokenNonce: 'abc123' }), 'QR_INVALID');
  });

  test('closed session rejects even a matching, unused, unexpired nonce', () => {
    const closed = { ...activeSession, status: 'closed' as const };
    assert.equal(evaluateQrScan({ session: closed, tokenNonce: 'abc123' }), 'SESSION_CLOSED');
  });

  test('stale nonce (session has since rotated) is expired', () => {
    assert.equal(evaluateQrScan({ session: activeSession, tokenNonce: 'stale-nonce' }), 'QR_EXPIRED');
  });

  test('already-used nonce is rejected as a replay', () => {
    const used = { ...activeSession, currentNonceUsed: true };
    assert.equal(evaluateQrScan({ session: used, tokenNonce: 'abc123' }), 'QR_ALREADY_USED');
  });

  test('time-expired nonce is rejected even if not marked used', () => {
    const expired = { ...activeSession, currentTokenExpiresAt: new Date(Date.now() - 1000) };
    assert.equal(evaluateQrScan({ session: expired, tokenNonce: 'abc123' }), 'QR_EXPIRED');
  });

  test('matching, unused, unexpired nonce on an active session is valid', () => {
    assert.equal(evaluateQrScan({ session: activeSession, tokenNonce: 'abc123' }), 'VALID');
  });
});

describe('shouldRotateQrToken', () => {
  test('closed sessions never need rotation (nothing to display)', () => {
    assert.equal(shouldRotateQrToken({ status: 'closed', currentNonce: 'x', currentNonceUsed: false, currentTokenExpiresAt: new Date(Date.now() + 30_000) }), false);
  });

  test('rotates immediately once the current code has been scanned, before its natural expiry', () => {
    assert.equal(shouldRotateQrToken({ status: 'active', currentNonce: 'x', currentNonceUsed: true, currentTokenExpiresAt: new Date(Date.now() + 30_000) }), true);
  });

  test('rotates once the natural expiry has passed', () => {
    assert.equal(shouldRotateQrToken({ status: 'active', currentNonce: 'x', currentNonceUsed: false, currentTokenExpiresAt: new Date(Date.now() - 1000) }), true);
  });

  test('does not rotate a fresh, unused, unexpired code', () => {
    assert.equal(shouldRotateQrToken({ status: 'active', currentNonce: 'x', currentNonceUsed: false, currentTokenExpiresAt: new Date(Date.now() + 30_000) }), false);
  });
});
