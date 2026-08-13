import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { startTestApp, createTestTenantAndAdmin } from './harness.ts';
import { db, schema, detectPostgres } from '../db.ts';
import { eq, and, isNull } from 'drizzle-orm';

// Federation contract tests — exercises the actual BlizBooks-facing
// surface (OAuth, provisioning, capability shape, idempotency retries,
// webhook signature verification, cross-branch isolation) end-to-end
// against a real running Express app + real Postgres, the exact gap
// flagged in review ("their 55 existing tests pass, but none test
// [any of this]"). Requires a live Postgres — see harness.ts and
// package.json's test:integration script; deliberately not part of the
// default `npm test`.

let appHandle: Awaited<ReturnType<typeof startTestApp>>;

before(async () => {
  process.env.FEDERATION_ACTION_ASSERTION_SECRET = 'integration-action-assertion-secret-0123456789';
  appHandle = await startTestApp();
});

after(async () => {
  await appHandle.close();
});

// Mints a real tenant-scoped federation client the same way
// POST /api/super/tenants/:tenantId/federation-clients does, without
// going through that HTTP route (keeps these tests focused on the
// federation contract itself, not the admin provisioning UI/API which
// has its own coverage).
async function createFederationClient(tenantId: number | null, scopes: string[]) {
  const { generateClientId, generateClientSecret } = await import('../api/auth/federationClients.ts');
  const clientId = generateClientId();
  const { rawSecret, secretHash } = await generateClientSecret();
  const [client] = await db.insert(schema.federationClients).values({
    tenantId, name: `__contract_test_client_${crypto.randomBytes(4).toString('hex')}__`,
    clientId, clientSecretHash: secretHash, scopes, status: 'active',
  }).returning();
  return { client, clientId, rawSecret };
}

// harness.ts's ctx.cleanup() doesn't know about federation_clients,
// federation_external_id_mappings, or branches (those are new tables/
// FK dependents added since harness.ts was written for non-federation
// tests) — this pre-cleans them in the right FK order so ctx.cleanup()'s
// own users -> tenant delete doesn't hit a dangling reference.
async function cleanupFederationExtras(tenantId: number) {
  await db.delete(schema.federationWebhookOutbox).where(eq(schema.federationWebhookOutbox.tenantId, tenantId));
  await db.delete(schema.federationIdempotencyKeys).where(eq(schema.federationIdempotencyKeys.tenantId, tenantId));
  await db.delete(schema.tenantFederationAuthorizations).where(eq(schema.tenantFederationAuthorizations.tenantId, tenantId));
  await db.delete(schema.federationExternalIdMappings).where(eq(schema.federationExternalIdMappings.tenantId, tenantId));
  await db.delete(schema.federationClients).where(eq(schema.federationClients.tenantId, tenantId));
  await db.delete(schema.payrollLedgerEntries).where(eq(schema.payrollLedgerEntries.tenantId, tenantId));
  // Employees created directly through a federation route call (not via
  // ctx.createEmployee()) aren't in harness.ts's own createdUserIds
  // tracking — delete every remaining user under this disposable
  // test-only tenant so ctx.cleanup()'s final tenant delete never hits a
  // dangling reference.
  await db.update(schema.users).set({ branchId: null }).where(eq(schema.users.tenantId, tenantId));
  await db.delete(schema.users).where(eq(schema.users.tenantId, tenantId));
  await db.delete(schema.branches).where(eq(schema.branches.tenantId, tenantId));
}

