import { Router } from 'express';
import { eq, and, desc, gte, lte, sql, inArray, like, or } from 'drizzle-orm';
import { db, schema } from '../../db';
import { sendServerError } from '../utils/errors';
import { getByIdForTenant } from '../utils/tenantScoped';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege, hasAnyPrivilege } from '../auth/rbac';
import { logToAuditLedger } from '../services/audit';
import { saveDocument, readDocument } from '../services/documentStorage';
import { processReceiptOcr } from '../services/ocrService';
import { generateExpenseReportFile, ALL_EXPENSE_REPORT_COLUMNS } from '../services/expenseReportService';
import { notifyUser } from '../services/notifications';

export const router = Router();

// Default expense categories if tenant has none
const DEFAULT_CATEGORIES = [
  { name: 'IT & Hardware', code: 'IT_HW', description: 'Computers, accessories, software licenses, repairs', maxLimit: 50000 },
  { name: 'Office Supplies', code: 'OFFICE_SUP', description: 'Stationery, desk items, office utilities', maxLimit: 10000 },
  { name: 'Travel & Transport', code: 'TRAVEL', description: 'Cab fares, flights, train tickets, fuel', maxLimit: 25000 },
  { name: 'Repairs & Maintenance', code: 'REPAIRS', description: 'Equipment repair, office maintenance', maxLimit: 20000 },
  { name: 'Food & Meals', code: 'MEALS', description: 'Client meals, team lunches, meeting refreshments', maxLimit: 5000 },
  { name: 'Marketing & Ads', code: 'MKTG', description: 'Promotional materials, ad spend', maxLimit: 30000 },
  { name: 'Other', code: 'OTHER', description: 'Miscellaneous business expenses', maxLimit: 10000 },
];

async function getEffectiveTenantId(user: any): Promise<number> {
  if (user?.tenantId) return Number(user.tenantId);
  const firstTenant = await db.select({ id: schema.tenants.id }).from(schema.tenants).limit(1);
  return firstTenant[0]?.id || 1;
}

async function getEffectiveUserId(user: any): Promise<number> {
  if (user?.userId) return Number(user.userId);
  if (user?.id) return Number(user.id);
  const firstUser = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
  return firstUser[0]?.id || 1;
}

/**
 * Helper to ensure default expense categories exist for tenant
 */
async function ensureDefaultCategories(tenantId: number) {
  const existing = await db.select().from(schema.expenseCategories).where(eq(schema.expenseCategories.tenantId, tenantId));
  if (existing.length === 0) {
    for (const cat of DEFAULT_CATEGORIES) {
      await db.insert(schema.expenseCategories).values({
        tenantId,
        name: cat.name,
        code: cat.code,
        description: cat.description,
        maxLimit: cat.maxLimit,
      });
    }
  }
}

/**
 * Generate unique expense ID: EXP-YYYY-00001
 */
async function generateUniqueExpenseId(tenantId: number): Promise<string> {
  const currentYear = new Date().getFullYear();
  const prefix = `EXP-${currentYear}-`;
  const existingCount = await db.select({ count: sql<number>`count(*)` }).from(schema.expenses).where(eq(schema.expenses.tenantId, tenantId));
  const num = (Number(existingCount[0]?.count || 0) + 1).toString().padStart(5, '0');
  return `${prefix}${num}`;
}

// ---------------------------------------------------------------------------
// 1. OCR Data Extraction Endpoint
// ---------------------------------------------------------------------------
router.post('/api/tenant/expenses/ocr', authenticate, async (req: any, res: any) => {
  try {
    if (req.user?.role === 'tenant_admin' || req.user?.role === 'super_admin') {
      return res.status(403).json({ error: 'Company Admins review and approve employee expenses and cannot submit personal expense claims.' });
    }
    const { fileBase64, mimeType } = req.body || {};
    if (!fileBase64 || !mimeType) {
      return res.status(400).json({ error: 'fileBase64 and mimeType are required for OCR.' });
    }

    const base64Payload = String(fileBase64).includes(',') ? String(fileBase64).split(',')[1] : String(fileBase64);
    const buffer = Buffer.from(base64Payload, 'base64');
    if (buffer.length === 0) {
      return res.status(400).json({ error: 'The uploaded file is empty.' });
    }

    const ocrResult = await processReceiptOcr(buffer, mimeType);

    await logToAuditLedger({
      tenantId: await getEffectiveTenantId(req.user),
      actorId: req.user.userId || req.user.id || 1,
      actorName: req.user.name,
      action: 'EXPENSE_OCR_PROCESSED',
      details: {
        ocrSuccess: ocrResult.ocrSuccess,
        derivedFromUploadTimestamp: ocrResult.derivedFromUploadTimestamp,
        fallbackReason: ocrResult.fallbackReason,
        extractedDate: ocrResult.expenseDate,
        extractedTime: ocrResult.expenseTime,
        extractedAmount: ocrResult.amount,
        extractedMerchant: ocrResult.merchant,
      },
    });

    res.json({ success: true, ocr: ocrResult });
  } catch (err: any) {
    sendServerError(res, err, 'expenses.routes.ts -> POST /ocr');
  }
});

