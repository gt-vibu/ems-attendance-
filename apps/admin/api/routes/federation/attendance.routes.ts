import { Router } from 'express';
import { eq, and, gte, lte, gt, desc, asc } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { sendServerError } from '../../utils/errors';
import { authenticateFederation, requireFederationScope, resolveFederationTenantContext } from '../../middleware/federationAuth';
import { federationLimiter } from '../../middleware/rateLimit';
import { requireIdempotencyKey } from '../../middleware/federationIdempotency';
import { resolveInternalId, resolveExternalId } from '../../services/federation/externalId';
import { writeOutboxEvent } from '../../services/federation/outbox';
import { encodeCursor, decodeCursor, hashFilters, resolveLimit } from '../../utils/federationCursor';
import { tenantDateKey, tenantStartOfDay } from '../../services/tenantTime';
import { verifyFederationAssertion } from '../../services/federation/webauthnAssertion';
import { haversineMeters } from '../../services/geo';
import {
  FIELD_LABELS,
  KNOWN_ATTENDANCE_METHODS,
  SYSTEM_DEFAULTS,
  diffPreferences,
  getRawPreferences,
  resolveAttendancePreferences,
  validatePreferencesUpdate,
  type AttendancePrefs,
} from '../../services/attendancePreferencesService';

export const router = Router();
router.use('/v1/federation/attendance', authenticateFederation, federationLimiter, requireFederationScope('attendance'));

const ATTENDANCE_POLICY_ENFORCEMENT_SCOPE = 'attendance.policy.enforcement';

async function isFederationAttendancePolicyConfigured(tenantId: number, clientId: string) {
  const row = (await db.select({ scopes: schema.tenantFederationAuthorizations.authorizedScopes })
    .from(schema.tenantFederationAuthorizations)
    .where(and(
      eq(schema.tenantFederationAuthorizations.tenantId, tenantId),
      eq(schema.tenantFederationAuthorizations.clientId, clientId),
    ))
    .limit(1))[0];
  return Array.isArray(row?.scopes) && row.scopes.includes(ATTENDANCE_POLICY_ENFORCEMENT_SCOPE);
}

async function markFederationAttendancePolicyConfigured(req: any, tenantId: number) {
  const clientId = String(req.federation.clientId);
  const row = (await db.select().from(schema.tenantFederationAuthorizations).where(and(
    eq(schema.tenantFederationAuthorizations.tenantId, tenantId),
    eq(schema.tenantFederationAuthorizations.clientId, clientId),
  )).limit(1))[0];
  const scopes = Array.from(new Set([
    ...(Array.isArray(row?.authorizedScopes) ? row.authorizedScopes as string[] : req.federation.scopes || []),
    ATTENDANCE_POLICY_ENFORCEMENT_SCOPE,
  ]));
  if (row) {
    await db.update(schema.tenantFederationAuthorizations).set({ authorizedScopes: scopes, updatedAt: new Date() })
      .where(eq(schema.tenantFederationAuthorizations.id, row.id));
  } else {
    await db.insert(schema.tenantFederationAuthorizations).values({
      tenantId,
      clientId,
      authorizedScopes: scopes,
      status: 'authorized',
      syncStatus: 'healthy',
    });
  }
}

async function toFederationRecord(tenantId: number, log: any) {
  return {
    attendanceId: String(log.id),
    externalEmployeeId: await resolveExternalId(tenantId, 'employee', log.userId),
    externalBranchId: log.branchId ? await resolveExternalId(tenantId, 'branch', log.branchId) : null,
    businessDate: tenantDateKey(null, log.clientTimestamp || log.createdAt),
    status: log.status,
    type: log.type,
    occurredAt: log.clientTimestamp || log.createdAt,
    workedMinutes: log.workedMinutes ?? null,
    policyOutcome: { isLate: log.isLate ?? false, lateByMinutes: log.lateByMinutes ?? null, reasonCode: log.status === 'rejected' ? 'VERIFICATION_FAILED' : (log.isLate ? 'LATE_ARRIVAL' : 'ON_TIME') },
  };
}

