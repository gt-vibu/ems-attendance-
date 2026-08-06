import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { logger } from '../../../logger';

// Ed25519 signing keys for outbound federation webhook deliveries — the
// plan requires provider-owned Ed25519 keys (not a shared HMAC secret),
// published at GET /v1/federation/webhook-signing-keys, with the next key
// pre-published >= 7 days before activation and retired keys kept >= 7
// days after last use.
//
// PRODUCTION NOTE: this dev-friendly default stores the PKCS8 private key
// bytes directly in `federation_signing_keys.private_key_ref` (base64).
// Before going to production, swap this for a real secret-store/HSM: keep
// the column as an opaque reference (e.g. a Vault path or KMS key ARN) and
// have signPayload() below fetch/use the key through that service instead
// of decoding it locally. No other code in this module needs to change —
// getOrCreateActiveKey()/signPayload() are the only two functions that
// touch key material.
const KEY_ROTATION_OVERLAP_DAYS = 7;

interface SigningKeyRow {
  id: number;
  keyId: string;
  publicKey: string;
  privateKeyRef: string;
  status: string;
}

function generateKeyPair(): { keyId: string; publicKeyB64: string; privateKeyB64: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  return {
    keyId: crypto.randomUUID(),
    publicKeyB64: (publicKey as Buffer).toString('base64'),
    privateKeyB64: (privateKey as Buffer).toString('base64'),
  };
}

export async function getOrCreateActiveKey(): Promise<SigningKeyRow> {
  const active = await db.select().from(schema.federationSigningKeys).where(eq(schema.federationSigningKeys.status, 'active')).limit(1);
  if (active.length > 0) return active[0] as SigningKeyRow;

  const generated = generateKeyPair();
  const [inserted] = await db.insert(schema.federationSigningKeys).values({
    keyId: generated.keyId,
    publicKey: generated.publicKeyB64,
    privateKeyRef: generated.privateKeyB64,
    status: 'active',
  }).returning();
  logger.info('[federation] generated new active Ed25519 webhook signing key', { keyId: generated.keyId });
  return inserted as SigningKeyRow;
}

export async function getNextKey(): Promise<SigningKeyRow | null> {
  const rows = await db.select().from(schema.federationSigningKeys).where(eq(schema.federationSigningKeys.status, 'next')).limit(1);
  return (rows[0] as SigningKeyRow) || null;
}

export async function getRetiredKeys(): Promise<SigningKeyRow[]> {
  return (await db.select().from(schema.federationSigningKeys).where(eq(schema.federationSigningKeys.status, 'retired'))) as SigningKeyRow[];
}

// Pre-publishes a 'next' key (idempotent — a no-op if one already exists),
// satisfying the >=7-day pre-publish requirement when the operator rotates
// on a schedule ahead of activation.
export async function ensureNextKeyPrePublished(): Promise<SigningKeyRow> {
  const existing = await getNextKey();
  if (existing) return existing;
  const generated = generateKeyPair();
  const [inserted] = await db.insert(schema.federationSigningKeys).values({
    keyId: generated.keyId,
    publicKey: generated.publicKeyB64,
    privateKeyRef: generated.privateKeyB64,
    status: 'next',
  }).returning();
  return inserted as SigningKeyRow;
}

// Promotes the pre-published 'next' key to 'active', retiring the previous
// active key (kept queryable for >=7 days per the plan — this only flags
// it 'retired' with a timestamp, callers are responsible for a periodic
// cleanup job past that window if one is ever needed).
export async function rotateSigningKey(): Promise<SigningKeyRow> {
  const next = await getNextKey();
  if (!next) throw new Error('No pre-published next key to rotate into — call ensureNextKeyPrePublished() first.');
  const currentActive = await db.select().from(schema.federationSigningKeys).where(eq(schema.federationSigningKeys.status, 'active')).limit(1);
  if (currentActive.length > 0) {
    await db.update(schema.federationSigningKeys).set({ status: 'retired', retiredAt: new Date() }).where(eq(schema.federationSigningKeys.id, currentActive[0].id));
  }
  const [promoted] = await db.update(schema.federationSigningKeys).set({ status: 'active', activatedAt: new Date() }).where(eq(schema.federationSigningKeys.id, next.id)).returning();
  return promoted as SigningKeyRow;
}

// Signs `${timestamp}.${rawBody}` with the active key's private key,
// exactly as the plan specifies for webhook delivery verification.
export function signPayload(privateKeyRefB64: string, timestamp: string, rawBody: string): string {
  const privateKey = crypto.createPrivateKey({ key: Buffer.from(privateKeyRefB64, 'base64'), format: 'der', type: 'pkcs8' });
  const signature = crypto.sign(null, Buffer.from(`${timestamp}.${rawBody}`), privateKey);
  return signature.toString('base64');
}
