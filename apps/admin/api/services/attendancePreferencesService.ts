import { eq, desc } from 'drizzle-orm';
import { db, schema } from '../../db';

// ═══════════════════════════════════════════════════════════════════════
// Attendance Preferences Service — the single source of truth for
// resolving, validating, and diffing attendance configuration.  Both
// the admin CRUD API and the employee-facing attendance flow call this,
// so preference logic is never duplicated.
// ═══════════════════════════════════════════════════════════════════════

// Every attendance method the platform knows about.  The admin UI shows
// all of them as toggles; ones without backend enforcement yet are
// marked future: true so the UI can render them with a "Coming Soon"
// badge without hiding them from the policy engine.
export const KNOWN_ATTENDANCE_METHODS = [
  { key: 'face_recognition', label: 'Face Recognition', icon: 'scan-face', future: false },
  { key: 'gps', label: 'GPS', icon: 'map-pin', future: false },
  { key: 'wifi', label: 'Wi-Fi', icon: 'wifi', future: false },
  { key: 'qr_code', label: 'QR Code', icon: 'qr-code', future: false },
  { key: 'manual', label: 'Manual Check In', icon: 'hand', future: false },
  { key: 'desktop', label: 'Desktop Attendance', icon: 'monitor', future: false },
  { key: 'bluetooth_beacon', label: 'Bluetooth Beacon', icon: 'bluetooth', future: true },
  { key: 'nfc', label: 'NFC', icon: 'nfc', future: true },
  { key: 'biometric_device', label: 'Biometric Device', icon: 'fingerprint', future: true },
  { key: 'geo_fence', label: 'Geo Fence', icon: 'circle-dot', future: true },
] as const;

export type AttendanceMethodKey = typeof KNOWN_ATTENDANCE_METHODS[number]['key'];

// The full set of typed preference fields — mirrors the DB columns
// exactly so TypeScript catches any drift at compile time.
export interface AttendancePrefs {
  // General / Session Rules
  allowMultipleSessions: boolean;
  maxSessionsPerDay: number;
  minGapBetweenSessionsMins: number;
  requireCheckoutBeforeNewCheckin: boolean;
  autoCloseOpenSessions: boolean;
  maxSessionDurationMins: number | null;
  // Attendance Methods
  enabledMethods: string[];
  defaultMethod: string;
  methodHierarchy: { primary: string; allowedBackups: string[] } | null;
  // Verification
  requireFaceMatch: boolean;
  requireGps: boolean;
  requireOfficeWifi: boolean;
  requireGeoFence: boolean;
  requireDeviceVerification: boolean;
  requireLivenessDetection: boolean;
  // Shift Behaviour
  allowEarlyCheckin: boolean;
  earlyCheckinBufferMins: number;
  allowLateCheckout: boolean;
  maxOvertimeMins: number | null;
  allowCrossMidnightSessions: boolean;
  autoSplitAtMidnight: boolean;
  // Employee Experience / UI
  showRunningTimer: boolean;
  showWorkingHoursLive: boolean;
  showAttendanceTimeline: boolean;
  allowEmployeeNotes: boolean;
  allowAttendanceRegularization: boolean;
  allowManualAttendanceFreeze: boolean;
  allowBreakTracking: boolean;
  allowManualCheckout: boolean;
  requireCheckoutReason: boolean;
  // Break Preferences
  enableBreaks: boolean;
  allowMultipleBreaks: boolean;
  maxBreaks: number | null;
  breakCategories: string[];
  // Mobile
  useCameraForFace: boolean;
  requireRearCamera: boolean;
  allowOfflineAttendance: boolean;
  offlineSync: boolean;
  backgroundGps: boolean;
  // Presence & Auto-Checkout Engine
  presenceEngineEnabled: boolean;
  presenceGracePeriodMins: number;
  presenceHeartbeatIntervalSec: number;
  autoCheckoutDelayMins: number;
  autoCheckoutConfidenceThreshold: number;
  maxSessionDurationHours: number;
  enableBrowserHeartbeat: boolean;
  enableBrowserActivityTracking: boolean;
  enableGpsEvaluation: boolean;
  enableWifiEvaluation: boolean;
  enableFaceEvaluation: boolean;
  ignoreGpsDuringBreak: boolean;
  overtimeThresholdMins: number;
  // Effective Date
  effectiveFrom: Date | null;
}

