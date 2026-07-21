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
import { hasPrivilege, hasAnyPrivilege, getEffectivePrivileges, getUsersWithPrivilege, getDefaultPrivilegesForRole } from '../auth/rbac';
import { notifyUsers } from '../services/notifications';
import { issueNewSession, finalizeLogin } from '../auth/session';
import { logToAuditLedger } from '../services/audit';
import { dispatchWebhookEvent } from '../services/webhooks';
import { haversineMeters, resolveActiveIp } from '../services/geo';
import { computeAttendancePercent, getHierarchyAlertRecipients } from '../services/attendanceStats';

export const router = Router();


  // Which per-type receive/resolve privilege family covers a given
  // alert type — see featureCatalog.ts's "Timing Alerts" category. Late
  // arrival deliberately has no entry here: it's not an attendanceAlerts
  // row at all, it's handled entirely by the pending-attendance-log queue
  // below, gated by 'attendance.approve'.
const ALERT_TYPE_PRIVILEGE_PREFIX: Record<string, string> = {
  break_exceeded: 'alerts.break_violation',
  break_outside_geofence: 'alerts.break_violation',
  geofence_exit_working_hours: 'alerts.geofence_exit',
  spoofing_suspected: 'alerts.security',
  auto_checkout_unverified: 'alerts.security',
  low_attendance: 'alerts.low_attendance',
};

  // Visible to: (a) whoever it's currently routed to (see
  // services/escalation.ts / raiseAttendanceAlert) — always, regardless of
  // privileges, since routing already decided they're the responsible
  // party; or (b) anyone holding the matching per-type '.receive' privilege
  // (or the general legacy 'alerts.receive'), which grants tenant-wide
  // visibility into that alert type beyond just their own routed queue.
