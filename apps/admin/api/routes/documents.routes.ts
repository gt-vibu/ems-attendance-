import { Router } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege, hasAnyPrivilege, getScopedBranchIds, isPlatformFeatureAllowed } from '../auth/rbac';
import { logToAuditLedger } from '../services/audit';
import { saveDocument, readDocument, deleteDocument } from '../services/documentStorage';

export const router = Router();

const CATEGORIES = ['offer_letter', 'contract', 'id_proof', 'certificate', 'other'];
const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB — plenty for a scanned ID/contract PDF, small enough to keep base64-in-JSON upload practical

// Gated two ways: the tenant admin's own on/off switch (documentsEnabled),
// AND the platform layer above it (isPlatformFeatureAllowed 'documents') —
// a super admin revoking the module for this tenant disables it immediately
// even if the tenant admin left their own toggle on.
async function documentsEnabledForTenant(tenantId: number): Promise<boolean> {
  const rows = await db.select({ documentsEnabled: schema.tenants.documentsEnabled, featuresAllowed: schema.tenants.featuresAllowed }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  return !!rows[0]?.documentsEnabled && isPlatformFeatureAllowed(rows[0] as any, 'documents');
}

// Self, or anyone holding employee.read/employee.edit/employee.create/
// reports.view, may see/manage a given employee's documents — same
// visibility convention as the rest of the employee profile
// (employees.routes.ts).
async function canAccessEmployeeDocuments(req: any, targetUserId: number): Promise<boolean> {
  if (req.user.userId === targetUserId) return true;
  return await hasAnyPrivilege(req.user, ['employee.read', 'employee.edit', 'employee.create', 'reports.view']);
}

router.post('/api/tenant/documents', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId;
    if (!await documentsEnabledForTenant(tenantId)) {
      return res.status(403).json({ error: 'Document storage is not enabled for this organization. Ask your tenant admin to turn it on in Administration.' });
    }

    const { userId, category, fileName, mimeType, fileBase64 } = req.body || {};
    const targetUserId = userId ? Number(userId) : req.user.userId;
    if (!fileName || !mimeType || !fileBase64) {
      return res.status(400).json({ error: 'fileName, mimeType, and fileBase64 are required.' });
    }
    if (!(await canAccessEmployeeDocuments(req, targetUserId))) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }

    const targetRows = await db.select().from(schema.users).where(eq(schema.users.id, targetUserId)).limit(1);
    if (targetRows.length === 0 || targetRows[0].tenantId !== tenantId) {
      return res.status(404).json({ error: 'Employee not found.' });
    }
    const scopedBranchIds = await getScopedBranchIds(req.user);
    if (scopedBranchIds !== null && targetRows[0].branchId && !scopedBranchIds.includes(targetRows[0].branchId)) {
      return res.status(403).json({ error: 'Access denied: You are not scoped to this employee\'s branch.' });
    }

    const resolvedCategory = CATEGORIES.includes(category) ? category : 'other';
    const base64Payload = String(fileBase64).includes(',') ? String(fileBase64).split(',')[1] : String(fileBase64);
    const buffer = Buffer.from(base64Payload, 'base64');
    if (buffer.length === 0) {
      return res.status(400).json({ error: 'The uploaded file is empty.' });
    }
    if (buffer.length > MAX_FILE_BYTES) {
      return res.status(400).json({ error: `File is too large. Maximum size is ${MAX_FILE_BYTES / (1024 * 1024)}MB.` });
    }

    const storagePath = await saveDocument(tenantId, buffer);

    const [doc] = await db.insert(schema.employeeDocuments).values({
      tenantId,
      userId: targetUserId,
      uploadedByUserId: req.user.userId,
      category: resolvedCategory,
      fileName: String(fileName).slice(0, 255),
      mimeType: String(mimeType).slice(0, 100),
      fileSize: buffer.length,
      storagePath,
    }).returning();

    await logToAuditLedger({
      tenantId, actorId: req.user.userId, actorName: req.user.name,
      action: 'DOCUMENT_UPLOADED',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
      details: { documentId: doc.id, employeeId: targetUserId, category: resolvedCategory, fileName: doc.fileName }
    });

    res.json({ success: true, document: { id: doc.id, userId: doc.userId, category: doc.category, fileName: doc.fileName, mimeType: doc.mimeType, fileSize: doc.fileSize, createdAt: doc.createdAt } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/tenant/documents', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId;
    if (!await documentsEnabledForTenant(tenantId)) {
      return res.json({ documents: [], enabled: false });
    }
    const targetUserId = req.query.userId ? Number(req.query.userId) : req.user.userId;
    if (!(await canAccessEmployeeDocuments(req, targetUserId))) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const rows = await db.select().from(schema.employeeDocuments)
      .where(and(eq(schema.employeeDocuments.tenantId, tenantId), eq(schema.employeeDocuments.userId, targetUserId)))
      .orderBy(desc(schema.employeeDocuments.createdAt));
    res.json({
      enabled: true,
      documents: rows.map((d) => ({ id: d.id, category: d.category, fileName: d.fileName, mimeType: d.mimeType, fileSize: d.fileSize, createdAt: d.createdAt })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/tenant/documents/:id/download', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId;
    if (!await documentsEnabledForTenant(tenantId)) {
      return res.status(403).json({ error: 'Document storage is not enabled for this organization.' });
    }
    const docRows = await db.select().from(schema.employeeDocuments).where(eq(schema.employeeDocuments.id, Number(req.params.id))).limit(1);
    if (docRows.length === 0 || docRows[0].tenantId !== tenantId) {
      return res.status(404).json({ error: 'Document not found.' });
    }
    const doc = docRows[0];
    if (!(await canAccessEmployeeDocuments(req, doc.userId))) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const buffer = await readDocument(doc.storagePath);
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${doc.fileName.replace(/["\r\n]/g, '')}"`);
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/tenant/documents/:id', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId;
    if (!await documentsEnabledForTenant(tenantId)) {
      return res.status(403).json({ error: 'Document storage is not enabled for this organization.' });
    }
    const docRows = await db.select().from(schema.employeeDocuments).where(eq(schema.employeeDocuments.id, Number(req.params.id))).limit(1);
    if (docRows.length === 0 || docRows[0].tenantId !== tenantId) {
      return res.status(404).json({ error: 'Document not found.' });
    }
    const doc = docRows[0];
    // Deletion is a step tighter than viewing: the owner, or someone who can
    // actually manage the roster (employee.create/employee.edit), not
    // merely read/report privileges.
    if (req.user.userId !== doc.userId && !(await hasAnyPrivilege(req.user, ['employee.create', 'employee.edit']))) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    await deleteDocument(doc.storagePath);
    await db.delete(schema.employeeDocuments).where(eq(schema.employeeDocuments.id, doc.id));

    await logToAuditLedger({
      tenantId, actorId: req.user.userId, actorName: req.user.name,
      action: 'DOCUMENT_DELETED',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
      details: { documentId: doc.id, employeeId: doc.userId, fileName: doc.fileName }
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
