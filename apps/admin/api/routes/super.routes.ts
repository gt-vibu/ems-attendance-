import { Router } from 'express';
import crypto from 'crypto';
import { eq, and, or, desc, sql, inArray } from 'drizzle-orm';
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
import { hasPrivilege, getEffectivePrivileges, getUsersWithPrivilege, getDefaultPrivilegesForRole, PLATFORM_FEATURES } from '../auth/rbac';
import { STARTER_ROLE_DEFAULTS } from '../auth/starterRoles';
import { issueNewSession, finalizeLogin } from '../auth/session';
import { logToAuditLedger } from '../services/audit';
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
        featuresAllowed: featuresAllowed || ['device_identity', 'wifi_lock', 'gps_geofence']
      }).returning();

      // No branch/shift is auto-created here, deliberately: every branch a
      // tenant has must be something the tenant_admin themselves entered
      // (name, real address/location, policies) via the first-login
      // branch-setup wizard — never a silent "Main Branch" placeholder with
      // no location. The tenant_admin's own user row has no branchId/shiftId
      // either (it doesn't need one — admins don't clock in against a shift).
      // Onboarding an employee is already blocked until at least one real
      // branch+shift exists (see POST /api/tenant/users/create), so this is
      // safe: nothing can be onboarded before the tenant_admin sets one up.

      // Seed starter role defaults so the tenant admin isn't starting from a
      // completely blank Role Permissions screen — fully editable afterward,
      // no hardcoded fallback exists after this point.
      await db.insert(schema.rolePrivilegeDefaults).values(
        Object.entries(STARTER_ROLE_DEFAULTS).map(([roleName, privileges]) => ({
          tenantId: tenant[0].id,
          roleName,
          privileges,
        }))
      );

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
        tenantId: tenant[0].id,
      });

      // Update tenancy request status
      await db.update(schema.tenancyRequests)
        .set({ status: 'approved' })
        .where(eq(schema.tenancyRequests.id, requestId));

      // Send credentials mail with redirection link
      const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
      const activationLink = `${baseUrl}/login?email=${encodeURIComponent(request.email)}&temp=${tempPassword}`;
      
      const emailResult = await sendEmail({
        to: request.email,
        subject: 'Welcome to Smart Teams - Access Granted',
        text: `Hello ${request.companyName} Admin,\n\nYour tenancy has been approved by the Super Admin under the ${tenant[0].plan} plan.\n\nYour credentials:\nUsername: ${request.email}\nTemporary Password: ${userCredentialsTemplate(tempPassword)}\n\nLogin and set your permanent password here: ${activationLink}\n\nBest Regards,\nSmart Teams Onboarding`,
        html: `<h3>Hello ${request.companyName} Admin,</h3><p>Your tenancy has been approved by the Super Admin under the <strong>${tenant[0].plan} plan</strong>.</p><p><strong>Your credentials:</strong><br/>Username: <code>${request.email}</code><br/>Temporary Password: <code>${tempPassword}</code></p><p><a href="${activationLink}" style="display:inline-block;background:#7B5CFA;color:white;padding:10px 20px;text-decoration:none;border-radius:20px;font-weight:bold;">Activate Your Account</a></p><br/><p>Best Regards,<br/>Smart Teams Onboarding</p>`
      });

      // Email is the ONLY channel this credential ever went out through
      // before this change — if delivery fails (unconfigured provider, a
      // blocked/unreachable SMTP host, etc.) the new tenant admin had
      // literally no way to ever receive their temp password, and the
      // super admin approving them had no way to know or work around it
      // either (the response was just `{ success: true }`). Surfacing the
      // activation link + delivery outcome here lets the super admin
      // manually forward it through another channel when email doesn't
      // arrive — this is authenticated, super-admin-only data, same trust
      // level as everything else on this endpoint.
      res.json({ success: true, activationLink, emailDelivered: emailResult.delivered });
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
  // The server-driven list of platform-level module keys — same list used
  // to validate /api/super/approve and /api/super/tenants/features, exposed
  // so the frontend never hardcodes its own copy.
router.get('/api/super/platform-features', authenticate, async (req: any, res: any) => {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json({ features: PLATFORM_FEATURES });
  });

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

  // SUPER ADMIN API: Edit the platform feature whitelist for an EXISTING
  // tenant — the ongoing counterpart to the one-time selection made in
  // /api/super/approve. This is the top layer of the toggle cascade:
  // whatever a tenant admin can turn on/delegate is bounded by what's in
  // this list (see isPlatformFeatureAllowed() in rbac.ts).
