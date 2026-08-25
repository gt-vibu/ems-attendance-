import { eq, and, desc, sql, inArray, or, lt } from 'drizzle-orm';
import { db, schema } from '../../db';
import { logToAuditLedger } from './audit';
import { notify, notifyOrFallback } from './notificationService';
import { isPlatformFeatureAllowed } from '../auth/rbac';
import { getOrCreatePayrollSettings } from '../routes/leavePayrollShared';

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
  warnings: string[];
  availableAdvance: number;
  maxAllowed: number;
  currentOutstanding: number;
  activeAdvancesCount: number;
  monthlySalary: number;
  basisUsed: string;
  tenureMonths: number;
  policy: {
    salaryAdvanceEnabled: boolean;
    advanceCalculationBasis: string;
    advanceMaxAmount: number;
    advanceMaxPercentage: number;
    advanceMinTenureMonths: number;
    advanceMaxActiveCount: number;
    advanceAllowMultiple: boolean;
    advanceDefaultRecoveryMethod: string;
    advanceMaxInstallments: number;
    advanceMinRecoveryAmount: number;
    advanceEmployeeCanRequest: boolean;
    advanceAdminCanAssign: boolean;
    advanceApprovalRequired: boolean;
    advancePayrollCutoffDay: number;
  };
}

export const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['pending_approval', 'cancelled'],
  pending_approval: ['approved', 'rejected', 'cancelled'],
  approved: ['pending_disbursement', 'disbursed', 'cancelled'],
  pending_disbursement: ['disbursed', 'cancelled'],
  disbursed: ['partially_recovered', 'fully_recovered', 'voided'],
  partially_recovered: ['partially_recovered', 'fully_recovered', 'voided'],
  fully_recovered: ['closed'],
  closed: [],
  rejected: [],
  cancelled: [],
  voided: [],
};

