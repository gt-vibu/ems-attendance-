import { Router } from 'express';
import { eq, and, gte, lte } from 'drizzle-orm';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';

export const router = Router();

interface CalendarEvent {
  date: string; // 'YYYY-MM-DD'
  type: 'holiday' | 'leave' | 'payroll_freeze' | 'payroll_calculation' | 'payroll_hr_review' | 'payroll_finance_review' | 'payroll_release' | 'payroll_salary_credit';
  label: string;
}

// One aggregated read across every date-bearing table this codebase
// already has — holidays, approved leave, and the payroll calendar's own
// milestone dates. Nothing new is computed or stored here; this is a
// merge-and-sort view so an admin doesn't have to open five different
// pages to see what's happening in a given month.
router.get('/api/tenant/business-calendar', authenticate, async (req: any, res: any) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const month = Number(req.query.month) || new Date().getMonth() + 1; // 1-12
    const tenantId = req.user.tenantId;

    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const [holidays, leaveRequests, payrollCalendarRows] = await Promise.all([
      db.select().from(schema.holidays).where(
        and(eq(schema.holidays.tenantId, tenantId), eq(schema.holidays.isArchived, false), gte(schema.holidays.date, monthStart), lte(schema.holidays.date, monthEnd))
      ),
      db.select().from(schema.leaveRequests).where(
        and(eq(schema.leaveRequests.tenantId, tenantId), eq(schema.leaveRequests.status, 'approved'), lte(schema.leaveRequests.startDate, monthEnd), gte(schema.leaveRequests.endDate, monthStart))
      ),
      db.select().from(schema.payrollCalendars).where(and(eq(schema.payrollCalendars.tenantId, tenantId), eq(schema.payrollCalendars.year, year), eq(schema.payrollCalendars.month, month))),
    ]);

    const userIds = Array.from(new Set(leaveRequests.map((r: any) => r.userId)));
    const users = userIds.length
      ? await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(eq(schema.users.tenantId, tenantId))
      : [];
    const nameById = new Map(users.map((u: any) => [u.id, u.name]));

    const events: CalendarEvent[] = [];

    for (const h of holidays) {
      events.push({ date: h.date, type: 'holiday', label: h.isOptional ? `${h.name} (Optional)` : h.name });
    }

    for (const lr of leaveRequests) {
      const name = nameById.get(lr.userId) || 'Employee';
      events.push({ date: lr.startDate, type: 'leave', label: `${name} — ${lr.leaveType} leave starts` });
      if (lr.endDate !== lr.startDate) {
        events.push({ date: lr.endDate, type: 'leave', label: `${name} — ${lr.leaveType} leave ends` });
      }
    }

    const cal = payrollCalendarRows[0];
    if (cal) {
      const milestones: Array<[string | null, CalendarEvent['type'], string]> = [
        [cal.attendanceFreezeDate, 'payroll_freeze', 'Attendance Freeze'],
        [cal.calculationDate, 'payroll_calculation', 'Payroll Calculation'],
        [cal.hrReviewDate, 'payroll_hr_review', 'Payroll HR Review'],
        [cal.financeReviewDate, 'payroll_finance_review', 'Payroll Finance Review'],
        [cal.releaseDate, 'payroll_release', 'Payroll Release'],
        [cal.salaryCreditDate, 'payroll_salary_credit', 'Salary Credit'],
      ];
      for (const [date, type, label] of milestones) {
        if (date) events.push({ date, type, label });
      }
    }

    events.sort((a, b) => a.date.localeCompare(b.date));

    res.json({ year, month, events });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
