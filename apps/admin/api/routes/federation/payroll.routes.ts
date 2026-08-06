import { Router } from 'express';
import { eq, and, gt, asc, desc } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { sendServerError } from '../../utils/errors';
import { authenticateFederation, requireFederationScope, resolveFederationTenantContext } from '../../middleware/federationAuth';
import { federationLimiter } from '../../middleware/rateLimit';
import { requireIdempotencyKey } from '../../middleware/federationIdempotency';
import { resolveInternalId, resolveExternalId } from '../../services/federation/externalId';
import { writeOutboxEvent } from '../../services/federation/outbox';
import { encodeCursor, decodeCursor, hashFilters, resolveLimit } from '../../utils/federationCursor';
import { queue } from '../../services/queue';
import { checkCalendarGate, validateBatchForApproval, getPendingAdjustmentsForBatch } from '../../services/payrollBatch';
import { finalizePayrollBatchFinancials } from '../../services/payrollBatchCalculation';
import { getOrCreatePayrollSettings, computeCompensationDiff } from '../leavePayrollShared';
import { isPlatformFeatureAllowedForTenant } from '../../auth/rbac';

export const router = Router();
router.use('/v1/federation', authenticateFederation, federationLimiter, requireFederationScope('payroll'));

const MINOR_UNIT_MULTIPLIER = 100; // this app stores rupees as a real number; the federation contract uses minor units (e.g. paise)

router.get('/v1/federation/payroll/components', resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const rows = await db.select().from(schema.employeeSalaryComponents).where(eq(schema.employeeSalaryComponents.tenantId, req.federation.tenantId)).limit(200);
    const distinct = new Map<string, any>();
    rows.forEach((r: any) => distinct.set(r.componentName, { componentName: r.componentName, componentType: r.componentType, calculationType: r.calculationType }));
    res.json({ components: Array.from(distinct.values()) });
  } catch (err: any) {
    sendServerError(res, err, 'federation/payroll.routes.ts');
  }
});

router.put('/v1/federation/employees/:externalEmployeeId/compensation', requireIdempotencyKey, resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const userId = await resolveInternalId(tenantId, 'employee', req.params.externalEmployeeId);
    if (userId === null) return res.status(404).json({ error: 'Unknown externalEmployeeId.' });

    const { annualCtc, effectiveFrom, components } = req.body || {};
    if (annualCtc == null || !effectiveFrom) return res.status(422).json({ error: 'annualCtc and effectiveFrom are required.' });

    const existing = await db.select().from(schema.employeeCompensationProfiles).where(and(eq(schema.employeeCompensationProfiles.tenantId, tenantId), eq(schema.employeeCompensationProfiles.userId, userId), eq(schema.employeeCompensationProfiles.status, 'active'))).limit(1);
    const previousProfile = existing[0] || null;
    const previousComponents = previousProfile
      ? await db.select().from(schema.employeeSalaryComponents).where(eq(schema.employeeSalaryComponents.profileId, previousProfile.id))
      : [];

    const payload = { tenantId, userId, annualCtc: Number(annualCtc), effectiveFrom, status: 'active', updatedAt: new Date() };
    let profile: any;
    if (previousProfile) {
      [profile] = await db.update(schema.employeeCompensationProfiles).set(payload).where(eq(schema.employeeCompensationProfiles.id, previousProfile.id)).returning();
      await db.delete(schema.employeeSalaryComponents).where(eq(schema.employeeSalaryComponents.profileId, profile.id));
    } else {
      [profile] = await db.insert(schema.employeeCompensationProfiles).values(payload).returning();
    }

    const sanitized = Array.isArray(components)
      ? components.filter((c: any) => c?.componentName && c?.value != null).map((c: any, i: number) => ({
          tenantId, userId, profileId: profile.id, componentName: String(c.componentName),
          componentType: String(c.componentType || 'earning'), calculationType: String(c.calculationType || 'percent_of_ctc'),
          value: Number(c.value || 0), sortOrder: i,
        }))
      : [];
    if (sanitized.length > 0) await db.insert(schema.employeeSalaryComponents).values(sanitized);
    const freshComponents = await db.select().from(schema.employeeSalaryComponents).where(eq(schema.employeeSalaryComponents.profileId, profile.id));

    await db.insert(schema.compensationHistory).values({
      tenantId, userId, effectiveFrom,
      previousAnnualCtc: previousProfile?.annualCtc ?? null, newAnnualCtc: profile.annualCtc,
      previousComponents, newComponents: freshComponents,
      fieldChanges: computeCompensationDiff(previousProfile, previousComponents, profile, freshComponents),
    });

    // Restricted data (bank/PAN/Aadhaar) never enters this payload or this
    // response — this app doesn't even collect those fields today, so
    // there's nothing to accidentally leak here.
    res.json({ externalEmployeeId: req.params.externalEmployeeId, status: 'active', version: 1 });
  } catch (err: any) {
    sendServerError(res, err, 'federation/payroll.routes.ts');
  }
});