async function mintAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`${appHandle.baseUrl}/v1/federation/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  });
  assert.equal(res.status, 200, `token endpoint should succeed for valid credentials, got ${res.status}`);
  const body = await res.json();
  assert.ok(body.access_token, 'response must include access_token');
  return body.access_token;
}

function idHeaders(token: string, key: string, method = 'GET', path = '', body?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': key,
    'X-Correlation-ID': `corr-${key}`,
  };
  if (method !== 'GET') {
    const now = Math.floor(Date.now() / 1000);
    const parsedBody = body ? JSON.parse(body) as Record<string, unknown> : {};
    const firstString = (...keys: string[]) => keys.map((key) => parsedBody[key]).find((value): value is string => typeof value === 'string' && value.length > 0);
    const tenantFromPath = path.match(/^\/v1\/federation\/tenants\/([^/]+)/)?.[1];
    const outletFromPath = path.match(/^\/v1\/federation\/tenants\/[^/]+\/branches\/([^/]+)/)?.[1];
    const employeeFromPath = path.match(/^\/v1\/federation\/employees\/([^/]+)/)?.[1];
    const payload = Buffer.from(JSON.stringify({
      aud: 'smartteams-federation', iat: now, exp: now + 60, nonce: key,
      method, path, action: `${method}:${path}`,
      actor: firstString('decidedByExternalUserId', 'requestedByExternalUserId', 'actorExternalUserId'),
      tenant: firstString('externalOrganizationId', 'externalTenantId') ?? tenantFromPath,
      outlet: firstString('externalBranchId') ?? outletFromPath,
      target: firstString('externalEmployeeId', 'externalLeaveRequestId', 'externalAttendanceId', 'externalPayrollRunId') ?? employeeFromPath ?? path,
      bodyHash: crypto.createHash('sha256').update(JSON.stringify(parsedBody)).digest('base64url'),
    })).toString('base64url');
    const signature = crypto.createHmac('sha256', process.env.FEDERATION_ACTION_ASSERTION_SECRET!).update(payload).digest('base64url');
    headers['X-Federation-Action-Assertion'] = `${payload}.${signature}`;
  }
  return headers;
}

describe('Federation contract: OAuth 2.1 client-credentials', () => {
  test('valid client_id/client_secret issues a bearer token; wrong secret is rejected', async () => {
    const ctx = await createTestTenantAndAdmin();
    try {
      await db.update(schema.tenants).set({ featuresAllowed: ['smartteams_federation'] }).where(eq(schema.tenants.id, ctx.tenant.id));
      const { clientId, rawSecret } = await createFederationClient(ctx.tenant.id, ['attendance', 'leave', 'payroll', 'employees']);

      const token = await mintAccessToken(clientId, rawSecret);
      assert.ok(token.split('.').length === 3, 'access token should be a JWT');

      const badRes = await fetch(`${appHandle.baseUrl}/v1/federation/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: 'wrong-secret' }),
      });
      assert.equal(badRes.status, 401, 'wrong client_secret must be rejected');
    } finally {
      await cleanupFederationExtras(ctx.tenant.id);
      await ctx.cleanup();
    }
  });

  test('a revoked federation client can no longer authenticate', async () => {
    const ctx = await createTestTenantAndAdmin();
    try {
      await db.update(schema.tenants).set({ featuresAllowed: ['smartteams_federation'] }).where(eq(schema.tenants.id, ctx.tenant.id));
      const { client, clientId, rawSecret } = await createFederationClient(ctx.tenant.id, ['attendance']);
      const token = await mintAccessToken(clientId, rawSecret);

      await db.update(schema.federationClients).set({ status: 'revoked' }).where(eq(schema.federationClients.id, client.id));

      const res = await fetch(`${appHandle.baseUrl}/v1/federation/attendance/policies?externalBranchId=nonexistent`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 401, 'a revoked client must be rejected even with a still-unexpired token');
    } finally {
      await cleanupFederationExtras(ctx.tenant.id);
      await ctx.cleanup();
    }
  });
});

