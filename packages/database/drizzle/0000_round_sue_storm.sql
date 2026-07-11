CREATE TABLE "attendance_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"break_session_id" integer,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_by_user_id" integer,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "attendance_corrections" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"request_type" text NOT NULL,
	"requested_date" text NOT NULL,
	"requested_time" text,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "attendance_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"status" text NOT NULL,
	"type" text DEFAULT 'check_in',
	"client_timestamp" timestamp,
	"fraud_score" real,
	"liveness_score" real,
	"face_match_score" real,
	"device" text,
	"location_lat" real,
	"location_lng" real,
	"reason" text,
	"explanation" text,
	"challenge" jsonb,
	"attendance_mode" text DEFAULT 'office' NOT NULL,
	"home_lat" real,
	"home_lng" real,
	"distance_from_home_meters" real,
	"wfh_reason" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "audit_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp DEFAULT now(),
	"tenant_id" integer,
	"actor_id" integer,
	"actor_name" text NOT NULL,
	"action" text NOT NULL,
	"ip_address" text,
	"device_info" text,
	"details" jsonb,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "break_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tenant_id" integer,
	"break_type" text DEFAULT 'General',
	"start_time" timestamp DEFAULT now(),
	"end_time" timestamp,
	"start_lat" real,
	"start_lng" real,
	"end_lat" real,
	"end_lng" real,
	"is_violation" boolean DEFAULT false,
	"outside_geofence" boolean DEFAULT false,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "device_change_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"old_device_id" text,
	"new_device_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "employee_home_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"latitude" real NOT NULL,
	"longitude" real NOT NULL,
	"accuracy" real,
	"address" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"date" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "qr_scans" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"qr_session_id" integer NOT NULL,
	"scanned_by_user_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"gps_passed" boolean,
	"wifi_passed" boolean,
	"face_passed" boolean,
	"device_trust_passed" boolean,
	"distance_meters" real,
	"device_id" text,
	"ip_address" text,
	"user_agent" text,
	"attendance_log_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "qr_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"generated_by_user_id" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"rotation_seconds" integer DEFAULT 30 NOT NULL,
	"current_nonce" text NOT NULL,
	"current_token_issued_at" timestamp NOT NULL,
	"current_token_expires_at" timestamp NOT NULL,
	"current_nonce_used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tenancy_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_name" text NOT NULL,
	"email" text NOT NULL,
	"num_employees" integer NOT NULL,
	"plan" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"admin_uid" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"wifi_ssid" text,
	"office_ip" text,
	"wifi_check_enabled" boolean DEFAULT false,
	"location_lat" real,
	"location_lng" real,
	"location_radius_meters" integer DEFAULT 100,
	"plan" text DEFAULT 'Basic',
	"features_allowed" jsonb,
	"shift_start" text DEFAULT '09:00',
	"shift_end" text DEFAULT '18:00',
	"grace_period_mins" integer DEFAULT 15,
	"half_day_mins" integer DEFAULT 240,
	"weekend_config" jsonb DEFAULT '["Saturday", "Sunday"]',
	"daily_break_budget_mins" integer DEFAULT 60,
	"min_attendance_percent" integer DEFAULT 75,
	"wfh_enabled" boolean DEFAULT false,
	"wfh_allowed_roles" jsonb,
	"wfh_max_days_per_month" integer,
	"wfh_allowed_weekdays" jsonb DEFAULT '["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]',
	"wfh_radius_meters" integer DEFAULT 200,
	"wfh_approval_required" boolean DEFAULT true,
	"wfh_require_reason" boolean DEFAULT true,
	"wfh_late_login_grace_mins" integer,
	"qr_enabled" boolean DEFAULT false,
	"qr_rotation_seconds" integer DEFAULT 30,
	"qr_require_gps" boolean DEFAULT true,
	"qr_require_wifi" boolean DEFAULT false,
	"qr_require_face" boolean DEFAULT true,
	"qr_geofence_radius_meters" integer,
	"qr_require_device_trust" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"uid" text NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"name" text NOT NULL,
	"tenant_id" integer,
	"role" text DEFAULT 'employee' NOT NULL,
	"privileges" jsonb,
	"must_change_password" boolean DEFAULT false,
	"temp_password" text,
	"is_kyc_completed" boolean DEFAULT false,
	"face_embeddings" jsonb,
	"kyc_action_log" jsonb,
	"registered_device_id" text,
	"device_approval_pending" boolean DEFAULT false,
	"last_heartbeat_lat" real,
	"last_heartbeat_lng" real,
	"last_heartbeat_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_uid_unique" UNIQUE("uid"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "wfh_location_change_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"new_latitude" real NOT NULL,
	"new_longitude" real NOT NULL,
	"new_accuracy" real,
	"new_address" text,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "attendance_alerts" ADD CONSTRAINT "attendance_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_alerts" ADD CONSTRAINT "attendance_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_alerts" ADD CONSTRAINT "attendance_alerts_break_session_id_break_sessions_id_fk" FOREIGN KEY ("break_session_id") REFERENCES "public"."break_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_alerts" ADD CONSTRAINT "attendance_alerts_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_ledger" ADD CONSTRAINT "audit_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_ledger" ADD CONSTRAINT "audit_ledger_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_sessions" ADD CONSTRAINT "break_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_sessions" ADD CONSTRAINT "break_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_change_requests" ADD CONSTRAINT "device_change_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_change_requests" ADD CONSTRAINT "device_change_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_home_locations" ADD CONSTRAINT "employee_home_locations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_home_locations" ADD CONSTRAINT "employee_home_locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_scans" ADD CONSTRAINT "qr_scans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_scans" ADD CONSTRAINT "qr_scans_qr_session_id_qr_sessions_id_fk" FOREIGN KEY ("qr_session_id") REFERENCES "public"."qr_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_scans" ADD CONSTRAINT "qr_scans_scanned_by_user_id_users_id_fk" FOREIGN KEY ("scanned_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_scans" ADD CONSTRAINT "qr_scans_attendance_log_id_attendance_logs_id_fk" FOREIGN KEY ("attendance_log_id") REFERENCES "public"."attendance_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_sessions" ADD CONSTRAINT "qr_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_sessions" ADD CONSTRAINT "qr_sessions_generated_by_user_id_users_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wfh_location_change_requests" ADD CONSTRAINT "wfh_location_change_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wfh_location_change_requests" ADD CONSTRAINT "wfh_location_change_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wfh_location_change_requests" ADD CONSTRAINT "wfh_location_change_requests_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;