router.post('/api/super/tenants/features', authenticate, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Access denied' });
      }
      const { tenantId, featuresAllowed } = req.body;
      if (!tenantId || !Array.isArray(featuresAllowed) || featuresAllowed.some((f: any) => typeof f !== 'string')) {
        return res.status(400).json({ error: 'tenantId and featuresAllowed (a string array) are required' });
      }
      const tenantList = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
      if (tenantList.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      const validKeys = new Set<string>(PLATFORM_FEATURES.map((f) => f.key));
      const cleaned = [...new Set(featuresAllowed.filter((f: string) => validKeys.has(f)))];

      await db.update(schema.tenants).set({ featuresAllowed: cleaned }).where(eq(schema.tenants.id, tenantId));

      await logToAuditLedger({
        tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'TENANT_FEATURES_UPDATED',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { tenantName: tenantList[0].name, featuresAllowed: cleaned }
      });

      res.json({ success: true, featuresAllowed: cleaned });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // SUPER ADMIN API: Permanently delete a tenant and everything belonging
  // to it. Unlike suspend/reactivate (reversible, no data loss), this is a
  // one-way door: every employee's login, attendance history, branches,
  // shifts, and QR data for this tenant are gone, and the company can only
  // regain access by submitting a brand-new tenancy request (public
  // /api/tenancy/request) for the super admin to review and approve again
  // from scratch — the old tenant/admin identity is not recoverable.
  // Deletion runs in a single transaction, deleting child rows in FK-safe
  // order; audit-ledger entries are detached (tenantId/actorId set to null)
  // rather than deleted, preserving the hash chain's integrity.
router.post('/api/super/tenants/delete', authenticate, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Access denied' });
      }
      const { tenantId } = req.body;
      if (!tenantId) {
        return res.status(400).json({ error: 'tenantId is required' });
      }

      const tenantList = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
      if (tenantList.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      const tenant = tenantList[0];

      const tenantUsers = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.tenantId, tenantId));
      const userIds = tenantUsers.map((u: any) => u.id);
      const employeeCount = userIds.length;

      await db.transaction(async (tx: any) => {
        // Detach (don't delete) audit-ledger entries so the hash chain stays
        // intact — this tenant's history just becomes unattributed.
        await tx.update(schema.auditLedger)
          .set({ tenantId: null, actorId: null })
          .where(or(
            eq(schema.auditLedger.tenantId, tenantId),
            userIds.length > 0 ? inArray(schema.auditLedger.actorId, userIds) : sql`false`
          ));

        // Full cascade, deepest-child-first. Every table anywhere in schema.ts
        // that carries a tenantId or a userId pointing into this tenant has to
        // be listed here — the previous version of this cascade only covered
        // whatever existed when it was first written, and every feature added
        // since (leave, payroll, teams, roles, integrations, and this
        // session's own additions) silently accumulated as un-deleted FK
        // blockers. Grouped by dependency depth rather than alphabetically so
        // the ordering constraints are visible at a glance:

        // Depth 3 — reference something below that itself references users/tenants.
        await tx.delete(schema.roleCompensationComponents).where(eq(schema.roleCompensationComponents.tenantId, tenantId));
        await tx.delete(schema.payrollRuns).where(eq(schema.payrollRuns.tenantId, tenantId));
        await tx.delete(schema.employeeSalaryComponents).where(eq(schema.employeeSalaryComponents.tenantId, tenantId));
        await tx.delete(schema.teamMembers).where(userIds.length > 0 ? inArray(schema.teamMembers.userId, userIds) : sql`false`);
        await tx.delete(schema.optionalHolidayChoices).where(eq(schema.optionalHolidayChoices.tenantId, tenantId));
        await tx.delete(schema.leaveEncashmentRequests).where(eq(schema.leaveEncashmentRequests.tenantId, tenantId));
        await tx.delete(schema.leaveRequests).where(eq(schema.leaveRequests.tenantId, tenantId));

        // Depth 2 — reference users/tenants/branches/shifts directly.
        await tx.delete(schema.employeeCompensationProfiles).where(eq(schema.employeeCompensationProfiles.tenantId, tenantId));
        await tx.delete(schema.roleCompensationDefaults).where(eq(schema.roleCompensationDefaults.tenantId, tenantId));
        await tx.delete(schema.teams).where(eq(schema.teams.tenantId, tenantId));
        await tx.delete(schema.leaveBalanceAdjustments).where(eq(schema.leaveBalanceAdjustments.tenantId, tenantId));
        await tx.delete(schema.leavePolicies).where(eq(schema.leavePolicies.tenantId, tenantId));
        await tx.delete(schema.compensationHistory).where(eq(schema.compensationHistory.tenantId, tenantId));
        await tx.delete(schema.payrollSettings).where(eq(schema.payrollSettings.tenantId, tenantId));
        await tx.delete(schema.rolePrivilegeDefaults).where(eq(schema.rolePrivilegeDefaults.tenantId, tenantId));
        await tx.delete(schema.serviceAccounts).where(eq(schema.serviceAccounts.tenantId, tenantId));
        await tx.delete(schema.webhookSubscriptions).where(eq(schema.webhookSubscriptions.tenantId, tenantId));
        await tx.delete(schema.departments).where(eq(schema.departments.tenantId, tenantId));
        await tx.delete(schema.shiftOverrides).where(eq(schema.shiftOverrides.tenantId, tenantId));
        await tx.delete(schema.userBranchAccess).where(userIds.length > 0 ? inArray(schema.userBranchAccess.userId, userIds) : sql`false`);
        await tx.delete(schema.qrScans).where(eq(schema.qrScans.tenantId, tenantId));
        await tx.delete(schema.attendanceAlerts).where(eq(schema.attendanceAlerts.tenantId, tenantId));
        await tx.delete(schema.qrSessions).where(eq(schema.qrSessions.tenantId, tenantId));
        await tx.delete(schema.breakSessions).where(eq(schema.breakSessions.tenantId, tenantId));
        await tx.delete(schema.attendanceCorrections).where(eq(schema.attendanceCorrections.tenantId, tenantId));
        await tx.delete(schema.employeeHomeLocations).where(eq(schema.employeeHomeLocations.tenantId, tenantId));
        await tx.delete(schema.wfhLocationChangeRequests).where(eq(schema.wfhLocationChangeRequests.tenantId, tenantId));
        await tx.delete(schema.deviceChangeRequests).where(eq(schema.deviceChangeRequests.tenantId, tenantId));
        await tx.delete(schema.holidays).where(eq(schema.holidays.tenantId, tenantId));
        await tx.delete(schema.attendanceLogs).where(eq(schema.attendanceLogs.tenantId, tenantId));
        await tx.delete(schema.attendanceLogsArchive).where(eq(schema.attendanceLogsArchive.tenantId, tenantId));
        await tx.delete(schema.terminationRequests).where(eq(schema.terminationRequests.tenantId, tenantId));
        await tx.delete(schema.employeeDocuments).where(eq(schema.employeeDocuments.tenantId, tenantId));
        await tx.delete(schema.shiftSwapRequests).where(eq(schema.shiftSwapRequests.tenantId, tenantId));
        await tx.delete(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.tenantId, tenantId));
        if (userIds.length > 0) {
          await tx.delete(schema.webauthnChallenges).where(inArray(schema.webauthnChallenges.userId, userIds));
        }

        // Notifications carry no DB-level FK (userId is a plain integer
        // column, not a .references() column) so they were never actually a
        // deletion blocker — cleaned up anyway so no row is left pointing at
        // a user/tenant id that no longer exists. Tenant-wide broadcast rows
        // use userId = tenantId (see GET /api/tenant/notifications); per-user
        // rows use a real user id.
        await tx.delete(schema.notifications).where(eq(schema.notifications.userId, tenantId));
        if (userIds.length > 0) {
          await tx.delete(schema.notifications).where(inArray(schema.notifications.userId, userIds));
        }

        // Users must go before branches/shifts (users.branchId/shiftId
        // reference them) and before tenants itself.
        await tx.delete(schema.users).where(eq(schema.users.tenantId, tenantId));
        await tx.delete(schema.shifts).where(eq(schema.shifts.tenantId, tenantId));
        await tx.delete(schema.branches).where(eq(schema.branches.tenantId, tenantId));

        await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
      });

      // Best-effort cleanup of on-disk document files — outside the DB
      // transaction on purpose (file I/O shouldn't be part of a rollback-able
      // transaction). The DB rows are already gone at this point either way,
      // so a failure here just leaves orphaned files on disk, never a
      // reachable-but-broken document.
      try {
        const { deleteTenantDocumentsDir } = await import('../services/documentStorage');
        await deleteTenantDocumentsDir(tenantId);
      } catch (err) {
        logger.warn('[tenant-delete] failed to clean up on-disk documents', { tenantId, err: (err as any)?.message });
      }

      await logToAuditLedger({
        tenantId: null,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'TENANT_DELETED',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { deletedTenantId: tenantId, tenantName: tenant.name, employeeCount }
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // SUPER ADMIN API: List the tenant_admin account(s) for a given tenant —
  // feeds the "delete tenant admin" picker (a tenant can in principle have
  // more than one).
router.get('/api/super/tenants/:tenantId/admins', authenticate, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Access denied' });
      }
      const tenantId = parseInt(req.params.tenantId, 10);
      const admins = await db.select().from(schema.users).where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.role, 'tenant_admin')));
      res.json({ admins: admins.map(a => ({ id: a.id, name: a.name, email: a.email, createdAt: a.createdAt })) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // SUPER ADMIN API: Permanently delete a single tenant_admin account —
  // narrower than /api/super/tenants/delete, which wipes the whole
  // organization. The tenant and its employees/data are untouched; only
  // this one admin's login is removed. Session is revoked immediately
  // (activeSessionId cleared) so any of their open tabs 401 on the next
  // request. Nullable references (audit-ledger authorship, corrections/WFH/
  // termination-request reviews, and being listed as someone's manager) are
  // detached rather than deleted, same reasoning as the tenant-wide delete
  // above — those records shouldn't vanish just because their reviewer's
  // account did. If this admin authored something that can't be safely
  // orphaned (e.g. a NOT NULL reference like a generated QR session or a
  // payroll adjustment), Postgres rejects the delete with a foreign-key
  // error and the whole transaction rolls back — reported back as a 409
  // rather than silently destroying that data.
router.post('/api/super/tenant-admins/delete', authenticate, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Access denied' });
      }
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
      }

      const targetRows = await db.select().from(schema.users).where(eq(schema.users.id, userId));
      if (targetRows.length === 0) {
        return res.status(404).json({ error: 'Admin account not found' });
      }
      const target = targetRows[0];
      if (target.role !== 'tenant_admin') {
        return res.status(400).json({ error: 'This account is not a tenant admin.' });
      }

      try {
        await db.transaction(async (tx: any) => {
          await tx.update(schema.auditLedger).set({ actorId: null }).where(eq(schema.auditLedger.actorId, target.id));
          await tx.update(schema.attendanceCorrections).set({ reviewedByUserId: null }).where(eq(schema.attendanceCorrections.reviewedByUserId, target.id));
          await tx.update(schema.wfhLocationChangeRequests).set({ reviewedByUserId: null }).where(eq(schema.wfhLocationChangeRequests.reviewedByUserId, target.id));
          await tx.update(schema.attendanceAlerts).set({ resolvedByUserId: null }).where(eq(schema.attendanceAlerts.resolvedByUserId, target.id));
          await tx.update(schema.terminationRequests).set({ reviewedByUserId: null }).where(eq(schema.terminationRequests.reviewedByUserId, target.id));
          await tx.update(schema.leaveRequests).set({ reviewedByUserId: null }).where(eq(schema.leaveRequests.reviewedByUserId, target.id));
          await tx.update(schema.leaveEncashmentRequests).set({ reviewedByUserId: null }).where(eq(schema.leaveEncashmentRequests.reviewedByUserId, target.id));
          await tx.update(schema.shiftSwapRequests).set({ reviewedByUserId: null }).where(eq(schema.shiftSwapRequests.reviewedByUserId, target.id));
          await tx.update(schema.compensationHistory).set({ changedByUserId: null }).where(eq(schema.compensationHistory.changedByUserId, target.id));
          await tx.update(schema.serviceAccounts).set({ createdByUserId: null }).where(eq(schema.serviceAccounts.createdByUserId, target.id));
          await tx.update(schema.departments).set({ headUserId: null }).where(eq(schema.departments.headUserId, target.id));
          await tx.update(schema.users).set({ managerId: null }).where(eq(schema.users.managerId, target.id));
          await tx.delete(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.userId, target.id));
          await tx.delete(schema.webauthnChallenges).where(eq(schema.webauthnChallenges.userId, target.id));
          await tx.delete(schema.notifications).where(eq(schema.notifications.userId, target.id));
          await tx.delete(schema.users).where(eq(schema.users.id, target.id));
        });
      } catch (txErr: any) {
        return res.status(409).json({
          error: 'This admin has associated records (e.g. generated QR sessions or payroll changes) that must be reassigned before their account can be deleted.',
          detail: txErr.message,
        });
      }

      await logToAuditLedger({
        tenantId: target.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'TENANT_ADMIN_DELETED',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { deletedUserId: target.id, deletedUserName: target.name, deletedUserEmail: target.email, tenantId: target.tenantId }
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
