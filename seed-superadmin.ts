// Enforce a SINGLE super admin account with fixed credentials.
//
// After this runs, the ONLY super_admin in the database is the account named by
// SEED_SUPER_ADMIN_EMAIL / SEED_SUPER_ADMIN_PASSWORD (set in .env). It:
//   1. upserts that account as super_admin (creating it, or resetting its
//      password/role if it already exists), able to log in directly, and
//   2. deletes every OTHER super_admin so exactly one remains.
// Idempotent — safe to run as many times as you like.
//
//   pnpm seed:superadmin
//
// Credentials come from .env (which is gitignored) on purpose — so the
// plaintext password is never committed to the repository.
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, ne } from 'drizzle-orm';
import pkg from 'pg';
import * as schema from './packages/database/src/schema.ts';
import * as dotenv from 'dotenv';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

dotenv.config();
const { Pool } = pkg;

const EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL;
const PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error(
    'Set SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD in .env before running this.\n' +
    '(They are intentionally read from .env so the password is never committed.)'
  );
  process.exit(1);
}

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
  const db = drizzle(pool, { schema });

  const passwordHash = await bcrypt.hash(PASSWORD as string, 12);

  // 1) Upsert the target account as a directly-usable super_admin.
  const existing = await db.select().from(schema.users).where(eq(schema.users.email, EMAIL as string));
  if (existing.length > 0) {
    await db.update(schema.users)
      .set({
        password: passwordHash,
        role: 'super_admin',
        mustChangePassword: false,
        isKycCompleted: true,
      })
      .where(eq(schema.users.email, EMAIL as string));
    console.log(`Reset existing account to super_admin: ${EMAIL}`);
  } else {
    await db.insert(schema.users).values({
      uid: crypto.randomUUID(),
      email: EMAIL as string,
      password: passwordHash,
      name: 'Global Super Admin',
      role: 'super_admin',
      mustChangePassword: false,
      isKycCompleted: true,
    });
    console.log(`Created super_admin: ${EMAIL}`);
  }

  // 2) Remove any OTHER super_admins so this is the only one.
  const removed = await db.delete(schema.users)
    .where(and(eq(schema.users.role, 'super_admin'), ne(schema.users.email, EMAIL as string)))
    .returning();
  if (removed.length > 0) {
    console.log(`Removed ${removed.length} other super_admin account(s): ${removed.map((u: any) => u.email).join(', ')}`);
  }

  // 3) Verify the final state.
  const admins = await db.select().from(schema.users).where(eq(schema.users.role, 'super_admin'));
  console.log(`\nSuper admins now in DB: ${admins.length}`);
  admins.forEach((a: any) => console.log(`  - ${a.email} (mustChangePassword=${a.mustChangePassword})`));
  console.log(admins.length === 1 ? '\nOK: exactly one super admin, as intended.' : '\nWARNING: expected exactly one super admin.');

  await pool.end();
}

main().catch((err) => {
  console.error('seed:superadmin failed:', err);
  process.exit(1);
});
