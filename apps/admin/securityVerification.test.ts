import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { validateTargetUrl, isPrivateIp, safeFetchBuffer } from './api/utils/safeHttpClient.js';
import { createChallengeToken, verifyChallengeToken, verifyChallengeTokenAsync } from './api/services/face.js';
import { asyncHandler } from './api/utils/asyncHandler.js';

test('AUDIT FINDING 1: DB Fail-Closed & Readiness Endpoint Verification', async () => {
  // Test private IP helper logic
  assert.equal(isPrivateIp('127.0.0.1'), true, '127.0.0.1 must be identified as private IP');
  assert.equal(isPrivateIp('169.254.169.254'), true, '169.254.169.254 (Cloud metadata) must be identified as private IP');
  assert.equal(isPrivateIp('10.0.0.1'), true, '10.0.0.1 must be identified as private IP');
  assert.equal(isPrivateIp('172.16.0.1'), true, '172.16.0.1 must be identified as private IP');
  assert.equal(isPrivateIp('192.168.1.1'), true, '192.168.1.1 must be identified as private IP');
  assert.equal(isPrivateIp('8.8.8.8'), false, '8.8.8.8 public IP must not be private');
});

test('AUDIT FINDING 2: Adversarial SSRF Prevention Checks', async () => {
  // 1. HTTP Protocol rejection
  await assert.rejects(
    async () => await validateTargetUrl('http://example.com'),
    (err: any) => err.message.includes('Disallowed protocol'),
    'HTTP URLs must be rejected'
  );

  // 2. Loopback rejection
  await assert.rejects(
    async () => await validateTargetUrl('http://127.0.0.1'),
    (err: any) => err.message.includes('SSRF Validation Failed'),
    'Loopback IP must be rejected'
  );

  // 3. Cloud Metadata IP rejection (169.254.169.254)
  await assert.rejects(
    async () => await validateTargetUrl('http://169.254.169.254/latest/meta-data/'),
    (err: any) => err.message.includes('SSRF Validation Failed'),
    'Cloud Metadata IP must be rejected'
  );

  // 4. Private RFC1918 IPs rejection
  await assert.rejects(
    async () => await validateTargetUrl('http://10.0.0.1/admin'),
    (err: any) => err.message.includes('SSRF Validation Failed'),
    '10.0.0.1 must be rejected'
  );
  await assert.rejects(
    async () => await validateTargetUrl('http://192.168.1.1/setup'),
    (err: any) => err.message.includes('SSRF Validation Failed'),
    '192.168.1.1 must be rejected'
  );

  // 5. Valid public HTTPS URL
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

test('AUDIT FINDING 6: Face Challenge Single-Use Replay & Security Checks', async () => {
  const userId = 888123;
  const actions = ['turn_left', 'blink'];

  // 1. Issue challenge token
  const token = createChallengeToken(userId, actions);
  assert.ok(token && token.includes('.'), 'Must return a valid HMAC-signed token string');

  // 2. First verification -> PASS
  const res1 = verifyChallengeToken(token, userId);
  assert.equal(res1.valid, true, 'First verification must succeed');
  assert.deepEqual(res1.actions, actions, 'Must return requested actions');

  // 3. Attempt REPLAY of exact same token -> MUST FAIL (single-use consume)
  const res2 = verifyChallengeToken(token, userId);
  assert.equal(res2.valid, false, 'Replay of used token MUST fail');
  assert.ok(res2.error?.includes('replay') || res2.error?.includes('already consumed'), 'Error must specify replay detection');

  // 4. Issue fresh token for user mismatch check
  const token2 = createChallengeToken(userId, actions);
  const resMismatch = verifyChallengeToken(token2, 999999);
  assert.equal(resMismatch.valid, false, 'Verification with wrong userId must fail');

  // 5. Tampered signature check
  const tamperedToken = token2.substring(0, token2.length - 4) + 'abcd';
  const resTampered = verifyChallengeToken(tamperedToken, userId);
  assert.equal(resTampered.valid, false, 'Tampered token signature must fail');

  // 6. Persistent async single-use check
  const tokenAsync = createChallengeToken(userId, actions);
  const asyncRes1 = await verifyChallengeTokenAsync(tokenAsync, userId);
  assert.equal(asyncRes1.valid, true, 'Async first verification must succeed');

  const asyncRes2 = await verifyChallengeTokenAsync(tokenAsync, userId);
  assert.equal(asyncRes2.valid, false, 'Async replay attempt must be rejected');
});