router.get('/v1/federation/payroll/calendars', resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) return res.status(422).json({ error: 'year and month are required.' });
    const rows = await db.select().from(schema.payrollCalendars).where(
      and(eq(schema.payrollCalendars.tenantId, req.federation.tenantId), eq(schema.payrollCalendars.year, Number(year)), eq(schema.payrollCalendars.month, Number(month)))
    ).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'No calendar configured for this period.' });
    const c = rows[0];
    res.json({ calendar: { attendanceFreezeDate: c.attendanceFreezeDate, calculationDate: c.calculationDate, hrReviewDate: c.hrReviewDate, financeReviewDate: c.financeReviewDate, releaseDate: c.releaseDate, salaryCreditDate: c.salaryCreditDate } });
  } catch (err: any) {
    sendServerError(res, err, 'federation/payroll.routes.ts');
  }
});

router.post('/v1/federation/payroll/runs', requireIdempotencyKey, resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const { periodStart, periodEnd } = req.body || {};
    if (!periodStart || !periodEnd) return res.status(422).json({ error: 'periodStart and periodEnd are required.' });

    const year = Number(periodStart.slice(0, 4));
    const month = Number(periodStart.slice(5, 7));
    const existing = await db.select().from(schema.payrollBatches).where(and(eq(schema.payrollBatches.tenantId, tenantId), eq(schema.payrollBatches.year, year), eq(schema.payrollBatches.month, month))).limit(1);
    if (existing.length > 0) {
      return res.json({ runId: String(existing[0].id), status: existing[0].status, version: 1 });
    }

    const [batch] = await db.insert(schema.payrollBatches).values({ tenantId, year, month }).returning();
    res.json({ runId: String(batch.id), status: batch.status, version: 1 });
  } catch (err: any) {
    sendServerError(res, err, 'federation/payroll.routes.ts');
  }
});

async function loadBatch(tenantId: number, runId: number) {
  const rows = await db.select().from(schema.payrollBatches).where(and(eq(schema.payrollBatches.id, runId), eq(schema.payrollBatches.tenantId, tenantId))).limit(1);
  return rows[0] || null;
}

