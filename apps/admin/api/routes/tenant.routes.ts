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
import { hasPrivilege, getEffectivePrivileges, getUsersWithPrivilege, getDefaultPrivilegesForRole, getScopedBranchIds } from '../auth/rbac';
import { issueNewSession, finalizeLogin } from '../auth/session';
import { logToAuditLedger } from '../services/audit';
import { haversineMeters, resolveActiveIp } from '../services/geo';
import { computeAttendancePercent, getHierarchyAlertRecipients } from '../services/attendanceStats';

export const router = Router();

// Shared by /api/tenant/analytics and /api/tenant/analytics/trends: resolves
// the set of branch ids a query should be filtered to, from the caller's
// scope plus an optional single ?branchId= they asked for. Returns null for
// "no branch filter" (whole tenant) — only possible for unrestricted callers
// with no explicit branchId. A restricted caller with no explicit branchId
// gets ALL of their scoped branches aggregated together (their own
// dashboard); asking for a specific branchId outside their scope is a 403,
// caught by the caller via the sentinel below.
const BRANCH_SCOPE_DENIED = Symbol('branch_scope_denied');
function resolveBranchFilterIds(scopedBranchIds: number[] | null, requestedBranchId: number | null): number[] | null | typeof BRANCH_SCOPE_DENIED {
  if (scopedBranchIds !== null) {
    if (requestedBranchId !== null) {
      return scopedBranchIds.includes(requestedBranchId) ? [requestedBranchId] : BRANCH_SCOPE_DENIED;
    }
    return scopedBranchIds;
  }
  return requestedBranchId !== null ? [requestedBranchId] : null;
}


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

      // Branch-scoped callers (HR/GM/manager assigned to one or more
      // branches) always see only their own accessible branches, regardless
      // of what (if anything) they pass in ?branchId= — asking for a branch
      // outside their scope is rejected. Unscoped callers (tenant_admin/
      // super_admin, or anyone not yet assigned to a branch) may optionally
      // filter by a branchId of their choosing, or see the whole tenant if
      // omitted. A multi-branch caller with no explicit ?branchId= gets all
      // of their branches aggregated together.
      const scopedBranchIds = await getScopedBranchIds(req.user);
      const requestedBranchId = req.query.branchId ? parseInt(req.query.branchId, 10) : null;
      const branchIds = resolveBranchFilterIds(scopedBranchIds, requestedBranchId);
      if (branchIds === BRANCH_SCOPE_DENIED) {
        return res.status(403).json({ error: 'Access denied: You are not scoped to this branch.' });
      }

      const staffFilter = branchIds
        ? and(eq(schema.users.tenantId, tenantId), sql`role != 'tenant_admin'`, inArray(schema.users.branchId, branchIds))
        : and(eq(schema.users.tenantId, tenantId), sql`role != 'tenant_admin'`);
      const staff = await db.select().from(schema.users).where(staffFilter);

      const logsFilter = branchIds
        ? and(eq(schema.attendanceLogs.tenantId, tenantId), sql`created_at >= ${todayStart}`, inArray(schema.attendanceLogs.branchId, branchIds))
        : and(eq(schema.attendanceLogs.tenantId, tenantId), sql`created_at >= ${todayStart}`);
      const todaysLogs = await db.select().from(schema.attendanceLogs).where(logsFilter);

      const checkedInToday = new Set(
        todaysLogs.filter((l: any) => l.type === 'check_in' && l.status === 'approved').map((l: any) => l.userId)
      );
      const lateToday = todaysLogs.filter((l: any) =>
        l.type === 'check_in' && l.status === 'approved' && (l.reason || '').includes('Late Arrival')
      ).length;
      const rejectedToday = todaysLogs.filter((l: any) => l.status === 'rejected').length;

      const monthlyLogsFilter = branchIds
        ? and(eq(schema.attendanceLogs.tenantId, tenantId), sql`created_at >= ${monthStart}`, inArray(schema.attendanceLogs.branchId, branchIds))
        : and(eq(schema.attendanceLogs.tenantId, tenantId), sql`created_at >= ${monthStart}`);
      const monthlyLogs = await db.select().from(schema.attendanceLogs).where(monthlyLogsFilter);

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

  // TENANT ADMIN API: day-by-day presence/lateness % series for the last N
  // days (7 or 30), optionally scoped to one branch — backs the branch
  // detail page's "attendance trends" section. Genuinely new aggregation;
  // nothing existing computes a day-by-day series (computeAttendancePercent
  // only produces a single running total).