// System defaults — used when a tenant has no attendancePreferences row,
// or for any field that hasn't been explicitly set.  Every value here
// reproduces today's existing behavior exactly.
export const SYSTEM_DEFAULTS: AttendancePrefs = {
  allowMultipleSessions: false,
  maxSessionsPerDay: 1,
  minGapBetweenSessionsMins: 15,
  requireCheckoutBeforeNewCheckin: true,
  autoCloseOpenSessions: false,
  maxSessionDurationMins: null,
  enabledMethods: ['face_recognition', 'gps', 'manual'],
  defaultMethod: 'face_recognition',
  methodHierarchy: null,
  requireFaceMatch: true,
  requireGps: true,
  requireOfficeWifi: false,
  requireGeoFence: false,
  requireDeviceVerification: false,
  requireLivenessDetection: true,
  allowEarlyCheckin: true,
  earlyCheckinBufferMins: 30,
  allowLateCheckout: true,
  maxOvertimeMins: null,
  allowCrossMidnightSessions: false,
  autoSplitAtMidnight: false,
  showRunningTimer: true,
  showWorkingHoursLive: true,
  showAttendanceTimeline: true,
  allowEmployeeNotes: true,
  allowAttendanceRegularization: true,
  allowManualAttendanceFreeze: true,
  allowBreakTracking: true,
  allowManualCheckout: true,
  requireCheckoutReason: false,
  enableBreaks: true,
  allowMultipleBreaks: true,
  maxBreaks: null,
  breakCategories: ['Lunch', 'Tea', 'Personal', 'Official', 'General'],
  useCameraForFace: true,
  requireRearCamera: false,
  allowOfflineAttendance: false,
  offlineSync: false,
  backgroundGps: false,
  presenceEngineEnabled: true,
  presenceGracePeriodMins: 30,
  presenceHeartbeatIntervalSec: 60,
  autoCheckoutDelayMins: 15,
  autoCheckoutConfidenceThreshold: 40,
  maxSessionDurationHours: 14,
  enableBrowserHeartbeat: true,
  enableBrowserActivityTracking: true,
  enableGpsEvaluation: true,
  enableWifiEvaluation: false,
  enableFaceEvaluation: true,
  ignoreGpsDuringBreak: true,
  overtimeThresholdMins: 0,
  effectiveFrom: null,
};

// The preference field names that are configurable (excludes id, tenantId, timestamps).
const PREF_FIELDS = Object.keys(SYSTEM_DEFAULTS) as (keyof AttendancePrefs)[];

/**
 * Resolves the effective attendance preferences for a tenant.
 * Returns the DB row merged with system defaults — an absent row
 * means "every default, no change."
 */
export async function resolveAttendancePreferences(tenantId: number): Promise<AttendancePrefs> {
  const rows = await db.select()
    .from(schema.attendancePreferences)
    .where(eq(schema.attendancePreferences.tenantId, tenantId))
    .limit(1);

  if (rows.length === 0) return { ...SYSTEM_DEFAULTS };

  const row = rows[0] as any;

  // If effectiveFrom is in the future, this config isn't active yet —
  // return defaults instead.
  if (row.effectiveFrom && new Date(row.effectiveFrom) > new Date()) {
    return { ...SYSTEM_DEFAULTS };
  }

  // Merge row over defaults, coercing JSONB fields
  const result: any = { ...SYSTEM_DEFAULTS };
  for (const field of PREF_FIELDS) {
    const dbKey = field as string;
    if (row[dbKey] !== null && row[dbKey] !== undefined) {
      const val = row[dbKey];
      // JSONB columns come back as objects/arrays already parsed by pg
      if (field === 'enabledMethods' || field === 'breakCategories') {
        result[field] = Array.isArray(val) ? val : (typeof val === 'string' ? JSON.parse(val) : val);
      } else if (field === 'methodHierarchy') {
        result[field] = typeof val === 'string' ? JSON.parse(val) : val;
      } else {
        result[field] = val;
      }
    }
  }
  return result as AttendancePrefs;
}

