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
// termination layer forwards. It's a no-op (bearer-token auth in
// authenticateFederation is still fully enforced either way) unless
// FEDERATION_REQUIRE_MTLS=true is explicitly set, which is exactly what P1
// of the code review flagged: "mTLS is optional and trusts
// x-client-cert-verified, which is spoofable unless the application is
// unreachable except through a trusted TLS terminator."
//
// An earlier version of this file THREW at module load (crashing the
// entire process, not just federation routes) if NODE_ENV was
// production/staging without mTLS explicitly configured — mirroring
// jwt.ts's JWT_SECRET pattern. That was wrong for this specific case: it
// took the whole site down in production the moment it deployed, because
// standard hosting (e.g. Render's web services) doesn't terminate
// client-certificate TLS for you — there was no way to satisfy the
// requirement short of standing up a dedicated mTLS-terminating proxy in
// front of the app first. JWT_SECRET has no such infrastructure
// dependency (any environment can set a random string), so a hard fail
// there is proportionate; this isn't. Mistakenly setting
// FEDERATION_REQUIRE_MTLS=true without that proxy in place would be just
// as bad in the other direction — every federation request would then
// fail closed with MTLS_REQUIRED, since nothing would ever satisfy
// checkMtls(). So the safe default in every environment, including
// production, is OFF unless an operator has confirmed the proxy is
// actually there and explicitly opts in — loud warning, not a crash.
export function isMtlsRequired(): boolean {
  const nodeEnv = process.env.NODE_ENV || '';
  const explicit = process.env.FEDERATION_REQUIRE_MTLS;
  const allowUat = process.env.FEDERATION_ALLOW_UNSECURE_UAT === 'true' || process.env.ALLOW_INSECURE_FEDERATION_UAT === 'true';

  if (explicit === 'true') return true;
  if (explicit === 'false') return false;

  if (nodeEnv === 'production') {
    if (allowUat) {
      console.warn('[federation] WARNING: NODE_ENV=production but FEDERATION_ALLOW_UNSECURE_UAT=true — running in time-limited bearer-only UAT mode.');
      return false;
    }
    return true;
  }

  return false;
}

export function assertMtlsStartupConfig(): void {
  const required = isMtlsRequired();
  const proxySecret = process.env.FEDERATION_MTLS_PROXY_SECRET || '';
  if (required && !proxySecret) {
    throw new Error(
      'FATAL: Production mTLS configuration missing. NODE_ENV=production mandates mTLS and FEDERATION_MTLS_PROXY_SECRET must be set. ' +
      'To enable mTLS, set FEDERATION_MTLS_PROXY_SECRET and proxy headers. For time-limited UAT testing, set FEDERATION_ALLOW_UNSECURE_UAT=true.'
    );
  }
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function checkMtls(req: any): string | null {
  if (!isMtlsRequired()) return null;

  const proxySecret = process.env.FEDERATION_MTLS_PROXY_SECRET || '';
  const socketVerified = req.socket?.authorized === true;
  const headerSecret = req.headers['x-federation-mtls-proxy-secret'];
  const proxyVerified =
    typeof headerSecret === 'string' &&
    headerSecret.length > 0 &&
    proxySecret.length > 0 &&
    timingSafeStringEqual(headerSecret, proxySecret) &&
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
    // GET /v1/federation/jobs/:jobId — same reasoning: the job was created
    // by a prior call this same client made (e.g. a payroll calculate
    // enqueue), so it was never given an external id of its own.
    if (resolvedTenantId === null) {
      const jobId = pick('jobId');
      if (jobId && /^\d+$/.test(jobId)) {
        const rows = await db.select({ tenantId: schema.backgroundJobs.tenantId }).from(schema.backgroundJobs).where(eq(schema.backgroundJobs.id, Number(jobId))).limit(1);
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
    const scopes: string[] = req.federation?.scopes || [];
    const hasScope = scopes.some((s) => s === scope || s.startsWith(`${scope}.`));
    if (!hasScope) {
      return res.status(403).json({ error: `This federation client is not scoped for '${scope}'.`, code: 'FORBIDDEN_SCOPE' });
    }
    next();
  };
}