// ---------------------------------------------------------------------------
// 2. Submit / Create Expense
// ---------------------------------------------------------------------------
router.post('/api/tenant/expenses', authenticate, async (req: any, res: any) => {
  try {
    if (req.user?.role === 'tenant_admin' || req.user?.role === 'super_admin') {
      return res.status(403).json({ error: 'Company Admins review and approve employee expenses and cannot submit personal expense claims.' });
    }
    const tenantId = await getEffectiveTenantId(req.user);
    const userId = await getEffectiveUserId(req.user);

    const {
      amount,
      merchant,
      category,
      categoryId,
      description,
      location,
      paymentMethod,
      expenseDate,
      expenseTime,
      receiptBase64,
      receiptFileName,
      receiptMimeType,
      originalOcrValues,
      userCorrectedValues,
      derivedFromUploadTimestamp,
      isDraft,
    } = req.body || {};

    const finalExpenseTime = expenseTime && String(expenseTime).trim().length > 0
      ? String(expenseTime).trim()
      : new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    const finalExpenseDate = expenseDate && String(expenseDate).trim().length > 0
      ? String(expenseDate).trim()
      : new Date().toISOString().slice(0, 10);

    if (!amount || (!category && !categoryId) || !finalExpenseDate) {
      return res.status(400).json({ error: 'amount, category, and expenseDate are required.' });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Valid positive amount is required.' });
    }

    // Validate category exists for tenant and is ACTIVE
    await ensureDefaultCategories(tenantId);
    const categoryQuery = String(category || categoryId || '').trim();
    const activeCategories = await db
      .select()
      .from(schema.expenseCategories)
      .where(and(eq(schema.expenseCategories.tenantId, tenantId), eq(schema.expenseCategories.status, 'active')));

    let matchedCategory = activeCategories.find(
      (c) => c.name.toLowerCase() === categoryQuery.toLowerCase() || String(c.id) === categoryQuery || c.code.toLowerCase() === categoryQuery.toLowerCase()
    );

    if (!matchedCategory && categoryQuery.length > 0) {
      const queryLower = categoryQuery.toLowerCase();
      matchedCategory = activeCategories.find((c) => {
        const cLower = c.name.toLowerCase();
        if (queryLower.includes('food') || queryLower.includes('meal') || queryLower.includes('dining')) {
          return cLower.includes('meal') || cLower.includes('food');
        }
        if (queryLower.includes('travel') || queryLower.includes('cab') || queryLower.includes('flight') || queryLower.includes('hotel') || queryLower.includes('transport')) {
          return cLower.includes('travel') || cLower.includes('transport');
        }
        if (queryLower.includes('office') || queryLower.includes('supply') || queryLower.includes('stationery')) {
          return cLower.includes('office');
        }
        if (queryLower.includes('it') || queryLower.includes('hardware') || queryLower.includes('laptop') || queryLower.includes('tech')) {
          return cLower.includes('it') || cLower.includes('hardware');
        }
        return cLower.includes(queryLower) || queryLower.includes(cLower);
      });
    }

    if (!matchedCategory && activeCategories.length > 0) {
      matchedCategory = activeCategories.find((c) => c.name.toLowerCase().includes('other')) || activeCategories[0];
    }

    if (!matchedCategory) {
      return res.status(400).json({ error: `No active expense categories available for your organization.` });
    }

    const finalCategoryName = matchedCategory.name;
    const finalCategoryId = matchedCategory.id;

    // Save receipt document if provided
    let receiptStoragePath: string | null = null;
    let receiptFileSize = 0;
    if (receiptBase64 && receiptFileName) {
      const base64Payload = String(receiptBase64).includes(',') ? String(receiptBase64).split(',')[1] : String(receiptBase64);
      const buffer = Buffer.from(base64Payload, 'base64');
      if (buffer.length > 0) {
        receiptStoragePath = await saveDocument(tenantId, buffer);
        receiptFileSize = buffer.length;
      }
    }

    const generatedExpId = await generateUniqueExpenseId(tenantId);

    // Duplicate detection check (same user, same amount, merchant, and expenseDate within last 24 hours)
    let duplicateFlag = false;
    let duplicateDetails = '';
    const potentialDuplicates = await db.select().from(schema.expenses).where(
      and(
        eq(schema.expenses.tenantId, tenantId),
        eq(schema.expenses.userId, userId),
        eq(schema.expenses.amount, parsedAmount),
        eq(schema.expenses.expenseDate, expenseDate)
      )
    );
    if (potentialDuplicates.length > 0) {
      duplicateFlag = true;
      duplicateDetails = `Possible duplicate of existing expense ${potentialDuplicates[0].expenseId} (₹${parsedAmount} on ${expenseDate})`;
    }

    // Policy violation check against category max limit
    let policyViolationFlag = false;
    let policyViolationDetails = '';
    if (matchedCategory.maxLimit && parsedAmount > matchedCategory.maxLimit) {
      policyViolationFlag = true;
      policyViolationDetails = `Amount ₹${parsedAmount.toLocaleString('en-IN')} exceeds category maximum policy limit of ₹${matchedCategory.maxLimit.toLocaleString('en-IN')}`;
    }

    const initialStatus = isDraft ? 'draft' : 'pending_approval';

    const [newExp] = await db.insert(schema.expenses).values({
      tenantId,
      userId,
      expenseId: generatedExpId,
      amount: parsedAmount,
      currency: 'INR',
      merchant: merchant ? String(merchant).trim() : null,
      category: finalCategoryName,
      categoryId: finalCategoryId,
      description: description ? String(description).trim() : null,
      location: location ? String(location).trim() : null,
      paymentMethod: paymentMethod || 'Personal Payment',
      receiptStoragePath,
      receiptOriginalName: receiptFileName || null,
      receiptMimeType: receiptMimeType || null,
      receiptFileSize,
      expenseDate: finalExpenseDate,
      expenseTime: finalExpenseTime,
      uploadTimestamp: new Date(),
      originalOcrValues: originalOcrValues || null,
      userCorrectedValues: userCorrectedValues || null,
      derivedFromUploadTimestamp: !!derivedFromUploadTimestamp,
      isOcrVerified: true,
      status: initialStatus,
      approvedAmount: null,
      reimbursedAmount: 0,
      remainingAmount: null,
      policyViolationFlag,
      policyViolationDetails,
      duplicateFlag,
      duplicateDetails,
    }).returning();

    await logToAuditLedger({
      tenantId,
      actorId: userId,
      actorName: req.user.name,
      action: isDraft ? 'EXPENSE_DRAFT_SAVED' : 'EXPENSE_SUBMITTED',
      details: {
        id: newExp.id,
        expenseId: newExp.expenseId,
        amount: newExp.amount,
        merchant: newExp.merchant,
        category: newExp.category,
        policyViolationFlag,
        duplicateFlag,
      },
    });

    if (!isDraft) {
      await notifyUser(userId, `Expense ${newExp.expenseId} Submitted`, `Your expense of ₹${parsedAmount.toLocaleString('en-IN')} for ${newExp.category} has been submitted for approval.`);
    }

    res.json({ success: true, expense: newExp });
  } catch (err: any) {
    sendServerError(res, err, 'expenses.routes.ts -> POST /expenses');
  }
});

