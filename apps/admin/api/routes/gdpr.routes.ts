import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege } from '../auth/rbac';
import { logToAuditLedger } from '../services/audit';
import { deleteDocument } from '../services/documentStorage';

export const router = Router();

// Self-service "export my data" — every table that stores something about
// the caller, gathered into one JSON document. No privilege required
// (self-scoped only, same reasoning as /api/leave/mine, /api/payroll/mine,
// /api/audit/mine elsewhere in this codebase).
router.get('/api/employees/me/data-export', authenticate, async (req: any, res: any) => {
  try {
    const userId = req.user.userId;
    const tenantId = req.user.tenantId;

    const [
      profileRows, attendanceLogs, leaveRequests, leaveBalanceAdjustments,
      breakSessions, attendanceCorrections, homeLocations, compensationHistory,
      documents, shiftSwaps, encashmentRequests,
    ] = await Promise.all([
      db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1),
      db.select().from(schema.attendanceLogs).where(eq(schema.attendanceLogs.userId, userId)),
      db.select().from(schema.leaveRequests).where(eq(schema.leaveRequests.userId, userId)),
      db.select().from(schema.leaveBalanceAdjustments).where(eq(schema.leaveBalanceAdjustments.userId, userId)),
      db.select().from(schema.breakSessions).where(eq(schema.breakSessions.userId, userId)),
      db.select().from(schema.attendanceCorrections).where(eq(schema.attendanceCorrections.userId, userId)),
      db.select().from(schema.employeeHomeLocations).where(eq(schema.employeeHomeLocations.userId, userId)),
      db.select().from(schema.compensationHistory).where(eq(schema.compensationHistory.userId, userId)),
      db.select().from(schema.employeeDocuments).where(eq(schema.employeeDocuments.userId, userId)),
      db.select().from(schema.shiftSwapRequests).where(eq(schema.shiftSwapRequests.requesterId, userId)),
      db.select().from(schema.leaveEncashmentRequests).where(eq(schema.leaveEncashmentRequests.userId, userId)),
    ]);

    if (profileRows.length === 0) return res.status(404).json({ error: 'User not found.' });
    // Never include the password hash or history in an export a browser
    // will download to disk, even though it's a hash — no reason to hand
    // it out at all.
    const { password, tempPassword, passwordHistory, ...profile } = profileRows[0] as any;

    await logToAuditLedger({
      tenantId, actorId: userId, actorName: req.user.name,
      action: 'DATA_EXPORT_REQUESTED', ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '', details: {}
    });

    res.setHeader('Content-Disposition', `attachment; filename="my-data-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      profile,
      attendanceLogs,
      leaveRequests,
      leaveBalanceAdjustments,
      breakSessions,
      attendanceCorrections,
      homeLocations,
      compensationHistory,
      documents: documents.map((d) => ({ id: d.id, category: d.category, fileName: d.fileName, mimeType: d.mimeType, fileSize: d.fileSize, createdAt: d.createdAt })),
      shiftSwapRequestsAsRequester: shiftSwaps,
      leaveEncashmentRequests: encashmentRequests,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Right to erasure — gated by the delegable 'gdpr.manage' privilege
// (tenant_admin holds it implicitly), and only for an already-terminated
// employee (this scrubs direct identifiers, it doesn't undo a still-active
// employment relationship). Attendance/payroll NUMERIC history is
// deliberately kept, unmodified — most jurisdictions' "right to erasure"
// carves out an exception for records a business is legally required to
// retain (tax, labor law), and this app has no real payout/disbursement
// mechanism to unwind regardless (see compensationHistory/payrollRuns).
// What's actually erased: name/email/phone/department/designation on the
// user row, any uploaded documents (and their on-disk files), and the
// WebAuthn device credential.
router.post('/api/tenant/employees/:id/erase-data', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'gdpr.manage')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const employeeId = parseInt(req.params.id, 10);
    const tenantId = req.user.tenantId;

    const rows = await db.select().from(schema.users).where(eq(schema.users.id, employeeId)).limit(1);
    if (rows.length === 0 || rows[0].tenantId !== tenantId) {
      return res.status(404).json({ error: 'Employee not found.' });
    }
    const employee = rows[0];
    if (employee.employeeStatus !== 'terminated') {
      return res.status(400).json({ error: 'This employee must be terminated before their data can be erased.' });
    }
    if (employee.dataErasedAt) {
      return res.status(400).json({ error: 'This employee\'s data has already been erased.' });
    }

    const documents = await db.select().from(schema.employeeDocuments).where(eq(schema.employeeDocuments.userId, employeeId));
    for (const doc of documents) {
      await deleteDocument(doc.storagePath).catch(() => {});
    }
    await db.delete(schema.employeeDocuments).where(eq(schema.employeeDocuments.userId, employeeId));
    await db.delete(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.userId, employeeId));
    await db.delete(schema.webauthnChallenges).where(eq(schema.webauthnChallenges.userId, employeeId));

    await db.update(schema.users).set({
      name: 'Deleted User',
      email: `deleted-user-${employeeId}@erased.invalid`,
      phone: null,
      department: null,
      designation: null,
      registeredDeviceId: null,
      passwordHistory: null,
      dataErasedAt: new Date(),
    }).where(eq(schema.users.id, employeeId));

    await logToAuditLedger({
      tenantId, actorId: req.user.userId, actorName: req.user.name,
      action: 'EMPLOYEE_DATA_ERASED', ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '', details: { employeeId, documentsDeleted: documents.length }
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
