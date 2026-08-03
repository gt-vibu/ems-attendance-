import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db, schema } from '../../db';
import { tenantDateTime, tenantDateKey } from './tenantTime';

// Month-start boundary now resolved in the TENANT's timezone (via
// tenantDateKey + tenantDateTime), not the server's — a server-local
// month-start could count (or fail to count) a check-in made near a month
// boundary against the wrong calendar month, over/under-enforcing
// wfhMaxDaysPerMonth for any tenant not on the server's own UTC offset.
export async function getMonthlyWfhCheckInCount(userId: number, tenant: { timezone?: string | null } | string | null = null, now: Date = new Date()): Promise<number> {
    const dateKey = tenantDateKey(tenant, now);
    const monthStart = tenantDateTime(tenant, `${dateKey.slice(0, 7)}-01`, 0, 0);
    const rows = await db.select().from(schema.attendanceLogs).where(
      and(
        eq(schema.attendanceLogs.userId, userId),
        eq(schema.attendanceLogs.attendanceMode, 'wfh'),
        eq(schema.attendanceLogs.type, 'check_in'),
        sql`status IN ('approved', 'pending')`,
        sql`created_at >= ${monthStart}`
      )
    );
    return rows.length;
  }

export async function getActiveHomeLocation(userId: number) {
    const rows = await db.select().from(schema.employeeHomeLocations).where(
      and(
        eq(schema.employeeHomeLocations.userId, userId),
        eq(schema.employeeHomeLocations.status, 'active')
      )
    );
    return rows[0] || null;
  }

