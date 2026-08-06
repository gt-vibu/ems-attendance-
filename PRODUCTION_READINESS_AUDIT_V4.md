# Smart Teams / AEMS — Production Readiness Audit V4 (Delta pass: 5 hardening commits)

**Branch audited:** `audit-fixes`
**Date:** 2026-08-06
**Baseline:** V3 gave Production readiness 77, Code quality 75, Architecture 68, Security 80, Scalability 67, Maintainability 70, Performance 64.
**Method:** Read-only verification of 5 claimed changes since V3 (commits `64a3805`..`7d57d8c`), by reading the actual diffs and current code — not taking commit messages on faith — plus running the live integration suite and `tsc --noEmit`, then re-scoring.

---

## 1. Verification of the 5 claimed changes

### 1. `withBootSyncLock()` — Postgres advisory lock around boot-time schema sync

**PASS, fully verified.** `apps/admin/db.ts` (commit `64a3805`) adds:

```ts
const BOOT_SYNC_ADVISORY_LOCK_KEY = 4820158;
export async function withBootSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  if (postgresAvailable !== true) return fn();
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [BOOT_SYNC_ADVISORY_LOCK_KEY]);
    return await fn();
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [BOOT_SYNC_ADVISORY_LOCK_KEY]); } catch { /* connection may already be gone */ }
    client.release();
  }
}
```

- It is a real **blocking** session-level advisory lock (`pg_advisory_lock`, not `pg_try_advisory_lock`), taken on a dedicated connection checked out from the pool.
- `apps/admin/api/bootstrap/database.ts`'s public `verifyAndSyncDatabase()` is now a one-line wrapper: `await withBootSyncLock(runSchemaSync)`, where `runSchemaSync` is the renamed original function body containing every `CREATE TABLE`/`ALTER TABLE ADD COLUMN IF NOT EXISTS` statement — the entire sync runs inside the lock, not just part of it.
- Release happens in a `finally` block, so it fires on both success and thrown errors from `runSchemaSync()`; the unlock call is itself wrapped in try/catch so a dead connection doesn't mask the original error, and `client.release()` always runs to return the connection to the pool.
- Uses a distinct lock key (4820158) from the existing scheduler-leadership lock, avoiding cross-purpose contention.

No gaps found. This closes exactly the rolling-deploy DDL race V2/V3 flagged.

### 2. 60s TTL in-memory cache for `tenants.idleTimeoutMinutes`

**PASS, fully verified.** `apps/admin/api/middleware/authenticate.ts` (commit `727cd11`):

```ts
const IDLE_TIMEOUT_CACHE_TTL_MS = 60_000;
const idleTimeoutCache = new Map<number, { value: number; expiresAt: number }>();
async function getCachedIdleTimeoutMinutes(tenantId: number): Promise<number> {
  const cached = idleTimeoutCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const tenantRows = await db.select({ idleTimeoutMinutes: schema.tenants.idleTimeoutMinutes })
    .from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  const value = tenantRows[0]?.idleTimeoutMinutes || 0;
  idleTimeoutCache.set(tenantId, { value, expiresAt: Date.now() + IDLE_TIMEOUT_CACHE_TTL_MS });
  return value;
}
```

