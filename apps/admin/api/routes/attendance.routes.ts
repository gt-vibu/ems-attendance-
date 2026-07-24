import { Router } from 'express';
import crypto from 'crypto';
import { eq, and, desc, sql, inArray, gte, lte } from 'drizzle-orm';
import swaggerUi from 'swagger-ui-express';
import { OAuth2Client } from 'google-auth-library';
import { db, schema } from '../../db';
import { logger } from '../../logger';
import { openApiSpec } from '../../openapi.js';
import { verifyToken } from '../../jwt';
import { hashPassword, verifyPassword, isPasswordHashed } from '../../password.js';
import { sendEmail, sendPasswordResetEmail, sendAttendanceCorrectionEmail, sendBreakViolationAlert, sendManagerEscalationEmail, sendLateArrivalApprovalRequestEmail, sendLateArrivalDecisionEmail, sendLowAttendanceAlertEmail, sendBreakLocationViolationEmail, sendWfhApprovalRequestEmail, sendWfhDecisionEmail, sendWfhLocationChangeRequestEmail, sendWfhLocationChangeDecisionEmail } from '../../mail.js';
import { extractWfhPolicy, isRoleAllowedForWfh, haversineMeters as wfhHaversineMeters, evaluateWfhEligibility, evaluateWfhLocation, todayWeekdayName, WFH_PERMISSIONS } from '../../wfh.js';
import { reverseGeocode } from '../../geocoding.js';
import { extractQrPolicy, evaluateQrGeofence, evaluateQrScan, shouldRotateQrToken, QR_ROTATION_OPTIONS, QR_PERMISSIONS, QR_TOKEN_PURPOSE, QR_SCAN_PASS_PURPOSE } from '../../qr.js';
import { authenticate } from '../middleware/authenticate';
import { dispatchWebhookEvent } from '../services/webhooks';
import { authLimiter } from '../middleware/rateLimit';
import { hasPrivilege, getEffectivePrivileges, getUsersWithPrivilege, getDefaultPrivilegesForRole, isPlatformFeatureAllowed, getScopedBranchIds } from '../auth/rbac';
import { editAttendanceDay } from '../services/recordEdits';
import { raiseAttendanceAlert } from '../services/alerts';
import { issueNewSession, finalizeLogin } from '../auth/session';
import { logToAuditLedger } from '../services/audit';
import { IDENTITY_PASS_PURPOSE } from '../services/webauthn';
import { haversineMeters, resolveActiveIp } from '../services/geo';
import { computeAttendancePercent, getHierarchyAlertRecipients } from '../services/attendanceStats';
import { getMonthlyWfhCheckInCount, getActiveHomeLocation } from '../services/wfhData';
import { getEffectiveShift } from '../services/shiftOverrides';
import { resolveEffectivePolicy, computeLateness, computeExpectedCheckout, computeDayOutcome } from '../services/attendancePolicy';

export const router = Router();


  // Where is the employee in today's attendance cycle? Drives the frontend's
  // gating: hide/show the camera flow, Break Management, and the "already
  // completed" locked state. A 'pending' check-in (late arrival awaiting
  // manager review) still counts as checked_in — the employee isn't blocked
  // from working while it's under review.
