ALTER TABLE "employee_compensation_profiles"
  ADD COLUMN IF NOT EXISTS "attendance_tracked" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "employee_compensation_profiles"
  ADD COLUMN IF NOT EXISTS "attendance_affects_payroll" boolean;