// The federation contract exposes a simplified 4-action run lifecycle
// (calculate/approve/release/lock) rather than this app's full internal
// 8-stage HR+Finance review workflow (draft -> calculating -> calculated ->
// pending_hr_review -> pending_finance_review -> approved ->
// payslips_generated -> released -> locked, see payroll.routes.ts's
// makeTransitionRoute calls). A federation-driven run takes a shorter path
// through the SAME state machine/table — calculated -> approved ->
// released -> locked — reusing the exact same calendar-gate/validation/
// finalization functions the internal review workflow calls, just without
// the separate HR and Finance sign-off stages (BlizBooks is expected to
// have already gated the decision to run payroll before calling this API).
// The internal admin UI's own review workflow for non-federation batches
// is completely unaffected — this only adds another valid path through an
// already-existing table.
router.post('/v1/federation/payroll/runs/:runId/calculate', requireIdempotencyKey, resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const runId = Number(req.params.runId);
    const batch = await loadBatch(tenantId, runId);
    if (!batch) return res.status(404).json({ error: 'Run not found.' });
    if (!['draft', 'calculated'].includes(batch.status)) return res.status(400).json({ error: `Cannot calculate a run in status '${batch.status}'.` });
    const gateMsg = await checkCalendarGate(tenantId, batch.year, batch.month, 'calculating');
    if (gateMsg) return res.status(400).json({ error: gateMsg });

    await db.update(schema.payrollBatches).set({ status: 'calculating' }).where(eq(schema.payrollBatches.id, batch.id));
    // actorId 0 is a sentinel for "no internal human actor" — the
    // notify()/audit-log calls inside calculatePayrollBatch() treat a
    // lookup miss as a no-op (best-effort, wrapped in .catch), so this
    // never throws; it just means the completion notification has no
    // specific in-app recipient for a federation-triggered calculation.
    await queue.enqueue('calculate_payroll_batch', { batchId: batch.id, actorId: 0, actorName: 'SmartTeams Federation API' }, { tenantId });

    res.json({ runId: String(batch.id), status: 'calculating' });
  } catch (err: any) {
    sendServerError(res, err, 'federation/payroll.routes.ts');
  }
});

router.post('/v1/federation/payroll/runs/:runId/approve', requireIdempotencyKey, resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const runId = Number(req.params.runId);
    const batch = await loadBatch(tenantId, runId);
    if (!batch) return res.status(404).json({ error: 'Run not found.' });
    if (batch.status !== 'calculated') return res.status(400).json({ error: `Cannot approve a run in status '${batch.status}'; it must be 'calculated' first.` });
    const gateMsg = await checkCalendarGate(tenantId, batch.year, batch.month, 'approved');
    if (gateMsg) return res.status(400).json({ error: gateMsg });

    const validation = await validateBatchForApproval(batch);
    if (!validation.valid) return res.status(400).json({ error: 'Run failed validation.', failures: validation.failures });

    const updated = await db.transaction(async (tx: any) => {
      const [upd] = await tx.update(schema.payrollBatches).set({ status: 'approved', approvedAt: new Date() }).where(eq(schema.payrollBatches.id, batch.id)).returning();
      await writeOutboxEvent({ tenantId, eventType: 'payroll.batch.approved', aggregateType: 'payroll_run', aggregateId: String(batch.id), aggregateVersion: 1, data: { runId: String(batch.id), status: upd.status } }, tx);
      return upd;
    });
    res.json({ runId: String(batch.id), status: updated.status });
  } catch (err: any) {
    sendServerError(res, err, 'federation/payroll.routes.ts');
  }
});

router.post('/v1/federation/payroll/runs/:runId/release', requireIdempotencyKey, resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const runId = Number(req.params.runId);
    const batch = await loadBatch(tenantId, runId);
    if (!batch) return res.status(404).json({ error: 'Run not found.' });
    if (batch.status !== 'approved') return res.status(400).json({ error: `Cannot release a run in status '${batch.status}'; it must be 'approved' first.` });
    const gateMsg = await checkCalendarGate(tenantId, batch.year, batch.month, 'released');
    if (gateMsg) return res.status(400).json({ error: gateMsg });

    const pendingAdjustments = await getPendingAdjustmentsForBatch(batch.id);
    if (pendingAdjustments.length > 0) {
      const settings = await getOrCreatePayrollSettings(tenantId);
      if (settings?.blockPayrollReleaseOnPendingAdjustments) {
        return res.status(400).json({ error: `Cannot release: ${pendingAdjustments.length} payroll adjustment(s) are still pending.` });
      }
    }

    await finalizePayrollBatchFinancials(batch.id);

    const lineItems = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.batchId, batch.id));
    const employeeLedgerEntries = await Promise.all(lineItems.map(async (r: any) => ({
      externalEmployeeId: await resolveExternalId(tenantId, 'employee', r.userId),
      currencyCode: 'INR',
      grossPayMinor: Math.round(r.grossPay * MINOR_UNIT_MULTIPLIER),
      employeeDeductionsMinor: Math.round((r.leaveDeduction || 0) * MINOR_UNIT_MULTIPLIER),
      employerContributionsMinor: 0,
      netPayMinor: Math.round(r.netPay * MINOR_UNIT_MULTIPLIER),
    })));

    const updated = await db.transaction(async (tx: any) => {
      const [upd] = await tx.update(schema.payrollBatches).set({ status: 'released', releasedAt: new Date() }).where(eq(schema.payrollBatches.id, batch.id)).returning();
      await writeOutboxEvent({
        tenantId, eventType: 'payroll.batch.released', aggregateType: 'payroll_run', aggregateId: String(batch.id), aggregateVersion: 1,
        businessDate: `${batch.year}-${String(batch.month).padStart(2, '0')}-01`,
        data: { payrollRun: { periodStart: `${batch.year}-${String(batch.month).padStart(2, '0')}-01`, status: 'released' }, employeeLedgerEntries },
      }, tx);
      return upd;
    });

    res.json({ runId: String(batch.id), status: updated.status });
  } catch (err: any) {
    sendServerError(res, err, 'federation/payroll.routes.ts');
  }
});