/**
 * Returns the raw DB row (null if not yet created) for the admin UI
 * to show the "configured" vs "default" distinction.
 */
export async function getRawPreferences(tenantId: number) {
  const rows = await db.select()
    .from(schema.attendancePreferences)
    .where(eq(schema.attendancePreferences.tenantId, tenantId))
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
}

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validates a partial update against the current resolved state.
 * Returns an array of validation errors (empty = valid).
 */
export function validatePreferencesUpdate(
  current: AttendancePrefs,
  update: Partial<AttendancePrefs>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const merged = { ...current, ...update };

  // 1. Default method must be in enabledMethods
  if (merged.enabledMethods && merged.defaultMethod) {
    if (!merged.enabledMethods.includes(merged.defaultMethod)) {
      errors.push({
        field: 'defaultMethod',
        message: `Default method "${merged.defaultMethod}" is not in the enabled methods list.`,
      });
    }
  }

  // 2. At least one method must remain enabled
  if (merged.enabledMethods && merged.enabledMethods.length === 0) {
    errors.push({
      field: 'enabledMethods',
      message: 'At least one attendance method must remain enabled.',
    });
  }

  // 3. Multiple sessions vs maxSessionsPerDay consistency
  if (merged.allowMultipleSessions && merged.maxSessionsPerDay === 1) {
    errors.push({
      field: 'maxSessionsPerDay',
      message: 'Cannot set maximum sessions to 1 while multiple sessions are enabled. Set to 2 or more, or disable multiple sessions.',
    });
  }

  // 4. Max sessions must be positive
  if (merged.maxSessionsPerDay !== null && merged.maxSessionsPerDay !== undefined && merged.maxSessionsPerDay < 1) {
    errors.push({
      field: 'maxSessionsPerDay',
      message: 'Maximum sessions per day must be at least 1.',
    });
  }

  // 5. Gap between sessions must be non-negative
  if (merged.minGapBetweenSessionsMins < 0) {
    errors.push({
      field: 'minGapBetweenSessionsMins',
      message: 'Minimum gap between sessions cannot be negative.',
    });
  }

  // 6. Buffer mins must be non-negative
  if (merged.earlyCheckinBufferMins < 0) {
    errors.push({
      field: 'earlyCheckinBufferMins',
      message: 'Early check-in buffer cannot be negative.',
    });
  }

  // 7. Method hierarchy primary must be in enabled methods
  if (merged.methodHierarchy) {
    const h = merged.methodHierarchy;
    if (!merged.enabledMethods.includes(h.primary)) {
      errors.push({
        field: 'methodHierarchy',
        message: `Primary method "${h.primary}" in the method hierarchy is not in enabled methods.`,
      });
    }
    for (const b of (h.allowedBackups || [])) {
      if (!merged.enabledMethods.includes(b)) {
        errors.push({
          field: 'methodHierarchy',
          message: `Backup method "${b}" in the method hierarchy is not in enabled methods.`,
        });
      }
    }
  }

  // 8. Break categories must not be empty if breaks are enabled
  if (merged.enableBreaks && merged.breakCategories && merged.breakCategories.length === 0) {
    errors.push({
      field: 'breakCategories',
      message: 'At least one break category is required when breaks are enabled.',
    });
  }

  return errors;
}

