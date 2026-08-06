import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, createTestTenantAndAdmin } from './harness.ts';
import { db, schema } from '../db.ts';
import { eq } from 'drizzle-orm';

// Real HTTP integration test for the freeze-re-check-at-approval-time fix
// in POST /api/tenant/corrections/action (review.routes.ts): a correction
// submitted before its month was frozen must NOT be silently approvable
// after the freeze — this is the exact bug the fix closed.

let appHandle: Awaited<ReturnType<typeof startTestApp>>;

before(async () => { appHandle = await startTestApp(); });
after(async () => { await appHandle.close(); });

describe('POST /api/tenant/corrections/action — freeze re-checked at approval time', () => {
  test('approving a correction whose month was frozen AFTER it was requested is rejected', async () => {
    const ctx = await createTestTenantAndAdmin();
    try {
      const employee = await ctx.createEmployee();
      // Deliberately NOT ctx.admin/ctx.token: tenant_admin bypasses every
      // privilege check unconditionally (rbac.ts), including
      // 'attendance.override_without_approval', which would make this test
      // pass for the wrong reason (admin override, not "freeze wasn't
      // checked"). A narrowly-privileged approver actually exercises the
      // freeze-guard branch.
      const approver = await ctx.createApprover(['attendance.approve.corrections']);
      const [correction] = await db.insert(schema.attendanceCorrections).values({
        tenantId: ctx.tenant.id,
        userId: employee.id,
        requestType: 'missed_checkin',
        requestedDate: '2026-02-10',
        reason: 'integration test fixture',
        status: 'pending',
      }).returning();

      // Freeze the period AFTER the correction was already requested —
      // simulating the exact race the fix targets.
      await db.insert(schema.attendanceFreezePeriods).values({
        tenantId: ctx.tenant.id,
        year: 2026,
        month: 2,
      });

      const res = await fetch(`${appHandle.baseUrl}/api/tenant/corrections/action`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${approver.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ correctionId: correction.id, action: 'approve' }),
      });
      const body = await res.json();

      assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(body)}`);
      assert.match(body.error, /frozen/i);

      const [reloaded] = await db.select().from(schema.attendanceCorrections).where(eq(schema.attendanceCorrections.id, correction.id));
      assert.equal(reloaded.status, 'pending', 'a blocked approval must leave the correction pending, not silently mark it resolved');
    } finally {
      await ctx.cleanup();
    }
  });

  test('rejecting (not approving) a frozen-period correction is still allowed — only approve mutates attendance data', async () => {
    const ctx = await createTestTenantAndAdmin();
    try {
      const employee = await ctx.createEmployee();
      const approver = await ctx.createApprover(['attendance.approve.corrections']);
      const [correction] = await db.insert(schema.attendanceCorrections).values({
        tenantId: ctx.tenant.id,
        userId: employee.id,
        requestType: 'missed_checkin',
        requestedDate: '2026-03-05',
        reason: 'integration test fixture',
        status: 'pending',
      }).returning();
      await db.insert(schema.attendanceFreezePeriods).values({ tenantId: ctx.tenant.id, year: 2026, month: 3 });

      const res = await fetch(`${appHandle.baseUrl}/api/tenant/corrections/action`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${approver.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ correctionId: correction.id, action: 'reject' }),
      });
      assert.equal(res.status, 200, `expected reject to succeed even in a frozen period: ${JSON.stringify(await res.json().catch(() => null))}`);

      const [reloaded] = await db.select().from(schema.attendanceCorrections).where(eq(schema.attendanceCorrections.id, correction.id));
      assert.equal(reloaded.status, 'rejected');
    } finally {
      await ctx.cleanup();
    }
  });
});
