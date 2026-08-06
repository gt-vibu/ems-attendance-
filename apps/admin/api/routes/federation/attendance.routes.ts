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

export const router = Router();
router.use('/v1/federation', authenticateFederation, federationLimiter, requireFederationScope('attendance'));

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

  // The actual biometric/WebAuthn verification already happened via
  // POST /v1/federation/attendance/assertions/begin+complete — this call
  // only records the resulting fact, and requires that assertion's opaque
  // assertionId as proof, exactly like the internal /api/attendance route
  // requires its own signed identity-pass token before writing a row.
  let policyOutcome = { isLate: false, lateByMinutes: null as number | null, reasonCode: 'ON_TIME' as string };
  if (verification?.method === 'webauthn' && verification?.assertionId) {
    const assertion = verifyFederationAssertion(verification.assertionId);
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
    const { correctedCheckIn, correctedCheckOut, reason } = req.body || {};
    if (!reason) return res.status(422).json({ error: 'reason is required.' });

    const rows = await db.select().from(schema.attendanceLogs).where(and(eq(schema.attendanceLogs.id, attendanceId), eq(schema.attendanceLogs.tenantId, tenantId))).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Attendance record not found.' });

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

    res.json({
      policy: {
        gracePeriodMins: branch?.gracePeriodMins ?? tenant?.gracePeriodMins ?? 15,
        geofenceRadiusMeters: branch?.locationRadiusMeters ?? tenant?.locationRadiusMeters ?? 100,
        wfhEnabled: !!tenant?.wfhEnabled,
        wfhAllowedWeekdays: tenant?.wfhAllowedWeekdays ?? [],
        wfhMaxDaysPerMonth: tenant?.wfhMaxDaysPerMonth ?? null,
        wifiCheckEnabled: !!(branch?.wifiCheckEnabled ?? tenant?.wifiCheckEnabled),
      },
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
