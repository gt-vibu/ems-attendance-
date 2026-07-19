import { eq, and, lte, gte } from 'drizzle-orm';
import { db, schema } from '../../db';

// Single source of truth for "what shift applies to this user on this
// specific date". Everything that needs to compare a check-in against a
// shift's checkInTime/checkOutTime for a particular day should call this
// instead of reading users.shiftId directly — that field only holds the
// PERMANENT shift, and ignores any dated shiftOverrides row (see
// packages/database/src/schema.ts) an admin has since applied.
//
// dateStr must be 'YYYY-MM-DD' (same convention as leaveRequests.startDate/
// endDate and holidays.date elsewhere in this schema).
export async function getEffectiveShiftId(tenantId: number, userId: number, dateStr: string): Promise<number | null> {
  const overrideRows = await db.select().from(schema.shiftOverrides).where(
    and(
      eq(schema.shiftOverrides.tenantId, tenantId),
      eq(schema.shiftOverrides.userId, userId),
      lte(schema.shiftOverrides.startDate, dateStr),
      gte(schema.shiftOverrides.endDate, dateStr),
    )
  ).limit(1);

  if (overrideRows.length > 0) {
    return overrideRows[0].shiftId;
  }

  const userRows = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return userRows.length > 0 ? (userRows[0].shiftId ?? null) : null;
}

// Full effective-shift row (not just the id) for the given user/date — a
// convenience wrapper for call sites that need the shift's checkInTime/
// checkOutTime/gracePeriodMins, not just its id.
export async function getEffectiveShift(tenantId: number, userId: number, dateStr: string): Promise<any | null> {
  const shiftId = await getEffectiveShiftId(tenantId, userId, dateStr);
  if (!shiftId) return null;
  const shiftRows = await db.select().from(schema.shifts).where(eq(schema.shifts.id, shiftId)).limit(1);
  return shiftRows.length > 0 ? shiftRows[0] : null;
}
