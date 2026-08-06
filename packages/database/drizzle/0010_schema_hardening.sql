-- DB-level integrity fixes from the production-readiness audit (2026-08-06):
-- break_sessions.tenant_id NOT NULL (backfilled first), and the two
-- long-deferred self/cross-referential FKs (departments.head_user_id,
-- users.manager_id) that previously existed only as a comment.
UPDATE break_sessions bs SET tenant_id = u.tenant_id FROM users u WHERE bs.user_id = u.id AND bs.tenant_id IS NULL;
ALTER TABLE "break_sessions" ALTER COLUMN "tenant_id" SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'departments_head_user_id_users_id_fk') THEN
    ALTER TABLE "departments" ADD CONSTRAINT "departments_head_user_id_users_id_fk" FOREIGN KEY ("head_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_manager_id_users_id_fk') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
END $$;
