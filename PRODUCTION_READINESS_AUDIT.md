# Smart Teams / AEMS — Production Readiness Audit (Final Sign-off)

**Branch audited:** `audit-fixes`
**Date:** 2026-08-05
**Method:** Static, read-only code review (Grep/Read across the full repo — 365 TS/TSX files, 13.9k lines of route handlers, a 2204-line/76-table schema, ~38.9k lines of frontend). Every finding below is backed by a concrete file:line citation from code actually read. This report does **not** re-litigate the fixes already logged in `AUDIT_REPORT.md`'s "Fix status" table (payroll transactions, hot-path indexes, pagination on the 4 previously-unbounded endpoints, ~165 sanitized error messages, webhook SSRF guard, negative-net-pay floor, N+1 fixes) — those were spot-verified as still in place and are only mentioned where a **new, previously-unreported instance** of the same class of issue was found.
No PRD/feature-gap section is included per explicit scope instruction.

---

## 1. Architecture

| # | Finding | Severity | Evidence | Impact | Recommendation | Priority |
|---|---|---|---|---|---|---|
| 1.1 | Route files are large, monolithic, and mix HTTP handling + authz + business math + notification dispatch | Medium | `apps/admin/api/routes/payroll.routes.ts` (1343 lines), `attendance.routes.ts` (1044 lines), `super.routes.ts` (761 lines) | Hard to review, test, or safely change; cognitive overload for any single PR | Extract inline business math (e.g. settlement generation, ledger math) into `services/*` consistently | Medium |
| 1.2 | Copy-paste route-file split leaves large unused import blocks | Low | `super.routes.ts` imports `OAuth2Client`, `swaggerUi`, `reverseGeocode`, `extractQrPolicy`, `hashPassword/verifyPassword/isPasswordHashed` — none referenced in the file body (per Explore-agent grep) | Obscures real dependencies of each file, dead weight in bundling/tree-shaking of the server bundle | Prune unused imports per file | Low |
| 1.3 | `notifyOrFallback()` helper exists but is inconsistently adopted (carried over from AUDIT_REPORT.md #7, confirmed still present) | Medium | Helper used in `payrollExtras.routes.ts`; hand-rolled `isPlatformFeatureAllowed(tenantRow, 'unified_notifications')` branches still present at `leave.routes.ts:218,399,443,648` and `payroll.routes.ts:1317` | Duplicated boilerplate, drift risk if one call site's branch is patched and others aren't | Consolidate onto the existing helper everywhere | Medium |
| 1.4 | Cross-route-file imports (`review.routes.ts` imports from `./documents.routes` and `./leavePayrollShared`) | Low | `review.routes.ts:29,32` | Route files importing from other route files (rather than a shared service layer) is a layering smell; one step from a real circular dependency | Move shared helpers (`documentsEnabledForTenant`, `getEffectiveDailyRate`) into `services/` | Low |
| 1.5 | Frontend "god component" pattern | High | `apps/admin/src/pages/Dashboard.tsx` — 4033 lines, orchestrating ~20 custom hooks and nesting `LeaveManagementPage`/`PayrollPage`/`EmployeeDirectory`/`TeamsPage`/`ProfilePage` as tab content on top of the real router (`AdminApp.tsx`) | Two competing navigation models (real router + in-component tab-router) increase complexity and regression risk | Flatten dashboard tabs into real routes, or explicitly document/own the dual-router design | Medium |
| 1.6 | No repository/DAO abstraction layer anywhere in the API | Medium | Every route file (`attendance.routes.ts:6`, etc.) imports the live Drizzle `db` singleton directly and issues queries inline | Ties every handler to a concrete DB client; blocks unit testing without a real Postgres connection (see §12) | Introduce a thin repository layer per domain, at least for hot-path tenant-scoped reads | Medium |
| 1.7 | Boot-time idempotent schema sync is the de facto migration system (architectural characteristic, not a bug) | Informational/Medium | `apps/admin/api/bootstrap/database.ts` (1622 lines), run via `verifyAndSyncDatabase()` on every process boot | See full discussion in §5 (Database) | Document explicitly as the system of record; consider a distributed boot-lock | Medium |

**Positive finding (carried forward, re-verified):** the single-source-of-truth day-status resolver (`attendanceDayStatus.ts`) and the adjustment-only post-lock-immutability model remain the strongest architectural decisions in the codebase — still correctly implemented on this branch.

---

## 2. Code Quality

| # | Finding | Severity | Evidence | Why it's a problem | Recommendation | Priority |
|---|---|---|---|---|---|---|
| 2.1 | **New instances** of raw internal error-message leakage, missed by the prior sanitization sweep | Medium | `apps/admin/api/routes/reports.routes.ts:197` (`'Failed to generate report data: ' + err.message`), `:308`, `:480`; `apps/admin/api/routes/super.routes.ts:542` (`res.status(500).json({ error: err.message, checks: [...] })`) | Leaks Postgres/internal error text to authenticated clients; inconsistent with the `sendServerError()` convention used in 283 other call sites in the same directory | Route these 4 catch blocks through `sendServerError()` like the rest of the codebase | High |
| 2.2 | Mixed logging discipline — raw `console.log`/`console.error` alongside the structured `logger` | Low | `auth.routes.ts:173,180`, `face.routes.ts:264,355`, `services/audit.ts:49`, `services/digestDispatcher.ts:214`, `bootstrap/database.ts:9` | Bypasses whatever redaction/transport the structured logger provides; inconsistent observability | Route all logging through `logger.*` | Low |
| 2.3 | Magic statutory-rate defaults scattered inline (carried forward from AUDIT_REPORT.md, still present) | Low | `leavePayrollShared.ts:203-224,290` — `Number(settings.pfEmployeeRatePercent ?? 12)`, `ESI ceiling ?? 21000`, `workingDaysPerMonth || 26` | Hard to audit for statutory-compliance review | Extract to named constants module | Low |
| 2.4 | Dead state: loading indicator wired but never rendered | Medium | `apps/admin/src/pages/TeamsPage.tsx:45,78,99` — `loading` state is set/toggled but never referenced in JSX | Users get no loading feedback on a 750-line page; silently broken UX | Wire the existing state into the render, or remove it | Medium |
| 2.5 | `bcryptjs` pinned at two different major versions across the monorepo | Medium | root `package.json` → `^3.0.3`; `apps/admin/package.json` → `^2.4.3` | Behavior differences between bcryptjs 2.x and 3.x (API-compatible but different internals) risk subtle divergence depending on pnpm hoisting resolution | Pin one version at the workspace root and remove the duplicate | Medium |
| 2.6 | `typescript` pinned at two different major lines across the monorepo | Low | root `package.json` → `~7.0.2` (prerelease/native-compiler line); `apps/admin/package.json` → `~5.8.2` | Type-checking behavior can differ between the two; root `lint`/`tsc --noEmit` in CI may not reflect what `apps/admin` actually compiles with | Align on one TypeScript version | Low |
| 2.7 | No shared API client on the frontend — duplicated auth-header boilerplate | Medium | ~50 separate call sites manually do `localStorage.getItem('auth_token')` and hand-build `Authorization: Bearer` headers (e.g. `pages/BranchDetail.tsx:43`, `components/BranchFormModal.tsx`, `components/TicketsPanel.tsx`, `lib/presenceHeartbeat.ts`). `lib/apiBase.ts` only patches `window.fetch` for base-URL rewriting and global 401 handling, not auth headers | Copy-pasted boilerplate; a future change to token storage/refresh requires touching 50 files | Introduce a single `apiFetch()` wrapper that injects auth headers | Medium |

---

## 3. Folder & Project Structure

| # | Finding | Severity | Evidence | Recommendation | Priority |
|---|---|---|---|---|---|
| 3.1 | No shared `ui/` design-system directory on the frontend | Medium | Confirmed absent via directory search under `apps/admin/src`; only `components/`, `components/dashboard`, `components/reports`, `components/templates` exist | Extract `Button`/`Card`/`Badge`/`Input` primitives into a `components/ui/` layer | Medium |
| 3.2 | `packages/database/migrations/` and `packages/database/drizzle/` are two differently-named, differently-purposed directories that look like the same thing | Low | `drizzle/` holds 10 drizzle-kit generated SQL migrations (`0000_...` through `0009_add_locking_toggles.sql`); `migrations/` holds 3 unrelated hand-written one-off TS scripts (`backfill-branches.ts`, `backfill-role-defaults.ts`, `baseline-migrations.ts`) | Rename one directory to disambiguate (e.g. `migrations/` → `data-backfills/`) | Low |
| 3.3 | `apps/admin/api/bootstrap/database.ts` is the real, authoritative schema-application path, but lives under `bootstrap/` rather than being discoverable alongside `packages/database` | Medium | 1622-line file; schema.ts itself documents a real production bug this drift already caused (`schema.ts:82-88`: two columns "already existed via a boot-time ALTER TABLE but were missing here, so Drizzle silently dropped them from every select/update") | Cross-link schema.ts and bootstrap/database.ts explicitly in comments/README; consider consolidating into `packages/database` | Medium |
| 3.4 | No `ui/` layer means Tailwind utility classes and CSS variables are repeated ad hoc per file | Medium | e.g. `bg-[var(--color-nexus-surface)]`, `text-[var(--color-nexus-ink)]` repeated throughout `pages/dashboard/LedgerTab.tsx:20-36` and dozens of other files | Same as 3.1 | Medium |

---

## 4. API Review

| # | Finding | Severity | Evidence | Impact | Recommendation | Priority |
|---|---|---|---|---|---|---|
| 4.1 | No API versioning strategy beyond a blanket rewrite | Low | `server.ts:82-90` rewrites `/api/v1/*` → `/api/*` as a blind prefix strip, not a real version boundary — every current and future `/api/*` route is automatically "v1" with no way to diverge later | A genuine breaking change has nowhere to go without breaking v1 clients | Treat `/api/v1` as a real, separately versionable route table before any breaking change ships | Low |
| 4.2 | Response envelope is inconsistent across the API | Low | `attendance.routes.ts:249` returns `{ logs }`; `review.routes.ts:468` returns `{ corrections, pagination }`; auth returns `{ token, user }`; various return bare `{ success: true, ... }` | No predictable client-side unwrapping convention | Standardize on a `{ data, meta }` (or similar) envelope | Low |
| 4.3 | Pagination is inconsistent and, on some endpoints, still entirely absent (new instances beyond AUDIT_REPORT.md's original 4) | High | `review.routes.ts:602-628` (`GET /api/tenant/attendance/pending`) and `review.routes.ts:57-88` (`GET /api/tenant/alerts`) have **no pagination at all** — full unbounded tenant-wide scan on every call. `attendance.routes.ts:215-248` (`GET /api/attendance/mine`) uses a `limit` capped at 100 with **no `offset`**, so it's impossible to page through history outside the month-filter path | Same unbounded-response-size/performance risk the prior audit fixed elsewhere, now confirmed present in 2 additional endpoints | Apply the same `limit`/`offset` pattern used elsewhere in `payroll.routes.ts`/`leave.routes.ts` | High |
| 4.4 | No schema-validation library (zod/joi/yup) anywhere in the API — validation quality varies file-to-file | Medium | `auth.routes.ts:31-33` only checks truthiness of `email`/`password` (no format/type check); `attendance.routes.ts:416-419` passes `lat`/`lng` straight into `haversineMeters`/geofence math with no numeric validation (non-numeric input silently produces `NaN` math instead of a 400); `super.routes.ts:239-242` validates `status` via allow-list but not `tenantId`'s type, while `super.routes.ts:321-324` (destructive tenant delete) validates only `!tenantId` truthiness. Contrast with `webhooks.routes.ts:49-68`, which validates thoroughly (URL format, https-in-prod, SSRF guard, event allow-list) | No structural guarantee every endpoint validates its input to the same bar; a destructive endpoint (tenant delete) has the weakest validation in the sample | Introduce zod schemas per route, at minimum on all mutating/destructive endpoints | High |
| 4.5 | `POST /api/attendance/heartbeat` has essentially no input validation | Medium | `attendance.routes.ts:836-838` destructures `lat, lng, simulatedIp, deviceId` from the body with zero validation before running distance math and DB writes | Malformed/malicious payloads can silently corrupt geofence/attendance calculations rather than being rejected | Validate types/ranges before use | Medium |
| 4.6 | Public unauthenticated tenancy-request endpoint has a thin abuse gate | Medium | `super.routes.ts:29` `POST /api/tenancy/request` — no `authenticate`, only `authLimiter` (10/15min per `ip:email`); inserts into `tenancyRequests` and sends real outbound email (`super.routes.ts:52-57`) with **no CAPTCHA** and no per-IP cap across distinct emails | A script can rotate emails to bypass the per-email key and generate unlimited outbound email sends / DB rows | Add a per-IP-only secondary limiter or CAPTCHA on this specific public endpoint | Medium |
| 4.7 | Unescaped user input interpolated into an HTML email body | Medium | `super.routes.ts:177` builds an approval email as a raw template string interpolating `request.companyName`/`tempPassword` with no HTML-escaping; `companyName` originates from the public, unauthenticated endpoint in 4.6 with only a truthiness check | A `companyName` containing `<script>`/`<img onerror=...>` is reflected verbatim into the HTML email sent to that same address (self-XSS-in-inbox, low practical impact) — but the same unsanitized `companyName` is also returned from `GET /api/super/tenants` (`super.routes.ts:218`) and could become stored XSS in the admin console if the frontend renders it unescaped | HTML-escape all interpolated user input in email templates; verify frontend escaping of tenant names | Medium |
| 4.8 | `super_admin`-only authorization is manually repeated per-handler rather than centralized as middleware | Medium | `super.routes.ts` repeats `if (req.user.role !== 'super_admin') return res.status(403)...` inline at 13+ separate handlers (lines 68, 80, 93, 207, 215, 236, 274, 318, 454, 494, 548, 575, 645, 708) rather than a `requireRole('super_admin')` middleware, unlike the `hasPrivilege`/`hasAnyPrivilege` pattern used elsewhere | A single new route that forgets this line is a full privilege-escalation bug; nothing makes the check structurally mandatory | Add a `requireRole()` middleware factory and apply it uniformly | High |
| 4.9 | No dedicated rate limit on expensive/heavy endpoints | Low | `super.routes.ts:643` `/api/super/analytics` (loads full tenants + users + a month of attendance logs per request) and `review.routes.ts:57` `/api/tenant/alerts` (unbounded scan, see 4.3) share only the generic 300/min limiter | An authorized-but-buggy/malicious client can hit expensive endpoints up to 300×/min | Add a tighter per-route limiter on known-expensive endpoints | Low |
| 4.10 | Document upload accepts an arbitrary client-declared MIME type with no allowlist | Low | `documents.routes.ts:40-45` reads `mimeType` from the request body with no validation against a known-safe list before storing and later replaying it verbatim as `Content-Type` on download (`documents.routes.ts:132`) | Mitigated by `Content-Disposition: attachment` (line 133, forces download rather than inline render), so stored-XSS risk is low, but an allowlist is still a defense-in-depth gap | Validate `mimeType` against an allowlist (pdf/png/jpg/etc.) | Low |
| 4.11 | Health checks are solid | Informational (positive) | `apps/admin/api/routes/health.routes.ts` — `/api/health` (liveness), `/api/health/db` (readiness, pings Postgres, returns 503 on failure), `/api/health/face` (face-service dependency health) | — | — | — |

---

## 5. Database Review

`packages/database/src/schema.ts` — 2204 lines, ~76 `pgTable(` definitions.

| # | Finding | Severity | Evidence | Impact | Recommendation | Priority |
|---|---|---|---|---|---|---|
| 5.1 | Zero `onDelete` cascade/set-null behavior anywhere in the schema | High | `grep "onDelete" schema.ts` → 0 matches, across ~193 `.references()` calls | Every FK defaults to Postgres `NO ACTION`. Deleting a `tenants`/`users`/`branches` row is either blocked outright or, if deletion happens via a path that bypasses the constraint, leaves orphaned child rows. No tenant-offboarding cascade exists at the DB layer | Add `onDelete: 'cascade'` or `'set null'` deliberately per relationship (tenant deletion should cascade; optional linkage like `attendanceAlerts.currentAssigneeUserId` should `set null`) | High |
| 5.2 | Zero `pgEnum` usage — every status/role/type column is unconstrained `text` | Medium | `grep "pgEnum(" schema.ts` → 0 matches. `tenants.status` (`schema.ts:8`, comment `// 'active' \| 'suspended'`), `users.role` (`:249`), `attendanceLogs.status` (`:388`), `attendanceCorrections.requestType` (`:587-589`), `notificationPolicies.priority` (`:710`) all validated only in application code | The database will silently accept any string in these "enum" columns; a bad migration, raw SQL fix, or app bug can insert an invalid status with zero DB-level rejection | Convert the highest-risk status columns to `pgEnum` | Medium |
| 5.3 | Two self-referential/hierarchical FKs exist only "by convention," with no actual `.references()` | Medium | `departments.headUserId` (`schema.ts:138`) and `users.managerId` (`schema.ts:255`) are plain `integer(...)` columns with a comment claiming the FK relationship but no `.references()` call (declaration-order deferral, never resolved later) | No referential integrity enforced at the DB level on org-hierarchy data — a deleted user can leave dangling manager/head references silently | Add the deferred `.references()` (Drizzle supports circular refs via a callback) or document why it's intentionally omitted | Medium |
| 5.4 | Inconsistent `NOT NULL` discipline on tenant-scoping columns | Medium | `breakSessions.tenantId` (`schema.ts:338`) is nullable, unlike essentially every other child table (`attendanceLogs.tenantId`, `attendanceAlerts.tenantId`, `holidays.tenantId`, etc., all `.notNull()`) | A break session could exist with no tenant scoping, breaking the tenant-filter pattern used everywhere else in the query layer | Add `.notNull()` to `breakSessions.tenantId` unless there's a documented reason it must be nullable | Medium |
| 5.5 | Denormalized department name duplicated in two places with no FK-backed sync | Low | `users.department` (`schema.ts:252`, comment: "mirrors departments.name for fast reads") and `holidays.department` (`schema.ts:511`) are both free text matched against the same ungoverned string, not FK'd to `departments.id` | Renaming a department does not propagate; `users.department`/`holidays.department` silently drift out of sync with `departments.name` | Either FK to `departments.id` or add an explicit sync job/trigger | Low |
| 5.6 | Two disconnected migration mechanisms coexist alongside the true, authoritative boot-time sync (architectural characteristic, documented per audit scope) | Medium | `packages/database/drizzle/*.sql` (10 drizzle-kit-generated files, most recent `0009_add_locking_toggles.sql`) and `packages/database/migrations/*.ts` (3 unrelated hand-written backfill scripts) both exist, but day-to-day schema changes are actually applied via `apps/admin/api/bootstrap/database.ts`'s `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements at boot, not via either migrations mechanism. This drift has already caused one documented real bug (`schema.ts:82-88` — a boot-time-only column silently dropped from Drizzle's query builder because it was missing from schema.ts) | Two migration histories that don't reflect the live schema make future audits and rollback planning unreliable | Not treated as "broken" per audit scope — but recommend either fully committing to the boot-time-sync approach (and deleting the unused drizzle-kit output) or fully committing to versioned migrations, not both | Medium |
| 5.7 | Boot-time sync (`bootstrap/database.ts`) silently swallows every ALTER failure | High | Every `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statement (dozens, e.g. `database.ts:32-53`) is individually wrapped in `try {} catch(e){}` with **no logging at all** on failure | A real migration failure (permissions, type conflict, disk full) is silently discarded — the app could run for months against an incomplete schema with zero record anywhere that a column failed to apply | At minimum, `logger.error()` inside each catch block; ideally fail startup loudly on unexpected (non-"already exists") errors | High |
| 5.8 | No distributed lock/leader-election guard around the boot-time schema sync | Medium | `verifyAndSyncDatabase()` (`bootstrap/database.ts`) runs unconditionally on every process boot with no lock visible in the reviewed portion | On a rolling/blue-green/autoscaled deploy, N replicas race to run thousands of `CREATE TABLE IF NOT EXISTS`/`ALTER TABLE ADD COLUMN IF NOT EXISTS` statements concurrently against the same DB — Postgres DDL under concurrent `IF NOT EXISTS` checks is not fully race-proof, and any resulting `duplicate column`/`duplicate table` error lands in the swallowed catch from 5.7 | Add a Postgres advisory lock (`pg_advisory_lock`) around the sync, held by only one replica per deploy | Medium |
| 5.9 | Payroll batch finalization runs as one large, unchunked transaction | Medium | `services/payrollBatchCalculation.ts:261-310` (`finalizePayrollBatchFinancials`) wraps the entire batch's ledger-row generation for every employee/line-item in a single `db.transaction()` with no chunking, confirmed by reading the loop body (`for (const lineItem of lineItems)` inside the transaction) | At 1k–10k employees this is a single long-running transaction — real risk of lock contention/timeout under concurrent payroll runs, exactly the scalability concern the prior audit flagged as "not fully verified"; now confirmed | Chunk ledger-row inserts into batches of e.g. 500 within separate transactions, or use a single bulk insert outside a giant per-row loop | Medium |
| 5.10 | Composite indexes now present (verified fix from prior audit) | Informational (positive) | `grep -c "index(" schema.ts` → 10 (was 0) | — | — | — |

---

## 6. Business Logic

| # | Finding | Severity | Evidence | Impact | Recommendation | Priority |
|---|---|---|---|---|---|---|
| 6.1 | Approval/resolution endpoints lack the concurrency guard used elsewhere in the same domain | High | `review.routes.ts:630-713` (`POST /api/tenant/attendance/action`): reads the log, checks `status !== 'pending'` (`:645`), then updates (`:656`) — no `withLock`/`db.transaction`. Same pattern in `review.routes.ts:474-598` (corrections action) and `review.routes.ts:96-145` (alerts action). By contrast, the check-in/checkout write paths in `attendance.routes.ts:264,415` correctly wrap the same shape of operation in `withLock('attendance:${userId}', ...)` | Two managers approving the same pending item simultaneously can both pass the status check before either write lands — the row update itself converges to the same final state, but downstream side effects (approval email, audit-ledger entry, webhook dispatch) can double-fire | Apply the same `withLock`/transaction pattern already proven in `attendance.routes.ts` to these three approval endpoints | High |
| 6.2 | Freeze-period bypass check is enforced at correction **request** time but not re-checked at **approval** time | High | `review.routes.ts:316-318` checks `isDateFrozen` + requires `attendance.override_without_approval` when a correction is *submitted*. `review.routes.ts:474-598` (`POST /api/tenant/corrections/action`, approve path) calls `editAttendanceDay(...)` unconditionally at line 504 with **no** `isDateFrozen` re-check — only checks whether a payroll *run* is locked (a related but distinct guard) | If a period is frozen between request and approval, the approval path still mutates attendance data inside what should now be an immutable period, silently bypassing the freeze invariant the roadmap explicitly establishes | Re-check `isDateFrozen` at approval time, not just at submission time | High |
| 6.3 | Multi-step correction-approval flow is not transactional | Medium | `review.routes.ts:474-598` — `editAttendanceDay()` (line 504), then conditional `payrollAdjustments` insert (537-546), then `attendanceCorrections` status update (558-566) are three separate non-transactional writes | A crash between steps leaves the attendance day already regularized but the correction stuck `pending` forever, with no atomic guarantee | Wrap the three-step approval in `db.transaction()` | Medium |
| 6.4 | Audit-ledger write failure after a successful attendance-log insert surfaces as a full request failure with no rollback | Low | `attendance.routes.ts:704-831` — attendance log insert succeeds, then `logToAuditLedger` is called; if it throws, the catch at `:829-831` 500s the whole request even though the log row was already committed | Client sees a failure for an operation that actually partially succeeded (attendance recorded, but the request reports an error) — confusing UX and a genuine audit-completeness gap | Make the ledger write fire-and-forget/best-effort (log+swallow) rather than a hard failure path, consistent with how other non-critical side effects are handled elsewhere in the codebase | Low |
| 6.5 | LOP sourced only from frozen state; adjustment-based post-lock immutability; half-day scaling — all re-verified correct on this branch | Informational (positive) | `attendanceDayStatus.ts:280-298`, `payroll.routes.ts:226-229`, `leavePayrollShared.ts:65-85` | — | — | — |

---

## 7. Frontend Review

`apps/admin/src` — 142 TS/TSX files, ~38,873 lines.

| # | Finding | Severity | Evidence | Impact | Recommendation | Priority |
|---|---|---|---|---|---|---|
| 7.1 | Oversized page components | High | `pages/Dashboard.tsx` 4033 lines, `pages/ReportsPage.tsx` 2419, `pages/EmployeeDashboard.tsx` 2119, `components/reports/ReportPreview.tsx` 1454, `pages/EmployeeAttendance.tsx` 1381 | Maintainability/review risk concentrated in a handful of files that touch the most business-critical surfaces (dashboard, reports, attendance) | Continue the decomposition already started under `pages/dashboard/hooks/*`; move tab content to real routes | High |
| 7.2 | Zero memoization on the largest, most stateful page | High | `pages/Dashboard.tsx` — 0 `useMemo`/`useCallback` occurrences despite 27 `useState` hooks and 101 array-transform (`.map/.filter/.reduce/.sort`) call sites. `pages/EmployeeAttendance.tsx` (1381 lines) also has zero. Contrast: `ReportsPage.tsx`/`EmployeeDashboard.tsx`/`ReportPreview.tsx` do use memoization, so this is inconsistent, not systemic | Every state update on the dashboard risks recomputing 100+ derived-array operations unnecessarily | Memoize the expensive derived-array computations, at minimum in `Dashboard.tsx` and `EmployeeAttendance.tsx` | High |
| 7.3 | Heavy 3D dependency eagerly bundled into the public marketing landing page | Medium | `App.tsx:17` imports `DemoPanel` non-lazily; `components/DemoPanel.tsx:7-8` imports `@react-three/fiber` + `three`. Contrast: `pages/Dashboard.tsx:40` explicitly lazy-imports Leaflet with a comment noting the intent to code-split it out | First-load bundle size for the public landing page (highest-traffic, least-authenticated surface) is inflated by a several-hundred-KB 3D library | `React.lazy()` the `DemoPanel`/`AuroraField` import the same way Leaflet is already handled | Medium |
| 7.4 | Inconsistent loading/error/empty state coverage, including one confirmed dead-code case | High | `pages/TeamsPage.tsx:45,78,99` — `loading` state set/toggled but never rendered (grep confirms no `{loading` reference in JSX). `pages/dashboard/LedgerTab.tsx` renders the ledger table/actions unconditionally with no loading/empty/error branch at all. Compare to `EmployeeDirectory.tsx:238`, `PayrollPage.tsx:188`, `LeaveManagementPage.tsx:161`, which do handle it | Users get silent, unexplained blank/stale states on some pages while others behave correctly — inconsistent UX and at least one outright bug (dead loading state) | Fix `TeamsPage.tsx`'s dead state; add loading/empty handling to `LedgerTab.tsx`; establish a shared convention (e.g. a `<AsyncBoundary>` wrapper) | High |
| 7.5 | Accessibility coverage is sparse | Medium-High | Only 18 of 108 `.tsx` files under `pages/`+`components/` contain any `aria-*` attribute. The shared `components/DataTable.tsx` (used across many list pages) has zero `aria-*`/`scope="col"`. `pages/UserProfilePage.tsx` (1040 lines) and `pages/TeamsPage.tsx` (750 lines) — both large form-heavy pages — have zero `aria-*`. `Login.tsx`/`EmployeeLogin.tsx` (critical entry points) have only 2 each | Screen-reader/keyboard-only users are materially underserved on the largest and most business-critical pages | Prioritize `DataTable.tsx` (shared, highest leverage) and the two login pages first | Medium |
| 7.6 | No shared form-validation library; validation reinvented per form | Medium | No `react-hook-form`/`zod`/`yup`/`formik` in `apps/admin/package.json`. Manual imperative validation e.g. `components/BranchFormModal.tsx:166-167` (`if (!value.name.trim()) { setError(...); return; }`) | Every form (Login, EmployeeLogin, BranchFormModal, TeamsPage create/edit, PayrollWizardPage, CompanyProfilePage, dozens more) reinvents its own error-string convention and re-validation trigger | Adopt one validation library and migrate incrementally | Medium |
| 7.7 | No shared design-system/`ui/` component layer | Medium-High | No `ui/` directory exists (confirmed via directory search); long inline Tailwind utility-class strings and CSS-variable references repeated per file (e.g. `pages/dashboard/LedgerTab.tsx:20-36`); `components/templates/*` exist but are inconsistently adopted alongside pages that build layout from scratch | Visual drift risk grows with every new page; no single place to fix a styling bug across the app | Extract `Button`/`Card`/`Badge`/`Input` primitives | Medium |
| 7.8 | Route guards duplicated inline rather than via a reusable wrapper | Medium | `AdminApp.tsx` repeats the `user && canX(user.role) ? <Page/> : <Navigate to="/login"/>` ternary inline at ~25 separate `<Route>` elements (e.g. lines 154-159, 168-170, 178, 183, 185…) instead of a single `<ProtectedRoute role={...}>` component | A new role/gate condition is easy to apply to one route and forget on a sibling — copy-paste-driven authz drift on the client (backend enforcement is the real gate, but UI-level drift still causes confusing/broken UX) | Introduce a `<ProtectedRoute>` wrapper | Medium |
| 7.9 | JWT stored in `localStorage`, read from ~50 independent call sites | Medium | `pages/Login.tsx:55`, `pages/EmployeeLogin.tsx:59` (`localStorage.setItem('auth_token', ...)`); `lib/auth.ts:53,64` reads/removes the same key; independently re-read at ~50 call sites across `pages/*`/`components/*` (see 2.7) | `localStorage` is readable by any injected script (XSS-exfiltrable); combined with the wide fan-out of independent read sites, a single XSS anywhere in the app can steal the session | Standard tradeoff for a bearer-token SPA; if httpOnly-cookie auth isn't adopted, at minimum centralize token access behind one accessor (also fixes 2.7) and keep CSP/XSS hardening a priority (see §8.1) | Medium |
| 7.10 | No dead code / no TODO markers found | Informational (positive) | `grep -r "TODO\|FIXME\|XXX\|HACK" apps/admin/src` → 0 matches; no large commented-out blocks found | — | — | — |
| 7.11 | Route-level lazy loading and a stale-chunk retry wrapper are well implemented | Informational (positive) | `AdminApp.tsx:14-29` `safeLazy()` retries once on chunk-load failure and force-reloads | — | — | — |

---

## 8. Security Review

| # | Finding | Severity | Evidence | Impact | Recommendation | Priority |
|---|---|---|---|---|---|---|
| 8.1 | Content-Security-Policy is explicitly disabled | Medium | `server.ts:51-58` — `helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false })`, with a comment acknowledging this is temporary pending "the production asset pipeline" being finalized | No CSP means the JWT-in-localStorage exposure (7.9) has no defense-in-depth backstop against XSS; helmet's other protections (HSTS, X-Frame-Options, etc.) are presumably still on since only these two directives are disabled, but this is the single biggest deferred security control in the stack | Finalize and enable a tailored CSP before general-availability launch — this is explicitly called out in the code as a pre-launch TODO, i.e. self-identified as unfinished | High |
| 8.2 | 50MB JSON body limit | Low | `server.ts:80` — `express.json({ limit: '50mb' })` | A generous global body-size limit on every JSON endpoint (not just document-upload routes) is an easy DoS/memory-pressure vector; document uploads already have their own 15MB check inside `documents.routes.ts:13`, making the global 50MB limit needlessly larger than any legitimate JSON payload needs | Lower the global limit (e.g. 1–2MB) and keep the larger limit scoped only to the specific upload route(s) that need it | Medium |
| 8.3 | `super_admin` role check duplicated per-handler instead of enforced by middleware (same as 4.8) | Medium | `super.routes.ts` — 13+ inline checks | A single missed check is a full privilege-escalation vulnerability, not just a lint nit | See 4.8 | High |
| 8.4 | New raw error-message leaks (see 2.1) | Medium | `reports.routes.ts:197,308,480`, `super.routes.ts:542` | Information disclosure to authenticated clients (Postgres error text, internal state) | Route through `sendServerError()` | High |
| 8.5 | Unsanitized user input into HTML email (see 4.7) | Medium | `super.routes.ts:177` | Self-XSS-in-inbox / possible stored-XSS if `companyName` is later rendered unescaped in the admin console | HTML-escape template interpolation | Medium |
| 8.6 | Deliberately-unpatched high-severity dependency advisory | Medium | `.github/workflows/ci.yml:45,63` — `pnpm audit --audit-level=high --ignore GHSA-qwww-vcr4-c8h2`, with a comment explaining the fix requires a react-router 7→8 major bump, "tracked as follow-up work, not done blindly here" | A known, currently-shipping high-severity CVE in a core frontend routing dependency | Schedule the react-router major-version upgrade before GA, or independently verify the specific advisory's conditions don't apply to this app's usage pattern | High |
| 8.7 | Rate-limit brute-force protection silently degrades to per-replica counting without `REDIS_URL` | Medium | `middleware/rateLimit.ts:36-38` falls back to express-rate-limit's in-memory `Map` store when `REDIS_URL` is unset; no startup assertion/warning enforcing Redis in production | On a horizontally-scaled production deployment where `REDIS_URL` is accidentally left unset, the documented "10 login attempts / 15 min" brute-force limit actually becomes `10 × replica count` — a silent security regression with no error, just a config omission | Add a production-mode startup check that warns/fails loudly if `NODE_ENV=production` and `REDIS_URL` is unset | Medium |
| 8.8 | Public tenancy-request endpoint has thin abuse controls (see 4.6) | Medium | `super.routes.ts:29` | Email/DB spam via account rotation | Add CAPTCHA or a per-IP secondary limiter | Medium |
| 8.9 | No file-type allowlist on document uploads (see 4.10), mitigated by forced download | Low | `documents.routes.ts:40-45,132-133` | Low practical risk given `Content-Disposition: attachment` | Add an allowlist anyway as defense-in-depth | Low |
| 8.10 | Path-traversal protection on document storage is correctly implemented | Informational (positive) | `services/documentStorage.ts` — server-generated random storage keys (never client filenames), plus a resolve+prefix-check second line of defense (`resolveSafePath`) | — | — | — |
| 8.11 | JWT secret handling, bcrypt password upgrade path, webhook SSRF guard, rate limiting design — all re-verified correct on this branch | Informational (positive) | `jwt.ts:11-28`, `auth.routes.ts:41-62`, `middleware/rateLimit.ts` (office-network-aware user-keyed limiting, documented reasoning) | — | — | — |
| 8.12 | Fetch-then-tenant-check BOLA pattern remains architecturally unresolved, per AUDIT_REPORT.md's own "not fixed" note — re-confirmed still present, no new violating instance found in this pass | Medium (carried forward) | Still ~18 occurrences of the `tenantId !== req.user.tenantId` post-fetch pattern across `payroll.routes.ts`/`payrollExtras.routes.ts`/`leave.routes.ts` | Structural risk: one future missed instance is a direct cross-tenant BOLA | Same recommendation as before — query-level tenant scoping via a repository helper | Medium |

---

## 9. Performance

| # | Finding | Severity | Evidence | Recommendation | Priority |
|---|---|---|---|---|---|
| 9.1 | Two list endpoints remain fully unbounded (new instances, see 4.3) | High | `review.routes.ts:57-88`, `review.routes.ts:602-628` | Add pagination consistent with the rest of the codebase | High |
| 9.2 | Session/idle-timeout check costs two extra DB round-trips per authenticated request | Medium | `middleware/authenticate.ts:44-84` — a users-row read plus a tenants-row read on every single authenticated call | At high request volume this doubles baseline per-request DB load just for auth bookkeeping | Cache tenant idle-timeout config (rarely changes) instead of re-querying per request | Medium |
| 9.3 | No memoization on the highest-traffic, most stateful frontend page (see 7.2) | High | `pages/Dashboard.tsx` | Memoize derived-array computations | High |
| 9.4 | Payroll batch finalization is one large unchunked transaction (see 5.9) | Medium | `payrollBatchCalculation.ts:261-310` | Chunk the transaction | Medium |
| 9.5 | Heavy landing-page bundle (see 7.3) | Medium | `App.tsx:17` → `DemoPanel.tsx:7-8` | Lazy-load the 3D dependency | Medium |
| 9.6 | Composite indexes and N+1 fixes from the prior audit are confirmed still in place | Informational (positive) | `schema.ts` (10 `index()` calls), `payroll.routes.ts` batched `inArray` lookup | — | — |

---

## 10. Scalability

| # | Finding | Severity | Evidence | Recommendation | Priority |
|---|---|---|---|---|---|
| 10.1 | Boot-time schema sync has no multi-instance coordination (see 5.8) | Medium | `bootstrap/database.ts` | Add an advisory lock | Medium |
| 10.2 | Payroll batch finalization doesn't chunk (see 5.9) | Medium | `payrollBatchCalculation.ts:261-310` | Chunk transactions | Medium |
| 10.3 | Rate limiting's brute-force guarantee silently weakens without Redis under horizontal scale (see 8.7) | Medium | `rateLimit.ts:36-38` | Enforce `REDIS_URL` in production | Medium |
| 10.4 | No queueing/async job infrastructure visible beyond `backgroundJobs` table + in-process scheduler | Medium | `schema.ts:808` (`backgroundJobs`), `startSchedulerWithLeadership()` referenced in `server.ts:10,45` | In-process scheduling with a leadership election is a reasonable single-region approach but doesn't scale to a proper distributed job queue (SQS/BullMQ/etc.) if load grows significantly | Acceptable at current scale; flag as a growth-stage item, not a launch blocker | Low |
| 10.5 | No FK cascade rules make bulk tenant offboarding an entirely manual, error-prone, app-level operation (see 5.1) | Medium | `schema.ts` — 0 `onDelete` | Design and test an explicit tenant-deletion cascade path | Medium |

---

## 11. Reliability

| # | Finding | Severity | Evidence | Recommendation | Priority |
|---|---|---|---|---|---|
| 11.1 | Silent failure swallowing in the schema-sync boot path (see 5.7) | High | `bootstrap/database.ts` dozens of empty `catch(e){}` blocks | Log every caught error | High |
| 11.2 | Missing concurrency guards on 3 approval endpoints (see 6.1) | High | `review.routes.ts:57-145,474-598,630-713` | Apply `withLock`/transactions | High |
| 11.3 | Process-level crash guards exist and are correctly wired to monitoring | Informational (positive) | `server.ts:23-28` — `uncaughtException`/`unhandledRejection` routed to `captureException` (Sentry) rather than left to crash the process | — | — |
| 11.4 | Audit-ledger write failure escalates to a full request failure after the underlying operation already succeeded (see 6.4) | Low | `attendance.routes.ts:704-831` | Make the ledger write best-effort | Low |
| 11.5 | Sentry (`@sentry/node`) integration exists and is wired at the top of `server.ts`, alongside a lightweight structured JSON logger | Informational (positive) | `server.ts:13,15`; `logger.ts` | — | — |

---

## 12. Testing Readiness

| # | Finding | Severity | Evidence | Impact | Recommendation | Priority |
|---|---|---|---|---|---|---|
| 12.1 | Effectively zero coverage of HTTP route / business-logic behavior | Critical | Only 4 real test files exist in the whole repo: `apps/admin/attendancePreferences.test.ts`, `presenceEngine.test.ts`, `qr.test.ts`, `wfh.test.ts` — all pure-function unit tests via Node's built-in `node:test` runner. Zero `__tests__` dirs, zero jest/vitest/playwright/cypress config anywhere in the repo. `apps/admin/api` (13.9k lines of route handlers) and `packages/database` have **no tests at all** | An app processing attendance/payroll/PII data ships with no automated verification of its 40+ route files, RBAC enforcement, or the transaction/concurrency fixes made in this and the prior audit | Introduce integration tests (supertest or similar) for at least the payroll lock/adjustment and attendance-approval flows fixed in this and the prior audit, to prevent regression | Critical |
| 12.2 | The project's own `test` script silently runs only half of the existing test files | High | `apps/admin/package.json`: `"test": "tsx --test wfh.test.ts qr.test.ts"` — `attendancePreferences.test.ts` and `presenceEngine.test.ts` exist on disk but are **not included**, so CI's `pnpm test` step never executes them | Two of the four existing tests provide zero actual protection despite existing — false sense of coverage | Fix the script to include all four (`tsx --test *.test.ts` or an explicit list) | High |
| 12.3 | No repository/DAO abstraction makes route handlers hard to unit-test in isolation (see 1.6) | Medium | Every route imports the live `db` singleton directly | Requires either a real Postgres connection or heavy Drizzle mocking to test any handler | Introduce a thin repository layer at least for the highest-risk domains | Medium |
| 12.4 | No CI step runs the DB-dependent bootstrap sync against a throwaway database to catch a broken migration before deploy | Medium | `.github/workflows/ci.yml` runs lint/test/build/audit but no evidence of a step that boots the app against a fresh Postgres instance | A broken `ALTER TABLE` statement (see 5.7) would only be discovered in production, not CI | Add a CI job that spins up Postgres and runs `verifyAndSyncDatabase()` against it | Medium |

---

## 13. Production Readiness

| # | Finding | Severity | Evidence | Recommendation | Priority |
|---|---|---|---|---|---|
| 13.1 | `.env.example` is thorough and documents required-vs-optional vars, deployment topology (Caddy/TLS, split Vercel+Render deploys), and the JWT-secret-required-in-production rule | Informational (positive) | Root `.env.example`, 91 lines | — | — |
| 13.2 | No centralized/validated config module — raw `process.env` reads scattered throughout, no fail-fast on missing required vars (beyond `JWT_SECRET`) | Medium | e.g. `auth.routes.ts:236` reads `process.env.GOOGLE_CLIENT_ID` and only fails per-request (500) if unset, rather than at boot | A misconfigured deploy surfaces as scattered runtime 500s instead of a clear boot-time error | Adopt a startup config-validation step (zod-parsed env schema) | Medium |
| 13.3 | CI runs lint/test/build/dependency-audit and builds (but does not push/deploy) a Docker image | Informational (positive with a gap) | `.github/workflows/ci.yml` | Deployment itself appears to be a manual or platform-auto-deploy step outside this repo's CI — acceptable, but not verifiable from the repo alone; document the actual deploy trigger | Medium |
| 13.4 | Dockerfile is single-stage, bundling the full pnpm install/build toolchain into the production image | Medium | `apps/admin/Dockerfile` — single `FROM node:20-slim` stage; a repo comment explains this is forced by `server.ts` importing `packages/database` via a relative path rather than as an installed workspace dependency | Larger image size and attack surface than a multi-stage build would produce | Restructure the database package import to allow a multi-stage build (build stage → slim runtime stage) | Medium |
| 13.5 | Health checks, structured logging, and Sentry are all present and reasonably designed | Informational (positive) | `health.routes.ts`, `logger.ts`, `services/monitoring.ts` | — | — |
| 13.6 | No CI step validates the DB bootstrap sync (duplicate of 12.4, listed here for the production-readiness lens) | Medium | `.github/workflows/ci.yml` | Add a Postgres-backed CI job | Medium |
| 13.7 | CSP is explicitly disabled, self-flagged in code as a pre-launch TODO (duplicate of 8.1, listed here for completeness) | High | `server.ts:51-58` | Finalize CSP before GA | High |

---

## 14. Codebase Consistency

| # | Finding | Severity | Evidence |
|---|---|---|---|
| 14.1 | Error-handling convention (`sendServerError`) is applied in 283 of 288 sampled call sites but not all — see 2.1 | Medium | `reports.routes.ts`, `super.routes.ts:542` |
| 14.2 | `notifyOrFallback()` helper exists but isn't used everywhere — see 1.3 | Medium | `leave.routes.ts`, `payroll.routes.ts:1317` |
| 14.3 | Logging: structured `logger` vs raw `console.*` coexist — see 2.2 | Low | multiple files |
| 14.4 | Validation rigor varies file-to-file with no shared schema layer — see 4.4 | Medium | `auth.routes.ts` vs `webhooks.routes.ts` |
| 14.5 | Authorization pattern varies: `hasPrivilege`/`hasAnyPrivilege` middleware-style checks in most files vs. manually repeated inline role checks in `super.routes.ts` — see 4.8 | Medium | `super.routes.ts` vs. `attendance.routes.ts`/`review.routes.ts` |
| 14.6 | Dependency version pinning inconsistent across the monorepo (bcryptjs, typescript) — see 2.5, 2.6 | Medium | root vs `apps/admin` `package.json` |
| 14.7 | Frontend state-fetching convention (manual `useState`/`useEffect` per domain hook) is at least applied consistently across `pages/dashboard/hooks/*`, which is a positive counterpoint to the backend inconsistencies above | Informational (positive) | `pages/dashboard/hooks/*` |

---

## 15. Hidden Issues

| # | Finding | Severity | Evidence | Why it matters |
|---|---|---|---|---|
| 15.1 | Race condition on 3 approval endpoints (duplicate of 6.1/11.2, most severe hidden issue found) | High | `review.routes.ts:57-145,474-598,630-713` | Duplicate side effects (emails, ledger, webhooks) under concurrent approval clicks |
| 15.2 | Freeze-period bypass at approval time (duplicate of 6.2) | High | `review.routes.ts:474-598` | Silently violates the immutability guarantee the system's own design documents claim |
| 15.3 | Silent DDL failure swallowing at boot (duplicate of 5.7/11.1) | High | `bootstrap/database.ts` | Schema drift can go undetected indefinitely |
| 15.4 | Concurrent-boot DDL race under horizontal scaling (duplicate of 5.8) | Medium | `bootstrap/database.ts` | Rolling deploys are a live risk vector, not theoretical |
| 15.5 | Rate-limit brute-force guarantee silently degrades without `REDIS_URL` (duplicate of 8.7) | Medium | `rateLimit.ts` | A config omission becomes a silent security regression |
| 15.6 | Dead loading-state bug in production UI code (duplicate of 2.4/7.4) | Medium | `pages/TeamsPage.tsx:45` | Ships broken UX with no test to catch it (see §12) |
| 15.7 | Two-different-major-version dependency pins for the same package across workspaces (duplicate of 2.5) | Medium | `bcryptjs` 2.x vs 3.x | pnpm hoisting-dependent, non-deterministic-feeling bug class |
| 15.8 | Audit-ledger write failure masking a successful operation as a failed request (duplicate of 6.4) | Low | `attendance.routes.ts:829-831` | Confusing partial-failure UX, no rollback |
| 15.9 | No memory-leak or unbounded-cache patterns found in the sampled files | Informational (positive) | — | — |

---

## Final Assessment

### Scores (0–100)

| Category | Score | Justification |
|---|---|---|
| **Production readiness** | **58** | Health checks, Sentry, structured logging, CI, and a well-documented `.env.example` are real strengths, but CSP is explicitly disabled (self-flagged as unfinished), silent DDL-failure swallowing at boot is a live observability gap, and near-zero automated test coverage means regressions in payroll/attendance logic would only be caught in production. |
| **Code quality** | **62** | Consistent naming, no dead code/TODO sprawl, strong doc-comments explaining *why* — offset by a handful of unsanitized error leaks that slipped past the prior sweep, duplicated notification/auth-header/role-check boilerplate, and cross-monorepo dependency version drift. |
| **Architecture** | **60** | The attendance day-status single-source-of-truth and adjustment-based payroll immutability model remain genuine architectural strengths. Undermined by monolithic route/page files, no repository abstraction layer, and a frontend "god component" (`Dashboard.tsx`, 4033 lines) competing with the real router. |
| **Security** | **58** | JWT/bcrypt/webhook-SSRF/rate-limiting fundamentals are sound and well-reasoned. Real gaps: CSP disabled, `super_admin` authorization enforced by manually-repeated per-handler checks rather than middleware, a deliberately-unpatched high-severity CVE in CI, brute-force protection that silently weakens without Redis, and new (if lower-severity) error-message/HTML-injection leaks. |
| **Scalability** | **52** | Indexes and pagination fixes from the prior audit materially improved the base case, but two list endpoints remain fully unbounded, the boot-time schema sync has no multi-instance coordination, and payroll batch finalization is a single unchunked transaction — all concrete ceilings at the 1k–10k employee scale this system is meant to reach. |
| **Maintainability** | **56** | Comments are unusually good for onboarding and explain real prior incidents (e.g. the schema-drift bug documented in `schema.ts:82-88`). Offset by 4000+-line files on both frontend and backend, zero DAO abstraction, and inconsistent conventions (logging, error handling, authorization, validation) that raise the cost of every future change. |
| **Performance** | **57** | Attendance day-status batching, the composite-index and N+1 fixes from the prior audit, and route-level lazy loading on the frontend are genuine wins. Offset by zero memoization on the highest-traffic dashboard page, two newly-found unbounded list endpoints, and a heavy 3D dependency eagerly bundled into the public landing page. |

### Overall project maturity

This is a pre-production system built with unusually deliberate engineering discipline in its hardest domain (the attendance→leave→payroll chain), evidenced by explicit doc-comments that reference a roadmap, name prior real bugs, and reason carefully about edge cases most teams at this stage skip entirely. That discipline has not yet extended evenly to the rest of the stack: the frontend has real component-size and accessibility debt, the backend has authorization and validation patterns that rely on per-handler developer discipline rather than structural enforcement, the database has no cascade/enum-level integrity guarantees, and — most consequentially for a production launch — the project has almost no automated test coverage of its actual HTTP behavior, meaning every fix made in this audit and the prior one is currently unprotected against regression. The prior audit's fixes (transactions on the payroll lock, indexes, pagination, error sanitization, webhook SSRF) are all genuinely in place and verified; this pass found a comparable number of new issues of similar severity in areas outside the prior audit's narrower scope, which is expected given the broader brief rather than a sign the earlier work was incomplete.

### Deployment readiness: **Ready with Fixes**

The core financial/attendance logic is sound enough to trust with real data once the Critical/High items below are closed — this is not a system requiring architectural rework, but it should not go to general availability with CSP disabled, three approval endpoints missing concurrency guards, silent DDL-failure swallowing at boot, and zero automated regression protection on the exact logic two audits' worth of fixes have now touched.

### Prioritized action plan

**Critical blockers (before any production launch):**
- Add integration test coverage for the payroll lock/adjustment and attendance-approval flows this and the prior audit fixed (12.1) — otherwise every fix made across both audits is unprotected against regression.
- Fix the `test` script to actually run all 4 existing test files (12.2) — trivial fix, currently silently masking half the existing coverage.

**High-priority fixes:**
- Add `withLock`/transaction guards to the 3 approval endpoints missing them (6.1/11.2).
- Re-check `isDateFrozen` at correction-approval time, not just submission time (6.2).
- Route the 4 remaining raw-error-message leaks through `sendServerError()` (2.1/8.4).
- Add pagination to the 2 newly-found unbounded list endpoints (4.3/9.1).
- Enable a tailored CSP before GA — already self-flagged as a TODO in the code (8.1/13.7).
- Centralize `super_admin` authorization into middleware instead of 13+ repeated inline checks (4.8/8.3).
- Log (don't swallow) every caught error in the boot-time schema sync (5.7/11.1).
- Schedule the react-router major-version upgrade to close the deliberately-ignored CVE (8.6).
- Fix the dead loading-state bug in `TeamsPage.tsx` and add loading/empty handling to `LedgerTab.tsx` (7.4).
- Add memoization to `Dashboard.tsx` and `EmployeeAttendance.tsx` (7.2/9.3).

**Medium improvements:**
- Add `onDelete` cascade/set-null rules to the schema (5.1); add missing `.references()` on `departments.headUserId`/`users.managerId` (5.3); tighten `breakSessions.tenantId` to NOT NULL (5.4).
- Add a Postgres advisory lock around the boot-time schema sync (5.8/10.1).
- Chunk the payroll batch finalization transaction (5.9/9.4/10.2).
- Enforce `REDIS_URL` in production for rate limiting (8.7/10.3).
- Introduce zod-based request validation, at minimum on mutating/destructive endpoints (4.4).
- Consolidate the `notifyOrFallback()` helper usage (1.3) and centralize the frontend auth-header/API-client boilerplate (2.7/7.9).
- Align dependency versions across the monorepo (bcryptjs, typescript) (2.5/2.6).
- Add a CI job that boots the app against a throwaway Postgres instance to catch broken migrations (12.4/13.6).

**Low-priority improvements:**
- Extract magic statutory-rate defaults into named constants (2.3).
- Prune unused imports left over from the route-file split (1.2).
- Add a file-type allowlist to document uploads (4.10/8.9).
- Reduce the global JSON body-size limit from 50MB (8.2).
- Route remaining raw `console.*` calls through the structured logger (2.2/14.3).

**Nice-to-have enhancements:**
- Introduce `pgEnum` for the highest-risk status columns (5.2).
- Build a shared `ui/` component library on the frontend (7.7/3.1).
- Add a `<ProtectedRoute>` wrapper to de-duplicate the ~25 inline route guards (7.8).
- Lazy-load the 3D marketing-page dependency (7.3/9.5).
- Introduce a repository/DAO layer to improve backend testability long-term (1.6/12.3).
</content>
