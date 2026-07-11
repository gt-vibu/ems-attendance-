import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractWfhPolicy,
  isRoleAllowedForWfh,
  haversineMeters,
  evaluateWfhEligibility,
  evaluateWfhLocation,
  todayWeekdayName,
} from './wfh.ts';

describe('extractWfhPolicy', () => {
  test('defaults a bare tenant row to WFH disabled with sane fallbacks', () => {
    const policy = extractWfhPolicy({});
    assert.equal(policy.wfhEnabled, false);
    assert.equal(policy.wfhAllowedRoles, null);
    assert.equal(policy.wfhMaxDaysPerMonth, null);
    assert.deepEqual(policy.wfhAllowedWeekdays, ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
    assert.equal(policy.wfhRadiusMeters, 200);
    assert.equal(policy.wfhApprovalRequired, true);
    assert.equal(policy.wfhRequireReason, true);
  });

  test('treats an empty allowed-roles array as "no restriction", not "nobody allowed"', () => {
    const policy = extractWfhPolicy({ wfhAllowedRoles: [] });
    assert.equal(policy.wfhAllowedRoles, null);
  });

  test('passes through explicit false values instead of falling back to defaults', () => {
    const policy = extractWfhPolicy({ wfhApprovalRequired: false, wfhRequireReason: false });
    assert.equal(policy.wfhApprovalRequired, false);
    assert.equal(policy.wfhRequireReason, false);
  });
});

describe('isRoleAllowedForWfh', () => {
  test('admins can never WFH regardless of policy', () => {
    const policy = extractWfhPolicy({ wfhAllowedRoles: ['super_admin', 'tenant_admin'] });
    assert.equal(isRoleAllowedForWfh('super_admin', policy), false);
    assert.equal(isRoleAllowedForWfh('tenant_admin', policy), false);
  });

  test('unrestricted policy allows any non-admin role', () => {
    const policy = extractWfhPolicy({});
    assert.equal(isRoleAllowedForWfh('employee', policy), true);
    assert.equal(isRoleAllowedForWfh('SomeCustomRole', policy), true);
  });

  test('restricted policy only allows listed roles', () => {
    const policy = extractWfhPolicy({ wfhAllowedRoles: ['employee', 'HR'] });
    assert.equal(isRoleAllowedForWfh('employee', policy), true);
    assert.equal(isRoleAllowedForWfh('manager', policy), false);
  });
});

describe('haversineMeters', () => {
  test('same point is zero distance', () => {
    assert.equal(haversineMeters(12.9716, 77.5946, 12.9716, 77.5946), 0);
  });

  test('roughly matches a known real-world distance (~1.1km, tolerant)', () => {
    // Two points ~0.01 degrees apart in latitude is roughly 1.1km.
    const d = haversineMeters(12.9716, 77.5946, 12.9816, 77.5946);
    assert.ok(d > 1000 && d < 1200, `expected ~1100m, got ${d}`);
  });
});

describe('evaluateWfhLocation', () => {
  test('within radius passes', () => {
    const result = evaluateWfhLocation({ currentLat: 12.9716, currentLng: 77.5946, homeLat: 12.9716, homeLng: 77.5946, radiusMeters: 200 });
    assert.equal(result.passed, true);
    assert.equal(result.distanceMeters, 0);
  });

  test('outside radius fails with a distance-aware message', () => {
    const result = evaluateWfhLocation({ currentLat: 12.9716, currentLng: 77.5946, homeLat: 12.9816, homeLng: 77.5946, radiusMeters: 200 });
    assert.equal(result.passed, false);
    assert.match(result.error!, /does not match your registered home location/);
  });
});

describe('evaluateWfhEligibility', () => {
  const basePolicy = extractWfhPolicy({ wfhEnabled: true });

  test('rejects when WFH disabled tenant-wide', () => {
    const result = evaluateWfhEligibility({
      policy: extractWfhPolicy({ wfhEnabled: false }),
      role: 'employee', hasHomeLocation: true, isKycCompleted: true, wfhCheckInsThisMonth: 0,
    });
    assert.equal(result.eligible, false);
    assert.match(result.reason!, /not enabled/);
  });

  test('rejects a role not on the allowed list', () => {
    const policy = extractWfhPolicy({ wfhEnabled: true, wfhAllowedRoles: ['HR'] });
    const result = evaluateWfhEligibility({
      policy, role: 'employee', hasHomeLocation: true, isKycCompleted: true, wfhCheckInsThisMonth: 0,
    });
    assert.equal(result.eligible, false);
    assert.match(result.reason!, /role is not permitted/);
  });

  test('rejects incomplete KYC', () => {
    const result = evaluateWfhEligibility({
      policy: basePolicy, role: 'employee', hasHomeLocation: true, isKycCompleted: false, wfhCheckInsThisMonth: 0,
    });
    assert.equal(result.eligible, false);
    assert.match(result.reason!, /KYC/);
  });

  test('rejects a weekday not in the allowed list', () => {
    const policy = extractWfhPolicy({ wfhEnabled: true, wfhAllowedWeekdays: ['Monday'] });
    const sunday = new Date('2026-07-12T10:00:00'); // a Sunday
    const result = evaluateWfhEligibility({
      policy, role: 'employee', hasHomeLocation: true, isKycCompleted: true, wfhCheckInsThisMonth: 0, now: sunday,
    });
    assert.equal(result.eligible, false);
    assert.match(result.reason!, /not allowed on Sundays/);
  });

  test('rejects once the monthly quota is reached', () => {
    const policy = extractWfhPolicy({ wfhEnabled: true, wfhMaxDaysPerMonth: 5 });
    const result = evaluateWfhEligibility({
      policy, role: 'employee', hasHomeLocation: true, isKycCompleted: true, wfhCheckInsThisMonth: 5,
      now: new Date('2026-07-13T10:00:00'), // a Monday — pin the day so the weekday gate (which runs before the quota gate) doesn't mask this assertion when the suite happens to run on a weekend
    });
    assert.equal(result.eligible, false);
    assert.match(result.reason!, /quota/);
  });

  test('allows unlimited quota when wfhMaxDaysPerMonth is null', () => {
    const result = evaluateWfhEligibility({
      policy: basePolicy, role: 'employee', hasHomeLocation: true, isKycCompleted: true, wfhCheckInsThisMonth: 999,
      now: new Date('2026-07-13T10:00:00'), // a Monday
    });
    assert.equal(result.eligible, true);
  });

  test('eligible but flags needsHomeRegistration when no home location registered yet', () => {
    const result = evaluateWfhEligibility({
      policy: basePolicy, role: 'employee', hasHomeLocation: false, isKycCompleted: true, wfhCheckInsThisMonth: 0,
      now: new Date('2026-07-13T10:00:00'), // a Monday
    });
    assert.equal(result.eligible, true);
    assert.equal(result.needsHomeRegistration, true);
  });

  test('fully eligible with home location already registered', () => {
    const result = evaluateWfhEligibility({
      policy: basePolicy, role: 'employee', hasHomeLocation: true, isKycCompleted: true, wfhCheckInsThisMonth: 0,
      now: new Date('2026-07-13T10:00:00'), // a Monday
    });
    assert.equal(result.eligible, true);
    assert.equal(result.needsHomeRegistration, false);
    assert.equal(result.reason, undefined);
  });
});

describe('todayWeekdayName', () => {
  test('resolves the correct weekday name', () => {
    assert.equal(todayWeekdayName(new Date('2026-07-13T10:00:00')), 'Monday');
    assert.equal(todayWeekdayName(new Date('2026-07-12T10:00:00')), 'Sunday');
  });
});
