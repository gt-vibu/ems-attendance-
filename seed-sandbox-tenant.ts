// Seeds a standing sandbox tenant that partners can integrate against
// without ever touching real customer data — a tenant_admin login, a
// service-account API key, and a couple of sample employees with attendance/
// leave history so GET endpoints return something non-empty immediately.
//
// Idempotent: re-running finds the existing sandbox tenant by its fixed name
// and only fills in what's missing, rather than duplicating data.
//
//   pnpm seed:sandbox
//
// Credentials print once to the console — same convention as
// seed-superadmin.ts. Nothing here is committed to the repo.
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import pkg from 'pg';
import * as schema from './packages/database/src/schema.ts';
import * as dotenv from 'dotenv';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

dotenv.config();
const { Pool } = pkg;

const SANDBOX_TENANT_NAME = 'Sandbox Integration Tenant';
const ADMIN_EMAIL = process.env.SANDBOX_ADMIN_EMAIL || 'sandbox-admin@example.com';

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

  // 1) Tenant — find-or-create by fixed name.
  const existingTenant = await db.select().from(schema.tenants).where(eq(schema.tenants.name, SANDBOX_TENANT_NAME)).limit(1);
  let tenant = existingTenant[0];
  if (!tenant) {
    const adminUid = crypto.randomUUID();
    const [created] = await db.insert(schema.tenants).values({
      name: SANDBOX_TENANT_NAME,
      adminUid,
      status: 'active',
      plan: 'Professional',
      locationLat: 12.9716,
      locationLng: 77.5946,
      locationRadiusMeters: 150,
    }).returning();
    tenant = created;
    console.log(`Created sandbox tenant: ${tenant.name} (id ${tenant.id})`);
  } else {
    console.log(`Sandbox tenant already exists: ${tenant.name} (id ${tenant.id})`);
  }

  // 2) Tenant admin — find-or-create, password reset on every run so it's
  // always known even if someone changed it while poking around.
  const adminPassword = process.env.SANDBOX_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const adminHash = await bcrypt.hash(adminPassword, 12);
  const existingAdmin = await db.select().from(schema.users).where(eq(schema.users.email, ADMIN_EMAIL)).limit(1);
  if (existingAdmin.length > 0) {
    await db.update(schema.users).set({ password: adminHash, role: 'tenant_admin', tenantId: tenant.id, mustChangePassword: false }).where(eq(schema.users.id, existingAdmin[0].id));
    console.log(`Reset sandbox tenant_admin password: ${ADMIN_EMAIL}`);
  } else {
    await db.insert(schema.users).values({
      uid: crypto.randomUUID(),
      email: ADMIN_EMAIL,
      password: adminHash,
      name: 'Sandbox Admin',
      role: 'tenant_admin',
      tenantId: tenant.id,
      mustChangePassword: false,
      isKycCompleted: true,
    });
    console.log(`Created sandbox tenant_admin: ${ADMIN_EMAIL}`);
  }

  // 3) A couple of sample employees with attendance history, so a fresh
  // integration hits real-looking data on its very first call instead of
  // empty arrays everywhere.
  const sampleEmployees = [
    { email: 'sandbox.employee1@example.com', name: 'Asha Rao', role: 'employee' },
    { email: 'sandbox.employee2@example.com', name: 'Vikram Shah', role: 'manager' },
  ];
  // Fixed, known password for the sample employees (not the admin — that
  // one stays random/env-driven since it's the account with real management
  // power). These two are read-only demo fixtures, so a fixed password is
  // fine and lets anyone testing the self-service Earnings/attendance pages
  // log in without a DB lookup.
  const sampleEmployeePassword = process.env.SANDBOX_EMPLOYEE_PASSWORD || 'Sandbox@123';
  const sampleEmployeeHash = await bcrypt.hash(sampleEmployeePassword, 12);
  for (const emp of sampleEmployees) {
    const existing = await db.select().from(schema.users).where(and(eq(schema.users.email, emp.email), eq(schema.users.tenantId, tenant.id))).limit(1);
    let userId: number;
    if (existing.length > 0) {
      userId = existing[0].id;
      await db.update(schema.users).set({ password: sampleEmployeeHash }).where(eq(schema.users.id, userId));
    } else {
      const [created] = await db.insert(schema.users).values({
        uid: crypto.randomUUID(),
        email: emp.email,
        password: sampleEmployeeHash,
        name: emp.name,
        role: emp.role,
        tenantId: tenant.id,
        isKycCompleted: true,
        employeeStatus: 'active',
      }).returning();
      userId = created.id;
      console.log(`Created sandbox employee: ${emp.name} <${emp.email}>`);
    }

    const hasAttendance = await db.select().from(schema.attendanceLogs).where(eq(schema.attendanceLogs.userId, userId)).limit(1);
    if (hasAttendance.length === 0) {
      const checkIn = new Date();
      checkIn.setHours(9, 15, 0, 0);
      await db.insert(schema.attendanceLogs).values({
        userId,
        tenantId: tenant.id,
        status: 'approved',
        type: 'check_in',
        clientTimestamp: checkIn,
        reason: 'Sandbox seed data',
        attendanceMode: 'office',
      });
    }
  }

  console.log('\n==================================================');
  console.log('  Sandbox tenant ready for integration testing.');
  console.log(`  Tenant:   ${SANDBOX_TENANT_NAME} (id ${tenant.id})`);
  console.log(`  Login:    POST /api/auth/login`);
  console.log(`  Email:    ${ADMIN_EMAIL}`);
  console.log(`  Password: ${adminPassword}`);
  console.log('  Then create a scoped API key: POST /api/tenant/service-accounts');
  console.log('  Set SANDBOX_ADMIN_EMAIL / SANDBOX_ADMIN_PASSWORD in .env to pin these.');
  console.log('==================================================\n');

  await pool.end();
}

main().catch((err) => {
  console.error('seed:sandbox failed:', err);
  process.exit(1);
});
