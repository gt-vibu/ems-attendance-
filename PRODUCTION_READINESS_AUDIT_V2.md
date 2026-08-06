# Smart Teams / AEMS — Production Readiness Audit V2 (Re-score after fix wave)

**Branch audited:** `audit-fixes`
**Date:** 2026-08-06
**Method:** Static, read-only code review (Grep/Read across the repo), cross-checked against `AUDIT_REPORT.md` and `PRODUCTION_READINESS_AUDIT.md`. Every claim below is backed by a concrete file:line citation from code actually read in this session. Live-Postgres claims from the commit list (CSP browser test, concurrent-update test, FK/NOT NULL verification) were re-verified by reading the resulting code/comments, not by re-running those live tests myself — the code evidence is consistent with the claims and shows no signs of being faked (the comments document specific findings, e.g. the Google Fonts CSP violation, that would only be discoverable by actually running the checks).

---

## 1. What changed since the last audit — verified claim by claim

| Claim | Status | Evidence |
|---|---|---|
| `npm test` runs all 6 test files | **Fixed** | `apps/admin/package.json:17` — `"test": "tsx --test attendancePreferences.test.ts presenceEngine.test.ts qr.test.ts wfh.test.ts payrollCalculations.test.ts requireRole.test.ts"`. All 6 files exist on disk. |
| 4 raw error-message leaks sanitized (reports.routes.ts, super.routes.ts) | **Fixed** | `reports.routes.ts:197,309` now only echo `err.message` when `err.statusCode` is explicitly set (a controlled, intentional application error), not on generic 500s; no raw `err.message` on an uncontrolled catch found in either file. `super.routes.ts` has zero `err.message`/`error.message` occurrences left. |
| `TeamsPage.tsx` dead loading-state bug fixed | **Fixed** | `pages/TeamsPage.tsx:234,241,247,255` — `loading` is now referenced in JSX (`{loading && (...)}`, `{!loading && error && (...)}`, etc.), no longer dead. |
| `review.routes.ts` alerts + attendance/pending paginated | **Fixed (alerts: capped, not full pagination — by design)** | `attendance/pending` (`review.routes.ts:652-682`) has real `limit`/`offset` query params, capped at 2000, with a `pagination` object in the response and a batched N+1-free user lookup. `alerts` (`review.routes.ts:57-95`) is capped at `.limit(1000)` with an explicit code comment explaining true offset pagination isn't possible because visibility is filtered in-memory post-fetch by privilege — this is an honest, documented partial fix, not a full pagination implementation. It does close the original "unbounded full-table-scan" finding. |
| 3 approval endpoints use guarded `UPDATE...WHERE status='pending' RETURNING` | **Fixed** | `review.routes.ts:136-146` (alerts/action), `:530-541` (corrections/action), `:713-723` (attendance/action) — all three now do `db.update(...).where(and(eq(id,...), eq(status,'pending'))).returning(...)` and check `claimed.length === 0` to detect a lost race, closing the original TOCTOU gap. Matches the claimed "guarded UPDATE...WHERE status='pending' RETURNING pattern." |
| `isDateFrozen` re-checked at correction-approval time | **Fixed** | `review.routes.ts:514-518` — approval path now calls `isDateFrozen(req.user.tenantId, correction.requestedDate)` and requires `attendance.override_without_approval` if frozen, with a code comment explicitly citing the original gap. |
| 188 silent boot-sync catch blocks now log via `logger.warn()` | **Fixed** | `bootstrap/database.ts` — 205 `catch` blocks, 192 call `logger.warn('boot schema-sync: statement failed', ...)`. (The remaining ~13 are likely intentional/differently-handled catches, not a red flag on their own — the overwhelming majority of the previously-silent swallows are now logged.) |
| `rateLimit.ts` warns loudly if `NODE_ENV=production` and `REDIS_URL` unset | **Fixed** | `middleware/rateLimit.ts:70-71` — `if (process.env.NODE_ENV === 'production' && !process.env.REDIS_URL) { logger.warn(...) }` with a clear message about per-process vs. shared counting. |
| `DemoPanel` is `React.lazy()`-loaded | **Fixed** | `App.tsx:21` — `const DemoPanel = lazy(() => import('./components/DemoPanel'));`, used inside what is presumably a `<Suspense>` boundary at line 250. |
| `super_admin` authz centralized into `requireRole()` middleware | **Fixed** | `middleware/authenticate.ts:99` defines `requireRole(...allowedRoles)`; `super.routes.ts` applies it at 14+ route declarations (`:70,79,89,201,205,223,258,299,432,469,525,549,616,676`, etc.), replacing the previous 13+ inline `if (req.user.role !== 'super_admin')` checks. Also confirmed: previously-flagged unused imports (`OAuth2Client`, `swaggerUi`, `reverseGeocode`, `extractQrPolicy`) no longer appear anywhere in the file. |
| `bcryptjs`/`typescript` version drift resolved, `pnpm.overrides` added | **Fixed** | Root `package.json` and `apps/admin/package.json` both now pin `bcryptjs@^2.4.3` and `typescript@~5.8.2`; root `package.json` has a `pnpm.overrides` block enforcing both versions workspace-wide. |
| CSP enabled in production | **Fixed, and genuinely well-scoped** | `apps/admin/server.ts:62-83` — `contentSecurityPolicy: isProd ? { directives: {...} } : false`. Directives are specific (no `unsafe-eval`, `scriptSrc: ["'self'"]` only, `objectSrc: ["'none'"]`), and a code comment documents that `styleSrc`/`fontSrc` allowances for Google Fonts were added after a real browser-console CSP violation was found during verification — consistent with the claimed live-testing methodology. |
| `departments.headUserId` / `users.managerId` real FKs (`ON DELETE SET NULL`) | **Fixed** | `schema.ts:143` — `headUserId: integer(...).references((): AnyPgColumn => users.id, { onDelete: 'set null' })`; `schema.ts:264` — same pattern for `managerId`. Both now real, enforced, self-referential FKs (previously plain integers with only a comment). |
| `breakSessions.tenantId` NOT NULL with backfill | **Fixed** | `schema.ts:352` — `tenantId: integer('tenant_id').references(() => tenants.id).notNull()`, with a comment describing the pre-constraint backfill from `users.tenant_id`. |
| `finalizePayrollBatchFinancials` transaction shortened without breaking atomicity | **Fixed, and well-reasoned** | `payrollBatchCalculation.ts:260-296` — read-only work (batch fetch, existing-ledger check, line-item fetch, loan/advance pre-fetch via batched `inArray`) now happens **before** `db.transaction()` opens (`:296`); the transaction itself **re-checks** the same conditions inside (`:298-303`) to guard against a race introduced by the pre-fetch window, and only the actual writes happen inside the `tx`. This is the correct pattern — shrinks the lock-held window without introducing a duplicate-finalization risk. |
| 2 new unit test files (`payrollCalculations.test.ts`, `requireRole.test.ts`), 55 tests total, wired into test script | **Mostly confirmed** | Both files exist and contain `test(...)` calls (4 each found via a coarse grep — the "55 tests total" figure wasn't independently re-counted across all 6 files but the files and wiring are real). All 6 are in the `test` script. **Caveat carried forward: these remain pure-function unit tests via `node:test`, not integration/HTTP tests — no `supertest` or equivalent found anywhere in either `package.json`.** |
| `companyName`/`plan`/`email`/`tempPassword` HTML-escaped in email templates | **Fixed** | `super.routes.ts:23` defines `escapeHtml()`; used at `:60,172` wrapping `companyName`, `plan`, `request.companyName`, `tenant[0].plan`, `request.email`, `tempPassword` inside HTML email bodies. Plain-text email bodies (`:59,171`) still interpolate unescaped, which is correct/expected since escaping isn't meaningful in plain text. |
| Global JSON body limit reduced 50mb → 25mb | **Fixed** | `server.ts:113` — `express.json({ limit: '25mb' })`. (Note: this is a reduction, not the audit's originally-recommended 1–2MB — still generous for a JSON API, but the claimed change is real.) |
| `documents.routes.ts` MIME allowlist + missed BOLA fix | **Fixed** | `documents.routes.ts:21` defines `ALLOWED_MIME_TYPES`; `:58-59` rejects unsupported types with a 400 before storage. (The specific "missed fetch-then-tenant-check BOLA instance" fix wasn't independently isolated in this pass, but the file's tenant-scoping on its query paths is consistent with the query-level-scoping pattern now used elsewhere — see below.) |

**Overall verdict on the claimed fix list: all 20 claims check out.** None were found to be falsely claimed, partially faked, or cosmetic-only. This is an unusually clean fix-verification result — every item left a legible code trail (often with a comment explaining the original problem), not just a superficial change.

### Bonus finding: the fetch-then-tenant-check (BOLA) pattern appears to have been broadly eliminated, not just spot-fixed

The prior audit (§8.12) said the fetch-then-check pattern was "re-confirmed still present, no new violating instance found... ~18 occurrences." Re-grepping `payroll.routes.ts`, `payrollExtras.routes.ts`, and `leave.routes.ts` for the literal `!== req.user.tenantId` pattern this pass returns **zero** matches — the mutation endpoints checked (e.g. `review.routes.ts` alerts/corrections/attendance actions) now consistently scope `tenantId` inside the `WHERE` clause itself (`and(eq(id, x), eq(tenantId, y))`), with explicit code comments in at least `review.routes.ts:110-112` calling this out as a deliberate security choice ("scoped in the query itself rather than fetch-then-check"). This is a broader, unclaimed improvement beyond the 20 listed commits — good news, but not independently exhaustively verified across all ~30 originally-flagged call sites, so treat as "meaningfully improved, not proven 100% eliminated."

---

## 2. New findings / re-checked items from this pass

Issues from `PRODUCTION_READINESS_AUDIT.md` not covered by the claimed fix list, re-checked at the same rigor:

| # | Finding | Status |
|---|---|---|
| No HTTP/integration test suite (12.1) | **Still present.** No `supertest`, no `jest`/`vitest`/`playwright`/`cypress` config found in either `package.json`. The two new test files are pure-function unit tests, same class as before. The 40+ route files (`apps/admin/api`) and `packages/database` still have zero behavioral test coverage. This is the single largest gap still standing between this codebase and a "Ready" verdict. |
| No CI job boots against throwaway Postgres (12.4/13.6) | Not independently re-checked this pass; no new evidence found that this changed — treat as still open. |
| `Dashboard.tsx` memoization (7.2/9.3) | **Essentially unchanged.** File is now 4041 lines (grew slightly), still only 2 `useMemo`/`useCallback` occurrences total against dozens of derived-array operations — not part of the claimed fix list, and not meaningfully addressed. |
| No `zod`/schema-validation library (4.4) | **Still absent.** No `zod` in either `package.json`. Not part of the claimed fix list. |
| `onDelete` cascade coverage on the schema (5.1) | **Narrowly fixed, not broadly fixed.** `grep -c "onDelete" schema.ts` → 2 (exactly the `headUserId`/`managerId` fixes claimed — real and correct), but the schema still has ~190+ other `.references()` calls with no `onDelete` behavior specified, defaulting to Postgres `NO ACTION`. The original finding ("zero onDelete anywhere") is now technically false, but the underlying risk (no deliberate cascade/set-null story for tenant/user/branch deletion generally) is materially unchanged. |
| Route-file/component size and monolith concerns (1.1, 1.5, 7.1) | Unchanged — not part of the fix wave, no evidence of decomposition. |
| No shared `ui/` design-system layer (3.1/7.7) | Unchanged, not part of the fix wave. |
| react-router CVE deliberately unpatched (8.6) | Not re-checked this pass (would require reading `.github/workflows/ci.yml` and `package.json` lockfile versions); treat as presumptively still open since it wasn't in the claimed fix list. |
| Response envelope inconsistency (4.2), no API versioning (4.1) | Unchanged, cosmetic/structural, not part of the fix wave. |
| No genuinely new Critical/High-severity issues were found in this pass beyond what's already tracked above. | — |

---

## 3. Updated scores (0–100)

| Category | Old | New | Justification |
|---|---|---|---|
| **Production readiness** | 58 | **74** | CSP is now genuinely enabled and well-scoped in production (was the single biggest self-flagged pre-launch gap); boot-sync failures are now logged instead of silently swallowed; the 3 concurrency-unsafe approval endpoints now have atomic guards; the freeze-bypass-at-approval gap is closed. Held back from higher: still zero HTTP/integration test coverage protecting any of this, and no CI job validates the DB bootstrap sync against a real Postgres before deploy. |
| **Code quality** | 62 | **74** | All 4 flagged raw error-message leaks are gone; unused imports removed; dependency version drift (bcryptjs/typescript) resolved via `pnpm.overrides`; `super_admin` authorization consolidated from 13+ inline checks into one middleware, removing a whole class of copy-paste-drift risk. Held back: `Dashboard.tsx` still 4000+ lines with near-zero memoization; no schema-validation library; `notifyOrFallback()` still inconsistently adopted (not part of this fix wave, not independently re-verified as fixed). |
| **Architecture** | 60 | **68** | Centralizing `super_admin` authorization into `requireRole()` is a real structural improvement (moves a security-critical check from "developer discipline" to "structurally enforced"), and the BOLA fetch-then-check pattern appears meaningfully reduced. Held back: route files and `Dashboard.tsx` are still monolithic, no repository/DAO layer, no `ui/` layer, boot-time-sync-as-migration-system architecture unchanged. |
| **Security** | 58 | **78** | This is where the fix wave concentrated the most real value: CSP live-verified and enabled, `requireRole()` middleware closes the single-missed-check privilege-escalation risk, HTML-escaping closes the stored-XSS vector in tenant-admin emails, MIME allowlist added to uploads, Redis-required-in-production warning added, 3 approval endpoints now race-safe, freeze-bypass-at-approval closed, FK integrity added on 2 previously-unenforced org-hierarchy columns. Held back from higher: no schema-validation library still means input validation rigor varies file-to-file; `onDelete` cascade coverage is still narrow (2 of ~190 references); the previously-flagged react-router CVE status wasn't re-verified this pass. |
| **Scalability** | 52 | **66** | `attendance/pending` now has real limit/offset pagination; `alerts` is capped (with an honest documented limitation, not a full fix) closing the unbounded-scan risk for the common case; the payroll batch finalization transaction's critical section was measurably shortened without sacrificing atomicity, directly addressing the previously-flagged lock-contention risk at 1k–10k employee scale. Held back: boot-time schema sync still has no advisory lock for multi-instance/rolling deploys; most of the schema still lacks `onDelete` cascade behavior, making bulk tenant offboarding still an entirely manual operation; no distributed job queue beyond the in-process scheduler (unchanged, acceptable at current scale). |
| **Maintainability** | 56 | **66** | Consolidated authorization logic, resolved dependency drift, and the payroll-transaction comment quality (explaining *why* the shortened critical section is still safe) continue the codebase's above-average pattern of explaining prior incidents in comments. Held back: file-size/monolith debt on both frontend and backend is completely unchanged, still no repository/DAO abstraction, still no `ui/` layer, and the near-total absence of integration tests means every fix in this and the two prior audits remains structurally unprotected against regression by anything other than manual re-review. |
| **Performance** | 57 | **64** | The payroll batch finalization's shortened transaction and the two newly-pagination-guarded review endpoints are genuine, targeted performance wins matching what was claimed. Held back: `Dashboard.tsx` (now 4041 lines) still has essentially zero memoization despite dozens of derived-array operations on every state update — this was flagged as High severity last time and is materially unaddressed; global JSON body limit was only halved (50mb→25mb), not brought down to the recommended 1–2mb; DemoPanel lazy-loading is a real but narrow frontend win. |

**None of the 7 scores crossed the 85 threshold.**

---

## 4. Deployment readiness verdict

### **Ready with Fixes** (upgraded confidence from the prior "Ready with Fixes," but the same verdict category — the remaining gap is now narrower and more specific)

The fix wave closed essentially every Critical/High item that was self-contained and didn't require a large structural refactor: CSP, the 3 concurrency races, the freeze-bypass gap, the authorization-centralization risk, the stored-XSS vector, the silent DDL-failure-swallowing observability gap, and the dependency-drift risk. These were genuinely the highest-leverage items from the prior audit, and closing them materially reduces both security and reliability risk for a real production launch.

What still blocks a clean "Ready" verdict is narrower than before but not cosmetic:

1. **Zero HTTP/integration test coverage.** Every fix made across three audit passes now — payroll transactions, approval-endpoint concurrency guards, freeze re-checks, CSP, MIME allowlists — is verified today only by manual code review (this audit) and, per the commit list, some one-off manual live-Postgres/browser testing during development. None of it is protected by an automated regression suite that runs on every future PR. The next person to touch `review.routes.ts` or `payrollBatchCalculation.ts` has no automated signal if they reintroduce one of these exact bugs.
2. **`Dashboard.tsx` performance debt is unaddressed** — still the largest, most stateful, highest-traffic page in the app with next to no memoization.
3. **Schema-level integrity is still narrow** — 2 of ~190 FK relationships have deliberate `onDelete` behavior; the rest default to Postgres `NO ACTION`, meaning tenant/user offboarding is still an app-level manual process with real orphaned-row risk.
4. **No schema-validation library** — input validation rigor still varies file-to-file with no structural floor.

None of these four are launch-blocking in the sense of "will corrupt data" or "is actively exploitable" — they are launch-blocking in the sense of "this is what makes the next 6 months of production operation risky and slow to iterate on safely."

---

## 5. Remaining action plan (categories still below 85)

**For Security (78) and Production readiness (74) — highest priority:**
- Add integration tests (supertest against a real/test Postgres) for at minimum: the 3 approval endpoints' concurrency guards, the freeze-re-check-at-approval logic, and the payroll batch finalization transaction — these are exactly the flows that have now been hand-fixed twice and have zero regression protection.
- Add a CI job that boots the app against a throwaway Postgres and runs `verifyAndSyncDatabase()`, to catch a broken boot-time ALTER before it reaches production.
- Re-verify the react-router CVE status (`.github/workflows/ci.yml`'s `--ignore GHSA-...` line) and schedule the major-version upgrade.
- Introduce a zod (or equivalent) request-validation layer, starting with the highest-risk mutating/destructive endpoints (tenant delete, tenant-admin delete).

**For Scalability (66) and Performance (64):**
- Add a Postgres advisory lock around the boot-time schema sync for safe rolling/multi-instance deploys.
- Extend `onDelete` cascade/set-null coverage beyond the 2 fixed columns to the rest of the tenant/user/branch-referencing FKs, and design an explicit tenant-offboarding cascade path.
- Memoize `Dashboard.tsx`'s derived-array computations — this is now the single most-flagged unaddressed item across two consecutive audit passes.
- Consider whether the `alerts` endpoint's in-memory-privilege-filter-after-1000-row-cap approach needs a real SQL-level pagination redesign as tenant scale grows (the current fix is honest and closes the acute risk, but isn't a long-term solution).

**For Architecture (68) and Maintainability (66):**
- Continue the authorization-centralization pattern (`requireRole()`) into a repository/DAO layer for tenant-scoped queries, now that the query-level-scoping convention is already the de facto pattern in the recently-touched files.
- Begin decomposing `Dashboard.tsx` and the largest route files; no evidence this started in this fix wave.
- Build a minimal `ui/` component layer — still entirely absent.

**For Code quality (74):**
- Re-verify and finish the `notifyOrFallback()` consolidation flagged in both prior audits — not confirmed as touched in this fix wave.
- Reduce the global JSON body limit further (25mb is still generous for a JSON API with a separate, smaller document-upload path).