router.get('/v1/federation/attendance', resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const filters = { externalBranchId: req.query.externalBranchId || null, externalEmployeeId: req.query.externalEmployeeId || null, fromBusinessDate: req.query.fromBusinessDate || null, toBusinessDate: req.query.toBusinessDate || null };
    const limit = resolveLimit(req.query.limit);

    const conditions = [eq(schema.attendanceLogs.tenantId, tenantId)];
    if (filters.externalEmployeeId) {
      const empId = await resolveInternalId(tenantId, 'employee', String(filters.externalEmployeeId));
      if (empId === null) return res.json({ records: [], nextCursor: null });
      conditions.push(eq(schema.attendanceLogs.userId, empId));
    }
    if (filters.externalBranchId) {
      const branchId = await resolveInternalId(tenantId, 'branch', String(filters.externalBranchId));
      if (branchId === null) return res.json({ records: [], nextCursor: null });
      conditions.push(eq(schema.attendanceLogs.branchId, branchId));
    }
    if (filters.fromBusinessDate) conditions.push(gte(schema.attendanceLogs.createdAt, new Date(`${filters.fromBusinessDate}T00:00:00.000Z`)));
    if (filters.toBusinessDate) conditions.push(lte(schema.attendanceLogs.createdAt, new Date(`${filters.toBusinessDate}T23:59:59.999Z`)));

    let afterId = 0;
    if (req.query.cursor) {
      const decoded = decodeCursor(String(req.query.cursor), req.federation.clientId);
      if (!decoded || decoded.filtersHash !== hashFilters(filters)) return res.status(400).json({ error: 'Invalid or expired cursor.', code: 'INVALID_CURSOR' });
      afterId = decoded.lastId;
    }
    conditions.push(gt(schema.attendanceLogs.id, afterId));

    const rows = await db.select().from(schema.attendanceLogs).where(and(...conditions)).orderBy(asc(schema.attendanceLogs.id)).limit(limit);
    const records = await Promise.all(rows.map((r: any) => toFederationRecord(tenantId, r)));
    const nextCursor = rows.length === limit
      ? encodeCursor({ clientId: req.federation.clientId, filtersHash: hashFilters(filters), sort: 'id_asc', asOf: new Date().toISOString(), lastId: rows[rows.length - 1].id })
      : null;

    res.json({ records, nextCursor });
  } catch (err: any) {
    sendServerError(res, err, 'federation/attendance.routes.ts');
  }
});

router.get('/v1/federation/attendance/today', resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const { externalEmployeeId, externalBranchId } = req.query;
    if (!externalEmployeeId && !externalBranchId) return res.status(422).json({ error: 'externalEmployeeId or externalBranchId is required.' });

    const conditions = [eq(schema.attendanceLogs.tenantId, tenantId), gte(schema.attendanceLogs.createdAt, tenantStartOfDay(null))];
    if (externalEmployeeId) {
      const empId = await resolveInternalId(tenantId, 'employee', String(externalEmployeeId));
      if (empId === null) return res.json({ records: [] });
      conditions.push(eq(schema.attendanceLogs.userId, empId));
    }
    if (externalBranchId) {
      const branchId = await resolveInternalId(tenantId, 'branch', String(externalBranchId));
      if (branchId === null) return res.json({ records: [] });
      conditions.push(eq(schema.attendanceLogs.branchId, branchId));
    }

    const rows = await db.select().from(schema.attendanceLogs).where(and(...conditions)).orderBy(desc(schema.attendanceLogs.id));
    res.json({ records: await Promise.all(rows.map((r: any) => toFederationRecord(tenantId, r))) });
  } catch (err: any) {
    sendServerError(res, err, 'federation/attendance.routes.ts');
  }
});

