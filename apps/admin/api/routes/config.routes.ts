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


  // Get Tenant Config
router.get('/api/tenant/config', authenticate, async (req: any, res: any) => {
    try {
      const tenant = await db.select().from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId));
      if (tenant.length === 0) {
        return res.status(404).json({ error: 'Tenant config not found' });
      }
      res.json({ tenant: tenant[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update Tenant Config (Policy configuration — geofence, network, shift
  // timings, break budget, etc.). This is intentionally NOT gated by the
  // delegable 'settings.edit' privilege: policy-setting is a strategic
  // decision that only the tenant admin account itself can make. HR/GM/
  // Manager can still be granted 'settings.edit' to approve day-to-day
  // device-change requests (see /api/tenant/device-requests/action above),
  // but they can never change the underlying policies those approvals are
  // judged against.
router.post('/api/tenant/config/update', authenticate, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'tenant_admin') {
        return res.status(403).json({ error: 'Access denied: Only the tenant admin can change organization policies.' });
      }
      const {
        wifiSsid, officeIp, wifiCheckEnabled, lat, lng, radius, shiftStart, shiftEnd, gracePeriodMins, halfDayMins, dailyBreakBudgetMins, weekendConfig, minAttendancePercent,
        wfhEnabled, wfhAllowedRoles, wfhMaxDaysPerMonth, wfhAllowedWeekdays, wfhRadiusMeters, wfhApprovalRequired, wfhRequireReason, wfhLateLoginGraceMins,
      } = req.body;

      const updates: any = {};
      if (wifiSsid !== undefined) updates.wifiSsid = wifiSsid;
      if (officeIp !== undefined) updates.officeIp = officeIp;
      if (wifiCheckEnabled !== undefined) updates.wifiCheckEnabled = !!wifiCheckEnabled;
      if (lat !== undefined && lat !== '') updates.locationLat = parseFloat(lat);
      if (lng !== undefined && lng !== '') updates.locationLng = parseFloat(lng);
      if (radius !== undefined && radius !== '') updates.locationRadiusMeters = parseInt(radius);
      if (shiftStart !== undefined && shiftStart !== '') updates.shiftStart = shiftStart;
      if (shiftEnd !== undefined && shiftEnd !== '') updates.shiftEnd = shiftEnd;
      if (gracePeriodMins !== undefined && gracePeriodMins !== '') updates.gracePeriodMins = parseInt(gracePeriodMins);
      if (halfDayMins !== undefined && halfDayMins !== '') updates.halfDayMins = parseInt(halfDayMins);
      if (dailyBreakBudgetMins !== undefined && dailyBreakBudgetMins !== '') updates.dailyBreakBudgetMins = parseInt(dailyBreakBudgetMins);
      if (minAttendancePercent !== undefined && minAttendancePercent !== '') updates.minAttendancePercent = Math.min(100, Math.max(0, parseInt(minAttendancePercent)));
      if (Array.isArray(weekendConfig)) updates.weekendConfig = weekendConfig;

      // --- Work From Home (WFH) policy ---
      if (wfhEnabled !== undefined) updates.wfhEnabled = !!wfhEnabled;
      if (Array.isArray(wfhAllowedRoles)) updates.wfhAllowedRoles = wfhAllowedRoles;
      if (wfhMaxDaysPerMonth !== undefined) updates.wfhMaxDaysPerMonth = wfhMaxDaysPerMonth === '' || wfhMaxDaysPerMonth === null ? null : parseInt(wfhMaxDaysPerMonth);
      if (Array.isArray(wfhAllowedWeekdays)) updates.wfhAllowedWeekdays = wfhAllowedWeekdays;
      if (wfhRadiusMeters !== undefined && wfhRadiusMeters !== '') updates.wfhRadiusMeters = parseInt(wfhRadiusMeters);
      if (wfhApprovalRequired !== undefined) updates.wfhApprovalRequired = !!wfhApprovalRequired;
      if (wfhRequireReason !== undefined) updates.wfhRequireReason = !!wfhRequireReason;
      if (wfhLateLoginGraceMins !== undefined) updates.wfhLateLoginGraceMins = wfhLateLoginGraceMins === '' || wfhLateLoginGraceMins === null ? null : parseInt(wfhLateLoginGraceMins);

      await db.update(schema.tenants)
        .set(updates)
        .where(eq(schema.tenants.id, req.user.tenantId));

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
