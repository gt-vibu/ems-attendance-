import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, createTestTenantAndAdmin } from './harness.ts';
import { db, schema } from '../db.ts';
import { eq } from 'drizzle-orm';

// Real HTTP integration test for POST /api/tenant/attendance/action's
// concurrency guard (review.routes.ts) — same pattern as
// payrollLockConcurrency.integration.test.ts, see harness.ts for the setup.

let appHandle: Awaited<ReturnType<typeof startTestApp>>;

before(async () => { appHandle = await startTestApp(); });
after(async () => { await appHandle.close(); });

describe('POST /api/tenant/attendance/action — concurrency guard', () => {
  test('exactly one of two concurrent approve requests succeeds on the same pending log', async () => {
    const ctx = await createTestTenantAndAdmin();
    try {
      const employee = await ctx.createEmployee();
      const [log] = await db.insert(schema.attendanceLogs).values({
        tenantId: ctx.tenant.id,
        userId: employee.id,
        status: 'pending',
        type: 'check_in',
      }).returning();

      const fire = () => fetch(`${appHandle.baseUrl}/api/tenant/attendance/action`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ logId: log.id, action: 'approve' }),
      });

      const [r1, r2] = await Promise.all([fire(), fire()]);
      const successes = [r1.status, r2.status].filter((s) => s === 200).length;
      const rejections = [r1.status, r2.status].filter((s) => s === 400).length;

      assert.equal(successes, 1, `expected exactly one 200, got statuses ${r1.status},${r2.status}`);
      assert.equal(rejections, 1, `expected exactly one 400 ('already resolved'), got statuses ${r1.status},${r2.status}`);

      const [reloaded] = await db.select().from(schema.attendanceLogs).where(eq(schema.attendanceLogs.id, log.id));
      assert.equal(reloaded.status, 'approved');
    } finally {
      await ctx.cleanup();
    }
  });

  test('a non-pending log is rejected outright (no double-approval path via a stale request)', async () => {
    const ctx = await createTestTenantAndAdmin();
    try {
      const employee = await ctx.createEmployee();
      const [log] = await db.insert(schema.attendanceLogs).values({
        tenantId: ctx.tenant.id,
        userId: employee.id,
        status: 'approved', // already resolved
        type: 'check_in',
      }).returning();

      const res = await fetch(`${appHandle.baseUrl}/api/tenant/attendance/action`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ logId: log.id, action: 'approve' }),
      });
      assert.equal(res.status, 400);
    } finally {
      await ctx.cleanup();
    }
  });
});
