import { Router } from 'express';
import crypto from 'crypto';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import swaggerUi from 'swagger-ui-express';
import { OAuth2Client } from 'google-auth-library';
import { db, schema } from '../../db';
import { logger } from '../../logger';
import { openApiSpec } from '../../openapi.js';
import { signToken, verifyToken, signShortLivedToken } from '../../jwt';
import { hashPassword, verifyPassword, isPasswordHashed } from '../../password.js';
import { sendEmail, sendPasswordResetEmail, sendAttendanceCorrectionEmail, sendBreakViolationAlert, sendManagerEscalationEmail, sendLateArrivalApprovalRequestEmail, sendLateArrivalDecisionEmail, sendLowAttendanceAlertEmail, sendBreakLocationViolationEmail, sendWfhApprovalRequestEmail, sendWfhDecisionEmail, sendWfhLocationChangeRequestEmail, sendWfhLocationChangeDecisionEmail } from '../../mail.js';
import { extractWfhPolicy, isRoleAllowedForWfh, haversineMeters as wfhHaversineMeters, evaluateWfhEligibility, evaluateWfhLocation, todayWeekdayName, WFH_PERMISSIONS } from '../../wfh.js';
import { reverseGeocode } from '../../geocoding.js';
import { extractQrPolicy, evaluateQrGeofence, evaluateQrScan, shouldRotateQrToken, QR_ROTATION_OPTIONS, QR_PERMISSIONS, QR_TOKEN_PURPOSE, QR_SCAN_PASS_PURPOSE } from '../../qr.js';
import { authenticate } from '../middleware/authenticate';
import { authLimiter } from '../middleware/rateLimit';
import { hasPrivilege, getEffectivePrivileges, getUsersWithPrivilege, getDefaultPrivilegesForRole, isPlatformFeatureAllowedForTenant, isPlatformFeatureAllowed } from '../auth/rbac';
import { issueNewSession, finalizeLogin } from '../auth/session';
import { logToAuditLedger } from '../services/audit';
import { IDENTITY_PASS_PURPOSE } from '../services/webauthn';
import { haversineMeters, resolveActiveIp } from '../services/geo';
import { computeAttendancePercent, getHierarchyAlertRecipients } from '../services/attendanceStats';
import { getEffectiveShiftId } from '../services/shiftOverrides';