router.get('/api/tenant/analytics/trends', authenticate, async (req: any, res: any) => {
    try {
      const tenantId = req.user.tenantId;
      const days = req.query.days === '7' ? 7 : 30;

      const scopedBranchIds = await getScopedBranchIds(req.user);
      const requestedBranchId = req.query.branchId ? parseInt(req.query.branchId, 10) : null;
      const branchIds = resolveBranchFilterIds(scopedBranchIds, requestedBranchId);
      if (branchIds === BRANCH_SCOPE_DENIED) {
        return res.status(403).json({ error: 'Access denied: You are not scoped to this branch.' });
      }

      const rangeStart = new Date();
      rangeStart.setHours(0, 0, 0, 0);
      rangeStart.setDate(rangeStart.getDate() - (days - 1));

      const staffFilter = branchIds
        ? and(eq(schema.users.tenantId, tenantId), sql`role != 'tenant_admin'`, inArray(schema.users.branchId, branchIds))
        : and(eq(schema.users.tenantId, tenantId), sql`role != 'tenant_admin'`);
      const staff = await db.select().from(schema.users).where(staffFilter);
      const staffCount = staff.length;

      const logsFilter = branchIds
        ? and(eq(schema.attendanceLogs.tenantId, tenantId), sql`created_at >= ${rangeStart}`, inArray(schema.attendanceLogs.branchId, branchIds))
        : and(eq(schema.attendanceLogs.tenantId, tenantId), sql`created_at >= ${rangeStart}`);
      const logs = await db.select().from(schema.attendanceLogs).where(logsFilter);

      const series: Array<{ date: string; presentCount: number; latePercent: number; attendancePercent: number }> = [];
      for (let i = 0; i < days; i++) {
        const dayStart = new Date(rangeStart);
        dayStart.setDate(dayStart.getDate() + i);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);

        const dayLogs = logs.filter((l: any) => {
          const t = new Date(l.createdAt).getTime();
          return t >= dayStart.getTime() && t < dayEnd.getTime();
        });
        const checkIns = dayLogs.filter((l: any) => l.type === 'check_in' && l.status === 'approved');
        const presentUserIds = new Set(checkIns.map((l: any) => l.userId));
        const lateCount = checkIns.filter((l: any) => (l.reason || '').includes('Late Arrival')).length;

        series.push({
          date: dayStart.toISOString().slice(0, 10),
          presentCount: presentUserIds.size,
          latePercent: checkIns.length > 0 ? Math.round((lateCount / checkIns.length) * 100) : 0,
          attendancePercent: staffCount > 0 ? Math.round((presentUserIds.size / staffCount) * 100) : 0,
        });
      }

      res.json({ days, branchIds, series });
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

      const { email, name, role, privileges, branchId, shiftId, additionalBranchIds, department } = req.body;
      if (!email || !name || !role) {
        return res.status(400).json({ error: 'Email, name, and role are required' });
      }
      if (!branchId || !shiftId) {
        return res.status(400).json({ error: 'branchId and shiftId are required' });
      }

      const branchRows = await db.select().from(schema.branches).where(eq(schema.branches.id, branchId));
      if (branchRows.length === 0 || branchRows[0].tenantId !== req.user.tenantId) {
        return res.status(400).json({ error: 'Invalid branchId' });
      }

      // If the caller is themselves scoped to specific branches, they can
      // only onboard into one of those — matches the "employee.create"
      // precedence-of-power convention applied elsewhere in this handler.
      const scopedBranchIds = await getScopedBranchIds(req.user);
      if (scopedBranchIds !== null && !scopedBranchIds.includes(branchId)) {
        return res.status(403).json({ error: 'Access denied: You can only onboard employees into your own branch(es).' });
      }

      const shiftRows = await db.select().from(schema.shifts).where(eq(schema.shifts.id, shiftId));
      if (shiftRows.length === 0 || shiftRows[0].branchId !== branchId) {
        return res.status(400).json({ error: 'Invalid shiftId for the selected branch' });
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

      // finalPrivileges = what this person effectively has at hire time
      // (role defaults + whatever extra was granted) — used below for the
      // branch.multi_access check, role auto-registration seed, and the
      // audit log. It is NOT what gets stored on the user row (see below).
      const roleDefaults = await getDefaultPrivilegesForRole(req.user.tenantId, role);
      const finalPrivileges = Array.from(new Set([
        ...roleDefaults,
        ...grantablePrivileges
      ]));

      // users.privileges stores ONLY the individual delta beyond the role's
      // own defaults — deliberately NOT a snapshot of the merged set.
      // hasPrivilege()/getEffectivePrivileges() already union a user's own
      // privileges with their role's CURRENT defaults (looked up live, not
      // cached) — if we stored the full merged set here, a role default
      // later toggled OFF in Roles & Permissions would never actually take
      // effect for anyone hired before that change, since it'd still be
      // sitting in their own frozen privileges array. Storing only the
      // delta means role edits (additions AND removals) propagate
      // immediately to everyone in that role, while an individually-granted
      // extra (not part of the role) still sticks with that one person.
      const individualExtras = grantablePrivileges.filter((p: string) => !roleDefaults.includes(p));

      // Auto-register a brand-new custom role: if nobody has defined
      // role_privilege_defaults for this exact role name at this tenant yet,
      // create it now seeded with whatever ended up granted at this hire —
      // it's immediately visible/editable in the Role Permissions screen and
      // selectable for the next hire, without a separate "define the role
      // first" step.
      const existingRoleRow = await db.select().from(schema.rolePrivilegeDefaults).where(
        and(eq(schema.rolePrivilegeDefaults.tenantId, req.user.tenantId), eq(schema.rolePrivilegeDefaults.roleName, role))
      ).limit(1);
      if (existingRoleRow.length === 0) {
        await db.insert(schema.rolePrivilegeDefaults).values({
          tenantId: req.user.tenantId,
          roleName: role,
          privileges: finalPrivileges,
        });
      }

      // "Manage Multiple Branches" (branch.multi_access): only meaningful
      // when actually granted; each requested extra branch is validated to
      // belong to this tenant, and the primary branchId is never duplicated
      // into the access-list table.
      let grantedAdditionalBranchIds: number[] = [];
      if (finalPrivileges.includes('branch.multi_access') && Array.isArray(additionalBranchIds) && additionalBranchIds.length > 0) {
        const requestedIds = Array.from(new Set(additionalBranchIds.map((id: any) => parseInt(id, 10)))).filter((id: number) => id !== branchId);
        if (requestedIds.length > 0) {
          const validBranches = await db.select().from(schema.branches).where(
            and(inArray(schema.branches.id, requestedIds), eq(schema.branches.tenantId, req.user.tenantId))
          );
          grantedAdditionalBranchIds = validBranches.map((b: any) => b.id);
        }
      }

      const [insertedUser] = await db.insert(schema.users).values({
        uid: userUid,
        email,
        name,
        department: department || null,
        password: '',
        tempPassword: await hashPassword(tempPassword),
        role,
        privileges: individualExtras,
        mustChangePassword: true,
        tenantId: req.user.tenantId,
        branchId,
        shiftId
      }).returning();

      if (grantedAdditionalBranchIds.length > 0) {
        await db.insert(schema.userBranchAccess).values(
          grantedAdditionalBranchIds.map((bId) => ({ userId: insertedUser.id, branchId: bId }))
        );
      }

      // Send credential email
      const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
      const activationLink = `${baseUrl}/login?email=${encodeURIComponent(email)}&temp=${tempPassword}`;
      const emailResult = await sendEmail({
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
        details: { email, name, role, department: department || null, branchId, shiftId, additionalBranchIds: grantedAdditionalBranchIds }
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

      // Lets the frontend prompt "set up this new role's permissions and
      // salary" right after hiring the first person into it, instead of
      // silently leaving it on whatever got granted at this one hire. The
      // account itself is created either way — emailDelivered only tells
      // the frontend whether it can also promise "and they've been emailed
      // their credentials", so it can say so honestly instead of always
      // claiming success even when no mail provider is configured.
      res.json({ success: true, isNewRole: existingRoleRow.length === 0, role, emailDelivered: emailResult.delivered });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Bulk hire via CSV — same core validation as POST /api/tenant/users/create
  // (role restriction, branch/shift ownership, scoped-branch precedence, no
  // duplicate email), run per-row so one bad row doesn't fail the whole
  // batch. Deliberately simpler than the single-hire endpoint: every hire in
  // a batch gets exactly its role's default privileges, no per-row custom
  // "additional access" grant or multi-branch assignment — those still go
  // through the single hire form when a specific person needs more than
  // their role's baseline.
router.post('/api/tenant/users/bulk-create', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'employee.create')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const { rows } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: 'rows (a non-empty array) is required' });
      }
      if (rows.length > 200) {
        return res.status(400).json({ error: 'A single batch is limited to 200 rows — split larger files.' });
      }

      const scopedBranchIds = await getScopedBranchIds(req.user);
      const tenantId = req.user.tenantId;
      const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
      const seenEmailsThisBatch = new Set<string>();
      const results: Array<{ row: number; email: string; success: boolean; error?: string }> = [];

      for (let i = 0; i < rows.length; i++) {
        const rowNum = i + 1;
        const { email, name, role, branchId: rawBranchId, shiftId: rawShiftId, department } = rows[i] || {};
        try {
          if (!email || !name || !role) throw new Error('email, name, and role are required');
          const normalizedEmail = String(email).trim().toLowerCase();
          if (seenEmailsThisBatch.has(normalizedEmail)) throw new Error('duplicate email within this batch');
          seenEmailsThisBatch.add(normalizedEmail);

          const normalizedRole = String(role).trim().toLowerCase();
          if (normalizedRole === 'super_admin' || normalizedRole === 'tenant_admin' || normalizedRole === 'superadmin') {
            throw new Error('this role cannot be assigned via bulk hire');
          }

          const branchId = Number(rawBranchId);
          const shiftId = Number(rawShiftId);
          if (!branchId || !shiftId) throw new Error('branchId and shiftId are required');
          if (scopedBranchIds !== null && !scopedBranchIds.includes(branchId)) throw new Error('you are not scoped to this branch');

          const branchRows = await db.select().from(schema.branches).where(eq(schema.branches.id, branchId));
          if (branchRows.length === 0 || branchRows[0].tenantId !== tenantId) throw new Error('invalid branchId');
          const shiftRows = await db.select().from(schema.shifts).where(eq(schema.shifts.id, shiftId));
          if (shiftRows.length === 0 || shiftRows[0].branchId !== branchId) throw new Error('invalid shiftId for the selected branch');

          const existing = await db.select().from(schema.users).where(eq(schema.users.email, email));
          if (existing.length > 0) throw new Error('email already registered');

          const roleDefaults = await getDefaultPrivilegesForRole(tenantId, role);
          const existingRoleRow = await db.select().from(schema.rolePrivilegeDefaults).where(
            and(eq(schema.rolePrivilegeDefaults.tenantId, tenantId), eq(schema.rolePrivilegeDefaults.roleName, role))
          ).limit(1);
          if (existingRoleRow.length === 0) {
            await db.insert(schema.rolePrivilegeDefaults).values({ tenantId, roleName: role, privileges: roleDefaults });
          }

          const tempPassword = 'temp_' + crypto.randomBytes(6).toString('hex');
          const userUid = crypto.randomUUID();
          await db.insert(schema.users).values({
            uid: userUid, email, name, department: department || null, password: '',
            tempPassword: await hashPassword(tempPassword), role, privileges: [],
            mustChangePassword: true, tenantId, branchId, shiftId,
          });

          const activationLink = `${baseUrl}/login?email=${encodeURIComponent(email)}&temp=${tempPassword}`;
          await sendEmail({
            to: email,
            subject: `Smart Teams Invitation - Registered as ${role}`,
            text: `Hello ${name},\n\nYou have been registered on Smart Teams as a ${role}.\n\nYour credentials:\nUsername: ${email}\nTemporary Password: ${tempPassword}\n\nLogin and set your password here: ${activationLink}\n\nBest Regards,\nSmart Teams Team`,
            html: `<h3>Hello ${name},</h3><p>You have been registered on Smart Teams as a <strong>${role}</strong>.</p><p><strong>Your credentials:</strong><br/>Username: <code>${email}</code><br/>Temporary Password: <code>${tempPassword}</code></p><p><a href="${activationLink}" style="display:inline-block;background:#FF3D8A;color:white;padding:10px 20px;text-decoration:none;border-radius:20px;font-weight:bold;">Set Your Password</a></p><br/><p>Best Regards,<br/>Smart Teams Team</p>`,
          }).catch(() => undefined);

          await logToAuditLedger({
            tenantId, actorId: req.user.userId, actorName: req.user.name, action: 'EMPLOYEE_CREATED',
            ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '', deviceInfo: req.headers['user-agent'] || '',
            details: { email, name, role, department: department || null, branchId, shiftId, viaBulkImport: true },
          });

          results.push({ row: rowNum, email, success: true });
        } catch (rowErr: any) {
          results.push({ row: rowNum, email: email || '(missing)', success: false, error: rowErr.message || 'Unknown error' });
        }
      }

      res.json({ success: true, results, created: results.filter((r) => r.success).length, failed: results.filter((r) => !r.success).length });
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
      const scopedBranchIds = await getScopedBranchIds(req.user);
      const filter = scopedBranchIds !== null
        ? and(eq(schema.users.tenantId, req.user.tenantId), inArray(schema.users.branchId, scopedBranchIds))
        : eq(schema.users.tenantId, req.user.tenantId);
      const usersList = await db.select().from(schema.users)
        .where(filter)
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

  // Get the calling user's own in-app notifications (holiday declared,
  // shift changed, salary changed, etc. — see api/services/notifications.ts
  // for the writers). Every row is addressed to exactly one real user, so
  // this is always scoped to the caller's own id, not the tenant as a whole.
router.get('/api/tenant/notifications', authenticate, async (req: any, res: any) => {
    try {
      const notifyList = await db.select().from(schema.notifications)
        .where(eq(schema.notifications.userId, req.user.userId))
        .orderBy(desc(schema.notifications.createdAt))
        .limit(50);
      res.json({ notifications: notifyList });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

router.post('/api/tenant/notifications/:id/read', authenticate, async (req: any, res: any) => {
    try {
      const id = Number(req.params.id);
      const [row] = await db.select().from(schema.notifications).where(eq(schema.notifications.id, id)).limit(1);
      if (!row || row.userId !== req.user.userId) {
        return res.status(404).json({ error: 'Notification not found.' });
      }
      await db.update(schema.notifications).set({ isRead: true }).where(eq(schema.notifications.id, id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

router.post('/api/tenant/notifications/read-all', authenticate, async (req: any, res: any) => {
    try {
      await db.update(schema.notifications).set({ isRead: true }).where(eq(schema.notifications.userId, req.user.userId));
      res.json({ success: true });
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
