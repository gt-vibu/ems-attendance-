import { Router } from 'express';
import crypto from 'crypto';
import { eq, and, or, desc, sql, inArray } from 'drizzle-orm';
import { db, schema } from '../../db';
import { sendServerError } from '../utils/errors';
import { logger } from '../../logger';
import { hashPassword } from '../../password.js';
import { sendEmail } from '../../mail.js';
import { authenticate, requireRole } from '../middleware/authenticate';
import { authLimiter } from '../middleware/rateLimit';
import { hasPrivilege, getEffectivePrivileges, getUsersWithPrivilege, getDefaultPrivilegesForRole, PLATFORM_FEATURES, PLATFORM_FEATURE_DEPENDENCIES, isPlatformFeatureAllowed } from '../auth/rbac';
import { STARTER_ROLE_DEFAULTS } from '../auth/starterRoles';
import { issueNewSession, finalizeLogin } from '../auth/session';
import { logToAuditLedger } from '../services/audit';

export const router = Router();

// companyName originates from the public, unauthenticated
// /api/tenancy/request endpoint below (validated only for truthiness) and
// is later interpolated into HTML email bodies and returned from
// GET /api/super/tenants — escape it everywhere it lands in HTML so a
// company name containing <script>/<img onerror=...> can't execute.
function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
        html: `<h3>Hello ${escapeHtml(companyName)},</h3><p>We have received your request to join Smart Teams under the <strong>${escapeHtml(plan)} Plan</strong>. Our Super Admin will review your application and onboard you shortly.</p><br/><p>Best Regards,<br/>Smart Teams Team</p>`
      });

      res.json({ success: true, request: request[0] });
    } catch (err: any) {
      sendServerError(res, err, "super.routes.ts");
    }
  });

  // SUPER ADMIN API: Get Requests & Notifications
router.get('/api/super/requests', authenticate, requireRole('super_admin'), async (req: any, res: any) => {
    try {
      const requests = await db.select().from(schema.tenancyRequests).orderBy(desc(schema.tenancyRequests.createdAt));
      res.json({ requests });
    } catch (err: any) {
      sendServerError(res, err, "super.routes.ts");
    }
  });

router.get('/api/super/notifications', authenticate, requireRole('super_admin'), async (req: any, res: any) => {
    try {
      const notifyList = await db.select().from(schema.notifications).where(sql`user_id IS NULL`).orderBy(desc(schema.notifications.createdAt));
      res.json({ notifications: notifyList });
    } catch (err: any) {
      sendServerError(res, err, "super.routes.ts");
    }
  });

  // SUPER ADMIN API: Approve Tenancy & Onboard Tenant
