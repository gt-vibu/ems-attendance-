import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { validateActionAssertion } from './federationAuth';

const secret = 'test-federation-action-assertion-secret-0123456789';

function signedRequest(overrides: Partial<{
  method: string;
  path: string;
  body: Record<string, unknown>;
  audience: string;
  iat: number;
  exp: number;
  nonce: string;
  tenant?: string;
  signature?: string;
}> = {}) {
  const request = {
    method: overrides.method ?? 'POST',
    originalUrl: overrides.path ?? '/v1/federation/leave/requests/leave-1/decision',
    body: overrides.body ?? { externalEmployeeId: 'employee-1', decision: 'approved' },
    header(name: string) {
      if (name === 'Idempotency-Key') return overrides.nonce ?? 'nonce-1234567890123456';
      if (name === 'X-Federation-Action-Assertion') return assertion;
      return undefined;
    },
  };
  const now = Math.floor(Date.now() / 1000);
  const nonce = overrides.nonce ?? 'nonce-1234567890123456';
  const payload = {
    aud: overrides.audience ?? 'smartteams-federation',
    iat: overrides.iat ?? now,
    exp: overrides.exp ?? now + 30,
    nonce,
    method: overrides.method ?? 'POST',
    path: overrides.path ?? '/v1/federation/leave/requests/leave-1/decision',
    action: `${overrides.method ?? 'POST'}:${overrides.path ?? '/v1/federation/leave/requests/leave-1/decision'}`,
    actor: undefined,
    tenant: overrides.tenant,
    outlet: undefined,
    target: 'employee-1',
    bodyHash: crypto.createHash('sha256').update(JSON.stringify(request.body)).digest('base64url'),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = overrides.signature ?? crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  const assertion = `${encoded}.${signature}`;
  process.env.FEDERATION_ACTION_ASSERTION_SECRET = secret;
  return { request, assertion };
}

test('accepts a fresh assertion bound to method, path, body, and nonce', () => {
  const { request } = signedRequest();
  assert.equal(validateActionAssertion(request, 10), null);
});

test('rejects missing, malformed, and invalid signatures', () => {
  const { request } = signedRequest();
  const missing = { ...request, header: (name: string) => name === 'Idempotency-Key' ? 'nonce-1234567890123456' : undefined };
  assert.match(validateActionAssertion(missing, 10) ?? '', /required/);
  const malformed = { ...request, header: (name: string) => name === 'Idempotency-Key' ? 'nonce-1234567890123456' : 'bad' };
  assert.match(validateActionAssertion(malformed, 10) ?? '', /malformed/);
  const invalid = { ...request, header: (name: string) => name === 'Idempotency-Key' ? 'nonce-1234567890123456' : `${request.header('X-Federation-Action-Assertion')!.slice(0, -1)}x` };
  assert.match(validateActionAssertion(invalid, 10) ?? '', /signature/);
});

test('rejects expiry, audience, nonce, method, path, and body tampering', () => {
  const now = Math.floor(Date.now() / 1000);
  const expired = signedRequest({ iat: now - 100, exp: now - 1 });
  assert.match(validateActionAssertion(expired.request, 10) ?? '', /invalid or expired/);
  const wrongAudience = signedRequest({ audience: 'other-service' });
  assert.match(validateActionAssertion(wrongAudience.request, 10) ?? '', /invalid or expired/);
  const wrongNonce = signedRequest();
  wrongNonce.request.header = (name: string) =>
    name === 'Idempotency-Key' ? 'different-nonce-123456' : wrongNonce.assertion;
  assert.match(validateActionAssertion(wrongNonce.request, 10) ?? '', /nonce/);
  const wrongMethod = signedRequest();
  wrongMethod.request.method = 'PUT';
  assert.match(validateActionAssertion(wrongMethod.request, 10) ?? '', /invalid or expired/);
  const wrongPath = signedRequest();
  wrongPath.request.originalUrl = '/v1/federation/payroll/runs/other';
  assert.match(validateActionAssertion(wrongPath.request, 10) ?? '', /invalid or expired/);
  const wrongBody = signedRequest();
  wrongBody.request.body.decision = 'rejected';
  assert.match(validateActionAssertion(wrongBody.request, 10) ?? '', /invalid or expired/);
  const wrongTarget = signedRequest();
  wrongTarget.request.body.externalEmployeeId = 'employee-2';
  assert.match(validateActionAssertion(wrongTarget.request, 10) ?? '', /invalid or expired/);
  const actorBound = signedRequest();
  actorBound.request.body.decidedByExternalUserId = 'actor-1';
  assert.match(validateActionAssertion(actorBound.request, 10) ?? '', /invalid or expired/);
});

test('rejects assertions whose signed nonce is not the idempotency key', () => {
  const { request } = signedRequest();
  const mismatched = {
    ...request,
    header(name: string) {
      if (name === 'Idempotency-Key') return 'another-nonce-123456';
      return request.header(name);
    },
  };
  assert.match(validateActionAssertion(mismatched, 10) ?? '', /nonce/);
});

test('requires the signed tenant claim to match the resolved tenant mapping', () => {
  const signed = signedRequest({ tenant: 'tenant-a' });
  assert.equal(validateActionAssertion(signed.request, 10, 'tenant-a'), null);
  assert.match(validateActionAssertion(signed.request, 10, 'tenant-b') ?? '', /invalid or expired/);
  const unsigned = signedRequest();
  assert.match(validateActionAssertion(unsigned.request, 10, 'tenant-a') ?? '', /invalid or expired/);
});

test('rejects body identifiers that disagree with path-bound tenant or target identifiers', () => {
  const tenantPath = '/v1/federation/tenants/tenant-a/branches/branch-a';
  const tenantRequest = signedRequest({ path: tenantPath, body: { externalOrganizationId: 'tenant-b', externalBranchId: 'branch-a' } });
  assert.match(validateActionAssertion(tenantRequest.request, 10, 'tenant-a') ?? '', /invalid or expired/);

  const employeePath = '/v1/federation/employees/employee-a/compensation';
  const employeeRequest = signedRequest({ path: employeePath, body: { externalEmployeeId: 'employee-b' } });
  assert.match(validateActionAssertion(employeeRequest.request, 10, 'tenant-a') ?? '', /invalid or expired/);
});

test('requires and binds the human actor for self-service attendance writes', () => {
  const path = '/v1/federation/attendance/check-ins';
  const body = { externalEmployeeId: 'employee-1', externalBranchId: 'branch-1', occurredAt: new Date().toISOString() };
  const nonce = 'nonce-attendance-123456';
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: 'smartteams-federation', iat: now, exp: now + 30, nonce,
    method: 'POST', path, action: `POST:${path}`, actor: 'employee-1',
    tenant: undefined, outlet: 'branch-1', target: 'employee-1',
    bodyHash: crypto.createHash('sha256').update(JSON.stringify(body)).digest('base64url'),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const assertion = `${encoded}.${crypto.createHmac('sha256', secret).update(encoded).digest('base64url')}`;
  const request = {
    method: 'POST', originalUrl: path, body,
    header(name: string) {
      if (name === 'Idempotency-Key') return nonce;
      return name === 'X-Federation-Action-Assertion' ? assertion : undefined;
    },
  };
  assert.equal(validateActionAssertion(request, 10), null);

  const tampered = { ...request, body: { ...body, externalEmployeeId: 'employee-2' } };
  assert.match(validateActionAssertion(tampered, 10) ?? '', /invalid or expired/);

  const unsignedActorPayload = { ...payload, actor: undefined };
  const unsignedActorEncoded = Buffer.from(JSON.stringify(unsignedActorPayload)).toString('base64url');
  const unsignedActorAssertion = `${unsignedActorEncoded}.${crypto.createHmac('sha256', secret).update(unsignedActorEncoded).digest('base64url')}`;
  const unsignedActorRequest = {
    ...request,
    header(name: string) {
      if (name === 'Idempotency-Key') return nonce;
      return name === 'X-Federation-Action-Assertion' ? unsignedActorAssertion : undefined;
    },
  };
  assert.match(validateActionAssertion(unsignedActorRequest, 10) ?? '', /invalid or expired/);
});