router.post('/v1/federation/payroll/runs/:runId/lock', requireIdempotencyKey, resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const runId = Number(req.params.runId);
    const batch = await loadBatch(tenantId, runId);
    if (!batch) return res.status(404).json({ error: 'Run not found.' });
    if (batch.status !== 'released') return res.status(400).json({ error: `Cannot lock a run in status '${batch.status}'; it must be 'released' first.` });
    if (!await isPlatformFeatureAllowedForTenant(tenantId, 'payroll_lock_adjustments')) {
      return res.status(403).json({ error: "Payroll Lock & Adjustments is not enabled for this organization." });
    }
    const settings = await getOrCreatePayrollSettings(tenantId);
    if (!settings.payrollLockingEnabled) return res.status(400).json({ error: 'Payroll locking is turned off for this organization.' });

    const updated = await db.transaction(async (tx: any) => {
      const [upd] = await tx.update(schema.payrollBatches).set({ status: 'locked', lockedAt: new Date() }).where(eq(schema.payrollBatches.id, batch.id)).returning();
      await writeOutboxEvent({ tenantId, eventType: 'payroll.batch.locked', aggregateType: 'payroll_run', aggregateId: String(batch.id), aggregateVersion: 1, data: { runId: String(batch.id), status: upd.status } }, tx);
      return upd;
    });
    res.json({ runId: String(batch.id), status: updated.status });
  } catch (err: any) {
    sendServerError(res, err, 'federation/payroll.routes.ts');
  }
});

router.post('/v1/federation/payroll/adjustments', requireIdempotencyKey, resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const { runId, externalEmployeeId, amountDeltaMinor, reason } = req.body || {};
    if (!runId || !externalEmployeeId || amountDeltaMinor == null || !reason) {
      return res.status(422).json({ error: 'runId, externalEmployeeId, amountDeltaMinor, and reason are required.' });
    }
    const userId = await resolveInternalId(tenantId, 'employee', externalEmployeeId);
    if (userId === null) return res.status(404).json({ error: 'Unknown externalEmployeeId.' });

    const runRows = await db.select().from(schema.payrollRuns).where(and(eq(schema.payrollRuns.id, Number(runId)), eq(schema.payrollRuns.tenantId, tenantId))).limit(1);
    if (runRows.length === 0) return res.status(404).json({ error: 'runId does not match any payroll run.' });
    const run = runRows[0];
    const amountDelta = Number(amountDeltaMinor) / MINOR_UNIT_MULTIPLIER;

    const adjustment = await db.transaction(async (tx: any) => {
      const [adj] = await tx.insert(schema.payrollAdjustments).values({
        tenantId, userId, payrollRunId: run.id, amountDelta, reason, status: 'pending', sourceType: 'federation_adjustment',
      }).returning();
      await writeOutboxEvent({ tenantId, eventType: 'payroll.adjustment.posted', aggregateType: 'payroll_adjustment', aggregateId: String(adj.id), data: { adjustmentId: String(adj.id), runId: String(run.id) } }, tx);
      return adj;
    });
    res.json({ adjustmentId: String(adjustment.id), newRunVersion: run.version + 1 });
  } catch (err: any) {
    sendServerError(res, err, 'federation/payroll.routes.ts');
  }
});

