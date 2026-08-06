import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../db';
import { hashPassword, verifyPassword } from '../../password';
import { signShortLivedToken, verifyToken } from '../../jwt';

// Machine credentials for the SmartTeams federation provider API
// (/v1/federation/*) — a BlizBooks server presents client_id/client_secret
// once to POST /v1/federation/oauth/token (OAuth 2.1 client-credentials
// grant) and gets back a short-lived access token to bear on every
// subsequent federation call. Mirrors service_accounts' prefix+hash
// pattern (api/auth/serviceAccounts.ts) rather than inventing a new
// credential shape: the raw secret is shown exactly once at creation and
// never stored, only its bcrypt hash.
const CLIENT_ID_PREFIX = 'fed_';
const FEDERATION_TOKEN_PURPOSE = 'federation_access';
const FEDERATION_TOKEN_TTL = '1h';

export function generateClientId(): string {
  return `${CLIENT_ID_PREFIX}${crypto.randomBytes(12).toString('base64url')}`;
}

// Returns the raw secret (shown once) plus what actually gets persisted.
export async function generateClientSecret(): Promise<{ rawSecret: string; secretHash: string }> {
  const rawSecret = crypto.randomBytes(32).toString('base64url');
  const secretHash = await hashPassword(rawSecret);
  return { rawSecret, secretHash };
}

export async function verifyClientCredentials(clientId: string, clientSecret: string): Promise<
  { id: number; tenantId: number; clientId: string; scopes: string[] } | null
> {
  if (!clientId || !clientSecret) return null;
  const rows = await db.select().from(schema.federationClients).where(
    and(eq(schema.federationClients.clientId, clientId), eq(schema.federationClients.status, 'active'))
  ).limit(1);
  if (rows.length === 0) return null;
  const client = rows[0];
  const valid = await verifyPassword(clientSecret, client.clientSecretHash);
  if (!valid) return null;

  try {
    await db.update(schema.federationClients).set({ lastUsedAt: new Date() }).where(eq(schema.federationClients.id, client.id));
  } catch { /* best effort, mirrors serviceAccounts.ts */ }

  return {
    id: client.id,
    tenantId: client.tenantId,
    clientId: client.clientId,
    scopes: Array.isArray(client.scopes) ? (client.scopes as string[]) : [],
  };
}

// Issues the short-lived bearer access token returned by
// POST /v1/federation/oauth/token — federationAuth.ts's middleware verifies
// exactly this shape.
export function issueFederationAccessToken(client: { id: number; tenantId: number; clientId: string; scopes: string[] }): { accessToken: string; expiresIn: number } {
  const accessToken = signShortLivedToken(
    { purpose: FEDERATION_TOKEN_PURPOSE, federationClientDbId: client.id, tenantId: client.tenantId, clientId: client.clientId, scopes: client.scopes },
    FEDERATION_TOKEN_TTL,
  );
  return { accessToken, expiresIn: 3600 };
}

export function verifyFederationAccessToken(token: string): { federationClientDbId: number; tenantId: number; clientId: string; scopes: string[] } | null {
  const decoded = verifyToken(token);
  if (!decoded || decoded.purpose !== FEDERATION_TOKEN_PURPOSE) return null;
  return {
    federationClientDbId: decoded.federationClientDbId,
    tenantId: decoded.tenantId,
    clientId: decoded.clientId,
    scopes: Array.isArray(decoded.scopes) ? decoded.scopes : [],
  };
}
