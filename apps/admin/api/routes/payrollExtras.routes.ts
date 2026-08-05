import { Router } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db, schema } from '../../db';
import { sendServerError } from '../utils/errors';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege, isPlatformFeatureAllowed } from '../auth/rbac';
import { logToAuditLedger } from '../services/audit';
import { notify } from '../services/notificationService';
import { getEffectiveDailyRate } from './leavePayrollShared';
import { computeLeaveBalancesForUser } from './leave.routes';

// Loans, Advances, Reimbursements, Bonuses, and the Salary Revision
// Workflow — the one-off financial events the payroll master prompt asked
// for as structured entities, kept separate from
// employeeSalaryComponents (recurring structure only). Each is append-only
// and feeds INTO payroll calculation as a read-only input
// (payrollBatchCalculation.ts), never inlined into a component row.

export const router = Router();

// Shared pagination-param parsing for the tenant-wide list endpoints below —
// default cap prevents an unbounded full-table scan/response while leaving
// existing callers (which pass no params) working unchanged.
function parsePagination(req: any, defaultLimit = 500, maxLimit = 2000) {
  const limit = Math.min(maxLimit, Math.max(1, Number(req.query.limit) || defaultLimit));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  return { limit, offset };
}

async function notifyOrFallback(tenantId: number, eventType: string, subjectUserId: number, subjectName: string, data: Record<string, any>, fallbackTitle: string, fallbackMessage: string) {
  const tenantRow = (await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1))[0];
  if (isPlatformFeatureAllowed(tenantRow, 'unified_notifications')) {
    await notify(tenantId, eventType, { subjectUserId, subjectName, data }).catch(() => undefined);
  } else {
    const { notifyUser } = await import('../services/notifications');
    await notifyUser(subjectUserId, fallbackTitle, fallbackMessage);
  }
}

// ---------------------------------------------------------------------------
// Loans
// ---------------------------------------------------------------------------
router.get('/api/tenant/payroll/loans', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.loans.manage') && !await hasPrivilege(req.user, 'payroll.read')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const rows = await db.select().from(schema.payrollLoans).where(eq(schema.payrollLoans.tenantId, req.user.tenantId)).orderBy(desc(schema.payrollLoans.createdAt));
    res.json({ loans: rows });
  } catch (err: any) {
    sendServerError(res, err, "payrollExtras.routes.ts");
  }
});

router.post('/api/tenant/payroll/loans', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.loans.manage')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const { userId, principal, emiAmount, startYear, startMonth, reason } = req.body || {};
    if (!userId || !principal || !emiAmount || !startYear || !startMonth) {
      return res.status(400).json({ error: 'userId, principal, emiAmount, startYear, and startMonth are required.' });
    }
    const employeeRows = await db.select().from(schema.users).where(and(eq(schema.users.id, Number(userId)), eq(schema.users.tenantId, req.user.tenantId))).limit(1);
    if (employeeRows.length === 0) return res.status(404).json({ error: 'Employee not found.' });

    const [loan] = await db.insert(schema.payrollLoans).values({
      tenantId: req.user.tenantId, userId: Number(userId), principal: Number(principal), emiAmount: Number(emiAmount),
      remainingBalance: Number(principal), startYear: Number(startYear), startMonth: Number(startMonth),
      reason: reason || null, createdByUserId: req.user.userId,
    }).returning();

    await logToAuditLedger({ tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name, action: 'PAYROLL_LOAN_CREATED', details: { loanId: loan.id, userId, principal, emiAmount } });
    await notifyOrFallback(req.user.tenantId, 'loan_approved', Number(userId), employeeRows[0].name, { principal, emiAmount }, 'Loan approved', `A loan of ${principal} has been approved, recovered at ${emiAmount}/month starting ${startYear}-${String(startMonth).padStart(2, '0')}.`);

    res.json({ loan });
  } catch (err: any) {
    sendServerError(res, err, "payrollExtras.routes.ts");
  }
});

router.post('/api/tenant/payroll/loans/:id/close', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.loans.manage')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const rows = await db.select().from(schema.payrollLoans).where(and(eq(schema.payrollLoans.id, Number(req.params.id)), eq(schema.payrollLoans.tenantId, req.user.tenantId))).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Loan not found.' });
    await db.update(schema.payrollLoans).set({ status: 'closed', remainingBalance: 0 }).where(eq(schema.payrollLoans.id, rows[0].id));
    await logToAuditLedger({ tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name, action: 'PAYROLL_LOAN_CLOSED', details: { loanId: rows[0].id } });
    res.json({ success: true });
  } catch (err: any) {
    sendServerError(res, err, "payrollExtras.routes.ts");
  }
});