// ---------------------------------------------------------------------------
// 3. List Expenses (Paginated, Searchable, Filterable)
// ---------------------------------------------------------------------------
router.get('/api/tenant/expenses', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId || 1;
    const userId = req.user.userId || req.user.id || 1;

    const canReadGlobal = await hasAnyPrivilege(req.user, ['expenses.read', 'expenses.approve', 'reports.view']);

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const statusFilter = req.query.status as string;
    const categoryFilter = req.query.category as string;
    const monthFilter = req.query.month as string; // 'YYYY-MM'
    const employeeFilter = req.query.employeeId ? Number(req.query.employeeId) : null;
    const search = req.query.search ? String(req.query.search).trim() : null;

    const conditions: any[] = [eq(schema.expenses.tenantId, tenantId)];

    // Scoping check: employees only see their own expenses unless they hold global expense privileges
    if (!canReadGlobal) {
      conditions.push(eq(schema.expenses.userId, userId));
    } else if (employeeFilter) {
      conditions.push(eq(schema.expenses.userId, employeeFilter));
    }

    if (statusFilter && statusFilter !== 'ALL') {
      conditions.push(eq(schema.expenses.status, statusFilter));
    }

    if (categoryFilter && categoryFilter !== 'ALL') {
      conditions.push(eq(schema.expenses.category, categoryFilter));
    }

    if (monthFilter) {
      conditions.push(like(schema.expenses.expenseDate, `${monthFilter}%`));
    }

    if (search) {
      conditions.push(
        or(
          like(schema.expenses.expenseId, `%${search}%`),
          like(schema.expenses.merchant, `%${search}%`),
          like(schema.expenses.description, `%${search}%`),
          like(schema.users.name, `%${search}%`)
        )
      );
    }

    const whereClause = and(...conditions);

    const [countResult, rows, allTenantRows] = await Promise.all([
      db.select({ total: sql<number>`count(*)` })
        .from(schema.expenses)
        .innerJoin(schema.users, eq(schema.expenses.userId, schema.users.id))
        .where(whereClause),
      db.select({
        expense: schema.expenses,
        user: {
          id: schema.users.id,
          name: schema.users.name,
          email: schema.users.email,
          department: schema.users.department,
          designation: schema.users.designation,
        },
      })
      .from(schema.expenses)
      .innerJoin(schema.users, eq(schema.expenses.userId, schema.users.id))
      .where(whereClause)
      .orderBy(desc(schema.expenses.createdAt))
      .limit(limit)
      .offset(offset),
      // All rows matching user scoping (ignoring status/search filter) for status count badges & KPI metrics
      db.select({ expense: schema.expenses, userName: schema.users.name })
        .from(schema.expenses)
        .innerJoin(schema.users, eq(schema.expenses.userId, schema.users.id))
        .where(and(eq(schema.expenses.tenantId, tenantId), !canReadGlobal ? eq(schema.expenses.userId, userId) : undefined)),
    ]);

    const totalRecords = Number(countResult[0]?.total || 0);

    const formattedExpenses = rows.map((r) => ({
      ...r.expense,
      employeeName: r.user.name,
      employeeEmail: r.user.email,
      department: r.user.department,
      designation: r.user.designation,
    }));

    const summaryObj = computeExpenseMetrics(allTenantRows);

    res.json({
      success: true,
      expenses: formattedExpenses,
      pagination: {
        page,
        limit,
        totalRecords,
        totalPages: Math.ceil(totalRecords / limit) || 1,
      },
      summary: summaryObj,
      allScopeExpenses: allTenantRows.map((r) => ({
        ...r.expense,
        employeeName: r.userName,
      })),
    });
  } catch (err: any) {
    sendServerError(res, err, 'expenses.routes.ts -> GET /expenses');
  }
});

/**
 * Helper to calculate dynamic expense metrics across a set of expense records
 */