router.get('/v1/federation/payroll/runs', resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const filters = { status: req.query.status || null };
    const limit = resolveLimit(req.query.limit);
    const conditions = [eq(schema.payrollBatches.tenantId, tenantId)];
    if (filters.status) conditions.push(eq(schema.payrollBatches.status, String(filters.status)));

    let afterId = 0;
    if (req.query.cursor) {
      const decoded = decodeCursor(String(req.query.cursor), req.federation.clientId);
      if (!decoded || decoded.filtersHash !== hashFilters(filters)) return res.status(400).json({ error: 'Invalid or expired cursor.', code: 'INVALID_CURSOR' });
      afterId = decoded.lastId;
    }
    conditions.push(gt(schema.payrollBatches.id, afterId));

    const rows = await db.select().from(schema.payrollBatches).where(and(...conditions)).orderBy(asc(schema.payrollBatches.id)).limit(limit);
    const runs = rows.map((b: any) => ({
      runId: String(b.id), periodStart: `${b.year}-${String(b.month).padStart(2, '0')}-01`,
      periodEnd: `${b.year}-${String(b.month).padStart(2, '0')}-28`, status: b.status, version: 1, supersedesRunId: null,
    }));
    const nextCursor = rows.length === limit
      ? encodeCursor({ clientId: req.federation.clientId, filtersHash: hashFilters(filters), sort: 'id_asc', asOf: new Date().toISOString(), lastId: rows[rows.length - 1].id })
      : null;
    res.json({ runs, nextCursor });
  } catch (err: any) {
    sendServerError(res, err, 'federation/payroll.routes.ts');
  }
});

router.get('/v1/federation/payroll/ledger', resolveFederationTenantContext(), async (req: any, res: any) => {
  try {
    const tenantId = req.federation.tenantId;
    const filters = { runId: req.query.runId || null };
    const limit = resolveLimit(req.query.limit);
    const conditions = [eq(schema.payrollLedgerEntries.tenantId, tenantId)];
    if (filters.runId) conditions.push(eq(schema.payrollLedgerEntries.batchId, Number(filters.runId)));

    let afterId = 0;
    if (req.query.cursor) {
      const decoded = decodeCursor(String(req.query.cursor), req.federation.clientId);
      if (!decoded || decoded.filtersHash !== hashFilters(filters)) return res.status(400).json({ error: 'Invalid or expired cursor.', code: 'INVALID_CURSOR' });
      afterId = decoded.lastId;
    }
    conditions.push(gt(schema.payrollLedgerEntries.id, afterId));

    const rows = await db.select().from(schema.payrollLedgerEntries).where(and(...conditions)).orderBy(asc(schema.payrollLedgerEntries.id)).limit(limit);
    const entries = await Promise.all(rows.map(async (r: any) => ({
      runId: r.batchId ? String(r.batchId) : null,
      runVersion: 1,
      externalEmployeeId: await resolveExternalId(tenantId, 'employee', r.userId),
      currencyCode: 'INR',
      amountMinor: Math.round(r.amount * MINOR_UNIT_MULTIPLIER),
      entryType: r.entryType,
    })));
    const nextCursor = rows.length === limit
      ? encodeCursor({ clientId: req.federation.clientId, filtersHash: hashFilters(filters), sort: 'id_asc', asOf: new Date().toISOString(), lastId: rows[rows.length - 1].id })
      : null;
    res.json({ entries, nextCursor });
  } catch (err: any) {
    sendServerError(res, err, 'federation/payroll.routes.ts');
  }
});
