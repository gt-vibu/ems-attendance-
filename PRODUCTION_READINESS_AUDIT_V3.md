# Smart Teams / AEMS — Production Readiness Audit V3 (Delta pass: integration test suite)

**Branch audited:** `audit-fixes`
**Date:** 2026-08-06
**Method:** Delta re-score against `PRODUCTION_READINESS_AUDIT_V2.md`. V2 gave: Production readiness 74, Code quality 74, Architecture 68, Security 78, Scalability 66, Maintainability 66, Performance 64, and identified "zero HTTP/integration test coverage" as the single biggest thing holding back every score. This pass verifies the one new thing added since V2 — a real integration test suite — and re-scores accordingly. This is a focused delta pass, not a full 15-dimension re-audit (that was just done in V2).

---

## 1. Verification of the integration test suite claim

**Claim: real, not faked.**

Read all four files directly:

- `apps/admin/integration/harness.ts` (129 lines) — `startTestApp()` calls `detectPostgres()`, throws if no live Postgres is found (no silent JSON-fallback masking), builds a real `express()` app, calls the actual `registerRoutes(app)` from `api/routes/index.ts` (the same function `server.ts` uses), binds it to an ephemeral port (`app.listen(0)`), and returns a `baseUrl` for real `fetch()` calls. `createTestTenantAndAdmin()` inserts a disposable tenant/admin/employee/approver directly into the real schema via Drizzle, mints JWTs with `signToken()`, and provides a `cleanup()` that deletes every table it touched (audit ledger, background jobs, notifications, alerts, corrections, logs, adjustments, runs, freeze periods, payroll settings, users, tenant), scoped to that one disposable tenant.
- `payrollLockConcurrency.integration.test.ts` — fires two concurrent `fetch()` POSTs to `/api/tenant/payroll/:runId/lock` via `Promise.all`, asserts exactly one 200 and one "already locked" rejection, then re-reads the row from the DB to confirm it ended up `locked` exactly once. 1 test.
- `attendanceApprovalConcurrency.integration.test.ts` — same concurrent-pair pattern against `/api/tenant/attendance/action`, plus a second test asserting an already-`approved` log is rejected with 400. 2 tests.
- `correctionFreezeGuard.integration.test.ts` — creates a pending correction, freezes its month *after* creation, and asserts approval is rejected 400 with an error matching `/frozen/i` and the correction stays `pending`; a second test confirms `reject` (as opposed to `approve`) still succeeds in a frozen period. 2 tests.
- `integration/README.md` documents exactly what the task description claimed, including the tenant_admin-bypass pitfall: the freeze-guard test was initially written against `ctx.token` (tenant_admin), which passes `hasPrivilege()` unconditionally for every privilege including the one the freeze guard is supposed to gate on — so the test would have passed even with a broken guard. The harness's `createApprover(privileges)` helper (a `manager`-role user with an explicit narrow `privileges` array) exists specifically to fix this, and the README states this was caught by actually running the test against a live DB and seeing an unexpected 200, not by review.

Total: **3 files, 5 tests**, matching the claim exactly.

**Actually ran it — yes.** Root `.env` had live Postgres credentials (`SQL_HOST=127.0.0.1`, port 5432, db `smartteams`); `apps/admin` had no local `.env` of its own, so I copied the root one in temporarily (removed afterward) and ran:

```
cd apps/admin && npm run test:integration
```

Real output:

```
[db] Connected to Postgres — using it as the datastore.
▶ POST /api/tenant/attendance/action — concurrency guard
  ✔ exactly one of two concurrent approve requests succeeds on the same pending log (224.0ms)
  ✔ a non-pending log is rejected outright (59.1ms)
✔ POST /api/tenant/attendance/action — concurrency guard (315.8ms)
▶ POST /api/tenant/corrections/action — freeze re-checked at approval time
  ✔ approving a correction whose month was frozen AFTER it was requested is rejected (225.6ms)
  ✔ rejecting a frozen-period correction is still allowed (144.8ms)
✔ POST /api/tenant/corrections/action — freeze re-checked at approval time (418.6ms)
▶ POST /api/tenant/payroll/:runId/lock — concurrency guard
  ✔ exactly one of two concurrent lock requests succeeds; the run ends up locked, not double-processed (158.7ms)
tests 5
suites 3
pass 5
fail 0
```