router.post('/api/super/approve', authenticate, requireRole('super_admin'), async (req: any, res: any) => {
    try {
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
        // unified_notifications ships on by default — the notification
        // engine itself should always be active (DEFAULT_POLICIES in
        // notificationService.ts is calibrated to match every event's
        // pre-existing hardcoded recipient/channel behavior exactly, so
        // turning this on changes nothing a tenant admin would notice
        // until they actually customize a policy). Only advanced channels
        // (SMS/push/Slack/Teams, once built) should need their own opt-in.
        featuresAllowed: featuresAllowed || ['device_identity', 'wifi_lock', 'gps_geofence', 'unified_notifications']
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
        html: `<h3>Hello ${escapeHtml(request.companyName)} Admin,</h3><p>Your tenancy has been approved by the Super Admin under the <strong>${escapeHtml(tenant[0].plan)} plan</strong>.</p><p><strong>Your credentials:</strong><br/>Username: <code>${escapeHtml(request.email)}</code><br/>Temporary Password: <code>${escapeHtml(tempPassword)}</code></p><p><a href="${activationLink}" style="display:inline-block;background:#7B5CFA;color:white;padding:10px 20px;text-decoration:none;border-radius:20px;font-weight:bold;">Activate Your Account</a></p><br/><p>Best Regards,<br/>Smart Teams Onboarding</p>`
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
      sendServerError(res, err, "super.routes.ts");
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
router.get('/api/super/platform-features', authenticate, requireRole('super_admin'), async (req: any, res: any) => {
    res.json({ features: PLATFORM_FEATURES, dependencies: PLATFORM_FEATURE_DEPENDENCIES });
  });

router.get('/api/super/tenants', authenticate, requireRole('super_admin'), async (req: any, res: any) => {
    try {
      const tenantsList = await db.select().from(schema.tenants).orderBy(desc(schema.tenants.createdAt));

      // Single grouped count instead of one query per tenant (N+1).
      const countRows = await db.select({ tenantId: schema.users.tenantId, count: sql<number>`count(*)` }).from(schema.users).groupBy(schema.users.tenantId);
      const countByTenant = new Map(countRows.map((r: any) => [r.tenantId, Number(r.count)]));
      const withCounts = tenantsList.map((t: any) => ({ ...t, employeeCount: countByTenant.get(t.id) || 0 }));

      res.json({ tenants: withCounts });
    } catch (err: any) {
      sendServerError(res, err, "super.routes.ts");
    }
  });

  // SUPER ADMIN API: Suspend or reactivate a tenant. Suspending immediately
  // blocks that tenant's users from logging in or logging attendance —
  // enforced in /api/auth/login and /api/attendance below.
router.post('/api/super/tenants/status', authenticate, requireRole('super_admin'), async (req: any, res: any) => {
    try {
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
      sendServerError(res, err, "super.routes.ts");
    }
  });

  // SUPER ADMIN API: Edit the platform feature whitelist for an EXISTING
  // tenant — the ongoing counterpart to the one-time selection made in
  // /api/super/approve. This is the top layer of the toggle cascade:
  // whatever a tenant admin can turn on/delegate is bounded by what's in
  // this list (see isPlatformFeatureAllowed() in rbac.ts).
router.post('/api/super/tenants/features', authenticate, requireRole('super_admin'), async (req: any, res: any) => {
    try {
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
      sendServerError(res, err, "super.routes.ts");
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
router.post('/api/super/tenants/delete', authenticate, requireRole('super_admin'), async (req: any, res: any) => {
    try {
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
        await tx.delete(schema.companyPayrollPolicies).where(eq(schema.companyPayrollPolicies.tenantId, tenantId));

        await tx.delete(schema.leaveEscalationHistory).where(userIds.length > 0 ? or(inArray(schema.leaveEscalationHistory.fromUserId, userIds), inArray(schema.leaveEscalationHistory.toUserId, userIds)) : sql`false`);
        await tx.delete(schema.ticketEscalations).where(userIds.length > 0 ? or(inArray(schema.ticketEscalations.fromUserId, userIds), inArray(schema.ticketEscalations.toUserId, userIds)) : sql`false`);
        await tx.delete(schema.tickets).where(eq(schema.tickets.tenantId, tenantId));

        await tx.delete(schema.shiftHistory).where(eq(schema.shiftHistory.tenantId, tenantId));
        await tx.delete(schema.delegations).where(eq(schema.delegations.tenantId, tenantId));
        await tx.delete(schema.holidayHistory).where(eq(schema.holidayHistory.tenantId, tenantId));
        await tx.delete(schema.holidayEmployeeOverrides).where(userIds.length > 0 ? inArray(schema.holidayEmployeeOverrides.userId, userIds) : sql`false`);
        await tx.delete(schema.optionalHolidayChoices).where(eq(schema.optionalHolidayChoices.tenantId, tenantId));
        await tx.delete(schema.leaveEncashmentRequests).where(eq(schema.leaveEncashmentRequests.tenantId, tenantId));
        await tx.delete(schema.leaveRequests).where(eq(schema.leaveRequests.tenantId, tenantId));
        await tx.delete(schema.expenseReimbursements).where(eq(schema.expenseReimbursements.tenantId, tenantId));
        await tx.delete(schema.expenses).where(eq(schema.expenses.tenantId, tenantId));

        // Additional deep child / payroll / ticket / statutory tables
        await tx.delete(schema.salaryAdvanceRecoveries).where(eq(schema.salaryAdvanceRecoveries.tenantId, tenantId));
        await tx.delete(schema.salaryAdvances).where(eq(schema.salaryAdvances.tenantId, tenantId));
        await tx.delete(schema.payrollAdvances).where(eq(schema.payrollAdvances.tenantId, tenantId));
        await tx.delete(schema.payrollLoans).where(eq(schema.payrollLoans.tenantId, tenantId));
        await tx.delete(schema.payrollAdjustments).where(eq(schema.payrollAdjustments.tenantId, tenantId));
        await tx.delete(schema.payrollReimbursements).where(eq(schema.payrollReimbursements.tenantId, tenantId));
        await tx.delete(schema.payrollBonuses).where(eq(schema.payrollBonuses.tenantId, tenantId));
        await tx.delete(schema.payrollLedgerEntries).where(eq(schema.payrollLedgerEntries.tenantId, tenantId));
        await tx.delete(schema.payrollFinalSettlements).where(eq(schema.payrollFinalSettlements.tenantId, tenantId));
        await tx.delete(schema.payrollBatches).where(eq(schema.payrollBatches.tenantId, tenantId));
        await tx.delete(schema.payrollCalendars).where(eq(schema.payrollCalendars.tenantId, tenantId));
        await tx.delete(schema.salaryRevisionRequests).where(eq(schema.salaryRevisionRequests.tenantId, tenantId));
        await tx.delete(schema.employeeStatutoryOverrides).where(eq(schema.employeeStatutoryOverrides.tenantId, tenantId));
        await tx.delete(schema.employeeStatutoryProfiles).where(eq(schema.employeeStatutoryProfiles.tenantId, tenantId));
        await tx.delete(schema.employeeBankAccounts).where(eq(schema.employeeBankAccounts.tenantId, tenantId));
        await tx.delete(schema.employeeTaxDeclarations).where(eq(schema.employeeTaxDeclarations.tenantId, tenantId));
        await tx.delete(schema.companyPayrollPolicies).where(eq(schema.companyPayrollPolicies.tenantId, tenantId));
        await tx.delete(schema.statutoryRuleVersions).where(eq(schema.statutoryRuleVersions.tenantId, tenantId));

        await tx.delete(schema.leaveEscalationHistory).where(userIds.length > 0 ? inArray(schema.leaveEscalationHistory.actorUserId, userIds) : sql`false`);
        await tx.delete(schema.ticketEscalations).where(userIds.length > 0 ? inArray(schema.ticketEscalations.escalatedToUserId, userIds) : sql`false`);
        await tx.delete(schema.tickets).where(eq(schema.tickets.tenantId, tenantId));

        await tx.delete(schema.shiftHistory).where(eq(schema.shiftHistory.tenantId, tenantId));
        await tx.delete(schema.delegations).where(eq(schema.delegations.tenantId, tenantId));
        await tx.delete(schema.holidayHistory).where(eq(schema.holidayHistory.tenantId, tenantId));
        await tx.delete(schema.holidayEmployeeOverrides).where(eq(schema.holidayEmployeeOverrides.tenantId, tenantId));

        await tx.delete(schema.notificationLog).where(eq(schema.notificationLog.tenantId, tenantId));
        await tx.delete(schema.notificationDigestQueue).where(eq(schema.notificationDigestQueue.tenantId, tenantId));
        await tx.delete(schema.notificationDigestSubscriptions).where(eq(schema.notificationDigestSubscriptions.tenantId, tenantId));
        await tx.delete(schema.notificationRecipientGroups).where(eq(schema.notificationRecipientGroups.tenantId, tenantId));
        await tx.delete(schema.notificationPolicies).where(eq(schema.notificationPolicies.tenantId, tenantId));
        await tx.delete(schema.notificationTemplates).where(eq(schema.notificationTemplates.tenantId, tenantId));

        await tx.delete(schema.reportSavedTemplates).where(eq(schema.reportSavedTemplates.tenantId, tenantId));
        await tx.delete(schema.reportSchedules).where(eq(schema.reportSchedules.tenantId, tenantId));
        await tx.delete(schema.attendanceFreezePeriods).where(eq(schema.attendanceFreezePeriods.tenantId, tenantId));

        await tx.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.tenantId, tenantId));
        await tx.delete(schema.attendancePreferences).where(eq(schema.attendancePreferences.tenantId, tenantId));
        await tx.delete(schema.attendancePreferenceHistory).where(eq(schema.attendancePreferenceHistory.tenantId, tenantId));
        await tx.delete(schema.presenceEvaluations).where(eq(schema.presenceEvaluations.tenantId, tenantId));
        await tx.delete(schema.presenceWarnings).where(eq(schema.presenceWarnings.tenantId, tenantId));

        await tx.delete(schema.federationWebhookDeliveries).where(eq(schema.federationWebhookDeliveries.tenantId, tenantId));
        await tx.delete(schema.federationExternalIdMappings).where(eq(schema.federationExternalIdMappings.tenantId, tenantId));
        await tx.delete(schema.federationWebhookSubscriptions).where(eq(schema.federationWebhookSubscriptions.tenantId, tenantId));
        await tx.delete(schema.federationEmployeeAccessGrants).where(eq(schema.federationEmployeeAccessGrants.tenantId, tenantId));
        await tx.delete(schema.federationBreakGlassAudit).where(eq(schema.federationBreakGlassAudit.tenantId, tenantId));
        await tx.delete(schema.tenantFederationAuthorizations).where(eq(schema.tenantFederationAuthorizations.tenantId, tenantId));
        await tx.delete(schema.federationClients).where(eq(schema.federationClients.tenantId, tenantId));

        await tx.delete(schema.expenseReports).where(eq(schema.expenseReports.tenantId, tenantId));
        await tx.delete(schema.expensePolicies).where(eq(schema.expensePolicies.tenantId, tenantId));
        if (userIds.length > 0) {
          await tx.delete(schema.consumedFaceChallenges).where(inArray(schema.consumedFaceChallenges.userId, userIds));
        }

        // Depth 2 — reference users/tenants/branches/shifts directly.
        await tx.delete(schema.expenseCategories).where(eq(schema.expenseCategories.tenantId, tenantId));
        await tx.delete(schema.approvalRoutingRules).where(eq(schema.approvalRoutingRules.tenantId, tenantId));
        await tx.delete(schema.backgroundJobs).where(eq(schema.backgroundJobs.tenantId, tenantId));
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
      sendServerError(res, err, "super.routes.ts");
    }
  });

  // SUPER ADMIN API: List the tenant_admin account(s) for a given tenant —
  // feeds the "delete tenant admin" picker (a tenant can in principle have
  // more than one).
// Job Scheduler Dashboard — a direct window into background_jobs, the
// table the Postgres-backed queue (services/queue/postgresQueue.ts)
// already reads/writes. This adds visibility, not new state: no job here
// is created or mutated by this route, only summarized and listed.
router.get('/api/super/job-scheduler', authenticate, requireRole('super_admin'), async (req: any, res: any) => {
    try {
      const rows = await db.select().from(schema.backgroundJobs).orderBy(desc(schema.backgroundJobs.createdAt)).limit(500);

      const byStatus: Record<string, number> = { pending: 0, running: 0, done: 0, failed: 0 };
      const byType: Record<string, { pending: number; running: number; done: number; failed: number }> = {};
      for (const j of rows) {
        byStatus[j.status] = (byStatus[j.status] || 0) + 1;
        if (!byType[j.jobType]) byType[j.jobType] = { pending: 0, running: 0, done: 0, failed: 0 };
        byType[j.jobType][j.status as 'pending' | 'running' | 'done' | 'failed'] =
          (byType[j.jobType][j.status as 'pending' | 'running' | 'done' | 'failed'] || 0) + 1;
      }

      const recentFailures = rows.filter((j: any) => j.status === 'failed').slice(0, 20);

      res.json({
        summary: byStatus,
        byType,
        recentFailures: recentFailures.map((j: any) => ({ id: j.id, jobType: j.jobType, tenantId: j.tenantId, attempts: j.attempts, maxAttempts: j.maxAttempts, lastError: j.lastError, createdAt: j.createdAt })),
        recentJobs: rows.slice(0, 50).map((j: any) => ({ id: j.id, jobType: j.jobType, tenantId: j.tenantId, status: j.status, attempts: j.attempts, createdAt: j.createdAt, completedAt: j.completedAt })),
      });
    } catch (err: any) {
      sendServerError(res, err, "super.routes.ts");
    }
  });

// System Health Dashboard — separate from Config Health (which checks a
// TENANT's own setup completeness). This checks the PLATFORM's operating
// condition: is the database reachable (this route itself proves that —
// if it weren't, the query below would throw and we'd never reach the
// response), is the queue keeping up (oldest pending job age, any job
// stuck 'running' past a sane timeout — a real stuck-worker signal, not a
// guess), is an email provider actually configured (RESEND_API_KEY or
// SMTP_HOST — checked directly, not inferred). No fabricated "Redis:
// Healthy" line — this deployment doesn't use Redis for anything but the
// optional rate limiter, which already degrades to in-memory without it,
// so there's no real Redis health signal to report.
router.get('/api/super/system-health', authenticate, requireRole('super_admin'), async (req: any, res: any) => {
    try {

      const now = Date.now();
      const dbStart = now;
      const tenantCountRows = await db.select({ count: sql<number>`count(*)` }).from(schema.tenants);
      const dbLatencyMs = Date.now() - dbStart;

      const pendingJobs = await db.select().from(schema.backgroundJobs).where(eq(schema.backgroundJobs.status, 'pending'));
      const runningJobs = await db.select().from(schema.backgroundJobs).where(eq(schema.backgroundJobs.status, 'running'));
      const oldestPendingAgeMs = pendingJobs.length > 0
        ? Math.max(...pendingJobs.map((j: any) => now - new Date(j.runAfter || j.createdAt).getTime()))
        : 0;
      const STUCK_RUNNING_THRESHOLD_MS = 10 * 60 * 1000; // a job claimed 'running' for 10+ min with no completion is a real stuck-worker signal
      const stuckJobs = runningJobs.filter((j: any) => now - new Date(j.createdAt).getTime() > STUCK_RUNNING_THRESHOLD_MS);

      const failedLast24h = await db.select({ count: sql<number>`count(*)` }).from(schema.backgroundJobs).where(
        and(eq(schema.backgroundJobs.status, 'failed'), sql`${schema.backgroundJobs.createdAt} >= ${new Date(now - 24 * 60 * 60 * 1000)}`)
      );

      const emailConfigured = !!(process.env.RESEND_API_KEY || process.env.SMTP_HOST);

      const checks = [
        { id: 'database', label: 'Database', status: 'healthy', detail: `Reachable, ${dbLatencyMs}ms query latency, ${tenantCountRows[0]?.count ?? 0} tenants.` },
        {
          id: 'queue', label: 'Background Job Queue',
          status: stuckJobs.length > 0 ? 'degraded' : oldestPendingAgeMs > 5 * 60 * 1000 ? 'degraded' : 'healthy',
          detail: stuckJobs.length > 0
            ? `${stuckJobs.length} job(s) stuck in 'running' for 10+ minutes — likely a crashed worker mid-job.`
            : `${pendingJobs.length} pending, oldest ${Math.round(oldestPendingAgeMs / 1000)}s old.`,
        },
        {
          id: 'email', label: 'Email Delivery',
          status: emailConfigured ? 'healthy' : 'not_configured',
          detail: emailConfigured ? 'A provider (Resend or SMTP) is configured.' : 'No RESEND_API_KEY or SMTP_HOST set — outbound email will fail.',
        },
        {
          id: 'background_jobs', label: 'Background Jobs (24h)',
          status: (failedLast24h[0]?.count ?? 0) > 0 ? 'degraded' : 'healthy',
          detail: `${failedLast24h[0]?.count ?? 0} failed in the last 24 hours.`,
        },
      ];

      res.json({ checks, checkedAt: new Date().toISOString() });
    } catch (err: any) {
      // If we got here, the database check itself is what failed. Logged
      // server-side (with full detail) via logger.error inside
      // sendServerError below rather than echoing the raw error text back
      // in the response — this is still an authenticated response body,
      // not a server log, so it follows the same sanitization convention
      // as every other endpoint even though the audience is super_admin only.
      logger.error('super.routes.ts (system-health) check failed', { error: err?.message, stack: err?.stack });
      res.status(500).json({ error: 'Health check failed to run.', checks: [{ id: 'database', label: 'Database', status: 'unhealthy', detail: 'Health check failed to run — see server logs.' }] });
    }
  });

router.get('/api/super/tenants/:tenantId/admins', authenticate, requireRole('super_admin'), async (req: any, res: any) => {
    try {
      const tenantId = parseInt(req.params.tenantId, 10);
      const admins = await db.select().from(schema.users).where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.role, 'tenant_admin')));
      res.json({ admins: admins.map(a => ({ id: a.id, name: a.name, email: a.email, createdAt: a.createdAt })) });
    } catch (err: any) {
      sendServerError(res, err, "super.routes.ts");
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
router.post('/api/super/tenant-admins/delete', authenticate, requireRole('super_admin'), async (req: any, res: any) => {
    try {
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
          await tx.update(schema.attendanceAlerts).set({ currentAssigneeUserId: null }).where(eq(schema.attendanceAlerts.currentAssigneeUserId, target.id));
          await tx.update(schema.attendanceAlerts).set({ resolvedByUserId: null }).where(eq(schema.attendanceAlerts.resolvedByUserId, target.id));
          await tx.update(schema.terminationRequests).set({ reviewedByUserId: null }).where(eq(schema.terminationRequests.reviewedByUserId, target.id));
          await tx.update(schema.leaveRequests).set({ reviewedByUserId: null }).where(eq(schema.leaveRequests.reviewedByUserId, target.id));
          await tx.update(schema.leaveEncashmentRequests).set({ reviewedByUserId: null }).where(eq(schema.leaveEncashmentRequests.reviewedByUserId, target.id));
          await tx.update(schema.shiftSwapRequests).set({ reviewedByUserId: null }).where(eq(schema.shiftSwapRequests.reviewedByUserId, target.id));
          await tx.update(schema.compensationHistory).set({ changedByUserId: null }).where(eq(schema.compensationHistory.changedByUserId, target.id));
          await tx.update(schema.serviceAccounts).set({ createdByUserId: null }).where(eq(schema.serviceAccounts.createdByUserId, target.id));
          await tx.update(schema.webhookSubscriptions).set({ createdByUserId: null }).where(eq(schema.webhookSubscriptions.createdByUserId, target.id));
          await tx.update(schema.departments).set({ headUserId: null }).where(eq(schema.departments.headUserId, target.id));
          await tx.update(schema.shiftOverrides).set({ createdBy: null }).where(eq(schema.shiftOverrides.createdBy, target.id));
          await tx.update(schema.tickets).set({ currentAssigneeUserId: null }).where(eq(schema.tickets.currentAssigneeUserId, target.id));
          await tx.update(schema.tickets).set({ resolvedByUserId: null }).where(eq(schema.tickets.resolvedByUserId, target.id));
          await tx.update(schema.ticketEscalations).set({ fromUserId: null }).where(eq(schema.ticketEscalations.fromUserId, target.id));
          await tx.update(schema.ticketEscalations).set({ toUserId: null }).where(eq(schema.ticketEscalations.toUserId, target.id));
          await tx.update(schema.users).set({ managerId: null }).where(eq(schema.users.managerId, target.id));
          await tx.delete(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.userId, target.id));
          await tx.delete(schema.webauthnChallenges).where(eq(schema.webauthnChallenges.userId, target.id));
          await tx.delete(schema.notifications).where(eq(schema.notifications.userId, target.id));
          await tx.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, target.id));
          await tx.delete(schema.users).where(eq(schema.users.id, target.id));
        });
      } catch (txErr: any) {
        return res.status(409).json({
          error: 'This admin has associated records (e.g. generated QR sessions, leave-balance adjustments, uploaded documents, termination requests they filed, a team they manage, or a ticket they raised) that must be reassigned before their account can be deleted.',
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
      sendServerError(res, err, "super.routes.ts");
    }
  });

  // SUPER ADMIN API: Organization-wide analytics dashboard.
router.get('/api/super/analytics', authenticate, requireRole('super_admin'), async (req: any, res: any) => {
    try {

      const tenantsList = await db.select().from(schema.tenants);
      const allUsers = await db.select().from(schema.users);

      const utcTodayParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'UTC',
        year: 'numeric',
        month: '2-digit',
      }).formatToParts(new Date());
      const utcYear = utcTodayParts.find((part) => part.type === 'year')?.value;
      const utcMonth = utcTodayParts.find((part) => part.type === 'month')?.value;
      const monthStart = new Date(`${utcYear}-${utcMonth}-01T00:00:00.000Z`);

      const monthlyLogs = await db.select().from(schema.attendanceLogs).where(
        sql`created_at >= ${monthStart}`
      );

      const activeTenants = tenantsList.filter((t: any) => (t.status || 'active') === 'active').length;
      const suspendedTenants = tenantsList.filter((t: any) => t.status === 'suspended').length;
      // Grouped case-insensitively — see tenant.routes.ts's identical fix
      // for why (inconsistent role casing across onboarding paths was
      // splitting one role into multiple display buckets).
      const staffByRoleLower: Record<string, { label: string; count: number }> = {};
      for (const u of allUsers) {
        const raw = u.role || 'employee';
        const key = raw.toLowerCase();
        if (!staffByRoleLower[key]) staffByRoleLower[key] = { label: raw, count: 0 };
        staffByRoleLower[key].count += 1;
      }
      const staffByRole: Record<string, number> = {};
      for (const { label, count } of Object.values(staffByRoleLower)) staffByRole[label] = count;

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
      sendServerError(res, err, "super.routes.ts");
    }
  });

