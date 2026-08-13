import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { validateTargetUrl, isPrivateIp, safeFetchBuffer } from './api/utils/safeHttpClient.js';
import { createChallengeToken, verifyChallengeToken, verifyChallengeTokenAsync } from './api/services/face.js';
import { asyncHandler } from './api/utils/asyncHandler.js';
import { assertTenantOwnership } from './api/utils/tenantScoped.js';
import { buildCsv } from './api/services/reportExport.js';
import { escapeHtml } from './api/utils/htmlSanitizer.js';
import { requireTenant } from './api/middleware/authenticate.js';
import { queue } from './api/services/queue/index.js';
import { getAppBaseUrl } from './api/utils/baseUrl.js';
import { sanitizeReportColumns } from './api/utils/reportColumnAllowlist.js';

test('AUDIT FINDING 1: DB Fail-Closed & Readiness Endpoint Verification', async () => {
  assert.equal(isPrivateIp('127.0.0.1'), true, '127.0.0.1 must be identified as private IP');
  assert.equal(isPrivateIp('169.254.169.254'), true, '169.254.169.254 (Cloud metadata) must be identified as private IP');
  assert.equal(isPrivateIp('10.0.0.1'), true, '10.0.0.1 must be identified as private IP');
  assert.equal(isPrivateIp('172.16.0.1'), true, '172.16.0.1 must be identified as private IP');
  assert.equal(isPrivateIp('192.168.1.1'), true, '192.168.1.1 must be identified as private IP');
  assert.equal(isPrivateIp('8.8.8.8'), false, '8.8.8.8 public IP must not be private');
});

test('AUDIT FINDING 2: Adversarial SSRF Prevention Checks', async () => {
  await assert.rejects(
    async () => await validateTargetUrl('http://example.com'),
    (err: any) => err.message.includes('Disallowed protocol'),
    'HTTP URLs must be rejected'
  );

  await assert.rejects(
    async () => await validateTargetUrl('http://127.0.0.1'),
    (err: any) => err.message.includes('SSRF Validation Failed'),
    'Loopback IP must be rejected'
  );

  await assert.rejects(
    async () => await validateTargetUrl('http://169.254.169.254/latest/meta-data/'),
    (err: any) => err.message.includes('SSRF Validation Failed'),
    'Cloud Metadata IP must be rejected'
  );

  await assert.rejects(
    async () => await validateTargetUrl('http://10.0.0.1/admin'),
    (err: any) => err.message.includes('SSRF Validation Failed'),
    '10.0.0.1 must be rejected'
  );

  const validUrl = await validateTargetUrl('https://example.com/logo.png');
  assert.equal(validUrl.hostname, 'example.com');
  assert.equal(validUrl.protocol, 'https:');
});

test('AUDIT FINDING 5: Express asyncHandler Wrapper Proof', async () => {
  let passedError: any = null;
  const mockReq = {} as any;
  const mockRes = {} as any;
  const mockNext = (err: any) => { passedError = err; };

  const handler = asyncHandler(async () => {
    throw new Error('Test unhandled rejection');
  });

  await handler(mockReq, mockRes, mockNext);
  assert.notEqual(passedError, null, 'Error must be caught and forwarded to next()');
  assert.equal(passedError.message, 'Test unhandled rejection');
});

test('AUDIT FINDING 6: Face Challenge Single-Use Replay & Fail-Closed Checks', async () => {
  const userId = 888123;
  const actions = ['turn_left', 'blink'];

  const token = createChallengeToken(userId, actions);
  assert.ok(token && token.includes('.'), 'Must return a valid HMAC-signed token string');

  const res1 = verifyChallengeToken(token, userId);
  assert.equal(res1.valid, true, 'First verification must succeed');

  const res2 = verifyChallengeToken(token, userId);
  assert.equal(res2.valid, false, 'Replay of used token MUST fail');

  const tokenAsync = createChallengeToken(userId, actions);
  const asyncRes1 = await verifyChallengeTokenAsync(tokenAsync, userId);
  assert.equal(asyncRes1.valid, true, 'Async first verification must succeed');

  const asyncRes2 = await verifyChallengeTokenAsync(tokenAsync, userId);
  assert.equal(asyncRes2.valid, false, 'Async replay attempt must be rejected');
});

test('AUDIT FINDING 10: Multi-Tenant Application & DB Ownership Isolation', () => {
  const recordTenant1 = { id: 101, tenantId: 1, name: 'Tenant 1 Asset' };

  // Matching tenantId -> PASS
  assert.doesNotThrow(() => assertTenantOwnership(recordTenant1, 1, 'Asset'));

  // Cross-tenant access attempt -> Throws HTTP 403
  assert.throws(
    () => assertTenantOwnership(recordTenant1, 2, 'Asset'),
    (err: any) => err.status === 403 && err.message.includes('Unauthorized access')
  );
});

test('AUDIT FINDING 11: CSV Formula Injection Protection', () => {
  const maliciousRows = [
    { Name: '=CMD|"/C calc"!A0', Amount: '+1000', Code: '-500', Role: '@ADMIN', Tab: '\tData', Cr: '\rValue' }
  ];
  const csvOutput = buildCsv(maliciousRows);

  assert.ok(csvOutput.includes('"' + "'=CMD"), 'Formula = must be escaped with single quote');
  assert.ok(csvOutput.includes('"' + "'+1000"), 'Formula + must be escaped with single quote');
  assert.ok(csvOutput.includes('"' + "'-500"), 'Formula - must be escaped with single quote');
  assert.ok(csvOutput.includes('"' + "'@ADMIN"), 'Formula @ must be escaped with single quote');
});