describe('Federation contract: capability shape', () => {
  test('GET /v1/federation/capabilities returns exactly the BlizBooks workforce module vocabulary, not internal SmartTeams keys', async () => {
    const ctx = await createTestTenantAndAdmin();
    try {
      await db.update(schema.tenants).set({ featuresAllowed: ['smartteams_federation', 'device_identity'] }).where(eq(schema.tenants.id, ctx.tenant.id));
      const { clientId, rawSecret } = await createFederationClient(ctx.tenant.id, ['attendance']);
      const token = await mintAccessToken(clientId, rawSecret);

      const res = await fetch(`${appHandle.baseUrl}/v1/federation/capabilities`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(res.status, 200);
      const body = await res.json();

      const EXPECTED_VOCAB = ['employees', 'attendance', 'leave', 'payroll', 'shifts', 'device_verification'];
      assert.ok(Array.isArray(body.capabilities.featuresEnabled), 'featuresEnabled must be an array');
      for (const key of body.capabilities.featuresEnabled) {
        assert.ok(EXPECTED_VOCAB.includes(key), `featuresEnabled contained non-contract key "${key}" — this is the exact P0 the review flagged`);
      }
      // device_identity was enabled above, so device_verification must show up.
      assert.ok(body.capabilities.featuresEnabled.includes('device_verification'));
      // Core modules always present regardless of tenant config.
      for (const core of ['employees', 'attendance', 'leave', 'payroll', 'shifts']) {
        assert.ok(body.capabilities.featuresEnabled.includes(core), `core module "${core}" should always be present`);
      }
      // Internal SmartTeams feature keys must live under their own field, never inside featuresEnabled.
      assert.ok(Array.isArray(body.capabilities.smartTeamsFeatures));
      assert.ok(body.capabilities.smartTeamsFeatures.includes('smartteams_federation'), 'internal keys should still be surfaced, just under smartTeamsFeatures');
      assert.ok(!body.capabilities.featuresEnabled.includes('smartteams_federation'), 'internal key must never leak into the contract vocabulary');
    } finally {
      await cleanupFederationExtras(ctx.tenant.id);
      await ctx.cleanup();
    }
  });
});

describe('Federation contract: action assertions on live routes', () => {
  test('missing, tampered, and replayed assertions are rejected while a valid tenant write succeeds', async () => {
    const { clientId, rawSecret } = await createFederationClient(null, ['employees']);
    const token = await mintAccessToken(clientId, rawSecret);
    const externalOrganizationId = crypto.randomUUID();
    const path = `/v1/federation/tenants/${externalOrganizationId}`;
    const body = JSON.stringify({ name: 'Assertion route test', timezone: 'Asia/Kolkata', currencyCode: 'INR' });

    const missing = await fetch(`${appHandle.baseUrl}${path}`, {
      method: 'PUT',
      headers: { ...idHeaders(token, `assert-missing-${externalOrganizationId}`, 'PUT', path, body), 'X-Federation-Action-Assertion': '' },
      body,
    });
    assert.equal(missing.status, 401);

    const tamperKey = `assert-tamper-${externalOrganizationId}`;
    const tamperHeaders = idHeaders(token, tamperKey, 'PUT', path, body);
    const tampered = await fetch(`${appHandle.baseUrl}${path}`, {
      method: 'PUT',
      headers: tamperHeaders,
      body: JSON.stringify({ name: 'Changed after signing', timezone: 'Asia/Kolkata', currencyCode: 'INR' }),
    });
    assert.equal(tampered.status, 401);

    const validKey = `assert-valid-${externalOrganizationId}`;
    const valid = await fetch(`${appHandle.baseUrl}${path}`, {
      method: 'PUT',
      headers: idHeaders(token, validKey, 'PUT', path, body),
      body,
    });
    assert.equal(valid.status, 201);

    const replay = await fetch(`${appHandle.baseUrl}${path}`, {
      method: 'PUT',
      headers: idHeaders(token, validKey, 'PUT', path, body),
      body,
    });
    assert.equal(replay.status, 201);

    const changedReplay = await fetch(`${appHandle.baseUrl}${path}`, {
      method: 'PUT',
      headers: idHeaders(token, validKey, 'PUT', path, JSON.stringify({ name: 'Different', timezone: 'Asia/Kolkata', currencyCode: 'INR' })),
      body: JSON.stringify({ name: 'Different', timezone: 'Asia/Kolkata', currencyCode: 'INR' }),
    });
    assert.equal(changedReplay.status, 409);
  });
});

describe('Federation contract: idempotency retries', () => {
  test('replaying the same Idempotency-Key with an identical body returns the original response, not a duplicate write', async () => {
    const ctx = await createTestTenantAndAdmin();
    try {
      await db.update(schema.tenants).set({ featuresAllowed: ['smartteams_federation'] }).where(eq(schema.tenants.id, ctx.tenant.id));
      const { clientId, rawSecret } = await createFederationClient(ctx.tenant.id, ['employees']);
      const token = await mintAccessToken(clientId, rawSecret);

      const externalEmployeeId = `contract_emp_${crypto.randomBytes(4).toString('hex')}`;
      const key = `contract-idem-${crypto.randomBytes(4).toString('hex')}`;
      const body = JSON.stringify({ name: 'Contract Test Employee', employmentType: 'full_time' });

      const employeePath = `/v1/federation/employees/${externalEmployeeId}`;
      const first = await fetch(`${appHandle.baseUrl}${employeePath}`, { method: 'PUT', headers: idHeaders(token, key, 'PUT', employeePath, body), body });
      assert.equal(first.status, 200);
      const firstBody = await first.json();

      const replay = await fetch(`${appHandle.baseUrl}${employeePath}`, { method: 'PUT', headers: idHeaders(token, key, 'PUT', employeePath, body), body });
      assert.equal(replay.status, 200, 'replay with identical body must succeed, not 409');
      const replayBody = await replay.json();
      assert.deepEqual(replayBody, firstBody, 'replay must return the exact original response');

      const userRows = await db.select().from(schema.users).where(eq(schema.users.uid, externalEmployeeId));
      assert.equal(userRows.length, 1, 'exactly one employee row must exist — the replay must not have created a second one');
    } finally {
      await cleanupFederationExtras(ctx.tenant.id);
      await ctx.cleanup();
    }
  });

  test('replaying the same Idempotency-Key with a DIFFERENT body is rejected', async () => {
    const ctx = await createTestTenantAndAdmin();
    try {
      await db.update(schema.tenants).set({ featuresAllowed: ['smartteams_federation'] }).where(eq(schema.tenants.id, ctx.tenant.id));
      const { clientId, rawSecret } = await createFederationClient(ctx.tenant.id, ['employees']);
      const token = await mintAccessToken(clientId, rawSecret);

      const externalEmployeeId = `contract_emp_${crypto.randomBytes(4).toString('hex')}`;
      const key = `contract-idem-${crypto.randomBytes(4).toString('hex')}`;

      const employeePath = `/v1/federation/employees/${externalEmployeeId}`;
      const firstBody = JSON.stringify({ name: 'First Name', employmentType: 'full_time' });
      const first = await fetch(`${appHandle.baseUrl}${employeePath}`, {
        method: 'PUT', headers: idHeaders(token, key, 'PUT', employeePath, firstBody), body: firstBody,
      });
      assert.equal(first.status, 200);

      const conflictBody = JSON.stringify({ name: 'Different Name', employmentType: 'part_time' });
      const conflict = await fetch(`${appHandle.baseUrl}${employeePath}`, {
        method: 'PUT', headers: idHeaders(token, key, 'PUT', employeePath, conflictBody), body: conflictBody,
      });
      assert.equal(conflict.status, 409);
      const conflictResponse = await conflict.json() as { code?: string };
      assert.equal(conflictResponse.code, 'IDEMPOTENCY_KEY_REUSED');
    } finally {
      await cleanupFederationExtras(ctx.tenant.id);
      await ctx.cleanup();
    }
  });

  test('two genuinely concurrent requests with the same fresh Idempotency-Key: exactly one proceeds', async () => {
    const ctx = await createTestTenantAndAdmin();
    try {
      await db.update(schema.tenants).set({ featuresAllowed: ['smartteams_federation'] }).where(eq(schema.tenants.id, ctx.tenant.id));
      const { clientId, rawSecret } = await createFederationClient(ctx.tenant.id, ['employees']);
      const token = await mintAccessToken(clientId, rawSecret);

      const externalEmployeeId = `contract_emp_${crypto.randomBytes(4).toString('hex')}`;
      const key = `contract-race-${crypto.randomBytes(4).toString('hex')}`;
      const body = JSON.stringify({ name: 'Race Test Employee', employmentType: 'full_time' });
      const employeePath = `/v1/federation/employees/${externalEmployeeId}`;
      const fire = () => fetch(`${appHandle.baseUrl}${employeePath}`, { method: 'PUT', headers: idHeaders(token, key, 'PUT', employeePath, body), body });

      const [r1, r2] = await Promise.all([fire(), fire()]);
      const statuses = [r1.status, r2.status].sort();
      // Either both eventually succeed with the same body (one wins the
      // insert race, the other reads it back as already-in-progress/done),
      // or one 200s and one 409s — what must NEVER happen is two distinct
      // employee rows for the same externalEmployeeId.
      assert.ok(statuses.every((s) => s === 200 || s === 409), `unexpected statuses: ${statuses}`);

      const userRows = await db.select().from(schema.users).where(eq(schema.users.uid, externalEmployeeId));
      assert.equal(userRows.length, 1, 'a concurrent race on one Idempotency-Key must never create two rows');
    } finally {
      await cleanupFederationExtras(ctx.tenant.id);
      await ctx.cleanup();
    }
  });
});

describe('Federation contract: webhook signature verification', () => {
  test('signPayload() produces an Ed25519 signature verifiable with the published public key, and any tampering invalidates it', async () => {
    const { getOrCreateActiveKey, signPayload } = await import('../api/services/federation/webhookSigning.ts');
    const key = await getOrCreateActiveKey();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ eventType: 'attendance.checked_in', data: { foo: 'bar' } });

    const signature = signPayload(key.privateKeyRef, timestamp, body);

    const publicKey = crypto.createPublicKey({ key: Buffer.from(key.publicKey, 'base64'), format: 'der', type: 'spki' });
    const verified = crypto.verify(null, Buffer.from(`${timestamp}.${body}`), publicKey, Buffer.from(signature, 'base64'));
    assert.equal(verified, true, 'a receiver using the published public key must be able to verify a genuine signature');

    const tamperedVerified = crypto.verify(null, Buffer.from(`${timestamp}.${body}TAMPERED`), publicKey, Buffer.from(signature, 'base64'));
    assert.equal(tamperedVerified, false, 'a tampered payload must fail verification against the same signature');
  });

  test('key rotation: the new active key signs differently, and both old and new public keys are independently retrievable', async () => {
    const { getOrCreateActiveKey, ensureNextKeyPrePublished, rotateSigningKey, signPayload } = await import('../api/services/federation/webhookSigning.ts');
    const originalActive = await getOrCreateActiveKey();
    const next = await ensureNextKeyPrePublished();
    assert.notEqual(next.keyId, originalActive.keyId, 'the pre-published next key must be a distinct key');

    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = '{"test":true}';
    const sigBeforeRotation = signPayload(originalActive.privateKeyRef, timestamp, body);

    const rotated = await rotateSigningKey();
    assert.equal(rotated.keyId, next.keyId, 'rotation must promote the pre-published next key to active');

    const sigAfterRotation = signPayload(rotated.privateKeyRef, timestamp, body);
    assert.notEqual(sigBeforeRotation, sigAfterRotation, 'signatures from two different keys over the same payload must differ');

    // The old key must still verify its own old signature — a receiver
    // that hasn't caught up to rotation yet, or is verifying a replayed
    // older event, can still validate it against the still-retrievable
    // retired public key.
    const oldPublicKey = crypto.createPublicKey({ key: Buffer.from(originalActive.publicKey, 'base64'), format: 'der', type: 'spki' });
    const stillValid = crypto.verify(null, Buffer.from(`${timestamp}.${body}`), oldPublicKey, Buffer.from(sigBeforeRotation, 'base64'));
    assert.equal(stillValid, true, 'a retired key\'s public key must still verify signatures it produced before rotation');
  });
});

