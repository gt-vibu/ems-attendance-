CREATE TABLE "federation_employee_access_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"grant_version" integer DEFAULT 0 NOT NULL,
	"grants" jsonb DEFAULT '[]' NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "federation_employee_access_grants_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "federation_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"tenant_id" integer,
	"access_token_hash" text NOT NULL,
	"refresh_token_hash" text,
	"scopes" jsonb DEFAULT '[]' NOT NULL,
	"ip_address" text,
	"issued_at" timestamp DEFAULT now(),
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "federation_webhook_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"tenant_id" integer,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"target_url" text NOT NULL,
	"status_code" integer,
	"response_time_ms" integer,
	"delivery_status" text DEFAULT 'delivered' NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"payload" jsonb,
	"error_message" text,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tenant_federation_authorizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"client_id" text NOT NULL,
	"status" text DEFAULT 'authorized' NOT NULL,
	"authorized_scopes" jsonb DEFAULT '["attendance.read","leave.read","employee.read"]' NOT NULL,
	"rejected_scopes" jsonb DEFAULT '[]',
	"connection_date" timestamp DEFAULT now(),
	"last_sync_at" timestamp,
	"sync_status" text DEFAULT 'healthy',
	"token_expiry" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "federation_clients" ALTER COLUMN "tenant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "federation_clients" ALTER COLUMN "scopes" SET DEFAULT '["attendance.read","leave.read","payroll.read","employee.read"]';--> statement-breakpoint
ALTER TABLE "federation_idempotency_keys" ALTER COLUMN "tenant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "company" text;--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "api_key" text;--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "webhook_secret" text;--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "app_uuid" text;--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "public_identifier" text;--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "grant_types" jsonb DEFAULT '["client_credentials","authorization_code","refresh_token"]';--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "pkce_required" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "redirect_uris" jsonb DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "allowed_origins" jsonb DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "webhook_url" text;--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "webhook_events" jsonb DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "webhook_status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "token_lifetime_seconds" integer DEFAULT 3600 NOT NULL;--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "refresh_token_policy" text DEFAULT 'sliding' NOT NULL;--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "rate_limit_per_min" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "api_version" text DEFAULT 'v1.0' NOT NULL;--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "is_marketplace_app" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "rating" text DEFAULT '4.9';--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "category" text DEFAULT 'General';--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "install_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "credential_history" jsonb DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "federation_webhook_outbox" ADD COLUMN "external_organization_id" text;--> statement-breakpoint
ALTER TABLE "federation_webhook_outbox" ADD COLUMN "external_branch_id" text;--> statement-breakpoint
ALTER TABLE "federation_employee_access_grants" ADD CONSTRAINT "federation_employee_access_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_employee_access_grants" ADD CONSTRAINT "federation_employee_access_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_tokens" ADD CONSTRAINT "federation_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_webhook_deliveries" ADD CONSTRAINT "federation_webhook_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_federation_authorizations" ADD CONSTRAINT "tenant_federation_authorizations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_federation_auth_tenant_client_unique" ON "tenant_federation_authorizations" USING btree ("tenant_id","client_id");