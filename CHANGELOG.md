# Changelog

## API versioning policy

`/api/v1/*` is the stable, versioned surface for external integrations (a
transparent rewrite to the same handlers as `/api/*` — see `server.ts`).

- **Stable**: existing fields and endpoints under `/v1` will not be removed
  or change meaning.
- **Additive changes** (new optional fields, new endpoints) may ship to
  `/v1` at any time without a version bump.
- **Breaking changes** ship as `/v2` first. `/v1` keeps running in parallel
  for an announced deprecation window — never silently changed in place.

The full endpoint reference is served live at `/api/docs` (Swagger UI) and
`/api/openapi.json`.

## Unreleased

- **Fixed**: service worker (`apps/admin/public/sw.js`) served navigation
  requests (full page loads / route entries) via stale-while-revalidate,
  which meant a browser could get permanently stuck on an old cached bundle
  after a deploy — surviving even a hard refresh, since an active service
  worker intercepts requests before the browser's own cache logic runs.
  Navigations are now network-first; caching is offline-fallback only.
- **Added**: machine-to-machine API keys (`POST /api/tenant/service-accounts`)
  for partner integrations that shouldn't require a human login — scoped to
  an explicit, caller-bounded privilege list.
- **Added**: webhook subscriptions (`POST /api/tenant/webhooks`) for
  `attendance.checked_in`, `attendance.checked_out`, `leave.requested`,
  `leave.approved`, and `leave.rejected` — HMAC-SHA256-signed deliveries so
  partner apps can react to events instead of polling.
- **Added**: dependency vulnerability audit (`pnpm audit --audit-level=high`)
  to CI, gating merges on high/critical findings.
- **Fixed**: `nodemailer` bumped 6.9.13 → 9.0.3, resolving two high-severity
  CVEs (an SSRF/arbitrary-file-read via the raw-message option, and a DoS in
  address parsing).
- **Added**: documented rate limits and the versioning policy above in the
  OpenAPI spec's top-level description.
