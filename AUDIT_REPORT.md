# Smart Teams / AEMS — Attendance, Leave & Payroll Architecture Audit

## Fix status (updated 2026-08-05, branch `audit-fixes`)

| # | Finding | Status |
|---|---|---|
| 1.1 | No transaction around payroll lock / adjustment-apply (TOCTOU race) | ✅ Fixed — `db.transaction()` + status-guarded UPDATE in `payroll.routes.ts` |
| 1.2 | Zero secondary indexes across schema | ✅ Fixed — composite indexes added on all tenant-scoped hot paths (`schema.ts`, hand-written migration `0008_add_hot_path_indexes.sql`, boot-time sync) |
| 1.3 | Unbounded list endpoints, no pagination | ✅ Fixed — capped default + `limit`/`offset` on leave requests, payroll adjustments, reimbursements, advances |
| 5 (perf) | N+1 name lookup in payroll adjustments list | ✅ Fixed — batched `inArray` query |
| 2.3 | Negative net-pay edge case (unfloored) | ✅ Fixed — `preStatutoryNet`/`monthlyNet` now floored at 0 |
| 8 (quality) | Raw internal error messages returned to clients | ✅ Fixed — `sendServerError()` helper, applied to all 59 occurrences across `payroll.routes.ts`, `leave.routes.ts`, `payrollExtras.routes.ts`, `webhooks.routes.ts` |
| 4.5 | Unreviewed webhook SSRF surface | ✅ Fixed — `assertWebhookUrlIsSafe()` blocks loopback/private/link-local/cloud-metadata targets at creation + dispatch time |
| 3.2 | Correction→adjustment auto-generation unverified | ✅ Verified correct, no change needed (`review.routes.ts:521-545`) |
| 4.1 / 2.1 / 3.3 | Pervasive fetch-then-tenant-check pattern (~30+ endpoints) | ⏳ Not fixed — every sampled instance is currently correct; hardening this into a query-level-scoped repository helper is a larger, higher-risk refactor touching many call sites. Flagged, not started. |
| 7 (arch) | Duplicated `notifyOrFallback` boilerplate not used everywhere | ⏳ Not fixed — code-quality/consolidation item, no bug. |
| Everything else in sections 6–9 (scalability notes, architecture/code-quality suggestions, readiness scores) | Advisory — no code change applicable | — |

---

**Scope:** `apps/admin/api` (routes/services), `apps/admin/src`, `packages/database/src/schema.ts`, `apps/admin/jwt.ts`, `apps/admin/db.ts`
**Branch audited:** `main` (post-merge from `fixedux`)
**Method:** Static code review — Grep/Read of route handlers, services, and schema. Read-only, no code changed.

> Note on evidence density: given the size of the codebase (13.7k lines across the 6 core route files alone, 2160-line schema, 76 tables), this audit targeted the highest-risk surfaces per the brief — cross-module dependency chain, security, multi-tenant isolation — and sampled representative route handlers rather than reading every line of every file. Findings below are all backed by concrete file:line citations from code actually read; anything not explicitly evidenced is flagged as such.

---

## 1. Critical Bugs (production blockers)

### 1.1 No `db.transaction()` around multi-step state changes in payroll lock / adjustment-apply
`apps/admin/api/routes/payroll.routes.ts:236-243` (lock) and `:284-296` (adjustment apply) each do a `SELECT` to check current status, then a separate `UPDATE` with no transaction and no `WHERE status = 'generated'` guard on the update itself:
```ts
const [run] = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.id, runId)).limit(1);
if (run.status === 'locked') return res.status(400)...
await db.update(schema.payrollRuns).set({ status: 'locked' }).where(eq(schema.payrollRuns.id, runId));
```
Two concurrent lock requests (or a lock + adjustment-apply race) can both pass the `SELECT` check before either `UPDATE` commits — a classic TOCTOU race. Given "payroll locked ⇒ payslip immutable" is a stated invariant, this is a correctness risk under concurrent HR usage, not just a theoretical one. Codebase-wide, only **3 occurrences of `db.transaction(`** exist in the whole `apps/admin/api` tree (`services/payrollBatchCalculation.ts`, `routes/super.routes.ts` ×2) — none in `payroll.routes.ts`, `payrollExtras.routes.ts`, or `leave.routes.ts`, despite dozens of read-check-then-write sequences in those files (e.g. leave approve at `leave.routes.ts:371-381`, settlement approve at `payrollExtras.routes.ts:427-431`).

