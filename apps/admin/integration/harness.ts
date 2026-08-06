// Lightweight in-process integration test harness — no supertest/jest
// dependency added, just Node's built-in fetch against a real Express app
// (api/routes/index.ts's registerRoutes(), the same router registration
// server.ts itself uses) bound to an ephemeral port, talking to whatever
// Postgres this process's .env points at. This is deliberately NOT part of
// `npm test` (which must run without a live DB, e.g. in CI without a
// Postgres service) — see the separate `test:integration` script and its
// own doc comment in package.json.
import express from 'express';
import { registerRoutes } from '../api/routes';
import { signToken } from '../jwt';
import { db, schema, detectPostgres } from '../db';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

export async function startTestApp() {
  const hasPostgres = await detectPostgres();
  if (!hasPostgres) {
    throw new Error('Integration tests require a live Postgres connection (see .env) — got the JSON fallback instead.');
  }
  const app = express();
  app.use(express.json());
  registerRoutes(app);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// Creates a disposable tenant + tenant_admin user, returns a bearer token
// (minted directly via signToken — no sid, so authenticate.ts's session-
// revocation check is skipped, same as any short-lived special-purpose
// token in this codebase) and a cleanup() that deletes everything created.
export async function createTestTenantAndAdmin() {
  const suffix = crypto.randomBytes(4).toString('hex');
  const [tenant] = await db.insert(schema.tenants).values({
    name: `__integration_test_${suffix}__`,
    adminUid: crypto.randomUUID(),
    featuresAllowed: ['unified_notifications', 'payroll_lock_adjustments', 'payroll_attendance_driven', 'attendance_freeze'],
  }).returning();

  const [admin] = await db.insert(schema.users).values({
    uid: crypto.randomUUID(),
    email: `__integration_test_admin_${suffix}__@example.test`,
    password: 'not-used-in-these-tests',
    name: 'Integration Test Admin',
    role: 'tenant_admin',
    tenantId: tenant.id,
  }).returning();

  const token = signToken({ userId: admin.id, tenantId: tenant.id, role: 'tenant_admin', name: admin.name, email: admin.email });

  const createdUserIds: number[] = [admin.id];

  async function createEmployee() {
    const empSuffix = crypto.randomBytes(4).toString('hex');
    const [employee] = await db.insert(schema.users).values({
      uid: crypto.randomUUID(),
      email: `__integration_test_emp_${empSuffix}__@example.test`,
      password: 'not-used-in-these-tests',
      name: 'Integration Test Employee',
      role: 'employee',
      tenantId: tenant.id,
    }).returning();
    createdUserIds.push(employee.id);
    return employee;
  }

  // hasPrivilege() gives tenant_admin/super_admin every privilege
  // unconditionally (see rbac.ts) — tests that need to exercise a SPECIFIC
  // privilege gate (e.g. checking that someone WITHOUT
  // 'attendance.override_without_approval' is correctly blocked) need a
  // non-admin user with an explicit, narrow privileges array instead of
  // the ctx.token/ctx.admin used for most tests.
  async function createApprover(privileges: string[]) {
    const suffix2 = crypto.randomBytes(4).toString('hex');
    const [approver] = await db.insert(schema.users).values({
      uid: crypto.randomUUID(),
      email: `__integration_test_approver_${suffix2}__@example.test`,
      password: 'not-used-in-these-tests',
      name: 'Integration Test Approver',
      role: 'manager',
      tenantId: tenant.id,
      privileges,
    }).returning();
    createdUserIds.push(approver.id);
    const approverToken = signToken({ userId: approver.id, tenantId: tenant.id, role: 'manager', name: approver.name, email: approver.email });
    return { user: approver, token: approverToken };
  }

  // Always attempts every table, regardless of which flows a given test
  // actually exercised — harmless no-op deletes for the ones that are
  // empty, and much simpler than tracking exactly which rows each test
  // created. Every table here is scoped to this one disposable tenant, so
  // there's no risk of touching any other tenant's data.
  async function cleanup() {
    // logToAuditLedger() writes a row for nearly every mutating action these
    // tests exercise; delete those first (they're disposable test-only
    // entries, unlike the app's own tenant-delete path which detaches
    // rather than deletes to preserve a real hash chain).
    await db.delete(schema.auditLedger).where(eq(schema.auditLedger.tenantId, tenant.id));
    await db.delete(schema.backgroundJobs).where(eq(schema.backgroundJobs.tenantId, tenant.id));
    for (const id of createdUserIds) {
      await db.delete(schema.notifications).where(eq(schema.notifications.userId, id));
    }
    await db.delete(schema.attendanceAlerts).where(eq(schema.attendanceAlerts.tenantId, tenant.id));
    await db.delete(schema.attendanceCorrections).where(eq(schema.attendanceCorrections.tenantId, tenant.id));
    await db.delete(schema.leaveRequests).where(eq(schema.leaveRequests.tenantId, tenant.id));
    await db.delete(schema.attendanceLogs).where(eq(schema.attendanceLogs.tenantId, tenant.id));
    await db.delete(schema.payrollAdjustments).where(eq(schema.payrollAdjustments.tenantId, tenant.id));
    await db.delete(schema.payrollRuns).where(eq(schema.payrollRuns.tenantId, tenant.id));
    await db.delete(schema.employeeCompensationProfiles).where(eq(schema.employeeCompensationProfiles.tenantId, tenant.id));
    await db.delete(schema.attendanceFreezePeriods).where(eq(schema.attendanceFreezePeriods.tenantId, tenant.id));
    // getOrCreatePayrollSettings() (called by the payroll lock endpoint,
    // among others) lazily creates a payroll_settings row the first time
    // it's needed — clean that up too.
    await db.delete(schema.payrollSettings).where(eq(schema.payrollSettings.tenantId, tenant.id));
    for (const id of createdUserIds) {
      await db.delete(schema.users).where(eq(schema.users.id, id));
    }
    await db.delete(schema.tenants).where(eq(schema.tenants.id, tenant.id));
  }

  return { tenant, admin, token, createEmployee, createApprover, cleanup };
}
