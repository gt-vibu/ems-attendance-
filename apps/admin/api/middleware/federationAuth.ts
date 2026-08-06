import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../db';
import { verifyFederationAccessToken } from '../auth/federationClients';
import { isPlatformFeatureAllowedForTenant } from '../auth/rbac';
import { resolveMappingByExternalId, type FederationEntityType } from '../services/federation/externalId';

// Gate for every /v1/federation/* route except the token endpoint itself
// and the unauthenticated infra probes (health/live, health/ready). Verifies
// the OAuth 2.1 client-credentials bearer token issued by
// POST /v1/federation/oauth/token, confirms the issuing client is still
// active, and confirms the tenant has actually opted into the
// 'smartteams_federation' platform feature — a federation client whose
// tenant later has the feature turned off is authenticated but immediately
// refused, not silently still-working.
//
// mTLS: TLS client-certificate verification happens at the TLS termination
// layer (reverse proxy / load balancer / Node https server's
// `requestCert`+`ca` options), not inside Express route middleware — this
// hook only checks for the peer-certificate metadata a correctly configured
// termination layer forwards. It used to be a silent no-op unless
// FEDERATION_REQUIRE_MTLS=true was explicitly set, which is exactly what
// P1 of the code review flagged: "mTLS is optional and trusts
// x-client-cert-verified, which is spoofable unless the application is
// unreachable except through a trusted TLS terminator." Mirroring the same
// fail-closed pattern jwt.ts already uses for JWT_SECRET: in
// staging/production this now throws at module load (refusing to start)
// unless mTLS enforcement has been explicitly and correctly configured,
// rather than silently accepting unauthenticated traffic. In any other
// NODE_ENV (local dev, the sandbox exception the plan documents, test) it
// stays off by default so nothing here needs real certificates provisioned
// first.
const MTLS_REQUIRED_ENVIRONMENTS = new Set(['production', 'staging']);

function resolveMtlsRequirement(): boolean {
  const nodeEnv = process.env.NODE_ENV || '';
  const explicit = process.env.FEDERATION_REQUIRE_MTLS;

  if (explicit === 'true') return true;

  if (MTLS_REQUIRED_ENVIRONMENTS.has(nodeEnv)) {
    throw new Error(
      `FATAL: NODE_ENV=${nodeEnv} but FEDERATION_REQUIRE_MTLS is not set to 'true'. ` +
      'mTLS is mandatory for the /v1/federation/* provider API in staging/production ' +
      '(a bearer token alone is not enough — see the code review\'s mTLS finding). ' +
      'Configure the TLS terminator in front of this app to require and forward client ' +
      'certificates, set FEDERATION_REQUIRE_MTLS=true, and set FEDERATION_MTLS_PROXY_SECRET ' +
      'to a long random value shared only with that trusted terminator.'
    );
  }

  return false;
}

const FEDERATION_MTLS_REQUIRED = resolveMtlsRequirement();

// When mTLS is required, a request can only be considered verified two
// ways: (1) this Node process itself terminated TLS with requestCert/ca
// and the socket says so (req.socket.authorized), or (2) a trusted reverse
// proxy terminated TLS and forwards x-client-cert-verified — but that
// header alone is trivially spoofable by anyone who can reach this process
// directly (the exact P1 finding). So path (2) additionally requires a
// shared secret header only the trusted proxy is configured to send,
// compared in constant time. An external caller that knows neither the
// secret nor can reach the app bypassing the proxy cannot forge this.
const FEDERATION_MTLS_PROXY_SECRET = process.env.FEDERATION_MTLS_PROXY_SECRET || '';
if (FEDERATION_MTLS_REQUIRED && !FEDERATION_MTLS_PROXY_SECRET) {
  throw new Error(
    'FATAL: FEDERATION_REQUIRE_MTLS=true but FEDERATION_MTLS_PROXY_SECRET is not set. ' +
    'Without it, the x-client-cert-verified header a proxy-terminated mTLS request relies ' +
    'on would be trivially spoofable by any caller that can reach this process directly.'
  );
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function checkMtls(req: any): string | null {
  if (!FEDERATION_MTLS_REQUIRED) return null;

  const socketVerified = req.socket?.authorized === true;
  const headerSecret = req.headers['x-federation-mtls-proxy-secret'];
  const proxyVerified =
    typeof headerSecret === 'string' &&
    headerSecret.length > 0 &&
    timingSafeStringEqual(headerSecret, FEDERATION_MTLS_PROXY_SECRET) &&
    req.headers['x-client-cert-verified'] === 'true';

  if (!socketVerified && !proxyVerified) {
    return 'mTLS client certificate verification failed or was not presented.';
  }
  return null;
}

export async function authenticateFederation(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization token required.', code: 'UNAUTHORIZED' });
  }

  const mtlsError = checkMtls(req);
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

  // Platform-wide clients (issued with tenantId: null — see
  // federationClients.ts, "Nullable: global platform apps are not
  // tenant-bound") are not bound to any single tenant at token-issue time.
  // There is no fixed tenant here to check the feature flag against yet —
  // that happens per-request in resolveFederationTenantContext() below,
  // once the target tenant has actually been resolved from the request's
  // own external IDs. A per-tenant client (decoded.tenantId is a real
  // number) still gets checked immediately, same as before.
  if (decoded.tenantId !== null && decoded.tenantId !== undefined) {
    const federationEnabled = await isPlatformFeatureAllowedForTenant(decoded.tenantId, 'smartteams_federation');
    if (!federationEnabled) {
      return res.status(403).json({ error: 'SmartTeams Federation is not enabled for this organization.', code: 'FEDERATION_NOT_ENABLED' });
    }
  }

  req.federation = {
    clientDbId: decoded.federationClientDbId,
    clientId: decoded.clientId,
    tenantId: decoded.tenantId ?? null,
    isPlatformClient: decoded.tenantId === null || decoded.tenantId === undefined,
    scopes: decoded.scopes,
  };
  next();
}