// Feature Usage Analytics — a SaaS-ops view, not a per-tenant one: for each
// platform module, how many tenants have it ENABLED (adoption, via the same
// isPlatformFeatureAllowed() logic every route already gates on, including
// its legacy-fallback quirk) vs. how many are actually GENERATING DATA
// through it (real usage, read from the tables that module actually
// writes to). A feature can be "enabled" with zero real usage — that gap is
// the whole point of building this, not something to paper over.
router.get('/api/super/feature-usage', authenticate, requireRole('super_admin'), async (req: any, res: any) => {
    try {

      const tenantsList = await db.select().from(schema.tenants);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const [wfhLogs, qrScans, payrollBatches, notificationLogs, webhookRows, serviceAccountRows, docRows] = await Promise.all([
        db.select({ tenantId: schema.attendanceLogs.tenantId }).from(schema.attendanceLogs).where(and(eq(schema.attendanceLogs.attendanceMode, 'wfh'), sql`${schema.attendanceLogs.createdAt} >= ${thirtyDaysAgo}`)),
        db.select({ tenantId: schema.attendanceLogs.tenantId }).from(schema.attendanceLogs).where(and(eq(schema.attendanceLogs.attendanceMode, 'qr'), sql`${schema.attendanceLogs.createdAt} >= ${thirtyDaysAgo}`)),
        db.select({ tenantId: schema.payrollBatches.tenantId }).from(schema.payrollBatches),
        db.select({ tenantId: schema.notificationLog.tenantId }).from(schema.notificationLog).where(sql`${schema.notificationLog.createdAt} >= ${thirtyDaysAgo}`),
        db.select({ tenantId: schema.webhookSubscriptions.tenantId }).from(schema.webhookSubscriptions),
        db.select({ tenantId: schema.serviceAccounts.tenantId }).from(schema.serviceAccounts),
        db.select({ tenantId: schema.employeeDocuments.tenantId }).from(schema.employeeDocuments),
      ]);

      const countByTenant = (rows: Array<{ tenantId: number | null }>) => {
        const set = new Set<number>();
        for (const r of rows) if (r.tenantId) set.add(r.tenantId);
        return set;
      };
      const usageSets: Record<string, Set<number>> = {
        wfh: countByTenant(wfhLogs),
        qr_attendance: countByTenant(qrScans),
        payroll_batches: countByTenant(payrollBatches),
        unified_notifications: countByTenant(notificationLogs),
        webhooks: countByTenant(webhookRows),
        service_accounts: countByTenant(serviceAccountRows),
        documents: countByTenant(docRows),
      };

      const features = PLATFORM_FEATURES.map((f) => {
        const enabledTenants = tenantsList.filter((t: any) => isPlatformFeatureAllowed(t, f.key));
        const usageSet = usageSets[f.key];
        return {
          key: f.key,
          label: f.label,
          tenantsEnabled: enabledTenants.length,
          tenantsTotal: tenantsList.length,
          adoptionPercent: tenantsList.length > 0 ? Math.round((enabledTenants.length / tenantsList.length) * 100) : 0,
          // null = no usage signal tracked for this feature yet (most are
          // pure config toggles with no dedicated table of their own —
          // reporting a fake 0 would look like "enabled but unused" when
          // really it's "not instrumented," a meaningfully different fact.
          tenantsActiveUsage: usageSet ? usageSet.size : null,
        };
      });

      res.json({ features, totalTenants: tenantsList.length, windowDays: 30 });
    } catch (err: any) {
      sendServerError(res, err, "super.routes.ts");
    }
  });
