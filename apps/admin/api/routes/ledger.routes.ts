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


  // IMMUTABLE AUDIT LEDGER ENDPOINTS
router.get('/api/tenant/ledger', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'reports.view')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }

      const ledger = await db.select()
        .from(schema.auditLedger)
        .where(eq(schema.auditLedger.tenantId, req.user.tenantId || 1))
        .orderBy(desc(schema.auditLedger.timestamp));

      res.json({ ledger });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

router.post('/api/tenant/ledger/verify', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'reports.view')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }

      const logs = await db.select()
        .from(schema.auditLedger)
        .where(eq(schema.auditLedger.tenantId, req.user.tenantId || 1))
        .orderBy(schema.auditLedger.id);

      let prevHash = 'GENESIS';
      let isValid = true;
      const invalidBlocks: number[] = [];

      for (const block of logs) {
        const detailsStr = block.details ? JSON.stringify(block.details) : '';
        const rawPayload = `${prevHash}|${new Date(block.timestamp).toISOString()}|${block.action}|${block.actorName}|${detailsStr}`;
        const expectedHash = crypto.createHash('sha256').update(rawPayload).digest('hex');

        if (expectedHash !== block.hash) {
          isValid = false;
          invalidBlocks.push(block.id);
        }
        prevHash = block.hash;
      }

      res.json({ isValid, invalidBlocks, verifiedBlocksCount: logs.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