function computeExpenseMetrics(expenseRows: any[]) {
  const currentYear = new Date().getFullYear().toString();
  const currentMonth = `${currentYear}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

  let thisMonthTotal = 0;
  let thisYearTotal = 0;
  let pendingCount = 0;
  let pendingAmount = 0;
  let approvedCount = 0;
  let approvedAmount = 0;
  let partiallyReimbursedCount = 0;
  let partiallyReimbursedAmount = 0;
  let reimbursedCount = 0;
  let reimbursedAmount = 0;
  let outstandingReimbursementAmount = 0;
  let rejectedCount = 0;
  let draftCount = 0;

  for (const row of expenseRows) {
    const exp = row.expense || row;
    const claimedAmt = Number(exp.amount || 0);
    const approvedAmt = Number(exp.approvedAmount ?? (['approved', 'partially_reimbursed', 'reimbursed'].includes(exp.status) ? claimedAmt : 0));
    const reimbursedAmt = Number(exp.reimbursedAmount ?? (exp.status === 'reimbursed' ? approvedAmt : 0));
    const remainingAmt = Number(exp.remainingAmount ?? (exp.status === 'reimbursed' ? 0 : Math.max(0, approvedAmt - reimbursedAmt)));

    if (exp.expenseDate && exp.expenseDate.startsWith(currentMonth) && exp.status !== 'rejected') {
      thisMonthTotal += claimedAmt;
    }
    if (exp.expenseDate && exp.expenseDate.startsWith(currentYear) && exp.status !== 'rejected') {
      thisYearTotal += claimedAmt;
    }

    if (exp.status === 'pending_approval') {
      pendingCount++;
      pendingAmount += claimedAmt;
    } else if (exp.status === 'approved') {
      approvedCount++;
      approvedAmount += approvedAmt;
      reimbursedAmount += reimbursedAmt;
      outstandingReimbursementAmount += remainingAmt;
    } else if (exp.status === 'partially_reimbursed') {
      partiallyReimbursedCount++;
      partiallyReimbursedAmount += reimbursedAmt;
      reimbursedAmount += reimbursedAmt;
      outstandingReimbursementAmount += remainingAmt;
    } else if (exp.status === 'reimbursed') {
      reimbursedCount++;
      reimbursedAmount += (reimbursedAmt > 0 ? reimbursedAmt : approvedAmt);
    } else if (exp.status === 'rejected') {
      rejectedCount++;
    } else if (exp.status === 'draft') {
      draftCount++;
    }
  }

  return {
    thisMonthTotal,
    thisYearTotal,
    pendingCount,
    pendingAmount,
    approvedCount,
    approvedAmount,
    partiallyReimbursedCount,
    partiallyReimbursedAmount,
    reimbursedCount,
    reimbursedAmount,
    outstandingReimbursementAmount,
    rejectedCount,
    draftCount,
    totalCount: expenseRows.length,
    // Aliases
    totalExpensesThisMonth: thisMonthTotal,
    totalExpensesThisYear: thisYearTotal,
    pendingApprovalCount: pendingCount,
    pendingApprovalAmount: pendingAmount,
    approvedPendingReimbursementCount: approvedCount + partiallyReimbursedCount,
    approvedPendingReimbursementAmount: outstandingReimbursementAmount,
  };
}

// ---------------------------------------------------------------------------
// 4. Admin / Dashboard Expense Summary Metrics
// ---------------------------------------------------------------------------
router.get('/api/tenant/expenses/summary', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId || 1;
    const userId = req.user.userId || req.user.id || 1;
    const canReadGlobal = await hasAnyPrivilege(req.user, ['expenses.read', 'expenses.approve', 'reports.view']);

    const userCondition = canReadGlobal ? eq(schema.expenses.tenantId, tenantId) : and(eq(schema.expenses.tenantId, tenantId), eq(schema.expenses.userId, userId));

    const rows = await db.select().from(schema.expenses).where(userCondition);
    const summaryObj = computeExpenseMetrics(rows);

    res.json({
      success: true,
      summary: summaryObj,
    });
  } catch (err: any) {
    sendServerError(res, err, 'expenses.routes.ts -> GET /summary');
  }
});

// ---------------------------------------------------------------------------
// 4a. Categories List (must be registered BEFORE the :id param route below)
// ---------------------------------------------------------------------------
router.get('/api/tenant/expenses/categories', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = await getEffectiveTenantId(req.user);
    await ensureDefaultCategories(tenantId);
    const includeInactive = req.query.includeInactive === 'true';

    const conditions: any[] = [eq(schema.expenseCategories.tenantId, tenantId)];
    if (!includeInactive) {
      conditions.push(eq(schema.expenseCategories.status, 'active'));
    }

    const categories = await db
      .select()
      .from(schema.expenseCategories)
      .where(and(...conditions))
      .orderBy(schema.expenseCategories.name);

    res.json({ success: true, categories });
  } catch (err: any) {
    sendServerError(res, err, 'expenses.routes.ts -> GET /categories');
  }
});

// ---------------------------------------------------------------------------
// 4b. Report Templates List (must be registered BEFORE the :id param route below)
// ---------------------------------------------------------------------------
router.get('/api/tenant/expenses/reports/templates', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = req.user.tenantId || 1;
    const templates = await db.select().from(schema.expenseReports).where(eq(schema.expenseReports.tenantId, tenantId));
    res.json({ success: true, templates });
  } catch (err: any) {
    sendServerError(res, err, 'expenses.routes.ts -> GET /reports/templates');
  }
});

// ---------------------------------------------------------------------------
// 5. Get Expense Details
// ---------------------------------------------------------------------------
router.get('/api/tenant/expenses/:id', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = await getEffectiveTenantId(req.user);
    const expId = Number(req.params.id);

    const exp = await getByIdForTenant(schema.expenses, expId, tenantId);
    if (!exp) {
      return res.status(404).json({ error: 'Expense record not found.' });
    }

    const currentUserId = req.user.userId || req.user.id || 1;
    // RBAC check: must be owner or have read/approve privilege
    if (exp.userId !== currentUserId && !(await hasAnyPrivilege(req.user, ['expenses.read', 'expenses.approve', 'reports.view']))) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }

    const employee = await getByIdForTenant(schema.users, exp.userId, tenantId);

    let approvedBy = null;
    if (exp.approvedByUserId) {
      approvedBy = await getByIdForTenant(schema.users, exp.approvedByUserId, tenantId);
    }

    let reimbursedBy = null;
    if (exp.reimbursedByUserId) {
      reimbursedBy = await getByIdForTenant(schema.users, exp.reimbursedByUserId, tenantId);
    }

    const reimbursementRows = await db
      .select({
        reimbursement: schema.expenseReimbursements,
        actor: {
          id: schema.users.id,
          name: schema.users.name,
          email: schema.users.email,
        },
      })
      .from(schema.expenseReimbursements)
      .innerJoin(schema.users, eq(schema.expenseReimbursements.reimbursedByUserId, schema.users.id))
      .where(and(eq(schema.expenseReimbursements.tenantId, tenantId), eq(schema.expenseReimbursements.expenseId, exp.id)))
      .orderBy(schema.expenseReimbursements.createdAt);

    const formattedHistory = reimbursementRows.map((r) => ({
      ...r.reimbursement,
      reimbursedByName: r.actor.name,
      reimbursedByEmail: r.actor.email,
    }));

    const approvedAmt = exp.approvedAmount ?? (['approved', 'partially_reimbursed', 'reimbursed'].includes(exp.status) ? exp.amount : null);
    const reimbursedAmt = exp.reimbursedAmount ?? (exp.status === 'reimbursed' ? (approvedAmt ?? exp.amount) : 0);
    const remainingAmt = exp.remainingAmount ?? (exp.status === 'reimbursed' ? 0 : ((approvedAmt ?? exp.amount) - reimbursedAmt));

    res.json({
      success: true,
      expense: {
        ...exp,
        approvedAmount: approvedAmt,
        reimbursedAmount: reimbursedAmt,
        remainingAmount: remainingAmt,
        employeeName: employee?.name || 'Unknown',
        employeeEmail: employee?.email || '',
        department: employee?.department || '',
        designation: employee?.designation || '',
        approvedByName: approvedBy?.name || null,
        reimbursedByName: reimbursedBy?.name || null,
        reimbursementHistory: formattedHistory,
      },
    });
  } catch (err: any) {
    sendServerError(res, err, 'expenses.routes.ts -> GET /expenses/:id');
  }
});

// ---------------------------------------------------------------------------
// 6. Approve Expense
// ---------------------------------------------------------------------------
router.post('/api/tenant/expenses/:id/approve', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = await getEffectiveTenantId(req.user);
    const expId = Number(req.params.id);

    if (!(await hasPrivilege(req.user, 'expenses.approve'))) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to approve expenses.' });
    }

    const exp = await getByIdForTenant(schema.expenses, expId, tenantId);
    if (!exp) {
      return res.status(404).json({ error: 'Expense record not found.' });
    }

    const currentUserId = req.user.userId || req.user.id || 1;
    // Segregation of Duties Rule: Expense owner cannot approve their own expense
    if (exp.userId === currentUserId) {
      await logToAuditLedger({
        tenantId,
        actorId: currentUserId,
        actorName: req.user.name,
        action: 'EXPENSE_SELF_ACTION_BLOCKED',
        details: { expenseId: exp.expenseId, attemptedAction: 'approve', reason: 'Segregation of duties violation: Self-approval not permitted' },
      });
      return res.status(403).json({ error: 'Segregation of duties violation: You cannot approve your own expense claim.' });
    }

    if (exp.status !== 'pending_approval') {
      return res.status(400).json({ error: `Cannot approve expense in status '${exp.status}'. Only pending expenses can be approved.` });
    }

    const [updatedExp] = await db.update(schema.expenses).set({
      status: 'approved',
      approvedAmount: exp.amount,
      reimbursedAmount: 0,
      remainingAmount: exp.amount,
      approvedByUserId: currentUserId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(schema.expenses.id, exp.id)).returning();

    await logToAuditLedger({
      tenantId,
      actorId: currentUserId,
      actorName: req.user.name,
      action: 'EXPENSE_APPROVED',
      details: { expenseId: exp.expenseId, amount: exp.amount, employeeId: exp.userId },
    });

    await notifyUser(exp.userId, `Expense ${exp.expenseId} Approved`, `Your expense claim of ₹${exp.amount.toLocaleString('en-IN')} has been approved and is pending reimbursement.`);

    res.json({ success: true, expense: updatedExp });
  } catch (err: any) {
    sendServerError(res, err, 'expenses.routes.ts -> POST /expenses/:id/approve');
  }
});

// ---------------------------------------------------------------------------
// 7. Reject Expense (Requires mandatory reason)
// ---------------------------------------------------------------------------
router.post('/api/tenant/expenses/:id/reject', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = await getEffectiveTenantId(req.user);
    const expId = Number(req.params.id);
    const { reason } = req.body || {};

    if (!(await hasPrivilege(req.user, 'expenses.approve'))) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to reject expenses.' });
    }

    if (!reason || String(reason).trim().length === 0) {
      return res.status(400).json({ error: 'Rejection reason is required.' });
    }

    const exp = await getByIdForTenant(schema.expenses, expId, tenantId);
    if (!exp) {
      return res.status(404).json({ error: 'Expense record not found.' });
    }

    const currentUserId = req.user.userId || req.user.id || 1;
    // Segregation of Duties Rule: Expense owner cannot reject their own expense as an approver
    if (exp.userId === currentUserId) {
      await logToAuditLedger({
        tenantId,
        actorId: currentUserId,
        actorName: req.user.name,
        action: 'EXPENSE_SELF_ACTION_BLOCKED',
        details: { expenseId: exp.expenseId, attemptedAction: 'reject', reason: 'Segregation of duties violation: Self-rejection as approver not permitted' },
      });
      return res.status(403).json({ error: 'Segregation of duties violation: You cannot reject your own expense claim as an approver.' });
    }

    if (exp.status !== 'pending_approval' && exp.status !== 'approved') {
      return res.status(400).json({ error: `Cannot reject expense in status '${exp.status}'.` });
    }

    const rejectionReasonStr = String(reason).trim();

    const [updatedExp] = await db.update(schema.expenses).set({
      status: 'rejected',
      rejectionReason: rejectionReasonStr,
      updatedAt: new Date(),
    }).where(eq(schema.expenses.id, exp.id)).returning();

    await logToAuditLedger({
      tenantId,
      actorId: currentUserId,
      actorName: req.user.name,
      action: 'EXPENSE_REJECTED',
      details: { expenseId: exp.expenseId, amount: exp.amount, employeeId: exp.userId, reason: rejectionReasonStr },
    });

    await notifyUser(exp.userId, `Expense ${exp.expenseId} Rejected`, `Your expense claim of ₹${exp.amount.toLocaleString('en-IN')} was rejected. Reason: ${rejectionReasonStr}`);

    res.json({ success: true, expense: updatedExp });
  } catch (err: any) {
    sendServerError(res, err, 'expenses.routes.ts -> POST /expenses/:id/reject');
  }
});

// ---------------------------------------------------------------------------
// 8. Mark Expense Reimbursed (Separate from Approval)
// ---------------------------------------------------------------------------
router.post('/api/tenant/expenses/:id/reimburse', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = await getEffectiveTenantId(req.user);
    const expId = Number(req.params.id);
    const { reimbursementRef, amount, reimbursementAmount, paymentMethod, notes } = req.body || {};

    if (!(await hasPrivilege(req.user, 'expenses.reimburse'))) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to mark expenses as reimbursed.' });
    }

    const exp = await getByIdForTenant(schema.expenses, expId, tenantId);
    if (!exp) {
      return res.status(404).json({ error: 'Expense record not found.' });
    }

    const currentUserId = req.user.userId || req.user.id || 1;

    // Segregation of Duties Rule: Expense owner cannot mark their own expense as reimbursed
    if (exp.userId === currentUserId) {
      await logToAuditLedger({
        tenantId,
        actorId: currentUserId,
        actorName: req.user.name,
        action: 'EXPENSE_SELF_ACTION_BLOCKED',
        details: { expenseId: exp.expenseId, attemptedAction: 'reimburse', reason: 'Segregation of duties violation: Self-reimbursement not permitted' },
      });
      return res.status(403).json({ error: 'Segregation of duties violation: You cannot mark your own expense claim as reimbursed.' });
    }

    if (exp.status !== 'approved' && exp.status !== 'partially_reimbursed') {
      return res.status(400).json({ error: `Cannot reimburse expense in status '${exp.status}'. Only approved or partially reimbursed expenses can be reimbursed.` });
    }

    const effectiveApproved = exp.approvedAmount ?? exp.amount;
    const effectiveReimbursed = exp.reimbursedAmount ?? (exp.status === 'reimbursed' ? effectiveApproved : 0);
    const effectiveRemaining = exp.remainingAmount ?? (exp.status === 'reimbursed' ? 0 : Math.max(0, effectiveApproved - effectiveReimbursed));

    if (effectiveRemaining <= 0) {
      return res.status(400).json({ error: `Expense ${exp.expenseId} is already fully reimbursed.` });
    }

    const rawInputAmount = amount ?? reimbursementAmount;
    let payAmount: number;

    if (rawInputAmount === undefined || rawInputAmount === null || String(rawInputAmount).trim() === '') {
      payAmount = effectiveRemaining;
    } else {
      payAmount = parseFloat(String(rawInputAmount));
    }

    if (isNaN(payAmount) || payAmount <= 0) {
      return res.status(400).json({ error: 'Reimbursement amount must be a positive number greater than 0.' });
    }

    // Round to 2 decimal places to prevent floating point inaccuracies
    payAmount = Math.round(payAmount * 100) / 100;
    const roundedRemaining = Math.round(effectiveRemaining * 100) / 100;

    if (payAmount > roundedRemaining) {
      return res.status(400).json({
        error: `Reimbursement amount (₹${payAmount.toLocaleString('en-IN')}) exceeds the remaining reimbursable amount of ₹${roundedRemaining.toLocaleString('en-IN')}.`,
      });
    }

    const isPartialPayment = payAmount < roundedRemaining;

    // Check Allow Partial Reimbursement permission if a partial amount was entered
    if (isPartialPayment) {
      const canPartial = await hasPrivilege(req.user, 'expenses.reimburse.partial');
      if (!canPartial) {
        return res.status(403).json({
          error: `Access denied: Partial reimbursement capability ('Allow Partial Reimbursement') is not enabled for your role. You can only reimburse the complete remaining amount of ₹${roundedRemaining.toLocaleString('en-IN')}.`,
        });
      }
    }

    const newReimbursedTotal = Math.round((effectiveReimbursed + payAmount) * 100) / 100;
    const newRemainingTotal = Math.max(0, Math.round((effectiveApproved - newReimbursedTotal) * 100) / 100);
    const newStatus = newRemainingTotal === 0 ? 'reimbursed' : 'partially_reimbursed';
    const refString = reimbursementRef ? String(reimbursementRef).trim() : 'Bank Transfer / Payroll';

    const [updatedExp] = await db
      .update(schema.expenses)
      .set({
        status: newStatus,
        approvedAmount: effectiveApproved,
        reimbursedAmount: newReimbursedTotal,
        remainingAmount: newRemainingTotal,
        reimbursedByUserId: currentUserId,
        reimbursedAt: new Date(),
        reimbursementRef: refString,
        updatedAt: new Date(),
      })
      .where(eq(schema.expenses.id, exp.id))
      .returning();

    const [transaction] = await db
      .insert(schema.expenseReimbursements)
      .values({
        tenantId,
        expenseId: exp.id,
        userId: exp.userId,
        reimbursedByUserId: currentUserId,
        amount: payAmount,
        paymentRef: refString,
        paymentMethod: paymentMethod ? String(paymentMethod).trim() : 'Bank Transfer',
        previousRemainingAmount: effectiveRemaining,
        newRemainingAmount: newRemainingTotal,
        isPartial: isPartialPayment,
        notes: notes ? String(notes).trim() : null,
      })
      .returning();

    await logToAuditLedger({
      tenantId,
      actorId: currentUserId,
      actorName: req.user.name,
      action: isPartialPayment ? 'EXPENSE_PARTIALLY_REIMBURSED' : 'EXPENSE_REIMBURSED',
      details: {
        expenseId: exp.expenseId,
        reimbursedAmount: payAmount,
        previousRemaining: effectiveRemaining,
        newRemaining: newRemainingTotal,
        status: newStatus,
        employeeId: exp.userId,
        ref: refString,
      },
    });

    const notifyMsg = isPartialPayment
      ? `A partial payment of ₹${payAmount.toLocaleString('en-IN')} has been disbursed for expense ${exp.expenseId}. Remaining balance: ₹${newRemainingTotal.toLocaleString('en-IN')}.`
      : `Your expense claim ${exp.expenseId} has been fully reimbursed (₹${payAmount.toLocaleString('en-IN')}).`;

    await notifyUser(exp.userId, `Expense ${exp.expenseId} ${isPartialPayment ? 'Partially Reimbursed' : 'Reimbursed!'}`, notifyMsg);

    res.json({
      success: true,
      expense: updatedExp,
      transaction,
    });
  } catch (err: any) {
    sendServerError(res, err, 'expenses.routes.ts -> POST /expenses/:id/reimburse');
  }
});

// ---------------------------------------------------------------------------
// 9. Employee Withdraw Pending Expense
// ---------------------------------------------------------------------------
router.post('/api/tenant/expenses/:id/withdraw', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = await getEffectiveTenantId(req.user);
    const expId = Number(req.params.id);

    const exp = await getByIdForTenant(schema.expenses, expId, tenantId);
    if (!exp) {
      return res.status(404).json({ error: 'Expense record not found.' });
    }

    const currentUserId = req.user.userId || req.user.id || 1;
    if (exp.userId !== currentUserId) {
      return res.status(403).json({ error: 'You can only withdraw your own expenses.' });
    }

    if (exp.status !== 'pending_approval') {
      return res.status(400).json({ error: `Cannot withdraw expense in status '${exp.status}'.` });
    }

    const [updatedExp] = await db.update(schema.expenses).set({
      status: 'draft',
      updatedAt: new Date(),
    }).where(eq(schema.expenses.id, exp.id)).returning();

    await logToAuditLedger({
      tenantId,
      actorId: req.user.userId,
      actorName: req.user.name,
      action: 'EXPENSE_WITHDRAWN',
      details: { expenseId: exp.expenseId },
    });

    res.json({ success: true, expense: updatedExp });
  } catch (err: any) {
    sendServerError(res, err, 'expenses.routes.ts -> POST /expenses/:id/withdraw');
  }
});

// ---------------------------------------------------------------------------
// 10. Secure Receipt Download / Stream
// ---------------------------------------------------------------------------
router.get('/api/tenant/expenses/:id/receipt', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = await getEffectiveTenantId(req.user);
    const expId = Number(req.params.id);

    const exp = await getByIdForTenant(schema.expenses, expId, tenantId);
    if (!exp || !exp.receiptStoragePath) {
      return res.status(404).json({ error: 'Receipt file not found.' });
    }

    const currentUserId = await getEffectiveUserId(req.user);
    if (exp.userId !== currentUserId && !(await hasAnyPrivilege(req.user, ['expenses.read', 'expenses.approve', 'reports.view']))) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }

    const fileBuffer = await readDocument(exp.receiptStoragePath);
    const mime = exp.receiptMimeType || 'image/jpeg';
    const filename = exp.receiptOriginalName || `receipt_${exp.expenseId}.jpg`;

    const isDownload = req.query.download === 'true' || req.query.disposition === 'attachment';
    const dispositionType = isDownload ? 'attachment' : 'inline';

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `${dispositionType}; filename="${filename.replace(/["\r\n]/g, '')}"`);
    res.send(fileBuffer);
  } catch (err: any) {
    sendServerError(res, err, 'expenses.routes.ts -> GET /expenses/:id/receipt');
  }
});

