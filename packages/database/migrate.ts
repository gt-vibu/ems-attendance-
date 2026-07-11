// Applies all generated SQL migrations in ./drizzle to the configured Postgres
// database, then exits. Intended as a release/CI step run BEFORE starting the
// app:
//
//   pnpm --filter @company/database db:migrate
//
// Migration files are produced from the Drizzle schema with:
//
//   pnpm --filter @company/database db:generate
//
// NOTE: the app also runs an idempotent CREATE TABLE IF NOT EXISTS / ALTER
// TABLE sync at startup (verifyAndSyncDatabase in apps/admin/server.ts), so it
// boots correctly with or without these migrations having been applied. This
// runner exists to give schema changes a versioned, reviewable, rollback-aware
// history going forward — the recommended path for evolving the schema in
// production instead of relying on the boot-time sync alone.
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pkg from 'pg';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '../../.env') });
const { Pool } = pkg;

async function main() {
  const pool = new Pool({
    host: process.env.SQL_HOST || '127.0.0.1',
    port: Number(process.env.SQL_PORT) || 5432,
    user: process.env.SQL_ADMIN_USER || 'postgres',
    password: process.env.SQL_ADMIN_PASSWORD || 'password',
    database: process.env.SQL_DB_NAME || 'postgres',
    // Managed providers (Neon/Supabase/Render) require TLS — set SQL_SSL=true.
    ssl: process.env.SQL_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  const db = drizzle(pool);
  const migrationsFolder = path.join(process.cwd(), 'drizzle');
  console.log(`[migrate] Applying migrations from ${migrationsFolder} ...`);
  await migrate(db, { migrationsFolder });
  console.log('[migrate] Done.');
  await pool.end();
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
