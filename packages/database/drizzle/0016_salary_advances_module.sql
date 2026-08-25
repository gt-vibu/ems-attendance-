CREATE TABLE IF NOT EXISTS "salary_advances" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
	"user_id" integer NOT NULL REFERENCES "users"("id"),
	"origin" text DEFAULT 'EMPLOYEE_REQUEST' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"requested_amount" numeric(12, 2) NOT NULL,
	"approved_amount" numeric(12, 2),
	"disbursed_amount" numeric(12, 2),
	"outstanding_amount" numeric(12, 2) NOT NULL,
	"recovered_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"recovery_method" text DEFAULT 'full_next_payroll' NOT NULL,
	"recovery_installments" integer DEFAULT 1 NOT NULL,
	"start_recovery_year" integer NOT NULL,
	"start_recovery_month" integer NOT NULL,
	"reason" text,
	"remarks" text,
	"rejection_reason" text,
	"requested_at" timestamp DEFAULT now(),
	"approved_at" timestamp,
	"rejected_at" timestamp,
	"disbursed_at" timestamp,
	"closed_at" timestamp,
	"requested_by_user_id" integer REFERENCES "users"("id"),
	"approved_by_user_id" integer REFERENCES "users"("id"),
	"disbursed_by_user_id" integer REFERENCES "users"("id"),
	"disbursement_method" text,
	"disbursement_reference" text,
	"bank_details_snapshot" jsonb,
	"policy_snapshot" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "salary_advance_recoveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
	"advance_id" integer NOT NULL REFERENCES "salary_advances"("id"),
	"user_id" integer NOT NULL REFERENCES "users"("id"),
	"scheduled_year" integer NOT NULL,
	"scheduled_month" integer NOT NULL,
	"installment_number" integer DEFAULT 1 NOT NULL,
	"total_installments" integer DEFAULT 1 NOT NULL,
	"scheduled_amount" numeric(12, 2) NOT NULL,
	"recovered_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"remaining_amount" numeric(12, 2) NOT NULL,
	"payroll_batch_id" integer REFERENCES "payroll_batches"("id"),
	"payroll_run_id" integer REFERENCES "payroll_runs"("id"),
	"status" text DEFAULT 'scheduled' NOT NULL,
	"recovered_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "salary_advances_tenant_user_idx" ON "salary_advances" ("tenant_id", "user_id");
CREATE INDEX IF NOT EXISTS "salary_advances_tenant_status_idx" ON "salary_advances" ("tenant_id", "status");

CREATE INDEX IF NOT EXISTS "salary_advance_recoveries_tenant_advance_idx" ON "salary_advance_recoveries" ("tenant_id", "advance_id");
CREATE INDEX IF NOT EXISTS "salary_advance_recoveries_tenant_period_status_idx" ON "salary_advance_recoveries" ("tenant_id", "scheduled_year", "scheduled_month", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "salary_advance_recoveries_unique_advance_period" ON "salary_advance_recoveries" ("advance_id", "scheduled_year", "scheduled_month");

ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "salary_advance_enabled" boolean DEFAULT true;
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "advance_calculation_basis" text DEFAULT 'net_salary';
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "advance_max_amount" numeric(12, 2) DEFAULT '50000.00';
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "advance_max_percentage" numeric(5, 2) DEFAULT '50.00';
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "advance_min_tenure_months" integer DEFAULT 3;
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "advance_max_active_count" integer DEFAULT 1;
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "advance_allow_multiple" boolean DEFAULT false;
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "advance_default_recovery_method" text DEFAULT 'full_next_payroll';
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "advance_max_installments" integer DEFAULT 6;
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "advance_min_recovery_amount" numeric(12, 2) DEFAULT '1000.00';
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "advance_employee_can_request" boolean DEFAULT true;
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "advance_admin_can_assign" boolean DEFAULT true;
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "advance_approval_required" boolean DEFAULT true;
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "advance_cutoff_day" integer DEFAULT 20;
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "advance_approval_thresholds" jsonb;
