-- Made idempotent (IF NOT EXISTS / DO-block guards) rather than the raw
-- drizzle-kit output, because this database had already accumulated most of
-- this schema via `drizzle-kit push` during earlier feature work (tickets,
-- webhooks, statutory payroll, etc.) without ever getting a matching
-- migration file — so a straight replay hit "already exists" on tables that
-- predate this file. Guarding every statement makes this migration safe to
-- run BOTH here (skips what already exists, applies what's actually new —
-- just users.verification_method) AND against a completely fresh database
-- (e.g. a new Neon instance for production), where every guard is a no-op
-- and everything gets created normally.
CREATE TABLE IF NOT EXISTS "attendance_logs_archive" (
	"id" integer PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"status" text NOT NULL,
	"type" text,
	"client_timestamp" timestamp,
	"device" text,
	"location_lat" real,
	"location_lng" real,
	"reason" text,
	"explanation" text,
	"attendance_mode" text,
	"home_lat" real,
	"home_lng" real,
	"distance_from_home_meters" real,
	"wfh_reason" text,
	"checkout_at" timestamp,
	"worked_minutes" real,
	"branch_id" integer,
	"created_at" timestamp,
	"archived_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compensation_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"changed_by_user_id" integer,
	"effective_from" text,
	"previous_annual_ctc" real,
	"new_annual_ctc" real NOT NULL,
	"previous_components" jsonb,
	"new_components" jsonb NOT NULL,
	"field_changes" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"uploaded_by_user_id" integer NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"storage_path" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leave_encashment_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"policy_id" integer NOT NULL,
	"leave_type" text NOT NULL,
	"days" real NOT NULL,
	"rate_per_day" real,
	"amount" real,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh_key" text NOT NULL,
	"auth_key" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"privileges" jsonb DEFAULT '[]' NOT NULL,
	"created_by_user_id" integer,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "service_accounts_key_prefix_unique" UNIQUE("key_prefix")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shift_swap_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"requester_id" integer NOT NULL,
	"target_user_id" integer NOT NULL,
	"swap_date" text NOT NULL,
	"requester_shift_id" integer,
	"target_shift_id" integer,
	"reason" text,
	"status" text DEFAULT 'pending_target' NOT NULL,
	"target_responded_at" timestamp,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"added_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"manager_id" integer NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "termination_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"requested_by_user_id" integer NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ticket_escalations" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"from_user_id" integer,
	"to_user_id" integer,
	"from_level" integer NOT NULL,
	"to_level" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"raised_by_user_id" integer NOT NULL,
	"category" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"related_attendance_log_id" integer,
	"related_leave_request_id" integer,
	"related_date" text,
	"status" text DEFAULT 'open' NOT NULL,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"current_assignee_user_id" integer,
	"last_assigned_at" timestamp DEFAULT now(),
	"resolution_note" text,
	"resolved_by_user_id" integer,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webauthn_challenges" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"challenge" text NOT NULL,
	"purpose" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webauthn_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"device_type" text,
	"transports" jsonb,
	"device_name" text,
	"created_at" timestamp DEFAULT now(),
	"last_used_at" timestamp,
	CONSTRAINT "webauthn_credentials_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"url" text NOT NULL,
	"events" jsonb DEFAULT '[]' NOT NULL,
	"signing_secret" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" integer,
	"last_delivery_at" timestamp,
	"last_delivery_status" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "attendance_alerts" ADD COLUMN IF NOT EXISTS "escalation_level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_alerts" ADD COLUMN IF NOT EXISTS "current_assignee_user_id" integer;--> statement-breakpoint
ALTER TABLE "attendance_alerts" ADD COLUMN IF NOT EXISTS "last_assigned_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "break_sessions" ADD COLUMN IF NOT EXISTS "note" text;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD COLUMN IF NOT EXISTS "accrual_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD COLUMN IF NOT EXISTS "carry_forward_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD COLUMN IF NOT EXISTS "max_carry_forward_days" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD COLUMN IF NOT EXISTS "encashment_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "statutory_compliance_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "pf_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "pf_employee_rate_percent" real DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "pf_employer_rate_percent" real DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "pf_wage_ceiling" real DEFAULT 15000 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "esi_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "esi_employee_rate_percent" real DEFAULT 0.75 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "esi_employer_rate_percent" real DEFAULT 3.25 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "esi_wage_ceiling" real DEFAULT 21000 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "professional_tax_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "professional_tax_slabs" jsonb DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "tds_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "income_tax_slabs" jsonb DEFAULT '[{"upTo":300000,"ratePercent":0},{"upTo":600000,"ratePercent":5},{"upTo":900000,"ratePercent":10},{"upTo":1200000,"ratePercent":15},{"upTo":1500000,"ratePercent":20},{"upTo":null,"ratePercent":30}]';--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "tds_standard_deduction" real DEFAULT 50000 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN IF NOT EXISTS "statutory_basic_percent_of_gross" real DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "kyc_enabled" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "branch_setup_completed" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "policy_announcement" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "policy_announcement_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "documents_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "password_expiry_days" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "idle_timeout_minutes" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "attendance_retention_months" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "verification_method" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_changed_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_history" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_activity_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "data_erased_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attendance_logs_archive" ADD CONSTRAINT "attendance_logs_archive_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attendance_logs_archive" ADD CONSTRAINT "attendance_logs_archive_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attendance_logs_archive" ADD CONSTRAINT "attendance_logs_archive_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "compensation_history" ADD CONSTRAINT "compensation_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "compensation_history" ADD CONSTRAINT "compensation_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "compensation_history" ADD CONSTRAINT "compensation_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leave_encashment_requests" ADD CONSTRAINT "leave_encashment_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leave_encashment_requests" ADD CONSTRAINT "leave_encashment_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leave_encashment_requests" ADD CONSTRAINT "leave_encashment_requests_policy_id_leave_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."leave_policies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leave_encashment_requests" ADD CONSTRAINT "leave_encashment_requests_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_requester_shift_id_shifts_id_fk" FOREIGN KEY ("requester_shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_target_shift_id_shifts_id_fk" FOREIGN KEY ("target_shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "teams" ADD CONSTRAINT "teams_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "teams" ADD CONSTRAINT "teams_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "termination_requests" ADD CONSTRAINT "termination_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "termination_requests" ADD CONSTRAINT "termination_requests_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "termination_requests" ADD CONSTRAINT "termination_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "termination_requests" ADD CONSTRAINT "termination_requests_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ticket_escalations" ADD CONSTRAINT "ticket_escalations_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ticket_escalations" ADD CONSTRAINT "ticket_escalations_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ticket_escalations" ADD CONSTRAINT "ticket_escalations_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets" ADD CONSTRAINT "tickets_raised_by_user_id_users_id_fk" FOREIGN KEY ("raised_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets" ADD CONSTRAINT "tickets_related_attendance_log_id_attendance_logs_id_fk" FOREIGN KEY ("related_attendance_log_id") REFERENCES "public"."attendance_logs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets" ADD CONSTRAINT "tickets_current_assignee_user_id_users_id_fk" FOREIGN KEY ("current_assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets" ADD CONSTRAINT "tickets_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attendance_alerts" ADD CONSTRAINT "attendance_alerts_current_assignee_user_id_users_id_fk" FOREIGN KEY ("current_assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_runs_user_period_unique" ON "payroll_runs" USING btree ("user_id","year","month");
