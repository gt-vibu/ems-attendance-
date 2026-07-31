// Executes report_schedules rows for real — registers a handler on the
// existing Postgres-backed job queue (services/queue) and, separately,
// checks which schedules are due and enqueues them. This is the first real
// consumer of queue.registerHandler(); "report generation" was already
// named in the queue's own header comment as an intended use case.
//
// Only CSV is implemented (format is forced to 'csv' at creation time in
// reports.routes.ts) — a PDF/Excel exporter is real, non-trivial work
// (the existing payslip PDF route, payroll.routes.ts, has no reusable
// abstraction to build on — see this session's Reports & Analytics review)
// and wasn't built here to avoid shipping a half-working export format.
import { eq, and, lte } from 'drizzle-orm';
import { db, schema } from '../../db';
import { logger } from '../../logger';
import { queue } from './queue';
import { sendEmail } from '../../mail.js';
import { buildReportData, type ReportFilters } from './reportData';
import { buildCsv } from './reportExport';
import { notify } from './notificationService';
import { isPlatformFeatureAllowed } from '../auth/rbac';

interface ScheduledReportJobPayload {
  scheduleId: number;
}

export function registerReportSchedulerHandler() {
  queue.registerHandler('generate_scheduled_report', async (payload: ScheduledReportJobPayload) => {
    const rows = await db.select().from(schema.reportSchedules).where(eq(schema.reportSchedules.id, payload.scheduleId)).limit(1);
    const schedule = rows[0];
    if (!schedule || !schedule.active) return;

    const creatorRows = await db.select().from(schema.users).where(eq(schema.users.id, schedule.createdByUserId)).limit(1);
    const creator = creatorRows[0];
    if (!creator) return;

    const filters = (schedule.filters as ReportFilters) || { type: schedule.reportType };
    const data = await buildReportData(schedule.tenantId, creator, { ...filters, type: schedule.reportType });
    const csv = buildCsv(data.rows);
    const fileName = `${schedule.reportName.replace(/[^a-z0-9_-]+/gi, '_')}.csv`;
    const recipients: string[] = Array.isArray(schedule.recipients) ? schedule.recipients : [];

    for (const to of recipients) {
      await sendEmail({
        to,
        subject: `[Scheduled Report] ${schedule.reportName} (${new Date().toLocaleDateString()})`,
        text: `Hello,\n\nYour scheduled report "${schedule.reportName}" is attached as a CSV.\n\nRecords: ${data.rows.length}\nFrequency: ${schedule.frequency}\n\nBest regards,\nSmart Teams EMS`,
        html: `<div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #1e293b; margin-top: 0;">Scheduled Report: ${schedule.reportName}</h2>
          <p style="font-size: 14px; color: #64748b;">Frequency: ${schedule.frequency}</p>
          <p style="font-size: 14px; color: #64748b;">${data.rows.length} record(s) attached as CSV.</p>
        </div>`,
        attachments: [{ filename: fileName, content: csv, contentType: 'text/csv' }],
      }).catch((err) => logger.error('reportScheduler: delivery failed', { scheduleId: schedule.id, to, error: err?.message }));
    }

    // recipients is a free-text list of emails (not necessarily app users),
    // so it always gets the actual attachment delivered directly above —
    // notify() can't replace that. This just also gives the creator an
    // in-app + email "your scheduled report ran" ping through the unified
    // service, finally giving report_generation_completed a real caller.
    const tenantRowSched = (await db.select().from(schema.tenants).where(eq(schema.tenants.id, schedule.tenantId)).limit(1))[0];
    if (isPlatformFeatureAllowed(tenantRowSched, 'unified_notifications')) {
      await notify(schedule.tenantId, 'report_generation_completed', {
        subjectUserId: creator.id,
        subjectName: creator.name,
        data: { reportName: schedule.reportName, recordCount: data.rows.length },
      }).catch(() => undefined);
    }

    await db.update(schema.reportSchedules).set({
      lastRunAt: new Date(),
      nextRunAt: computeNextRunAt(schedule),
    }).where(eq(schema.reportSchedules.id, schedule.id));
  });
}

function computeNextRunAt(schedule: typeof schema.reportSchedules.$inferSelect): Date {
  const [hh, mm] = (schedule.timeOfDay || '08:00').split(':').map(Number);
  const next = new Date();
  next.setHours(hh || 8, mm || 0, 0, 0);
  if (schedule.frequency === 'daily') {
    if (next <= new Date()) next.setDate(next.getDate() + 1);
  } else if (schedule.frequency === 'weekly') {
    const targetDow = schedule.dayOfWeek ?? 1;
    while (next.getDay() !== targetDow || next <= new Date()) next.setDate(next.getDate() + 1);
  } else {
    const targetDom = Math.min(schedule.dayOfMonth ?? 1, 28);
    next.setDate(targetDom);
    if (next <= new Date()) next.setMonth(next.getMonth() + 1);
  }
  return next;
}

// Called from the main scheduler tick (bootstrap/scheduler.ts) — finds
// schedules whose nextRunAt has passed and enqueues exactly one job per
// due schedule, then immediately advances nextRunAt so a slow queue poll
// can't cause the same schedule to be enqueued twice before its job runs.
export async function enqueueDueReportSchedules() {
  const due = await db.select().from(schema.reportSchedules).where(and(
    eq(schema.reportSchedules.active, true),
    lte(schema.reportSchedules.nextRunAt, new Date()),
  ));
  for (const schedule of due) {
    await db.update(schema.reportSchedules).set({ nextRunAt: computeNextRunAt(schedule) }).where(eq(schema.reportSchedules.id, schedule.id));
    await queue.enqueue('generate_scheduled_report', { scheduleId: schedule.id } satisfies ScheduledReportJobPayload, { tenantId: schedule.tenantId });
  }
}