export const router = Router();


  // ==========================================================
  // DYNAMIC QR ATTENDANCE — additive attendance mode. A privileged user
  // (gated purely by permission strings, never a hardcoded role name — see
  // QR_PERMISSIONS in qr.ts) displays a rotating QR code; any clock-in-
  // capable employee scans it with their own device and goes through the
  // same kind of face/GPS/Wi-Fi verification the office flow already uses,
  // as an independently configurable per-tenant policy. Writes land in the
  // SAME attendance_logs table (attendanceMode: 'qr') so existing reports/
  // dashboards/exports keep working unchanged. Deliberately a standalone
  // endpoint (POST /api/attendance/mark-from-qr) rather than a third branch
  // on the existing /api/attendance handler: that handler's face-pass
  // token is currently an unconditional precondition (checked before any
  // mode branching), and QR's face requirement is policy-conditional —
  // restructuring that precondition would risk the already-shipped office
  // and WFH paths for a feature that doesn't need to share that handler's
  // day-lock/late-arrival code (duplicated below in full, deliberately, per
  // "do changes to existing things only if necessary").
  // ==========================================================

  function generateQrNonce(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  // The DB row (checked via evaluateQrScan/shouldRotateQrToken) is the
  // authoritative expiry — this JWT's own expiry is just a generous outer
  // bound so a long-stale, already-rotated-past token can't be replayed
  // indefinitely even if the DB check were somehow bypassed.
  function signQrToken(session: { id: number; tenantId: number; rotationSeconds: number }, nonce: string): string {
    return signShortLivedToken({ purpose: QR_TOKEN_PURPOSE, sessionId: session.id, tenantId: session.tenantId, nonce, v: 1 }, `${session.rotationSeconds + 60}s`);
  }

  // The single place both GET /api/qr/current and POST /api/qr/session/start
  // go through, so "rotate on expiry OR on use, whichever is first" (see
  // qr.ts shouldRotateQrToken) is enforced exactly once, consistently.
  async function getOrRotateQrToken(session: any): Promise<{ session: any; token: string }> {
    if (!shouldRotateQrToken(session)) {
      return { session, token: signQrToken(session, session.currentNonce) };
    }
    const nonce = generateQrNonce();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + session.rotationSeconds * 1000);
    await db.update(schema.qrSessions).set({
      currentNonce: nonce,
      currentTokenIssuedAt: issuedAt,
      currentTokenExpiresAt: expiresAt,
      currentNonceUsed: false,
    }).where(eq(schema.qrSessions.id, session.id));
    const updated = { ...session, currentNonce: nonce, currentTokenIssuedAt: issuedAt, currentTokenExpiresAt: expiresAt, currentNonceUsed: false };
    return { session: updated, token: signQrToken(updated, nonce) };
  }

  // Verifies signature + expiry + session state, THEN atomically claims the
  // nonce via a conditional UPDATE (only succeeds if nobody else has
  // consumed this exact nonce between the check and now) — the server-side
  // idempotency the spec asks for, closing the race a plain
  // check-then-update would leave open under concurrent scans of the same
  // still-valid code.
  async function validateAndConsumeQrToken(rawToken: string, expectedTenantId?: number):
    Promise<{ outcome: 'VALID'; session: any } | { outcome: Exclude<ReturnType<typeof evaluateQrScan>, 'VALID'> }> {
    const decoded = verifyToken(rawToken);
    if (!decoded || decoded.purpose !== QR_TOKEN_PURPOSE) return { outcome: 'QR_INVALID' };

    const rows = await db.select().from(schema.qrSessions).where(eq(schema.qrSessions.id, decoded.sessionId));
    const session = rows[0] || null;
    const outcome = evaluateQrScan({ session, tokenNonce: decoded.nonce });
    if (outcome !== 'VALID') return { outcome };
    if (expectedTenantId != null && session.tenantId !== expectedTenantId) return { outcome: 'QR_INVALID' };

    const claimed = await db.update(schema.qrSessions)
      .set({ currentNonceUsed: true })
      .where(and(
        eq(schema.qrSessions.id, session.id),
        eq(schema.qrSessions.currentNonce, decoded.nonce),
        eq(schema.qrSessions.currentNonceUsed, false)
      ))
      .returning();
    if (claimed.length === 0) return { outcome: 'QR_ALREADY_USED' };
    return { outcome: 'VALID', session: claimed[0] };
  }

  async function getQrSessionCounts(sessionId: number) {
    const scans = await db.select().from(schema.qrScans).where(eq(schema.qrScans.qrSessionId, sessionId));
    return {
      scansCount: scans.length,
      successCount: scans.filter((s: any) => s.status === 'success').length,
      failCount: scans.filter((s: any) => s.status === 'failed').length,
      pendingCount: scans.filter((s: any) => s.status === 'pending').length,
    };
  }

