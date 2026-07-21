import { Router } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege, getScopedBranchIds } from '../auth/rbac';
import { logToAuditLedger } from '../services/audit';
import { notifyUser, notifyUsers } from '../services/notifications';
import { sendTerminationRequestEmail, sendTerminationDecisionEmail } from '../../mail.js';
import { dispatchWebhookEvent } from '../services/webhooks';

export const router = Router();

// Actually flips the employee to terminated and revokes their session —
// the one place both the immediate (tenant_admin) and approved-request
// paths below converge, so a terminated employee is locked out identically
// either way.
async function performTermination(employeeId: number) {
  await db.update(schema.users)
    .set({ employeeStatus: 'terminated', activeSessionId: null, sessionExpiresAt: null })
    .where(eq(schema.users.id, employeeId));
}

// SUBMIT/EXECUTE a termination. Two very different outcomes depending on
// who's asking, both gated by the same 'employee.terminate' privilege:
//   - tenant_admin: immediate — no approval step, matches their existing
//     unrestricted authority over the org.
//   - anyone else holding the privilege (a delegated role): a reason is
//     required and nothing happens to the employee yet — it's queued for
//     the tenant_admin to Approve or Reject below.
router.post('/api/tenant/employees/:id/terminate', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'employee.terminate')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }

    const employeeId = parseInt(req.params.id, 10);
    const tenantId = req.user.tenantId;
    const { reason } = req.body || {};

    const employeeRows = await db.select().from(schema.users).where(eq(schema.users.id, employeeId)).limit(1);
    if (employeeRows.length === 0) {
      return res.status(404).json({ error: 'Employee not found.' });
    }
    const employee = employeeRows[0];
    if (employee.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Access denied: This employee belongs to another organization.' });
    }
    if (employee.role === 'tenant_admin' || employee.role === 'super_admin') {
      return res.status(400).json({ error: 'Admin accounts cannot be terminated here. A super admin can remove a tenant admin from the platform view.' });
    }
    if (employee.employeeStatus === 'terminated') {
      return res.status(400).json({ error: 'This employee has already been terminated.' });
    }

    const scopedBranchIds = await getScopedBranchIds(req.user);
    if (scopedBranchIds !== null && employee.branchId && !scopedBranchIds.includes(employee.branchId)) {
      return res.status(403).json({ error: 'Access denied: You are not scoped to this employee\'s branch.' });
    }

    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const deviceInfo = req.headers['user-agent'] || '';

    // Immediate path — tenant_admin only.
    if (req.user.role === 'tenant_admin') {
      await performTermination(employeeId);
      await logToAuditLedger({
        tenantId, actorId: req.user.userId, actorName: req.user.name,
        action: 'EMPLOYEE_TERMINATED', ipAddress, deviceInfo,
        details: { employeeId, employeeName: employee.name, reason: reason || null, immediate: true }
      });
      dispatchWebhookEvent(tenantId, 'employee.terminated', { employeeId, employeeName: employee.name, immediate: true });
      return res.json({ success: true, terminated: true });
    }

    // Delegated path — requires a reason, queued for tenant_admin approval.
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'A reason is required when requesting a termination.' });
    }

    const [request] = await db.insert(schema.terminationRequests).values({
      tenantId,
      employeeId,
      requestedByUserId: req.user.userId,
      reason: String(reason).trim(),
    }).returning();

    await logToAuditLedger({
      tenantId, actorId: req.user.userId, actorName: req.user.name,
      action: 'EMPLOYEE_TERMINATION_REQUESTED', ipAddress, deviceInfo,
      details: { requestId: request.id, employeeId, employeeName: employee.name, reason: request.reason }
    });

    const admins = await db.select().from(schema.users).where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.role, 'tenant_admin')));
    await notifyUsers(admins.map(a => a.id), 'Termination request awaiting your approval', `${req.user.name} has requested to terminate ${employee.name}.`);
    for (const admin of admins) {
      await sendTerminationRequestEmail(admin.email, admin.name, employee.name, req.user.name, request.reason);
    }

    res.json({ success: true, pending: true, requestId: request.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Approver queue — gated by the delegable 'employee.terminate.approve'
// privilege (tenant_admin holds it implicitly, and may delegate it).
router.get('/api/tenant/termination-requests', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'employee.terminate.approve')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }

    const rows = await db.select().from(schema.terminationRequests)
      .where(and(eq(schema.terminationRequests.tenantId, req.user.tenantId), eq(schema.terminationRequests.status, 'pending')))
      .orderBy(desc(schema.terminationRequests.createdAt));

    const userIds = [...new Set(rows.flatMap(r => [r.employeeId, r.requestedByUserId]))];
    const users = userIds.length > 0 ? await db.select().from(schema.users).where(eq(schema.users.tenantId, req.user.tenantId)) : [];
    const userMap = new Map<number, any>(users.map(u => [u.id, u]));

    res.json({
      requests: rows.map(r => ({
        id: r.id,
        employeeId: r.employeeId,
        employeeName: userMap.get(r.employeeId)?.name || 'Unknown',
        requestedByUserId: r.requestedByUserId,
        requestedByName: userMap.get(r.requestedByUserId)?.name || 'Unknown',
        reason: r.reason,
        createdAt: r.createdAt,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/tenant/termination-requests/action', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'employee.terminate.approve')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }

    const { requestId, action } = req.body || {};
    if (!requestId || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'requestId and a valid action (approve|reject) are required.' });
    }

    const rows = await db.select().from(schema.terminationRequests).where(eq(schema.terminationRequests.id, requestId)).limit(1);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Termination request not found.' });
    }
    const request = rows[0];
    if (request.tenantId !== req.user.tenantId) {
      return res.status(403).json({ error: 'Access denied: This request belongs to another organization.' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'This request has already been reviewed.' });
    }

    const status = action === 'approve' ? 'approved' : 'rejected';
    await db.update(schema.terminationRequests)
      .set({ status, reviewedByUserId: req.user.userId, reviewedAt: new Date() })
      .where(eq(schema.terminationRequests.id, requestId));

    const [employee, requester] = await Promise.all([
      db.select().from(schema.users).where(eq(schema.users.id, request.employeeId)).limit(1).then(r => r[0]),
      db.select().from(schema.users).where(eq(schema.users.id, request.requestedByUserId)).limit(1).then(r => r[0]),
    ]);

    if (action === 'approve' && employee) {
      await performTermination(request.employeeId);
      dispatchWebhookEvent(req.user.tenantId, 'employee.terminated', { employeeId: request.employeeId, employeeName: employee.name, immediate: false });
    }

    await logToAuditLedger({
      tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name,
      action: action === 'approve' ? 'EMPLOYEE_TERMINATION_APPROVED' : 'EMPLOYEE_TERMINATION_REJECTED',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
      details: { requestId, employeeId: request.employeeId, employeeName: employee?.name }
    });

    if (requester && employee) {
      await notifyUser(requester.id, `Termination request ${status}`, `Your request to terminate ${employee.name} was ${status}.`);
      await sendTerminationDecisionEmail(requester.email, requester.name, employee.name, status);
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
