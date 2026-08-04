import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  SYSTEM_DEFAULTS,
  validatePreferencesUpdate,
  diffPreferences,
  KNOWN_ATTENDANCE_METHODS,
  FIELD_LABELS,
  type AttendancePrefs,
} from './api/services/attendancePreferencesService.ts';

describe('Attendance Preferences Validation & Diff', () => {
  test('SYSTEM_DEFAULTS contains expected keys', () => {
    assert.equal(SYSTEM_DEFAULTS.allowMultipleSessions, false);
    assert.equal(SYSTEM_DEFAULTS.defaultMethod, 'face_recognition');
    assert.deepEqual(SYSTEM_DEFAULTS.enabledMethods, ['face_recognition', 'gps', 'manual']);
    assert.equal(SYSTEM_DEFAULTS.requireFaceMatch, true);
    assert.equal(SYSTEM_DEFAULTS.requireGps, true);
  });

  test('validatePreferencesUpdate detects defaultMethod not in enabledMethods', () => {
    const current = { ...SYSTEM_DEFAULTS };
    const errors = validatePreferencesUpdate(current, {
      enabledMethods: ['gps', 'manual'],
      defaultMethod: 'face_recognition',
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].field, 'defaultMethod');
  });

  test('validatePreferencesUpdate prevents empty enabledMethods', () => {
    const current = { ...SYSTEM_DEFAULTS };
    const errors = validatePreferencesUpdate(current, {
      enabledMethods: [],
    });
    assert.equal(errors.length >= 1, true);
    assert.equal(errors.some((e) => e.field === 'enabledMethods'), true);
  });

  test('validatePreferencesUpdate prevents maxSessionsPerDay=1 when allowMultipleSessions=true', () => {
    const current = { ...SYSTEM_DEFAULTS };
    const errors = validatePreferencesUpdate(current, {
      allowMultipleSessions: true,
      maxSessionsPerDay: 1,
    });
    assert.equal(errors.length >= 1, true);
    assert.equal(errors.some((e) => e.field === 'maxSessionsPerDay'), true);
  });

  test('diffPreferences detects changes correctly', () => {
    const oldPrefs: AttendancePrefs = { ...SYSTEM_DEFAULTS };
    const newPrefs: AttendancePrefs = {
      ...SYSTEM_DEFAULTS,
      allowMultipleSessions: true,
      maxSessionsPerDay: 3,
      requireOfficeWifi: true,
    };
    const diffs = diffPreferences(oldPrefs, newPrefs);
    assert.equal(diffs.length, 3);
    const fields = diffs.map((d) => d.field);
    assert.ok(fields.includes('allowMultipleSessions'));
    assert.ok(fields.includes('maxSessionsPerDay'));
    assert.ok(fields.includes('requireOfficeWifi'));
  });

  test('KNOWN_ATTENDANCE_METHODS includes all 10 standard methods', () => {
    assert.equal(KNOWN_ATTENDANCE_METHODS.length, 10);
    const keys = KNOWN_ATTENDANCE_METHODS.map((m) => m.key);
    assert.ok(keys.includes('face_recognition'));
    assert.ok(keys.includes('gps'));
    assert.ok(keys.includes('wifi'));
    assert.ok(keys.includes('qr_code'));
    assert.ok(keys.includes('manual'));
    assert.ok(keys.includes('desktop'));
    assert.ok(keys.includes('bluetooth_beacon'));
    assert.ok(keys.includes('nfc'));
    assert.ok(keys.includes('biometric_device'));
    assert.ok(keys.includes('geo_fence'));
  });
});