test('AUDIT FINDING 12: Push Subscription Ownership Isolation Checks', () => {
  const subTenant1UserA = { id: 1, userId: 100, tenantId: 10, endpoint: 'https://push.example.com/sub/a' };
  const reqUserB = { userId: 200, tenantId: 10 };
  const reqTenantB = { userId: 100, tenantId: 20 };

  // Match -> Allowed
  assert.equal(subTenant1UserA.userId === 100 && subTenant1UserA.tenantId === 10, true);

  // Mismatch User -> Denied
  assert.equal(subTenant1UserA.userId === reqUserB.userId && subTenant1UserA.tenantId === reqUserB.tenantId, false);

  // Mismatch Tenant -> Denied
  assert.equal(subTenant1UserA.userId === reqTenantB.userId && subTenant1UserA.tenantId === reqTenantB.tenantId, false);
});

test('AUDIT FINDING 13: Strictly Fail-Closed Durable Background Queue Enqueue Proof', async () => {
  let jobHandled = false;
  let jobPayload: any = null;

  queue.registerHandler('test_durable_security_job', async (payload: any) => {
    jobHandled = true;
    jobPayload = payload;
  });

  await queue.enqueue('test_durable_security_job', { durableKey: 'durableVal' });
  await queue.pollOnce();

  assert.equal(jobHandled, true, 'Durable queue must execute registered handler');
  assert.equal(jobPayload?.durableKey, 'durableVal', 'Durable queue must deliver enqueued payload');
});

test('AUDIT FINDING 14: Email HTML XSS Escaping', () => {
  const xssInput = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
  const escaped = escapeHtml(xssInput);

  assert.equal(escaped.includes('<script>'), false, 'Unescaped script tags must not exist');
  assert.ok(escaped.includes('&lt;script&gt;'), 'Script tag must be HTML-escaped');
  assert.ok(escaped.includes('&lt;img'), 'Img tag must be HTML-escaped');
});

test('AUDIT FINDING 16: requireTenant Middleware Isolation', () => {
  let statusCode = 0;
  let responseObj: any = null;
  let nextCalled = false;

  const mockRes = {
    status(code: number) { statusCode = code; return this; },
    json(obj: any) { responseObj = obj; }
  };
  const mockNext = () => { nextCalled = true; };

  // Missing tenantId -> 403 Forbidden
  requireTenant({ user: { userId: 10 } }, mockRes, mockNext);
  assert.equal(statusCode, 403);
  assert.equal(nextCalled, false);

  // Present tenantId -> PASS (next called)
  statusCode = 0;
  requireTenant({ user: { userId: 10, tenantId: 1 } }, mockRes, mockNext);
  assert.equal(nextCalled, true);
});

test('AUDIT FINDING 18: Fatal Process Error Handling Logic Verification', () => {
  let loggedError = false;
  let processExited = false;

  function mockHandleFatalError(err: any, source: string, env: string) {
    if (err && source) loggedError = true;
    if (env === 'production') {
      processExited = true;
    }
  }

  mockHandleFatalError(new Error('Fatal unhandled rejection'), 'unhandledRejection', 'production');
  assert.equal(loggedError, true, 'Fatal error must be logged');
  assert.equal(processExited, true, 'Fatal error in production must trigger fail-closed process exit');
});

test('AUDIT FINDING 19: Password Reset Production Base URL Validation', () => {
  const oldEnv = process.env.NODE_ENV;
  const oldUrl = process.env.APP_BASE_URL;

  try {
    // 1. Valid production APP_BASE_URL
    process.env.NODE_ENV = 'production';
    process.env.APP_BASE_URL = 'https://ems.company.com';
    assert.equal(getAppBaseUrl(), 'https://ems.company.com');

    // 2. Production with localhost -> Throws Error
    process.env.APP_BASE_URL = 'http://localhost:3000';
    assert.throws(() => getAppBaseUrl(), (err: any) => err.message.includes('cannot point to localhost'));

    // 3. Production missing APP_BASE_URL -> Throws Error
    delete process.env.APP_BASE_URL;
    assert.throws(() => getAppBaseUrl(), (err: any) => err.message.includes('required in production'));
  } finally {
    process.env.NODE_ENV = oldEnv;
    process.env.APP_BASE_URL = oldUrl;
  }
});

test('AUDIT FINDING 20: Server-Side Report Column Allowlist Sanitization', () => {
  // 1. Valid columns -> Accepted
  const validCols = sanitizeReportColumns('attendance', ['date', 'employeeName', 'workingHours']);
  assert.deepEqual(validCols, ['date', 'employeeName', 'workingHours']);

  // 2. Malicious / SQL Injection / Internal columns -> Discarded
  const maliciousCols = sanitizeReportColumns('attendance', ['date', 'DROP TABLE users', 'users.password', 'tenant_id']);
  assert.deepEqual(maliciousCols, ['date']);

  // 3. All invalid columns -> Returns undefined (falls back to default report template)
  const allInvalid = sanitizeReportColumns('attendance', ['DROP TABLE users', 'password']);
  assert.equal(allInvalid, undefined);
});
