import { Router } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db, schema } from '../../db';
import { logger } from '../../logger';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege } from '../auth/rbac';
import { sendEmail } from '../../mail.js';
import { buildReportData, type ReportFilters } from '../services/reportData';
import { buildCsv } from '../services/reportExport';

export const router = Router();

/**
 * GET /api/reports/data — the main Reports & Analytics data endpoint.
 * See services/reportData.ts for the actual query logic (shared with the
 * scheduled-report job handler, services/reportScheduler.ts).
 */
router.get('/api/reports/data', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant context required' });
    // No blanket privilege gate here beyond authentication — getPermittedUserIds
    // (reportData.ts) already scopes what a caller can see: a plain employee
    // is restricted to their own rows, a manager to their reports, and
    // 'reports.view'/'employee.read' holders get tenant-wide access. Payroll
    // report rows have their own additional 'payroll.read' gate inside
    // buildReportData regardless of this endpoint's scoping.

    const filters: ReportFilters = {
      type: (req.query.type as string) || 'attendance',
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      department: req.query.department as string,
      branchId: req.query.branchId ? Number(req.query.branchId) : null,
      employeeId: req.query.employeeId ? Number(req.query.employeeId) : null,
      status: req.query.status as string,
      search: req.query.search as string,
      wfhOnly: req.query.wfh === 'true',
      lateOnly: req.query.late === 'true',
      overtimeOnly: req.query.overtime === 'true',
    };

    const data = await buildReportData(tenantId, req.user, filters);
    return res.json(data);
  } catch (err: any) {
    logger.error('Error generating report data:', err);
    return res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Failed to generate report data: ' + err.message });
  }
});

/**
 * GET/POST /api/reports/saved-templates — real persistence
 * (report_saved_templates table), replacing the earlier in-memory-only
 * prototype that was wiped on every server restart.
 */
