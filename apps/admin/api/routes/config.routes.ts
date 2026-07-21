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
import { hasPrivilege, getEffectivePrivileges, getUsersWithPrivilege, getDefaultPrivilegesForRole, isPlatformFeatureAllowed } from '../auth/rbac';
import { issueNewSession, finalizeLogin } from '../auth/session';
import { logToAuditLedger } from '../services/audit';
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
  // timings, break budget, etc.). Gated by the delegable 'tenant.config.manage'
  // privilege (distinct from 'settings.edit', which only covers approving
  // day-to-day device-change requests) — tenant_admin holds it implicitly,
  // and may choose to delegate it to a trusted role.
router.post('/api/tenant/config/update', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'tenant.config.manage')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const {
        wifiSsid, officeIp, wifiCheckEnabled, lat, lng, radius, shiftStart, shiftEnd, gracePeriodMins, halfDayMins, dailyBreakBudgetMins, weekendConfig, minAttendancePercent,
        wfhEnabled, wfhAllowedRoles, wfhMaxDaysPerMonth, wfhAllowedWeekdays, wfhRadiusMeters, wfhApprovalRequired, wfhRequireReason, wfhLateLoginGraceMins,
        kycEnabled, documentsEnabled, passwordExpiryDays, idleTimeoutMinutes, attendanceRetentionMonths,
      } = req.body;

      // Platform layer: a tenant admin can only turn a module ON if the
      // super admin's plan for this tenant allows it at all — turning it
      // OFF is always allowed regardless (never block someone from
      // disabling something). See isPlatformFeatureAllowed() in rbac.ts.
      const tenantRow = (await db.select({ featuresAllowed: schema.tenants.featuresAllowed }).from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId)).limit(1))[0];
      const modulesToggledOn: Array<[boolean | undefined, string, string]> = [
        [kycEnabled, 'kyc', 'Device Identity Check'],
        [documentsEnabled, 'documents', 'Document Storage'],
        [wifiCheckEnabled, 'wifi_lock', 'Corporate Wi-Fi IP Security'],
        [wfhEnabled, 'wfh', 'Work From Home'],
      ];
      for (const [turningOn, platformKey, label] of modulesToggledOn) {
        if (turningOn === true && !isPlatformFeatureAllowed(tenantRow as any, platformKey)) {
          return res.status(403).json({ error: `${label} is not included in your organization's plan. Contact your platform provider to enable it.` });
        }
      }

      const updates: any = {};
      // Company-wide switch: when off, no employee at this tenant needs
      // device identity verification to check in — GPS-within-radius becomes
      // the sole gate. Independent of QR attendance's own qrRequireFace toggle.
      if (kycEnabled !== undefined) updates.kycEnabled = !!kycEnabled;
      if (documentsEnabled !== undefined) updates.documentsEnabled = !!documentsEnabled;
      // 0 disables each — same "0/null means off" convention as wfhMaxDaysPerMonth.
      if (passwordExpiryDays !== undefined && passwordExpiryDays !== '') updates.passwordExpiryDays = Math.max(0, parseInt(passwordExpiryDays));
      if (idleTimeoutMinutes !== undefined && idleTimeoutMinutes !== '') updates.idleTimeoutMinutes = Math.max(0, parseInt(idleTimeoutMinutes));
      if (attendanceRetentionMonths !== undefined && attendanceRetentionMonths !== '') updates.attendanceRetentionMonths = Math.max(0, parseInt(attendanceRetentionMonths));
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

  // Company Policy announcement — deliberately a narrow, separate endpoint
  // rather than reusing GET /api/tenant/config above: that route returns the
  // whole tenant row (WiFi SSID, office IP, GPS geofence coordinates), which
  // is fine for admin-only config screens but shouldn't be something every
  // employee's browser fetches just to read a policy banner.
  router.get('/api/tenant/policy', authenticate, async (req: any, res: any) => {
    try {
      const [tenant] = await db.select({
        policyAnnouncement: schema.tenants.policyAnnouncement,
        policyAnnouncementUpdatedAt: schema.tenants.policyAnnouncementUpdatedAt,
      }).from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId)).limit(1);
      res.json(tenant || { policyAnnouncement: null, policyAnnouncementUpdatedAt: null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/api/tenant/policy', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'tenant.policy.manage')) {
        return res.status(403).json({ error: 'Access denied.' });
      }
      const { policyAnnouncement } = req.body || {};
      const text = typeof policyAnnouncement === 'string' ? policyAnnouncement.trim() : '';
      await db.update(schema.tenants)
        .set({ policyAnnouncement: text || null, policyAnnouncementUpdatedAt: new Date() })
        .where(eq(schema.tenants.id, req.user.tenantId));
      res.json({ success: true, policyAnnouncement: text || null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
