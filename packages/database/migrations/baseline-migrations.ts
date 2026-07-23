// One-time fix for a database that was ever built up via `drizzle-kit push`
// (or the app's own boot-time verifyAndSyncDatabase sync) instead of
// `db:migrate` — which is this project's actual history: migrations 0000-
// 0005 describe schema that already exists in the live database, but
// drizzle's own migration tracking table (drizzle.__drizzle_migrations) has
// no record of them ever running. `db:migrate` then tries to replay them
// from scratch and fails with "relation already exists" on the very first
// CREATE TABLE.
//
// This script marks migrations 0000-0005 as already applied (inserting the
// same hash/created_at rows `db:migrate` itself would have written), WITHOUT
// executing their SQL — safe, because that schema state already exists.
// Migration 0006 onward is left alone so a normal `db:migrate` run afterward
// applies only what's genuinely new.
//
// Idempotent: safe to re-run — a migration whose hash is already recorded is
// skipped. Only ever needs to run ONCE per database that has this history;
// a fresh database (e.g. a brand-new Neon instance) has no pre-existing
// tables, so its `db:migrate` run needs no baseline and this script is a
// no-op for it (BASELINE_UP_TO with nothing to skip yet still just no-ops
// since every hash check finds nothing to skip past... but there's nothing
// to run against, so don't bother running this against a fresh DB at all).
//
//   pnpm --filter @company/database baseline-migrations
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pkg from 'pg';
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

dotenv.config({ path: path.join(process.cwd(), '../../.env') });
const { Pool } = pkg;

// Only these — the migrations that predate this project's adoption of
// db:migrate as the schema-change workflow — ever need baselining. Update
// this if more pre-existing-schema migrations are ever discovered; do NOT
// just baseline "everything up to the latest", since a migration containing
// a genuinely new change (like 0006's users.verification_method) must
// actually run.
const BASELINE_TAGS = [
  '0000_round_sue_storm',
  '0001_blue_supernaut',
  '0002_lovely_whizzer',
  '0003_blue_ted_forrester',
  '0004_wandering_invisible_woman',
  '0005_groovy_kulan_gath',
];

async function main() {
  const pool = new Pool({
    host: process.env.SQL_HOST || '127.0.0.1',
    port: Number(process.env.SQL_PORT) || 5432,
    user: process.env.SQL_ADMIN_USER || 'postgres',
    password: process.env.SQL_ADMIN_PASSWORD || 'password',
    database: process.env.SQL_DB_NAME || 'postgres',
    ssl: process.env.SQL_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  const db = drizzle(pool);

  const journalPath = path.join(process.cwd(), 'drizzle/meta/_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
  const entriesToBaseline = journal.entries.filter((e: any) => BASELINE_TAGS.includes(e.tag));

  if (entriesToBaseline.length !== BASELINE_TAGS.length) {
    throw new Error(
      `Expected to find all ${BASELINE_TAGS.length} baseline tags in the journal, found ${entriesToBaseline.length}. ` +
      `Refusing to guess — check drizzle/meta/_journal.json and BASELINE_TAGS above match.`
    );
  }

  // Same table shape drizzle-orm/node-postgres/migrator creates on its own —
  // matching it exactly means a normal `db:migrate` run afterward finds it
  // and behaves exactly as if it had run these migrations itself.
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const existing = await db.execute(sql`SELECT hash FROM "drizzle"."__drizzle_migrations"`);
  const existingHashes = new Set((existing.rows as any[]).map(r => r.hash));

  for (const entry of entriesToBaseline) {
    const migrationPath = path.join(process.cwd(), 'drizzle', `${entry.tag}.sql`);
    const query = fs.readFileSync(migrationPath, 'utf-8');
    const hash = crypto.createHash('sha256').update(query).digest('hex');

    if (existingHashes.has(hash)) {
      console.log(`[baseline] ${entry.tag} — already recorded, skipping.`);
      continue;
    }

    await db.execute(sql`
      INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
      VALUES (${hash}, ${entry.when})
    `);
    console.log(`[baseline] ${entry.tag} — marked as applied (schema already existed).`);
  }

  console.log('[baseline] Done. Run `pnpm db:migrate` now to apply anything genuinely new (e.g. 0006 onward).');
  await pool.end();
}

main().catch((err) => {
  console.error('[baseline] Failed:', err);
  process.exit(1);
});
