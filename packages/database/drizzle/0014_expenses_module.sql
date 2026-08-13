CREATE TABLE IF NOT EXISTS "expense_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
	"name" text NOT NULL,
	"code" text,
	"description" text,
	"max_limit" real,
	"require_receipt" boolean DEFAULT true,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
	"user_id" integer NOT NULL REFERENCES "users"("id"),
	"expense_id" text NOT NULL,
	"amount" real NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"merchant" text,
	"category" text NOT NULL,
	"category_id" integer REFERENCES "expense_categories"("id"),
	"description" text,
	"location" text,
	"payment_method" text DEFAULT 'Personal Payment',
	"receipt_url" text,
	"receipt_storage_path" text,
	"receipt_original_name" text,
	"receipt_mime_type" text,
	"receipt_file_size" integer,
	"additional_attachments" jsonb DEFAULT '[]'::jsonb,
	"expense_date" text NOT NULL,
	"expense_time" text NOT NULL,
	"upload_timestamp" timestamp DEFAULT now(),
	"ocr_extracted_data" jsonb,
	"original_ocr_values" jsonb,
	"user_corrected_values" jsonb,
	"derived_from_upload_timestamp" boolean DEFAULT false,
	"is_ocr_verified" boolean DEFAULT false,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"rejection_reason" text,
	"approved_amount" real,
	"reimbursed_amount" real DEFAULT 0,
	"remaining_amount" real,
	"approved_by_user_id" integer REFERENCES "users"("id"),
	"approved_at" timestamp,
	"reimbursed_by_user_id" integer REFERENCES "users"("id"),
	"reimbursed_at" timestamp,
	"reimbursement_ref" text,
	"resubmitted_from_id" integer,
	"policy_violation_flag" boolean DEFAULT false,
	"policy_violation_details" text,
	"duplicate_flag" boolean DEFAULT false,
	"duplicate_details" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "expense_reimbursements" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
	"expense_id" integer NOT NULL REFERENCES "expenses"("id"),
	"user_id" integer NOT NULL REFERENCES "users"("id"),
	"reimbursed_by_user_id" integer NOT NULL REFERENCES "users"("id"),
	"amount" real NOT NULL,
	"payment_ref" text,
	"payment_method" text DEFAULT 'Bank Transfer',
	"previous_remaining_amount" real NOT NULL,
	"new_remaining_amount" real NOT NULL,
	"is_partial" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "expense_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
	"user_id" integer NOT NULL REFERENCES "users"("id"),
	"name" text NOT NULL,
	"description" text,
	"columns" jsonb NOT NULL,
	"filters" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "expense_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
	"name" text NOT NULL,
	"category" text,
	"max_amount_limit" real,
	"receipt_required_amount" real DEFAULT 0,
	"auto_flag_duplicates" boolean DEFAULT true,
	"allow_employee_withdrawal" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