Confirmed 60,000ms TTL, per-tenant cache keyed by `tenantId`, correctly replaces the prior per-request DB query at the idle-timeout check call site. Straightforward, correct, low-risk (worst case: a tenant admin's idle-timeout change takes up to 60s to propagate to already-authenticated requests — an explicit, reasonable tradeoff, not a security regression since it only affects timeout *duration*, not whether auth is enforced).

### 3. `notifyOrFallbackCustom()` + the "left alone" call sites

**PASS, fully verified — including the reasoning for what was NOT converted.**

`apps/admin/api/services/notificationService.ts` (commit `e07c0db`) adds:

```ts
export async function notifyOrFallbackCustom(
  tenantId: number, eventType: string, subjectUserId: number, subjectName: string,
  data: Record<string, any>, fallbackFn: () => Promise<any>,
): Promise<void> {
  const tenantRow = (await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1))[0];
  if (isPlatformFeatureAllowed(tenantRow as any, 'unified_notifications')) {
    await notify(tenantId, eventType, { subjectUserId, subjectName, data }).catch(() => undefined);
  } else {
    await fallbackFn().catch(() => undefined);
  }
}
```

`notifyOrFallback()` itself is now a thin wrapper calling `notifyOrFallbackCustom` with a closure over `notifyUser(subjectUserId, fallbackTitle, fallbackMessage)` — no duplicated logic. `leave.routes.ts`'s leave-decision endpoint (`POST /api/tenant/leave/requests/action`, line ~395) now calls `notifyOrFallbackCustom(..., () => sendLeaveDecisionEmail(...))`, correctly replacing the hand-rolled `tenantRow` fetch + `isPlatformFeatureAllowed` branch that existed because the fallback needed a templated email, not a generic notification.

Checked the 5 other flagged call sites directly:

- `leave.routes.ts:218-224` (leave request creation) — fallback branch fans out to **all approvers** via `Promise.all(approvers.map(...))`, a multi-recipient case `notifyOrFallback`'s single-`subjectUserId` shape can't express. Confirmed correct to leave alone.
- `leave.routes.ts:441-442` (bulk leave action) — `tenantRowBulk`/`unifiedOn` computed **once before the `for` loop** over up to 200 `requestIds`; converting to `notifyOrFallbackCustom` per iteration would reintroduce a per-item tenant-row query inside a batch loop, exactly the N+1 pattern the codebase has previously fixed elsewhere. Confirmed correct to leave alone.
- `leave.routes.ts:646-655` (leave encashment request) — fallback fans out to all `leave.approve` privilege holders via `notifyUsers(approvers.map(...))`. Multi-recipient, same reasoning as the first site. Confirmed correct to leave alone.
- `payroll.routes.ts:1064-1074` (role compensation change) — fallback is `notifyUsers(inheritingUserIds, ...)`, multi-recipient (every employee inheriting the changed role default). Confirmed correct to leave alone.
- `payroll.routes.ts:1316-1329` (payroll batch status transition) — for the `payroll_batch_released` event specifically, fans out `Promise.all(employees.map(u => notify(...)))` over every employee whose payslip just became visible; the "off" fallback branch is also entirely absent for this endpoint (no email fallback is sent at all when unified_notifications is off), which is a different code shape than `notifyOrFallback` assumes. Confirmed correct to leave alone.

All 5 "left alone" sites check out as genuinely multi-recipient or loop-hoisted, not laziness.

### 4. `STATUTORY_DEFAULTS` + `DEFAULT_WORKING_DAYS_PER_MONTH` — verified against schema defaults

**PASS, fully verified, exact numeric match.** `apps/admin/api/routes/leavePayrollShared.ts` (commit `285b895`) extracts:

| Constant | Extracted value | `packages/database/src/schema.ts` column default |
|---|---|---|
| `BASIC_PERCENT_OF_GROSS` | 50 | `statutoryBasicPercentOfGross` `.default(50)` (line 1256) |
| `PF_EMPLOYEE_RATE_PERCENT` | 12 | `pfEmployeeRatePercent` `.default(12)` (line 1230) |
| `PF_EMPLOYER_RATE_PERCENT` | 12 | `pfEmployerRatePercent` `.default(12)` (line 1231) |
| `PF_WAGE_CEILING` | 15000 | `pfWageCeiling` `.default(15000)` (line 1232) |
| `ESI_EMPLOYEE_RATE_PERCENT` | 0.75 | `esiEmployeeRatePercent` `.default(0.75)` (line 1237) |
| `ESI_EMPLOYER_RATE_PERCENT` | 3.25 | `esiEmployerRatePercent` `.default(3.25)` (line 1238) |
| `ESI_WAGE_CEILING` | 21000 | `esiWageCeiling` `.default(21000)` (line 1239) |
| `TDS_STANDARD_DEDUCTION` | 50000 | `tdsStandardDeduction` `.default(50000)` (line 1252) |
| `DEFAULT_WORKING_DAYS_PER_MONTH` | 26 | `workingDaysPerMonth` `.default(26)` (line 1201) |

All 9 values match exactly. The diff is a pure substitution of literals (`?? 12`, `|| 21000`, etc.) for named constants inside `computeStatutoryDeductions()` / `buildPayrollSummary()` — no logic or fallback semantics changed (still `??`/`||` in the same positions against the same settings fields).

### 5. `getByIdForTenant()` tenant-scoped helper — applied + reverted sites

**PASS, fully verified, including the reversion claim.** `apps/admin/api/utils/tenantScoped.ts` (commit `7d57d8c`):

```ts
export async function getByIdForTenant(table: any, id: number, tenantId: number): Promise<any> {
  const rows = await db.select().from(table).where(and(eq(table.id, id), eq(table.tenantId, tenantId))).limit(1);
  return rows[0];
}
```

**Applied sites — all 9 confirmed, behavior-identical (collapsing not-found + wrong-tenant into a single 404, which is what the original two-step code already did in every one of these cases):**

- `payroll.routes.ts` — `buildCompensationHistoryResponse()`, single query replaces fetch-then-check, still returns `null` (→ downstream 404) identically.
- `leave.routes.ts` — leave-adjustment employee lookup, unchanged 404 message/shape.
- `documents.routes.ts` — both `GET /:id/download` and `DELETE /:id`, unchanged 404 message/shape.
- `gdpr.routes.ts` — erase-data employee lookup, unchanged 404.
- `shiftSwap.routes.ts` — swap-target lookup, unchanged 404 ("Colleague not found").
- `tenant.routes.ts` — bulk-user-create branch validation, unchanged thrown-error message.
- `employees.routes.ts` — 4 places in `PUT /api/tenant/employees/:id` and `POST /api/tenant/departments`: branch validation, shift validation, manager validation, department-head validation. All previously returned the same 400 for both not-found and wrong-tenant; now identical via the helper.

Spot-checked several of these against the pre-commit code (`git show 7d57d8c`) — the diffs are pure 1:1 substitutions (`docRows[0]`/`docRows.length===0||docRows[0].tenantId!==tenantId` → `getByIdForTenant(...)` + `!doc`), same status codes and messages preserved.

**Reverted / never-converted sites — all 3 confirmed to retain the original two-step 403/404 pattern**, i.e. the commit's claim that these needed a *distinct* 403 for wrong-tenant vs 404 for not-found (which the helper collapses and therefore can't express) holds up:

