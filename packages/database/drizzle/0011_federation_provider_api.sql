CREATE TABLE "approval_routing_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"category" text NOT NULL,
	"scope_type" text DEFAULT 'all' NOT NULL,
	"scope_id" integer,
	"scope_value" text,
	"approver_type" text NOT NULL,
	"approver_value" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "attendance_freeze_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"frozen_at" timestamp DEFAULT now(),
	"frozen_by_user_id" integer
);
--> statement-breakpoint
CREATE TABLE "attendance_preference_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"changed_by_user_id" integer NOT NULL,
	"changed_by_name" text NOT NULL,
	"field_name" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"ip_address" text,
	"device_info" text,
	"effective_from" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "attendance_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"allow_multiple_sessions" boolean DEFAULT false,
	"max_sessions_per_day" integer DEFAULT 1,
	"min_gap_between_sessions_mins" integer DEFAULT 15,
	"require_checkout_before_new_checkin" boolean DEFAULT true,
	"auto_close_open_sessions" boolean DEFAULT false,
	"max_session_duration_mins" integer,
	"enabled_methods" jsonb DEFAULT '["face_recognition","gps","manual"]',
	"default_method" text DEFAULT 'face_recognition',
	"method_hierarchy" jsonb,
	"require_face_match" boolean DEFAULT true,
	"require_gps" boolean DEFAULT true,
	"require_office_wifi" boolean DEFAULT false,
	"require_geo_fence" boolean DEFAULT false,
	"require_device_verification" boolean DEFAULT false,
	"require_liveness_detection" boolean DEFAULT true,
	"allow_early_checkin" boolean DEFAULT true,
	"early_checkin_buffer_mins" integer DEFAULT 30,
	"allow_late_checkout" boolean DEFAULT true,
	"max_overtime_mins" integer,
	"allow_cross_midnight_sessions" boolean DEFAULT false,
	"auto_split_at_midnight" boolean DEFAULT false,
	"show_running_timer" boolean DEFAULT true,
	"show_working_hours_live" boolean DEFAULT true,
	"show_attendance_timeline" boolean DEFAULT true,
	"allow_employee_notes" boolean DEFAULT true,
	"allow_attendance_regularization" boolean DEFAULT true,
	"allow_manual_attendance_freeze" boolean DEFAULT true,
	"allow_break_tracking" boolean DEFAULT true,
	"allow_manual_checkout" boolean DEFAULT true,
	"require_checkout_reason" boolean DEFAULT false,
	"enable_breaks" boolean DEFAULT true,
	"allow_multiple_breaks" boolean DEFAULT true,
	"max_breaks" integer,
	"break_categories" jsonb DEFAULT '["Lunch","Tea","Personal","Official","General"]',
	"use_camera_for_face" boolean DEFAULT true,
	"require_rear_camera" boolean DEFAULT false,
	"allow_offline_attendance" boolean DEFAULT false,
	"offline_sync" boolean DEFAULT false,
	"background_gps" boolean DEFAULT false,
	"presence_engine_enabled" boolean DEFAULT true,
	"presence_grace_period_mins" integer DEFAULT 30,
	"presence_heartbeat_interval_sec" integer DEFAULT 60,
	"auto_checkout_delay_mins" integer DEFAULT 15,
	"auto_checkout_confidence_threshold" integer DEFAULT 40,
	"max_session_duration_hours" integer DEFAULT 14,
	"enable_browser_heartbeat" boolean DEFAULT true,
	"enable_browser_activity_tracking" boolean DEFAULT true,
	"enable_gps_evaluation" boolean DEFAULT true,
	"enable_wifi_evaluation" boolean DEFAULT false,
	"enable_face_evaluation" boolean DEFAULT true,
	"ignore_gps_during_break" boolean DEFAULT true,
	"overtime_threshold_mins" integer DEFAULT 0,
	"effective_from" timestamp,
	"updated_at" timestamp DEFAULT now(),
	"updated_by_user_id" integer,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "attendance_preferences_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"job_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp DEFAULT now(),
	"last_error" text,
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "delegations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"delegated_by_user_id" integer NOT NULL,
	"delegated_to_user_id" integer NOT NULL,
	"privilege_keys" jsonb NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"revoked_at" timestamp,
	"revoked_by_user_id" integer
);
--> statement-breakpoint
CREATE TABLE "federation_break_glass_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"actor_user_id" integer,
	"reason" text NOT NULL,
	"action" text NOT NULL,
	"before_json" jsonb,
	"after_json" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "federation_clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_hash" text NOT NULL,
	"environment" text DEFAULT 'sandbox' NOT NULL,
	"scopes" jsonb DEFAULT '["attendance","leave","payroll","employees"]' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "federation_clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "federation_external_id_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"internal_id" integer NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "federation_idempotency_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"client_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp DEFAULT now(),
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "federation_signing_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"key_id" text NOT NULL,
	"public_key" text NOT NULL,
	"private_key_ref" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"activated_at" timestamp DEFAULT now(),
	"retired_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "federation_signing_keys_key_id_unique" UNIQUE("key_id")
);
--> statement-breakpoint
CREATE TABLE "federation_webhook_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"schema_version" text DEFAULT '1.0' NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"aggregate_version" integer DEFAULT 1 NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"business_date" text,
	"data" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"delivery_attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"last_error" text,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "federation_webhook_outbox_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "federation_webhook_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"callback_url" text NOT NULL,
	"event_types" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"last_delivery_at" timestamp,
	"last_delivery_status" text,
	CONSTRAINT "federation_webhook_subscriptions_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "holiday_employee_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"holiday_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"included" boolean NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "holiday_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"holiday_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"action" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"actor_user_id" integer,
	"actor_name" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "leave_escalation_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"leave_request_id" integer NOT NULL,
	"from_user_id" integer,
	"to_user_id" integer NOT NULL,
	"from_level" integer NOT NULL,
	"to_level" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notification_digest_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"recipient_user_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"digest_bucket_date" text NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"sample_subject_names" jsonb DEFAULT '[]' NOT NULL,
	"data" jsonb DEFAULT '{}' NOT NULL,
	"consumed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notification_digest_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"digest_type" text NOT NULL,
	"frequency" text DEFAULT 'daily' NOT NULL,
	"time_of_day" text DEFAULT '09:00' NOT NULL,
	"day_of_week" integer,
	"recipients" jsonb DEFAULT '[]' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"recipient_user_id" integer,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"subject_name" text,
	"data" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notification_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"notify_employee" boolean DEFAULT true NOT NULL,
	"notify_manager" boolean DEFAULT false NOT NULL,
	"notify_hr" boolean DEFAULT false NOT NULL,
	"notify_admin" boolean DEFAULT false NOT NULL,
	"channels" jsonb DEFAULT '["in_app","email"]' NOT NULL,
	"scope_hr_to_department" boolean DEFAULT false NOT NULL,
	"employee_mode" text DEFAULT 'immediate' NOT NULL,
	"manager_mode" text DEFAULT 'immediate' NOT NULL,
	"hr_mode" text DEFAULT 'immediate' NOT NULL,
	"admin_mode" text DEFAULT 'immediate' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notification_recipient_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" text NOT NULL,
	"notify_employee" boolean DEFAULT true NOT NULL,
	"notify_manager" boolean DEFAULT false NOT NULL,
	"notify_hr" boolean DEFAULT false NOT NULL,
	"notify_admin" boolean DEFAULT false NOT NULL,
	"channels" jsonb DEFAULT '["in_app","email"]' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payroll_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"payroll_run_id" integer NOT NULL,
	"source_type" text NOT NULL,
	"source_id" integer,
	"previous_value" real,
	"new_value" real,
	"amount_delta" real NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" integer,
	"approved_by_user_id" integer,
	"approved_at" timestamp,
	"audit_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"applied_to_next_cycle" boolean DEFAULT false NOT NULL,
	"applied_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payroll_advances" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"amount" real NOT NULL,
	"recovery_months" integer DEFAULT 1 NOT NULL,
	"recovery_per_month" real NOT NULL,
	"remaining_balance" real NOT NULL,
	"start_year" integer NOT NULL,
	"start_month" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reason" text,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payroll_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"employee_count" integer DEFAULT 0 NOT NULL,
	"total_gross" real DEFAULT 0 NOT NULL,
	"total_net" real DEFAULT 0 NOT NULL,
	"calculated_at" timestamp,
	"hr_reviewed_by_user_id" integer,
	"hr_reviewed_at" timestamp,
	"finance_reviewed_by_user_id" integer,
	"finance_reviewed_at" timestamp,
	"approved_by_user_id" integer,
	"approved_at" timestamp,
	"released_by_user_id" integer,
	"released_at" timestamp,
	"locked_at" timestamp,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payroll_bonuses" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"amount" real NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_by_user_id" integer,
	"approved_at" timestamp,
	"payroll_batch_id" integer,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payroll_calendars" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"attendance_freeze_date" text,
	"calculation_date" text,
	"hr_review_date" text,
	"finance_review_date" text,
	"release_date" text,
	"salary_credit_date" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payroll_final_settlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"termination_request_id" integer NOT NULL,
	"last_working_date" text NOT NULL,
	"remaining_salary_amount" real DEFAULT 0 NOT NULL,
	"leave_encashment_days" real DEFAULT 0 NOT NULL,
	"leave_encashment_amount" real DEFAULT 0 NOT NULL,
	"pending_bonus_amount" real DEFAULT 0 NOT NULL,
	"notice_period_recovery_amount" real DEFAULT 0 NOT NULL,
	"loan_advance_recovery_amount" real DEFAULT 0 NOT NULL,
	"gross_settlement" real DEFAULT 0 NOT NULL,
	"net_settlement" real DEFAULT 0 NOT NULL,
	"breakdown" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"generated_by_user_id" integer,
	"approved_by_user_id" integer,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payroll_ledger_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"batch_id" integer,
	"payroll_run_id" integer,
	"entry_type" text NOT NULL,
	"source_table" text,
	"source_id" integer,
	"amount" real NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payroll_loans" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"principal" real NOT NULL,
	"emi_amount" real NOT NULL,
	"remaining_balance" real NOT NULL,
	"start_year" integer NOT NULL,
	"start_month" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reason" text,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payroll_reimbursements" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"category" text NOT NULL,
	"amount" real NOT NULL,
	"description" text,
	"receipt_document_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_by_user_id" integer,
	"approved_at" timestamp,
	"payroll_batch_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "presence_evaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"attendance_log_id" integer,
	"state" text NOT NULL,
	"confidence_score" real NOT NULL,
	"signals_evaluated" jsonb NOT NULL,
	"decision" text NOT NULL,
	"reason" text NOT NULL,
	"policy_version" text DEFAULT 'v1.0',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "presence_warnings" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"attendance_log_id" integer,
	"warned_at" timestamp DEFAULT now(),
	"expires_at" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "report_saved_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"name" text NOT NULL,
	"report_type" text NOT NULL,
	"filters" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "report_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"report_name" text NOT NULL,
	"report_type" text NOT NULL,
	"filters" jsonb DEFAULT '{}' NOT NULL,
	"frequency" text NOT NULL,
	"day_of_week" integer,
	"day_of_month" integer,
	"time_of_day" text DEFAULT '08:00' NOT NULL,
	"recipients" jsonb DEFAULT '[]' NOT NULL,
	"format" text DEFAULT 'csv' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "salary_revision_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"type" text DEFAULT 'revision' NOT NULL,
	"proposed_annual_ctc" real NOT NULL,
	"proposed_components" jsonb,
	"effective_date" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending_hr' NOT NULL,
	"hr_reviewed_by_user_id" integer,
	"hr_reviewed_at" timestamp,
	"finance_reviewed_by_user_id" integer,
	"finance_reviewed_at" timestamp,
	"requested_by_user_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shift_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"shift_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"action" text NOT NULL,
	"previous" jsonb,
	"next" jsonb NOT NULL,
	"actor_user_id" integer,
	"actor_name" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DROP INDEX "payroll_runs_user_period_unique";--> statement-breakpoint