export interface FieldDiff {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

/**
 * Computes the field-level diff between two preference states.
 * Used to populate the attendance_preference_history table.
 */
export function diffPreferences(
  oldPrefs: AttendancePrefs,
  newPrefs: AttendancePrefs,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  for (const field of PREF_FIELDS) {
    const oldVal = (oldPrefs as any)[field];
    const newVal = (newPrefs as any)[field];

    const serialize = (v: any): string | null => {
      if (v === null || v === undefined) return null;
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    };

    const oldStr = serialize(oldVal);
    const newStr = serialize(newVal);

    if (oldStr !== newStr) {
      diffs.push({ field, oldValue: oldStr, newValue: newStr });
    }
  }

  return diffs;
}

/**
 * Returns the change history for a tenant's attendance preferences.
 */
export async function getPreferenceHistory(tenantId: number, limit = 100) {
  return db.select()
    .from(schema.attendancePreferenceHistory)
    .where(eq(schema.attendancePreferenceHistory.tenantId, tenantId))
    .orderBy(desc(schema.attendancePreferenceHistory.createdAt))
    .limit(limit);
}

/**
 * Human-readable label for a preference field name.
 */
export const FIELD_LABELS: Record<string, string> = {
  allowMultipleSessions: 'Allow Multiple Sessions Per Day',
  maxSessionsPerDay: 'Maximum Sessions Per Day',
  minGapBetweenSessionsMins: 'Minimum Gap Between Sessions (mins)',
  requireCheckoutBeforeNewCheckin: 'Require Checkout Before New Check-in',
  autoCloseOpenSessions: 'Automatically Close Open Sessions',
  maxSessionDurationMins: 'Maximum Session Duration (mins)',
  enabledMethods: 'Enabled Attendance Methods',
  defaultMethod: 'Default Check-in Method',
  methodHierarchy: 'Method Hierarchy',
  requireFaceMatch: 'Require Face Match',
  requireGps: 'Require GPS',
  requireOfficeWifi: 'Require Office Wi-Fi',
  requireGeoFence: 'Require Geo Fence',
  requireDeviceVerification: 'Require Device Verification',
  requireLivenessDetection: 'Require Liveness Detection',
  allowEarlyCheckin: 'Allow Early Check-in',
  earlyCheckinBufferMins: 'Early Check-in Buffer (mins)',
  allowLateCheckout: 'Allow Late Checkout',
  maxOvertimeMins: 'Maximum Overtime (mins)',
  allowCrossMidnightSessions: 'Allow Cross-Midnight Sessions',
  autoSplitAtMidnight: 'Auto-Split Sessions at Midnight',
  showRunningTimer: 'Show Running Timer',
  showWorkingHoursLive: 'Show Working Hours Live',
  showAttendanceTimeline: 'Show Attendance Timeline',
  allowEmployeeNotes: 'Allow Employee Notes',
  allowAttendanceRegularization: 'Allow Attendance Regularization',
  allowManualAttendanceFreeze: 'Allow Manual Attendance Freeze',
  allowBreakTracking: 'Allow Break Tracking',
  allowManualCheckout: 'Allow Manual Checkout',
  requireCheckoutReason: 'Require Checkout Reason',
  enableBreaks: 'Enable Breaks',
  allowMultipleBreaks: 'Allow Multiple Breaks',
  maxBreaks: 'Maximum Breaks Per Day',
  breakCategories: 'Break Categories',
  useCameraForFace: 'Use Camera for Face Recognition',
  requireRearCamera: 'Require Rear Camera',
  allowOfflineAttendance: 'Allow Offline Attendance',
  offlineSync: 'Offline Sync',
  backgroundGps: 'Background GPS',
  presenceEngineEnabled: 'Enable Presence Engine',
  presenceGracePeriodMins: 'Shift End Grace Period (mins)',
  presenceHeartbeatIntervalSec: 'Heartbeat Interval (sec)',
  autoCheckoutDelayMins: 'Auto-Checkout Warning Countdown (mins)',
  autoCheckoutConfidenceThreshold: 'Auto-Checkout Confidence Threshold (%)',
  maxSessionDurationHours: 'Maximum Session Duration (hours)',
  enableBrowserHeartbeat: 'Enable Browser Heartbeat',
  enableBrowserActivityTracking: 'Enable Browser Activity Tracking',
  enableGpsEvaluation: 'Enable GPS Signal Evaluation',
  enableWifiEvaluation: 'Enable Wi-Fi Signal Evaluation',
  enableFaceEvaluation: 'Enable Face Verification Evaluation',
  ignoreGpsDuringBreak: 'Ignore GPS Exits During Approved Break',
  overtimeThresholdMins: 'Overtime Transition Threshold (mins)',
  effectiveFrom: 'Effective From',
};