### 1.2 No secondary/composite indexes anywhere in the schema
`packages/database/src/schema.ts` (2160 lines, 76 `pgTable(` definitions) contains **zero** `index(` calls and only **8** `uniqueIndex(` calls total. Every hot-path query in the audited code filters by `(tenantId, userId, date-range)` or `(tenantId, status)` — e.g. `attendanceDayStatus.ts:78-84` (attendanceLogs by tenantId+userId+createdAt range), `leavePayrollShared.ts` leave-day computations, `payroll.routes.ts:260` (payrollAdjustments by tenantId only, unbounded). Postgres does **not** auto-index foreign-key columns (only primary keys and explicit unique constraints get an index), so these are full/near-full table scans once tenants accumulate real data. This is a straight-line path to production slowdowns at the 1k–10k employee scale called out in the audit brief. Concrete evidence: `schema.ts:31-32` `attendanceLogs.userId`/`tenantId` are `.references()` only, no companion `index()`.

### 1.3 Unbounded list endpoints — no pagination
`GET /api/tenant/leave/requests` (`leave.routes.ts:336`), `GET /api/tenant/payroll/adjustments` (`payroll.routes.ts:260`), `GET /api/tenant/payroll/reimbursements` (`payrollExtras.routes.ts:132-137`), `GET /api/tenant/payroll/advances` (`payrollExtras.routes.ts:95`) — all return the tenant's **entire** table via `db.select().from(...).where(eq(tenantId,...))` with no `.limit()`/`.offset()`/page params. At 10k+ employees with years of history this is both a performance and a memory/response-size problem, and combined with 1.2 (no index) compounds badly.

---

## 2. Business Logic Issues

### 2.1 Leave lookup-by-id happens before tenant check (defense-in-depth gap, not a live bug)
`leave.routes.ts:170-176`: when a leave request specifies `policyId`, the policy is fetched by raw `id` with no tenant filter in the query itself, then checked afterward (`if (policy && policy.tenantId !== req.user.tenantId) return 403`). Functionally correct (cross-tenant policyId is rejected), but it's the "fetch-then-check" pattern rather than "filter-in-query," which is more error-prone to maintain — see also 6.1 below, which is the same pattern applied ~30+ times across `payroll.routes.ts` / `payrollExtras.routes.ts` / `leave.routes.ts`. Every instance actually reviewed does perform the tenant check correctly, but the pattern is inconsistent (some queries filter with `and(eq(tenantId,...))` in the WHERE clause, others fetch by id and check after) and a single missed check anywhere in ~30 call sites is a BOLA vulnerability. Recommend a repository-layer helper (`getByIdForTenant(table, id, tenantId)`) to make the safe pattern the only one available.

### 2.2 Attendance-driven payroll LOP correctly sourced only from frozen state — verified correct
`attendanceDayStatus.ts:280-298` (`computeAttendanceDrivenPayrollInputs`) sources `unpaidAbsenceDays` **only** from the `'lop'` status, which itself only exists when `inputs.isFrozen` is true (`attendanceDayStatus.ts:248`). Raw unresolved `absent_pending_review` days are explicitly excluded from payroll. This correctly implements the "payroll uses finalized attendance, not pre-review flags" rule from the roadmap. Confirmed correct — no fix needed, noted for completeness since it's exactly the kind of thing the brief asked to verify.

### 2.3 Leave day counting doesn't guard against zero-day / negative CTC edge cases beyond a floor
`leavePayrollShared.ts:299-310`: `excessPaidDays`, `chargeableLeaveDays`, `leaveDeduction`, `lopDeduction` are all computed and only the final `earnedGross` is floored at 0 (`Math.max(0, ...)`). `preStatutoryNet` (line 311) and `monthlyNet` (line 317) are **not** floored — a large LOP/leave deduction combined with statutory deductions can drive `monthlyNet` negative, and nothing downstream appears to guard against issuing a negative net-pay payslip. Not observed to be caught elsewhere in `payroll.routes.ts`.

