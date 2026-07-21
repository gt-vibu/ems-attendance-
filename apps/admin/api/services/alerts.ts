import { db, schema } from '../../db';
import { resolveEscalationAssignee } from './escalation';
import { notifyUser } from './notifications';

// Every attendanceAlerts row is routed to exactly one accountable resolver
// at a time — the subject employee's manager first, then the tenant's GM,
// then tenant_admin as the backstop (see escalation.ts) — instead of the
// old "broadcast to everyone holding alerts.receive" model. The scheduler's
// 24h auto-forward job (bootstrap/scheduler.ts) walks escalationLevel
// forward for anything still 'pending' past its deadline, exactly mirroring
// how `tickets` escalate.
export interface RaiseAlertParams {
  tenantId: number;
  userId: number; // the employee the alert is about
  type: string;
  message: string;
  breakSessionId?: number;
}

export async function raiseAttendanceAlert(params: RaiseAlertParams) {
  const { tenantId, userId, type, message, breakSessionId } = params;
  const assignee = await resolveEscalationAssignee(tenantId, userId);

  const [alert] = await db.insert(schema.attendanceAlerts).values({
    tenantId,
    userId,
    breakSessionId,
    type,
    message,
    status: 'pending',
    escalationLevel: assignee.level,
    currentAssigneeUserId: assignee.userId,
    lastAssignedAt: new Date(),
  }).returning();

  await notifyUser(assignee.userId, 'New attendance alert assigned to you', message);

  return alert;
}
