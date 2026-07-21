import { Router } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege } from '../auth/rbac';
import { resolveEscalationAssignee, resolveNextEscalation } from '../services/escalation';
import { notifyUser } from '../services/notifications';
import { sendEmail } from '../../mail.js';
import { logToAuditLedger } from '../services/audit';
import { dispatchWebhookEvent } from '../services/webhooks';
import { editAttendanceDay, amendLeaveRequest } from '../services/recordEdits';

export const router = Router();

const CATEGORIES = ['attendance_dispute', 'leave_dispute', 'payroll_dispute', 'other'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

async function notifyAssignee(assigneeUserId: number, title: string, message: string) {
  await notifyUser(assigneeUserId, title, message);
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, assigneeUserId)).limit(1);
  if (rows[0]?.email) {
    await sendEmail({ to: rows[0].email, subject: title, text: message, html: `<p>${message}</p>` }).catch(() => undefined);
  }
}

// Raise a ticket — any authenticated employee, no privilege required (same
// "self-service, no toggle needed" convention as leave requests/corrections
// elsewhere). Priority is entirely the raiser's own call, as asked — it
// only affects how the ticket is presented to the resolver, never routing
// (routing is always manager -> GM -> tenant_admin regardless of urgency,
// so an "urgent" ticket still can't jump straight to the admin — it can
// only get there faster via the resolver escalating it or the 24h timeout).
router.post('/api/tickets', authenticate, async (req: any, res: any) => {
  try {
    const { category, priority, subject, description, relatedDate, relatedAttendanceLogId, relatedLeaveRequestId } = req.body || {};
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: `category must be one of: ${CATEGORIES.join(', ')}` });
    if (priority !== undefined && !PRIORITIES.includes(priority)) return res.status(400).json({ error: `priority must be one of: ${PRIORITIES.join(', ')}` });
    if (!subject || !String(subject).trim()) return res.status(400).json({ error: 'subject is required' });
    if (!description || !String(description).trim()) return res.status(400).json({ error: 'description is required' });

    const tenantId = req.user.tenantId;
    const assignee = await resolveEscalationAssignee(tenantId, req.user.userId, 0);

    const [ticket] = await db.insert(schema.tickets).values({
      tenantId,
      raisedByUserId: req.user.userId,
      category,
      priority: priority || 'medium',
      subject: String(subject).trim(),
      description: String(description).trim(),
      relatedAttendanceLogId: relatedAttendanceLogId ? Number(relatedAttendanceLogId) : null,
      relatedLeaveRequestId: relatedLeaveRequestId ? Number(relatedLeaveRequestId) : null,
      relatedDate: relatedDate || null,
      status: 'open',
      escalationLevel: assignee.level,
      currentAssigneeUserId: assignee.userId,
      lastAssignedAt: new Date(),
    }).returning();

    await logToAuditLedger({
      tenantId, actorId: req.user.userId, actorName: req.user.name,
      action: 'TICKET_RAISED', ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '', deviceInfo: req.headers['user-agent'] || '',
      details: { ticketId: ticket.id, category, priority: ticket.priority, assigneeUserId: assignee.userId },
    });
    dispatchWebhookEvent(tenantId, 'ticket.raised', { ticketId: ticket.id, category, priority: ticket.priority, raisedByUserId: req.user.userId, assigneeUserId: assignee.userId });
    await notifyAssignee(assignee.userId, `New ${ticket.priority} priority ticket: ${ticket.subject}`, `${req.user.name} raised a ${category.replace('_', ' ')} ticket: "${ticket.description}"`);

    res.status(201).json({ ticket });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/tickets/mine', authenticate, async (req: any, res: any) => {
  try {
    const rows = await db.select().from(schema.tickets).where(eq(schema.tickets.raisedByUserId, req.user.userId)).orderBy(desc(schema.tickets.createdAt));
    res.json({ tickets: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Tickets currently routed to me, plus — for anyone holding the
// tenant-wide 'tickets.manage' override — every ticket regardless of who
// it's assigned to (an oversight view, not a routing change).
router.get('/api/tenant/tickets', authenticate, async (req: any, res: any) => {
  try {
    const canManageAll = await hasPrivilege(req.user, 'tickets.manage');
    const rows = canManageAll
      ? await db.select().from(schema.tickets).where(eq(schema.tickets.tenantId, req.user.tenantId)).orderBy(desc(schema.tickets.createdAt))
      : await db.select().from(schema.tickets).where(and(eq(schema.tickets.tenantId, req.user.tenantId), eq(schema.tickets.currentAssigneeUserId, req.user.userId))).orderBy(desc(schema.tickets.createdAt));

    const userIds = [...new Set(rows.flatMap((t: any) => [t.raisedByUserId, t.currentAssigneeUserId].filter(Boolean)))];
    const users = userIds.length > 0 ? await db.select().from(schema.users).where(eq(schema.users.tenantId, req.user.tenantId)) : [];
    const userMap = new Map<number, any>(users.map((u: any) => [u.id, u]));

    res.json({
      tickets: rows.map((t: any) => ({
        ...t,
        raisedByName: userMap.get(t.raisedByUserId)?.name || 'Unknown',
        currentAssigneeName: t.currentAssigneeUserId ? (userMap.get(t.currentAssigneeUserId)?.name || 'Unknown') : null,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Resolve/reject/escalate — must be the ticket's current assignee, or hold
// the tenant-wide 'tickets.manage' override. Resolving an attendance_dispute
// or leave_dispute ticket can optionally include the actual correction
// (attendanceEdit/leaveEdit) in the SAME call — it's applied via the exact
// same editAttendanceDay()/amendLeaveRequest() helpers the standalone edit
// endpoints use, so the fix reflects in attendance/leave history and
// payroll immediately, not as a separate manual step.
router.post('/api/tenant/tickets/:id/action', authenticate, async (req: any, res: any) => {
  try {
    const ticketId = Number(req.params.id);
    const rows = await db.select().from(schema.tickets).where(and(eq(schema.tickets.id, ticketId), eq(schema.tickets.tenantId, req.user.tenantId))).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Ticket not found.' });
    const ticket = rows[0];

    const canManageAll = await hasPrivilege(req.user, 'tickets.manage');
    if (ticket.currentAssigneeUserId !== req.user.userId && !canManageAll) {
      return res.status(403).json({ error: 'Access denied: This ticket is not assigned to you.' });
    }
    if (ticket.status !== 'open') {
      return res.status(400).json({ error: 'This ticket has already been resolved.' });
    }

    const { action, resolutionNote, attendanceEdit, leaveEdit } = req.body || {};
    if (!['resolve', 'reject', 'escalate'].includes(action)) {
      return res.status(400).json({ error: 'action must be one of: resolve, reject, escalate' });
    }
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const deviceInfo = req.headers['user-agent'] || '';

    if (action === 'escalate') {
      const next = await resolveNextEscalation(req.user.tenantId, ticket.raisedByUserId, ticket.escalationLevel as 0 | 1 | 2);
      if (!next) return res.status(400).json({ error: 'This ticket is already at the highest escalation level.' });

      await db.insert(schema.ticketEscalations).values({
        ticketId, fromUserId: req.user.userId, toUserId: next.userId,
        fromLevel: ticket.escalationLevel, toLevel: next.level, reason: 'manual',
      });
      await db.update(schema.tickets).set({ escalationLevel: next.level, currentAssigneeUserId: next.userId, lastAssignedAt: new Date(), updatedAt: new Date() }).where(eq(schema.tickets.id, ticketId));

      await logToAuditLedger({ tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name, action: 'TICKET_ESCALATED', ipAddress, deviceInfo, details: { ticketId, toLevel: next.level, toUserId: next.userId } });
      dispatchWebhookEvent(req.user.tenantId, 'ticket.escalated', { ticketId, toLevel: next.level, toUserId: next.userId });
      await notifyAssignee(next.userId, `Ticket escalated to you: ${ticket.subject}`, `A ${ticket.priority} priority ticket was escalated to you by ${req.user.name}.`);

      const [updated] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, ticketId)).limit(1);
      return res.json({ success: true, ticket: updated });
    }

    // resolve or reject — being the assignee is enough to resolve/reject a
    // ticket, but actually EDITING attendance/leave records still requires
    // the same dedicated privilege the standalone edit endpoints require
    // ('attendance.edit'/'leave.edit') — being routed a ticket never itself
    // grants a capability that toggle gates.
    if (action === 'resolve' && attendanceEdit) {
      if (!await hasPrivilege(req.user, 'attendance.edit')) {
        return res.status(403).json({ error: "Access denied: You need the 'Edit Attendance Records' permission to apply this correction." });
      }
      if (!ticket.relatedDate) return res.status(400).json({ error: 'This ticket has no related date to apply an attendance edit to.' });
      if (!['present', 'absent'].includes(attendanceEdit.newStatus)) return res.status(400).json({ error: "attendanceEdit.newStatus must be 'present' or 'absent'." });
      await editAttendanceDay({
        tenantId: req.user.tenantId,
        targetUserId: ticket.raisedByUserId,
        date: ticket.relatedDate,
        newStatus: attendanceEdit.newStatus,
        checkInTime: attendanceEdit.checkInTime,
        checkOutTime: attendanceEdit.checkOutTime,
        editedByUserId: req.user.userId,
        editedByName: req.user.name,
        reason: resolutionNote || `Resolved via ticket #${ticketId}`,
        ticketId,
        ipAddress, deviceInfo,
      });
    }
    if (action === 'resolve' && leaveEdit) {
      if (!await hasPrivilege(req.user, 'leave.edit')) {
        return res.status(403).json({ error: "Access denied: You need the 'Amend Leave History' permission to apply this correction." });
      }
      if (!ticket.relatedLeaveRequestId) return res.status(400).json({ error: 'This ticket has no related leave request to amend.' });
      await amendLeaveRequest({
        tenantId: req.user.tenantId,
        leaveRequestId: ticket.relatedLeaveRequestId,
        newStatus: leaveEdit.newStatus,
        startDate: leaveEdit.startDate,
        endDate: leaveEdit.endDate,
        leaveType: leaveEdit.leaveType,
        editedByUserId: req.user.userId,
        editedByName: req.user.name,
        reason: resolutionNote || `Resolved via ticket #${ticketId}`,
        ticketId,
        ipAddress, deviceInfo,
      });
    }

    const newStatus = action === 'resolve' ? 'resolved' : 'rejected';
    const [updated] = await db.update(schema.tickets).set({
      status: newStatus, resolvedByUserId: req.user.userId, resolvedAt: new Date(), resolutionNote: resolutionNote || null, updatedAt: new Date(),
    }).where(eq(schema.tickets.id, ticketId)).returning();

    await logToAuditLedger({ tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name, action: 'TICKET_' + newStatus.toUpperCase(), ipAddress, deviceInfo, details: { ticketId, resolutionNote: resolutionNote || null } });
    dispatchWebhookEvent(req.user.tenantId, 'ticket.resolved', { ticketId, status: newStatus, resolvedByUserId: req.user.userId });
    await notifyUser(ticket.raisedByUserId, `Your ticket was ${newStatus}`, resolutionNote || `${req.user.name} ${newStatus} your ticket: ${ticket.subject}`);

    res.json({ success: true, ticket: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