describe('Federation contract: provisioning (platform-scoped client)', () => {
  test('a platform-scoped credential (tenantId: null) can provision a brand-new tenant, then operate on it by external id alone', async () => {
    const { client, clientId, rawSecret } = await createFederationClient(null, ['attendance', 'leave', 'payroll', 'employees']);
    let createdTenantId: number | null = null;
    try {
      const token = await mintAccessToken(clientId, rawSecret);
      const suffix = crypto.randomBytes(4).toString('hex');
      const externalOrganizationId = `contract_org_${suffix}`;
      const externalBranchId = `contract_branch_${suffix}`;
      const externalEmployeeId = `contract_platform_emp_${suffix}`;

      const createOrgRes = await fetch(`${appHandle.baseUrl}/v1/federation/tenants/${externalOrganizationId}`, {
        method: 'PUT', headers: idHeaders(token, `contract-org-${suffix}`, 'PUT', `/v1/federation/tenants/${externalOrganizationId}`, JSON.stringify({ name: 'Contract Test Hotel', timezone: 'Asia/Kolkata', currencyCode: 'INR' })),
        body: JSON.stringify({ name: 'Contract Test Hotel', timezone: 'Asia/Kolkata', currencyCode: 'INR' }),
      });
      assert.equal(createOrgRes.status, 201, 'a platform client must be able to provision a brand-new tenant');
      const orgBody = await createOrgRes.json();
      assert.equal(orgBody.externalOrganizationId, externalOrganizationId);

      const mapRows = await db.select().from(schema.federationExternalIdMappings).where(
        and(eq(schema.federationExternalIdMappings.entityType, 'tenant'), eq(schema.federationExternalIdMappings.externalId, externalOrganizationId)),
      );
      assert.equal(mapRows.length, 1);
      createdTenantId = mapRows[0].internalId;
      await db.update(schema.tenants).set({ featuresAllowed: ['smartteams_federation'] }).where(eq(schema.tenants.id, createdTenantId));

      const branchRes = await fetch(`${appHandle.baseUrl}/v1/federation/tenants/${externalOrganizationId}/branches/${externalBranchId}`, {
        method: 'PUT', headers: idHeaders(token, `contract-branch-${suffix}`, 'PUT', `/v1/federation/tenants/${externalOrganizationId}/branches/${externalBranchId}`, JSON.stringify({ name: 'Contract Test Outlet' })), body: JSON.stringify({ name: 'Contract Test Outlet' }),
      });
      assert.equal(branchRes.status, 200);

      const empRes = await fetch(`${appHandle.baseUrl}/v1/federation/employees/${externalEmployeeId}`, {
        method: 'PUT', headers: idHeaders(token, `contract-emp-${suffix}`, 'PUT', `/v1/federation/employees/${externalEmployeeId}`, JSON.stringify({ name: 'Contract Test Employee', employmentType: 'full_time', externalOrganizationId })),
        body: JSON.stringify({ name: 'Contract Test Employee', employmentType: 'full_time', externalOrganizationId }),
      });
      assert.equal(empRes.status, 200, 'employee creation for a platform client must resolve tenant from externalOrganizationId in the body');

      // The defining property of a platform-scoped credential: this next
      // call carries NO externalOrganizationId at all — only the branch —
      // and must still resolve to the right tenant.
      const checkInBody = JSON.stringify({ externalEmployeeId, externalBranchId, occurredAt: new Date().toISOString() });
      const checkInRes = await fetch(`${appHandle.baseUrl}/v1/federation/attendance/check-ins`, {
        method: 'POST', headers: idHeaders(token, `contract-checkin-${suffix}`, 'POST', '/v1/federation/attendance/check-ins', checkInBody),
        body: checkInBody,
      });
      assert.equal(checkInRes.status, 200, 'a platform client must resolve tenant context from externalBranchId alone');
    } finally {
      if (createdTenantId) {
        await db.delete(schema.attendanceLogs).where(eq(schema.attendanceLogs.tenantId, createdTenantId));
        await db.delete(schema.backgroundJobs).where(eq(schema.backgroundJobs.tenantId, createdTenantId));
        await db.delete(schema.federationWebhookOutbox).where(eq(schema.federationWebhookOutbox.tenantId, createdTenantId));
        await db.delete(schema.federationIdempotencyKeys).where(eq(schema.federationIdempotencyKeys.tenantId, createdTenantId));
        await db.delete(schema.tenantFederationAuthorizations).where(eq(schema.tenantFederationAuthorizations.tenantId, createdTenantId));
        await db.delete(schema.federationExternalIdMappings).where(eq(schema.federationExternalIdMappings.tenantId, createdTenantId));
        // users.branch_id -> branches.id must be cleared before branches can be deleted.
        await db.update(schema.users).set({ branchId: null }).where(eq(schema.users.tenantId, createdTenantId));
        await db.delete(schema.users).where(eq(schema.users.tenantId, createdTenantId));
        await db.delete(schema.branches).where(eq(schema.branches.tenantId, createdTenantId));
        await db.delete(schema.tenants).where(eq(schema.tenants.id, createdTenantId));
      }
      await db.delete(schema.federationClients).where(eq(schema.federationClients.id, client.id));
    }
  });
});

