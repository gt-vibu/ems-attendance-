import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db, schema } from '../../db';

// Attendance percentage for a user, computed from working days so far this
// calendar month (excludes weekends per tenant.weekendConfig and holidays
// from the existing holidays table) vs. approved check-ins on those days.
// Not stored — computed on demand for both the self-service endpoint and
// the daily low-attendance alert cron.
export async function computeAttendancePercent(userId: number, tenant: any, asOfDate: Date = new Date()): Promise<{ percentage: number, daysPresent: number, workingDaysSoFar: number }> {
  const weekendDays: string[] = Array.isArray(tenant.weekendConfig)
    ? tenant.weekendConfig
    : (typeof tenant.weekendConfig === 'string' ? JSON.parse(tenant.weekendConfig) : ['Saturday', 'Sunday']);

  const monthStart = new Date(asOfDate.getFullYear(), asOfDate.getMonth(), 1);
  monthStart.setHours(0, 0, 0, 0);
  const today = new Date(asOfDate);
  today.setHours(0, 0, 0, 0);

  const holidayRows = await db.select().from(schema.holidays).where(eq(schema.holidays.tenantId, tenant.id));
  const holidayDates = new Set(holidayRows.map((h: any) => h.date));

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const workingDates: string[] = [];
  for (let d = new Date(monthStart); d <= today; d.setDate(d.getDate() + 1)) {
    const dayName = dayNames[d.getDay()];
    const dateStr = d.toISOString().slice(0, 10);
    if (weekendDays.includes(dayName)) continue;
    if (holidayDates.has(dateStr)) continue;
    workingDates.push(dateStr);
  }

  if (workingDates.length === 0) {
    return { percentage: 100, daysPresent: 0, workingDaysSoFar: 0 };
  }

  const checkIns = await db.select().from(schema.attendanceLogs).where(
    and(
      eq(schema.attendanceLogs.userId, userId),
      eq(schema.attendanceLogs.type, 'check_in'),
      eq(schema.attendanceLogs.status, 'approved'),
      sql`created_at >= ${monthStart}`
    )
  );
  const presentDates = new Set(checkIns.map((log: any) => new Date(log.createdAt).toISOString().slice(0, 10)));
  const daysPresent = workingDates.filter(d => presentDates.has(d)).length;

  return { percentage: Math.round((daysPresent / workingDates.length) * 100), daysPresent, workingDaysSoFar: workingDates.length };
}

// Role-pool hierarchy for low-attendance / break-location alerts: everyone
// with the "up" role in the tenant, plus every tenant_admin. There's no
// per-employee assigned-manager relationship in this schema — alerts go to
// the whole role pool rather than one specific superior.
export async function getHierarchyAlertRecipients(tenantId: number, subjectRole: string): Promise<any[]> {
  const upRole: Record<string, string | null> = {
    employee: 'manager',
    manager: 'HR',
    HR: 'GM',
    GM: null
  };
  const tenantUsers = await db.select().from(schema.users).where(eq(schema.users.tenantId, tenantId));
  const target = upRole[subjectRole];
  return tenantUsers.filter((u: any) => u.role === 'tenant_admin' || (target && u.role === target));
}
