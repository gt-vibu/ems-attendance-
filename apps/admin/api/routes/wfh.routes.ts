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
import { getMonthlyWfhCheckInCount, getActiveHomeLocation } from '../services/wfhData';

export const router = Router();


  // ==========================================================
  // WORK FROM HOME (WFH) — additive attendance mode. The actual check-in/
  // check-out write for WFH goes through the SAME /api/attendance handler
  // above (via body.mode === 'wfh') so it reuses face verification, clock-
  // drift checks, device pinning, and audit logging unchanged rather than
  // forking a parallel, less-audited write path. The routes below only
  // cover what's genuinely new: policy eligibility, home-location
  // registration, and the location-change approval workflow.
  // ==========================================================

  // Pre-flight check the frontend calls before offering the WFH option /
  // starting the camera step — does NOT require a GPS fix.
router.get('/api/attendance/wfh/eligibility', authenticate, async (req: any, res: any) => {
    try {
      const userRec = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
      if (userRec.length === 0) return res.status(404).json({ error: 'User not found' });
      const user = userRec[0];

      const tenantRec = await db.select().from(schema.tenants).where(eq(schema.tenants.id, user.tenantId || 1));
      if (tenantRec.length === 0) return res.status(404).json({ error: 'Tenant registration context not found.' });
      const policy = extractWfhPolicy(tenantRec[0]);

      const homeLocation = await getActiveHomeLocation(user.id);
      const wfhCheckInsThisMonth = await getMonthlyWfhCheckInCount(user.id);

      const result = evaluateWfhEligibility({
        policy,
        role: user.role,
        hasHomeLocation: !!homeLocation,
        isKycCompleted: !!user.isKycCompleted,
        wfhCheckInsThisMonth,
      });

      res.json({
        ...result,
        policy: {
          radiusMeters: policy.wfhRadiusMeters,
          requireReason: policy.wfhRequireReason,
          allowedWeekdays: policy.wfhAllowedWeekdays,
          maxDaysPerMonth: policy.wfhMaxDaysPerMonth,
          wfhCheckInsThisMonth,
        },
        homeLocation: homeLocation ? { latitude: homeLocation.latitude, longitude: homeLocation.longitude, address: homeLocation.address } : null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

router.get('/api/attendance/wfh/home-location', authenticate, async (req: any, res: any) => {
    try {
      const homeLocation = await getActiveHomeLocation(req.user.userId);
      res.json({ homeLocation });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // First-time home location registration. Only allowed if the employee has
  // no active registration yet — after that, changes go through the
  // request/approval workflow below so employees can't silently relocate
  // their "home" whenever convenient.
router.post('/api/attendance/wfh/register-home', authenticate, async (req: any, res: any) => {
    try {
      const { lat, lng, accuracy } = req.body;
      if (lat === undefined || lng === undefined) {
        return res.status(400).json({ error: 'lat and lng are required.' });
      }

      const userRec = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
      if (userRec.length === 0) return res.status(404).json({ error: 'User not found' });
      const user = userRec[0];

      const existing = await getActiveHomeLocation(user.id);
      if (existing) {
        return res.status(400).json({ error: 'A home location is already registered. Submit a location change request instead.' });
      }

      const geocoded = await reverseGeocode(lat, lng);

      const inserted = await db.insert(schema.employeeHomeLocations).values({
        userId: user.id,
        tenantId: user.tenantId || 1,
        latitude: lat,
        longitude: lng,
        accuracy,
        address: geocoded?.address || null,
        status: 'active',
      }).returning();

      await logToAuditLedger({
        tenantId: user.tenantId,
        actorId: user.id,
        actorName: user.name,
        action: 'WFH_HOME_REGISTERED',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { homeLocationId: inserted[0].id, lat, lng, accuracy }
      });

      res.json({ homeLocation: inserted[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Employee-initiated request to change their registered home location —
  // does NOT change anything until a manager/admin approves it below.
router.post('/api/attendance/wfh/location-change-request', authenticate, async (req: any, res: any) => {
    try {
      const { lat, lng, accuracy, reason } = req.body;
      if (lat === undefined || lng === undefined) {
        return res.status(400).json({ error: 'lat and lng are required.' });
      }

      const userRec = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
      if (userRec.length === 0) return res.status(404).json({ error: 'User not found' });
      const user = userRec[0];

      const geocoded = await reverseGeocode(lat, lng);

      const inserted = await db.insert(schema.wfhLocationChangeRequests).values({
        userId: user.id,
        tenantId: user.tenantId || 1,
        newLatitude: lat,
        newLongitude: lng,
        newAccuracy: accuracy,
        newAddress: geocoded?.address || null,
        reason,
        status: 'pending',
      }).returning();

      await logToAuditLedger({
        tenantId: user.tenantId,
        actorId: user.id,
        actorName: user.name,
        action: 'WFH_LOCATION_CHANGE_REQUESTED',
        details: { requestId: inserted[0].id, lat, lng }
      });

      const approvers = await getUsersWithPrivilege(user.tenantId || 1, 'attendance.approve');
      for (const approver of approvers) {
        await sendWfhLocationChangeRequestEmail(approver.email, approver.name, user.name, geocoded?.address || `${lat}, ${lng}`, reason || '');
      }

      res.json({ request: inserted[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

router.get('/api/attendance/wfh/location-change-requests/mine', authenticate, async (req: any, res: any) => {
    try {
      const list = await db.select().from(schema.wfhLocationChangeRequests)
        .where(eq(schema.wfhLocationChangeRequests.userId, req.user.userId))
        .orderBy(desc(schema.wfhLocationChangeRequests.createdAt));
      res.json({ requests: list });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Approver's queue — same authorization convention as
  // /api/tenant/corrections and /api/tenant/attendance/pending above.
router.get('/api/tenant/wfh/location-change-requests', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'attendance.approve')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const list = await db.select().from(schema.wfhLocationChangeRequests)
        .where(
          and(
            eq(schema.wfhLocationChangeRequests.tenantId, req.user.tenantId),
            eq(schema.wfhLocationChangeRequests.status, 'pending')
          )
        )
        .orderBy(desc(schema.wfhLocationChangeRequests.createdAt));

      const withNames = await Promise.all(list.map(async (r: any) => {
        const u = await db.select().from(schema.users).where(eq(schema.users.id, r.userId));
        return { ...r, userName: u[0]?.name || 'Unknown', userRole: u[0]?.role || '' };
      }));

      res.json({ requests: withNames });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

router.post('/api/tenant/wfh/location-change-requests/action', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'attendance.approve')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const { requestId, action } = req.body; // 'approve' | 'reject'
      if (!requestId || !['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'requestId and a valid action (approve|reject) are required' });
      }

      const list = await db.select().from(schema.wfhLocationChangeRequests).where(eq(schema.wfhLocationChangeRequests.id, requestId));
      if (list.length === 0) return res.status(404).json({ error: 'Request not found' });
      const changeRequest = list[0];

      if (changeRequest.tenantId !== req.user.tenantId) {
        return res.status(403).json({ error: 'Access denied: This request does not belong to your organization.' });
      }
      if (changeRequest.status !== 'pending') {
        return res.status(400).json({ error: 'This request has already been resolved.' });
      }

      await db.update(schema.wfhLocationChangeRequests)
        .set({ status: action === 'approve' ? 'approved' : 'rejected', reviewedByUserId: req.user.userId, reviewedAt: new Date() })
        .where(eq(schema.wfhLocationChangeRequests.id, requestId));

      if (action === 'approve') {
        const existing = await getActiveHomeLocation(changeRequest.userId);
        if (existing) {
          await db.update(schema.employeeHomeLocations).set({ status: 'superseded' }).where(eq(schema.employeeHomeLocations.id, existing.id));
        }
        await db.insert(schema.employeeHomeLocations).values({
          userId: changeRequest.userId,
          tenantId: changeRequest.tenantId,
          latitude: changeRequest.newLatitude,
          longitude: changeRequest.newLongitude,
          accuracy: changeRequest.newAccuracy,
          address: changeRequest.newAddress,
          status: 'active',
        });
      }

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: action === 'approve' ? 'WFH_LOCATION_CHANGE_APPROVED' : 'WFH_LOCATION_CHANGE_REJECTED',
        details: { requestId, subjectUserId: changeRequest.userId }
      });

      const employeeList = await db.select().from(schema.users).where(eq(schema.users.id, changeRequest.userId));
      if (employeeList[0]) {
        await sendWfhLocationChangeDecisionEmail(employeeList[0].email, employeeList[0].name, action === 'approve' ? 'approved' : 'rejected');
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Dashboard/report widgets — reuses 'reports.view', the same privilege
  // already gating the audit ledger view.
router.get('/api/tenant/wfh/stats', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'reports.view')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const tenantId = req.user.tenantId;
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const last30 = new Date();
      last30.setDate(last30.getDate() - 30);

      const allLogsRecent = await db.select().from(schema.attendanceLogs).where(
        and(
          eq(schema.attendanceLogs.tenantId, tenantId),
          eq(schema.attendanceLogs.type, 'check_in'),
          sql`status IN ('approved', 'pending')`,
          sql`created_at >= ${last30}`
        )
      );

      const todayWfhCount = allLogsRecent.filter((l: any) => l.attendanceMode === 'wfh' && new Date(l.createdAt) >= todayStart).length;
      const monthlyWfhCount = allLogsRecent.filter((l: any) => l.attendanceMode === 'wfh' && new Date(l.createdAt) >= monthStart).length;
      const officeCount30d = allLogsRecent.filter((l: any) => l.attendanceMode !== 'wfh').length;
      const wfhCount30d = allLogsRecent.filter((l: any) => l.attendanceMode === 'wfh').length;

      const pendingWfh = await db.select().from(schema.attendanceLogs).where(
        and(
          eq(schema.attendanceLogs.tenantId, tenantId),
          eq(schema.attendanceLogs.attendanceMode, 'wfh'),
          eq(schema.attendanceLogs.status, 'pending')
        )
      );
      const pendingLocationRequests = await db.select().from(schema.wfhLocationChangeRequests).where(
        and(
          eq(schema.wfhLocationChangeRequests.tenantId, tenantId),
          eq(schema.wfhLocationChangeRequests.status, 'pending')
        )
      );

      // Role-wise breakdown of this month's WFH check-ins (no per-employee
      // department field exists in this schema, so role is the finest
      // dimension available to break this down by).
      const wfhThisMonthLogs = allLogsRecent.filter((l: any) => l.attendanceMode === 'wfh' && new Date(l.createdAt) >= monthStart);
      const roleWiseCounts: Record<string, number> = {};
      const wfhUserIds = [...new Set(wfhThisMonthLogs.map((l: any) => l.userId as number))] as number[];
      const wfhUsers = wfhUserIds.length > 0
        ? await db.select().from(schema.users).where(inArray(schema.users.id, wfhUserIds))
        : [];
      const wfhUserRoleById = new Map<number, string>(wfhUsers.map((u: any) => [u.id, u.role]));
      for (const log of wfhThisMonthLogs) {
        const role: string = wfhUserRoleById.get(log.userId) || 'unknown';
        roleWiseCounts[role] = (roleWiseCounts[role] || 0) + 1;
      }

      res.json({
        todayWfhCount,
        monthlyWfhCount,
        pendingWfhApprovals: pendingWfh.length,
        pendingLocationChangeRequests: pendingLocationRequests.length,
        officeVsWfh30d: { office: officeCount30d, wfh: wfhCount30d },
        roleWiseWfhThisMonth: roleWiseCounts,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Per-employee, per-day WFH ledger — unlike /api/tenant/wfh/stats above
  // (aggregate counts only), this returns the actual rows: who worked from
  // home, on what day, with what status/reason/distance-from-home. Feeds
  // the admin WFH Ledger tab's DataTable (client-side search/sort/paginate
  // over this capped list — same convention as QR history/logs below).
  // Delegable independent of role via WFH_PERMISSIONS.VIEW_LOGS, same
  // pattern as QR_PERMISSIONS.VIEW_LOGS.
router.get('/api/tenant/wfh/ledger', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, WFH_PERMISSIONS.VIEW_LOGS)) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const tenantId = req.user.tenantId;
      const last90 = new Date();
      last90.setDate(last90.getDate() - 90);

      const logs = await db.select().from(schema.attendanceLogs)
        .where(
          and(
            eq(schema.attendanceLogs.tenantId, tenantId),
            eq(schema.attendanceLogs.attendanceMode, 'wfh'),
            eq(schema.attendanceLogs.type, 'check_in'),
            sql`created_at >= ${last90}`
          )
        )
        .orderBy(desc(schema.attendanceLogs.createdAt))
        .limit(500);

      const userIds = [...new Set(logs.map((l: any) => l.userId as number))] as number[];
      const users = userIds.length > 0
        ? await db.select().from(schema.users).where(inArray(schema.users.id, userIds))
        : [];
      const userById = new Map<number, any>(users.map((u: any) => [u.id, u]));

      const ledger = logs.map((l: any) => {
        const u = userById.get(l.userId);
        return {
          id: l.id,
          userId: l.userId,
          userName: u?.name || 'Unknown',
          role: u?.role || 'unknown',
          date: l.createdAt,
          checkInTime: l.createdAt,
          status: l.status,
          wfhReason: l.wfhReason || '',
          distanceFromHomeMeters: l.distanceFromHomeMeters,
        };
      });

      res.json({ ledger });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Narrow, additive capability mirroring /api/tenant/users/:id/qr-access
  // exactly (see that route's comment for the full rationale) — a separate
  // endpoint rather than editing the working QR one, scoped to exactly the
  // WFH_PERMISSIONS values, so an already-hired employee can be granted WFH
  // ledger visibility without disturbing any other privilege they hold.
router.post('/api/tenant/users/:id/wfh-access', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'employee.create')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const targetId = parseInt(req.params.id, 10);
      const { permissions } = req.body; // string[] — the full desired set of WFH permissions that should be ON
      if (!Array.isArray(permissions)) {
        return res.status(400).json({ error: 'permissions (array) is required' });
      }
      const wfhPermissionValues: string[] = Object.values(WFH_PERMISSIONS);
      const requested = permissions.filter((p: string) => wfhPermissionValues.includes(p));

      const requesterPrivileges = await getEffectivePrivileges(req.user);
      const grantable = requesterPrivileges === 'ALL' ? requested : requested.filter((p: string) => requesterPrivileges.includes(p));

      const targetList = await db.select().from(schema.users).where(eq(schema.users.id, targetId));
      if (targetList.length === 0) return res.status(404).json({ error: 'User not found' });
      const target = targetList[0];
      if (target.tenantId !== req.user.tenantId) {
        return res.status(403).json({ error: 'Access denied: This user does not belong to your organization.' });
      }

      const existingPrivileges: string[] = Array.isArray(target.privileges) ? (target.privileges as string[]) : [];
      const withoutWfh = existingPrivileges.filter((p: string) => !wfhPermissionValues.includes(p));
      const finalPrivileges = Array.from(new Set([...withoutWfh, ...grantable]));

      await db.update(schema.users).set({ privileges: finalPrivileges }).where(eq(schema.users.id, targetId));

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'WFH_ACCESS_UPDATED',
        details: { subjectUserId: targetId, permissions: grantable }
      });

      res.json({ success: true, privileges: finalPrivileges });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
