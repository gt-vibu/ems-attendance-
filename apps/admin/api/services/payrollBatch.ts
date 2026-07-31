import { eq, and, inArray } from 'drizzle-orm';
import { db, schema } from '../../db';
import { getRoleCompensationDefault } from '../routes/leavePayrollShared';

// Payroll Batch lifecycle — a first-class Payroll Run covering a whole
// employee population, distinct from the pre-existing per-employee
// payrollRuns rows (which stay the line items). This file owns the two
// gates the master prompt asked for as dedicated engines rather than
// inline logic: the Exception Center (blocks HR submission until real
// problems are resolved) and the Validation Engine (blocks
// approve/release if the numbers don't reconcile). Neither recomputes
// attendance or leave — both only read what those modules already decided.

export const BATCH_TRANSITIONS: Record<string, string> = {
  draft: 'calculating',
  calculating: 'calculated',
  calculated: 'pending_hr_review',
  pending_hr_review: 'pending_finance_review',
  pending_finance_review: 'approved',
  approved: 'payslips_generated',
  payslips_generated: 'released',
  released: 'locked',
};

export interface PayrollException {
  userId: number;
  userName: string;
  type: 'missing_salary_structure' | 'attendance_not_frozen' | 'pending_leave' | 'employee_inactive' | 'pending_adjustments';
  message: string;
  blocking: boolean;
}

// Scans every active employee in the tenant for issues that should stop
// HR from submitting this batch for review. Read-only — never mutates
// attendance/leave/compensation state, only reports on it.
export async function scanBatchExceptions(tenantId: number, year: number, month: number): Promise<PayrollException[]> {
  const exceptions: PayrollException[] = [];

  // Every clock-in-capable user in the tenant is a potential payroll
  // subject in this codebase (not just role==='employee') — reuse the
  // same tenant-wide fetch other payroll routes already do, and exclude
  // admin roles below since they're never payroll subjects here.
  const allTenantUsers = await db.select().from(schema.users).where(eq(schema.users.tenantId, tenantId));

  const freezeRows = await db.select().from(schema.attendanceFreezePeriods).where(
    and(eq(schema.attendanceFreezePeriods.tenantId, tenantId), eq(schema.attendanceFreezePeriods.year, year), eq(schema.attendanceFreezePeriods.month, month))
  ).limit(1);
  const isFrozen = freezeRows.length > 0;
  if (!isFrozen) {
    exceptions.push({ userId: 0, userName: 'All employees', type: 'attendance_not_frozen', message: `Attendance for ${year}-${String(month).padStart(2, '0')} has not been frozen yet.`, blocking: true });
  }

  const userIds = allTenantUsers.map((u: any) => u.id);
  const profiles = userIds.length > 0
    ? await db.select().from(schema.employeeCompensationProfiles).where(and(inArray(schema.employeeCompensationProfiles.userId, userIds), eq(schema.employeeCompensationProfiles.status, 'active')))
    : [];
  const profiledUserIds = new Set(profiles.map((p: any) => p.userId));

  const pendingLeave = userIds.length > 0
    ? await db.select().from(schema.leaveRequests).where(and(inArray(schema.leaveRequests.userId, userIds), eq(schema.leaveRequests.status, 'pending')))
    : [];
  const pendingLeaveByUser = new Map<number, number>();
  for (const l of pendingLeave) pendingLeaveByUser.set(l.userId, (pendingLeaveByUser.get(l.userId) || 0) + 1);

  for (const emp of allTenantUsers) {
    if (emp.role === 'tenant_admin' || emp.role === 'super_admin') continue;
    if (emp.employeeStatus === 'terminated') continue; // terminated employees are handled by Final Settlement (P7), not a regular batch
    if (emp.employeeStatus === 'inactive') {
      exceptions.push({ userId: emp.id, userName: emp.name, type: 'employee_inactive', message: `${emp.name} is marked inactive.`, blocking: false });
    }
    if (!profiledUserIds.has(emp.id)) {
      const roleDefault = await getRoleCompensationDefault(tenantId, emp.role || '');
      if (!roleDefault) {
        exceptions.push({ userId: emp.id, userName: emp.name, type: 'missing_salary_structure', message: `${emp.name} has no compensation profile and no role default for '${emp.role}'.`, blocking: true });
      }
    }
    const pendingCount = pendingLeaveByUser.get(emp.id) || 0;
    if (pendingCount > 0) {
      exceptions.push({ userId: emp.id, userName: emp.name, type: 'pending_leave', message: `${emp.name} has ${pendingCount} pending leave request(s) for this period.`, blocking: false });
    }
  }

  return exceptions;
}

