-- Federation schema drift fix — hand-authored, not drizzle-kit generated.
--
-- Context: this repo's federation tables (and, it turns out, most tables
-- across the whole app) have been kept in sync purely through idempotent
-- "CREATE TABLE IF NOT EXISTS" / "ALTER TABLE ... ADD COLUMN IF NOT
-- EXISTS" statements run at application startup
-- (apps/admin/api/bootstrap/database.ts), never through this drizzle-kit
-- migrations folder after the initial 0011_federation_provider_api.sql
-- baseline. That's the exact gap the BlizBooks integration review flagged
-- ("Federation tables are created through application startup SQL. They
-- should be moved to tracked, transactional migration files before
-- production rollout").
--
-- This file captures, as a proper versioned migration, the federation
-- schema changes made since that baseline: real external
-- organization/branch ids on the outbox, a nullable idempotency tenant_id
-- (needed for a platform-scoped client provisioning a brand-new tenant —
-- see federationIdempotencyKeys.tenantId's own comment in schema.ts), and
-- three federation_clients columns that were declared in schema.ts from
-- day one but never actually reached Postgres.
--
-- IMPORTANT — this migrations folder is not currently wired into the
-- running application (server.ts still calls the bootstrap-SQL path,
-- deliberately left in place; see the note in bootstrap/database.ts).
-- Running `drizzle-kit generate` again right now would also try to
-- capture drift across ~80 OTHER tables that predate this file, none of
-- which is in scope of the federation review — reconciling that whole
-- history safely (registering the four already-on-disk-but-untracked
-- 0008–0011 files against drizzle-kit's own journal/migrations-tracking
-- table on a live database) is a separate, higher-risk piece of work that
-- deserves its own careful pass against a real environment, not something
-- to rush alongside this fix. Until that's done and this folder is wired
-- up as the actual source of truth, bootstrap/database.ts's own
-- idempotent ALTER TABLE statements remain the thing that actually keeps
-- production schema in sync — this file exists so the change is tracked
-- and reviewable, and so wiring up real migrations later has an accurate
-- starting point for federation specifically.

ALTER TABLE "federation_webhook_outbox" ADD COLUMN "external_organization_id" text;
--> statement-breakpoint
ALTER TABLE "federation_webhook_outbox" ADD COLUMN "external_branch_id" text;
--> statement-breakpoint
ALTER TABLE "federation_idempotency_keys" ALTER COLUMN "tenant_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "token_lifetime_seconds" integer DEFAULT 3600 NOT NULL;
--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "refresh_token_policy" text DEFAULT 'sliding' NOT NULL;
--> statement-breakpoint
ALTER TABLE "federation_clients" ADD COLUMN "credential_history" jsonb DEFAULT '[]';
