-- Adds composite indexes for the attendance/leave/payroll hot-path queries
-- identified by the cross-module architecture audit (2026-08-05). Every
-- table below is filtered by (tenant_id, ...) on every route sampled in
-- payroll.routes.ts / leave.routes.ts / attendanceDayStatus.ts, and
-- Postgres does not auto-index foreign-key columns, so these were full
-- table scans without this. CONCURRENTLY avoids locking the tables for
-- writes while the index builds; each statement must run outside a
-- transaction block (drizzle-kit issues them one at a time already).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "attendance_logs_tenant_user_created_idx" ON "attendance_logs" ("tenant_id","user_id","created_at");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "attendance_logs_tenant_created_idx" ON "attendance_logs" ("tenant_id","created_at");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "leave_requests_tenant_status_idx" ON "leave_requests" ("tenant_id","status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "leave_requests_tenant_user_idx" ON "leave_requests" ("tenant_id","user_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payroll_runs_tenant_year_month_idx" ON "payroll_runs" ("tenant_id","year","month");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payroll_adjustments_tenant_status_idx" ON "payroll_adjustments" ("tenant_id","status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payroll_loans_tenant_status_idx" ON "payroll_loans" ("tenant_id","status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payroll_advances_tenant_status_idx" ON "payroll_advances" ("tenant_id","status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payroll_reimbursements_tenant_status_idx" ON "payroll_reimbursements" ("tenant_id","status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payroll_ledger_entries_tenant_year_month_idx" ON "payroll_ledger_entries" ("tenant_id","year","month");
