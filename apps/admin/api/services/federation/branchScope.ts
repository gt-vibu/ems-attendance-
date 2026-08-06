import { eq, and, inArray } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { resolveInternalId } from './externalId';

// Shared branch-isolation layer for federation routes whose data is
// employee-scoped (leave, payroll) — mirrors what attendance.routes.ts
// already does per-record, but centralized so every list/read/write
// endpoint enforces it the same way. A federation caller identifies a
// branch to a real hotel/outlet; without this, a caller scoped to one
// branch could read or act on another branch's leave/payroll data simply
// by knowing (or guessing) an externalEmployeeId that belongs elsewhere —
// exactly the "branch manager receives organization-wide payroll or leave
// data" gap flagged in review.
//
// An employee "belongs to" a branch two ways in this app: their primary
// users.branchId assignment, or a secondary userBranchAccess grant (the
// same multi-branch-access mechanism PUT /v1/federation/employees/:id/
// branches/:branchId already writes to). Both count.

export async function resolveBranchEmployeeIds(tenantId: number, branchInternalId: number): Promise<number[]> {
  const [primary, secondary] = await Promise.all([
    db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.branchId, branchInternalId))),
    db.select({ userId: schema.userBranchAccess.userId }).from(schema.userBranchAccess).where(eq(schema.userBranchAccess.branchId, branchInternalId)),
  ]);
  const ids = new Set<number>();
  primary.forEach((r: any) => ids.add(r.id));
  secondary.forEach((r: any) => ids.add(r.userId));
  return Array.from(ids);
}

// Resolves an externalBranchId query/body param to an internal branch id.
// Returns null (with a response already sent) on an invalid/unknown id, or
// undefined if none was supplied at all (caller not scoping by branch —
// still allowed, since not every federation call originates from a
// per-branch context on BlizBooks's side).
export async function resolveBranchFilter(
  tenantId: number,
  externalBranchId: string | undefined | null,
  res: any,
): Promise<{ branchInternalId: number; employeeIds: number[] } | undefined | null> {
  if (!externalBranchId) return undefined;
  const branchInternalId = await resolveInternalId(tenantId, 'branch', externalBranchId);
  if (branchInternalId === null) {
    res.status(404).json({ error: 'Unknown externalBranchId.' });
    return null;
  }
  const employeeIds = await resolveBranchEmployeeIds(tenantId, branchInternalId);
  return { branchInternalId, employeeIds };
}

// Write-path guard: if the caller supplied externalBranchId alongside a
// target externalEmployeeId/internal userId, that employee must actually
// belong to that branch — otherwise a caller could name one branch in the
// scoping field while acting on an employee from a different one. Returns
// true and sends nothing if the check passes (or wasn't requested at all,
// i.e. externalBranchId omitted); sends the appropriate error response and
// returns false otherwise.
export async function validateEmployeeBranchMembership(
  tenantId: number,
  userId: number,
  externalBranchId: string | undefined | null,
  res: any,
): Promise<boolean> {
  if (!externalBranchId) return true;
  const branchInternalId = await resolveInternalId(tenantId, 'branch', externalBranchId);
  if (branchInternalId === null) {
    res.status(404).json({ error: 'Unknown externalBranchId.' });
    return false;
  }
  const userRow = (await db.select({ branchId: schema.users.branchId }).from(schema.users).where(eq(schema.users.id, userId)).limit(1))[0];
  if (userRow?.branchId === branchInternalId) return true;
  const accessRows = await db.select().from(schema.userBranchAccess).where(and(eq(schema.userBranchAccess.userId, userId), eq(schema.userBranchAccess.branchId, branchInternalId))).limit(1);
  if (accessRows.length > 0) return true;
  res.status(403).json({ error: 'This employee is not assigned to the specified externalBranchId.', code: 'BRANCH_MEMBERSHIP_MISMATCH' });
  return false;
}

// Convenience re-export so route files scoping a userId column with a
// branch employee-id list don't need to import inArray separately.
export { inArray };
