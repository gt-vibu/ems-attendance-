// One-time, idempotent backfill: gives every pre-existing tenant a "Main
// Branch" (+ a default "General Shift") seeded from that tenant's own
// legacy policy columns, then assigns every existing user and every
// historical attendance_logs row to it. Safe to re-run — a tenant that
// already has a branch is skipped entirely.
//
// This is bulk data mutation across every tenant's users and full
// attendance history, so it is deliberately NOT wired into the app's
// automatic boot-time schema sync (verifyAndSyncDatabase). Run it once,
// manually, after the schema changes (branches/shifts tables, users.branchId/
// shiftId, attendance_logs.branchId, tenants.kycEnabled) have been deployed
// and BEFORE deploying the attendance/QR route changes that assume every
// active user already has a branchId.
//
//   pnpm --filter @company/database backfill:branches -- --dry-run   # preview only
//   pnpm --filter @company/database backfill:branches                # apply for real
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, and, isNull } from 'drizzle-orm';
import pkg from 'pg';
import * as dotenv from 'dotenv';
import path from 'path';
import * as schema from '../src/schema.ts';

dotenv.config({ path: path.join(process.cwd(), '../../.env') });
const { Pool } = pkg;

const DRY_RUN = process.argv.includes('--dry-run');

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

  console.log(`[backfill-branches] Starting ${DRY_RUN ? '(DRY RUN — no writes)' : '(LIVE — will write)'} ...`);

  const tenants = await db.select().from(schema.tenants);
  let tenantsBackfilled = 0;
  let usersBackfilled = 0;
  let logsBackfilled = 0;

  for (const tenant of tenants) {
    const existingBranches = await db.select().from(schema.branches).where(eq(schema.branches.tenantId, tenant.id));
    if (existingBranches.length > 0) {
      continue; // already has at least one branch — idempotent skip
    }

    const usersNeedingBackfill = await db.select().from(schema.users)
      .where(and(eq(schema.users.tenantId, tenant.id), isNull(schema.users.branchId)));
    const logsNeedingBackfill = await db.select().from(schema.attendanceLogs)
      .where(and(eq(schema.attendanceLogs.tenantId, tenant.id), isNull(schema.attendanceLogs.branchId)));

    console.log(
      `[backfill-branches] Tenant #${tenant.id} "${tenant.name}": ` +
      `will create Main Branch + General Shift, backfill ${usersNeedingBackfill.length} users, ${logsNeedingBackfill.length} attendance logs.`
    );

    if (DRY_RUN) {
      tenantsBackfilled++;
      usersBackfilled += usersNeedingBackfill.length;
      logsBackfilled += logsNeedingBackfill.length;
      continue;
    }

    const [mainBranch] = await db.insert(schema.branches).values({
      tenantId: tenant.id,
      name: 'Main Branch',
      isMainBranch: true,
      locationLat: tenant.locationLat,
      locationLng: tenant.locationLng,
      locationRadiusMeters: tenant.locationRadiusMeters ?? 100,
      shiftStart: tenant.shiftStart ?? '09:00',
      shiftEnd: tenant.shiftEnd ?? '18:00',
      gracePeriodMins: tenant.gracePeriodMins ?? 15,
      halfDayMins: tenant.halfDayMins ?? 240,
      weekendConfig: tenant.weekendConfig as any,
      dailyBreakBudgetMins: tenant.dailyBreakBudgetMins ?? 60,
      minAttendancePercent: tenant.minAttendancePercent ?? 75,
      wifiSsid: tenant.wifiSsid,
      officeIp: tenant.officeIp,
      wifiCheckEnabled: tenant.wifiCheckEnabled ?? false,
      qrEnabled: tenant.qrEnabled ?? false,
      qrRotationSeconds: tenant.qrRotationSeconds ?? 30,
      qrRequireGps: tenant.qrRequireGps ?? true,
      qrRequireWifi: tenant.qrRequireWifi ?? false,
      qrRequireFace: tenant.qrRequireFace ?? true,
      qrGeofenceRadiusMeters: tenant.qrGeofenceRadiusMeters,
      qrRequireDeviceTrust: tenant.qrRequireDeviceTrust ?? false,
    }).returning();

    const [defaultShift] = await db.insert(schema.shifts).values({
      tenantId: tenant.id,
      branchId: mainBranch.id,
      name: 'General Shift',
      checkInTime: tenant.shiftStart ?? '09:00',
      checkOutTime: tenant.shiftEnd ?? '18:00',
      isDefault: true,
    }).returning();

    await db.update(schema.users)
      .set({ branchId: mainBranch.id, shiftId: defaultShift.id })
      .where(and(eq(schema.users.tenantId, tenant.id), isNull(schema.users.branchId)));

    await db.update(schema.attendanceLogs)
      .set({ branchId: mainBranch.id })
      .where(and(eq(schema.attendanceLogs.tenantId, tenant.id), isNull(schema.attendanceLogs.branchId)));

    tenantsBackfilled++;
    usersBackfilled += usersNeedingBackfill.length;
    logsBackfilled += logsNeedingBackfill.length;
  }

  console.log(
    `[backfill-branches] ${DRY_RUN ? 'Would backfill' : 'Backfilled'} ${tenantsBackfilled} tenant(s), ` +
    `${usersBackfilled} user(s), ${logsBackfilled} attendance log(s). ` +
    `${tenants.length - tenantsBackfilled} tenant(s) already had a branch and were skipped.`
  );

  await pool.end();
}

main().catch((err) => {
  console.error('[backfill-branches] Failed:', err);
  process.exit(1);
});
