import { Router } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db, schema } from '../../db';
import { logger } from '../../logger';
import { authenticate } from '../middleware/authenticate';
import { evaluateEmployeePresence, processPresenceAutoCheckout } from '../services/presenceEngine';
import { logToAuditLedger } from '../services/audit';

export const router = Router();

// ─────────────────────────────────────────────────────────────────────
// POST /api/attendance/heartbeat
// Periodic heartbeat sent by the frontend while the employee is checked in.
// Updates user activity & heartbeat timestamps and returns live presence evaluation.
// ─────────────────────────────────────────────────────────────────────
router.post('/api/attendance/heartbeat', authenticate, async (req: any, res: any) => {
  try {
    const { lat, lng, lastInteractionTs } = req.body;
    const userId = req.user.userId;
    const tenantId = req.user.tenantId;
    const now = new Date();

    const updates: any = {
      lastHeartbeatAt: now,
      lastActivityAt: lastInteractionTs ? new Date(lastInteractionTs) : now,
    };

    if (typeof lat === 'number' && typeof lng === 'number') {
      updates.lastHeartbeatLat = lat;
      updates.lastHeartbeatLng = lng;
    }

    await db.update(schema.users)
      .set(updates)
      .where(eq(schema.users.id, userId));

    // Evaluate current presence
    const evalResult = await evaluateEmployeePresence(tenantId, userId);

    res.json({
      status: 'ok',
      presenceState: evalResult.state,
      confidenceScore: evalResult.confidenceScore,
      warning: evalResult.warning || null,
      signals: evalResult.signalsEvaluated,
    });
  } catch (err: any) {
    logger.error('POST /api/attendance/heartbeat error:', err);
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/attendance/presence/confirm-working
// Called when the employee clicks "[Continue Working]" on an auto-checkout warning.
// Dismisses the active pending warning and resets presence to active_working.
// ─────────────────────────────────────────────────────────────────────
router.post('/api/attendance/presence/confirm-working', authenticate, async (req: any, res: any) => {
  try {
    const userId = req.user.userId;
    const tenantId = req.user.tenantId;
    const now = new Date();

    // 1. Update activity timestamp
    await db.update(schema.users)
      .set({ lastActivityAt: now, lastHeartbeatAt: now })
      .where(eq(schema.users.id, userId));

    // 2. Mark any pending warnings for this user as dismissed
    await db.update(schema.presenceWarnings)
      .set({ status: 'dismissed' })
      .where(
        and(
          eq(schema.presenceWarnings.tenantId, tenantId),
          eq(schema.presenceWarnings.userId, userId),
          eq(schema.presenceWarnings.status, 'pending')
        )
      );

    await logToAuditLedger({
      tenantId,
      actorId: userId,
      actorName: req.user.name || req.user.email || 'Employee',
      action: 'PRESENCE_WARNING_DISMISSED',
      details: { info: 'Employee explicitly confirmed they are still working.' },
    });

    // Re-evaluate presence
    const evalResult = await evaluateEmployeePresence(tenantId, userId);

    res.json({
      message: 'Working session confirmed and extended.',
      presenceState: evalResult.state,
      confidenceScore: evalResult.confidenceScore,
    });
  } catch (err: any) {
    logger.error('POST /api/attendance/presence/confirm-working error:', err);
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/attendance/presence/status
// Returns the employee's current presence evaluation and warning status.
// ─────────────────────────────────────────────────────────────────────
router.get('/api/attendance/presence/status', authenticate, async (req: any, res: any) => {
  try {
    const userId = req.user.userId;
    const tenantId = req.user.tenantId;

    const evalResult = await evaluateEmployeePresence(tenantId, userId);

    res.json({
      presenceState: evalResult.state,
      confidenceScore: evalResult.confidenceScore,
      decision: evalResult.decision,
      reason: evalResult.reason,
      warning: evalResult.warning || null,
      signals: evalResult.signalsEvaluated,
    });
  } catch (err: any) {
    logger.error('GET /api/attendance/presence/status error:', err);
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
});
