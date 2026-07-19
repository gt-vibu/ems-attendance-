// One-time, idempotent backfill: seeds starter role_privilege_defaults rows
// (HR, GM, manager, employee) for every pre-existing tenant that doesn't
// have any role rows yet, matching what the old hardcoded
// getDefaultPrivilegesForRole() switch used to grant — so existing tenants
// aren't suddenly blank (zero privileges for every role) the moment the
// role-permissions system ships. Safe to re-run — a tenant that already has
// at least one role row is skipped entirely (they've presumably already
// customized their roles, or this already ran).
//
// Mirrors backfill-branches.ts's pattern (dry-run flag, not wired into the
// automatic boot-time schema sync, run manually once after deploying the
// schema change and before relying on role_privilege_defaults anywhere).
//
//   pnpm --filter @company/database backfill:role-defaults -- --dry-run   # preview only
//   pnpm --filter @company/database backfill:role-defaults                # apply for real
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import pkg from 'pg';
import * as dotenv from 'dotenv';
import path from 'path';
import * as schema from '../src/schema.ts';

dotenv.config({ path: path.join(process.cwd(), '../../.env') });
const { Pool } = pkg;

const DRY_RUN = process.argv.includes('--dry-run');

// Kept in sync by hand with apps/admin/api/auth/starterRoles.ts — duplicated
// here rather than imported across the package boundary, same tradeoff
// backfill-branches.ts already makes for its own seed values.
const STARTER_ROLE_DEFAULTS: Record<string, string[]> = {
  HR: ['employee.create', 'employee.read', 'attendance.read', 'reports.view', 'breaks.manage', 'settings.edit', 'branch.manage', 'shift.manage'],
  GM: ['attendance.read', 'attendance.approve', 'reports.view', 'breaks.manage', 'settings.edit'],
  manager: ['attendance.read', 'attendance.approve', 'reports.view'],
  employee: ['reports.view'],
};

async function main() {
  const pool = new Pool({
    host: process.env.SQL_HOST || '127.0.0.1',
    port: Number(process.env.SQL_PORT) || 5432,
    user: process.env.SQL_ADMIN_USER || 'postgres',
    password: process.env.SQL_ADMIN_PASSWORD || 'password',
    database: process.env.SQL_DB_NAME || 'postgres',
    ssl: process.env.SQL_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  const db = drizzle(pool, { schema });

  console.log(`[backfill-role-defaults] Starting ${DRY_RUN ? '(DRY RUN — no writes)' : '(LIVE — will write)'} ...`);

  const tenants = await db.select().from(schema.tenants);
  let tenantsBackfilled = 0;

  for (const tenant of tenants) {
    const existingRoles = await db.select().from(schema.rolePrivilegeDefaults).where(eq(schema.rolePrivilegeDefaults.tenantId, tenant.id));
    if (existingRoles.length > 0) {
      continue; // already has role rows — idempotent skip
    }

    console.log(`[backfill-role-defaults] Tenant #${tenant.id} "${tenant.name}": will seed ${Object.keys(STARTER_ROLE_DEFAULTS).length} starter roles.`);

    if (DRY_RUN) {
      tenantsBackfilled++;
      continue;
    }

    await db.insert(schema.rolePrivilegeDefaults).values(
      Object.entries(STARTER_ROLE_DEFAULTS).map(([roleName, privileges]) => ({
        tenantId: tenant.id,
        roleName,
        privileges,
      }))
    );

    tenantsBackfilled++;
  }

  console.log(
    `[backfill-role-defaults] ${DRY_RUN ? 'Would backfill' : 'Backfilled'} ${tenantsBackfilled} tenant(s). ` +
    `${tenants.length - tenantsBackfilled} tenant(s) already had role rows and were skipped.`
  );

  await pool.end();
}

main().catch((err) => {
  console.error('[backfill-role-defaults] Failed:', err);
  process.exit(1);
});
