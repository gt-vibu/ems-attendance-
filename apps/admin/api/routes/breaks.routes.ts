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


  // BREAK SESSIONS API
router.get('/api/breaks/active', authenticate, async (req: any, res: any) => {
    try {
      const active = await db.select().from(schema.breakSessions).where(
        and(
          eq(schema.breakSessions.userId, req.user.userId),
          eq(schema.breakSessions.status, 'active')
        )
      );
      res.json({ active: active.length > 0 ? active[0] : null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Today's break sessions + remaining budget — feeds the Employee Home
  // page's "break time remaining" and "log of breaks" widgets.
router.get('/api/breaks/today', authenticate, async (req: any, res: any) => {
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const sessions = await db.select().from(schema.breakSessions).where(
        and(
          eq(schema.breakSessions.userId, req.user.userId),
          sql`start_time >= ${todayStart}`
        )
      ).orderBy(desc(schema.breakSessions.id));

      const tenantList = await db.select().from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId || 1));
      const budgetMins = tenantList.length > 0 ? (tenantList[0].dailyBreakBudgetMins || 60) : 60;

      const usedMins = sessions.reduce((sum: number, s: any) => {
        if (s.status === 'completed' && s.endTime) {
          return sum + Math.round((new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 60000);
        }
        if (s.status === 'active') {
          return sum + Math.round((Date.now() - new Date(s.startTime).getTime()) / 60000);
        }
        return sum;
      }, 0);

      res.json({ sessions, budgetMins, usedMins, remainingMins: Math.max(0, budgetMins - usedMins) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

router.post('/api/breaks/start', authenticate, async (req: any, res: any) => {
    try {
      const { breakType, lat, lng, note } = req.body;

      if (lat == null || lng == null) {
        return res.status(400).json({ error: 'GPS location permission is required to start a break.' });
      }

      const existing = await db.select().from(schema.breakSessions).where(
        and(
          eq(schema.breakSessions.userId, req.user.userId),
          eq(schema.breakSessions.status, 'active')
        )
      );
      if (existing.length > 0) {
        return res.status(400).json({ error: 'Break already active' });
      }

      const startTime = new Date();

      const session = await db.insert(schema.breakSessions).values({
        userId: req.user.userId,
        tenantId: req.user.tenantId,
        breakType: breakType || 'General',
        startTime,
        startLat: lat != null ? parseFloat(lat) : null,
        startLng: lng != null ? parseFloat(lng) : null,
        note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 280) : null,
        status: 'active'
      }).returning();

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'BREAK_STARTED',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { sessionId: session[0].id, startTime: startTime.toISOString(), breakType: breakType || 'General', lat, lng }
      });

      res.json({ session: session[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

router.post('/api/breaks/end', authenticate, async (req: any, res: any) => {
    try {
      const { clientTimestamp, lat, lng } = req.body;

      if (lat == null || lng == null) {
        return res.status(400).json({ error: 'GPS location permission is required to end a break.' });
      }

      const active = await db.select().from(schema.breakSessions).where(
        and(
          eq(schema.breakSessions.userId, req.user.userId),
          eq(schema.breakSessions.status, 'active')
        )
      );
      if (active.length === 0) {
        return res.status(400).json({ error: 'No active break session' });
      }

      const startTime = new Date(active[0].startTime);

      // Check for backdated timestamps or drift
      if (clientTimestamp) {
        const clientTime = new Date(clientTimestamp).getTime();
        if (isNaN(clientTime) || clientTime < startTime.getTime()) {
          return res.status(400).json({ error: 'Reject immediately: Backdated break end timestamp.' });
        }
        if (Math.abs(Date.now() - clientTime) > 5 * 60 * 1000) {
          return res.status(400).json({ error: 'Reject immediately: Client time mismatch (Backdated).' });
        }
      }

      const endTime = new Date();
      const elapsedMins = Math.round((endTime.getTime() - startTime.getTime()) / 60000);

      const tenantList = await db.select().from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId));
      const tenant = tenantList[0];
      const budget = tenant ? (tenant.dailyBreakBudgetMins || 60) : 60;

      let isViolation = false;
      if (elapsedMins > budget) {
        isViolation = true;
      }

      // Outside the office geofence at return time — do NOT close the break;
      // it stays 'active' until the employee is back within range. This is
      // deliberately different from the budget-violation case below (which
      // does close the break, just flagged): here the employee hasn't
      // actually returned to work yet, so there's nothing valid to record
      // as an end time.
      let outsideGeofence = false;
      if (tenant && tenant.locationLat && tenant.locationLng) {
        const distance = haversineMeters(lat, lng, tenant.locationLat, tenant.locationLng);
        if (distance > (tenant.locationRadiusMeters || 100)) {
          outsideGeofence = true;
        }
      }

      if (outsideGeofence) {
        await logToAuditLedger({
          tenantId: req.user.tenantId,
          actorId: req.user.userId,
          actorName: req.user.name,
          action: 'FRAUD_BREAK_OUTSIDE_GEOFENCE',
          details: { lat, lng, breakSessionId: active[0].id }
        });

        await db.insert(schema.attendanceAlerts).values({
          tenantId: req.user.tenantId,
          userId: req.user.userId,
          breakSessionId: active[0].id,
          type: 'break_outside_geofence',
          message: `${req.user.name} tried to end a break from outside the office location. The break remains active.`,
          status: 'pending'
        });

        await sendBreakLocationViolationEmail(req.user.email, req.user.name, req.user.name, true);
        const hierarchyRecipients = await getHierarchyAlertRecipients(req.user.tenantId, req.user.role, req.user.userId);
        for (const recipient of hierarchyRecipients) {
          await sendBreakLocationViolationEmail(recipient.email, recipient.name, req.user.name, false);
        }

        return res.status(400).json({
          error: "You're outside the office location — move back within range to end your break.",
          outsideGeofence: true
        });
      }

      await db.update(schema.breakSessions)
        .set({
          endTime,
          endLat: parseFloat(lat),
          endLng: parseFloat(lng),
          isViolation,
          outsideGeofence: false,
          status: 'completed'
        })
        .where(eq(schema.breakSessions.id, active[0].id));

      const unpaidDuration = Math.max(0, elapsedMins - budget);

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'BREAK_ENDED',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { 
          sessionId: active[0].id, 
          durationMins: elapsedMins, 
          budgetMins: budget, 
          isViolation,
          unpaidDuration,
          outsideGeofence
        }
      });

      // Recipient for the budget-violation case below is whoever the tenant
      // admin has granted 'alerts.receive' to (plus the tenant admin,
      // always) — unchanged from before; only the geofence case above
      // switched to the role-hierarchy resolver.
      const alertRecipients = await getUsersWithPrivilege(req.user.tenantId, 'alerts.receive');

      if (isViolation) {
        await logToAuditLedger({
          tenantId: req.user.tenantId,
          actorId: req.user.userId,
          actorName: req.user.name,
          action: 'BREAK_VIOLATION',
          details: { durationMins: elapsedMins, budgetMins: budget }
        });

        await sendBreakViolationAlert(req.user.email, req.user.name, endTime.toLocaleDateString(), elapsedMins, budget);

        await db.insert(schema.attendanceAlerts).values({
          tenantId: req.user.tenantId,
          userId: req.user.userId,
          breakSessionId: active[0].id,
          type: 'break_exceeded',
          message: `${req.user.name} exceeded the daily break budget. Elapsed: ${elapsedMins} min (allowed: ${budget} min, unpaid: ${unpaidDuration} min).`
        });

        for (const recipient of alertRecipients) {
          await sendManagerEscalationEmail(
            recipient.email,
            recipient.name,
            req.user.name,
            'Break Overstay Violation',
            `${req.user.name} went on break but exceeded the company break budget. Time elapsed: ${elapsedMins} minutes (Allowed Budget: ${budget} mins). Unpaid duration: ${unpaidDuration} mins.`
          );
        }
      }

      res.json({ success: true, elapsedMins, isViolation, unpaidDuration, outsideGeofence });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