- `employees.routes.ts`, 3 sites (lines 128-133, 189-194, 356-361), e.g.:
  ```ts
  if (userRows.length === 0) {
    return res.status(404).json({ error: 'Employee not found.' });
  }
  const employee = userRows[0];
  if (employee.tenantId !== tenantId) {
    return res.status(403).json({ error: 'Access denied: This employee belongs to another organization.' });
  }
  ```
- `shiftOverrides.routes.ts` (`loadScopedEmployee` helper, lines 30-36) — identical two-step 404-then-403 pattern.
- `terminations.routes.ts` (terminate endpoint, lines 41-47) — identical two-step 404-then-403 pattern.

The commit's `git diff --stat` for `7d57d8c` also shows zero touched lines in `shiftOverrides.routes.ts` or `terminations.routes.ts`, confirming these were never modified in this commit at all (not "reverted in a later commit" — genuinely untouched), consistent with the stated reasoning.

**All 5 claims verify as real, not aspirational or partially true.**

---

## 2. Live verification — DB, integration suite, `tsc`

- Root `.env` (`SQL_HOST=127.0.0.1`, port 5432, db `smartteams`) was temporarily copied into `apps/admin/.env` (and removed immediately after), matching V3's precedent.
- `npm run test:integration` — ran the real script (`payrollLockConcurrency`, `attendanceApprovalConcurrency`, `correctionFreezeGuard`), against a genuinely live Postgres connection (`[db] Connected to Postgres — using it as the datastore.` printed 3 times, once per suite file):
  ```
  tests 5
  suites 3
  pass 5
  fail 0
  ```
  All 5 tests passed, same as V3 — the boot-sync advisory lock and idle-timeout cache changes did not break app startup or the DB connection path.
- `npx tsc --noEmit` — **clean, exit 0, no errors.** All 5 changes compile correctly together with the rest of the codebase.
- `apps/admin/.env` was deleted again after the run, restoring the pre-audit state.