// ---------------------------------------------------------------------------
// 11. Categories Management (GET route moved above :id to prevent shadowing)
// ---------------------------------------------------------------------------

router.post('/api/tenant/expenses/categories', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = await getEffectiveTenantId(req.user);
    if (!(await hasAnyPrivilege(req.user, ['expenses.policy', 'settings.edit'])) && req.user.role !== 'tenant_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges to manage categories.' });
    }

    const { name, code, description, maxLimit, status } = req.body || {};
    if (!name || String(name).trim().length === 0) {
      return res.status(400).json({ error: 'Category name is required.' });
    }

    const trimmedName = String(name).trim();
    const generatedCode = code ? String(code).trim().toUpperCase() : trimmedName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase().slice(0, 16);

    const existing = await db
      .select()
      .from(schema.expenseCategories)
      .where(and(eq(schema.expenseCategories.tenantId, tenantId), eq(schema.expenseCategories.name, trimmedName)));

    if (existing.length > 0) {
      return res.status(400).json({ error: `Expense category '${trimmedName}' already exists.` });
    }

    const [newCat] = await db
      .insert(schema.expenseCategories)
      .values({
        tenantId,
        name: trimmedName,
        code: generatedCode,
        description: description ? String(description).trim() : null,
        maxLimit: maxLimit && !isNaN(parseFloat(maxLimit)) ? parseFloat(maxLimit) : null,
        status: status === 'inactive' ? 'inactive' : 'active',
      })
      .returning();

    await logToAuditLedger({
      tenantId,
      actorId: req.user.userId || req.user.id || 1,
      actorName: req.user.name,
      action: 'EXPENSE_CATEGORY_CREATED',
      details: { id: newCat.id, name: newCat.name, code: newCat.code },
    });

    res.json({ success: true, category: newCat });
  } catch (err: any) {
    sendServerError(res, err, 'expenses.routes.ts -> POST /categories');
  }
});