router.get('/api/reports/saved-templates', authenticate, async (req: any, res: any) => {
  try {
    const list = await db.select().from(schema.reportSavedTemplates)
      .where(and(eq(schema.reportSavedTemplates.tenantId, req.user.tenantId), eq(schema.reportSavedTemplates.createdByUserId, req.user.userId)))
      .orderBy(desc(schema.reportSavedTemplates.createdAt));
    return res.json({ templates: list });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/api/reports/saved-templates', authenticate, async (req: any, res: any) => {
  try {
    const { name, type, filters } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Template name is required' });
    const [created] = await db.insert(schema.reportSavedTemplates).values({
      tenantId: req.user.tenantId,
      createdByUserId: req.user.userId,
      name,
      reportType: type || 'attendance',
      filters: filters || {},
    }).returning();
    return res.json({ success: true, template: created });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/api/reports/saved-templates/:id', authenticate, async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id, 10);
    const rows = await db.select().from(schema.reportSavedTemplates).where(eq(schema.reportSavedTemplates.id, id)).limit(1);
    if (rows.length === 0 || rows[0].tenantId !== req.user.tenantId || rows[0].createdByUserId !== req.user.userId) {
      return res.status(404).json({ error: 'Template not found.' });
    }
    await db.delete(schema.reportSavedTemplates).where(eq(schema.reportSavedTemplates.id, id));
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET/POST /api/reports/schedules — real persistence (report_schedules
 * table) AND actually executed: see services/reportScheduler.ts, which
 * checks for due schedules on the existing background-scheduler tick and
 * enqueues a real job on the Postgres-backed queue (services/queue) that
 * generates the report and emails a real CSV attachment. The earlier
 * in-memory version stored config that nothing ever read.
 */
router.get('/api/reports/schedules', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'reports.schedule') && !await hasPrivilege(req.user, 'reports.view')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const list = await db.select().from(schema.reportSchedules).where(eq(schema.reportSchedules.tenantId, req.user.tenantId)).orderBy(desc(schema.reportSchedules.createdAt));
    return res.json({ schedules: list });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/api/reports/schedules', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'reports.schedule')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const { reportName, reportType, filters, frequency, dayOfWeek, dayOfMonth, timeOfDay, recipients, format } = req.body || {};
    if (!reportName || !recipients) return res.status(400).json({ error: 'Report name and recipients are required' });
    if (!['daily', 'weekly', 'monthly'].includes(frequency)) return res.status(400).json({ error: 'frequency must be daily, weekly, or monthly' });

    const recipientList = Array.isArray(recipients) ? recipients : String(recipients).split(',').map((r: string) => r.trim()).filter(Boolean);
    const [created] = await db.insert(schema.reportSchedules).values({
      tenantId: req.user.tenantId,
      createdByUserId: req.user.userId,
      reportName,
      reportType: reportType || 'attendance',
      filters: filters || {},
      frequency,
      dayOfWeek: frequency === 'weekly' ? Number(dayOfWeek ?? 1) : null,
      dayOfMonth: frequency === 'monthly' ? Number(dayOfMonth ?? 1) : null,
      timeOfDay: timeOfDay || '08:00',
      recipients: recipientList,
      format: 'csv', // only export format actually implemented server-side today — see reportScheduler.ts
      nextRunAt: new Date(), // due immediately; the scheduler check corrects this to the real next occurrence after the first run
    }).returning();
    return res.json({ success: true, schedule: created });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/api/reports/schedules/:id', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'reports.schedule')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const id = parseInt(req.params.id, 10);
    const rows = await db.select().from(schema.reportSchedules).where(eq(schema.reportSchedules.id, id)).limit(1);
    if (rows.length === 0 || rows[0].tenantId !== req.user.tenantId) return res.status(404).json({ error: 'Schedule not found.' });
    await db.delete(schema.reportSchedules).where(eq(schema.reportSchedules.id, id));
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/reports/export-email — emails the CURRENTLY VIEWED report as a
 * real CSV attachment (built server-side from the same filters, so it
 * matches what's on screen), not a JSON dump of the summary object like the
 * earlier version sent.
 */
router.post('/api/reports/export-email', authenticate, async (req: any, res: any) => {
  try {
    const { recipientEmail, reportTitle, filters } = req.body || {};
    const emailTo = recipientEmail || req.user.email;
    const tenantId = req.user.tenantId;

    const data = await buildReportData(tenantId, req.user, (filters || {}) as ReportFilters);
    const csv = buildCsv(data.rows);
    const fileName = `${(reportTitle || 'report').replace(/[^a-z0-9_-]+/gi, '_')}.csv`;

    await sendEmail({
      to: emailTo,
      subject: `[EMS Report] ${reportTitle || 'Report Export'} (${new Date().toLocaleDateString()})`,
      text: `Hello,\n\nYour requested report "${reportTitle}" is attached as a CSV.\n\nGenerated by: ${req.user.email}\nDate: ${new Date().toLocaleString()}\nRecords: ${data.rows.length}\n\nBest regards,\nSmart Teams EMS`,
      html: `<div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #1e293b; margin-top: 0;">Smart Teams Operational Report</h2>
        <p style="font-size: 14px; color: #64748b;">Report: <strong>${reportTitle}</strong></p>
        <p style="font-size: 14px; color: #64748b;">Generated On: ${new Date().toLocaleString()}</p>
        <p style="font-size: 14px; color: #64748b;">Requested By: ${req.user.email}</p>
        <p style="font-size: 14px; color: #64748b;">${data.rows.length} record(s) attached as CSV.</p>
        <p style="font-size: 12px; color: #94a3b8;">Confidential document — generated automatically by Smart Teams EMS.</p>
      </div>`,
      attachments: [{ filename: fileName, content: csv, contentType: 'text/csv' }],
    });

    return res.json({ success: true, message: `Report sent to ${emailTo}`, recordCount: data.rows.length });
  } catch (err: any) {
    logger.error('Failed to email report:', err);
    return res.status(500).json({ error: 'Failed to email report: ' + err.message });
  }
});