async function recordAttendanceFact(req: any, res: any, type: 'check_in' | 'check_out') {
  const tenantId = req.federation.tenantId;
  const { externalEmployeeId, externalBranchId, occurredAt, verification, device } = req.body || {};
  if (!externalEmployeeId || !externalBranchId || !occurredAt) {
    return res.status(422).json({ error: 'externalEmployeeId, externalBranchId, and occurredAt are required.' });
  }

  const employeeInternalId = await resolveInternalId(tenantId, 'employee', externalEmployeeId);
  const branchInternalId = await resolveInternalId(tenantId, 'branch', externalBranchId);
  if (employeeInternalId === null) return res.status(404).json({ error: 'Unknown externalEmployeeId.' });
  if (branchInternalId === null) return res.status(404).json({ error: 'Unknown externalBranchId.' });

  const policyConfigured = await isFederationAttendancePolicyConfigured(tenantId, String(req.federation.clientId));
  const preferences = await resolveAttendancePreferences(tenantId);
  const requiresIdentityVerification = Boolean(
    policyConfigured &&
    (preferences.requireFaceMatch || preferences.requireLivenessDetection || preferences.requireDeviceVerification),
  );
  const assertion = verification?.method === 'webauthn' && verification?.assertionId
    ? verifyFederationAssertion(verification.assertionId)
    : null;
  if (requiresIdentityVerification && (!assertion || assertion.userId !== employeeInternalId || assertion.outcome !== 'allowed')) {
    return res.status(422).json({
      error: 'A verified passkey is required by the attendance policy.',
      reasonCode: 'VERIFICATION_NOT_PASSED',
    });
  }

  const latitude = Number(device?.location?.latitude);
  const longitude = Number(device?.location?.longitude);
  const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
  const requiresLocation = Boolean(policyConfigured && (preferences.requireGps || preferences.requireGeoFence));
  if (requiresLocation && !hasLocation) {
    return res.status(422).json({
      error: 'Current GPS location is required by the attendance policy.',
      reasonCode: 'GPS_REQUIRED',
    });
  }
  if (policyConfigured && preferences.requireGeoFence && hasLocation) {
    const branch = (await db.select().from(schema.branches).where(and(
      eq(schema.branches.id, branchInternalId),
      eq(schema.branches.tenantId, tenantId),
    )).limit(1))[0];
    if (branch?.locationLat == null || branch?.locationLng == null) {
      return res.status(422).json({
        error: 'The outlet geofence must be configured before geofence enforcement is enabled.',
        reasonCode: 'GEOFENCE_NOT_CONFIGURED',
      });
    }
    const radius = branch.locationRadiusMeters || 100;
    const distance = haversineMeters(latitude, longitude, branch.locationLat, branch.locationLng);
    if (distance > radius) {
      return res.status(403).json({
        error: `Outside the configured outlet geofence by ${Math.round(distance - radius)} meters.`,
        reasonCode: 'OUTSIDE_GEOFENCE',
        distanceMeters: Math.round(distance),
      });
    }
  }

  // The actual biometric/WebAuthn verification already happened via
  // POST /v1/federation/attendance/assertions/begin+complete — this call
  // only records the resulting fact, and requires that assertion's opaque
  // assertionId as proof, exactly like the internal /api/attendance route
  // requires its own signed identity-pass token before writing a row.
  let policyOutcome = { isLate: false, lateByMinutes: null as number | null, reasonCode: 'ON_TIME' as string };
  if (verification?.method === 'webauthn' && verification?.assertionId) {
    if (!assertion || assertion.userId !== employeeInternalId || assertion.outcome !== 'allowed') {
      return res.status(422).json({ error: 'Attendance verification was not passed for this employee.', reasonCode: 'VERIFICATION_NOT_PASSED' }, );
    }
  }

  // Domain write + outbox write commit or roll back together — a crash
  // between the two (process killed, DB connection dropped) can no longer
  // leave a real attendance row with no corresponding event, or vice versa.
  const log = await db.transaction(async (tx: any) => {
    const [inserted] = await tx.insert(schema.attendanceLogs).values({
      userId: employeeInternalId,
      tenantId,
      branchId: branchInternalId,
      status: 'approved',
      type,
      clientTimestamp: new Date(occurredAt),
      device: device?.deviceId || null,
      locationLat: hasLocation ? latitude : null,
      locationLng: hasLocation ? longitude : null,
      reason: `Recorded via SmartTeams Federation API (${device?.kind || 'unknown device'})`,
    }).returning();

    await writeOutboxEvent({
      tenantId,
      eventType: type === 'check_in' ? 'attendance.checked_in' : 'attendance.checked_out',
      aggregateType: 'attendance',
      aggregateId: String(inserted.id),
      businessDate: tenantDateKey(null, inserted.clientTimestamp || inserted.createdAt),
      externalBranchId,
      data: { externalEmployeeId, externalBranchId, attendanceId: String(inserted.id), status: inserted.status },
    }, tx);

    return inserted;
  });

  const record = await toFederationRecord(tenantId, log);
  res.json({ ...record, correlationId: req.correlationId });
}

router.post('/v1/federation/attendance/check-ins', requireIdempotencyKey, resolveFederationTenantContext(), (req, res) => recordAttendanceFact(req, res, 'check_in'));
router.post('/v1/federation/attendance/check-outs', requireIdempotencyKey, resolveFederationTenantContext(), (req, res) => recordAttendanceFact(req, res, 'check_out'));