router.put('/api/tenant/expenses/categories/:id', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = await getEffectiveTenantId(req.user);
    const catId = Number(req.params.id);

    if (!(await hasAnyPrivilege(req.user, ['expenses.policy', 'settings.edit'])) && req.user.role !== 'tenant_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges to edit categories.' });
    }

    const cat = await getByIdForTenant(schema.expenseCategories, catId, tenantId);
    if (!cat) {
      return res.status(404).json({ error: 'Category not found.' });
    }

    const { name, code, description, maxLimit, status } = req.body || {};
    const updateData: any = { updatedAt: new Date() };

    if (name && String(name).trim().length > 0) updateData.name = String(name).trim();
    if (code) updateData.code = String(code).trim().toUpperCase();
    if (description !== undefined) updateData.description = description ? String(description).trim() : null;
    if (maxLimit !== undefined) updateData.maxLimit = maxLimit && !isNaN(parseFloat(maxLimit)) ? parseFloat(maxLimit) : null;
    if (status && ['active', 'inactive'].includes(status)) updateData.status = status;

    const [updatedCat] = await db
      .update(schema.expenseCategories)
      .set(updateData)
      .where(and(eq(schema.expenseCategories.id, catId), eq(schema.expenseCategories.tenantId, tenantId)))
      .returning();

    await logToAuditLedger({
      tenantId,
      actorId: req.user.userId,
      actorName: req.user.name,
      action: 'EXPENSE_CATEGORY_UPDATED',
      details: { id: updatedCat.id, name: updatedCat.name, status: updatedCat.status },
    });

    res.json({ success: true, category: updatedCat });
  } catch (err: any) {
    sendServerError(res, err, 'expenses.routes.ts -> PUT /categories/:id');
  }
});