export interface ValidationResult {
  valid: boolean;
  failures: string[];
}

// Attendance corrections approved against an already-locked period create
// a payroll_adjustments row (review.routes.ts) that HR has to explicitly
// apply — easy to miss. This surfaces every unapplied adjustment tied to
// this batch's own line items, so it can be shown prominently instead of
// silently sitting in a separate screen nobody checks.
export async function getPendingAdjustmentsForBatch(batchId: number): Promise<Array<typeof schema.payrollAdjustments.$inferSelect>> {
  const lineItems = await db.select({ id: schema.payrollRuns.id }).from(schema.payrollRuns).where(eq(schema.payrollRuns.batchId, batchId));
  const runIds = lineItems.map((r) => r.id);
  if (runIds.length === 0) return [];
  return db.select().from(schema.payrollAdjustments).where(
    and(inArray(schema.payrollAdjustments.payrollRunId, runIds), eq(schema.payrollAdjustments.status, 'pending'))
  );
}

// Run before 'approve' and 'release' transitions. Blocking, not advisory —
// a failing result must stop the transition route from proceeding.
export async function validateBatchForApproval(batch: typeof schema.payrollBatches.$inferSelect): Promise<ValidationResult> {
  const failures: string[] = [];

  if (batch.totalNet > batch.totalGross) {
    failures.push('Total net pay exceeds total gross pay for the batch.');
  }
  if (batch.employeeCount === 0) {
    failures.push('Batch has no employees — nothing was calculated.');
  }

  const freezeRows = await db.select().from(schema.attendanceFreezePeriods).where(
    and(eq(schema.attendanceFreezePeriods.tenantId, batch.tenantId), eq(schema.attendanceFreezePeriods.year, batch.year), eq(schema.attendanceFreezePeriods.month, batch.month))
  ).limit(1);
  if (freezeRows.length === 0) {
    failures.push('Attendance for this period has not been frozen.');
  }

  const lineItems = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.batchId, batch.id));
  for (const item of lineItems) {
    if (item.netPay < 0) failures.push(`Negative net pay for user #${item.userId}.`);
  }
  const sumNet = lineItems.reduce((acc: number, r: any) => acc + (r.netPay || 0), 0);
  if (Math.abs(sumNet - batch.totalNet) > 0.5) {
    failures.push('Sum of individual line items does not reconcile with the batch total net pay.');
  }

  return { valid: failures.length === 0, failures };
}

// Checks whether `transition` is allowed right now for this batch's
// calendar (if one is configured for the period — no calendar row means no
// date gating, same "additive, never a hard requirement" convention used
// throughout this schema).
export async function checkCalendarGate(tenantId: number, year: number, month: number, transition: string): Promise<string | null> {
  const rows = await db.select().from(schema.payrollCalendars).where(
    and(eq(schema.payrollCalendars.tenantId, tenantId), eq(schema.payrollCalendars.year, year), eq(schema.payrollCalendars.month, month))
  ).limit(1);
  const cal = rows[0];
  if (!cal) return null;

  const today = new Date().toISOString().slice(0, 10);
  const dateForTransition: Record<string, string | null> = {
    calculating: cal.calculationDate,
    pending_hr_review: cal.hrReviewDate,
    pending_finance_review: cal.financeReviewDate,
    released: cal.releaseDate,
  };
  const requiredDate = dateForTransition[transition];
  if (requiredDate && today < requiredDate) {
    return `This step is scheduled for ${requiredDate} per the payroll calendar and cannot be done early.`;
  }
  return null;
}
