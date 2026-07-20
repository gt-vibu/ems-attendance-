import { Router } from 'express';
import crypto from 'crypto';
import { eq, and, desc, sql, inArray, gte, lte } from 'drizzle-orm';
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
import { dispatchWebhookEvent } from '../services/webhooks';
import { authLimiter } from '../middleware/rateLimit';
import { hasPrivilege, getEffectivePrivileges, getUsersWithPrivilege, getDefaultPrivilegesForRole } from '../auth/rbac';
import { issueNewSession, finalizeLogin } from '../auth/session';
import { logToAuditLedger } from '../services/audit';
import { callFaceService, cosineSimilarity, KYC_ACTIONS, DAILY_CHALLENGE_ACTIONS, pendingChallenges, CHALLENGE_TTL_MS, FACE_TOKEN_TTL, FACE_MATCH_THRESHOLD } from '../services/face';
import { haversineMeters, resolveActiveIp } from '../services/geo';
import { computeAttendancePercent, getHierarchyAlertRecipients } from '../services/attendanceStats';
import { getMonthlyWfhCheckInCount, getActiveHomeLocation } from '../services/wfhData';

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

  // STEP 1 of 3 — Face liveness/identity check. Verifies the capture burst
  // against the identity embeddings from KYC AND confirms every action in
  // the challenge issued above was actually performed (not just displayed
  // as an on-screen instruction). Does not write an attendance_logs row —
  // on success it mints a short-lived token the later steps/final submit
  // use instead of re-uploading images.
