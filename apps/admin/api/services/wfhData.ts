import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db, schema } from '../../db';

export async function getMonthlyWfhCheckInCount(userId: number, now: Date = new Date()): Promise<number> {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
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

