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


  // Unified Login Endpoint
router.post('/api/auth/login', authLimiter, async (req: any, res: any) => {
    try {
      const { email, password, deviceId } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const usersList = await db.select().from(schema.users).where(eq(schema.users.email, email));
      if (usersList.length === 0) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const user = usersList[0];

      // Match password (temporary password check included). Supports bcrypt
      // hashes as well as legacy plaintext rows (auto-upgraded below).
      const matchedViaPassword = await verifyPassword(password, user.password);
      const matchedViaTemp = !matchedViaPassword && await verifyPassword(password, user.tempPassword);
      const isPasswordMatch = matchedViaPassword || matchedViaTemp;
      if (!isPasswordMatch) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Transparently upgrade any legacy plaintext password to a bcrypt hash
      // the moment it's used successfully, so plaintext never lingers longer
      // than one login.
      if (matchedViaPassword && !isPasswordHashed(user.password)) {
        await db.update(schema.users).set({ password: await hashPassword(password) }).where(eq(schema.users.id, user.id));
      }
      if (matchedViaTemp && user.tempPassword && !isPasswordHashed(user.tempPassword)) {
        await db.update(schema.users).set({ tempPassword: await hashPassword(password) }).where(eq(schema.users.id, user.id));
      }

      // Check if user must change password
      if (user.mustChangePassword) {
        const tempToken = signToken({ userId: user.id, email: user.email, tempReset: true });
        return res.json({ requirePasswordChange: true, tempToken });
      }

      const result = await finalizeLogin(user, deviceId);
      if (result.ok === false) return res.status(result.status).json(result.body);
      res.json({ token: result.token, user: result.user });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Password Reset Endpoint (Forces temporary password replacement)
router.post('/api/auth/reset-password', authLimiter, async (req: any, res: any) => {
    try {
      const { newPassword } = req.body;
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Reset token required' });
      }
      const token = authHeader.split(' ')[1];
      const decoded = verifyToken(token);
      if (!decoded || !decoded.tempReset) {
        return res.status(401).json({ error: 'Invalid or expired reset token' });
      }

      if (!newPassword || String(newPassword).length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
      }

      await db.update(schema.users)
        .set({
          password: await hashPassword(newPassword),
          tempPassword: null,
          mustChangePassword: false
        })
        .where(eq(schema.users.id, decoded.userId));

      const updatedUsers = await db.select().from(schema.users).where(eq(schema.users.id, decoded.userId));
      const user = updatedUsers[0];

      const tenantRec = user.tenantId
        ? await db.select().from(schema.tenants).where(eq(schema.tenants.id, user.tenantId))
        : [];
      const tenant = tenantRec[0] || null;

      // Return full JWT session — a successful password reset is itself
      // strong proof of identity, so it force-establishes a new session
      // rather than being blocked by the already-logged-in check.
      const sessionToken = await issueNewSession(user);

      res.json({
        token: sessionToken,
        user: {
          id: user.id, uid: user.uid, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId,
          isKycCompleted: user.isKycCompleted,
          kycEnabled: tenant ? tenant.kycEnabled !== false : true,
          branchSetupCompleted: tenant ? !!tenant.branchSetupCompleted : true,
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Self-service Forgot Password (distinct from the forced temp-password
  // flow above: no active session/tempReset token required, entry point is
  // an emailed link instead of a login attempt). Always responds with the
  // same generic message regardless of whether the email matched an
  // account, so this endpoint can't be used to enumerate registered emails.
router.post('/api/auth/forgot-password', authLimiter, async (req: any, res: any) => {
    const genericResponse = { message: 'If an account exists for that email, a password reset link has been sent.' };
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'Email is required' });

      const usersList = await db.select().from(schema.users).where(eq(schema.users.email, email));
      if (usersList.length > 0) {
        const user = usersList[0];
        const resetToken = signShortLivedToken({ userId: user.id, purpose: 'password_reset' }, '45m');
        const resetLink = `${process.env.APP_BASE_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;
        try {
          await sendPasswordResetEmail(user.email, user.name, resetLink);
        } catch (mailErr) {
          console.error('[forgot-password] Failed to send reset email:', mailErr);
        }
      }

      res.json(genericResponse);
    } catch (err: any) {
      // Never leak whether the account existed, even on unexpected errors.
      console.error('[forgot-password] error:', err);
      res.json(genericResponse);
    }
  });

  // Confirms a self-service password reset. The token's 'purpose' claim
  // keeps this cryptographically distinct from the tempReset tokens the
  // forced-reset flow above uses, even though both are signed by the same
  // signShortLivedToken/verifyToken pair.
router.post('/api/auth/forgot-password/confirm', authLimiter, async (req: any, res: any) => {
    try {
      const { token, newPassword } = req.body;
      if (!token) return res.status(401).json({ error: 'Reset token is required' });

      const decoded = verifyToken(token);
      if (!decoded || decoded.purpose !== 'password_reset') {
        return res.status(401).json({ error: 'Invalid or expired reset link. Please request a new one.' });
      }

      if (!newPassword || String(newPassword).length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
      }

      await db.update(schema.users)
        .set({
          password: await hashPassword(newPassword),
          tempPassword: null,
          mustChangePassword: false
        })
        .where(eq(schema.users.id, decoded.userId));

      res.json({ message: 'Password updated. You can now sign in.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Google Sign-In — verifies the Google ID token server-side and logs in
  // an EXISTING account matched by email only. No auto-provisioning: a
  // Google email with no matching account is rejected, since accounts here
  // are created by an admin, not self-service.
router.post('/api/auth/google', authLimiter, async (req: any, res: any) => {
    try {
      const { credential, deviceId } = req.body;
      if (!credential) return res.status(400).json({ error: 'Google credential is required' });
      if (!process.env.GOOGLE_CLIENT_ID) {
        return res.status(500).json({ error: 'Google Sign-In is not configured on this server.' });
      }

      const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
      let payload;
      try {
        const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
        payload = ticket.getPayload();
      } catch {
        return res.status(401).json({ error: 'Invalid Google credential' });
      }

      if (!payload?.email || !payload.email_verified) {
        return res.status(401).json({ error: 'Google account email is not verified' });
      }

      const usersList = await db.select().from(schema.users).where(eq(schema.users.email, payload.email));
      if (usersList.length === 0) {
        return res.status(401).json({ error: 'No account found for this Google email. Contact your administrator to be added.' });
      }

      // Google already verified this person's control of the email address,
      // so unlike password login there's no password/mustChangePassword gate
      // to satisfy here — go straight to the shared session-issuing tail.
      const result = await finalizeLogin(usersList[0], deviceId);
      if (result.ok === false) return res.status(result.status).json(result.body);
      res.json({ token: result.token, user: result.user });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Clears the server-side session record so the just-used token (and any
  // other token for this user) stops passing authenticate's sid check
  // immediately, instead of remaining valid for the rest of its 24h life.
router.post('/api/auth/logout', authenticate, async (req: any, res: any) => {
    try {
      await db.update(schema.users)
        .set({ activeSessionId: null, sessionExpiresAt: null })
        .where(eq(schema.users.id, req.user.userId));
      res.json({ message: 'Logged out.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