router.get('/api/tenant/alerts', authenticate, async (req: any, res: any) => {
    try {
      const effective = await getEffectivePrivileges(req.user);
      const holds = (key: string) => effective === 'ALL' || effective.includes(key);

      const alerts = await db.select().from(schema.attendanceAlerts)
        .where(eq(schema.attendanceAlerts.tenantId, req.user.tenantId))
        .orderBy(desc(schema.attendanceAlerts.createdAt));

      const visible = alerts.filter((a: any) => {
        if (a.currentAssigneeUserId === req.user.userId) return true;
        if (holds('alerts.receive')) return true;
        const prefix = ALERT_TYPE_PRIVILEGE_PREFIX[a.type];
        return !!prefix && holds(`${prefix}.receive`);
      });

      // Attach the violator's + current assignee's names for display
      const userIds = [...new Set(visible.flatMap((a: any) => [a.userId, a.currentAssigneeUserId].filter(Boolean)))];
      const users = userIds.length > 0 ? await db.select().from(schema.users).where(eq(schema.users.tenantId, req.user.tenantId)) : [];
      const userMap = new Map<number, any>(users.map((u: any) => [u.id, u]));
      const withNames = visible.map((a: any) => ({
        ...a,
        userName: userMap.get(a.userId)?.name || 'Unknown',
        userRole: userMap.get(a.userId)?.role || '',
        currentAssigneeName: a.currentAssigneeUserId ? (userMap.get(a.currentAssigneeUserId)?.name || 'Unknown') : null,
      }));

      res.json({ alerts: withNames });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Accept or reject an alert — both actions gated by the SAME single
  // '.resolve' privilege (matches how every other approval flow in this
  // catalog works: attendance.approve, leave.approve, employee.terminate.
  // approve all gate approve+reject together in one toggle). Authorized if:
  // (a) it's currently routed to you (see above), or (b) you hold the
  // matching per-type '.resolve' privilege (or the general legacy one).
router.post('/api/tenant/alerts/action', authenticate, async (req: any, res: any) => {
    try {
      const { alertId, action } = req.body; // action: 'accept' | 'reject'
      if (!alertId || !['accept', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'alertId and a valid action (accept|reject) are required' });
      }

      const alertList = await db.select().from(schema.attendanceAlerts).where(eq(schema.attendanceAlerts.id, alertId));
      if (alertList.length === 0) {
        return res.status(404).json({ error: 'Alert not found' });
      }
      const alert = alertList[0];

      // SECURITY: tenant isolation — never let someone resolve another
      // tenant's alert just by guessing an ID.
      if (alert.tenantId !== req.user.tenantId) {
        return res.status(403).json({ error: 'Access denied: This alert does not belong to your organization.' });
      }
      if (alert.status !== 'pending') {
        return res.status(400).json({ error: 'This alert has already been resolved.' });
      }

      const isAssignee = alert.currentAssigneeUserId === req.user.userId;
      const prefix = ALERT_TYPE_PRIVILEGE_PREFIX[alert.type];
      const specificPrivilege = prefix ? `${prefix}.resolve` : null;
      const authorized = isAssignee
        || await hasPrivilege(req.user, 'alerts.resolve')
        || (specificPrivilege ? await hasPrivilege(req.user, specificPrivilege) : false);
      if (!authorized) {
        return res.status(403).json({ error: `Access denied: You have not been granted permission to resolve this alert type.` });
      }

      await db.update(schema.attendanceAlerts)
        .set({
          status: action === 'accept' ? 'accepted' : 'rejected',
          resolvedByUserId: req.user.userId,
          resolvedAt: new Date()
        })
        .where(eq(schema.attendanceAlerts.id, alertId));

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: action === 'accept' ? 'ALERT_ACCEPTED' : 'ALERT_REJECTED',
        details: { alertId, type: alert.type, subjectUserId: alert.userId }
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // HOLIDAY CALENDAR
  // ==========================================

  // Anyone authenticated in the tenant can view the holiday calendar.
router.get('/api/tenant/holidays', authenticate, async (req: any, res: any) => {
    try {
      const list = await db.select().from(schema.holidays)
        .where(eq(schema.holidays.tenantId, req.user.tenantId))
        .orderBy(schema.holidays.date);
      res.json({ holidays: list });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delegable via the `holiday.manage` privilege — same catalog entry
  // already honored by the bulk public-holiday import endpoint
  // (holidays.routes.ts), so a role granted holiday.manage can add/
  // delete individual holidays too instead of only bulk-importing.
router.post('/api/tenant/holidays', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'holiday.manage')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const { date, name } = req.body;
      if (!date || !name) {
        return res.status(400).json({ error: 'date and name are required' });
      }
      const created = await db.insert(schema.holidays).values({
        tenantId: req.user.tenantId,
        date,
        name
      }).returning();
      // Notify every employee in the tenant — a declared holiday affects
      // everyone's leave/attendance calendar.
      const tenantUsers = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.tenantId, req.user.tenantId));
      await notifyUsers(
        tenantUsers.map((u) => u.id),
        'New holiday declared',
        `${name} on ${date} has been added to the company holiday calendar.`
      );
      res.json({ holiday: created[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

router.delete('/api/tenant/holidays/:id', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'holiday.manage')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const holidayList = await db.select().from(schema.holidays).where(eq(schema.holidays.id, parseInt(req.params.id)));
      if (holidayList.length === 0) {
        return res.status(404).json({ error: 'Holiday not found' });
      }
      if (holidayList[0].tenantId !== req.user.tenantId) {
        return res.status(403).json({ error: 'Access denied: This holiday does not belong to your organization.' });
      }
      await db.delete(schema.holidays).where(eq(schema.holidays.id, parseInt(req.params.id)));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // ATTENDANCE CORRECTION / REGULARIZATION
  // ==========================================

  // Any authenticated staff member can request a correction on their own
  // attendance (missed check-in/out, wrong location flagged, etc.).
router.post('/api/attendance/corrections', authenticate, async (req: any, res: any) => {
    try {
      const { requestType, requestedDate, requestedTime, reason } = req.body;
      if (!requestType || !requestedDate || !reason) {
        return res.status(400).json({ error: 'requestType, requestedDate, and reason are required' });
      }
      const validTypes = ['missed_checkin', 'missed_checkout', 'wrong_location', 'other'];
      if (!validTypes.includes(requestType)) {
        return res.status(400).json({ error: 'Invalid requestType' });
      }

      const created = await db.insert(schema.attendanceCorrections).values({
        tenantId: req.user.tenantId,
        userId: req.user.userId,
        requestType,
        requestedDate,
        requestedTime: requestedTime || null,
        reason
      }).returning();

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'CORRECTION_REQUESTED',
        details: { correctionId: created[0].id, requestType, requestedDate }
      });

      // Notify whoever can actually approve corrections.
      const approvers = await getUsersWithPrivilege(req.user.tenantId, ['attendance.approve.corrections', 'attendance.approve']);
      for (const approver of approvers) {
        await sendManagerEscalationEmail(
          approver.email,
          approver.name,
          req.user.name,
          'Attendance Correction Requested',
          `${req.user.name} requested an attendance correction for ${requestedDate} (${requestType.replace('_', ' ')}): ${reason}`
        );
      }

      res.json({ correction: created[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // An employee can see their own correction request history.
router.get('/api/attendance/corrections/mine', authenticate, async (req: any, res: any) => {
    try {
      const list = await db.select().from(schema.attendanceCorrections)
        .where(eq(schema.attendanceCorrections.userId, req.user.userId))
        .orderBy(desc(schema.attendanceCorrections.createdAt));
      res.json({ corrections: list });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Whoever holds 'attendance.approve.corrections' (or the general legacy
  // 'attendance.approve') reviews the tenant's pending requests.
router.get('/api/tenant/corrections', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasAnyPrivilege(req.user, ['attendance.approve.corrections', 'attendance.approve'])) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const list = await db.select().from(schema.attendanceCorrections)
        .where(eq(schema.attendanceCorrections.tenantId, req.user.tenantId))
        .orderBy(desc(schema.attendanceCorrections.createdAt));

      const withNames = await Promise.all(list.map(async (c: any) => {
        const u = await db.select().from(schema.users).where(eq(schema.users.id, c.userId));
        return { ...c, userName: u[0]?.name || 'Unknown', userRole: u[0]?.role || '' };
      }));

      res.json({ corrections: withNames });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

router.post('/api/tenant/corrections/action', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasAnyPrivilege(req.user, ['attendance.approve.corrections', 'attendance.approve'])) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const { correctionId, action } = req.body; // 'approve' | 'reject'
      if (!correctionId || !['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'correctionId and a valid action (approve|reject) are required' });
      }

      const list = await db.select().from(schema.attendanceCorrections).where(eq(schema.attendanceCorrections.id, correctionId));
      if (list.length === 0) {
        return res.status(404).json({ error: 'Correction request not found' });
      }
      const correction = list[0];

      if (correction.tenantId !== req.user.tenantId) {
        return res.status(403).json({ error: 'Access denied: This request does not belong to your organization.' });
      }
      if (correction.status !== 'pending') {
        return res.status(400).json({ error: 'This request has already been resolved.' });
      }

      await db.update(schema.attendanceCorrections)
        .set({
          status: action === 'approve' ? 'approved' : 'rejected',
          reviewedByUserId: req.user.userId,
          reviewedAt: new Date()
        })
        .where(eq(schema.attendanceCorrections.id, correctionId));

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: action === 'approve' ? 'CORRECTION_APPROVED' : 'CORRECTION_REJECTED',
        details: { correctionId, subjectUserId: correction.userId }
      });

      dispatchWebhookEvent(req.user.tenantId, 'attendance.correction_resolved', { correctionId, subjectUserId: correction.userId, status: action === 'approve' ? 'approved' : 'rejected' });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Late check-ins awaiting manager approval (see /api/attendance's
  // pendingApproval logic). Same shape/gating as /api/tenant/corrections.
router.get('/api/tenant/attendance/pending', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasAnyPrivilege(req.user, ['attendance.approve.late_arrival', 'attendance.approve'])) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const list = await db.select().from(schema.attendanceLogs)
        .where(
          and(
            eq(schema.attendanceLogs.tenantId, req.user.tenantId),
            eq(schema.attendanceLogs.status, 'pending')
          )
        )
        .orderBy(desc(schema.attendanceLogs.createdAt));

      const withNames = await Promise.all(list.map(async (l: any) => {
        const u = await db.select().from(schema.users).where(eq(schema.users.id, l.userId));
        return { ...l, userName: u[0]?.name || 'Unknown', userRole: u[0]?.role || '' };
      }));

      res.json({ logs: withNames });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

router.post('/api/tenant/attendance/action', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasAnyPrivilege(req.user, ['attendance.approve.late_arrival', 'attendance.approve'])) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const { logId, action } = req.body; // 'approve' | 'reject'
      if (!logId || !['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'logId and a valid action (approve|reject) are required' });
      }

      const list = await db.select().from(schema.attendanceLogs).where(eq(schema.attendanceLogs.id, logId));
      if (list.length === 0) {
        return res.status(404).json({ error: 'Attendance log not found' });
      }
      const log = list[0];

      if (log.tenantId !== req.user.tenantId) {
        return res.status(403).json({ error: 'Access denied: This request does not belong to your organization.' });
      }
      if (log.status !== 'pending') {
        return res.status(400).json({ error: 'This request has already been resolved.' });
      }

      const employeeList = await db.select().from(schema.users).where(eq(schema.users.id, log.userId));
      const employee = employeeList[0];

      // Reject marks the day absent — this row was never finalized as
      // 'approved', so updating it in place here doesn't touch an audit
      // trail the way editing an already-approved log would (that's what
      // attendanceCorrections is for instead).
      await db.update(schema.attendanceLogs)
        .set(
          action === 'approve'
            ? { status: 'approved' }
            : { status: 'rejected', type: 'absent' }
        )
        .where(eq(schema.attendanceLogs.id, logId));

      const isWfh = log.attendanceMode === 'wfh';
      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: action === 'approve'
          ? (isWfh ? 'WFH_APPROVED' : 'MANAGER_APPROVED')
          : (isWfh ? 'WFH_REJECTED' : 'LATE_ARRIVAL_REJECTED'),
        details: { logId, subjectUserId: log.userId }
      });

      if (employee) {
        if (isWfh) {
          await sendWfhDecisionEmail(
            employee.email,
            employee.name,
            new Date(log.createdAt as any).toLocaleDateString(),
            action === 'approve' ? 'approved' : 'rejected'
          );
        } else {
          await sendLateArrivalDecisionEmail(
            employee.email,
            employee.name,
            new Date(log.createdAt as any).toLocaleDateString(),
            action === 'approve' ? 'approved' : 'rejected'
          );
        }
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
