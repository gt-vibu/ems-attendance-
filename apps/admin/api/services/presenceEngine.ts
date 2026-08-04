import { eq, and, desc, sql, lt } from 'drizzle-orm';
import { db, schema } from '../../db';
import { logger } from '../../logger';
import { logToAuditLedger } from './audit';
import { haversineMeters } from './geo';
import { getEffectiveShift } from './shiftOverrides';
import { resolveEffectivePolicy } from './attendancePolicy';
import { tenantDateKey, tenantStartOfDay, tenantDateTime } from './tenantTime';
import { resolveAttendancePreferences, type AttendancePrefs } from './attendancePreferencesService';
import { raiseAttendanceAlert } from './alerts';
import { notify, notifyDirectRecipient, registerNotificationDeliveryHandler } from './notificationService';
import { notifyUser, notifyUsers } from './notifications';
import { isPlatformFeatureAllowed } from '../auth/rbac';

// ═══════════════════════════════════════════════════════════════════════
// PRESENCE ENGINE — Multi-signal confidence evaluation & auto-checkout policy engine.
// Evaluates active attendance sessions using multiple weighted signals:
// - Session Status & Shift Boundaries
// - Active Break State (GPS exits ignored during approved break)
// - GPS / Geofence Proximity
// - Corporate Wi-Fi IP / SSID
// - Face Verification & Liveness Score Freshness
// - EMS In-App Interaction Timestamps & Visibility
// - Heartbeat Freshness
// - Desktop Agent Signals (Extensible Provider Stub)
// ═══════════════════════════════════════════════════════════════════════

export type PresenceState =
  | 'active_working'
  | 'on_break'
  | 'temporarily_away'
  | 'shift_ended'
  | 'overtime'
  | 'inactive'
  | 'auto_checkout_candidate'
  | 'checked_out';

export type PresenceDecision =
  | 'continue_session'
  | 'transition_overtime'
  | 'issue_warning'
  | 'auto_checkout';

export interface EvaluatedSignal {
  name: string;
  enabled: boolean;
  score: number;
  maxScore: number;
  status: string;
  details?: Record<string, any>;
}

export interface PresenceEvaluationResult {
  userId: number;
  tenantId: number;
  attendanceLogId: number | null;
  state: PresenceState;
  confidenceScore: number; // 0 to 100
  decision: PresenceDecision;
  reason: string;
  signalsEvaluated: Record<string, EvaluatedSignal>;
  policyVersion: string;
  warning?: {
    id: number;
    warnedAt: Date;
    expiresAt: Date;
    remainingMins: number;
  } | null;
}

/**
 * Extensible Provider Stub for Future Desktop Agent Signals
 */
export interface DesktopAgentSignals {
  desktopIdleSec?: number;
  screenLocked?: boolean;
  vpnConnected?: boolean;
  companyWifiConnected?: boolean;
  agentHeartbeatAt?: Date;
}

/**
 * Evaluates the live presence state & confidence score for an active attendance session.
 */