### 2.4 Half-day leave interacting with holidays/weekends via `overlapDaysInMonth` ratio math is fragile
`leavePayrollShared.ts:65-85`: the `totalDays` scaling trick (`ratio = totalDays / fullCountedDays`) that makes half-day leave scale correctly across a month boundary is a proportional approximation, not an exact per-day walk, when `options` (weekend/holiday awareness) is used together with a multi-day range that only partially overlaps the payroll month. For the common single-day half-day case (the comment's stated design target) it is exact; for a half-day request is not currently possible to span multiple days per the `computeLeaveDays` logic (`halfDay && days === 1 ? 0.5 : days`), so this is largely theoretical — flagging as a maintainability/fragility note rather than a live bug, since a half-day request spanning >1 calendar day cannot currently be created.

---

## 3. Cross-Module Dependency Issues

### 3.1 Single source of truth for day status — well-implemented
`attendanceDayStatus.ts:8-15` explicitly documents and fixes a prior real bug class (EmployeeDetailPanel.tsx vs AttendanceTimeline.tsx disagreeing on status) by centralizing all status resolution in `resolveDayStatus`/`resolveMonthStatuses`. Both payroll (`leavePayrollShared.ts:263-266`) and (per the code comments) calendar/notification consumers are described as routing through this function. This is the single largest positive finding of the audit — the architecture explicitly plans for and defends against the exact "duplicate business logic / conflicting state" failure mode the brief worries about. **Caveat:** this claim is based on `attendanceDayStatus.ts`'s own doc comments and its two call sites found (`leavePayrollShared.ts`); a full verification that every UI dashboard/report component actually calls this function (rather than re-deriving status) was not performed given time constraints — recommend a follow-up grep for any independent "is this day present/absent" logic in `apps/admin/src/components` and `apps/admin/api/services/reportData.ts`, `attendanceStats.ts`.

### 3.2 Payroll adjustments as the only sanctioned post-lock change path — correctly modeled
`payroll.routes.ts:226-229` comment states "no unlock endpoint; a mistaken lock is corrected by issuing a Payroll Adjustment" and this matches the schema (`payrollAdjustments` table, `schema.ts:1311-1326`, with `sourceType` enumerating `'attendance_correction' | 'leave_adjustment' | 'salary_revision' | 'bonus' | 'reimbursement' | 'loan' | 'tax' | 'manual'`). This is the correct pattern for historical immutability. Not verified in this pass: whether attendance-correction approval actually **auto-creates** a `payrollAdjustments` row when the corrected date falls inside an already-locked run (the comment at `payroll.routes.ts:250-253` claims this happens in `review.routes.ts`, which was not read in this session) — recommend explicit verification, since this is the crux of "correction ⇒ adjustment generated."

### 3.3 Reimbursement/loan/advance/settlement tenant checks are all fetch-then-verify, consistent with 2.1
Same pattern audited across `payrollExtras.routes.ts` — every one of the ~10 `:id`-scoped mutation endpoints (loan close `:77-79`, reimbursement action `:175-176`, salary revision hr/finance review `:281-283, :298-299`, settlement approve `:427-428`) does `fetch by id → check row.tenantId === req.user.tenantId → 404 if mismatch`. All instances reviewed are correct. Flagging as a pattern-consistency item (3.1's sibling), not a live vulnerability.

---

## 4. Security Issues (ranked by severity)

### 4.1 (Medium) BOLA-shaped pattern used pervasively instead of tenant-scoped queries
As documented in 2.1/3.3: roughly 30+ mutation endpoints across `payroll.routes.ts`, `payrollExtras.routes.ts`, and `leave.routes.ts` fetch a row by raw numeric `id` and check `row.tenantId === req.user.tenantId` **after** the fetch, rather than including `tenantId` in the `WHERE` clause. Every single instance actually read in this audit correctly performs the check. The risk is **process risk, not a currently-exploitable bug**: this pattern requires every future PR to remember the post-fetch check; a single omission is a direct cross-tenant BOLA (any authenticated user could act on another tenant's payroll/leave/loan/settlement record by guessing/incrementing an id). Recommend enforcing `and(eq(id), eq(tenantId))` in the query itself as a lint-enforced convention.

### 4.2 (Low) TOCTOU race on payroll lock (see 1.1)
Same root cause as 1.1, restated here for the security angle: absent a transaction/row lock, a second actor could theoretically slip a write into a payroll run between the "not yet locked" check and the lock `UPDATE`, or vice versa. Low severity because it requires two near-simultaneous privileged (`payroll.lock`/`payroll.manage`) requests, but violates the stated immutability guarantee.

### 4.3 (Informational — verified secure) JWT secret handling
`apps/admin/jwt.ts:11-28`: refuses to boot in `NODE_ENV=production` without an explicit `JWT_SECRET`; only falls back to an insecure dev default outside production, with a loud warning. This is the correct pattern and directly avoids the "hardcoded fallback secret" class of vulnerability. No finding here — noted because it's exactly the kind of thing that's often wrong in early-stage codebases.

### 4.4 (Informational — verified secure) Password handling
`auth.routes.ts:41-62` supports bcrypt with a transparent upgrade-from-legacy-plaintext path on successful login (`:50`). Good practice for a codebase migrating password storage; not fully audited for whether the plaintext-compare branch is still reachable for accounts that were never upgraded, but the stated design is correct.

### 4.5 Not evaluated in this pass (flag for follow-up, not a finding)
CSRF token handling, cookie flags (`httpOnly`/`secure`/`sameSite`), file-upload validation (face/document uploads), and SSRF surface (webhook dispatch to tenant-configured URLs — `dispatchWebhookEvent` calls were seen throughout `leave.routes.ts`/`payroll.routes.ts` but the implementation was not read) were not reviewed given the time budget. `dispatchWebhookEvent(tenantId, event, payload)` sending to a tenant-supplied URL is a plausible SSRF vector worth a dedicated look — recommend verifying the webhook target URL is validated against private/internal IP ranges before the request is made.

---

## 5. Performance Issues

| Issue | Evidence | Suggestion |
|---|---|---|
| No composite indexes on `(tenant_id, user_id, ...)` / `(tenant_id, status)` hot paths | `schema.ts` — 0 `index()` calls across 76 tables | Add explicit Drizzle `index()` on `attendanceLogs(tenantId, userId, createdAt)`, `leaveRequests(tenantId, status)`, `payrollAdjustments(tenantId, status)`, `payrollRuns(tenantId, year, month)` |
| Unbounded `SELECT *` on tenant-wide tables | `payroll.routes.ts:260`, `leave.routes.ts:336`, `payrollExtras.routes.ts:95,132-137` | Add `limit`/`offset` or cursor pagination + default page size |
| N+1 name-lookup loop | `payroll.routes.ts:261-264` — `rows.map(async (r) => db.select(...).where(eq(users.id, r.userId))...)` issues one query per adjustment row instead of a single `IN`/join | Replace with a single batched `inArray(users.id, ids)` query |
| Per-day resolver re-queries entire month | `attendanceDayStatus.ts:65-102` (`loadMonthInputs`) is well-batched *within* a month (good — 8 parallel queries once), but `resolveDayStatus` (single-day) still calls the full `loadMonthInputs` for one day (`:274-278`) — any single-day caller pays the whole-month query cost | Acceptable if single-day calls are rare; verify call frequency in UI before optimizing |

---

## 6. Scalability Issues

- **No pagination + no indexes together (1.2/1.3) is the dominant scalability risk.** At 100 employees this is invisible; at 1k–10k with multi-year attendance history, list/report endpoints and the day-status resolver's date-range scans will degrade materially.
- **Payroll batch calculation** (`services/payrollBatchCalculation.ts`) is the one file using `db.transaction()` — good sign it was built with batch-scale in mind, but it wasn't read in depth this pass; recommend verifying it processes employees in chunks rather than one giant transaction (a single multi-thousand-row transaction risks lock contention / long-running transaction issues under concurrent payroll runs).
- **Concurrent payroll runs across tenants**: no evidence of a locking/queueing mechanism preventing two simultaneous `POST .../generate` calls for the same tenant+period from racing (mirrors 1.1's pattern) — not fully verified, flagged for follow-up.

---

## 7. Architecture Improvements

- **Route files are large and monolithic**: `payroll.routes.ts` (1283 lines) and `attendance.routes.ts` (1037 lines) each mix HTTP handling, authorization checks, business calculation, and notification dispatch in the same file/function. Business logic is partially extracted to `services/` (`leavePayrollShared.ts`, `attendanceDayStatus.ts`, `payrollBatchCalculation.ts`) which is good, but a meaningful amount still lives inline in route handlers (e.g. settlement generation math at `payrollExtras.routes.ts:380-411` is entirely inline in the route handler, not a service function).
- **Repeated tenant/notification-feature-check boilerplate**: the `const tenantRow = await db.select().from(tenants).where(eq(id, tenantId))... ; isPlatformFeatureAllowed(tenantRow, 'unified_notifications') ? notify(...) : sendXEmail(...)` pattern is duplicated near-verbatim at `leave.routes.ts:216-222`, `leave.routes.ts:429-461`, `payroll.routes.ts:338-340,545-547`, `payrollExtras.routes.ts:155-156`. A `notifyOrFallback()` helper already exists and is used in `payrollExtras.routes.ts` (e.g. `:64,185`) but not consistently — `leave.routes.ts` and parts of `payroll.routes.ts` still hand-roll the same branch instead of using it. Consolidate onto the existing helper everywhere.
- **Fetch-then-tenant-check pattern (4.1)** should become a repository-layer convention rather than a per-handler discipline.

---

## 8. Code Quality Improvements

- **Duplicated tenant-check boilerplate** — see Architecture section above; same finding, code-quality angle: ~15+ near-identical `if (!row || row.tenantId !== req.user.tenantId) return res.status(404)` blocks.
- **Magic defaults scattered inline**: `Number(settings.pfEmployeeRatePercent ?? 12)`, `Number(settings.esiWageCeiling || 21000)`, `workingDaysPerMonth || 26` (`leavePayrollShared.ts:203-224, 290`) — statutory-rate defaults are reasonable to hardcode as *fallbacks*, but they're scattered through `computeStatutoryDeductions` rather than named constants, making them harder to audit for a compliance review.
- **Inconsistent error handling granularity**: every route handler wraps its whole body in `try { } catch (err: any) { res.status(500).json({ error: err.message }) }`, which leaks raw internal error messages (e.g. Postgres constraint violation text, stack-adjacent messages) directly to the client in all files sampled (`leave.routes.ts`, `payroll.routes.ts`, `payrollExtras.routes.ts`). This is both a code-quality and a minor security (information disclosure) issue — recommend sanitizing `err.message` before sending to clients, logging the full error server-side instead.

---

## 9. Enterprise Readiness Score

| Category | Score /10 | Justification |
|---|---|---|
| Architecture | 6 | Clear service extraction for the hardest logic (day-status resolver, payroll summary builder) with strong intentional-design doc comments; undermined by large monolithic route files and duplicated notification/tenant-check boilerplate. |
| Security | 6 | JWT secret handling and bcrypt password upgrade are done correctly; every tenant-check instance sampled was correct, but the pervasive fetch-then-check pattern (vs. query-level scoping) is a structural risk that only needs one missed instance to become a real cross-tenant BOLA. Webhook/SSRF and CSRF/cookie posture unverified. |
| Scalability | 4 | Zero composite indexes across a 76-table schema and no pagination on tenant-wide list endpoints are concrete, easily-hit ceilings well before the 10k-employee mark called out in the brief. |
| Maintainability | 6 | Code comments are unusually good (explain *why*, reference a roadmap, flag prior real bugs fixed) — a real strength for onboarding. Offset by large files and duplicated patterns. |
| Code Quality | 6 | Consistent naming, no dead code observed in sampled files, but raw error-message leakage and repeated boilerplate reduce this. |
| Performance | 5 | Attendance day-status batching within a month is well done; N+1 name lookups and unindexed tenant-scoped scans are real regressions waiting to happen. |
| Business Logic | 7 | The attendance→leave→payroll chain (LOP sourced only from frozen state, paid vs. chargeable leave split, half-day scaling, statutory deduction ordering) is implemented with real care and explicit edge-case reasoning in comments. Best-audited area of the codebase. |
| Cross-Module Integrity | 7 | Single source of truth for day status is a genuine architectural strength directly targeting the failure mode this audit was most worried about. Adjustment-based post-lock immutability model is correctly designed. Not fully verified end-to-end (correction→adjustment auto-generation, dashboard consistency) due to time budget. |
| Overall Production Readiness | 5.5 | Core financial/attendance logic is unusually well-reasoned for a pre-production system, but the indexing/pagination gap (1.2/1.3) is a hard blocker at any real scale, and the transaction-race gap (1.1) is a real risk to the "immutable payroll" guarantee the system's own design explicitly promises. Neither is a rewrite — both are targeted, well-scoped fixes. |

---

## Summary of what was and wasn't covered

Covered with concrete evidence: attendance day-status single-source-of-truth, LOP/payroll sourcing correctness, leave-day/half-day/statutory calculation logic, tenant isolation on payroll/leave/loan/reimbursement/settlement mutation endpoints, JWT secret handling, transaction usage, indexing, pagination.

Not covered (recommend follow-up passes): `attendance.routes.ts` regularization→adjustment auto-generation in `review.routes.ts`, dashboard/report component consistency in `apps/admin/src`, webhook SSRF surface, CSRF/cookie configuration, file-upload validation, rate-limiting configuration detail (file exists at `middleware/rateLimit.ts` but contents unread), full state-machine enumeration for every status field, and DB migration/versioning strategy.