// ---------------------------------------------------------------------------
// Advances
// ---------------------------------------------------------------------------
router.get('/api/tenant/payroll/advances', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.loans.manage') && !await hasPrivilege(req.user, 'payroll.read')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const { limit, offset } = parsePagination(req);
    const rows = await db.select().from(schema.payrollAdvances).where(eq(schema.payrollAdvances.tenantId, req.user.tenantId)).orderBy(desc(schema.payrollAdvances.createdAt)).limit(limit).offset(offset);
    res.json({ advances: rows, pagination: { limit, offset, returned: rows.length } });
  } catch (err: any) {
    sendServerError(res, err, "payrollExtras.routes.ts");
  }
});

router.post('/api/tenant/payroll/advances', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.loans.manage')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const { userId, amount, recoveryMonths, startYear, startMonth, reason } = req.body || {};
    if (!userId || !amount || !startYear || !startMonth) {
      return res.status(400).json({ error: 'userId, amount, startYear, and startMonth are required.' });
    }
    const employeeRows = await db.select().from(schema.users).where(and(eq(schema.users.id, Number(userId)), eq(schema.users.tenantId, req.user.tenantId))).limit(1);
    if (employeeRows.length === 0) return res.status(404).json({ error: 'Employee not found.' });

    const months = Math.max(1, Number(recoveryMonths) || 1);
    const recoveryPerMonth = Number(amount) / months;
    const [advance] = await db.insert(schema.payrollAdvances).values({
      tenantId: req.user.tenantId, userId: Number(userId), amount: Number(amount), recoveryMonths: months,
      recoveryPerMonth, remainingBalance: Number(amount), startYear: Number(startYear), startMonth: Number(startMonth),
      reason: reason || null, createdByUserId: req.user.userId,
    }).returning();

    await logToAuditLedger({ tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name, action: 'PAYROLL_ADVANCE_CREATED', details: { advanceId: advance.id, userId, amount } });
    res.json({ advance });
  } catch (err: any) {
    sendServerError(res, err, "payrollExtras.routes.ts");
  }
});

// ---------------------------------------------------------------------------
// Reimbursements — employee submits, approver decides
// ---------------------------------------------------------------------------
router.get('/api/tenant/payroll/reimbursements', authenticate, async (req: any, res: any) => {
  try {
    const canManage = await hasPrivilege(req.user, 'payroll.reimbursements.manage');
    const { limit, offset } = parsePagination(req);
    const rows = canManage
      ? await db.select().from(schema.payrollReimbursements).where(eq(schema.payrollReimbursements.tenantId, req.user.tenantId)).orderBy(desc(schema.payrollReimbursements.createdAt)).limit(limit).offset(offset)
      : await db.select().from(schema.payrollReimbursements).where(and(eq(schema.payrollReimbursements.tenantId, req.user.tenantId), eq(schema.payrollReimbursements.userId, req.user.userId))).orderBy(desc(schema.payrollReimbursements.createdAt)).limit(limit).offset(offset);
    res.json({ reimbursements: rows, pagination: { limit, offset, returned: rows.length } });
  } catch (err: any) {
    sendServerError(res, err, "payrollExtras.routes.ts");
  }
});

router.post('/api/tenant/payroll/reimbursements', authenticate, async (req: any, res: any) => {
  try {
    const { category, amount, description, receiptDocumentId } = req.body || {};
    if (!category || !amount) return res.status(400).json({ error: 'category and amount are required.' });

    const [reimbursement] = await db.insert(schema.payrollReimbursements).values({
      tenantId: req.user.tenantId, userId: req.user.userId, category, amount: Number(amount),
      description: description || null, receiptDocumentId: receiptDocumentId || null,
    }).returning();

    const approvers = await db.select().from(schema.users).where(and(eq(schema.users.tenantId, req.user.tenantId), eq(schema.users.role, 'tenant_admin')));
    if (isPlatformFeatureAllowed((await db.select().from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId)).limit(1))[0], 'unified_notifications')) {
      await notify(req.user.tenantId, 'reimbursement_approved', { subjectUserId: req.user.userId, subjectName: req.user.name, data: { category, amount, status: 'submitted' } }).catch(() => undefined);
    } else {
      const { notifyUsers } = await import('../services/notifications');
      await notifyUsers(approvers.map((a: any) => a.id), 'Reimbursement request', `${req.user.name} submitted a ${category} reimbursement of ${amount}.`);
    }

    res.json({ reimbursement });
  } catch (err: any) {
    sendServerError(res, err, "payrollExtras.routes.ts");
  }
});

