import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, createTestTenantAndAdmin } from './harness.ts';
import { db, schema } from '../db.ts';
import { eq } from 'drizzle-orm';

// Real HTTP integration test (not a unit test) exercising the exact
// concurrency-guard fix made to POST /api/tenant/payroll/:runId/lock —
// fires two genuinely concurrent requests at a real running Express app
// against a real Postgres connection and asserts only one succeeds.
// Requires a live Postgres (see harness.ts / package.json's
// test:integration script) — this is deliberately NOT part of the default
// `npm test`, which must run without one.

let appHandle: Awaited<ReturnType<typeof startTestApp>>;

before(async () => {
  appHandle = await startTestApp();
});

after(async () => {
  await appHandle.close();
});

describe('POST /api/tenant/payroll/:runId/lock — concurrency guard', () => {
  test('exactly one of two concurrent lock requests succeeds; the run ends up locked, not double-processed', async () => {
    const ctx = await createTestTenantAndAdmin();
    try {
      const [run] = await db.insert(schema.payrollRuns).values({
        tenantId: ctx.tenant.id,
        userId: ctx.admin.id,
        year: 2026,
        month: 1,
        workingDays: 26,
        netPay: 50000,
        status: 'generated',
      }).returning();

      const fire = () => fetch(`${appHandle.baseUrl}/api/tenant/payroll/${run.id}/lock`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctx.token}` },
      });

      const [r1, r2] = await Promise.all([fire(), fire()]);
      const [b1, b2] = await Promise.all([r1.json(), r2.json()]);

      const successes = [r1.status, r2.status].filter((s) => s === 200).length;
      const alreadyLocked = [b1, b2].filter((b) => typeof b.error === 'string' && b.error.includes('already locked')).length;

      assert.equal(successes, 1, `expected exactly one 200, got statuses ${r1.status},${r2.status}`);
      assert.equal(alreadyLocked, 1, 'expected exactly one "already locked" rejection');

      const [reloaded] = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.id, run.id));
      assert.equal(reloaded.status, 'locked', 'the run should end up locked exactly once, not left generated or double-processed');
    } finally {
      await ctx.cleanup();
    }
  });
});
