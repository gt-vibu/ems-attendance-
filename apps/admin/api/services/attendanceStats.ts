import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db, schema } from '../../db';
import { getHolidaysForEmployee } from './holidayScope';
import { tenantDateKey, tenantDateTime, tenantStartOfDay } from './tenantTime';

// Attendance percentage for a user, computed from working days so far this
// calendar month (excludes weekends per tenant.weekendConfig and holidays
// from the existing holidays table) vs. approved check-ins on those days.
// Not stored — computed on demand for both the self-service endpoint and
// the daily low-attendance alert cron. Every date/day-of-week computation
// here is resolved in the TENANT's timezone — this used to walk the month
// via the server's own local getters/setters, which could start the walk a
// day early/late (or mis-tag which weekday a given date falls on) for any
// tenant not on the server's own UTC offset.
export async function computeAttendancePercent(userId: number, tenant: any, asOfDate: Date = new Date()): Promise<{ percentage: number, daysPresent: number, workingDaysSoFar: number }> {
  const weekendDays: string[] = Array.isArray(tenant.weekendConfig)
    ? tenant.weekendConfig
    : (typeof tenant.weekendConfig === 'string' ? JSON.parse(tenant.weekendConfig) : ['Saturday', 'Sunday']);

  const todayKey = tenantDateKey(tenant, asOfDate);
  const monthStart = tenantDateTime(tenant, `${todayKey.slice(0, 7)}-01`, 0, 0);
  const today = tenantStartOfDay(tenant, asOfDate);

  const holidayRows = await getHolidaysForEmployee(tenant.id, userId);
  const holidayDates = new Set(holidayRows.map((h) => h.date));

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const workingDates: string[] = [];
  // Walk day-by-day in real elapsed-ms steps (not local setDate(), which
  // would silently re-introduce a server-local day boundary) from the
  // tenant's month-start through the tenant's "today," inclusive.
  for (let ms = monthStart.getTime(); ms <= today.getTime(); ms += 24 * 60 * 60 * 1000) {
    const dateStr = tenantDateKey(tenant, new Date(ms));
    // Weekday-of-date-string lookup is timezone-invariant (pure calendar
    // math on an already-resolved 'YYYY-MM-DD' string), same pattern used
    // elsewhere in this codebase (digestDispatcher.ts, wfh.ts).
    const dayName = dayNames[new Date(`${dateStr}T12:00:00Z`).getUTCDay()];
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
  const presentDates = new Set(checkIns.map((log: any) => tenantDateKey(tenant, new Date(log.createdAt))));
  const daysPresent = workingDates.filter(d => presentDates.has(d)).length;

  return { percentage: Math.round((daysPresent / workingDates.length) * 100), daysPresent, workingDaysSoFar: workingDates.length };
}

// Role-pool hierarchy for low-attendance / break-location alerts: everyone
// with the "up" role in the tenant, plus every tenant_admin. There's no
// per-employee assigned-manager relationship in this schema — alerts go to
// the whole role pool rather than one specific superior.
export async function getHierarchyAlertRecipients(tenantId: number, subjectRole: string, subjectUserId?: number): Promise<any[]> {
  const upRole: Record<string, string | null> = {
    employee: 'manager',
    manager: 'HR',
    HR: 'GM',
    GM: null
  };
  const tenantUsers = await db.select().from(schema.users).where(eq(schema.users.tenantId, tenantId));
  const target = upRole[subjectRole];

  let directManager: any = null;
  if (subjectUserId) {
    const subjectUser = tenantUsers.find((u: any) => u.id === subjectUserId);
    if (subjectUser && subjectUser.managerId) {
      directManager = tenantUsers.find((u: any) => u.id === subjectUser.managerId);
    }
  }

  const poolRecipients = tenantUsers.filter((u: any) => u.role === 'tenant_admin' || (target && u.role === target));

  if (directManager) {
    const filteredPool = poolRecipients.filter((u: any) => u.id !== directManager.id);
    return [directManager, ...filteredPool];
  }
  return poolRecipients;
}
