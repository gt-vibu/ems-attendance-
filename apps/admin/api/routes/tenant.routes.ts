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


  // TENANT ADMIN API: Today's live attendance snapshot + monthly summary for
  // the tenant's own dashboard.
router.get('/api/tenant/analytics', authenticate, async (req: any, res: any) => {
    try {
      const tenantId = req.user.tenantId;
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const staff = await db.select().from(schema.users).where(
        and(eq(schema.users.tenantId, tenantId), sql`role != 'tenant_admin'`)
      );

      const todaysLogs = await db.select().from(schema.attendanceLogs).where(
        and(eq(schema.attendanceLogs.tenantId, tenantId), sql`created_at >= ${todayStart}`)
      );

      const checkedInToday = new Set(
        todaysLogs.filter((l: any) => l.type === 'check_in' && l.status === 'approved').map((l: any) => l.userId)
      );
      const lateToday = todaysLogs.filter((l: any) =>
        l.type === 'check_in' && l.status === 'approved' && (l.reason || '').includes('Late Arrival')
      ).length;
      const rejectedToday = todaysLogs.filter((l: any) => l.status === 'rejected').length;

      const monthlyLogs = await db.select().from(schema.attendanceLogs).where(
        and(eq(schema.attendanceLogs.tenantId, tenantId), sql`created_at >= ${monthStart}`)
      );

      // Per-person drill-down lists behind the stat cards. The scalar counts
      // above stay open to any logged-in tenant user (as before), but the
      // named lists are more sensitive, so only include them for callers who
      // can already see people-level reporting (reports.view) or the
      // directory (employee.read). Everyone else just gets the numbers.
      let breakdown: any = undefined;
      if (await hasPrivilege(req.user, 'reports.view') || await hasPrivilege(req.user, 'employee.read')) {
        const userById = new Map<number, any>(staff.map((u: any) => [u.id, u]));
        const nameOf = (id: number) => userById.get(id)?.name || 'Unknown';
        const roleOf = (id: number) => userById.get(id)?.role || 'unknown';

        const checkInRows = todaysLogs.filter((l: any) => l.type === 'check_in' && l.status === 'approved');
        const present = checkInRows.map((l: any) => ({
          userId: l.userId, name: nameOf(l.userId), role: roleOf(l.userId),
          checkInTime: l.createdAt, attendanceMode: l.attendanceMode, status: l.status,
        }));
        const late = checkInRows
          .filter((l: any) => (l.reason || '').includes('Late Arrival'))
          .map((l: any) => ({
            userId: l.userId, name: nameOf(l.userId), role: roleOf(l.userId),
            checkInTime: l.createdAt, attendanceMode: l.attendanceMode, status: l.status,
          }));
        const rejected = todaysLogs.filter((l: any) => l.status === 'rejected').map((l: any) => ({
          userId: l.userId, name: nameOf(l.userId), role: roleOf(l.userId),
          checkInTime: l.createdAt, attendanceMode: l.attendanceMode, status: l.status,
        }));
        const absent = staff.filter((u: any) => !checkedInToday.has(u.id)).map((u: any) => ({
          userId: u.id, name: u.name, role: u.role,
        }));
        const total = staff.map((u: any) => ({
          userId: u.id, name: u.name, role: u.role,
          isKycCompleted: !!u.isKycCompleted,
        }));
        breakdown = { total, present, absent, late, rejected };
      }

      res.json({
        totalStaff: staff.length,
        presentToday: checkedInToday.size,
        absentToday: Math.max(0, staff.length - checkedInToday.size),
        lateToday,
        rejectedToday,
        monthlyCheckIns: monthlyLogs.filter((l: any) => l.type === 'check_in' && l.status === 'approved').length,
        monthlyRejections: monthlyLogs.filter((l: any) => l.status === 'rejected').length,
        staffByRole: staff.reduce((acc: Record<string, number>, u: any) => {
          const r = u.role || 'employee';
          acc[r] = (acc[r] || 0) + 1;
          return acc;
        }, {}),
        breakdown,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // TENANT ADMIN API: Hire/Recruit Employees & Managers
router.post('/api/tenant/users/create', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'employee.create')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }

      const { email, name, role, privileges } = req.body;
      if (!email || !name || !role) {
        return res.status(400).json({ error: 'Email, name, and role are required' });
      }

      // SECURITY: this endpoint is for hiring ordinary staff. Without this
      // check, a tenant admin (or anyone calling the API directly) could set
      // role: 'super_admin' or 'tenant_admin' here and grant an account
      // unrestricted or cross-tenant access. Those two roles are only ever
      // created by the super admin's own onboarding flow (/api/super/approve).
      const normalizedRole = String(role).trim().toLowerCase();
      if (normalizedRole === 'super_admin' || normalizedRole === 'tenant_admin' || normalizedRole === 'superadmin') {
        return res.status(403).json({ error: 'This role cannot be assigned here.' });
      }

      // Check if user already exists
      const existing = await db.select().from(schema.users).where(eq(schema.users.email, email));
      if (existing.length > 0) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      const tempPassword = 'temp_' + crypto.randomBytes(6).toString('hex');
      const userUid = crypto.randomUUID();

      // PRECEDENCE OF POWER: whoever is onboarding this person can only pass
      // down privileges they themselves actually hold right now — an HR/GM
      // granted just 'employee.create' cannot turn around and grant a new
      // hire 'settings.edit' or 'reports.view' unless they have that
      // themselves. Only the tenant admin (unrestricted) can grant anything.
      // This keeps authority strictly non-increasing as it's delegated
      // further down the org, however many layers deep.
      const requesterPrivileges = await getEffectivePrivileges(req.user);
      const requestedExtra = Array.isArray(privileges) ? privileges : [];
      const grantablePrivileges = requesterPrivileges === 'ALL'
        ? requestedExtra
        : requestedExtra.filter((p: string) => requesterPrivileges.includes(p));

      // Merge the role's baseline privileges with any extra (grantable)
      // privileges the requester explicitly toggled on, rather than letting
      // a truthy-but-empty array silently wipe out the role defaults
      // (`[] || x` is `[]`, not `x`, in JS — that was the previous bug here).
      const finalPrivileges = Array.from(new Set([
        ...getDefaultPrivilegesForRole(role),
        ...grantablePrivileges
      ]));

      await db.insert(schema.users).values({
        uid: userUid,
        email,
        name,
        password: '',
        tempPassword: await hashPassword(tempPassword),
        role,
        privileges: finalPrivileges,
        mustChangePassword: true,
        tenantId: req.user.tenantId
      });

      // Send credential email
      const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
      const activationLink = `${baseUrl}/login?email=${encodeURIComponent(email)}&temp=${tempPassword}`;
      await sendEmail({
        to: email,
        subject: `Smart Teams Invitation - Registered as ${role}`,
        text: `Hello ${name},\n\nYou have been registered on Smart Teams as a ${role}.\n\nYour credentials:\nUsername: ${email}\nTemporary Password: ${tempPassword}\n\nLogin and set your password here: ${activationLink}\n\nBest Regards,\nSmart Teams Team`,
        html: `<h3>Hello ${name},</h3><p>You have been registered on Smart Teams as a <strong>${role}</strong>.</p><p><strong>Your credentials:</strong><br/>Username: <code>${email}</code><br/>Temporary Password: <code>${tempPassword}</code></p><p><a href="${activationLink}" style="display:inline-block;background:#FF3D8A;color:white;padding:10px 20px;text-decoration:none;border-radius:20px;font-weight:bold;">Set Your Password</a></p><br/><p>Best Regards,<br/>Smart Teams Team</p>`
      });

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'EMPLOYEE_CREATED',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { email, name, role }
      });

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'INVITATION_SENT',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { email, activationLink }
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get users for Tenant Admin
router.get('/api/tenant/users', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'employee.read') && !await hasPrivilege(req.user, 'employee.create')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const usersList = await db.select().from(schema.users)
        .where(eq(schema.users.tenantId, req.user.tenantId))
        .orderBy(desc(schema.users.createdAt));
      
      res.json({ users: usersList });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Narrow, additive capability: grant/revoke ONLY the QR Attendance
  // permission strings for an EXISTING user, without disturbing any other
  // privilege they already hold. There is no general "edit an existing
  // user's privileges" endpoint in this app today — privileges are
  // otherwise set once, at hire time, via /api/tenant/users/create — and
  // building a full privilege editor is out of scope here. This is
  // deliberately scoped to exactly the 5 QR_PERMISSIONS values so an
  // already-hired employee ("...or whoever") can be granted QR
  // display/generate access too, not just brand-new hires.
router.post('/api/tenant/users/:id/qr-access', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'employee.create')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const targetId = parseInt(req.params.id, 10);
      const { permissions } = req.body; // string[] — the full desired set of QR permissions that should be ON
      if (!Array.isArray(permissions)) {
        return res.status(400).json({ error: 'permissions (array) is required' });
      }
      const qrPermissionValues: string[] = Object.values(QR_PERMISSIONS);
      const requested = permissions.filter((p: string) => qrPermissionValues.includes(p));

      // Same "precedence of power" rule as hiring (server.ts /api/tenant/users/create):
      // can't grant a QR permission the requester doesn't themselves effectively hold.
      const requesterPrivileges = await getEffectivePrivileges(req.user);
      const grantable = requesterPrivileges === 'ALL' ? requested : requested.filter((p: string) => requesterPrivileges.includes(p));

      const targetList = await db.select().from(schema.users).where(eq(schema.users.id, targetId));
      if (targetList.length === 0) return res.status(404).json({ error: 'User not found' });
      const target = targetList[0];
      if (target.tenantId !== req.user.tenantId) {
        return res.status(403).json({ error: 'Access denied: This user does not belong to your organization.' });
      }

      const existingPrivileges: string[] = Array.isArray(target.privileges) ? (target.privileges as string[]) : [];
      const withoutQr = existingPrivileges.filter((p: string) => !qrPermissionValues.includes(p));
      const finalPrivileges = Array.from(new Set([...withoutQr, ...grantable]));

      await db.update(schema.users).set({ privileges: finalPrivileges }).where(eq(schema.users.id, targetId));

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'QR_ACCESS_UPDATED',
        details: { subjectUserId: targetId, permissions: grantable }
      });

      res.json({ success: true, privileges: finalPrivileges });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get notifications for Tenant Admin