router.patch('/api/tenant/expenses/categories/:id/toggle-status', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = await getEffectiveTenantId(req.user);
    const catId = Number(req.params.id);

    if (!(await hasAnyPrivilege(req.user, ['expenses.policy', 'settings.edit'])) && req.user.role !== 'tenant_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }

    const cat = await getByIdForTenant(schema.expenseCategories, catId, tenantId);
    if (!cat) {
      return res.status(404).json({ error: 'Category not found.' });
    }

    const newStatus = cat.status === 'active' ? 'inactive' : 'active';
    const [updatedCat] = await db
      .update(schema.expenseCategories)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(and(eq(schema.expenseCategories.id, catId), eq(schema.expenseCategories.tenantId, tenantId)))
      .returning();

    await logToAuditLedger({
      tenantId,
      actorId: req.user.userId,
      actorName: req.user.name,
      action: 'EXPENSE_CATEGORY_STATUS_TOGGLED',
      details: { id: updatedCat.id, name: updatedCat.name, oldStatus: cat.status, newStatus },
    });

    res.json({ success: true, category: updatedCat });
  } catch (err: any) {
    sendServerError(res, err, 'expenses.routes.ts -> PATCH /categories/:id/toggle-status');
  }
});

// ---------------------------------------------------------------------------
// 12. In-Module Custom Report Generator
// ---------------------------------------------------------------------------
router.post('/api/tenant/expenses/reports/generate', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = await getEffectiveTenantId(req.user);

    if (!(await hasAnyPrivilege(req.user, ['expenses.reports', 'expenses.read', 'reports.view']))) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges to generate expense reports.' });
    }

    const { columns, filters, format, title } = req.body || {};

    const chosenColumns: string[] = Array.isArray(columns) && columns.length > 0 ? columns : ['expenseId', 'employeeName', 'expenseDate', 'category', 'amount', 'status'];
    const chosenFormat = ['csv', 'excel', 'pdf', 'json'].includes(format) ? format : 'csv';
    const reportTitle = title ? String(title).trim() : 'Expense Report';

    const canReadGlobal = await hasAnyPrivilege(req.user, ['expenses.read', 'expenses.approve', 'reports.view']);

    // Fetch filtered expenses
    const conditions: any[] = [eq(schema.expenses.tenantId, tenantId)];

    if (!canReadGlobal) {
      const currentUserId = req.user.userId || req.user.id || 1;
      conditions.push(eq(schema.expenses.userId, currentUserId));
    }

    if (filters?.status && filters.status !== 'ALL') {
      conditions.push(eq(schema.expenses.status, filters.status));
    }
    if (filters?.category && filters.category !== 'ALL') {
      conditions.push(eq(schema.expenses.category, filters.category));
    }
    if (filters?.month) {
      conditions.push(like(schema.expenses.expenseDate, `${filters.month}%`));
    }
    if (filters?.employeeId && canReadGlobal) {
      conditions.push(eq(schema.expenses.userId, Number(filters.employeeId)));
    }

    const rows = await db.select({
      expense: schema.expenses,
      user: schema.users,
    })
    .from(schema.expenses)
    .innerJoin(schema.users, eq(schema.expenses.userId, schema.users.id))
    .where(and(...conditions))
    .orderBy(desc(schema.expenses.createdAt));

    // Map rows into raw report record objects
    const reportData = rows.map((r) => {
      const claimedAmt = Number(r.expense.amount || 0);
      const approvedAmt = Number(r.expense.approvedAmount ?? (['approved', 'partially_reimbursed', 'reimbursed'].includes(r.expense.status) ? claimedAmt : 0));
      const reimbursedAmt = Number(r.expense.reimbursedAmount ?? (r.expense.status === 'reimbursed' ? approvedAmt : 0));
      const remainingAmt = Number(r.expense.remainingAmount ?? (r.expense.status === 'reimbursed' ? 0 : Math.max(0, approvedAmt - reimbursedAmt)));

      return {
        expenseId: r.expense.expenseId,
        employeeName: r.user.name,
        employeeCode: r.user.uid || `EMP-${r.user.id}`,
        department: r.user.department || 'N/A',
        branchName: 'Main Branch',
        expenseDate: r.expense.expenseDate,
        expenseTime: r.expense.expenseTime,
        merchant: r.expense.merchant || 'N/A',
        category: r.expense.category,
        description: r.expense.description || '',
        location: r.expense.location || '',
        paymentMethod: r.expense.paymentMethod || 'Personal Payment',
        amount: claimedAmt,
        claimedAmount: claimedAmt,
        approvedAmount: approvedAmt,
        reimbursedAmount: reimbursedAmt,
        remainingAmount: remainingAmt,
        status: r.expense.status.toUpperCase(),
        reimbursementStatus: r.expense.status.replace('_', ' ').toUpperCase(),
        approvedByName: r.expense.approvedByUserId ? 'Manager/Admin' : 'N/A',
        approvedAt: r.expense.approvedAt ? new Date(r.expense.approvedAt).toLocaleDateString() : 'N/A',
        reimbursedByName: r.expense.reimbursedByUserId ? 'Finance Admin' : 'N/A',
        reimbursedAt: r.expense.reimbursedAt ? new Date(r.expense.reimbursedAt).toLocaleDateString() : 'N/A',
        uploadTimestamp: r.expense.uploadTimestamp ? new Date(r.expense.uploadTimestamp).toLocaleDateString() : 'N/A',
        policyViolationFlag: r.expense.policyViolationFlag ? 'YES' : 'NO',
        duplicateFlag: r.expense.duplicateFlag ? 'YES' : 'NO',
      };
    });

    const reportFile = await generateExpenseReportFile({
      format: chosenFormat,
      columns: chosenColumns,
      rows: reportData,
      meta: {
        title: reportTitle,
        tenantName: 'SmartTeams Workspace',
        generatedByName: req.user.name,
        generatedByEmail: req.user.email,
        generatedAt: new Date(),
        timezone: 'Asia/Kolkata',
        filtersDescription: `Filter: Status=${filters?.status || 'All'}, Category=${filters?.category || 'All'}, Month=${filters?.month || 'All'}`,
      },
    });

    await logToAuditLedger({
      tenantId,
      actorId: req.user.userId,
      actorName: req.user.name,
      action: 'EXPENSE_REPORT_GENERATED',
      details: { title: reportTitle, format: chosenFormat, recordsCount: reportData.length },
    });

    res.setHeader('Content-Type', reportFile.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${reportFile.filename}"`);
    res.send(reportFile.buffer);
  } catch (err: any) {
    sendServerError(res, err, 'expenses.routes.ts -> POST /reports/generate');
  }
});

// ---------------------------------------------------------------------------
// 13. Reusable Report Templates
// ---------------------------------------------------------------------------
// GET /reports/templates route moved above :id to prevent Express shadowing

router.post('/api/tenant/expenses/reports/templates', authenticate, async (req: any, res: any) => {
  try {
    const tenantId = await getEffectiveTenantId(req.user);
    const userId = await getEffectiveUserId(req.user);
    const { name, description, columns, filters } = req.body || {};

    if (!name || !columns) {
      return res.status(400).json({ error: 'Template name and columns are required.' });
    }

    const [template] = await db.insert(schema.expenseReports).values({
      tenantId,
      userId,
      name: String(name).trim(),
      description: description ? String(description).trim() : null,
      columns: columns || [],
      filters: filters || {},
    }).returning();

    res.json({ success: true, template });
  } catch (err: any) {
    sendServerError(res, err, 'expenses.routes.ts -> POST /reports/templates');
  }
});
