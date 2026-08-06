import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../db';
import { verifyFederationAccessToken } from '../auth/federationClients';
import { isPlatformFeatureAllowedForTenant } from '../auth/rbac';

// Gate for every /v1/federation/* route except the token endpoint itself
// and the unauthenticated infra probes (health/live, health/ready). Verifies
// the OAuth 2.1 client-credentials bearer token issued by
// POST /v1/federation/oauth/token, confirms the issuing client is still
// active, and confirms the tenant has actually opted into the
// 'smartteams_federation' platform feature — a federation client whose
// tenant later has the feature turned off is authenticated but immediately
// refused, not silently still-working.
//
// mTLS: the plan requires mutual TLS in production/staging in addition to
// this bearer token. TLS client-certificate verification happens at the
// TLS termination layer (the reverse proxy / load balancer / Node https
// server's `requestCert`+`ca` options), not inside Express route
// middleware — this hook only checks for the peer-certificate metadata a
// correctly configured termination layer forwards, and is a no-op (never
// blocks a request) unless FEDERATION_REQUIRE_MTLS=true is explicitly set,
// so this compiles and runs correctly in any environment (including local
// dev and the sandbox exception the plan itself documents) without needing
// real certificates provisioned first.
function checkOptionalMtls(req: any): string | null {
  if (process.env.FEDERATION_REQUIRE_MTLS !== 'true') return null;
  const verified = req.socket?.authorized === true || req.headers['x-client-cert-verified'] === 'true';
  if (!verified) return 'mTLS client certificate verification failed or was not presented.';
  return null;
}

export async function authenticateFederation(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization token required.', code: 'UNAUTHORIZED' });
  }

  const mtlsError = checkOptionalMtls(req);
  if (mtlsError) {
    return res.status(401).json({ error: mtlsError, code: 'MTLS_REQUIRED' });
  }

  const token = authHeader.slice(7);
  const decoded = verifyFederationAccessToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired federation access token.', code: 'UNAUTHORIZED' });
  }

  const clientRows = await db.select().from(schema.federationClients).where(
    and(eq(schema.federationClients.id, decoded.federationClientDbId), eq(schema.federationClients.status, 'active'))
  ).limit(1);
  if (clientRows.length === 0) {
    return res.status(401).json({ error: 'Federation client is revoked or no longer exists.', code: 'UNAUTHORIZED' });
  }

  const federationEnabled = await isPlatformFeatureAllowedForTenant(decoded.tenantId, 'smartteams_federation');
  if (!federationEnabled) {
    return res.status(403).json({ error: 'SmartTeams Federation is not enabled for this organization.', code: 'FEDERATION_NOT_ENABLED' });
  }

  req.federation = {
    clientDbId: decoded.federationClientDbId,
    clientId: decoded.clientId,
    tenantId: decoded.tenantId,
    scopes: decoded.scopes,
  };
  next();
}

// Per-endpoint scope gate, e.g. requireFederationScope('attendance') —
// analogous to hasPrivilege() for human callers, but checked against the
// scopes granted to this federation client at token-issue time.
export function requireFederationScope(scope: string) {
  return (req: any, res: any, next: any) => {
    if (!req.federation?.scopes?.includes(scope)) {
      return res.status(403).json({ error: `This federation client is not scoped for '${scope}'.`, code: 'FORBIDDEN_SCOPE' });
    }
    next();
  };
}