router.post('/api/qr/session/start', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, QR_PERMISSIONS.GENERATE)) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const tenantRec = await db.select().from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId));
      if (tenantRec.length === 0) return res.status(404).json({ error: 'Tenant registration context not found.' });
      const policy = extractQrPolicy(tenantRec[0]);
      if (!policy.qrEnabled || !isPlatformFeatureAllowed(tenantRec[0] as any, 'qr_attendance')) {
        return res.status(403).json({ error: 'QR Attendance is not enabled for your organization.' });
      }

      // One authoritative active session per tenant — if another staff
      // member already started one, hand back that same session/token
      // instead of creating a second, ambiguous one.
      const existing = await db.select().from(schema.qrSessions).where(
        and(eq(schema.qrSessions.tenantId, req.user.tenantId), eq(schema.qrSessions.status, 'active'))
      );
      if (existing.length > 0) {
        const { session, token } = await getOrRotateQrToken(existing[0]);
        const counts = await getQrSessionCounts(session.id);
        return res.json({ session, token, expiresAt: session.currentTokenExpiresAt, ...counts });
      }

      const requestedRotation = (QR_ROTATION_OPTIONS as readonly number[]).includes(req.body?.rotationSeconds) ? req.body.rotationSeconds : policy.rotationSeconds;
      const nonce = generateQrNonce();
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + requestedRotation * 1000);

      const inserted = await db.insert(schema.qrSessions).values({
        tenantId: req.user.tenantId,
        generatedByUserId: req.user.userId,
        status: 'active',
        rotationSeconds: requestedRotation,
        currentNonce: nonce,
        currentTokenIssuedAt: issuedAt,
        currentTokenExpiresAt: expiresAt,
        currentNonceUsed: false,
      }).returning();
      const session = inserted[0];
      const token = signQrToken(session, nonce);

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'QR_SESSION_STARTED',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { sessionId: session.id, rotationSeconds: requestedRotation }
      });

      res.json({ session, token, expiresAt: session.currentTokenExpiresAt, scansCount: 0, successCount: 0, failCount: 0, pendingCount: 0 });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

router.post('/api/qr/session/stop', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, QR_PERMISSIONS.CLOSE)) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const { sessionId } = req.body;
      if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

      const rows = await db.select().from(schema.qrSessions).where(eq(schema.qrSessions.id, sessionId));
      if (rows.length === 0) return res.status(404).json({ error: 'Session not found' });
      const session = rows[0];
      if (session.tenantId !== req.user.tenantId) {
        return res.status(403).json({ error: 'Access denied: This session does not belong to your organization.' });
      }

      await db.update(schema.qrSessions).set({ status: 'closed', closedAt: new Date() }).where(eq(schema.qrSessions.id, sessionId));

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'QR_SESSION_STOPPED',
        details: { sessionId }
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

router.get('/api/qr/current', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, QR_PERMISSIONS.DISPLAY) && !await hasPrivilege(req.user, QR_PERMISSIONS.GENERATE)) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const rows = await db.select().from(schema.qrSessions).where(
        and(eq(schema.qrSessions.tenantId, req.user.tenantId), eq(schema.qrSessions.status, 'active'))
      );
      if (rows.length === 0) return res.json({ session: null });

      const { session, token } = await getOrRotateQrToken(rows[0]);
      const counts = await getQrSessionCounts(session.id);
      res.json({ session, token, expiresAt: session.currentTokenExpiresAt, ...counts });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // The "scan" step — validates + atomically consumes the QR nonce and
  // hands back a short-lived scan-pass token (same two-step pattern as
  // /api/attendance/verify-face -> /api/attendance). Deliberately gated on
  // "is this a clock-in-capable role", the SAME gate the existing
  // self-service /api/attendance already uses — not a special permission,
  // so QR attendance works for ordinary staff out of the box, the same way
  // self-checkin already does, matching "others can scan and mark
  // attendance" as a default capability rather than something each
  // employee needs individually granted.
