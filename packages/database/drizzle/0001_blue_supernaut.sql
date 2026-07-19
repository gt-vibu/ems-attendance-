CREATE TABLE "branches" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"location_lat" real,
	"location_lng" real,
	"location_radius_meters" integer DEFAULT 100,
	"is_main_branch" boolean DEFAULT false,
	"status" text DEFAULT 'active' NOT NULL,
	"shift_start" text DEFAULT '09:00',
	"shift_end" text DEFAULT '18:00',
	"grace_period_mins" integer DEFAULT 15,
	"half_day_mins" integer DEFAULT 240,
	"weekend_config" jsonb DEFAULT '["Saturday", "Sunday"]',
	"daily_break_budget_mins" integer DEFAULT 60,
	"min_attendance_percent" integer DEFAULT 75,
	"wifi_ssid" text,
	"office_ip" text,
	"wifi_check_enabled" boolean DEFAULT false,
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
CREATE TABLE "shifts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"name" text NOT NULL,
	"check_in_time" text NOT NULL,
	"check_out_time" text NOT NULL,
	"grace_period_mins" integer,
	"is_default" boolean DEFAULT false,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD COLUMN "branch_id" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "kyc_enabled" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "branch_setup_completed" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "branch_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "shift_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "active_session_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "session_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;