router.get('/api/attendance/today', authenticate, async (req: any, res: any) => {
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const latest = await db.select()
        .from(schema.attendanceLogs)
        .where(
          and(
            eq(schema.attendanceLogs.userId, req.user.userId),
            sql`status IN ('approved', 'pending')`,
            sql`created_at >= ${todayStart}`
          )
        )
        .orderBy(desc(schema.attendanceLogs.id))
        .limit(1);

      if (latest.length === 0) {
        return res.json({ state: 'not_started', pending: false, log: null });
      }

      const log = latest[0];
      if (log.type === 'check_out') {
        return res.json({ state: 'checked_out', pending: false, log });
      }
      return res.json({ state: 'checked_in', pending: log.status === 'pending', log });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Self-service attendance percentage — this month so far, working days
  // only (weekends/holidays excluded). Feeds the "Attendance This Month"
  // stat on Employee Home; the same computeAttendancePercent() helper also
  // drives the daily low-attendance alert cron.
router.get('/api/attendance/percentage', authenticate, async (req: any, res: any) => {
    try {
      const tenantList = await db.select().from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId || 1));
      if (tenantList.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      const tenant = tenantList[0];
      const result = await computeAttendancePercent(req.user.userId, tenant);
      res.json({ ...result, threshold: tenant.minAttendancePercent ?? 75 });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Read-only attendance history for the logged-in user — deliberately
  // GET-only; there's no corresponding edit/PATCH route, which is what
  // actually enforces "no edit option" on past records.
router.get('/api/attendance/mine', authenticate, async (req: any, res: any) => {
    try {
      const year = Number(req.query.year);
      const month = Number(req.query.month);
      const hasMonthWindow = Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12;
      const baseFilter = eq(schema.attendanceLogs.userId, req.user.userId);
      const logs = hasMonthWindow
        ? await db.select()
          .from(schema.attendanceLogs)
          .where(and(
            baseFilter,
            gte(schema.attendanceLogs.createdAt, new Date(Date.UTC(year, month - 1, 1))),
            lte(schema.attendanceLogs.createdAt, new Date(Date.UTC(year, month, 1))),
          ))
          .orderBy(desc(schema.attendanceLogs.id))
        : await db.select()
          .from(schema.attendanceLogs)
          .where(baseFilter)
          .orderBy(desc(schema.attendanceLogs.id))
          .limit(Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30)));
      res.json({ logs });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // QUICK CHECKOUT — a deliberate simpler/faster alternative to running the
  // full face+GPS+Wi-Fi scan again for check-out. Trades weaker anti-fraud
  // guarantees on the exit side (no re-verification) for a one-tap flow;
  // check-in still goes through the full authoritative /api/attendance path.
router.post('/api/attendance/checkout', authenticate, async (req: any, res: any) => {
    try {
      const usersList = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
      if (usersList.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      const user = usersList[0];

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const lastActiveToday = await db.select()
        .from(schema.attendanceLogs)
        .where(
          and(
            eq(schema.attendanceLogs.userId, user.id),
            sql`status IN ('approved', 'pending')`,
            sql`created_at >= ${todayStart}`
          )
        )
        .orderBy(desc(schema.attendanceLogs.id))
        .limit(1);

      if (lastActiveToday.length === 0 || lastActiveToday[0].type !== 'check_in') {
        return res.status(400).json({
          error: lastActiveToday.length === 0
            ? 'You need to check in with Scan & Verify first.'
            : 'Attendance already completed for today.'
        });
      }

      const activeBreaks = await db.select().from(schema.breakSessions).where(
        and(
          eq(schema.breakSessions.userId, user.id),
          eq(schema.breakSessions.status, 'active')
        )
      );
      if (activeBreaks.length > 0) {
        return res.status(400).json({ error: "You're currently on break — resume work before checking out." });
      }

      const { clientTimestamp } = req.body;
      const log = await db.insert(schema.attendanceLogs).values({
        userId: user.id,
        tenantId: user.tenantId || 1,
        status: 'approved',
        type: 'check_out',
        clientTimestamp: clientTimestamp ? new Date(clientTimestamp) : new Date(),
        reason: 'Checked out (quick checkout)'
      }).returning();

      await logToAuditLedger({
        tenantId: user.tenantId,
        actorId: user.id,
        actorName: user.name,
        action: 'CHECK_OUT',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { logId: log[0].id, quickCheckout: true }
      });

      res.json({ success: true, log: log[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  function decodeIdentityPassToken(req: any): any {
    const decoded = verifyToken(req.body?.token);
    if (!decoded || decoded.purpose !== IDENTITY_PASS_PURPOSE || decoded.userId !== req.user.userId) {
      return null;
    }
    return decoded;
  }

  // STEP 2 of 3 — GPS geofence check (fast-fail preview only; the final
  // submit below re-validates this itself and is the only step that
  // actually records anything).
router.post('/api/attendance/verify-location', authenticate, async (req: any, res: any) => {
    try {
      const identityPass = decodeIdentityPassToken(req);
      if (!identityPass) {
        return res.status(400).json({ error: 'Device verification expired or missing. Please restart.', expired: true });
      }
      const { lat, lng } = req.body;
      if (lat === undefined || lng === undefined) {
        return res.status(400).json({ error: 'lat and lng are required.' });
      }

      const usersList = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
      if (usersList.length === 0) return res.status(404).json({ error: 'User not found' });
      const tenantList = await db.select().from(schema.tenants).where(eq(schema.tenants.id, usersList[0].tenantId));
      if (tenantList.length === 0) return res.status(404).json({ error: 'Tenant registration context not found.' });
      const tenant = tenantList[0];

      if (!tenant.locationLat || !tenant.locationLng) {
        return res.json({ passed: true, distanceMeters: 0 });
      }

      const distance = haversineMeters(lat, lng, tenant.locationLat, tenant.locationLng);
      const radius = tenant.locationRadiusMeters || 100;
      if (distance > radius) {
        return res.status(403).json({ passed: false, error: `GPS Geofence violation: Out of branch radius by ${Math.round(distance - radius)} meters.`, distanceMeters: distance });
      }
      res.json({ passed: true, distanceMeters: distance });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // STEP 3 of 3 — Wi-Fi/public-IP check. Only meaningful (and only shown by
  // the client) when the tenant admin has explicitly enabled it.
router.post('/api/attendance/verify-network', authenticate, async (req: any, res: any) => {
    try {
      const identityPass = decodeIdentityPassToken(req);
      if (!identityPass) {
        return res.status(400).json({ error: 'Device verification expired or missing. Please restart.', expired: true });
      }
      const { simulatedIp } = req.body;

      const usersList = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
      if (usersList.length === 0) return res.status(404).json({ error: 'User not found' });
      const tenantList = await db.select().from(schema.tenants).where(eq(schema.tenants.id, usersList[0].tenantId));
      if (tenantList.length === 0) return res.status(404).json({ error: 'Tenant registration context not found.' });
      const tenant = tenantList[0];

      if (!tenant.wifiCheckEnabled || !tenant.officeIp) {
        return res.json({ passed: true });
      }

      const activeIp = resolveActiveIp(req, simulatedIp);
      if (tenant.officeIp !== activeIp && tenant.officeIp !== '127.0.0.1') {
        return res.status(403).json({ passed: false, error: `Network verification failed: You must connect to the corporate Wi-Fi (Required Public IP: ${tenant.officeIp}, Your IP: ${activeIp}).` });
      }
      res.json({ passed: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // FINAL CHECK-IN SUBMIT — re-validates everything itself (identity-pass
  // token, device pinning, clock drift, GPS geofence, Wi-Fi if enabled)
  // before writing the log. The verify-location/verify-network endpoints
  // above are fast-fail UX previews only; nothing about pass/fail is ever
  // trusted from the client — this endpoint remains the sole authoritative
  // writer.
router.post('/api/attendance', authenticate, async (req: any, res: any) => {
    try {
      const { token, deviceId, lat, lng, simulatedIp, clientTimestamp, explanation, mode, wfhReason } = req.body;
      // Defaults to 'office' — omitting `mode` entirely (every pre-existing
      // client does) preserves the exact original behavior below unchanged.
      const attendanceMode: 'office' | 'wfh' = mode === 'wfh' ? 'wfh' : 'office';

      const usersList = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
      if (usersList.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      const user = usersList[0];

      if (!user.isKycCompleted) {
        return res.status(400).json({ error: 'Device registration not completed yet.' });
      }

      // --- 0. Identity-pass token: proves a WebAuthn signature challenge
      // (Windows Hello / Touch ID / Android biometric-or-PIN / security key)
      // was just satisfied by this user's registered device credential. It's
      // signed server-side and expires in minutes — nothing here trusts a
      // client-asserted "I passed the device check". ---
      const identityPass = verifyToken(token);
      if (!identityPass || identityPass.purpose !== IDENTITY_PASS_PURPOSE || identityPass.userId !== user.id) {
        return res.status(400).json({ error: 'Device verification expired or missing. Please restart and verify your device again.' });
      }

      // --- 1. Client-Server Clock Drift Check ---
      let clockDriftViolation = false;
      const serverTime = Date.now();
      if (clientTimestamp) {
        const clientTime = new Date(clientTimestamp).getTime();
        if (isNaN(clientTime) || Math.abs(serverTime - clientTime) > 5 * 60 * 1000) {
          clockDriftViolation = true;
        }
      }
      if (clockDriftViolation) {
        await logToAuditLedger({
          tenantId: user.tenantId,
          actorId: user.id,
          actorName: user.name,
          action: 'FRAUD_CLOCK_MANIPULATION',
          ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
          deviceInfo: req.headers['user-agent'] || '',
          details: { clientTimestamp, serverTimestamp: new Date().toISOString() }
        });

        // Get Tenant Admin to escalate
        const admins = await db.select().from(schema.users).where(
          and(
            eq(schema.users.tenantId, user.tenantId || 1),
            eq(schema.users.role, 'tenant_admin')
          )
        );
        if (admins.length > 0) {
          await sendManagerEscalationEmail(
            admins[0].email,
            admins[0].name,
            user.name,
            'Clock Manipulation Attempt',
            `${user.name} attempted to log attendance with a spoofed device time.\nClient Time: ${clientTimestamp}\nServer Time: ${new Date().toISOString()}`
          );
        }

        return res.status(400).json({ error: 'Verification failed: Device clock drift detected. Server timestamp enforcement active.' });
      }

      // --- 2. Device Pinning verification ---
      if (user.registeredDeviceId && user.registeredDeviceId !== deviceId) {
        await logToAuditLedger({
          tenantId: user.tenantId,
          actorId: user.id,
          actorName: user.name,
          action: 'FRAUD_DEVICE_MISMATCH',
          ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
          deviceInfo: req.headers['user-agent'] || '',
          details: { registeredDeviceId: user.registeredDeviceId, attemptedDeviceId: deviceId }
        });
        return res.status(403).json({ error: 'Access denied: Registered device mismatch.' });
      }

      // Fetch Tenant Rules
      const tenantList = await db.select().from(schema.tenants).where(eq(schema.tenants.id, user.tenantId));
      if (tenantList.length === 0) {
        return res.status(404).json({ error: 'Tenant registration context not found.' });
      }
      const tenant = tenantList[0];

      if (tenant.status === 'suspended') {
        return res.status(403).json({ error: 'Your organization\'s access has been suspended. Attendance cannot be logged.' });
      }

      // --- WFH-only policy gates, checked before verification so a
      // disallowed attempt never even reaches the biometric/location steps.
      // None of this runs (or changes anything) for attendanceMode==='office'. ---
      let wfhHomeLocation: any = null;
      if (attendanceMode === 'wfh') {
        const wfhPolicy = extractWfhPolicy(tenant);
        if (!wfhPolicy.wfhEnabled || !isPlatformFeatureAllowed(tenant, 'wfh')) {
          return res.status(403).json({ error: 'Work From Home is not enabled for your organization.' });
        }
        if (!isRoleAllowedForWfh(user.role, wfhPolicy)) {
          return res.status(403).json({ error: 'Your role is not permitted to work from home.' });
        }
        const weekday = todayWeekdayName();
        if (!wfhPolicy.wfhAllowedWeekdays.includes(weekday)) {
          return res.status(403).json({ error: `Work From Home is not allowed on ${weekday}s.` });
        }
        const monthlyWfhCount = await getMonthlyWfhCheckInCount(user.id);
        if (wfhPolicy.wfhMaxDaysPerMonth !== null && monthlyWfhCount >= wfhPolicy.wfhMaxDaysPerMonth) {
          return res.status(403).json({ error: `Monthly Work From Home quota (${wfhPolicy.wfhMaxDaysPerMonth} days) reached.` });
        }
        wfhHomeLocation = await getActiveHomeLocation(user.id);
        if (!wfhHomeLocation) {
          return res.status(400).json({ error: 'No home location registered yet. Please register your home location first.', needsHomeRegistration: true });
        }
        if (wfhPolicy.wfhRequireReason && !wfhReason) {
          return res.status(400).json({ error: 'Please provide a reason for working from home.', requiresWfhReason: true });
        }
      }

      let verificationErrors: string[] = [];
      let fraudType = '';
      let wfhDistanceMeters: number | null = null;

      // --- 3. Identity verification: the WebAuthn challenge-response
      // signature was already checked against the user's registered device
      // credential by /api/webauthn/authenticate/verify; the signed
      // identity-pass token above is what carries that result here — either
      // it decoded (signature checked out) or the request was already
      // rejected above. There's no similarity score to threshold-check
      // anymore: a WebAuthn signature is a binary cryptographic pass/fail. ---

      // --- 4. Location checking: office geofence vs. home-location distance
      // — mutually exclusive by mode. WFH never checks the office geofence;
      // office never checks a home location. ---
      if (attendanceMode === 'wfh') {
        const distanceCheck = evaluateWfhLocation({
          currentLat: lat,
          currentLng: lng,
          homeLat: wfhHomeLocation.latitude,
          homeLng: wfhHomeLocation.longitude,
          radiusMeters: extractWfhPolicy(tenant).wfhRadiusMeters,
        });
        wfhDistanceMeters = distanceCheck.distanceMeters;
        if (!distanceCheck.passed) {
          verificationErrors.push(distanceCheck.error!);
          if (!fraudType) fraudType = 'FRAUD_HOME_LOCATION_MISMATCH';
        }
      } else if (tenant.locationLat && tenant.locationLng) {
        const distance = haversineMeters(lat, lng, tenant.locationLat, tenant.locationLng);
        const radius = tenant.locationRadiusMeters || 100;
        if (distance > radius) {
          verificationErrors.push(`GPS Geofence violation: Out of branch radius by ${Math.round(distance - radius)} meters.`);
          if (!fraudType) fraudType = 'FRAUD_GEOFENCE_BYPASS';
        }
      }

      // --- 5. Wi-Fi IP Network context checking — office only (only if the
      // tenant admin has explicitly turned it on); doesn't apply to Work
      // From Home at all. ---
      if (attendanceMode === 'office' && tenant.wifiCheckEnabled && tenant.officeIp) {
        const activeIp = resolveActiveIp(req, simulatedIp);
        if (tenant.officeIp !== activeIp && tenant.officeIp !== '127.0.0.1') {
          verificationErrors.push(`Network verification failed: You must connect to the corporate Wi-Fi (Required Public IP: ${tenant.officeIp}, Your IP: ${activeIp}).`);
          if (!fraudType) fraudType = 'FRAUD_NETWORK_BYPASS';
        }
      }

      // --- 6. Determine check-in / check-out type ---
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // Includes 'pending' (a late check-in awaiting manager approval) so
      // the toggle and the day-lock below both see it as an active
      // check-in, not as if the day never started.
      const lastActiveToday = await db.select()
        .from(schema.attendanceLogs)
        .where(
          and(
            eq(schema.attendanceLogs.userId, user.id),
            sql`status IN ('approved', 'pending')`,
            sql`created_at >= ${todayStart}`
          )
        )
        .orderBy(desc(schema.attendanceLogs.id))
        .limit(1);

      // Single-shift-per-day lock: once today's check-out has been recorded,
      // no further attendance actions are accepted until the next day.
      if (lastActiveToday.length > 0 && lastActiveToday[0].type === 'check_out') {
        return res.status(400).json({ error: 'Attendance already completed for today. Come back tomorrow.', locked: true });
      }

      let logType = 'check_in';
      if (lastActiveToday.length > 0 && lastActiveToday[0].type === 'check_in') {
        logType = 'check_out';
      }

      const isVerified = verificationErrors.length === 0;
      const status = isVerified ? 'approved' : 'rejected';

      // --- 7. Check for Late Arrival on check-in — resolves the same
      // shift -> branch -> tenant chain the QR check-in flow already used
      // (previously this only ever consulted tenant-level shiftStart/
      // gracePeriodMins, silently ignoring any branch/shift override an
      // admin had configured). See services/attendancePolicy.ts. ---
      const branchRow = user.branchId
        ? (await db.select().from(schema.branches).where(eq(schema.branches.id, user.branchId)))[0] || null
        : null;
      const todayDateStr = new Date().toISOString().slice(0, 10);
      const effectiveShift = await getEffectiveShift(user.tenantId || 1, user.id, todayDateStr);
      const effectivePolicy = resolveEffectivePolicy(tenant, branchRow, effectiveShift);
      const shiftStartStr = effectivePolicy.shiftStartStr;
      // WFH can be given its own, separate grace period; falls back to the
      // resolved office grace period when unset so tenants that never touch
      // the WFH policy get identical late-arrival behavior either way. Only
      // meaningful under the 'buffered' arrival policy — flexible/strict
      // WFH check-ins follow the same arrival policy as office.
      const wfhPolicyOverride = (attendanceMode === 'wfh' && tenant.wfhLateLoginGraceMins != null)
        ? { ...effectivePolicy, gracePeriodMins: tenant.wfhLateLoginGraceMins }
        : effectivePolicy;

      let isLate = false;
      let lateByMinutes = 0;
      let expectedCheckoutAt: Date | null = null;
      if (isVerified && logType === 'check_in') {
        const lateness = computeLateness(wfhPolicyOverride, new Date());
        isLate = lateness.isLate;
        lateByMinutes = lateness.lateByMinutes;
        expectedCheckoutAt = computeExpectedCheckout(effectivePolicy, new Date());
      }

      // A late check-in needs the employee's explanation before it's
      // recorded at all — the frontend shows a one-time textarea and
      // resubmits here with everything it already has, plus `explanation`.
      if (isVerified && isLate && !explanation) {
        return res.status(400).json({
          error: 'Please explain why you are checking in late.',
          requiresExplanation: true
        });
      }

      // Late check-ins are written as 'pending' — a manager/admin with
      // 'attendance.approve' must approve or reject them (see
      // /api/tenant/attendance/*). The employee is NOT blocked from using
      // the app in the meantime; this only affects whether the log is
      // authoritative yet. WFH additionally goes pending whenever the
      // tenant's wfhApprovalRequired policy is on, regardless of lateness.
      const wfhNeedsApproval = attendanceMode === 'wfh' && logType === 'check_in' && tenant.wfhApprovalRequired !== false;
      const pendingApproval = isVerified && (isLate || wfhNeedsApproval);

      let reason = isVerified
        ? (attendanceMode === 'wfh'
            ? (pendingApproval ? 'Work From Home — pending manager approval' : 'Work From Home — verified successfully')
            : (isLate ? `Verified successfully (Late Arrival — pending manager approval)` : `Verified successfully (Device Identity, GPS, and Wi-Fi context match)`))
        : verificationErrors.join(' | ');

      // --- 8. Worked-minutes/half-day/short-day/overtime on check-out —
      // paired against today's matching check-in row (lastActiveToday[0],
      // since logType only becomes 'check_out' when that row exists and is
      // a check-in). See services/attendancePolicy.ts computeDayOutcome. ---
      let dayOutcome: { workedMinutes: number; isHalfDay: boolean; isShortDay: boolean; overtimeMinutes: number } | null = null;
      let checkoutAt: Date | null = null;
      if (isVerified && logType === 'check_out' && lastActiveToday.length > 0) {
        const checkInLog = lastActiveToday[0];
        const checkInAt = new Date(checkInLog.clientTimestamp || checkInLog.createdAt as any);
        checkoutAt = new Date();
        const todaysBreaks = await db.select().from(schema.breakSessions).where(
          and(eq(schema.breakSessions.userId, user.id), gte(schema.breakSessions.startTime, todayStart))
        );
        const breakMinutes = todaysBreaks.reduce((sum: number, b: any) => {
          if (!b.endTime) return sum;
          return sum + Math.max(0, (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / 60000);
        }, 0);
        dayOutcome = computeDayOutcome(effectivePolicy, checkInAt, checkoutAt, breakMinutes);
      }

      const log = await db.insert(schema.attendanceLogs).values({
        userId: user.id,
        tenantId: user.tenantId || 1,
        status: pendingApproval ? 'pending' : status,
        type: logType,
        clientTimestamp: clientTimestamp ? new Date(clientTimestamp) : new Date(),
        device: deviceId,
        locationLat: lat,
        locationLng: lng,
        reason: reason,
        explanation: (pendingApproval && isLate) ? explanation : null,
        attendanceMode,
        homeLat: attendanceMode === 'wfh' ? wfhHomeLocation.latitude : null,
        homeLng: attendanceMode === 'wfh' ? wfhHomeLocation.longitude : null,
        distanceFromHomeMeters: wfhDistanceMeters,
        wfhReason: attendanceMode === 'wfh' ? (wfhReason || null) : null,
        isLate: logType === 'check_in' ? isLate : null,
        lateByMinutes: logType === 'check_in' ? lateByMinutes : null,
        expectedCheckoutAt,
        checkoutAt,
        workedMinutes: dayOutcome?.workedMinutes ?? null,
        isHalfDay: dayOutcome?.isHalfDay ?? null,
        isShortDay: dayOutcome?.isShortDay ?? null,
        overtimeMinutes: dayOutcome?.overtimeMinutes ?? null,
      }).returning();

      // Log action to cryptographic ledger
      await logToAuditLedger({
        tenantId: user.tenantId,
        actorId: user.id,
        actorName: user.name,
        action: isVerified
          ? (attendanceMode === 'wfh'
              ? (logType === 'check_in' ? 'WFH_CHECK_IN' : 'WFH_CHECK_OUT')
              : (logType === 'check_in' ? 'CHECK_IN' : 'CHECK_OUT'))
          : fraudType,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: {
          logId: log[0].id,
          status: pendingApproval ? 'pending' : status,
          type: logType,
          attendanceMode,
          isLate,
          pendingApproval,
          distanceFromHomeMeters: wfhDistanceMeters,
          clientTimestamp,
          errors: verificationErrors
        }
      });

      if (!isVerified) {
        // Send manager escalation email for critical fraud events
        const admins = await db.select().from(schema.users).where(
          and(
            eq(schema.users.tenantId, user.tenantId || 1),
            eq(schema.users.role, 'tenant_admin')
          )
        );
        if (admins.length > 0) {
          await sendManagerEscalationEmail(
            admins[0].email,
            admins[0].name,
            user.name,
            fraudType || 'Attendance Verification Failed',
            `Employee ${user.name} failed attendance verification.\nReason: ${reason}\nIP Address: ${simulatedIp || req.socket.remoteAddress}`
          );
        }
        return res.status(403).json({ error: reason, log: log[0] });
      }

      // A late check-in or a WFH check-in (when approval is required) is
      // pending manager approval — notify whoever holds the matching
      // specific privilege (or the general legacy bucket). The employee is
      // not blocked in the meantime.
      if (pendingApproval) {
        const approvers = await getUsersWithPrivilege(user.tenantId || 1, attendanceMode === 'wfh'
          ? ['attendance.approve.wfh', 'attendance.approve']
          : ['attendance.approve.late_arrival', 'attendance.approve']);
        if (attendanceMode === 'wfh') {
          for (const approver of approvers) {
            await sendWfhApprovalRequestEmail(
              approver.email,
              approver.name,
              user.name,
              new Date().toLocaleDateString(),
              wfhReason || '',
              wfhDistanceMeters || 0
            );
          }
        } else {
          const checkInTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          for (const approver of approvers) {
            await sendLateArrivalApprovalRequestEmail(
              approver.email,
              approver.name,
              user.name,
              new Date().toLocaleDateString(),
              checkInTimeStr,
              shiftStartStr,
              explanation
            );
          }
        }
      }

      dispatchWebhookEvent(user.tenantId || 1, logType === 'check_in' ? 'attendance.checked_in' : 'attendance.checked_out', {
        userId: user.id,
        userName: user.name,
        logId: log[0].id,
        attendanceMode,
        status: pendingApproval ? 'pending' : status,
        timestamp: log[0].clientTimestamp,
      });

      res.json({ success: true, log: log[0], pendingApproval });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });


  // CONTINUOUS ATTENDANCE VALIDATION HEARTBEAT
router.post('/api/attendance/heartbeat', authenticate, async (req: any, res: any) => {
    try {
      const { lat, lng, simulatedIp, deviceId } = req.body;
      
      const userRec = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId)).limit(1);
      if (userRec.length === 0) return res.status(404).json({ error: 'User not found' });
      const user = userRec[0];

      const tenantRec = await db.select().from(schema.tenants).where(eq(schema.tenants.id, user.tenantId || 1)).limit(1);
      if (tenantRec.length === 0) return res.status(404).json({ error: 'Tenant not found' });
      const tenant = tenantRec[0];

      let warning = '';

      // Always remember the last GPS fix seen for this user today — the
      // 23:59 auto-checkout job uses this to guess whether someone who
      // forgot to check out is actually still on-premises, since it can't
      // reach a closed browser tab for a live read at that point.
      if (lat && lng) {
        await db.update(schema.users)
          .set({ lastHeartbeatLat: lat, lastHeartbeatLng: lng, lastHeartbeatAt: new Date() })
          .where(eq(schema.users.id, user.id));
      }

      // GPS Geofence Check
      if (lat && lng && tenant.locationLat && tenant.locationLng) {
        const distance = haversineMeters(lat, lng, tenant.locationLat, tenant.locationLng);
        const radius = tenant.locationRadiusMeters || 100;
        if (distance > radius) {
          warning = `Geofence exited by ${Math.round(distance - radius)}m.`;

          // "GPS out of company area during working hours" — distinct from
          // break_outside_geofence (which fires when trying to END a break
          // from off-site); this covers drifting outside the geofence while
          // still actively clocked in and NOT on a break. Rate-limited to
          // one open alert per 30 minutes per employee so a lingering drift
          // doesn't spam a new alert on every ~heartbeat tick.
          const activeBreak = await db.select().from(schema.breakSessions).where(
            and(eq(schema.breakSessions.userId, user.id), eq(schema.breakSessions.status, 'active'))
          ).limit(1);
          if (activeBreak.length === 0) {
            const recentWindow = new Date(Date.now() - 30 * 60 * 1000);
            const recentAlert = await db.select().from(schema.attendanceAlerts).where(
              and(
                eq(schema.attendanceAlerts.userId, user.id),
                eq(schema.attendanceAlerts.type, 'geofence_exit_working_hours'),
                eq(schema.attendanceAlerts.status, 'pending'),
                gte(schema.attendanceAlerts.createdAt, recentWindow),
              )
            ).limit(1);
            if (recentAlert.length === 0) {
              await raiseAttendanceAlert({
                tenantId: user.tenantId || 1,
                userId: user.id,
                type: 'geofence_exit_working_hours',
                message: `${user.name} is ${Math.round(distance - radius)}m outside the company geofence while clocked in (not on break).`,
              });
            }
          }
        }
      }

      // Wi-Fi / IP Check (only if the tenant admin has explicitly enabled it)
      if (tenant.wifiCheckEnabled && tenant.officeIp) {
        const activeIp = resolveActiveIp(req, simulatedIp);
        if (tenant.officeIp !== activeIp && tenant.officeIp !== '127.0.0.1') {
          warning = (warning ? warning + ' | ' : '') + 'Corporate Wi-Fi disconnected.';
        }
      }

      if (warning) {
        // Log to ledger
        await logToAuditLedger({
          tenantId: user.tenantId,
          actorId: user.id,
          actorName: user.name,
          action: 'GEOFENCE_EXITED',
          ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
          deviceInfo: req.headers['user-agent'] || '',
          details: { warning, lat, lng, simulatedIp }
        });
        
        // Return warning status to client
        return res.json({ success: true, status: 'warning', message: warning });
      }

      res.json({ success: true, status: 'ok' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Directly correct an already-finalized day's attendance — gated by the
  // delegable 'attendance.edit' privilege (distinct from 'attendance.approve',
  // which only covers the pending late-login/WFH queue). This is the
  // standalone version of what a ticket resolution does internally (see
  // tickets.routes.ts) — same underlying editAttendanceDay() call, so a fix
  // made directly and a fix made via resolving a ticket behave identically.
router.patch('/api/tenant/attendance/:userId/:date', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'attendance.edit')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const targetUserId = parseInt(req.params.userId, 10);
      const date = req.params.date;
      const { newStatus, checkInTime, checkOutTime, reason } = req.body || {};
      if (!['present', 'absent'].includes(newStatus)) {
        return res.status(400).json({ error: "newStatus must be 'present' or 'absent'." });
      }
      if (!reason || !String(reason).trim()) {
        return res.status(400).json({ error: 'reason is required — this becomes part of the permanent attendance record.' });
      }

      const targetRows = await db.select().from(schema.users).where(eq(schema.users.id, targetUserId)).limit(1);
      if (targetRows.length === 0 || targetRows[0].tenantId !== req.user.tenantId) {
        return res.status(404).json({ error: 'Employee not found.' });
      }
      const scopedBranchIds = await getScopedBranchIds(req.user);
      if (scopedBranchIds !== null && targetRows[0].branchId && !scopedBranchIds.includes(targetRows[0].branchId)) {
        return res.status(403).json({ error: "Access denied: You are not scoped to this employee's branch." });
      }

      const result = await editAttendanceDay({
        tenantId: req.user.tenantId,
        targetUserId,
        date,
        newStatus,
        checkInTime,
        checkOutTime,
        editedByUserId: req.user.userId,
        editedByName: req.user.name,
        reason: String(reason).trim(),
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
      });

      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