router.post('/v1/federation/attendance/:attendanceId/corrections', requireIdempotencyKey, resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const attendanceId = Number(req.params.attendanceId);
    const { correctedCheckIn, correctedCheckOut, reason, requestedByExternalUserId, selfService } = req.body || {};
    if (!reason) return res.status(422).json({ error: 'reason is required.' });

    const rows = await db.select().from(schema.attendanceLogs).where(and(eq(schema.attendanceLogs.id, attendanceId), eq(schema.attendanceLogs.tenantId, tenantId))).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Attendance record not found.' });
    if (selfService) {
      if (!requestedByExternalUserId) return res.status(422).json({ error: 'requestedByExternalUserId is required for self-service corrections.' });
      const actorUserId = await resolveInternalId(tenantId, 'employee', String(requestedByExternalUserId));
      if (actorUserId === null) return res.status(404).json({ error: 'Unknown requestedByExternalUserId.' });
      if (actorUserId !== rows[0].userId) return res.status(403).json({ error: 'Employees can only correct their own attendance.' });
    }

    const requestedTime = correctedCheckIn || correctedCheckOut;
    const [correction] = await db.insert(schema.attendanceCorrections).values({
      tenantId,
      userId: rows[0].userId,
      requestType: correctedCheckIn && correctedCheckOut ? 'other' : (correctedCheckIn ? 'missed_checkin' : 'missed_checkout'),
      requestedDate: tenantDateKey(null, rows[0].clientTimestamp || rows[0].createdAt),
      requestedTime: requestedTime ? new Date(requestedTime).toISOString().slice(11, 16) : null,
      reason,
      status: 'pending',
    }).returning();

    res.json({ correctionId: String(correction.id), status: correction.status });
  } catch (err: any) {
    sendServerError(res, err, 'federation/attendance.routes.ts');
  }
});

router.post('/v1/federation/attendance/:attendanceId/decision', requireIdempotencyKey, resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const attendanceId = Number(req.params.attendanceId);
    const { action } = req.body || {};
    if (!['approve', 'reject'].includes(action)) return res.status(422).json({ error: 'action must be approve or reject.' });

    const rows = await db.select().from(schema.attendanceLogs).where(and(eq(schema.attendanceLogs.id, attendanceId), eq(schema.attendanceLogs.tenantId, tenantId))).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Attendance record not found.' });
    if (rows[0].status !== 'pending') return res.status(400).json({ error: 'This record has already been decided.' });

    const externalBranchId = rows[0].branchId ? await resolveExternalId(tenantId, 'branch', rows[0].branchId) : null;
    const updated = await db.transaction(async (tx: any) => {
      const [upd] = await tx.update(schema.attendanceLogs).set({ status: action === 'approve' ? 'approved' : 'rejected' }).where(eq(schema.attendanceLogs.id, attendanceId)).returning();
      await writeOutboxEvent({
        tenantId, eventType: 'attendance.corrected', aggregateType: 'attendance', aggregateId: String(attendanceId),
        externalBranchId,
        data: { attendanceId: String(attendanceId), status: upd.status },
      }, tx);
      return upd;
    });

    res.json({ attendanceId: String(attendanceId), status: updated.status, decidedAt: new Date().toISOString() });
  } catch (err: any) {
    sendServerError(res, err, 'federation/attendance.routes.ts');
  }
});

router.get('/v1/federation/attendance/policies', resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const { externalBranchId } = req.query;
    if (!externalBranchId) return res.status(422).json({ error: 'externalBranchId is required.' });
    const branchId = await resolveInternalId(tenantId, 'branch', String(externalBranchId));
    if (branchId === null) return res.status(404).json({ error: 'Unknown externalBranchId.' });

    const branchRows = await db.select().from(schema.branches).where(eq(schema.branches.id, branchId)).limit(1);
    const tenantRows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
    const branch = branchRows[0]; const tenant = tenantRows[0];

    const resolvedPreferences = await resolveAttendancePreferences(tenantId);
    res.json({
      policy: {
        gracePeriodMins: branch?.gracePeriodMins ?? tenant?.gracePeriodMins ?? 15,
        geofenceRadiusMeters: branch?.locationRadiusMeters ?? tenant?.locationRadiusMeters ?? 100,
        wfhEnabled: !!tenant?.wfhEnabled,
        wfhAllowedWeekdays: tenant?.wfhAllowedWeekdays ?? [],
        wfhMaxDaysPerMonth: tenant?.wfhMaxDaysPerMonth ?? null,
        wifiCheckEnabled: !!(branch?.wifiCheckEnabled ?? tenant?.wifiCheckEnabled),
        attendancePreferences: resolvedPreferences,
        explicitlyConfigured: await isFederationAttendancePolicyConfigured(tenantId, String(req.federation.clientId)),
        attendanceMethods: KNOWN_ATTENDANCE_METHODS,
        attendanceFieldLabels: FIELD_LABELS,
        federationIdentityVerification: {
          available: Boolean(process.env.FEDERATION_WEBAUTHN_ORIGIN),
          origin: process.env.FEDERATION_WEBAUTHN_ORIGIN || null,
        },
        geofence: {
          latitude: branch?.locationLat ?? null,
          longitude: branch?.locationLng ?? null,
          radiusMeters: branch?.locationRadiusMeters ?? tenant?.locationRadiusMeters ?? 100,
        },
      },
    });
  } catch (err: any) {
    sendServerError(res, err, 'federation/attendance.routes.ts');
  }
});