router.post('/api/attendance/verify-face', authenticate, async (req: any, res: any) => {
    try {
      const { images, mode } = req.body;
      if (!images || !Array.isArray(images) || images.length === 0) {
        return res.status(400).json({ error: 'images (a short camera burst) are required.' });
      }

      const usersList = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
      if (usersList.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      const user = usersList[0];
      if (!user.isKycCompleted) {
        return res.status(400).json({ error: 'KYC registration not completed yet.' });
      }

      if (mode === 'photo') {
        let faceResult: any;
        try {
          faceResult = await callFaceService('/verify', { images, challengeActions: [] });
        } catch (faceErr: any) {
          return res.status(503).json({ error: `Face verification service unavailable: ${faceErr.message}` });
        }

        const livenessScore = faceResult.faceDetected ? (faceResult.livenessScore ?? 0) : 0;
        const LIVENESS_MIN = 0.6;

        let bestSimilarity = -1;
        const enrolledEmbeddings = user.faceEmbeddings as number[][];
        if (faceResult.faceDetected && enrolledEmbeddings && enrolledEmbeddings.length > 0) {
          for (const enrolled of enrolledEmbeddings) {
            const sim = cosineSimilarity(enrolled, faceResult.embedding);
            if (sim > bestSimilarity) bestSimilarity = sim;
          }
        }

        const matchThreshold = FACE_MATCH_THRESHOLD;
        const identityEnrolled = !!(enrolledEmbeddings && enrolledEmbeddings.length > 0);

        const isLivenessConvincing = faceResult.faceDetected && livenessScore >= LIVENESS_MIN;
        const isIdentityMatched = faceResult.faceDetected && identityEnrolled && bestSimilarity >= matchThreshold;

        // Diagnostics-only screen-replay signal (see services/face-service's
        // moire_score()) — logged on every attempt, pass or fail, so its
        // distribution across real check-ins can be reviewed before it's
        // ever allowed to gate anything (same rollout as matchThreshold/
        // LIVENESS_MIN originally needed). Never affects `passed` today.
        const moireScore = typeof faceResult.moireScore === 'number' ? faceResult.moireScore : 0;
        console.log(`[verify-face] user=${user.id} moireScore=${moireScore.toFixed(3)} (diagnostics-only, not gating) liveness=${livenessScore.toFixed(3)} bestMatch=${bestSimilarity.toFixed(3)}`);

        if (isLivenessConvincing && isIdentityMatched) {
          const token = signShortLivedToken({
            purpose: 'attendance_face_pass',
            userId: user.id,
            faceMatchScore: bestSimilarity,
            livenessScore,
            challengeRequested: ['look_center'],
            challengeVerified: ['look_center']
          }, FACE_TOKEN_TTL);

          return res.json({ passed: true, token, faceMatchScore: bestSimilarity, livenessScore });
        }

        // If photo verification failed, return the fallback actions registered during KYC in sequential order
        let fallbackActions: string[] = [];
        if (user.kycActionLog && typeof user.kycActionLog === 'object') {
          const actionLog = user.kycActionLog as Record<string, any>;
          fallbackActions = DAILY_CHALLENGE_ACTIONS.filter(a => actionLog[a]?.verified === true);
        }

        if (fallbackActions.length === 0) {
          fallbackActions = [...DAILY_CHALLENGE_ACTIONS];
        }

        console.warn(`[verify-face] user=${user.id} photo check failed. Initiating fallback challenge with actions: ${fallbackActions.join(', ')}`);

        return res.status(403).json({
          passed: false,
          needsFallback: true,
          fallbackActions: fallbackActions,
          error: 'Initial photo check was not convincing (liveness or identity mismatch). Fallback verification required.',
          diagnostics: {
            faceDetected: faceResult.faceDetected,
            liveness: Number(livenessScore.toFixed(3)),
            livenessMin: LIVENESS_MIN,
            bestMatch: Number(bestSimilarity.toFixed(3)),
            matchMin: matchThreshold,
            moireScore: Number(moireScore.toFixed(3)), // diagnostics-only, does not affect pass/fail
          }
        });
      }

      const pending = pendingChallenges.get(user.id);
      if (!pending || Date.now() - pending.issuedAt > CHALLENGE_TTL_MS) {
        pendingChallenges.delete(user.id);
        return res.status(400).json({ error: 'Your liveness challenge expired. Please try again.', expired: true });
      }

      let faceResult: any;
      try {
        faceResult = await callFaceService('/verify', { images, challengeActions: pending.actions });
      } catch (faceErr: any) {
        return res.status(503).json({ error: `Face verification service unavailable: ${faceErr.message}` });
      }

      const errors: string[] = [];

      if (!faceResult.faceDetected) {
        errors.push('No face detected. Look directly at the camera with good lighting and try again.');
      }

      // Liveness: landmark micro-movement across the burst. A printed photo /
      // frozen replay scores near 0 (no movement) or ~0.3 (single usable
      // frame); a live person performing the guided actions produces large
      // movement and scores ~1.0. Threshold lowered from 0.8 to 0.6 so a
      // genuine person on a low-framerate device (e.g. a basic Redmi capturing
      // fewer distinct frames, hence smaller measured inter-frame movement)
      // isn't wrongly rejected — a static-photo spoof still lands well below
      // 0.6, and identity match below is the hard anti-impersonation gate
      // regardless.
      const livenessScore = faceResult.faceDetected ? (faceResult.livenessScore ?? 0) : 0;
      const LIVENESS_MIN = 0.6;
      if (faceResult.faceDetected && livenessScore < LIVENESS_MIN) {
        errors.push('Liveness verification failed (possible spoofing attempt).');
      }

      // Challenge-response: how many of the requested actions the face service
      // actually detected in the burst. Previously ALL had to be confirmed;
      // that made a single flaky detection (a blink whose closed-eye frame the
      // camera happened not to capture, a subtle head turn) fail the whole
      // check — exactly the fragility that shows up on cheaper cameras. Now we
      // require a MAJORITY (at least ceil(n/2), and always ≥1): still proves
      // the person is live and responding to on-screen prompts in real time (a
      // photo can perform none), while tolerating one missed detection.
      const confirmedActions = pending.actions.filter(a => faceResult.actionResults?.[a]);
      const unconfirmed = pending.actions.filter(a => !faceResult.actionResults?.[a]);
      const requiredConfirmed = Math.max(1, Math.ceil(pending.actions.length / 2));
      if (faceResult.faceDetected && confirmedActions.length < requiredConfirmed) {
        errors.push(`We couldn't confirm enough of the requested movements (${unconfirmed.map(a => a.replace('_', ' ')).join(', ')}). Please try again, following the on-screen instruction for each step.`);
      }

      let bestSimilarity = -1;
      const enrolledEmbeddings = user.faceEmbeddings as number[][];
      if (faceResult.faceDetected && enrolledEmbeddings && enrolledEmbeddings.length > 0) {
        for (const enrolled of enrolledEmbeddings) {
          const sim = cosineSimilarity(enrolled, faceResult.embedding);
          if (sim > bestSimilarity) bestSimilarity = sim;
        }
      }
      // Identity match — the hard anti-impersonation gate, deliberately NOT
      // relaxed. If enrollment is missing entirely (no embeddings), this stays
      // at -1 and fails, which is correct: you can't verify against nothing.
      const matchThreshold = FACE_MATCH_THRESHOLD;
      const identityEnrolled = !!(enrolledEmbeddings && enrolledEmbeddings.length > 0);
      if (faceResult.faceDetected && !identityEnrolled) {
        errors.push('No enrolled face on file — please complete (or redo) your biometric KYC before checking in.');
      } else if (faceResult.faceDetected && bestSimilarity < matchThreshold) {
        errors.push('Facial biometrics verification failed (identity mismatch).');
      }

      // Diagnostics-only screen-replay signal — see the photo-mode branch
      // above and services/face-service's moire_score() for why this is
      // logged on every attempt (pass or fail) but never gates anything yet.
      const moireScore = typeof faceResult.moireScore === 'number' ? faceResult.moireScore : 0;

      if (errors.length > 0) {
        // Log the full breakdown so a persistent "why does check-in keep
        // failing" can be diagnosed from the server side without guessing —
        // which specific gate failed, and by how much.
        console.warn(`[verify-face] user=${user.id} REJECTED — faceDetected=${faceResult.faceDetected} liveness=${livenessScore.toFixed(3)} (min ${LIVENESS_MIN}) confirmedActions=${confirmedActions.length}/${pending.actions.length} (need ${requiredConfirmed}) bestMatch=${bestSimilarity.toFixed(3)} (min ${matchThreshold}) moireScore=${moireScore.toFixed(3)} (diagnostics-only) framesWithFace=${faceResult.framesWithFace}/${faceResult.framesSubmitted}`);
        return res.status(403).json({
          passed: false,
          error: errors.join(' | '),
          diagnostics: {
            liveness: Number(livenessScore.toFixed(3)),
            livenessMin: LIVENESS_MIN,
            actionsConfirmed: confirmedActions.length,
            actionsRequested: pending.actions.length,
            bestMatch: Number(bestSimilarity.toFixed(3)),
            matchMin: matchThreshold,
            moireScore: Number(moireScore.toFixed(3)),
          },
        });
      }

      // Single-use: this specific challenge has now been satisfied.
      pendingChallenges.delete(user.id);
      console.log(`[verify-face] user=${user.id} PASSED (challenge mode) moireScore=${moireScore.toFixed(3)} (diagnostics-only, not gating) liveness=${livenessScore.toFixed(3)} bestMatch=${bestSimilarity.toFixed(3)}`);

      const token = signShortLivedToken({
        purpose: 'attendance_face_pass',
        userId: user.id,
        faceMatchScore: bestSimilarity,
        livenessScore,
        challengeRequested: pending.actions,
        challengeVerified: pending.actions.filter(a => faceResult.actionResults?.[a])
      }, FACE_TOKEN_TTL);

      res.json({ passed: true, token, faceMatchScore: bestSimilarity, livenessScore });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  function decodeFacePassToken(req: any): any {
    const decoded = verifyToken(req.body?.token);
    if (!decoded || decoded.purpose !== 'attendance_face_pass' || decoded.userId !== req.user.userId) {
      return null;
    }
    return decoded;
  }

  // STEP 2 of 3 — GPS geofence check (fast-fail preview only; the final
  // submit below re-validates this itself and is the only step that
  // actually records anything).
router.post('/api/attendance/verify-location', authenticate, async (req: any, res: any) => {
    try {
      const facePass = decodeFacePassToken(req);
      if (!facePass) {
        return res.status(400).json({ error: 'Face verification expired or missing. Please restart.', expired: true });
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
      const facePass = decodeFacePassToken(req);
      if (!facePass) {
        return res.status(400).json({ error: 'Face verification expired or missing. Please restart.', expired: true });
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

  router.post('/api/attendance/verify-action', authenticate, async (req: any, res: any) => {
    try {
      const { action, images } = req.body || {};
      if (!action || !DAILY_CHALLENGE_ACTIONS.includes(action)) {
        return res.status(400).json({ error: 'A valid attendance action is required.' });
      }
      if (!Array.isArray(images) || images.length === 0) {
        return res.status(400).json({ error: 'images are required.' });
      }

      const usersList = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
      if (usersList.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      const user = usersList[0];
      if (!user.isKycCompleted) {
        return res.status(400).json({ error: 'KYC registration not completed yet.' });
      }

      let faceResult: any;
      try {
        faceResult = await callFaceService('/verify', { images, challengeActions: [action] });
      } catch (faceErr: any) {
        return res.status(503).json({ error: `Face verification service unavailable: ${faceErr.message}` });
      }

      if (!faceResult.faceDetected) {
        return res.status(422).json({ passed: false, error: 'No face detected clearly enough. Please keep your face inside the frame and try again.' });
      }
      if (!faceResult.actionResults?.[action]) {
        return res.status(422).json({ passed: false, error: `We couldn't confirm ${action.replace('_', ' ')}. Please repeat that action more clearly.` });
      }

      let bestSimilarity = -1;
      const enrolledEmbeddings = user.faceEmbeddings as number[][];
      if (enrolledEmbeddings && enrolledEmbeddings.length > 0) {
        for (const enrolled of enrolledEmbeddings) {
          const sim = cosineSimilarity(enrolled, faceResult.embedding);
          if (sim > bestSimilarity) bestSimilarity = sim;
        }
      }
      const matchThreshold = FACE_MATCH_THRESHOLD;
      if (!enrolledEmbeddings || enrolledEmbeddings.length === 0 || bestSimilarity < matchThreshold) {
        return res.status(422).json({ passed: false, error: 'Face match was not strong enough for this action. Please face the camera directly and try again.' });
      }

      const token = signShortLivedToken({
        purpose: 'attendance_face_pass',
        userId: user.id,
        faceMatchScore: bestSimilarity,
        livenessScore: 1.0, // action completed successfully proves liveness
        challengeRequested: [action],
        challengeVerified: [action]
      }, FACE_TOKEN_TTL);

      res.json({
        passed: true,
        action,
        faceMatchScore: bestSimilarity,
        token,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // FINAL CHECK-IN SUBMIT — re-validates everything itself (face-pass
  // token, device pinning, clock drift, GPS geofence, Wi-Fi if enabled)
  // before writing the log. The verify-face/verify-location/verify-network
  // endpoints above are fast-fail UX previews only; nothing about pass/fail
  // is ever trusted from the client — this endpoint remains the sole
  // authoritative writer.
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
        return res.status(400).json({ error: 'KYC registration not completed yet.' });
      }

      // --- 0. Face-pass token: proves the Face step (identity + liveness +
      // challenge-response) already happened for THIS user, recently. It's
      // signed server-side and expires in minutes — nothing here trusts a
      // client-asserted "I passed the camera step". ---
      const facePass = verifyToken(token);
      if (!facePass || facePass.purpose !== 'attendance_face_pass' || facePass.userId !== user.id) {
        return res.status(400).json({ error: 'Face verification expired or missing. Please restart from the camera step.' });
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
        if (!wfhPolicy.wfhEnabled) {
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

      // --- 3. Face verification: identity match, liveness, and
      // challenge-response were already computed by /verify-face against
      // the raw camera burst; the signed token is what carries those
      // results here, authoritatively — nothing here is trusted from the
      // client beyond what the token itself asserts. ---
      const bestSimilarity: number = facePass.faceMatchScore;
      const livenessScore: number = facePass.livenessScore;

      const matchThreshold = FACE_MATCH_THRESHOLD;
      if (bestSimilarity < matchThreshold) {
        verificationErrors.push('Facial biometrics verification failed (Identity mismatch).');
        fraudType = 'FRAUD_BIOMETRICS_FAILED';
      }
      if (livenessScore < 0.6) {
        verificationErrors.push('Liveness verification failed (Possible spoofing attempt).');
        if (!fraudType) fraudType = 'FRAUD_LIVENESS_FAILED';
      }

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

      // --- 7. Check for Late Arrival on check-in ---
      let isLate = false;
      const shiftStartStr = tenant.shiftStart || '09:00';
      // WFH can be given its own, separate grace period; falls back to the
      // office gracePeriodMins when unset so tenants that never touch the
      // WFH policy get identical late-arrival behavior either way.
      const gracePeriod = (attendanceMode === 'wfh' && tenant.wfhLateLoginGraceMins != null)
        ? tenant.wfhLateLoginGraceMins
        : (tenant.gracePeriodMins || 15);

      if (isVerified && logType === 'check_in') {
        const [shiftHour, shiftMinute] = shiftStartStr.split(':').map(Number);
        const shiftTime = new Date();
        shiftTime.setHours(shiftHour, shiftMinute, 0, 0);
        const lateThresholdTime = new Date(shiftTime.getTime() + gracePeriod * 60000);

        if (Date.now() > lateThresholdTime.getTime()) {
          isLate = true;
        }
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
            : (isLate ? `Verified successfully (Late Arrival — pending manager approval)` : `Verified successfully (Biometric, GPS, and Wi-Fi context match)`))
        : verificationErrors.join(' | ');

      const log = await db.insert(schema.attendanceLogs).values({
        userId: user.id,
        tenantId: user.tenantId || 1,
        status: pendingApproval ? 'pending' : status,
        type: logType,
        clientTimestamp: clientTimestamp ? new Date(clientTimestamp) : new Date(),
        faceMatchScore: bestSimilarity,
        livenessScore: livenessScore,
        device: deviceId,
        locationLat: lat,
        locationLng: lng,
        reason: reason,
        explanation: (pendingApproval && isLate) ? explanation : null,
        challenge: { requested: facePass.challengeRequested || [], verified: facePass.challengeVerified || [] },
        attendanceMode,
        homeLat: attendanceMode === 'wfh' ? wfhHomeLocation.latitude : null,
        homeLng: attendanceMode === 'wfh' ? wfhHomeLocation.longitude : null,
        distanceFromHomeMeters: wfhDistanceMeters,
        wfhReason: attendanceMode === 'wfh' ? (wfhReason || null) : null,
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
          biometricSimilarity: bestSimilarity,
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
      // pending manager approval — notify whoever holds 'attendance.approve'.
      // The employee is not blocked in the meantime.
      if (pendingApproval) {
        const approvers = await getUsersWithPrivilege(user.tenantId || 1, 'attendance.approve');
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