All 5 tests passed against a genuinely live Postgres connection, with the app connecting and disconnecting cleanly across the 3 separate `tsx --test` file invocations. `npm run test:integration` (`apps/admin/package.json`) is a script distinct from `npm test`, which still runs only the 6 pure-function unit test files with no DB dependency, as claimed.

**Verdict: the claim is fully verified, not aspirational.** This is genuine, running, passing integration coverage of the exact three highest-risk concurrency/consistency bugs that were hand-fixed in the prior two audit passes.

---

## 2. Does this change the 7 scores?

Yes, but proportionately — not dramatically. 5 tests covering 3 endpoints is real regression protection for exactly the highest-risk flows touched by this session's fixes (payroll lock double-processing, attendance double-approval, freeze-bypass-at-approval). It is not comprehensive coverage of the other ~40+ route files or ~13.9k lines of API code, which remain entirely untested at the HTTP/integration level: no tests for auth/login, tenant CRUD, document upload/MIME rejection, alerts pagination, leave workflows, payroll calculation itself (beyond the pre-existing pure-function unit tests), webhook SSRF closure, or the review.routes.ts alerts endpoint's in-memory visibility filtering. The single-biggest-gap finding from V2 is now "meaningfully narrowed at its highest-risk points," not "closed."

| Category | V2 | V3 | Justification |
|---|---|---|---|
| **Production readiness** | 74 | **77** | The exact three concurrency/consistency bugs hand-fixed across three audit passes (payroll lock race, attendance approval race, freeze-bypass-at-approval) now have real, passing, live-DB regression tests — this closes the specific "next person to touch review.routes.ts has no automated signal" risk V2 called out by name for those three flows. Still held back: the other ~40 route files and the DB-bootstrap-sync path have zero test coverage of any kind, and there is still no CI job wiring `test:integration` to a throwaway Postgres automatically — it exists but nothing runs it on a PR. |
| **Code quality** | 74 | **75** | Marginal improvement — the test suite itself is clean, well-commented code (the harness's own doc comments document a real bug the authors caught in themselves, which is a good quality signal), but code quality of the application code is unchanged since V2. |
| **Architecture** | 68 | **68** | No change. Test *existence* doesn't alter route-file monolith structure, DAO-layer absence, or the boot-time-sync-as-migration architecture V2 flagged. |
| **Security** | 78 | **80** | The freeze-bypass-at-approval fix and the concurrency guards on 2 of 3 approval endpoints are now provably correct under real concurrent load and real privilege-check semantics (not just single-request manual review) — meaningfully raises confidence that these specific auth/consistency fixes actually hold, and the README's documentation of the tenant_admin-bypass false-positive pitfall shows the fix was validated against the right threat model, not just "does it return 400." Still held back: the other ~18 previously-flagged BOLA-pattern call sites and most mutation endpoints have no equivalent live-fire verification, and no CI gate re-runs these tests automatically. |
| **Scalability** | 66 | **67** | Slight improvement — the payroll-lock and attendance-approval concurrency tests directly validate the guarded-UPDATE pattern under real concurrent load, which is a scalability-adjacent correctness property (multi-instance/multi-request safety). Everything else V2 flagged (no advisory lock on boot sync, narrow onDelete coverage, no distributed queue) is unchanged. |
| **Maintainability** | 66 | **70** | This is where the improvement is most concrete: V2's own remaining-action-plan explicitly said "every fix in this and the two prior audits remains structurally unprotected against regression by anything other than manual re-review" — that statement is now false for the 3 highest-risk endpoints. A future refactor of `review.routes.ts` or the payroll lock path gets an automated correctness signal instead of relying purely on re-reading the diff. Held back: this protection covers 3 of dozens of mutating endpoints; the file-size/monolith debt and missing DAO/ui layers are completely unchanged. |
| **Performance** | 64 | **64** | No change. The test suite validates correctness, not performance/load characteristics (it's not a load test), and none of V2's performance findings (Dashboard.tsx memoization, JSON body limit) were touched by this addition. Spot-checked: `Dashboard.tsx` still shows only one real `useMemo` call (`directoryRoleOptions`, line 659) plus the import — essentially the same state V2 described. |

**None of the 7 scores crossed the 85 threshold.** The two closest, Security (80) and Production readiness (77), remain below it.

---

## 3. Quick sanity pass — anything else regressed or missed?

- `git log` since the V2 commit shows the integration-suite commit (`b303960`) was the only commit added on top of what V2 already reviewed (V2's own final commit was already `f161794`... actually the branch has continued past that — `git diff --stat` against the pre-V2 baseline shows the full fix-wave 10-20 plus the integration suite, consistent with V2 already having reviewed fixes 1-20 and this pass adding only the test suite on top). No unreviewed application-code changes were found beyond what V2 already covered.
- `npm test` (unit tests, no DB) was not re-run this pass but its script definition is unchanged from V2.
- No new Critical/High findings surfaced in this delta pass. The Dashboard.tsx memoization state, onDelete cascade narrowness, and missing zod validation layer — all previously flagged and explicitly out of scope for this delta — remain as V2 described them.
- One documentation-accuracy note, not a code defect: `apps/admin/.env` does not exist standalone — `SQL_*` config lives only in the monorepo root `.env`. The integration README's "see .env" instruction is technically slightly imprecise (it should say "the repo root .env") but this did not block running the suite and is a trivial fix.

---

## 4. Deployment readiness verdict

### **Ready with Fixes** (same category as V2, confidence incrementally higher, unchanged verdict)

The integration suite closes exactly the gap V2's action plan called out first and most specifically: "Add integration tests... for at minimum: the 3 approval endpoints' concurrency guards, the freeze-re-check-at-approval logic." That item is now done, verified by actually running it against live Postgres, not just reading the diff. This is real progress, not cosmetic — it converts three previously "fixed by hand, protected by nothing" flows into "fixed and continuously verifiable."

It does not change the overall verdict because:
1. **Coverage breadth is still narrow.** 5 tests against 3 endpoints out of 40+ route files and 13.9k lines of API code. This is targeted coverage of the highest-risk flows this session's fixes touched, not general regression protection for the app.
2. **No CI wiring yet.** The script exists and runs cleanly locally against a live DB, but nothing was found (this pass didn't re-check `.github/workflows/`) indicating `test:integration` runs automatically on PRs — so the protection is only as good as whoever remembers to run it manually.
3. Every other V2-identified gap (Dashboard.tsx memoization, narrow onDelete coverage, no zod validation layer, react-router CVE status) is unchanged, since none were in scope for this delta.

---

## 5. What's still needed to reach 85+ (per category still below it)

**Security (80):**
- Wire `test:integration` into CI against a throwaway Postgres service so the 5 tests run on every PR, not just when a human remembers to.
- Extend integration coverage to the other previously-flagged BOLA-pattern call sites and at least one negative-auth test per major mutation endpoint (tenant delete, document upload MIME rejection, webhook SSRF closure).
- Re-verify the react-router CVE status (not re-checked this pass).

**Production readiness (77):**
- Same CI-wiring gap as Security — a passing local test suite that no automated pipeline runs is a weaker signal than V2's scores might suggest at first glance.
- Add a CI job that boots the app against a throwaway Postgres and runs `verifyAndSyncDatabase()` before merge, as V2 recommended.

**Code quality (75):** Dashboard.tsx decomposition, zod/schema-validation layer — unchanged asks from V2.

**Architecture (68):** Route-file monolith, DAO/repository layer, `ui/` layer — unchanged asks from V2.

**Scalability (67):** Advisory lock on boot-time schema sync, broader `onDelete` cascade coverage (still 2 of ~190 references) — unchanged asks from V2.

**Maintainability (70):** Extend integration coverage beyond the 3 endpoints toward the rest of the mutation surface so more of the codebase, not just the highest-risk 5 flows, gets a regression safety net.

**Performance (64):** Dashboard.tsx memoization is still essentially unaddressed (1 real `useMemo` against dozens of derived-array operations); JSON body limit still 25mb, not the recommended 1-2mb.