router.put('/v1/federation/attendance/preferences', requireIdempotencyKey, resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const { requestedByExternalUserId, externalBranchId, preferences, geofence } = req.body || {};
    if (!requestedByExternalUserId) {
      return res.status(422).json({ error: 'requestedByExternalUserId is required.' });
    }
    const actorUserId = await resolveInternalId(tenantId, 'employee', String(requestedByExternalUserId));
    if (actorUserId === null) return res.status(404).json({ error: 'Unknown requestedByExternalUserId.' });
    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
      return res.status(422).json({ error: 'preferences must be an object.' });
    }
    let geofenceUpdate: { branchId: number; latitude: number; longitude: number; radiusMeters: number } | null = null;
    if (geofence !== undefined) {
      if (!externalBranchId) return res.status(422).json({ error: 'externalBranchId is required with geofence.' });
      const branchId = await resolveInternalId(tenantId, 'branch', String(externalBranchId));
      if (branchId === null) return res.status(404).json({ error: 'Unknown externalBranchId.' });
      const latitude = Number(geofence?.latitude);
      const longitude = Number(geofence?.longitude);
      const radiusMeters = Number(geofence?.radiusMeters);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
          !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
          !Number.isFinite(radiusMeters) || radiusMeters < 10 || radiusMeters > 10000) {
        return res.status(422).json({ error: 'geofence requires valid latitude, longitude, and a radius from 10 to 10000 metres.' });
      }
      geofenceUpdate = { branchId, latitude, longitude, radiusMeters: Math.round(radiusMeters) };
    }
    const current = await resolveAttendancePreferences(tenantId);
    const updates = preferences as Partial<AttendancePrefs>;
    const errors = validatePreferencesUpdate(current, updates);
    if (errors.length > 0) return res.status(422).json({ errors });
    const resolvedUpdate = { ...current, ...updates };
    if (
      (resolvedUpdate.requireFaceMatch || resolvedUpdate.requireLivenessDetection || resolvedUpdate.requireDeviceVerification) &&
      !process.env.FEDERATION_WEBAUTHN_ORIGIN
    ) {
      return res.status(422).json({
        error: 'FEDERATION_WEBAUTHN_ORIGIN must be configured before passkey verification is required for federation attendance.',
      });
    }
    if (geofenceUpdate) {
      await db.update(schema.branches).set({
        locationLat: geofenceUpdate.latitude,
        locationLng: geofenceUpdate.longitude,
        locationRadiusMeters: geofenceUpdate.radiusMeters,
      }).where(and(
        eq(schema.branches.id, geofenceUpdate.branchId),
        eq(schema.branches.tenantId, tenantId),
      ));
    }
    await markFederationAttendancePolicyConfigured(req, tenantId);
    const merged = { ...current, ...updates };
    const diffs = diffPreferences(current, merged);
    const existing = await getRawPreferences(tenantId);
    if (diffs.length === 0 && existing && geofence === undefined) {
      return res.json({ preferences: current, changes: [] });
    }

    const allowedFields = new Set([
      'allowMultipleSessions', 'maxSessionsPerDay', 'minGapBetweenSessionsMins',
      'requireCheckoutBeforeNewCheckin', 'autoCloseOpenSessions', 'maxSessionDurationMins',
      'enabledMethods', 'defaultMethod', 'methodHierarchy', 'requireFaceMatch', 'requireGps',
      'requireOfficeWifi', 'requireGeoFence', 'requireDeviceVerification',
      'requireLivenessDetection', 'allowEarlyCheckin', 'earlyCheckinBufferMins',
      'allowLateCheckout', 'maxOvertimeMins', 'allowCrossMidnightSessions',
      'autoSplitAtMidnight', 'showRunningTimer', 'showWorkingHoursLive',
      'showAttendanceTimeline', 'allowEmployeeNotes', 'allowAttendanceRegularization',
      'allowManualAttendanceFreeze', 'allowBreakTracking', 'allowManualCheckout',
      'requireCheckoutReason', 'enableBreaks', 'allowMultipleBreaks', 'maxBreaks',
      'breakCategories', 'useCameraForFace', 'requireRearCamera', 'allowOfflineAttendance',
      'offlineSync', 'backgroundGps', 'presenceEngineEnabled', 'presenceGracePeriodMins',
      'presenceHeartbeatIntervalSec', 'autoCheckoutDelayMins', 'autoCheckoutConfidenceThreshold',
      'maxSessionDurationHours', 'enableBrowserHeartbeat', 'enableBrowserActivityTracking',
      'enableGpsEvaluation', 'enableWifiEvaluation', 'enableFaceEvaluation',
      'ignoreGpsDuringBreak', 'overtimeThresholdMins', 'effectiveFrom',
    ]);
    const dbPayload: Record<string, unknown> = { updatedAt: new Date(), updatedByUserId: actorUserId };
    if (!existing) {
      for (const [field, value] of Object.entries(updates)) {
        if (allowedFields.has(field)) dbPayload[field] = value;
      }
    } else {
      for (const diff of diffs) {
        if (allowedFields.has(diff.field) && diff.field in updates) {
          dbPayload[diff.field] = (updates as Record<string, unknown>)[diff.field];
        }
      }
    }

    if (existing) {
      await db.update(schema.attendancePreferences).set(dbPayload).where(eq(schema.attendancePreferences.tenantId, tenantId));
    } else {
      await db.insert(schema.attendancePreferences).values({ tenantId, ...dbPayload } as any);
    }
    const saved = await resolveAttendancePreferences(tenantId);
    await writeOutboxEvent({
      tenantId,
      eventType: 'attendance.preferences.updated',
      aggregateType: 'attendance_preferences',
      aggregateId: String(existing?.id || tenantId),
      data: {
        requestedByExternalUserId,
        fields: [
          ...diffs.map((diff) => diff.field),
          ...(geofence !== undefined ? ['geofence'] : []),
        ],
      },
    });
    res.json({
      preferences: saved,
      defaults: SYSTEM_DEFAULTS,
      methods: KNOWN_ATTENDANCE_METHODS,
      changes: diffs.map((diff) => ({ ...diff, label: FIELD_LABELS[diff.field] || diff.field })),
    });
  } catch (err: any) {
    sendServerError(res, err, 'federation/attendance.routes.ts');
  }
});

