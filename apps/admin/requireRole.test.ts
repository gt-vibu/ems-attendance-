import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { requireRole } from './api/middleware/authenticate.ts';

// requireRole() replaced 14 hand-copied 'if (req.user.role !== "super_admin")'
// checks in super.routes.ts with a single structural middleware (see
// authenticate.ts's doc comment) — this is a pure function over req.user.role,
// no DB/network required, so it's directly testable without the
// integration-test infrastructure this environment lacks (see
// payrollCalculations.test.ts's note on that).
function mockReqRes(role: string | undefined) {
  const req = { user: role === undefined ? undefined : { role } };
  let statusCode: number | null = null;
  let jsonBody: any = null;
  const res = {
    status(code: number) { statusCode = code; return this; },
    json(body: any) { jsonBody = body; return this; },
  };
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  return { req, res, next, getResult: () => ({ statusCode, jsonBody, nextCalled }) };
}

describe('requireRole', () => {
  test('allows a request whose role is in the allow-list', () => {
    const { req, res, next, getResult } = mockReqRes('super_admin');
    requireRole('super_admin')(req, res, next);
    const { nextCalled, statusCode } = getResult();
    assert.equal(nextCalled, true);
    assert.equal(statusCode, null);
  });

  test('rejects a request whose role is not in the allow-list with 403', () => {
    const { req, res, next, getResult } = mockReqRes('tenant_admin');
    requireRole('super_admin')(req, res, next);
    const { nextCalled, statusCode, jsonBody } = getResult();
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
    assert.equal(jsonBody.error, 'Access denied');
  });

  test('rejects when req.user is missing entirely (unauthenticated slipping through)', () => {
    const { req, res, next, getResult } = mockReqRes(undefined);
    requireRole('super_admin')(req, res, next);
    const { nextCalled, statusCode } = getResult();
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
  });

  test('supports multiple allowed roles', () => {
    const admin = mockReqRes('tenant_admin');
    requireRole('tenant_admin', 'super_admin')(admin.req, admin.res, admin.next);
    assert.equal(admin.getResult().nextCalled, true);

    const employee = mockReqRes('employee');
    requireRole('tenant_admin', 'super_admin')(employee.req, employee.res, employee.next);
    assert.equal(employee.getResult().nextCalled, false);
    assert.equal(employee.getResult().statusCode, 403);
  });
});
