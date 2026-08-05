-- Adds tenant-admin-facing on/off switches for payroll locking and manual
-- attendance freeze (2026-08-05). See schema.ts comments on
-- payrollSettings.payrollLockingEnabled and
-- attendancePreferences.allowManualAttendanceFreeze for the gating chain.
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "payroll_locking_enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "attendance_preferences" ADD COLUMN IF NOT EXISTS "allow_manual_attendance_freeze" boolean DEFAULT true;