router.post('/api/tenant/payroll/reimbursements/:id/action', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.reimbursements.manage')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const { action } = req.body || {};
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action must be approve or reject.' });
    const rows = await db.select().from(schema.payrollReimbursements).where(and(eq(schema.payrollReimbursements.id, Number(req.params.id)), eq(schema.payrollReimbursements.tenantId, req.user.tenantId))).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Reimbursement not found.' });
    if (rows[0].status !== 'pending') return res.status(400).json({ error: 'This reimbursement has already been decided.' });

    const [updated] = await db.update(schema.payrollReimbursements).set({
      status: action === 'approve' ? 'approved' : 'rejected', approvedByUserId: req.user.userId, approvedAt: new Date(),
    }).where(eq(schema.payrollReimbursements.id, rows[0].id)).returning();

    const employeeRows = await db.select().from(schema.users).where(eq(schema.users.id, rows[0].userId)).limit(1);
    if (employeeRows.length > 0) {
      await notifyOrFallback(req.user.tenantId, 'reimbursement_approved', rows[0].userId, employeeRows[0].name, { category: rows[0].category, amount: rows[0].amount, status: action === 'approve' ? 'approved' : 'rejected' }, `Reimbursement ${action === 'approve' ? 'approved' : 'rejected'}`, `Your ${rows[0].category} reimbursement of ${rows[0].amount} was ${action === 'approve' ? 'approved' : 'rejected'}.`);
    }

    await logToAuditLedger({ tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name, action: 'PAYROLL_REIMBURSEMENT_' + action.toUpperCase() + 'D', details: { reimbursementId: rows[0].id } });
    res.json({ reimbursement: updated });
  } catch (err: any) {
    sendServerError(res, err, "payrollExtras.routes.ts");
  }
});

// ---------------------------------------------------------------------------
// Bonuses
// ---------------------------------------------------------------------------
router.get('/api/tenant/payroll/bonuses', authenticate, async (req: any, res: any) => {
  try {
    const canManage = await hasPrivilege(req.user, 'payroll.bonuses.manage');
    const rows = canManage
      ? await db.select().from(schema.payrollBonuses).where(eq(schema.payrollBonuses.tenantId, req.user.tenantId)).orderBy(desc(schema.payrollBonuses.createdAt))
      : await db.select().from(schema.payrollBonuses).where(and(eq(schema.payrollBonuses.tenantId, req.user.tenantId), eq(schema.payrollBonuses.userId, req.user.userId))).orderBy(desc(schema.payrollBonuses.createdAt));
    res.json({ bonuses: rows });
  } catch (err: any) {
    sendServerError(res, err, "payrollExtras.routes.ts");
  }
});

router.post('/api/tenant/payroll/bonuses', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.bonuses.manage')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const { userId, type, amount, reason } = req.body || {};
    if (!userId || !type || !amount) return res.status(400).json({ error: 'userId, type, and amount are required.' });
    const employeeRows = await db.select().from(schema.users).where(and(eq(schema.users.id, Number(userId)), eq(schema.users.tenantId, req.user.tenantId))).limit(1);
    if (employeeRows.length === 0) return res.status(404).json({ error: 'Employee not found.' });

    const [bonus] = await db.insert(schema.payrollBonuses).values({
      tenantId: req.user.tenantId, userId: Number(userId), type, amount: Number(amount), reason: reason || null,
      status: 'approved', approvedByUserId: req.user.userId, approvedAt: new Date(), createdByUserId: req.user.userId,
    }).returning();

    await logToAuditLedger({ tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name, action: 'PAYROLL_BONUS_ADDED', details: { bonusId: bonus.id, userId, type, amount } });
    await notifyOrFallback(req.user.tenantId, 'bonus_added', Number(userId), employeeRows[0].name, { type, amount }, 'Bonus added', `A ${type} bonus of ${amount} has been added to your upcoming payroll.`);

    res.json({ bonus });
  } catch (err: any) {
    sendServerError(res, err, "payrollExtras.routes.ts");
  }
});

