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


  // Tenancy Request Endpoint (Public onboarding submission)
router.post('/api/tenancy/request', authLimiter, async (req, res) => {
    try {
      const { companyName, email, numEmployees, plan } = req.body;
      if (!companyName || !email || !numEmployees || !plan) {
        return res.status(400).json({ error: 'All fields are required' });
      }

      const request = await db.insert(schema.tenancyRequests).values({
        companyName,
        email,
        numEmployees: parseInt(numEmployees),
        plan,
        status: 'pending'
      }).returning();

      // Create notification for Super Admin
      await db.insert(schema.notifications).values({
        userId: null, // Null represents super admin
        title: 'New Tenancy Request',
        message: `${companyName} requested access for the ${plan} Plan (${numEmployees} employees).`
      });

      // Send simulated confirmation email
      await sendEmail({
        to: email,
        subject: 'Smart Teams Tenancy Request Received',
        text: `Hello ${companyName},\n\nWe have received your request to join Smart Teams under the ${plan} Plan. Our Super Admin will review your application and onboard you shortly.\n\nBest Regards,\nSmart Teams Team`,
        html: `<h3>Hello ${companyName},</h3><p>We have received your request to join Smart Teams under the <strong>${plan} Plan</strong>. Our Super Admin will review your application and onboard you shortly.</p><br/><p>Best Regards,<br/>Smart Teams Team</p>`
      });

      res.json({ success: true, request: request[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // SUPER ADMIN API: Get Requests & Notifications
router.get('/api/super/requests', authenticate, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Access denied' });
      }
      const requests = await db.select().from(schema.tenancyRequests).orderBy(desc(schema.tenancyRequests.createdAt));
      res.json({ requests });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

router.get('/api/super/notifications', authenticate, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Access denied' });
      }
      const notifyList = await db.select().from(schema.notifications).where(sql`user_id IS NULL`).orderBy(desc(schema.notifications.createdAt));
      res.json({ notifications: notifyList });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // SUPER ADMIN API: Approve Tenancy & Onboard Tenant
router.post('/api/super/approve', authenticate, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Access denied' });
      }
      const { requestId, featuresAllowed, plan } = req.body;
      
      const reqDetails = await db.select().from(schema.tenancyRequests).where(eq(schema.tenancyRequests.id, requestId));
      if (reqDetails.length === 0) {
        return res.status(404).json({ error: 'Request not found' });
      }
      const request = reqDetails[0];

      // Check if email already registered in users
      const existingUser = await db.select().from(schema.users).where(eq(schema.users.email, request.email));
      if (existingUser.length > 0) {
        return res.status(400).json({ error: 'Admin email is already in use' });
      }

      // Generate credentials
      const adminUid = crypto.randomUUID();
      const tempPassword = 'temp_' + crypto.randomBytes(6).toString('hex');

      // Create Tenant
      const tenant = await db.insert(schema.tenants).values({
        name: request.companyName,
        adminUid,
        plan: plan || request.plan,
        featuresAllowed: featuresAllowed || ['kyc', 'wifi_lock', 'gps_geofence']
      }).returning();

      // Create Tenant Admin User. The plaintext tempPassword is only ever
      // used for the one-time activation email below; the stored value is
      // always a bcrypt hash.
      await db.insert(schema.users).values({
        uid: adminUid,
        email: request.email,
        password: '', // blank initially, relies on tempPassword
        tempPassword: await hashPassword(tempPassword),
        name: `${request.companyName} Admin`,
        role: 'tenant_admin',
        mustChangePassword: true,
        tenantId: tenant[0].id
      });

      // Update tenancy request status
      await db.update(schema.tenancyRequests)
        .set({ status: 'approved' })
        .where(eq(schema.tenancyRequests.id, requestId));

      // Send credentials mail with redirection link
      const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
      const activationLink = `${baseUrl}/login?email=${encodeURIComponent(request.email)}&temp=${tempPassword}`;
      
      await sendEmail({
        to: request.email,
        subject: 'Welcome to Smart Teams - Access Granted',
        text: `Hello ${request.companyName} Admin,\n\nYour tenancy has been approved by the Super Admin under the ${tenant[0].plan} plan.\n\nYour credentials:\nUsername: ${request.email}\nTemporary Password: ${userCredentialsTemplate(tempPassword)}\n\nLogin and set your permanent password here: ${activationLink}\n\nBest Regards,\nSmart Teams Onboarding`,
        html: `<h3>Hello ${request.companyName} Admin,</h3><p>Your tenancy has been approved by the Super Admin under the <strong>${tenant[0].plan} plan</strong>.</p><p><strong>Your credentials:</strong><br/>Username: <code>${request.email}</code><br/>Temporary Password: <code>${tempPassword}</code></p><p><a href="${activationLink}" style="display:inline-block;background:#7B5CFA;color:white;padding:10px 20px;text-decoration:none;border-radius:20px;font-weight:bold;">Activate Your Account</a></p><br/><p>Best Regards,<br/>Smart Teams Onboarding</p>`
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Helper formatting for email text
  function userCredentialsTemplate(p: string) {
    return p;
  }

  // SUPER ADMIN API: List all tenants (with live employee counts) for the
  // "manage tenants" view — suspend/reactivate, review plan & features.
router.get('/api/super/tenants', authenticate, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Access denied' });
      }
      const tenantsList = await db.select().from(schema.tenants).orderBy(desc(schema.tenants.createdAt));

      const withCounts = await Promise.all(tenantsList.map(async (t: any) => {
        const employees = await db.select().from(schema.users).where(eq(schema.users.tenantId, t.id));
        return { ...t, employeeCount: employees.length };
      }));

      res.json({ tenants: withCounts });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // SUPER ADMIN API: Suspend or reactivate a tenant. Suspending immediately
  // blocks that tenant's users from logging in or logging attendance —
  // enforced in /api/auth/login and /api/attendance below.
router.post('/api/super/tenants/status', authenticate, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Access denied' });
      }
      const { tenantId, status } = req.body;
      if (!tenantId || !['active', 'suspended'].includes(status)) {
        return res.status(400).json({ error: 'tenantId and a valid status (active|suspended) are required' });
      }

      const tenantList = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
      if (tenantList.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      await db.update(schema.tenants).set({ status }).where(eq(schema.tenants.id, tenantId));

      await logToAuditLedger({
        tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: status === 'suspended' ? 'TENANT_SUSPENDED' : 'TENANT_REACTIVATED',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { tenantName: tenantList[0].name }
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // SUPER ADMIN API: Organization-wide analytics dashboard.
router.get('/api/super/analytics', authenticate, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Access denied' });
      }

      const tenantsList = await db.select().from(schema.tenants);
      const allUsers = await db.select().from(schema.users);

      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const monthlyLogs = await db.select().from(schema.attendanceLogs).where(
        sql`created_at >= ${monthStart}`
      );

      const activeTenants = tenantsList.filter((t: any) => (t.status || 'active') === 'active').length;
      const suspendedTenants = tenantsList.filter((t: any) => t.status === 'suspended').length;
      const staffByRole: Record<string, number> = {};
      for (const u of allUsers) {
        const r = u.role || 'employee';
        staffByRole[r] = (staffByRole[r] || 0) + 1;
      }

      res.json({
        totalTenants: tenantsList.length,
        activeTenants,
        suspendedTenants,
        totalEmployees: allUsers.filter((u: any) => u.role !== 'super_admin').length,
        staffByRole,
        monthlyCheckInEvents: monthlyLogs.filter((l: any) => l.type === 'check_in' && l.status === 'approved').length,
        monthlyRejectedEvents: monthlyLogs.filter((l: any) => l.status === 'rejected').length,
        planBreakdown: tenantsList.reduce((acc: Record<string, number>, t: any) => {
          const p = t.plan || 'Basic';
          acc[p] = (acc[p] || 0) + 1;
          return acc;
        }, {})
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
