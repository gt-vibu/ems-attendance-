# Integration tests

Real HTTP integration tests — a genuine Express app (the same
`registerRoutes()` server.ts itself uses) bound to an ephemeral port,
talking to a real Postgres connection, hit with actual concurrent `fetch()`
requests. This is the coverage layer the production-readiness audit
flagged as completely missing: the earlier `*.test.ts` files at the repo
root are pure-function unit tests with no DB/network involved.

## Requirements

- A reachable Postgres matching this repo's `.env` (`SQL_HOST`/`SQL_PORT`/
  `SQL_ADMIN_USER`/`SQL_ADMIN_PASSWORD`/`SQL_DB_NAME`), with the schema
  already applied (boot the app once normally, or run the boot-time sync).
- **Not** required for the default `npm test` — that must keep working
  without a live database (e.g. in CI environments without a Postgres
  service attached). Run these separately:

```bash
npm run test:integration
```

## What's covered

- `payrollLockConcurrency.integration.test.ts` — the guarded-UPDATE
  concurrency fix on `POST /api/tenant/payroll/:runId/lock`: two genuinely
  concurrent lock requests, exactly one must succeed.
- `attendanceApprovalConcurrency.integration.test.ts` — the same pattern
  on `POST /api/tenant/attendance/action`, plus a same-endpoint check that
  an already-resolved log is rejected outright.
- `correctionFreezeGuard.integration.test.ts` — the freeze-re-checked-at-
  approval-time fix on `POST /api/tenant/corrections/action`. Note this
  test deliberately uses a narrowly-privileged non-admin approver
  (`ctx.createApprover([...])`), not the tenant_admin context most other
  tests use — `tenant_admin`/`super_admin` bypass every privilege check
  unconditionally (see `rbac.ts`'s `hasPrivilege`), including the
  `attendance.override_without_approval` escape hatch this guard checks,
  so testing it with an admin would pass for the wrong reason. This was
  caught by actually running the test against a live DB, not by review.

## Fixtures & cleanup

`harness.ts` creates a disposable tenant + users per test and deletes
everything it created (including rows the endpoints themselves create as
a side effect, e.g. `payroll_settings`, `audit_ledger`, `background_jobs`
entries) in a `finally` block. Every test is fully self-contained and
safe to run against a database with real tenant data in it — nothing
outside the `__integration_test_*` rows it creates itself is touched.