// ---------------------------------------------------------------------------
// Salary Revision Workflow — replaces direct CTC edits. HR review, then
// Finance review; only on final approval does it write to
// employeeCompensationProfiles (existing table, existing write path) —
// compensationHistory (existing) still captures the resulting diff.
// ---------------------------------------------------------------------------
router.get('/api/tenant/payroll/salary-revisions', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.manage') && !await hasPrivilege(req.user, 'payroll.review.hr') && !await hasPrivilege(req.user, 'payroll.review.finance')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const rows = await db.select().from(schema.salaryRevisionRequests).where(eq(schema.salaryRevisionRequests.tenantId, req.user.tenantId)).orderBy(desc(schema.salaryRevisionRequests.createdAt));
    res.json({ revisions: rows });
  } catch (err: any) {
    sendServerError(res, err, "payrollExtras.routes.ts");
  }
});

router.post('/api/tenant/payroll/salary-revisions', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.manage')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const { userId, type, proposedAnnualCtc, proposedComponents, effectiveDate, reason } = req.body || {};
    if (!userId || !proposedAnnualCtc || !effectiveDate) {
      return res.status(400).json({ error: 'userId, proposedAnnualCtc, and effectiveDate are required.' });
    }
    if (Number(userId) === req.user.userId && req.user.role !== 'tenant_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'You cannot propose your own salary revision.' });
    }
    const [revision] = await db.insert(schema.salaryRevisionRequests).values({
      tenantId: req.user.tenantId, userId: Number(userId), type: type === 'promotion' ? 'promotion' : 'revision',
      proposedAnnualCtc: Number(proposedAnnualCtc), proposedComponents: proposedComponents || null,
      effectiveDate, reason: reason || null, requestedByUserId: req.user.userId,
    }).returning();
    await logToAuditLedger({ tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name, action: 'SALARY_REVISION_REQUESTED', details: { revisionId: revision.id, userId, proposedAnnualCtc } });
    res.json({ revision });
  } catch (err: any) {
    sendServerError(res, err, "payrollExtras.routes.ts");
  }
});

router.post('/api/tenant/payroll/salary-revisions/:id/hr-review', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.review.hr')) return res.status(403).json({ error: 'Access denied.' });
    const { action } = req.body || {};
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action must be approve or reject.' });
    const rows = await db.select().from(schema.salaryRevisionRequests).where(and(eq(schema.salaryRevisionRequests.id, Number(req.params.id)), eq(schema.salaryRevisionRequests.tenantId, req.user.tenantId))).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Revision not found.' });
    if (rows[0].status !== 'pending_hr') return res.status(400).json({ error: `Expected status 'pending_hr', got '${rows[0].status}'.` });
    const [updated] = await db.update(schema.salaryRevisionRequests).set({
      status: action === 'approve' ? 'pending_finance' : 'rejected', hrReviewedByUserId: req.user.userId, hrReviewedAt: new Date(),
    }).where(eq(schema.salaryRevisionRequests.id, rows[0].id)).returning();
    res.json({ revision: updated });
  } catch (err: any) {
    sendServerError(res, err, "payrollExtras.routes.ts");
  }
});

