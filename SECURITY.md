# Security Policy

## Reporting a vulnerability

If you find a security issue in this codebase, please report it privately
rather than opening a public GitHub issue — email the maintainer directly
(see the repository's contact info) with:

- A description of the issue and its impact
- Steps to reproduce
- Any relevant logs, requests, or proof-of-concept code

We'll acknowledge reports within a few business days and aim to ship a fix
before any public disclosure.

## Supported versions

Only the `main` branch / latest deployed release is supported with security
fixes. There are no maintained older versions.

## What's already in place

- Passwords and service-account API keys are bcrypt-hashed (`password.ts`);
  raw secrets are never stored or logged.
- JWT sessions expire after 24h and are additionally revocable server-side
  via a single active-session-per-user check (`activeSessionId` on
  `users`, enforced in `api/middleware/authenticate.ts`).
- The app refuses to start in production without a real `JWT_SECRET` or a
  reachable Postgres instance — no silent fallback to an insecure default
  or a non-durable datastore under live traffic (see `db.ts`, `jwt.ts`).
- CORS is opt-in per origin via `CORS_ALLOWED_ORIGINS` (default: same-origin
  only).
- Rate limiting on all `/api/*` routes, with a tighter limit specifically on
  `/auth/login` to slow brute-force attempts.
- `pnpm audit --audit-level=high` runs in CI on every PR — a high/critical
  dependency vulnerability blocks the merge.
- The audit ledger (`audit_ledger` table) is a hash-chained, tamper-evident
  log of privileged actions (see `api/services/audit.ts`).

## Dependency updates

Run `pnpm audit` locally before adding new dependencies. CI will catch
high/critical findings, but moderate/low findings are not gated — review
`pnpm audit`'s output periodically rather than relying solely on CI.

## Reporting scope

This covers the application code in this repository. Issues in third-party
services this app integrates with (SMTP/Resend, Google OAuth, the
face-recognition microservice's own dependencies) should be reported to
those projects directly, though we'd appreciate knowing about them too if
they affect this app's users.