// Applied AFTER authenticateFederation on every domain route (attendance,
// employees, leave, payroll) that identifies its target by external id.
// A per-tenant client already has req.federation.tenantId fixed — this is a
// no-op for it. A platform client (tenantId null) instead derives which
// tenant this specific request targets by looking up whichever external id
// the request actually carries (branch → employee → organization, most
// specific first) against federation_external_id_mappings, which is
// globally unique per (entityType, externalId) — see
// resolveMappingByExternalId(). This is what makes a single platform
// credential able to operate across many provisioned tenants (hotels)
// instead of being permanently pinned to whichever tenant happened to be
// set at token-issue time.
//
// Deliberately NOT applied to PUT /v1/federation/tenants/:externalOrganizationId
// — that route is how a platform client provisions a BRAND NEW tenant, so by
// definition no mapping exists yet to resolve; it does its own tenant
// creation/lookup instead (see routes/federation/tenants.routes.ts).
export function resolveFederationTenantContext() {
  return async (req: any, res: any, next: any) => {
    if (!req.federation?.isPlatformClient) {
      // Per-tenant client: tenantId was already fixed at token-issue time.
      return next();
    }

    const pick = (key: string): string | undefined =>
      req.params?.[key] || req.body?.[key] || req.query?.[key];

    const candidates: Array<{ type: FederationEntityType; id: string | undefined }> = [
      { type: 'branch', id: pick('externalBranchId') },
      { type: 'employee', id: pick('externalEmployeeId') },
      { type: 'tenant', id: pick('externalOrganizationId') },
    ];

    let resolvedTenantId: number | null = null;
    for (const c of candidates) {
      if (!c.id) continue;
      const mapping = await resolveMappingByExternalId(c.type, c.id);
      if (mapping) { resolvedTenantId = mapping.tenantId; break; }
    }

    // Fallback for routes identified by an already-internal aggregate id
    // instead of an external one (payroll runs: POST/.../runs/:runId/...  —
    // the run was created via a prior call this same client made, so its
    // id was never given an externalId of its own). runId's are Postgres
    // serial ids, globally unique across the whole table regardless of
    // tenant, so looking the row up directly and reading off its own
    // tenantId is unambiguous — this is not a cross-tenant guess, it's the
    // one tenant that specific run actually belongs to.
    if (resolvedTenantId === null) {
      const runId = pick('runId');
      if (runId && /^\d+$/.test(runId)) {
        const rows = await db.select({ tenantId: schema.payrollRuns.tenantId }).from(schema.payrollRuns).where(eq(schema.payrollRuns.id, Number(runId))).limit(1);
        if (rows[0]) resolvedTenantId = rows[0].tenantId;
      }
    }

    // Same reasoning as runId above, for the other two internal-id-only
    // routes: attendance corrections/decisions (POST .../attendance/
    // :attendanceId/...) and leave request cancel/decision (POST .../leave/
    // requests/:id/...) — both identify their target purely by an internal
    // serial id from a prior call's own response, never given an external
    // id of its own.
    if (resolvedTenantId === null) {
      const attendanceId = pick('attendanceId');
      if (attendanceId && /^\d+$/.test(attendanceId)) {
        const rows = await db.select({ tenantId: schema.attendanceLogs.tenantId }).from(schema.attendanceLogs).where(eq(schema.attendanceLogs.id, Number(attendanceId))).limit(1);
        if (rows[0]) resolvedTenantId = rows[0].tenantId;
      }
    }
    if (resolvedTenantId === null) {
      const leaveRequestId = pick('id');
      if (leaveRequestId && /^\d+$/.test(leaveRequestId) && String(req.path || req.originalUrl || '').includes('/leave/requests/')) {
        const rows = await db.select({ tenantId: schema.leaveRequests.tenantId }).from(schema.leaveRequests).where(eq(schema.leaveRequests.id, Number(leaveRequestId))).limit(1);
        if (rows[0]) resolvedTenantId = rows[0].tenantId;
      }
    }

    if (resolvedTenantId === null) {
      return res.status(400).json({
        error: 'This platform credential must identify a target organization. Include a valid externalOrganizationId, externalBranchId, or externalEmployeeId belonging to an already-provisioned tenant.',
        code: 'TENANT_CONTEXT_REQUIRED',
      });
    }

    const federationEnabled = await isPlatformFeatureAllowedForTenant(resolvedTenantId, 'smartteams_federation');
    if (!federationEnabled) {
      return res.status(403).json({ error: 'SmartTeams Federation is not enabled for this organization.', code: 'FEDERATION_NOT_ENABLED' });
    }

    req.federation.tenantId = resolvedTenantId;
    next();
  };
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