router.post('/api/tenant/payroll/salary-revisions/:id/finance-review', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.review.finance')) return res.status(403).json({ error: 'Access denied.' });
    const { action } = req.body || {};
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action must be approve or reject.' });
    const rows = await db.select().from(schema.salaryRevisionRequests).where(and(eq(schema.salaryRevisionRequests.id, Number(req.params.id)), eq(schema.salaryRevisionRequests.tenantId, req.user.tenantId))).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Revision not found.' });
    if (rows[0].status !== 'pending_finance') return res.status(400).json({ error: `Expected status 'pending_finance', got '${rows[0].status}'.` });
    const revision = rows[0];

    if (action === 'approve') {
      // Write to the EXISTING employeeCompensationProfiles/employeeSalaryComponents
      // tables via the exact same shape the direct-edit route already used —
      // compensationHistory captures the diff automatically on the next read
      // of previous vs. new, same as before.
      const existing = await db.select().from(schema.employeeCompensationProfiles).where(and(eq(schema.employeeCompensationProfiles.tenantId, revision.tenantId), eq(schema.employeeCompensationProfiles.userId, revision.userId), eq(schema.employeeCompensationProfiles.status, 'active'))).limit(1);
      let profile: any;
      if (existing.length > 0) {
        [profile] = await db.update(schema.employeeCompensationProfiles).set({ annualCtc: revision.proposedAnnualCtc, effectiveFrom: revision.effectiveDate, updatedAt: new Date() }).where(eq(schema.employeeCompensationProfiles.id, existing[0].id)).returning();
      } else {
        [profile] = await db.insert(schema.employeeCompensationProfiles).values({ tenantId: revision.tenantId, userId: revision.userId, annualCtc: revision.proposedAnnualCtc, effectiveFrom: revision.effectiveDate, status: 'active' }).returning();
      }
      if (Array.isArray(revision.proposedComponents)) {
        await db.delete(schema.employeeSalaryComponents).where(eq(schema.employeeSalaryComponents.profileId, profile.id));
        const sanitized = (revision.proposedComponents as any[]).filter((c) => c?.componentName && c?.value != null).map((c, i) => ({
          tenantId: revision.tenantId, userId: revision.userId, profileId: profile.id,
          componentName: String(c.componentName), componentType: String(c.componentType || 'earning'),
          calculationType: String(c.calculationType || 'percent_of_ctc'), value: Number(c.value || 0), sortOrder: i,
        }));
        if (sanitized.length > 0) await db.insert(schema.employeeSalaryComponents).values(sanitized);
      }

      const employeeRows = await db.select().from(schema.users).where(eq(schema.users.id, revision.userId)).limit(1);
      if (employeeRows.length > 0) {
        await notifyOrFallback(revision.tenantId, 'salary_revised', revision.userId, employeeRows[0].name, { proposedAnnualCtc: revision.proposedAnnualCtc, effectiveDate: revision.effectiveDate }, 'Your salary has been revised', `Your compensation has been revised, effective ${revision.effectiveDate}.`);
      }
    }

    const [updated] = await db.update(schema.salaryRevisionRequests).set({
      status: action === 'approve' ? 'approved' : 'rejected', financeReviewedByUserId: req.user.userId, financeReviewedAt: new Date(),
    }).where(eq(schema.salaryRevisionRequests.id, revision.id)).returning();

    await logToAuditLedger({ tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name, action: 'SALARY_REVISION_' + action.toUpperCase() + 'D', details: { revisionId: revision.id, userId: revision.userId, proposedAnnualCtc: revision.proposedAnnualCtc } });
    res.json({ revision: updated });
  } catch (err: any) {
    sendServerError(res, err, "payrollExtras.routes.ts");
  }
});

// ---------------------------------------------------------------------------
// Final Settlement (P7) — triggered explicitly from an ALREADY-APPROVED
// termination request, never automatically. Reuses the existing Leave
// Engine (computeLeaveBalancesForUser) and daily-rate calculation
// (getEffectiveDailyRate, the same one leave encashment already uses) —
// no parallel settlement math for those two pieces. Notice-period recovery
// has no existing tracked data to source from (no notice-period field
// anywhere in this schema), so it's a manual amount HR enters, not
// invented from nothing.
// ---------------------------------------------------------------------------
router.get('/api/tenant/payroll/settlements', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.settlement.manage') && !await hasPrivilege(req.user, 'payroll.read')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const rows = await db.select().from(schema.payrollFinalSettlements).where(eq(schema.payrollFinalSettlements.tenantId, req.user.tenantId)).orderBy(desc(schema.payrollFinalSettlements.createdAt));
    res.json({ settlements: rows });
  } catch (err: any) {
    sendServerError(res, err, "payrollExtras.routes.ts");
  }
});