ALTER TABLE "break_sessions" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD COLUMN "review_remarks" text;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD COLUMN "document_id" integer;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD COLUMN "applied_log_id" integer;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD COLUMN "pending_verification" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "audit_ledger" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "holidays" ADD COLUMN "branch_id" integer;--> statement-breakpoint
ALTER TABLE "holidays" ADD COLUMN "department" text;--> statement-breakpoint
ALTER TABLE "holidays" ADD COLUMN "is_optional" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "holidays" ADD COLUMN "is_archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "holidays" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "holidays" ADD COLUMN "archived_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "escalation_level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "last_escalated_at" timestamp;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "unpaid_absence_days" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "lop_deduction" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "batch_id" integer;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "supersedes_run_id" integer;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN "block_payroll_release_on_pending_adjustments" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN "payroll_locking_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN "lop_calculation_policy" text DEFAULT 'fixed_26';--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN "monthly_salary_basis" text DEFAULT 'actual_calendar_days';--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN "include_paid_holidays" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN "include_paid_weekends" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN "include_approved_paid_leave" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "timezone" text DEFAULT 'Asia/Kolkata';--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "checkout_grace_mins" integer DEFAULT 15;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "quiet_hours_start" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "quiet_hours_end" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "face_id_enabled" boolean;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "report_logo_url" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "report_address" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "date_of_exit" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notification_channel_prefs" jsonb DEFAULT '{"email":true,"in_app":true}';--> statement-breakpoint
ALTER TABLE "approval_routing_rules" ADD CONSTRAINT "approval_routing_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_freeze_periods" ADD CONSTRAINT "attendance_freeze_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_freeze_periods" ADD CONSTRAINT "attendance_freeze_periods_frozen_by_user_id_users_id_fk" FOREIGN KEY ("frozen_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_preference_history" ADD CONSTRAINT "attendance_preference_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_preference_history" ADD CONSTRAINT "attendance_preference_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_preferences" ADD CONSTRAINT "attendance_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_preferences" ADD CONSTRAINT "attendance_preferences_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_delegated_by_user_id_users_id_fk" FOREIGN KEY ("delegated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_delegated_to_user_id_users_id_fk" FOREIGN KEY ("delegated_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_break_glass_audit" ADD CONSTRAINT "federation_break_glass_audit_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_break_glass_audit" ADD CONSTRAINT "federation_break_glass_audit_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_clients" ADD CONSTRAINT "federation_clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_clients" ADD CONSTRAINT "federation_clients_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_external_id_mappings" ADD CONSTRAINT "federation_external_id_mappings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_idempotency_keys" ADD CONSTRAINT "federation_idempotency_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_webhook_outbox" ADD CONSTRAINT "federation_webhook_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_webhook_subscriptions" ADD CONSTRAINT "federation_webhook_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_employee_overrides" ADD CONSTRAINT "holiday_employee_overrides_holiday_id_holidays_id_fk" FOREIGN KEY ("holiday_id") REFERENCES "public"."holidays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_employee_overrides" ADD CONSTRAINT "holiday_employee_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_history" ADD CONSTRAINT "holiday_history_holiday_id_holidays_id_fk" FOREIGN KEY ("holiday_id") REFERENCES "public"."holidays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_history" ADD CONSTRAINT "holiday_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_history" ADD CONSTRAINT "holiday_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_escalation_history" ADD CONSTRAINT "leave_escalation_history_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_escalation_history" ADD CONSTRAINT "leave_escalation_history_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_escalation_history" ADD CONSTRAINT "leave_escalation_history_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_digest_queue" ADD CONSTRAINT "notification_digest_queue_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_digest_queue" ADD CONSTRAINT "notification_digest_queue_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_digest_subscriptions" ADD CONSTRAINT "notification_digest_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_policies" ADD CONSTRAINT "notification_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipient_groups" ADD CONSTRAINT "notification_recipient_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_advances" ADD CONSTRAINT "payroll_advances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_advances" ADD CONSTRAINT "payroll_advances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_advances" ADD CONSTRAINT "payroll_advances_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_batches" ADD CONSTRAINT "payroll_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_batches" ADD CONSTRAINT "payroll_batches_hr_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("hr_reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_batches" ADD CONSTRAINT "payroll_batches_finance_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("finance_reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_batches" ADD CONSTRAINT "payroll_batches_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_batches" ADD CONSTRAINT "payroll_batches_released_by_user_id_users_id_fk" FOREIGN KEY ("released_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_batches" ADD CONSTRAINT "payroll_batches_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_bonuses" ADD CONSTRAINT "payroll_bonuses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_bonuses" ADD CONSTRAINT "payroll_bonuses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_bonuses" ADD CONSTRAINT "payroll_bonuses_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_bonuses" ADD CONSTRAINT "payroll_bonuses_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_calendars" ADD CONSTRAINT "payroll_calendars_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_final_settlements" ADD CONSTRAINT "payroll_final_settlements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_final_settlements" ADD CONSTRAINT "payroll_final_settlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_final_settlements" ADD CONSTRAINT "payroll_final_settlements_termination_request_id_termination_requests_id_fk" FOREIGN KEY ("termination_request_id") REFERENCES "public"."termination_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_final_settlements" ADD CONSTRAINT "payroll_final_settlements_generated_by_user_id_users_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_final_settlements" ADD CONSTRAINT "payroll_final_settlements_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_ledger_entries" ADD CONSTRAINT "payroll_ledger_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_ledger_entries" ADD CONSTRAINT "payroll_ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_loans" ADD CONSTRAINT "payroll_loans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_loans" ADD CONSTRAINT "payroll_loans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_loans" ADD CONSTRAINT "payroll_loans_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_reimbursements" ADD CONSTRAINT "payroll_reimbursements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_reimbursements" ADD CONSTRAINT "payroll_reimbursements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_reimbursements" ADD CONSTRAINT "payroll_reimbursements_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_evaluations" ADD CONSTRAINT "presence_evaluations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_evaluations" ADD CONSTRAINT "presence_evaluations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_evaluations" ADD CONSTRAINT "presence_evaluations_attendance_log_id_attendance_logs_id_fk" FOREIGN KEY ("attendance_log_id") REFERENCES "public"."attendance_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_warnings" ADD CONSTRAINT "presence_warnings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_warnings" ADD CONSTRAINT "presence_warnings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_warnings" ADD CONSTRAINT "presence_warnings_attendance_log_id_attendance_logs_id_fk" FOREIGN KEY ("attendance_log_id") REFERENCES "public"."attendance_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_saved_templates" ADD CONSTRAINT "report_saved_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_saved_templates" ADD CONSTRAINT "report_saved_templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_revision_requests" ADD CONSTRAINT "salary_revision_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_revision_requests" ADD CONSTRAINT "salary_revision_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_revision_requests" ADD CONSTRAINT "salary_revision_requests_hr_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("hr_reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_revision_requests" ADD CONSTRAINT "salary_revision_requests_finance_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("finance_reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_revision_requests" ADD CONSTRAINT "salary_revision_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_history" ADD CONSTRAINT "shift_history_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_history" ADD CONSTRAINT "shift_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_history" ADD CONSTRAINT "shift_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_freeze_periods_tenant_period_unique" ON "attendance_freeze_periods" USING btree ("tenant_id","year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "federation_ext_id_entity_external_unique" ON "federation_external_id_mappings" USING btree ("entity_type","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "federation_ext_id_entity_internal_unique" ON "federation_external_id_mappings" USING btree ("tenant_id","entity_type","internal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "federation_idempotency_client_key_unique" ON "federation_idempotency_keys" USING btree ("client_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "federation_outbox_tenant_status_idx" ON "federation_webhook_outbox" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "federation_outbox_tenant_created_idx" ON "federation_webhook_outbox" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "holiday_employee_overrides_holiday_user_unique" ON "holiday_employee_overrides" USING btree ("holiday_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "digest_queue_dedupe_unique" ON "notification_digest_queue" USING btree ("tenant_id","recipient_user_id","event_type","digest_bucket_date");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_policies_tenant_event_unique" ON "notification_policies" USING btree ("tenant_id","event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_templates_tenant_event_channel_unique" ON "notification_templates" USING btree ("tenant_id","event_type","channel");--> statement-breakpoint
CREATE INDEX "payroll_adjustments_tenant_status_idx" ON "payroll_adjustments" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "payroll_advances_tenant_status_idx" ON "payroll_advances" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_batches_tenant_period_unique" ON "payroll_batches" USING btree ("tenant_id","year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_calendars_tenant_period_unique" ON "payroll_calendars" USING btree ("tenant_id","year","month");--> statement-breakpoint
CREATE INDEX "payroll_ledger_entries_tenant_year_month_idx" ON "payroll_ledger_entries" USING btree ("tenant_id","year","month");--> statement-breakpoint
CREATE INDEX "payroll_loans_tenant_status_idx" ON "payroll_loans" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "payroll_reimbursements_tenant_status_idx" ON "payroll_reimbursements" USING btree ("tenant_id","status");--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_applied_log_id_attendance_logs_id_fk" FOREIGN KEY ("applied_log_id") REFERENCES "public"."attendance_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_head_user_id_users_id_fk" FOREIGN KEY ("head_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_logs_tenant_user_created_idx" ON "attendance_logs" USING btree ("tenant_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "attendance_logs_tenant_created_idx" ON "attendance_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "leave_requests_tenant_status_idx" ON "leave_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "leave_requests_tenant_user_idx" ON "leave_requests" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_user_period_version_unique" ON "payroll_runs" USING btree ("user_id","year","month","version");--> statement-breakpoint
CREATE INDEX "payroll_runs_tenant_year_month_idx" ON "payroll_runs" USING btree ("tenant_id","year","month");