router.get('/api/tenant/notifications', authenticate, async (req: any, res: any) => {
    try {
      const notifyList = await db.select().from(schema.notifications)
        .where(eq(schema.notifications.userId, req.user.tenantId))
        .orderBy(desc(schema.notifications.createdAt));
      res.json({ notifications: notifyList });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // TENANT ADMIN API: Get & Approve Device Change Requests
router.get('/api/tenant/device-requests', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'settings.edit')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const requests = await db.select({
        id: schema.deviceChangeRequests.id,
        status: schema.deviceChangeRequests.status,
        oldDeviceId: schema.deviceChangeRequests.oldDeviceId,
        newDeviceId: schema.deviceChangeRequests.newDeviceId,
        createdAt: schema.deviceChangeRequests.createdAt,
        userName: schema.users.name,
        userEmail: schema.users.email,
        userId: schema.users.id
      })
      .from(schema.deviceChangeRequests)
      .innerJoin(schema.users, eq(schema.deviceChangeRequests.userId, schema.users.id))
      .where(
        and(
          eq(schema.deviceChangeRequests.tenantId, req.user.tenantId),
          eq(schema.deviceChangeRequests.status, 'pending')
        )
      )
      .orderBy(desc(schema.deviceChangeRequests.createdAt));

      res.json({ requests });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

router.post('/api/tenant/device-requests/action', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'settings.edit')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const { requestId, action } = req.body; // action: 'approve' | 'reject'
      
      const reqList = await db.select().from(schema.deviceChangeRequests).where(eq(schema.deviceChangeRequests.id, requestId));
      if (reqList.length === 0) {
        return res.status(404).json({ error: 'Request not found' });
      }
      const deviceReq = reqList[0];

      // SECURITY: enforce tenant isolation — without this check, any tenant
      // admin/HR/GM could approve or reject a device-change request
      // belonging to a completely different tenant just by guessing an ID.
      if (deviceReq.tenantId !== req.user.tenantId) {
        return res.status(403).json({ error: 'Access denied: This request does not belong to your organization.' });
      }

      if (action === 'approve') {
        // Update user device ID
        await db.update(schema.users)
          .set({
            registeredDeviceId: deviceReq.newDeviceId,
            deviceApprovalPending: false
          })
          .where(eq(schema.users.id, deviceReq.userId));

        await db.update(schema.deviceChangeRequests)
          .set({ status: 'approved' })
          .where(eq(schema.deviceChangeRequests.id, requestId));
      } else {
        await db.update(schema.users)
          .set({ deviceApprovalPending: false })
          .where(eq(schema.users.id, deviceReq.userId));

        await db.update(schema.deviceChangeRequests)
          .set({ status: 'rejected' })
          .where(eq(schema.deviceChangeRequests.id, requestId));
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