router.post('/api/tenant/payroll/settlements/generate', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.settlement.manage')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const { terminationRequestId, lastWorkingDate, noticePeriodRecoveryAmount } = req.body || {};
    if (!terminationRequestId || !lastWorkingDate) return res.status(400).json({ error: 'terminationRequestId and lastWorkingDate are required.' });

    const termRows = await db.select().from(schema.terminationRequests).where(and(eq(schema.terminationRequests.id, Number(terminationRequestId)), eq(schema.terminationRequests.tenantId, req.user.tenantId))).limit(1);
    if (termRows.length === 0) return res.status(404).json({ error: 'Termination request not found.' });
    const termination = termRows[0];
    if (termination.status !== 'approved') return res.status(400).json({ error: 'Settlement can only be generated for an approved termination.' });

    const existing = await db.select().from(schema.payrollFinalSettlements).where(eq(schema.payrollFinalSettlements.terminationRequestId, termination.id)).limit(1);
    if (existing.length > 0) return res.status(400).json({ error: 'A settlement has already been generated for this termination.' });

    const userId = termination.employeeId;
    const [, , d] = lastWorkingDate.split('-').map(Number);
    const daysWorkedInExitMonth = d;
    const dailyRate = await getEffectiveDailyRate(req.user.tenantId, userId);
    const remainingSalaryAmount = dailyRate * daysWorkedInExitMonth;

    const { balances } = await computeLeaveBalancesForUser(userId, req.user.tenantId);
    const encashableDays = (balances as any[]).filter((b: any) => b.encashmentEnabled).reduce((sum: number, b: any) => sum + Math.max(0, b.remainingDays || 0), 0);
    const leaveEncashmentAmount = dailyRate * encashableDays;

    const pendingBonuses = await db.select().from(schema.payrollBonuses).where(and(eq(schema.payrollBonuses.tenantId, req.user.tenantId), eq(schema.payrollBonuses.userId, userId), eq(schema.payrollBonuses.status, 'approved')));
    const pendingBonusAmount = pendingBonuses.reduce((sum: number, b: any) => sum + b.amount, 0);

    const activeLoans = await db.select().from(schema.payrollLoans).where(and(eq(schema.payrollLoans.tenantId, req.user.tenantId), eq(schema.payrollLoans.userId, userId), eq(schema.payrollLoans.status, 'active')));
    const activeAdvances = await db.select().from(schema.payrollAdvances).where(and(eq(schema.payrollAdvances.tenantId, req.user.tenantId), eq(schema.payrollAdvances.userId, userId), eq(schema.payrollAdvances.status, 'active')));
    const loanAdvanceRecoveryAmount = activeLoans.reduce((sum: number, l: any) => sum + l.remainingBalance, 0) + activeAdvances.reduce((sum: number, a: any) => sum + a.remainingBalance, 0);

    const noticeRecovery = Number(noticePeriodRecoveryAmount) || 0;
    const grossSettlement = remainingSalaryAmount + leaveEncashmentAmount + pendingBonusAmount;
    const netSettlement = grossSettlement - noticeRecovery - loanAdvanceRecoveryAmount;

    const [settlement] = await db.insert(schema.payrollFinalSettlements).values({
      tenantId: req.user.tenantId, userId, terminationRequestId: termination.id, lastWorkingDate,
      remainingSalaryAmount, leaveEncashmentDays: encashableDays, leaveEncashmentAmount, pendingBonusAmount,
      noticePeriodRecoveryAmount: noticeRecovery, loanAdvanceRecoveryAmount, grossSettlement, netSettlement,
      breakdown: [
        { type: 'remaining_salary', amount: remainingSalaryAmount, days: daysWorkedInExitMonth },
        { type: 'leave_encashment', amount: leaveEncashmentAmount, days: encashableDays },
        { type: 'pending_bonus', amount: pendingBonusAmount },
        { type: 'notice_period_recovery', amount: -noticeRecovery },
        { type: 'loan_advance_recovery', amount: -loanAdvanceRecoveryAmount },
      ],
      generatedByUserId: req.user.userId,
    }).returning();

    await logToAuditLedger({ tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name, action: 'PAYROLL_FINAL_SETTLEMENT_GENERATED', details: { settlementId: settlement.id, userId, netSettlement } });
    res.json({ settlement });
  } catch (err: any) {
    sendServerError(res, err, "payrollExtras.routes.ts");
  }
});

router.post('/api/tenant/payroll/settlements/:id/approve', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'payroll.settlement.manage')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const rows = await db.select().from(schema.payrollFinalSettlements).where(and(eq(schema.payrollFinalSettlements.id, Number(req.params.id)), eq(schema.payrollFinalSettlements.tenantId, req.user.tenantId))).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Settlement not found.' });
    if (rows[0].status !== 'draft') return res.status(400).json({ error: `Cannot approve a settlement in status '${rows[0].status}'.` });

    const [updated] = await db.update(schema.payrollFinalSettlements).set({ status: 'approved', approvedByUserId: req.user.userId, approvedAt: new Date() }).where(eq(schema.payrollFinalSettlements.id, rows[0].id)).returning();
    await logToAuditLedger({ tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name, action: 'PAYROLL_FINAL_SETTLEMENT_APPROVED', details: { settlementId: rows[0].id } });

    const employeeRows = await db.select().from(schema.users).where(eq(schema.users.id, rows[0].userId)).limit(1);
    if (employeeRows.length > 0) {
      await notifyOrFallback(req.user.tenantId, 'payroll_adjustment_created', rows[0].userId, employeeRows[0].name, { netSettlement: rows[0].netSettlement }, 'Final settlement approved', `Your final settlement of ${rows[0].netSettlement} has been approved.`);
    }

    res.json({ settlement: updated });
  } catch (err: any) {
    sendServerError(res, err, "payrollExtras.routes.ts");
  }
});