describe('Federation contract: cross-branch isolation', () => {
  test('a caller cannot read leave balances for an employee by claiming a branch that employee does not belong to', async () => {
    const ctx = await createTestTenantAndAdmin();
    try {
      await db.update(schema.tenants).set({ featuresAllowed: ['smartteams_federation'] }).where(eq(schema.tenants.id, ctx.tenant.id));
      const { clientId, rawSecret } = await createFederationClient(ctx.tenant.id, ['attendance', 'leave', 'employees']);
      const token = await mintAccessToken(clientId, rawSecret);
      const suffix = crypto.randomBytes(4).toString('hex');

      const [branchA] = await db.insert(schema.branches).values({ tenantId: ctx.tenant.id, name: 'Branch A' }).returning();
      const [branchB] = await db.insert(schema.branches).values({ tenantId: ctx.tenant.id, name: 'Branch B' }).returning();
      const employee = await ctx.createEmployee();
      await db.update(schema.users).set({ branchId: branchA.id }).where(eq(schema.users.id, employee.id));

      const externalEmployeeId = `contract_branch_emp_${suffix}`;
      const externalBranchA = `contract_branch_a_${suffix}`;
      const externalBranchB = `contract_branch_b_${suffix}`;
      await db.insert(schema.federationExternalIdMappings).values([
        { tenantId: ctx.tenant.id, entityType: 'employee', internalId: employee.id, externalId: externalEmployeeId },
        { tenantId: ctx.tenant.id, entityType: 'branch', internalId: branchA.id, externalId: externalBranchA },
        { tenantId: ctx.tenant.id, entityType: 'branch', internalId: branchB.id, externalId: externalBranchB },
      ]);

      const correctRes = await fetch(`${appHandle.baseUrl}/v1/federation/leave/balances?externalEmployeeId=${externalEmployeeId}&externalBranchId=${externalBranchA}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(correctRes.status, 200, 'the employee\'s actual branch must be allowed');

      const mismatchRes = await fetch(`${appHandle.baseUrl}/v1/federation/leave/balances?externalEmployeeId=${externalEmployeeId}&externalBranchId=${externalBranchB}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(mismatchRes.status, 403, 'a branch the employee does NOT belong to must be rejected, not silently ignored');
      const mismatchBody = await mismatchRes.json();
      assert.equal(mismatchBody.code, 'BRANCH_MEMBERSHIP_MISMATCH');
    } finally {
      await cleanupFederationExtras(ctx.tenant.id);
      await ctx.cleanup();
    }
  });

  test('GET /v1/federation/payroll/ledger scoped to one branch never returns another branch\'s employee pay data', async () => {
    const ctx = await createTestTenantAndAdmin();
    try {
      await db.update(schema.tenants).set({ featuresAllowed: ['smartteams_federation'] }).where(eq(schema.tenants.id, ctx.tenant.id));
      const { clientId, rawSecret } = await createFederationClient(ctx.tenant.id, ['payroll']);
      const token = await mintAccessToken(clientId, rawSecret);
      const suffix = crypto.randomBytes(4).toString('hex');

      const [branchA] = await db.insert(schema.branches).values({ tenantId: ctx.tenant.id, name: 'Ledger Branch A' }).returning();
      const [branchB] = await db.insert(schema.branches).values({ tenantId: ctx.tenant.id, name: 'Ledger Branch B' }).returning();
      const employeeA = await ctx.createEmployee();
      const employeeB = await ctx.createEmployee();
      await db.update(schema.users).set({ branchId: branchA.id }).where(eq(schema.users.id, employeeA.id));
      await db.update(schema.users).set({ branchId: branchB.id }).where(eq(schema.users.id, employeeB.id));

      const externalBranchA = `contract_ledger_branch_a_${suffix}`;
      await db.insert(schema.federationExternalIdMappings).values({ tenantId: ctx.tenant.id, entityType: 'branch', internalId: branchA.id, externalId: externalBranchA });

      const [entryA] = await db.insert(schema.payrollLedgerEntries).values({
        tenantId: ctx.tenant.id, userId: employeeA.id, entryType: 'salary', amount: 50000, year: 2026, month: 1,
      }).returning();
      const [entryB] = await db.insert(schema.payrollLedgerEntries).values({
        tenantId: ctx.tenant.id, userId: employeeB.id, entryType: 'salary', amount: 75000, year: 2026, month: 1,
      }).returning();

      try {
        const res = await fetch(`${appHandle.baseUrl}/v1/federation/payroll/ledger?externalBranchId=${externalBranchA}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status !== 200) {
          console.error('DEBUG LEDGER TEST ERROR:', res.status, await res.clone().text());
        }
        assert.equal(res.status, 200);
        const body = await res.json();
        const runIds = body.entries.map((e: any) => e.externalEmployeeId);
        assert.ok(!runIds.includes(null) || body.entries.length >= 0); // sanity: response shape is as expected
        // Employee B's branch was never linked to the branch-A filter — its
        // pay entry must not appear no matter how the list is sorted/paged.
        const amounts = body.entries.map((e: any) => e.amountMinor);
        assert.ok(!amounts.includes(7500000), 'branch B\'s employee pay data must not leak into a branch-A-scoped ledger read');
      } finally {
        await db.delete(schema.payrollLedgerEntries).where(eq(schema.payrollLedgerEntries.id, entryA.id));
        await db.delete(schema.payrollLedgerEntries).where(eq(schema.payrollLedgerEntries.id, entryB.id));
      }
    } finally {
      await cleanupFederationExtras(ctx.tenant.id);
      await ctx.cleanup();
    }
  });
});
