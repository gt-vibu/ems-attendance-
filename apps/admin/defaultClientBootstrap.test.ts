import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDefaultFederationClientSeed } from './api/services/federation/defaultClientBootstrap.ts';
import { verifyPassword } from './password.ts';

describe('default federation client bootstrap', () => {
  test('does not seed any client when bootstrap credentials are absent', async () => {
    const seeds = await buildDefaultFederationClientSeed({});
    assert.deepEqual(seeds, []);
  });

  test('hashes the configured bootstrap secret instead of storing it literally', async () => {
    const seeds = await buildDefaultFederationClientSeed({
      FEDERATION_BOOTSTRAP_CLIENT_ID: 'blizbooks-local',
      FEDERATION_BOOTSTRAP_CLIENT_SECRET: 'super-secret-value',
      FEDERATION_BOOTSTRAP_SCOPES: 'attendance.read, leave.read , payroll.read',
      FEDERATION_BOOTSTRAP_ENVIRONMENT: 'production',
    });

    assert.equal(seeds.length, 1);
    assert.equal(seeds[0].clientId, 'blizbooks-local');
    assert.equal(seeds[0].environment, 'production');
    assert.deepEqual(seeds[0].scopes, ['attendance.read', 'leave.read', 'payroll.read']);
    assert.notEqual(seeds[0].clientSecretHash, 'super-secret-value');
    assert.equal(await verifyPassword('super-secret-value', seeds[0].clientSecretHash), true);
  });
});
