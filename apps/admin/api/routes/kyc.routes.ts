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
import { hasPrivilege, getEffectivePrivileges, getUsersWithPrivilege, getDefaultPrivilegesForRole } from '../auth/rbac';
import { issueNewSession, finalizeLogin } from '../auth/session';
import { logToAuditLedger } from '../services/audit';
import { callFaceService, cosineSimilarity, KYC_ACTIONS, DAILY_CHALLENGE_ACTIONS, pendingChallenges, CHALLENGE_TTL_MS, FACE_TOKEN_TTL } from '../services/face';
import { haversineMeters, resolveActiveIp } from '../services/geo';
import { computeAttendancePercent, getHierarchyAlertRecipients } from '../services/attendanceStats';

export const router = Router();


  // KYC FACE ENROLLMENT: guided per-action capture (look_center, turn_left,
  // turn_right, look_up, look_down, smile, open_mouth, blink). Each action
  // must actually be detected in its own burst — this is the same
  // pose/EAR/MAR geometry the daily challenge is verified against, so
  // enrollment can't be satisfied by 8 copies of the same neutral frame.
router.post('/api/kyc', authenticate, async (req: any, res: any) => {
    try {
      const { actions, deviceId } = req.body;
      if (!actions || typeof actions !== 'object' || !deviceId) {
        return res.status(400).json({ error: 'actions (a burst of photos per guided pose) and deviceId are required' });
      }

      const missing = KYC_ACTIONS.filter(a => !Array.isArray(actions[a]) || actions[a].length === 0);
      if (missing.length > 0) {
        return res.status(400).json({ error: `Missing capture for: ${missing.join(', ')}`, missingActions: missing });
      }

      // SECURITY: always enroll biometrics for the authenticated caller
      // (req.user, derived from the verified JWT) — never for a uid taken
      // from the request body. Trusting a client-supplied uid here would let
      // any logged-in user overwrite another employee's face embeddings and
      // registered device, i.e. impersonate them at every future check-in.
      const usersList = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
      if (usersList.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      const user = usersList[0];

      // All actual face detection/embedding/pose extraction happens in the
      // Python face service — this Node process never runs an ML model
      // itself. See services/face-service/README.md.
      let enrollResult: any;
      try {
        enrollResult = await callFaceService('/enroll', { actions });
      } catch (faceErr: any) {
        return res.status(503).json({ error: `Face verification service unavailable: ${faceErr.message}` });
      }

      if (Array.isArray(enrollResult.failedActions) && enrollResult.failedActions.length > 0) {
        return res.status(422).json({
          error: `We couldn't confirm: ${enrollResult.failedActions.join(', ')}. Please redo ${enrollResult.failedActions.length === 1 ? 'that step' : 'those steps'} with good lighting, looking directly at the camera.`,
          failedActions: enrollResult.failedActions
        });
      }

      await db.update(schema.users)
        .set({
          faceEmbeddings: enrollResult.embeddings,
          kycActionLog: enrollResult.actionLog,
          registeredDeviceId: deviceId,
          isKycCompleted: true,
          deviceApprovalPending: false
        })
        .where(eq(schema.users.id, user.id));

      // Return fresh token with updated KYC status
      const updatedUser = {
        id: user.id,
        uid: user.uid,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        isKycCompleted: true
      };
      const token = signToken(updatedUser);

      res.json({ success: true, token, user: updatedUser });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Liveness Verification Challenge Endpoint — issues a fresh random subset
  // of actions AND remembers it server-side (keyed by user) so /verify-face
  // below has something authoritative to check the capture burst against.
router.get('/api/attendance/challenge', authenticate, (req: any, res: any) => {
    const temp = [...DAILY_CHALLENGE_ACTIONS];
    const selected: string[] = [];
    for (let i = 0; i < 3; i++) {
      const idx = Math.floor(Math.random() * temp.length);
      selected.push(temp.splice(idx, 1)[0]);
    }
    pendingChallenges.set(req.user.userId, { actions: selected, issuedAt: Date.now() });
    res.json({ challenge: selected });
  });
