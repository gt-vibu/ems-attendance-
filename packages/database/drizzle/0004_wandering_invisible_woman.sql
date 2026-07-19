CREATE TABLE "role_compensation_components" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"role_default_id" integer NOT NULL,
	"component_name" text NOT NULL,
	"component_type" text DEFAULT 'earning' NOT NULL,
	"calculation_type" text DEFAULT 'percent_of_ctc' NOT NULL,
	"value" real NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "role_compensation_defaults" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"role_name" text NOT NULL,
	"annual_ctc" real NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "role_compensation_components" ADD CONSTRAINT "role_compensation_components_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_compensation_components" ADD CONSTRAINT "role_compensation_components_role_default_id_role_compensation_defaults_id_fk" FOREIGN KEY ("role_default_id") REFERENCES "public"."role_compensation_defaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_compensation_defaults" ADD CONSTRAINT "role_compensation_defaults_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;