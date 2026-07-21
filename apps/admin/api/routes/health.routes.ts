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
import { haversineMeters, resolveActiveIp } from '../services/geo';
import { computeAttendancePercent, getHierarchyAlertRecipients } from '../services/attendanceStats';

export const router = Router();

  // API Health check (liveness — fast, no dependencies).
router.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness probe that actually touches Postgres. Two jobs: (1) the
  // keep-alive pinger hits this so a free-tier managed DB (e.g. Neon) doesn't
  // suspend from inactivity, and (2) it confirms the app can reach its
  // datastore. Returns 503 if the DB is unreachable so uptime monitors notice.
router.get('/api/health/db', async (_req, res) => {
    try {
      await db.execute(sql`SELECT 1`);
      res.json({ status: 'ok', db: 'up' });
    } catch (err: any) {
      res.status(503).json({ status: 'degraded', db: 'down', error: err?.message });
    }
  });

  // API documentation for external/partner integrations — raw spec plus an
  // interactive Swagger UI. Public (no auth) by design, same as any API
  // reference; the endpoints it documents are still bearer-token-protected
  // individually.
router.get('/api/openapi.json', (req, res) => {
    res.json(openApiSpec);
  });
router.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
    customSiteTitle: 'Smart Teams API Docs',
  }));