router.post('/api/qr/validate', authenticate, async (req: any, res: any) => {
    try {
      const { token, deviceId } = req.body;
      if (!token) return res.status(400).json({ error: 'token is required' });

      const userRec = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
      if (userRec.length === 0) return res.status(404).json({ error: 'User not found' });
      const user = userRec[0];

      const isClockInRole = user.role !== 'super_admin' && user.role !== 'tenant_admin';
      if (!isClockInRole) {
        return res.status(403).json({ error: 'This role does not mark attendance.' });
      }
      if (!user.isKycCompleted) {
        return res.status(400).json({ error: 'Device registration not completed yet.' });
      }

      const result = await validateAndConsumeQrToken(token, user.tenantId);
      if (result.outcome !== 'VALID') {
        return res.status(410).json({ error: result.outcome, code: result.outcome });
      }
      const session = result.session;

      const tenantRec = await db.select().from(schema.tenants).where(eq(schema.tenants.id, user.tenantId));
      if (tenantRec.length === 0) return res.status(404).json({ error: 'Tenant registration context not found.' });
      const policy = extractQrPolicy(tenantRec[0]);

      const scanInserted = await db.insert(schema.qrScans).values({
        tenantId: user.tenantId,
        qrSessionId: session.id,
        scannedByUserId: user.id,
        status: 'pending',
        deviceId: deviceId || null,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        userAgent: req.headers['user-agent'] || '',
      }).returning();
      const scan = scanInserted[0];

      const scanPassToken = signShortLivedToken(
        { purpose: QR_SCAN_PASS_PURPOSE, scanId: scan.id, sessionId: session.id, userId: user.id, tenantId: user.tenantId },
        '5m'
      );

      await logToAuditLedger({
        tenantId: user.tenantId,
        actorId: user.id,
        actorName: user.name,
        action: 'QR_SCANNED',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { scanId: scan.id, sessionId: session.id }
      });

      res.json({
        valid: true,
        scanPassToken,
        requiredChecks: { face: policy.requireFace, gps: policy.requireGps, wifi: policy.requireWifi, deviceTrust: policy.requireDeviceTrust },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // The authoritative verification-engine + write. Mirrors the day-lock/
  // late-arrival/audit-logging conventions of the existing /api/attendance
  // handler (see the module comment above for why this is a standalone
  // endpoint rather than a third mode on that one).
router.post('/api/attendance/mark-from-qr', authenticate, async (req: any, res: any) => {
    try {
      const { scanPassToken, faceToken, lat, lng, simulatedIp, deviceId, clientTimestamp } = req.body;

      const scanPass = verifyToken(scanPassToken);
      if (!scanPass || scanPass.purpose !== QR_SCAN_PASS_PURPOSE || scanPass.userId !== req.user.userId) {
        return res.status(400).json({ error: 'QR scan verification expired or missing. Please scan again.' });
      }

      const userRec = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
      if (userRec.length === 0) return res.status(404).json({ error: 'User not found' });
      const user = userRec[0];

      if (!user.isKycCompleted) {
        return res.status(400).json({ error: 'Device registration not completed yet.' });
      }

      const scanRecList = await db.select().from(schema.qrScans).where(eq(schema.qrScans.id, scanPass.scanId));
      if (scanRecList.length === 0) return res.status(404).json({ error: 'Scan record not found' });
      const scan = scanRecList[0];
      if (scan.status !== 'pending') {
        return res.status(400).json({ error: 'This scan has already been resolved.' });
      }

      const tenantRec = await db.select().from(schema.tenants).where(eq(schema.tenants.id, user.tenantId));
      if (tenantRec.length === 0) return res.status(404).json({ error: 'Tenant registration context not found.' });
      const tenant = tenantRec[0];
      if (tenant.status === 'suspended') {
        return res.status(403).json({ error: 'Your organization\'s access has been suspended. Attendance cannot be logged.' });
      }
      const policy = extractQrPolicy(tenant);

      // --- Clock drift (same 5-minute tolerance as the office/WFH flow) ---
      if (clientTimestamp) {
        const clientTime = new Date(clientTimestamp).getTime();
        if (isNaN(clientTime) || Math.abs(Date.now() - clientTime) > 5 * 60 * 1000) {
          await db.update(schema.qrScans).set({ status: 'failed', failureReason: 'Device clock drift detected.' }).where(eq(schema.qrScans.id, scan.id));
          await logToAuditLedger({
            tenantId: user.tenantId, actorId: user.id, actorName: user.name, action: 'FRAUD_CLOCK_MANIPULATION',
            ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '', deviceInfo: req.headers['user-agent'] || '',
            details: { scanId: scan.id, clientTimestamp, serverTimestamp: new Date().toISOString() }
          });
          return res.status(400).json({ error: 'Verification failed: Device clock drift detected. Server timestamp enforcement active.' });
        }
      }

      const errors: string[] = [];
      let fraudType = '';
      let facePassedFlag: boolean | null = null;
      let gpsPassedFlag: boolean | null = null;
      let wifiPassedFlag: boolean | null = null;
      let deviceTrustPassedFlag: boolean | null = null;
      let distanceMeters: number | null = null;
      let faceMatchScore: number | null = null;
      let livenessScore: number | null = null;

      // --- Device trust: reuses the exact same registeredDeviceId pinning
      // the office check-in flow already enforces — not a separate device
      // list. Optional per tenant policy. ---
      if (policy.requireDeviceTrust) {
        deviceTrustPassedFlag = !user.registeredDeviceId || user.registeredDeviceId === deviceId;
        if (!deviceTrustPassedFlag) {
          errors.push('Access denied: Registered device mismatch.');
          if (!fraudType) fraudType = 'FRAUD_DEVICE_MISMATCH';
        }
      }

      // --- Identity: reuses the identity-pass token minted by
      // /api/webauthn/authenticate/verify (a WebAuthn device-signature
      // check) — only required when this tenant's QR policy calls for it.
      // `faceMatchScore`/`livenessScore`/`facePassed` are kept as 1/1/true
      // on success rather than dropped, since they're existing DB columns
      // (schema unchanged) — a WebAuthn signature is binary pass/fail, so
      // there's no meaningful score to store beyond "it passed".
      if (policy.requireFace) {
        const identityPass = verifyToken(faceToken);
        if (!identityPass || identityPass.purpose !== IDENTITY_PASS_PURPOSE || identityPass.userId !== user.id) {
          return res.status(400).json({ error: 'Device verification expired or missing. Please verify your device again.' });
        }
        faceMatchScore = 1;
        livenessScore = 1;
        facePassedFlag = true;
      }

      // Geofence/Wi-Fi/shift source: the scanning employee's own branch,
      // falling back to tenant-wide fields — same convention as the office
      // check-in flow (attendance.routes.ts). QR session generation/policy
      // toggles (qrEnabled, requireFace, etc.) stay tenant-wide, since a QR
      // session is inherently one broadcast per tenant, not per branch.
      const qrBranch = user.branchId
        ? (await db.select().from(schema.branches).where(eq(schema.branches.id, user.branchId)))[0]
        : null;

      // --- GPS: same office geofence tenant/branch already configures, with
      // an optional QR-specific radius override. ---
      if (policy.requireGps) {
        if (lat == null || lng == null) {
          return res.status(400).json({ error: 'GPS location is required for this QR check-in policy.' });
        }
        const qrGeoLat = qrBranch?.locationLat ?? tenant.locationLat;
        const qrGeoLng = qrBranch?.locationLng ?? tenant.locationLng;
        if (qrGeoLat && qrGeoLng) {
          const geofence = evaluateQrGeofence({ currentLat: lat, currentLng: lng, officeLat: qrGeoLat, officeLng: qrGeoLng, radiusMeters: policy.geofenceRadiusMeters ?? qrBranch?.locationRadiusMeters });
          gpsPassedFlag = geofence.passed;
          distanceMeters = geofence.distanceMeters;
          if (!geofence.passed) {
            errors.push(geofence.error!);
            if (!fraudType) fraudType = 'FRAUD_GEOFENCE_BYPASS';
          }
        } else {
          gpsPassedFlag = true; // no office location configured — nothing to check against
        }
      }

      // --- Wi-Fi: same public-IP approximation the office flow uses —
      // browsers cannot read the actual connected SSID/BSSID (see
      // resolveActiveIp and the Corporate Network Locking explanation in
      // the tenant settings UI). ---
      if (policy.requireWifi) {
        const qrOfficeIp = qrBranch?.officeIp ?? tenant.officeIp;
        if (qrOfficeIp) {
          const activeIp = resolveActiveIp(req, simulatedIp);
          wifiPassedFlag = qrOfficeIp === activeIp || qrOfficeIp === '127.0.0.1';
          if (!wifiPassedFlag) {
            errors.push(`Network verification failed: You must connect to the corporate Wi-Fi (Required Public IP: ${qrOfficeIp}, Your IP: ${activeIp}).`);
            if (!fraudType) fraudType = 'FRAUD_NETWORK_BYPASS';
          }
        } else {
          wifiPassedFlag = true;
        }
      }

      const isVerified = errors.length === 0;

      // --- Day state / late-arrival — mirrors (deliberately duplicated,
      // not shared — see module comment) the existing /api/attendance
      // handler's own logic. ---
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const lastActiveToday = await db.select().from(schema.attendanceLogs).where(
        and(eq(schema.attendanceLogs.userId, user.id), sql`status IN ('approved', 'pending')`, sql`created_at >= ${todayStart}`)
      ).orderBy(desc(schema.attendanceLogs.id)).limit(1);

      if (lastActiveToday.length > 0 && lastActiveToday[0].type === 'check_out') {
        return res.status(400).json({ error: 'Attendance already completed for today. Come back tomorrow.', locked: true });
      }
      let logType = 'check_in';
      if (lastActiveToday.length > 0 && lastActiveToday[0].type === 'check_in') {
        logType = 'check_out';
      }

      let isLate = false;
      // Resolves through any active dated shiftOverrides row for today first
      // (see apps/admin/api/services/shiftOverrides.ts), falling back to the
      // user's permanent shiftId — so a temporary shift change actually
      // changes lateness math on the days it's active, not just the display.
      const todayDateStr = new Date().toISOString().slice(0, 10);
      const effectiveShiftId = await getEffectiveShiftId(user.tenantId || 1, user.id, todayDateStr);
      const qrShift = effectiveShiftId
        ? (await db.select().from(schema.shifts).where(eq(schema.shifts.id, effectiveShiftId)))[0]
        : null;
      const shiftStartStr = qrShift?.checkInTime || qrBranch?.shiftStart || tenant.shiftStart || '09:00';
      const gracePeriod = qrShift?.gracePeriodMins ?? qrBranch?.gracePeriodMins ?? tenant.gracePeriodMins ?? 15;
      if (isVerified && logType === 'check_in') {
        const [shiftHour, shiftMinute] = shiftStartStr.split(':').map(Number);
        const shiftTime = new Date();
        shiftTime.setHours(shiftHour, shiftMinute, 0, 0);
        if (Date.now() > shiftTime.getTime() + gracePeriod * 60000) isLate = true;
      }

      const status = isVerified ? 'approved' : 'rejected';
      const pendingApproval = isVerified && isLate;
      const reason = isVerified
        ? (pendingApproval ? 'QR Attendance — Late Arrival, pending manager approval' : 'QR Attendance — verified successfully')
        : errors.join(' | ');

      const log = await db.insert(schema.attendanceLogs).values({
        userId: user.id,
        tenantId: user.tenantId || 1,
        branchId: user.branchId || null,
        status: pendingApproval ? 'pending' : status,
        type: logType,
        clientTimestamp: clientTimestamp ? new Date(clientTimestamp) : new Date(),
        faceMatchScore,
        livenessScore,
        device: deviceId,
        locationLat: lat ?? null,
        locationLng: lng ?? null,
        reason,
        attendanceMode: 'qr',
      }).returning();

      await db.update(schema.qrScans).set({
        status: isVerified ? 'success' : 'failed',
        failureReason: isVerified ? null : reason,
        gpsPassed: gpsPassedFlag,
        wifiPassed: wifiPassedFlag,
        facePassed: facePassedFlag,
        deviceTrustPassed: deviceTrustPassedFlag,
        distanceMeters,
        attendanceLogId: log[0].id,
      }).where(eq(schema.qrScans.id, scan.id));

      await logToAuditLedger({
        tenantId: user.tenantId,
        actorId: user.id,
        actorName: user.name,
        action: isVerified ? (logType === 'check_in' ? 'QR_CHECK_IN' : 'QR_CHECK_OUT') : fraudType,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { logId: log[0].id, scanId: scan.id, sessionId: scan.qrSessionId, status: pendingApproval ? 'pending' : status, isLate, distanceMeters, errors }
      });

      if (!isVerified) {
        const admins = await db.select().from(schema.users).where(
          and(eq(schema.users.tenantId, user.tenantId || 1), eq(schema.users.role, 'tenant_admin'))
        );
        if (admins.length > 0) {
          await sendManagerEscalationEmail(
            admins[0].email, admins[0].name, user.name,
            fraudType || 'QR Attendance Verification Failed',
            `Employee ${user.name} failed QR attendance verification.\nReason: ${reason}`
          );
        }
        return res.status(403).json({ error: reason, log: log[0] });
      }

      if (pendingApproval) {
        const checkInTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const approvers = await getUsersWithPrivilege(user.tenantId || 1, ['attendance.approve.late_arrival', 'attendance.approve']);
        for (const approver of approvers) {
          await sendLateArrivalApprovalRequestEmail(
            approver.email, approver.name, user.name,
            new Date().toLocaleDateString(), checkInTimeStr, shiftStartStr,
            'Checked in via QR Attendance (late).'
          );
        }
      }

      res.json({ success: true, log: log[0], pendingApproval });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Manual override for a failed/expired scan — e.g. a legitimate employee
  // whose face didn't match due to poor lighting. Deliberately narrow and
  // heavily audited: requires a mandatory reason, only works on this
  // tenant's own scans, and marks both the scan and a NEW attendance_logs
  // row (never silently rewrites the original rejected one, same
  // "corrections don't overwrite history" principle as attendanceCorrections).
router.post('/api/qr/scans/:id/override', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, QR_PERMISSIONS.OVERRIDE)) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const scanId = parseInt(req.params.id, 10);
      const { reason } = req.body;
      if (!reason || !reason.trim()) {
        return res.status(400).json({ error: 'A reason is required to override a failed QR scan.' });
      }

      const scanList = await db.select().from(schema.qrScans).where(eq(schema.qrScans.id, scanId));
      if (scanList.length === 0) return res.status(404).json({ error: 'Scan not found' });
      const scan = scanList[0];
      if (scan.tenantId !== req.user.tenantId) {
        return res.status(403).json({ error: 'Access denied: This scan does not belong to your organization.' });
      }
      if (scan.status !== 'failed') {
        return res.status(400).json({ error: 'Only a failed scan can be overridden.' });
      }

      const employeeList = await db.select().from(schema.users).where(eq(schema.users.id, scan.scannedByUserId));
      if (employeeList.length === 0) return res.status(404).json({ error: 'Employee not found' });
      const employee = employeeList[0];

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const lastActiveToday = await db.select().from(schema.attendanceLogs).where(
        and(eq(schema.attendanceLogs.userId, employee.id), sql`status IN ('approved', 'pending')`, sql`created_at >= ${todayStart}`)
      ).orderBy(desc(schema.attendanceLogs.id)).limit(1);
      const logType = (lastActiveToday.length > 0 && lastActiveToday[0].type === 'check_in') ? 'check_out' : 'check_in';

      const log = await db.insert(schema.attendanceLogs).values({
        userId: employee.id,
        tenantId: scan.tenantId,
        status: 'approved',
        type: logType,
        reason: `QR Attendance — manually overridden by ${req.user.name}: ${reason.trim()}`,
        attendanceMode: 'qr',
      }).returning();

      await db.update(schema.qrScans).set({ status: 'success', attendanceLogId: log[0].id }).where(eq(schema.qrScans.id, scanId));

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'QR_SCAN_OVERRIDDEN',
        details: { scanId, subjectUserId: employee.id, reason: reason.trim(), logId: log[0].id }
      });

      res.json({ success: true, log: log[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

router.get('/api/qr/history', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, QR_PERMISSIONS.VIEW_LOGS)) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const sessionsList = await db.select().from(schema.qrSessions)
        .where(eq(schema.qrSessions.tenantId, req.user.tenantId))
        .orderBy(desc(schema.qrSessions.createdAt))
        .limit(50);

      const sessionIds: number[] = sessionsList.map((s: any) => s.id as number);
      const generatorIds = [...new Set(sessionsList.map((s: any) => s.generatedByUserId as number))] as number[];
      const [generators, allScans] = await Promise.all([
        generatorIds.length > 0
          ? db.select().from(schema.users).where(inArray(schema.users.id, generatorIds))
          : Promise.resolve([]),
        sessionIds.length > 0
          ? db.select().from(schema.qrScans).where(inArray(schema.qrScans.qrSessionId, sessionIds))
          : Promise.resolve([]),
      ]);
      const generatorNameById = new Map<number, string>(generators.map((u: any) => [u.id, u.name]));
      const scansBySessionId = new Map<number, any[]>();
      for (const scan of allScans) {
        const list = scansBySessionId.get(scan.qrSessionId) || [];
        list.push(scan);
        scansBySessionId.set(scan.qrSessionId, list);
      }

      const withDetails = sessionsList.map((s: any) => {
        const scans = scansBySessionId.get(s.id) || [];
        const counts = {
          scansCount: scans.length,
          successCount: scans.filter((sc: any) => sc.status === 'success').length,
          failCount: scans.filter((sc: any) => sc.status === 'failed').length,
          pendingCount: scans.filter((sc: any) => sc.status === 'pending').length,
        };
        return { ...s, generatedByName: generatorNameById.get(s.generatedByUserId) || 'Unknown', ...counts };
      });

      res.json({ sessions: withDetails });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

router.get('/api/qr/logs', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, QR_PERMISSIONS.VIEW_LOGS)) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const scansList = await db.select().from(schema.qrScans)
        .where(eq(schema.qrScans.tenantId, req.user.tenantId))
        .orderBy(desc(schema.qrScans.createdAt))
        .limit(200);

      const scannerIds = [...new Set(scansList.map((s: any) => s.scannedByUserId as number))] as number[];
      const scanners = scannerIds.length > 0
        ? await db.select().from(schema.users).where(inArray(schema.users.id, scannerIds))
        : [];
      const scannerById = new Map<number, any>(scanners.map((u: any) => [u.id, u]));
      const withNames = scansList.map((s: any) => {
        const u = scannerById.get(s.scannedByUserId);
        return { ...s, userName: u?.name || 'Unknown', userRole: u?.role || '' };
      });

      res.json({ scans: withNames });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

router.get('/api/qr/config', authenticate, async (req: any, res: any) => {
    try {
      const tenantRec = await db.select().from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId));
      if (tenantRec.length === 0) return res.status(404).json({ error: 'Tenant registration context not found.' });
      res.json({ policy: extractQrPolicy(tenantRec[0]) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Policy changes are org-wide and security-sensitive — gated by the same
  // delegable 'tenant.config.manage' privilege as /api/tenant/config/update.
router.put('/api/qr/config', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'tenant.config.manage')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const { qrEnabled, qrRotationSeconds, qrRequireGps, qrRequireWifi, qrRequireFace, qrGeofenceRadiusMeters, qrRequireDeviceTrust } = req.body;

      if (qrEnabled === true && !(await isPlatformFeatureAllowedForTenant(req.user.tenantId, 'qr_attendance'))) {
        return res.status(403).json({ error: "QR Attendance is not included in your organization's plan. Contact your platform provider to enable it." });
      }

      const updates: any = {};
      if (qrEnabled !== undefined) updates.qrEnabled = !!qrEnabled;
      if (qrRotationSeconds !== undefined && (QR_ROTATION_OPTIONS as readonly number[]).includes(qrRotationSeconds)) updates.qrRotationSeconds = qrRotationSeconds;
      if (qrRequireGps !== undefined) updates.qrRequireGps = !!qrRequireGps;
      if (qrRequireWifi !== undefined) updates.qrRequireWifi = !!qrRequireWifi;
      if (qrRequireFace !== undefined) updates.qrRequireFace = !!qrRequireFace;
      if (qrGeofenceRadiusMeters !== undefined) updates.qrGeofenceRadiusMeters = qrGeofenceRadiusMeters === '' || qrGeofenceRadiusMeters === null ? null : parseInt(qrGeofenceRadiusMeters);
      if (qrRequireDeviceTrust !== undefined) updates.qrRequireDeviceTrust = !!qrRequireDeviceTrust;

      await db.update(schema.tenants).set(updates).where(eq(schema.tenants.id, req.user.tenantId));

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