export async function evaluateEmployeePresence(
  tenantId: number,
  userId: number,
  logId?: number,
  desktopSignals?: DesktopAgentSignals,
): Promise<PresenceEvaluationResult> {
  const prefs: AttendancePrefs = await resolveAttendancePreferences(tenantId);
  const now = new Date();

  // Fetch tenant row
  const tenantRows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  const tenant = tenantRows[0] || { id: tenantId, timezone: 'Asia/Kolkata' };

  // Fetch user row
  const userRows = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  const user = userRows[0];

  if (!user) {
    throw new Error(`User ID ${userId} not found`);
  }

  // 1. Fetch active check-in log
  const todayStart = tenantStartOfDay(tenant, now);
  const activeLogs = await db.select()
    .from(schema.attendanceLogs)
    .where(
      and(
        eq(schema.attendanceLogs.userId, userId),
        eq(schema.attendanceLogs.status, 'approved'),
        sql`created_at >= ${todayStart}`
      )
    )
    .orderBy(desc(schema.attendanceLogs.id));

  const latestLog = activeLogs[0] || null;
  const currentCheckIn = activeLogs.find((l: any) => l.type === 'check_in');
  const currentCheckOut = activeLogs.find((l: any) => l.type === 'check_out');

  // If already checked out or no check-in
  if (!currentCheckIn || currentCheckOut) {
    return {
      userId,
      tenantId,
      attendanceLogId: latestLog?.id || null,
      state: 'checked_out',
      confidenceScore: 0,
      decision: 'continue_session',
      reason: 'No active check-in session.',
      signalsEvaluated: {},
      policyVersion: 'v1.0',
    };
  }

  const activeLogId = logId || currentCheckIn.id;

  // 2. Fetch active break session
  const activeBreaks = await db.select()
    .from(schema.breakSessions)
    .where(
      and(
        eq(schema.breakSessions.userId, userId),
        eq(schema.breakSessions.status, 'active')
      )
    )
    .limit(1);

  const activeBreak = activeBreaks[0] || null;

  // 3. Resolve shift policy
  const tTodayKey = tenantDateKey(tenant, now);
  const branch = user.branchId ? (await db.select().from(schema.branches).where(eq(schema.branches.id, user.branchId)).limit(1))[0] || null : null;
  const shift = await getEffectiveShift(tenantId, userId, tTodayKey);
  const policy = resolveEffectivePolicy(tenant, branch, shift);

  // Shift end boundary
  const [endH, endM] = policy.shiftEndStr.split(':').map(Number);
  const shiftEndToday = tenantDateTime(tenant, tTodayKey, endH || 18, endM || 0);
  const graceMins = prefs.presenceGracePeriodMins ?? tenant.checkoutGraceMins ?? 30;
  const shiftGraceExpiredAt = new Date(shiftEndToday.getTime() + graceMins * 60000);
  const isPastShiftEndGrace = now > shiftGraceExpiredAt;

  // Max session cap check
  const maxHours = prefs.maxSessionDurationHours || 14;
  const sessionDurationHours = (now.getTime() - new Date(currentCheckIn.createdAt!).getTime()) / 3600000;
  const maxSessionExceeded = sessionDurationHours >= maxHours;

  // ─────────────────────────────────────────────────────────────────────
  // SIGNAL EVALUATION & CONFIDENCE SCORE CALCULATION
  // ─────────────────────────────────────────────────────────────────────
  const signals: Record<string, EvaluatedSignal> = {};
  let totalScore = 0;
  let maxPossibleScore = 0;

  // Signal A: Attendance Session (Weight: 20)
  maxPossibleScore += 20;
  let sessionScore = 20;
  if (maxSessionExceeded) {
    sessionScore = 0;
  }
  signals['session'] = {
    name: 'Attendance Session Status',
    enabled: true,
    score: sessionScore,
    maxScore: 20,
    status: maxSessionExceeded ? 'EXCEEDED_MAX_DURATION' : 'ACTIVE_CHECK_IN',
    details: { checkInAt: currentCheckIn.createdAt, durationHours: sessionDurationHours.toFixed(2), maxHours },
  };
  totalScore += sessionScore;

  // Signal B: Break Status (Weight: 20)
  // If employee is on an approved break, breakScore = 20
  maxPossibleScore += 20;
  const isOnBreak = !!activeBreak;
  const breakScore = isOnBreak ? 20 : 15; // 15 when working normally
  signals['break'] = {
    name: 'Break Status',
    enabled: prefs.enableBreaks,
    score: breakScore,
    maxScore: 20,
    status: isOnBreak ? `ON_BREAK (${activeBreak.breakType})` : 'NOT_ON_BREAK',
    details: { activeBreak: activeBreak ? { id: activeBreak.id, type: activeBreak.breakType, startTime: activeBreak.startTime } : null },
  };
  totalScore += breakScore;

  // Signal C: GPS / Geofence (Weight: 20)
  if (prefs.enableGpsEvaluation) {
    maxPossibleScore += 20;
    let gpsScore = 10;
    let gpsStatus = 'UNKNOWN';

    // Rule: Ignore GPS exits during approved break if policy enables it
    if (isOnBreak && prefs.ignoreGpsDuringBreak) {
      gpsScore = 20;
      gpsStatus = 'IGNORED_DURING_APPROVED_BREAK';
    } else if (user.lastHeartbeatAt && tenant.locationLat && tenant.locationLng) {
      const hbTime = new Date(user.lastHeartbeatAt).getTime();
      const minsAgo = (now.getTime() - hbTime) / 60000;

      if (minsAgo <= 60) {
        const dist = haversineMeters(user.lastHeartbeatLat as number, user.lastHeartbeatLng as number, tenant.locationLat, tenant.locationLng);
        const radius = tenant.locationRadiusMeters || 100;
        if (dist <= radius) {
          gpsScore = 20;
          gpsStatus = `INSIDE_GEOFENCE (${Math.round(dist)}m <= ${radius}m)`;
        } else {
          gpsScore = 0;
          gpsStatus = `OUTSIDE_GEOFENCE (${Math.round(dist)}m > ${radius}m)`;
        }
      } else {
        gpsScore = 5;
        gpsStatus = 'STALE_GPS_SIGNAL';
      }
    } else {
      gpsScore = 10;
      gpsStatus = 'NO_GPS_DATA';
    }

    signals['gps'] = {
      name: 'GPS / Geofence Proximity',
      enabled: true,
      score: gpsScore,
      maxScore: 20,
      status: gpsStatus,
      details: { lat: user.lastHeartbeatLat, lng: user.lastHeartbeatLng, lastHeartbeatAt: user.lastHeartbeatAt },
    };
    totalScore += gpsScore;
  }

  // Signal D: Wi-Fi Signal (Weight: 20)
  if (prefs.enableWifiEvaluation && tenant.wifiCheckEnabled) {
    maxPossibleScore += 20;
    const wifiScore = tenant.officeIp ? 20 : 10;
    signals['wifi'] = {
      name: 'Corporate Wi-Fi',
      enabled: true,
      score: wifiScore,
      maxScore: 20,
      status: tenant.officeIp ? 'CONNECTED' : 'UNKNOWN',
    };
    totalScore += wifiScore;
  }

  // Signal E: Face Verification Freshness (Weight: 10)
  if (prefs.enableFaceEvaluation && prefs.requireFaceMatch) {
    maxPossibleScore += 10;
    const faceScore = currentCheckIn.faceMatchScore && currentCheckIn.faceMatchScore > 0.7 ? 10 : 7;
    signals['face'] = {
      name: 'Face Verification',
      enabled: true,
      score: faceScore,
      maxScore: 10,
      status: currentCheckIn.faceMatchScore ? `VERIFIED (${(currentCheckIn.faceMatchScore * 100).toFixed(0)}%)` : 'PASSED',
    };
    totalScore += faceScore;
  }

  // Signal F: EMS In-App Activity & Visibility (Weight: 20)
  if (prefs.enableBrowserActivityTracking) {
    maxPossibleScore += 20;
    let activityScore = 10;
    let activityStatus = 'NO_RECENT_ACTIVITY';

    if (user.lastActivityAt) {
      const actTime = new Date(user.lastActivityAt).getTime();
      const minsAgo = (now.getTime() - actTime) / 60000;
      if (minsAgo <= 5) {
        activityScore = 20;
        activityStatus = 'RECENT_IN_APP_INTERACTION';
      } else if (minsAgo <= 15) {
        activityScore = 15;
        activityStatus = 'MODERATE_ACTIVITY';
      } else if (minsAgo <= 30) {
        activityScore = 8;
        activityStatus = 'LOW_ACTIVITY';
      } else {
        activityScore = 0;
        activityStatus = 'INACTIVE';
      }
    }
    signals['activity'] = {
      name: 'EMS In-App Interaction',
      enabled: true,
      score: activityScore,
      maxScore: 20,
      status: activityStatus,
      details: { lastActivityAt: user.lastActivityAt },
    };
    totalScore += activityScore;
  }

  // Signal G: Heartbeat Freshness (Weight: 10)
  if (prefs.enableBrowserHeartbeat) {
    maxPossibleScore += 10;
    let hbScore = 0;
    let hbStatus = 'MISSING_HEARTBEAT';

    if (user.lastHeartbeatAt) {
      const hbTime = new Date(user.lastHeartbeatAt).getTime();
      const minsAgo = (now.getTime() - hbTime) / 60000;
      if (minsAgo <= 3) {
        hbScore = 10;
        hbStatus = 'FRESH_HEARTBEAT';
      } else if (minsAgo <= 10) {
        hbScore = 5;
        hbStatus = 'RECENT_HEARTBEAT';
      } else {
        hbScore = 0;
        hbStatus = 'STALE_HEARTBEAT';
      }
    }
    signals['heartbeat'] = {
      name: 'Heartbeat Monitor',
      enabled: true,
      score: hbScore,
      maxScore: 10,
      status: hbStatus,
      details: { lastHeartbeatAt: user.lastHeartbeatAt },
    };
    totalScore += hbScore;
  }

  // Signal H: Desktop Agent Stub Provider (Weight: 10 when present)
  if (desktopSignals) {
    maxPossibleScore += 10;
    let desktopScore = 10;
    let desktopStatus = 'ACTIVE';

    if (desktopSignals.screenLocked || (desktopSignals.desktopIdleSec && desktopSignals.desktopIdleSec > 300)) {
      desktopScore = 0;
      desktopStatus = desktopSignals.screenLocked ? 'SCREEN_LOCKED' : 'IDLE';
    }
    signals['desktop_agent'] = {
      name: 'Desktop Agent Provider',
      enabled: true,
      score: desktopScore,
      maxScore: 10,
      status: desktopStatus,
      details: desktopSignals as any,
    };
    totalScore += desktopScore;
  }

  // Final Normalized Confidence Score (0 to 100%)
  const confidenceScore = maxPossibleScore > 0
    ? Math.min(100, Math.max(0, Math.round((totalScore / maxPossibleScore) * 100)))
    : 100;

  // ─────────────────────────────────────────────────────────────────────
  // PRESENCE STATE & DECISION MACHINE
  // ─────────────────────────────────────────────────────────────────────
  let state: PresenceState = 'active_working';
  let decision: PresenceDecision = 'continue_session';
  let reason = '';

  const candidateThreshold = prefs.autoCheckoutConfidenceThreshold ?? 40;

  if (isOnBreak) {
    state = 'on_break';
    decision = 'continue_session';
    reason = `Employee is currently on an approved break (${activeBreak.breakType}).`;
  } else if (maxSessionExceeded) {
    state = 'auto_checkout_candidate';
    decision = 'auto_checkout';
    reason = `Maximum session duration of ${maxHours} hour(s) reached.`;
  } else if (isPastShiftEndGrace) {
    if (confidenceScore < candidateThreshold) {
      state = 'auto_checkout_candidate';
      decision = 'issue_warning';
      reason = `Confidence score (${confidenceScore}%) is below candidate threshold (${candidateThreshold}%) after shift end + grace period (${graceMins}m).`;
    } else {
      state = 'overtime';
      decision = 'transition_overtime';
      reason = `Active working presence confirmed during overtime (Confidence score ${confidenceScore}%).`;
    }
  } else {
    // Within normal shift hours
    if (confidenceScore >= 70) {
      state = 'active_working';
      decision = 'continue_session';
      reason = `Active working presence confirmed (Confidence score ${confidenceScore}%).`;
    } else if (confidenceScore >= 40) {
      state = 'temporarily_away';
      decision = 'continue_session';
      reason = `Temporarily away or low activity (Confidence score ${confidenceScore}%). Session remains active.`;
    } else {
      state = 'inactive';
      decision = 'continue_session';
      reason = `Inactive during shift hours (Confidence score ${confidenceScore}%). Session monitored.`;
    }
  }

  // Check for existing pending warning
  const pendingWarnings = await db.select()
    .from(schema.presenceWarnings)
    .where(
      and(
        eq(schema.presenceWarnings.tenantId, tenantId),
        eq(schema.presenceWarnings.userId, userId),
        eq(schema.presenceWarnings.attendanceLogId, activeLogId),
        eq(schema.presenceWarnings.status, 'pending')
      )
    )
    .orderBy(desc(schema.presenceWarnings.id))
    .limit(1);

  const activeWarning = pendingWarnings[0] || null;

  let warningInfo = null;
  if (activeWarning) {
    const expiresAt = new Date(activeWarning.expiresAt);
    const remainingMins = Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 60000));
    warningInfo = {
      id: activeWarning.id,
      warnedAt: activeWarning.warnedAt!,
      expiresAt,
      remainingMins,
    };
  }

  // Record presence evaluation to audit log
  await db.insert(schema.presenceEvaluations).values({
    tenantId,
    userId,
    attendanceLogId: activeLogId,
    state,
    confidenceScore,
    signalsEvaluated: signals as any,
    decision,
    reason,
    policyVersion: 'v1.0',
  });

  return {
    userId,
    tenantId,
    attendanceLogId: activeLogId,
    state,
    confidenceScore,
    decision,
    reason,
    signalsEvaluated: signals,
    policyVersion: 'v1.0',
    warning: warningInfo,
  };
}