// Exact monetary rounding to 2 decimal places (cents/paise) to prevent float inaccuracies
export function roundMoney(val: number | string | null | undefined): number {
  const num = Number(val || 0);
  if (isNaN(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export function formatMoneyStr(val: number | string | null | undefined): string {
  return roundMoney(val).toFixed(2);
}

export function parsePolicyNumbers(settings: any) {
  return {
    salaryAdvanceEnabled: settings?.salaryAdvanceEnabled !== false,
    advanceCalculationBasis: String(settings?.advanceCalculationBasis || 'net_salary'),
    advanceMaxAmount: roundMoney(settings?.advanceMaxAmount ?? 50000),
    advanceMaxPercentage: roundMoney(settings?.advanceMaxPercentage ?? 50),
    advanceMinTenureMonths: Number(settings?.advanceMinTenureMonths ?? 3),
    advanceMaxActiveCount: Number(settings?.advanceMaxActiveCount ?? 1),
    advanceAllowMultiple: Boolean(settings?.advanceAllowMultiple ?? false),
    advanceDefaultRecoveryMethod: String(settings?.advanceDefaultRecoveryMethod || 'full_next_payroll'),
    advanceMaxInstallments: Math.max(1, Number(settings?.advanceMaxInstallments ?? 6)),
    advanceMinRecoveryAmount: roundMoney(settings?.advanceMinRecoveryAmount ?? 1000),
    advanceEmployeeCanRequest: settings?.advanceEmployeeCanRequest !== false,
    advanceAdminCanAssign: settings?.advanceAdminCanAssign !== false,
    advanceApprovalRequired: settings?.advanceApprovalRequired !== false,
    advancePayrollCutoffDay: Number(settings?.advancePayrollCutoffDay ?? 20),
    advanceApprovalThresholds: settings?.advanceApprovalThresholds || null,
  };
}

export function computeTenureMonths(joiningDateStr?: string | null): number {
  if (!joiningDateStr) return 999; // Assume senior if not recorded
  const joining = new Date(joiningDateStr);
  if (isNaN(joining.getTime())) return 999;
  const now = new Date();
  const diffYears = now.getFullYear() - joining.getFullYear();
  const diffMonths = now.getMonth() - joining.getMonth();
  return Math.max(0, diffYears * 12 + diffMonths);
}

export async function evaluateSalaryAdvanceEligibility(
  tenantId: number,
  userId: number,
  requestedAmount?: number,
  recoveryMonths?: number,
  targetYear?: number,
  targetMonth?: number,
): Promise<EligibilityResult> {
  const settingsRow = await getOrCreatePayrollSettings(tenantId);
  const policy = parsePolicyNumbers(settingsRow);
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (!policy.salaryAdvanceEnabled) {
    reasons.push('Salary Advance module is disabled by company policy.');
  }

  // 1. Employee existence & status check
  const employeeRows = await db.select().from(schema.users).where(and(eq(schema.users.id, userId), eq(schema.users.tenantId, tenantId))).limit(1);
  if (employeeRows.length === 0) {
    return {
      eligible: false,
      reasons: ['Employee record not found.'],
      warnings: [],
      availableAdvance: 0,
      maxAllowed: 0,
      currentOutstanding: 0,
      activeAdvancesCount: 0,
      monthlySalary: 0,
      basisUsed: policy.advanceCalculationBasis,
      tenureMonths: 0,
      policy,
    };
  }
  const employee = employeeRows[0];
  if (employee.employeeStatus === 'terminated' || employee.employeeStatus === 'suspended') {
    reasons.push(`Employee is currently ${employee.employeeStatus}.`);
  }

  // 2. Tenure verification
  const tenureMonths = computeTenureMonths(employee.dateOfJoining);
  if (tenureMonths < policy.advanceMinTenureMonths) {
    reasons.push(`Minimum employee tenure requirement of ${policy.advanceMinTenureMonths} month(s) not met (current: ${tenureMonths} month(s)).`);
  }

  // 3. Outstanding / Active advances evaluation
  const activeSalaryAdvances = await db.select().from(schema.salaryAdvances).where(and(
    eq(schema.salaryAdvances.tenantId, tenantId),
    eq(schema.salaryAdvances.userId, userId),
    inArray(schema.salaryAdvances.status, ['draft', 'pending_approval', 'approved', 'pending_disbursement', 'disbursed', 'partially_recovered']),
  ));

  const legacyActiveAdvances = await db.select().from(schema.payrollAdvances).where(and(
    eq(schema.payrollAdvances.tenantId, tenantId),
    eq(schema.payrollAdvances.userId, userId),
    eq(schema.payrollAdvances.status, 'active'),
  ));

  const totalActiveCount = activeSalaryAdvances.length + legacyActiveAdvances.length;
  let totalOutstanding = 0;
  for (const adv of activeSalaryAdvances) {
    totalOutstanding += roundMoney(adv.outstandingAmount);
  }
  for (const leg of legacyActiveAdvances) {
    totalOutstanding += roundMoney(leg.remainingBalance);
  }
  totalOutstanding = roundMoney(totalOutstanding);

  if (totalActiveCount >= policy.advanceMaxActiveCount && !policy.advanceAllowMultiple) {
    reasons.push(`Maximum active advance limit (${policy.advanceMaxActiveCount}) reached. You have ${totalActiveCount} active advance(s).`);
  }

  // 4. Resolve compensation baseline
  const profileRows = await db.select().from(schema.employeeCompensationProfiles).where(and(
    eq(schema.employeeCompensationProfiles.tenantId, tenantId),
    eq(schema.employeeCompensationProfiles.userId, userId),
    eq(schema.employeeCompensationProfiles.status, 'active'),
  )).orderBy(desc(schema.employeeCompensationProfiles.id)).limit(1);

  let monthlySalary = 0;
  if (profileRows.length > 0) {
    const annualCtc = Number(profileRows[0].annualCtc || 0);
    const monthlyGross = annualCtc / 12;

    switch (policy.advanceCalculationBasis) {
      case 'gross_salary':
        monthlySalary = roundMoney(monthlyGross);
        break;
      case 'basic_salary': {
        const components = await db.select().from(schema.employeeSalaryComponents).where(and(
          eq(schema.employeeSalaryComponents.tenantId, tenantId),
          eq(schema.employeeSalaryComponents.userId, userId),
        ));
        const basicComp = components.find((c: any) => c.componentName?.toLowerCase().includes('basic'));
        if (basicComp) {
          monthlySalary = roundMoney(basicComp.calculationType === 'fixed_amount' ? basicComp.value : (annualCtc * basicComp.value) / 100 / 12);
        } else {
          monthlySalary = roundMoney(monthlyGross * (Number(settingsRow.statutoryBasicPercentOfGross || 50) / 100));
        }
        break;
      }
      case 'fixed_cap':
        monthlySalary = policy.advanceMaxAmount;
        break;
      case 'net_salary':
      default: {
        // Approximate standard take-home at 85% of monthly gross or actual run
        monthlySalary = roundMoney(monthlyGross * 0.85);
        break;
      }
    }
  } else {
    // If no compensation profile is set up, fallback to default cap if allowed
    monthlySalary = policy.advanceMaxAmount;
    warnings.push('No active compensation profile found; using default policy cap.');
  }

  // 5. Maximum Allowed & Available calculation
  let maxAllowed = policy.advanceMaxAmount;
  if (policy.advanceCalculationBasis !== 'fixed_cap' && monthlySalary > 0) {
    const percentageCap = roundMoney((monthlySalary * policy.advanceMaxPercentage) / 100);
    maxAllowed = Math.min(policy.advanceMaxAmount, percentageCap);
  }
  maxAllowed = roundMoney(maxAllowed);

  const availableAdvance = roundMoney(Math.max(0, maxAllowed - totalOutstanding));

  // 6. Check requested amount constraints if provided
  if (typeof requestedAmount === 'number' && requestedAmount > 0) {
    if (requestedAmount > availableAdvance) {
      reasons.push(`Requested amount (₹${requestedAmount.toLocaleString()}) exceeds maximum available limit (₹${availableAdvance.toLocaleString()}).`);
    }
    if (requestedAmount < policy.advanceMinRecoveryAmount) {
      reasons.push(`Requested amount must be at least minimum recovery amount of ₹${policy.advanceMinRecoveryAmount.toLocaleString()}.`);
    }
  }

  // 7. Check installments constraint if provided
  if (typeof recoveryMonths === 'number' && recoveryMonths > 0) {
    if (recoveryMonths > policy.advanceMaxInstallments) {
      reasons.push(`Recovery installments (${recoveryMonths}) exceed maximum allowed (${policy.advanceMaxInstallments}).`);
    }
  }

  // 8. Cutoff Day check for target recovery period
  if (targetYear && targetMonth) {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const currentDay = today.getDate();

    if (targetYear === currentYear && targetMonth === currentMonth && currentDay > policy.advancePayrollCutoffDay) {
      warnings.push(`Current payroll cutoff date (day ${policy.advancePayrollCutoffDay}) has passed. Recovery will be scheduled for next cycle.`);
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    warnings,
    availableAdvance,
    maxAllowed,
    currentOutstanding: totalOutstanding,
    activeAdvancesCount: totalActiveCount,
    monthlySalary,
    basisUsed: policy.advanceCalculationBasis,
    tenureMonths,
    policy,
  };
}

export function generateRecoveryScheduleRecords(params: {
  advanceId: number;
  tenantId: number;
  userId: number;
  totalAmount: number;
  installments: number;
  startYear: number;
  startMonth: number;
}) {
  const { advanceId, tenantId, userId, totalAmount, installments, startYear, startMonth } = params;
  const count = Math.max(1, installments);
  const roundedTotal = roundMoney(totalAmount);
  const baseAmount = roundMoney(Math.floor((roundedTotal / count) * 100) / 100);
  const remainder = roundMoney(roundedTotal - baseAmount * count);

  const schedule: Array<typeof schema.salaryAdvanceRecoveries.$inferInsert> = [];

  let curYear = startYear;
  let curMonth = startMonth;

  for (let i = 1; i <= count; i++) {
    // First installment absorbs the remainder so total matches exactly
    const scheduledAmount = i === 1 ? roundMoney(baseAmount + remainder) : baseAmount;

    schedule.push({
      tenantId,
      advanceId,
      userId,
      scheduledYear: curYear,
      scheduledMonth: curMonth,
      installmentNumber: i,
      totalInstallments: count,
      scheduledAmount: formatMoneyStr(scheduledAmount),
      recoveredAmount: '0.00',
      remainingAmount: formatMoneyStr(scheduledAmount),
      status: 'scheduled',
    });

    curMonth++;
    if (curMonth > 12) {
      curMonth = 1;
      curYear++;
    }
  }

  return schedule;
}

export async function createSalaryAdvanceRequest(params: {
  tenantId: number;
  userId: number;
  requestedAmount: number;
  reason?: string;
  remarks?: string;
  recoveryMethod?: string;
  recoveryInstallments?: number;
  startYear: number;
  startMonth: number;
  requestedByUserId: number;
  origin?: 'EMPLOYEE_REQUEST' | 'ADMIN_ASSIGNED';
}) {
  const { tenantId, userId, requestedAmount, reason, remarks, recoveryMethod, recoveryInstallments, startYear, startMonth, requestedByUserId, origin = 'EMPLOYEE_REQUEST' } = params;

  const installments = Math.max(1, recoveryInstallments || 1);
  const eligibility = await evaluateSalaryAdvanceEligibility(tenantId, userId, requestedAmount, installments, startYear, startMonth);

  if (!eligibility.eligible) {
    throw new Error(`Ineligible for salary advance: ${eligibility.reasons.join(', ')}`);
  }

  const initialStatus = 'pending_approval';

  const [advance] = await db.insert(schema.salaryAdvances).values({
    tenantId,
    userId,
    origin,
    status: initialStatus,
    requestedAmount: formatMoneyStr(requestedAmount),
    approvedAmount: null,
    disbursedAmount: null,
    outstandingAmount: formatMoneyStr(requestedAmount),
    recoveredAmount: '0.00',
    recoveryMethod: recoveryMethod || eligibility.policy.advanceDefaultRecoveryMethod || 'full_next_payroll',
    recoveryInstallments: installments,
    startRecoveryYear: startYear,
    startRecoveryMonth: startMonth,
    reason: reason || null,
    remarks: remarks || null,
    requestedAt: new Date(),
    requestedByUserId,
    policySnapshot: {
      policy: eligibility.policy,
      availableAdvanceAtRequest: eligibility.availableAdvance,
      monthlySalaryAtRequest: eligibility.monthlySalary,
    },
  }).returning();

  await logToAuditLedger({
    tenantId,
    actorId: requestedByUserId,
    actorName: `User #${requestedByUserId}`,
    action: origin === 'ADMIN_ASSIGNED' ? 'SALARY_ADVANCE_ASSIGNED' : 'SALARY_ADVANCE_REQUESTED',
    details: { advanceId: advance.id, userId, requestedAmount, installments, startYear, startMonth },
  });

  const empRows = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  const empName = empRows[0]?.name || `User #${userId}`;

  await notifyOrFallback(
    tenantId,
    'salary_advance_requested',
    userId,
    empName,
    { advanceId: advance.id, amount: requestedAmount, startYear, startMonth },
    'Salary Advance Requested',
    `Salary advance request of ₹${requestedAmount.toLocaleString()} submitted for ${startYear}-${String(startMonth).padStart(2, '0')}.`,
  );

  return advance;
}

export async function approveSalaryAdvance(params: {
  advanceId: number;
  tenantId: number;
  approverUserId: number;
  approvedAmount?: number;
  remarks?: string;
}) {
  const { advanceId, tenantId, approverUserId, approvedAmount, remarks } = params;

  const rows = await db.select().from(schema.salaryAdvances).where(and(eq(schema.salaryAdvances.id, advanceId), eq(schema.salaryAdvances.tenantId, tenantId))).limit(1);
  if (rows.length === 0) throw new Error('Salary advance record not found.');
  const advance = rows[0];

  if (advance.status !== 'pending_approval' && advance.status !== 'draft') {
    throw new Error(`Cannot approve advance in '${advance.status}' status.`);
  }

  const finalApprovedAmount = roundMoney(approvedAmount !== undefined ? approvedAmount : advance.requestedAmount);
  if (finalApprovedAmount <= 0) throw new Error('Approved amount must be greater than zero.');

  const [updated] = await db.update(schema.salaryAdvances).set({
    status: 'approved',
    approvedAmount: formatMoneyStr(finalApprovedAmount),
    outstandingAmount: formatMoneyStr(finalApprovedAmount),
    approvedAt: new Date(),
    approvedByUserId: approverUserId,
    remarks: remarks || advance.remarks,
    updatedAt: new Date(),
  }).where(eq(schema.salaryAdvances.id, advance.id)).returning();

  await logToAuditLedger({
    tenantId,
    actorId: approverUserId,
    actorName: `User #${approverUserId}`,
    action: 'SALARY_ADVANCE_APPROVED',
    details: { advanceId: advance.id, userId: advance.userId, approvedAmount: finalApprovedAmount },
  });

  const empRows = await db.select().from(schema.users).where(eq(schema.users.id, advance.userId)).limit(1);
  const empName = empRows[0]?.name || `User #${advance.userId}`;

  await notifyOrFallback(
    tenantId,
    'salary_advance_approved',
    advance.userId,
    empName,
    { advanceId: advance.id, amount: finalApprovedAmount },
    'Salary Advance Approved',
    `Your salary advance of ₹${finalApprovedAmount.toLocaleString()} has been approved. Awaiting disbursement.`,
  );

  return updated;
}

export async function rejectSalaryAdvance(params: {
  advanceId: number;
  tenantId: number;
  rejecterUserId: number;
  reason: string;
}) {
  const { advanceId, tenantId, rejecterUserId, reason } = params;
  if (!reason || !reason.trim()) throw new Error('Rejection reason is required.');

  const rows = await db.select().from(schema.salaryAdvances).where(and(eq(schema.salaryAdvances.id, advanceId), eq(schema.salaryAdvances.tenantId, tenantId))).limit(1);
  if (rows.length === 0) throw new Error('Salary advance record not found.');
  const advance = rows[0];

  if (advance.status !== 'pending_approval' && advance.status !== 'draft') {
    throw new Error(`Cannot reject advance in '${advance.status}' status.`);
  }

  const [updated] = await db.update(schema.salaryAdvances).set({
    status: 'rejected',
    rejectionReason: reason.trim(),
    rejectedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(schema.salaryAdvances.id, advance.id)).returning();

  await logToAuditLedger({
    tenantId,
    actorId: rejecterUserId,
    actorName: `User #${rejecterUserId}`,
    action: 'SALARY_ADVANCE_REJECTED',
    details: { advanceId: advance.id, userId: advance.userId, reason },
  });

  const empRows = await db.select().from(schema.users).where(eq(schema.users.id, advance.userId)).limit(1);
  const empName = empRows[0]?.name || `User #${advance.userId}`;

  await notifyOrFallback(
    tenantId,
    'salary_advance_rejected',
    advance.userId,
    empName,
    { advanceId: advance.id, reason },
    'Salary Advance Rejected',
    `Your salary advance request was rejected: ${reason}`,
  );

  return updated;
}

export async function disburseSalaryAdvance(params: {
  advanceId: number;
  tenantId: number;
  disburserUserId: number;
  disbursedAmount?: number;
  disbursementMethod?: string;
  disbursementReference?: string;
  disbursementDate?: string;
  bankDetailsSnapshot?: any;
}) {
  const { advanceId, tenantId, disburserUserId, disbursedAmount, disbursementMethod, disbursementReference, bankDetailsSnapshot } = params;

  const rows = await db.select().from(schema.salaryAdvances).where(and(eq(schema.salaryAdvances.id, advanceId), eq(schema.salaryAdvances.tenantId, tenantId))).limit(1);
  if (rows.length === 0) throw new Error('Salary advance record not found.');
  const advance = rows[0];

  if (advance.status !== 'approved' && advance.status !== 'pending_disbursement') {
    throw new Error(`Cannot disburse advance in status '${advance.status}'. Advance must be approved first.`);
  }

  const finalDisbursedAmount = roundMoney(disbursedAmount !== undefined ? disbursedAmount : (advance.approvedAmount || advance.requestedAmount));
  if (finalDisbursedAmount <= 0) throw new Error('Disbursed amount must be greater than zero.');

  // Atomic transaction: update advance status & generate exact recovery schedule
  let updatedAdvance: any;
  await db.transaction(async (tx: any) => {
    // Delete any stale scheduled recoveries for this advance if they existed
    await tx.delete(schema.salaryAdvanceRecoveries).where(eq(schema.salaryAdvanceRecoveries.advanceId, advance.id));

    const schedule = generateRecoveryScheduleRecords({
      advanceId: advance.id,
      tenantId,
      userId: advance.userId,
      totalAmount: finalDisbursedAmount,
      installments: advance.recoveryInstallments || 1,
      startYear: advance.startRecoveryYear,
      startMonth: advance.startRecoveryMonth,
    });

    await tx.insert(schema.salaryAdvanceRecoveries).values(schedule);

    const [up] = await tx.update(schema.salaryAdvances).set({
      status: 'disbursed',
      disbursedAmount: formatMoneyStr(finalDisbursedAmount),
      outstandingAmount: formatMoneyStr(finalDisbursedAmount),
      disbursedAt: new Date(),
      disbursedByUserId: disburserUserId,
      disbursementMethod: disbursementMethod || 'bank_transfer',
      disbursementReference: disbursementReference || null,
      bankDetailsSnapshot: bankDetailsSnapshot || null,
      updatedAt: new Date(),
    }).where(eq(schema.salaryAdvances.id, advance.id)).returning();

    const now = new Date();
    await tx.insert(schema.payrollLedgerEntries).values({
      tenantId,
      userId: advance.userId,
      batchId: null,
      payrollRunId: null,
      entryType: 'advance_disbursement',
      sourceTable: 'salary_advances',
      sourceId: advance.id,
      amount: finalDisbursedAmount,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
    });

    updatedAdvance = up;
  });

  await logToAuditLedger({
    tenantId,
    actorId: disburserUserId,
    actorName: `User #${disburserUserId}`,
    action: 'SALARY_ADVANCE_DISBURSED',
    details: { advanceId: advance.id, userId: advance.userId, disbursedAmount: finalDisbursedAmount, disbursementMethod, disbursementReference },
  });

  const empRows = await db.select().from(schema.users).where(eq(schema.users.id, advance.userId)).limit(1);
  const empName = empRows[0]?.name || `User #${advance.userId}`;

  await notifyOrFallback(
    tenantId,
    'salary_advance_disbursed',
    advance.userId,
    empName,
    { advanceId: advance.id, amount: finalDisbursedAmount, reference: disbursementReference },
    'Salary Advance Disbursed',
    `Your salary advance of ₹${finalDisbursedAmount.toLocaleString()} has been disbursed. Recoveries will begin in ${advance.startRecoveryYear}-${String(advance.startRecoveryMonth).padStart(2, '0')}.`,
  );

  return updatedAdvance;
}

export async function cancelSalaryAdvance(params: {
  advanceId: number;
  tenantId: number;
  actorUserId: number;
  reason?: string;
  isAdmin?: boolean;
}) {
  const { advanceId, tenantId, actorUserId, reason, isAdmin } = params;

  const rows = await db.select().from(schema.salaryAdvances).where(and(eq(schema.salaryAdvances.id, advanceId), eq(schema.salaryAdvances.tenantId, tenantId))).limit(1);
  if (rows.length === 0) throw new Error('Salary advance record not found.');
  const advance = rows[0];

  if (!isAdmin && advance.userId !== actorUserId) {
    throw new Error('You can only cancel your own advance requests.');
  }

  if (advance.status === 'disbursed' || advance.status === 'partially_recovered' || advance.status === 'fully_recovered' || advance.status === 'closed') {
    throw new Error('Disbursed advances cannot be cancelled directly. Please contact finance for reversal or settlement.');
  }

  if (advance.status === 'cancelled' || advance.status === 'rejected' || advance.status === 'voided') {
    throw new Error(`Advance is already in terminal state '${advance.status}'.`);
  }

  const [updated] = await db.update(schema.salaryAdvances).set({
    status: 'cancelled',
    rejectionReason: reason || 'Cancelled by user/admin',
    updatedAt: new Date(),
  }).where(eq(schema.salaryAdvances.id, advance.id)).returning();

  await db.delete(schema.salaryAdvanceRecoveries).where(eq(schema.salaryAdvanceRecoveries.advanceId, advance.id));

  await logToAuditLedger({
    tenantId,
    actorId: actorUserId,
    actorName: `User #${actorUserId}`,
    action: 'SALARY_ADVANCE_CANCELLED',
    details: { advanceId: advance.id, userId: advance.userId, reason },
  });

  return updated;
}
