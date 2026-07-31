import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../db';

// A holiday with branchId/department both NULL applies to everyone (the
// original, unscoped behavior — every pre-existing row is like this and
// keeps working identically). Setting either scopes it; a per-employee row
// in holiday_employee_overrides always wins over the scope match either way
// (force-include someone outside the scope, or force-exclude someone
// inside it). This is the single place that scoping logic lives — every
// consumer (attendance % calc, the day-status resolver, the employee-facing
// calendar) should call this instead of querying `holidays` directly by
// tenant alone.
export async function getHolidaysForEmployee(tenantId: number, userId: number): Promise<Array<{ id: number; date: string; name: string }>> {
  const [employeeRows, allHolidays, overrides] = await Promise.all([
    db.select({ branchId: schema.users.branchId, department: schema.users.department }).from(schema.users).where(eq(schema.users.id, userId)).limit(1),
    db.select().from(schema.holidays).where(and(eq(schema.holidays.tenantId, tenantId), eq(schema.holidays.isArchived, false))),
    db.select().from(schema.holidayEmployeeOverrides).where(eq(schema.holidayEmployeeOverrides.userId, userId)),
  ]);

  const employee = employeeRows[0];
  const overrideByHolidayId = new Map<number, boolean>();
  for (const o of overrides) overrideByHolidayId.set(o.holidayId, o.included);

  return allHolidays.filter((h: any) => {
    const override = overrideByHolidayId.get(h.id);
    if (override != null) return override;
    if (h.branchId == null && !h.department) return true; // tenant-wide
    if (h.branchId != null && employee?.branchId === h.branchId) return true;
    if (h.department && employee?.department === h.department) return true;
    return false;
  }).map((h: any) => ({ id: h.id, date: h.date, name: h.name }));
}