/**
 * Runs presence auto-checkout evaluation for candidate sessions.
 * Manages warnings, warning expirations, and auto-checkouts.
 */
export async function processPresenceAutoCheckout(tenantId: number) {
  const prefs: AttendancePrefs = await resolveAttendancePreferences(tenantId);
  if (!prefs.presenceEngineEnabled) return;

  const now = new Date();
  const tenantRows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  const tenant = tenantRows[0];
  if (!tenant) return;

  const todayStart = tenantStartOfDay(tenant, now);

  // Fetch active check-ins
  const activeCheckIns = await db.execute(sql`
    WITH latest_logs AS (
      SELECT DISTINCT ON (user_id) *
      FROM attendance_logs
      WHERE tenant_id = ${tenant.id} AND created_at >= ${todayStart} AND status = 'approved'
      ORDER BY user_id, id DESC
    )
    SELECT l.*, u.name as user_name, u.email as user_email
    FROM latest_logs l
    JOIN users u ON l.user_id = u.id
    WHERE l.type = 'check_in'
  `);

  const rows = (activeCheckIns.rows || activeCheckIns) as any[];

  for (const row of rows) {
    try {
      const evalResult = await evaluateEmployeePresence(tenant.id, row.user_id, row.id);

      // Check if there is an active pending warning
      const warnings = await db.select()
        .from(schema.presenceWarnings)
        .where(
          and(
            eq(schema.presenceWarnings.tenantId, tenant.id),
            eq(schema.presenceWarnings.userId, row.user_id),
            eq(schema.presenceWarnings.attendanceLogId, row.id),
            eq(schema.presenceWarnings.status, 'pending')
          )
        )
        .orderBy(desc(schema.presenceWarnings.id))
        .limit(1);

      const pendingWarning = warnings[0] || null;

      // Case A: Hard Max Duration Exceeded OR Pending Warning Expired -> Execute Auto Checkout
      if (evalResult.decision === 'auto_checkout' || (pendingWarning && new Date(pendingWarning.expiresAt) <= now)) {
        if (pendingWarning) {
          await db.update(schema.presenceWarnings)
            .set({ status: 'executed' })
            .where(eq(schema.presenceWarnings.id, pendingWarning.id));
        }

        const checkoutReason = evalResult.decision === 'auto_checkout'
          ? evalResult.reason
          : `Auto check-out: Inactivity detected after shift end and grace period; auto-checkout warning expired without response. (Confidence Score: ${evalResult.confidenceScore}%)`;

        await db.insert(schema.attendanceLogs).values({
          userId: row.user_id,
          tenantId: tenant.id,
          status: 'approved',
          type: 'check_out',
          checkoutAt: now,
          createdAt: now,
          reason: checkoutReason,
          pendingVerification: evalResult.confidenceScore < 40,
        });

        await logToAuditLedger({
          tenantId: tenant.id,
          actorId: row.user_id,
          actorName: row.user_name,
          action: 'CHECK_OUT',
          details: {
            info: checkoutReason,
            confidenceScore: evalResult.confidenceScore,
            signals: evalResult.signalsEvaluated,
            policyVersion: evalResult.policyVersion,
          },
        });

        if (evalResult.confidenceScore < 40) {
          await raiseAttendanceAlert({
            tenantId: tenant.id,
            userId: row.user_id,
            type: 'auto_checkout_unverified',
            message: `${row.user_name} was auto-checked out due to inactivity after shift end (Confidence score: ${evalResult.confidenceScore}%).`,
          });
        }
      }
      // Case B: Decision is issue_warning & no pending warning exists -> Create Warning
      else if (evalResult.decision === 'issue_warning' && !pendingWarning) {
        const warningDelayMins = prefs.autoCheckoutDelayMins || 15;
        const expiresAt = new Date(now.getTime() + warningDelayMins * 60000);

        await db.insert(schema.presenceWarnings).values({
          tenantId: tenant.id,
          userId: row.user_id,
          attendanceLogId: row.id,
          warnedAt: now,
          expiresAt,
          status: 'pending',
        });

        // Notify employee
        await notifyUser(
          row.user_id,
          'Auto Checkout Warning',
          `No activity detected after shift end. You will be automatically checked out in ${warningDelayMins} minutes unless you confirm you are still working.`,
        ).catch(() => undefined);
      }
    } catch (err) {
      logger.error(`Presence auto checkout evaluation error for user ${row.user_id}:`, err);
    }
  }
}