router.get('/v1/federation/attendance/shifts', resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const { externalBranchId, externalEmployeeId } = req.query;

    if (externalEmployeeId) {
      const empId = await resolveInternalId(tenantId, 'employee', String(externalEmployeeId));
      if (empId === null) return res.status(404).json({ error: 'Unknown externalEmployeeId.' });
      const userRow = (await db.select().from(schema.users).where(eq(schema.users.id, empId)).limit(1))[0];
      if (!userRow?.shiftId) return res.json({ shifts: [] });
      const shiftRow = (await db.select().from(schema.shifts).where(eq(schema.shifts.id, userRow.shiftId)).limit(1))[0];
      return res.json({ shifts: shiftRow ? [{ name: shiftRow.name, checkInTime: shiftRow.checkInTime, checkOutTime: shiftRow.checkOutTime }] : [] });
    }

    if (externalBranchId) {
      const branchId = await resolveInternalId(tenantId, 'branch', String(externalBranchId));
      if (branchId === null) return res.status(404).json({ error: 'Unknown externalBranchId.' });
      const rows = await db.select().from(schema.shifts).where(and(eq(schema.shifts.tenantId, tenantId), eq(schema.shifts.branchId, branchId)));
      return res.json({ shifts: rows.map((s: any) => ({ name: s.name, checkInTime: s.checkInTime, checkOutTime: s.checkOutTime })) });
    }

    return res.status(422).json({ error: 'externalBranchId or externalEmployeeId is required.' });
  } catch (err: any) {
    sendServerError(res, err, 'federation/attendance.routes.ts');
  }
});
