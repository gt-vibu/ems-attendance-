import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { eq, getTableColumns, getTableName, is, sql, Table } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, schema, withBootSyncLock } from '../../db';
import { logger } from '../../logger';
import { hashPassword } from '../../password.js';

// Public entry point — held for the WHOLE sync under a blocking Postgres
// advisory lock (db.ts's withBootSyncLock) so N replicas starting at once on
// a rolling/autoscaled deploy don't race each other's concurrent migrations.
export async function verifyAndSyncDatabase(): Promise<void> {
  await withBootSyncLock(runSchemaSync);
}

function resultRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (!result || typeof result !== 'object') return [];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/**
 * Production predates the versioned Drizzle migration journal. Those
 * databases were built by the former idempotent boot synchronizer, so their
 * tables already exist even though Drizzle believes migration 0000 is still
 * pending. Adopt that legacy schema only after proving that every table and
 * column required by the current runtime is present. This is deliberately
 * fail-closed: a partial or genuinely stale schema is never marked current.
 */
async function adoptCompatibleLegacySchema(migrationsFolder: string): Promise<void> {
  const journalProbe = await db.execute(
    sql`SELECT to_regclass('drizzle.__drizzle_migrations') AS relation_name`,
  );
  const journalRows = resultRows(journalProbe);
  const journalRelation = journalRows[0]?.relation_name;
  if (journalRelation) {
    const journalCount = resultRows(
      await db.execute(sql`SELECT COUNT(*)::integer AS count FROM drizzle.__drizzle_migrations`),
    )[0]?.count;
    if (Number(journalCount) > 0) return;
  }

  const legacyProbe = await db.execute(
    sql`SELECT to_regclass('public.attendance_alerts') AS relation_name`,
  );
  const legacyRows = resultRows(legacyProbe);
  const legacyRelation = legacyRows[0]?.relation_name;
  if (!legacyRelation) return;

  const actualColumnRows = resultRows(
    await db.execute(sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
    `),
  );
  const actualColumns = new Set(
    actualColumnRows.map((row) => `${String(row.table_name)}.${String(row.column_name)}`),
  );
  const expectedTables = Object.values(schema).filter((value) => is(value, Table)) as unknown as Table[];
  const expectedColumns = expectedTables.flatMap((table) =>
    Object.values(getTableColumns(table)).map(
      (column) => `${getTableName(table)}.${column.name}`,
    ),
  );
  const missingColumns = expectedColumns.filter((column) => !actualColumns.has(column));
  if (missingColumns.length > 0) {
    const sample = missingColumns.slice(0, 12).join(', ');
    throw new Error(
      `Legacy database has no Drizzle migration history and is missing ${missingColumns.length} required schema columns (${sample}). Refusing to mark an incomplete schema as migrated.`,
    );
  }

  const migrations = readMigrationFiles({ migrationsFolder });
  await db.transaction(async (tx) => {
    await tx.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);
    const journalCount = resultRows(
      await tx.execute(sql`SELECT COUNT(*)::integer AS count FROM drizzle.__drizzle_migrations`),
    )[0]?.count;
    if (Number(journalCount) > 0) return;

    for (const migration of migrations) {
      await tx.execute(sql`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES (${migration.hash}, ${migration.folderMillis})
      `);
    }
  });
  logger.warn('[migrations] Adopted compatible legacy schema into the Drizzle journal', {
    migrations: migrations.length,
    tables: expectedTables.length,
    columns: expectedColumns.length,
  });
}

async function runSchemaSync() {
  try {
    console.log('Running versioned transactional database migrations...');
    const candidates = [
      path.resolve(process.cwd(), 'packages/database/drizzle'),
      path.resolve(process.cwd(), 'drizzle'),
      path.resolve(process.cwd(), '../../packages/database/drizzle'),
    ];
    let migrationsFolder = candidates.find((p) => fs.existsSync(p));
    if (!migrationsFolder) {
      migrationsFolder = candidates[0];
    }
    await adoptCompatibleLegacySchema(migrationsFolder);
    await migrate(db, { migrationsFolder });
    console.log('[migrations] Versioned transactional database migrations applied successfully.');

    try {
      const tenantsNeedingDigestDefaults = await db.execute(sql`
        SELECT t.id FROM tenants t
        WHERE NOT EXISTS (SELECT 1 FROM notification_digest_subscriptions s WHERE s.tenant_id = t.id)
      `);
      const rows: any[] = (tenantsNeedingDigestDefaults as any).rows || tenantsNeedingDigestDefaults;
      for (const row of rows) {
        const tid = row.id;
        await db.execute(sql`
          INSERT INTO notification_digest_subscriptions (tenant_id, digest_type, frequency, time_of_day, recipients)
          VALUES
            (${tid}, 'manager_daily', 'daily', '09:00', '[{"type":"role","role":"manager"}]'),
            (${tid}, 'hr_daily', 'daily', '09:15', '[{"type":"role","role":"HR"}]'),
            (${tid}, 'executive_daily', 'daily', '19:00', '[{"type":"role","role":"tenant_admin"}]')
        `);
      }
    } catch (e) {
      logger.warn('boot schema-sync: notification defaults statement failed', { error: (e as any)?.message });
    }
  } catch (err) {
    console.error('Failed to apply database migrations:', err);
    throw err;
  }
}

// Seed the sole Super Admin account. Never hardcode real credentials here —
// use SEED_SUPER_ADMIN_EMAIL/SEED_SUPER_ADMIN_PASSWORD from .env, or fall
// back to a randomly generated one-time password that's printed once to the
// console and must be changed at first login.
export async function seedSuperAdmin() {
  try {
    const email = process.env.SEED_SUPER_ADMIN_EMAIL || 'superadmin@example.com';
    const providedPassword = process.env.SEED_SUPER_ADMIN_PASSWORD;

    const existing = await db.select().from(schema.users).where(eq(schema.users.role, 'super_admin'));
    if (existing.length === 0) {
      const plainPassword = providedPassword || crypto.randomBytes(9).toString('base64url');

      console.log('Seeding Super Admin account...');
      await db.insert(schema.users).values({
        uid: 'super-admin-uid-00000000000000000',
        email,
        password: await hashPassword(plainPassword),
        name: 'Global Super Admin',
        role: 'super_admin',
        mustChangePassword: !providedPassword
      });

      if (!providedPassword) {
        console.log('\n==================================================');
        console.log('  Super Admin seeded with a one-time generated password:');
        console.log(`  Email:    ${email}`);
        console.log(`  Password: ${plainPassword}`);
        console.log('  (shown once — you will be required to change it on first login)');
        console.log('  Set SEED_SUPER_ADMIN_EMAIL / SEED_SUPER_ADMIN_PASSWORD in .env to control this.');
        console.log('==================================================\n');
      } else {
        console.log(`Super Admin seeded successfully: ${email}`);
      }
    } else if (providedPassword) {
      // Sync credentials to match .env if explicitly provided
      const adminUser = existing[0];
      const newHash = await hashPassword(providedPassword);
      await db.update(schema.users)
        .set({
          email,
          password: newHash,
          mustChangePassword: false,
        })
        .where(eq(schema.users.id, adminUser.id));
      console.log(`Super Admin credentials synced with .env: ${email}`);
    }
  } catch (err) {
    console.error('Failed to seed Super Admin account:', err);
  }
}
