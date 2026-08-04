import { Router } from 'express';
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '../../db';
import { logger } from '../../logger';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege } from '../auth/rbac';
import { logToAuditLedger } from '../services/audit';
import {
  resolveAttendancePreferences,
  getRawPreferences,
  validatePreferencesUpdate,
  diffPreferences,
  getPreferenceHistory,
  SYSTEM_DEFAULTS,
  KNOWN_ATTENDANCE_METHODS,
  FIELD_LABELS,
  type AttendancePrefs,
} from '../services/attendancePreferencesService';

export const router = Router();

// ─────────────────────────────────────────────────────────────────────
// GET /api/attendance-preferences
// Returns the current tenant's resolved preferences (merged with
// defaults) plus the raw DB row so the UI can distinguish "explicitly
// set" from "inheriting default."
// ─────────────────────────────────────────────────────────────────────
router.get('/api/attendance-preferences', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'tenant.config.manage')) {
      return res.status(403).json({ error: 'Access denied: insufficient privileges.' });
    }

    const tenantId = req.user.tenantId;
    const resolved = await resolveAttendancePreferences(tenantId);
    const raw = await getRawPreferences(tenantId);

    res.json({
      preferences: resolved,
      raw,
      defaults: SYSTEM_DEFAULTS,
      methods: KNOWN_ATTENDANCE_METHODS,
      fieldLabels: FIELD_LABELS,
    });
  } catch (err: any) {
    logger.error('GET /api/attendance-preferences error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────
// PUT /api/attendance-preferences
// Partial update — only the fields present in the request body are
// changed.  Each changed field is audit-logged individually.
// ─────────────────────────────────────────────────────────────────────
router.put('/api/attendance-preferences', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'tenant.config.manage')) {
      return res.status(403).json({ error: 'Access denied: insufficient privileges.' });
    }

    const tenantId = req.user.tenantId;
    const updates = req.body as Partial<AttendancePrefs>;

    // Resolve the current effective state for validation + diff
    const current = await resolveAttendancePreferences(tenantId);

    // Validate the proposed change
    const errors = validatePreferencesUpdate(current, updates);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    // Compute what will actually change
    const merged = { ...current, ...updates };
    const diffs = diffPreferences(current, merged);

    if (diffs.length === 0) {
      return res.json({ message: 'No changes detected.', preferences: current });
    }

    // Build the DB update payload — only include fields that exist in
    // the schema to avoid Drizzle errors on unknown columns.
    const dbPayload: any = { updatedAt: new Date(), updatedByUserId: req.user.userId };

    const fieldMap: Record<string, string> = {
      allowMultipleSessions: 'allowMultipleSessions',
      maxSessionsPerDay: 'maxSessionsPerDay',
      minGapBetweenSessionsMins: 'minGapBetweenSessionsMins',
      requireCheckoutBeforeNewCheckin: 'requireCheckoutBeforeNewCheckin',
      autoCloseOpenSessions: 'autoCloseOpenSessions',
      maxSessionDurationMins: 'maxSessionDurationMins',
      enabledMethods: 'enabledMethods',
      defaultMethod: 'defaultMethod',
      methodHierarchy: 'methodHierarchy',
      requireFaceMatch: 'requireFaceMatch',
      requireGps: 'requireGps',
      requireOfficeWifi: 'requireOfficeWifi',
      requireGeoFence: 'requireGeoFence',
      requireDeviceVerification: 'requireDeviceVerification',
      requireLivenessDetection: 'requireLivenessDetection',
      allowEarlyCheckin: 'allowEarlyCheckin',
      earlyCheckinBufferMins: 'earlyCheckinBufferMins',
      allowLateCheckout: 'allowLateCheckout',
      maxOvertimeMins: 'maxOvertimeMins',
      allowCrossMidnightSessions: 'allowCrossMidnightSessions',
      autoSplitAtMidnight: 'autoSplitAtMidnight',
      showRunningTimer: 'showRunningTimer',
      showWorkingHoursLive: 'showWorkingHoursLive',
      showAttendanceTimeline: 'showAttendanceTimeline',
      allowEmployeeNotes: 'allowEmployeeNotes',
      allowAttendanceRegularization: 'allowAttendanceRegularization',
      allowBreakTracking: 'allowBreakTracking',
      allowManualCheckout: 'allowManualCheckout',
      requireCheckoutReason: 'requireCheckoutReason',
      enableBreaks: 'enableBreaks',
      allowMultipleBreaks: 'allowMultipleBreaks',
      maxBreaks: 'maxBreaks',
      breakCategories: 'breakCategories',
      useCameraForFace: 'useCameraForFace',
      requireRearCamera: 'requireRearCamera',
      allowOfflineAttendance: 'allowOfflineAttendance',
      offlineSync: 'offlineSync',
      backgroundGps: 'backgroundGps',
      effectiveFrom: 'effectiveFrom',
    };

    for (const diff of diffs) {
      const schemaKey = fieldMap[diff.field];
      if (schemaKey && diff.field in updates) {
        dbPayload[schemaKey] = (updates as any)[diff.field];
      }
    }

    // Upsert: insert if no row exists, update otherwise.
    const existing = await getRawPreferences(tenantId);
    if (existing) {
      await db.update(schema.attendancePreferences)
        .set(dbPayload)
        .where(eq(schema.attendancePreferences.tenantId, tenantId));
    } else {
      await db.insert(schema.attendancePreferences).values({
        tenantId,
        ...dbPayload,
      });
    }

    // Write per-field audit history
    const ipAddress = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
    const deviceInfo = req.headers['user-agent'] || null;
    const effectiveFrom = updates.effectiveFrom ? new Date(updates.effectiveFrom) : null;

    for (const diff of diffs) {
      await db.insert(schema.attendancePreferenceHistory).values({
        tenantId,
        changedByUserId: req.user.userId,
        changedByName: req.user.name || req.user.email || 'Unknown',
        fieldName: diff.field,
        oldValue: diff.oldValue,
        newValue: diff.newValue,
        ipAddress,
        deviceInfo,
        effectiveFrom,
      });
    }

    // Summary entry in the global audit ledger
    await logToAuditLedger({
      tenantId,
      actorId: req.user.userId,
      actorName: req.user.name || req.user.email || 'Unknown',
      action: 'ATTENDANCE_PREFERENCES_UPDATED',
      ipAddress,
      deviceInfo,
      details: {
        changesCount: diffs.length,
        fields: diffs.map((d) => d.field),
        effectiveFrom: effectiveFrom?.toISOString() || 'immediately',
      },
      requestId: req.requestId || null,
    });

    // Return the newly resolved state
    const newPrefs = await resolveAttendancePreferences(tenantId);
    res.json({
      message: `${diffs.length} preference(s) updated successfully.`,
      preferences: newPrefs,
      changes: diffs.map((d) => ({
        field: d.field,
        label: FIELD_LABELS[d.field] || d.field,
        oldValue: d.oldValue,
        newValue: d.newValue,
      })),
    });
  } catch (err: any) {
    logger.error('PUT /api/attendance-preferences error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/attendance-preferences/history
// Returns the per-field change log for the Change History tab.
// ─────────────────────────────────────────────────────────────────────
router.get('/api/attendance-preferences/history', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'tenant.config.manage')) {
      return res.status(403).json({ error: 'Access denied: insufficient privileges.' });
    }

    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const history = await getPreferenceHistory(req.user.tenantId, limit);

    res.json({
      history: history.map((h: any) => ({
        ...h,
        fieldLabel: FIELD_LABELS[h.fieldName] || h.fieldName,
      })),
    });
  } catch (err: any) {
    logger.error('GET /api/attendance-preferences/history error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/attendance-preferences/reset
// Resets all preferences to system defaults (deletes the row).
// ─────────────────────────────────────────────────────────────────────
router.post('/api/attendance-preferences/reset', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'tenant.config.manage')) {
      return res.status(403).json({ error: 'Access denied: insufficient privileges.' });
    }

    const tenantId = req.user.tenantId;
    const current = await resolveAttendancePreferences(tenantId);
    const diffs = diffPreferences(current, SYSTEM_DEFAULTS);

    // Delete the row so defaults apply
    await db.delete(schema.attendancePreferences)
      .where(eq(schema.attendancePreferences.tenantId, tenantId));

    // Record every field that changed back to default
    const ipAddress = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
    const deviceInfo = req.headers['user-agent'] || null;

    for (const diff of diffs) {
      await db.insert(schema.attendancePreferenceHistory).values({
        tenantId,
        changedByUserId: req.user.userId,
        changedByName: req.user.name || req.user.email || 'Unknown',
        fieldName: diff.field,
        oldValue: diff.oldValue,
        newValue: diff.newValue,
        ipAddress,
        deviceInfo,
      });
    }

    await logToAuditLedger({
      tenantId,
      actorId: req.user.userId,
      actorName: req.user.name || req.user.email || 'Unknown',
      action: 'ATTENDANCE_PREFERENCES_RESET',
      ipAddress,
      deviceInfo,
      details: { fieldsReset: diffs.length },
      requestId: req.requestId || null,
    });

    res.json({
      message: 'All attendance preferences have been reset to system defaults.',
      preferences: SYSTEM_DEFAULTS,
    });
  } catch (err: any) {
    logger.error('POST /api/attendance-preferences/reset error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/attendance-preferences/employee
// Returns the resolved, employee-facing preferences:
//   - Only enabled methods (disabled ones are stripped entirely)
//   - UI toggles (timer, timeline, notes, breaks)
//   - The default method to auto-open
// Available to ANY authenticated user (employees need this to render
// their check-in UI correctly).
// ─────────────────────────────────────────────────────────────────────
router.get('/api/attendance-preferences/employee', authenticate, async (req: any, res: any) => {
  try {
    const prefs = await resolveAttendancePreferences(req.user.tenantId);

    // Only expose what the employee needs — never the admin-level
    // verification flags or session rules.
    const enabledMethodDetails = KNOWN_ATTENDANCE_METHODS
      .filter((m) => prefs.enabledMethods.includes(m.key))
      .map((m) => ({ key: m.key, label: m.label, icon: m.icon }));

    res.json({
      enabledMethods: enabledMethodDetails,
      defaultMethod: prefs.defaultMethod,
      methodHierarchy: prefs.methodHierarchy,
      // UI toggles
      showRunningTimer: prefs.showRunningTimer,
      showWorkingHoursLive: prefs.showWorkingHoursLive,
      showAttendanceTimeline: prefs.showAttendanceTimeline,
      allowEmployeeNotes: prefs.allowEmployeeNotes,
      allowAttendanceRegularization: prefs.allowAttendanceRegularization,
      allowBreakTracking: prefs.allowBreakTracking,
      allowManualCheckout: prefs.allowManualCheckout,
      requireCheckoutReason: prefs.requireCheckoutReason,
      // Break settings
      enableBreaks: prefs.enableBreaks,
      allowMultipleBreaks: prefs.allowMultipleBreaks,
      maxBreaks: prefs.maxBreaks,
      breakCategories: prefs.breakCategories,
      // Session settings (employee needs to know for multi-session support)
      allowMultipleSessions: prefs.allowMultipleSessions,
      maxSessionsPerDay: prefs.maxSessionsPerDay,
    });
  } catch (err: any) {
    logger.error('GET /api/attendance-preferences/employee error:', err);
    res.status(500).json({ error: err.message });
  }
});
