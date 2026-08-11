import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { eq, sql } from 'drizzle-orm';
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
