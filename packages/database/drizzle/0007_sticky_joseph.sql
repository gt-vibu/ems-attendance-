ALTER TABLE "attendance_logs" ADD COLUMN IF NOT EXISTS "is_late" boolean;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD COLUMN IF NOT EXISTS "late_by_minutes" integer;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD COLUMN IF NOT EXISTS "expected_checkout_at" timestamp;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD COLUMN IF NOT EXISTS "is_half_day" boolean;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD COLUMN IF NOT EXISTS "is_short_day" boolean;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD COLUMN IF NOT EXISTS "overtime_minutes" real;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "arrival_policy" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "working_hours_policy" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "required_working_mins" integer;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "hybrid_max_checkout_time" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "arrival_policy" text DEFAULT 'buffered';--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "working_hours_policy" text DEFAULT 'fixed_shift_end';--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "required_working_mins" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "hybrid_max_checkout_time" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "overtime_payroll_enabled" boolean DEFAULT false;