---

## 3. Regression sanity pass

- `git log` confirms exactly 5 new commits since V3's `b303960`: `64a3805`, `727cd11`, `e07c0db`, `285b895`, `7d57d8c` — matching the 5 claims 1:1, no unreviewed application-code changes slipped in alongside them.
- No new unused imports, typos, or obvious edge-case misses were found in the diffs of the 5 commits themselves.
- One **pre-existing** (not newly introduced) nit: `leave.routes.ts` imports `notifyUser` from `../services/notifications` but never calls it directly (only `notifyUsers`, plural, is used) — this import was already unused before `e07c0db` (confirmed via `git show e07c0db^:...`), so it is not a regression from this session's changes, just an existing minor lint issue `tsc --noEmit` doesn't flag (no `noUnusedLocals`).
- No other regressions found across the 5 commits' diffs.

---

## 4. Re-scored — 7 categories, V3 → V4

| Category | V3 | V4 | Justification |
|---|---|---|---|
| **Production readiness** | 77 | **81** | The boot-sync advisory lock closes a real rolling-deploy correctness gap V2/V3 both flagged by name (concurrent DDL races), verified with a real blocking lock, whole-function coverage, and finally-block release. Combined with the auth-cache load reduction and the BOLA-pattern consolidation (9 call sites now structurally safe rather than reviewer-dependent), this is a genuine, verified hardening pass, not cosmetic. Still held back: no CI wiring for `test:integration` (same gap V3 named), and the other ~7 BOLA-prone call sites outside this session's scope remain in the fetch-then-check pattern (correctly, by design, for the 3 that need distinct 403/404 — but there may be others not yet reviewed for this exact question). |
| **Code quality** | 75 | **77** | The statutory-constants extraction and the notifyOrFallbackCustom consolidation are both clean, well-reasoned refactors with correct scope judgment (converting only what's safe, leaving multi-recipient/batch-hoisted sites alone with documented reasoning) — a good quality signal. Still unchanged: Dashboard.tsx decomposition, zod/schema-validation layer, the still-unused `notifyUser` import in leave.routes.ts (trivial, pre-existing). |
| **Architecture** | 68 | **70** | `getByIdForTenant()` is a small but real first step toward a repository/DAO layer — the first shared query-abstraction utility in `api/utils/` that route files import instead of hand-rolling Drizzle queries. It's one function covering 9 call sites out of dozens of similar patterns, not a DAO layer. Route-file monolith structure (payroll.routes.ts, leave.routes.ts, employees.routes.ts are all still 500-1300+ line files) and boot-time-sync-as-migration are unchanged. |
| **Security** | 80 | **83** | This is the most concrete improvement: 9 real call sites converted from a "correct only if the reviewer remembers the post-fetch check" pattern to "structurally impossible to get wrong" (tenantId baked into the WHERE clause), verified line-by-line against the actual diffs. Just as importantly, the 3 sites that legitimately need the distinct-403 semantics were correctly identified and left alone — confirmed by reading the current code, not just trusting the commit message — which is itself a good signal that this refactor was done carefully rather than mechanically. Still held back: ~7 more BOLA-pattern-flagged call sites outside this session's scope were not touched or re-verified this pass, and there's still no CI gate re-running the 5 integration tests automatically on every PR. |
| **Scalability** | 67 | **72** | The boot-sync advisory lock is a direct, real fix for exactly the rolling/autoscaled-deploy race V2/V3 called out as a scalability gap — multi-replica boot correctness is a genuine scalability property, not just correctness under load. The idle-timeout cache also measurably cuts DB round-trips at scale (removes a query from every authenticated request). Still unchanged: no distributed queue, narrow `onDelete` cascade coverage (still ~2 of ~190 references per V3), no read-replica or caching-layer story beyond this one narrow cache. |
| **Maintainability | 70 | **74** | The statutory-constants extraction directly targets a compliance-audit pain point V2/V3 both named (scattered magic numbers), and the getByIdForTenant helper reduces the number of places a future BOLA bug can be introduced by mistake for the converted sites. The reasoned, verified inclusion/exclusion boundary (converting 9, correctly declining 3) is itself a maintainability signal — a future engineer extending this pattern has real prior art to follow instead of ambiguous guidance. Held back: this is still incremental — dozens of similar hand-rolled query patterns remain unconverted outside this session's explicit scope, and the underlying route-file size problem is untouched. |
| **Performance** | 64 | **66** | The idle-timeout cache removes one DB round-trip from every authenticated request, a real (if narrow) win at request volume. No other performance-flagged items (Dashboard.tsx memoization beyond the prior single `useMemo`, 25mb JSON body limit) were touched this pass. |

**3 of 7 categories now cross 80: Production readiness (81), Security (83). Architecture (70), Code quality (77), Scalability (72), Maintainability (74), and Performance (66) remain below 80.**

---

## 5. Deployment readiness verdict

### **Ready with Fixes** (upgraded confidence from V3, verdict category unchanged)

This pass converts several previously "flagged but unaddressed" gaps into "fixed and verified": the rolling-deploy DDL race, the per-request auth DB round-trip, the BOLA-pattern inconsistency across 9 call sites, and the compliance-review magic-number problem. All 5 claims were independently verified by reading the actual code (not the commit messages), and the app still passes `tsc --noEmit` and all 5 live integration tests after these changes.

It does not move to "Ready" outright because:
1. **CI wiring is still absent** — the same gap V3 named. A passing local test suite and a clean local `tsc` run are not automated protection against regression on the next PR.
2. **Coverage/consolidation breadth is still narrow.** 9 of the originally-flagged ~16-18 BOLA-pattern call sites were converted; the remainder (outside leave/payroll/documents/gdpr/shiftSwap/tenant/employees) haven't been re-examined this pass for whether they too are behavior-identical convert candidates.
3. **Architecture, Code quality, and Performance remain below 80** — the route-file monolith, missing zod validation layer, and Dashboard.tsx memoization are unchanged from V2/V3 and were out of scope for this delta.

---

## 6. What's still needed to reach 80+ (per category still below it)

**Architecture (70):**
- Extend `getByIdForTenant()` (or a sibling `updateByIdForTenant`/`deleteByIdForTenant`) to the remaining BOLA-pattern call sites not touched this pass, growing it into an actual thin repository layer with test coverage of its own (currently exercised only indirectly via the 5 integration tests, none of which target `tenantScoped.ts` directly).
- Concrete next step: split `payroll.routes.ts` (1330+ lines) and `employees.routes.ts` into per-concern route files (e.g. `payroll.lock.routes.ts`, `payroll.batches.routes.ts`) — pick the largest file first, since it's also the one with the most-flagged BOLA history.

**Code quality (77):**
- Decompose `Dashboard.tsx` beyond the single existing `useMemo`.
- Introduce a zod (or equivalent) request-validation layer at the router level instead of ad hoc inline checks — this was flagged in V2/V3 and untouched here.
- Trivial: remove the unused `notifyUser` import from `leave.routes.ts` (pre-existing, one line).

**Scalability (72):**
- Broaden `onDelete` cascade coverage beyond the ~2 of ~190 FK references V3 noted.
- No distributed job queue yet for background work — still a single-process assumption baked into the scheduler-leadership advisory lock design.

**Maintainability (74):**
- Extend the integration test suite (still 5 tests / 3 endpoints per V3) to cover the newly-converted `getByIdForTenant()` call sites with at least one cross-tenant-403/404 assertion per distinct-403 site (`employees.routes.ts` x3, `shiftOverrides.routes.ts`, `terminations.routes.ts`) to lock in that the reversion decision stays correct under future refactors.

**Performance (66):**
- Dashboard.tsx memoization still essentially unaddressed (1 real `useMemo` against dozens of derived-array operations, per V3's own spot-check, not re-verified this pass since out of scope).
- JSON body limit still 25mb per V3, not tightened to the recommended 1-2mb.
- Concrete next step: add a load/benchmark test (even a simple autocannon run against a seeded tenant) to actually measure whether the idle-timeout cache and advisory-lock changes moved the needle, since this pass's performance claims are architectural reasoning, not measurement.
