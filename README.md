# Smart Teams — Enterprise Attendance Verification Engine

A multi-tenant HRMS attendance module that verifies check-ins via GPS
geofencing, WebAuthn device identity (Windows Hello, Touch ID, Android
biometric/PIN, or a security key), and Wi-Fi/network context, backed by a
policy-driven Express + PostgreSQL backend.

> This README replaces an earlier placeholder left over from the project's
> initial scaffold — it previously referenced an unrelated `GEMINI_API_KEY`
> that this app does not use.

## Project layout

```
apps/
  admin/        # The actual application: Express API + React (Vite) frontend, single deployable
  backend/      # Stub — not yet implemented
  mobile/       # Stub — not yet implemented
  docs/         # Stub — not yet implemented
packages/
  database/     # Drizzle ORM schema (PostgreSQL)
  ...           # Shared UI/types/utils packages
```

Almost everything currently runs out of `apps/admin` (`server.ts` is the
Express API, `src/` is the React frontend, both built together).

## Prerequisites

- Node.js 20+
- pnpm (`corepack enable` or `npm i -g pnpm`)
- PostgreSQL, **or** skip it entirely for local testing — see below.

## 1. Install dependencies

```
pnpm install
```

## 2. Configure environment

```
cp .env.example .env
```

Then fill in `.env`:
- **Database**: point `SQL_HOST`/`SQL_ADMIN_USER`/`SQL_ADMIN_PASSWORD`/`SQL_DB_NAME`
  at a real Postgres instance for anything beyond a quick demo. If Postgres
  isn't reachable at `SQL_HOST`, the app automatically falls back to a local
  `db_fallback.json` file — convenient for trying things out, **not**
  suitable for production or multi-user testing.
- **JWT_SECRET**: set a long random string.
- **Email**: configure either Resend (`RESEND_API_KEY` + a domain-verified
  `RESEND_FROM`) or Gmail SMTP (`SMTP_USER` + a Gmail **App Password** in
  `SMTP_PASS`, not your normal password). If neither is configured, outgoing
  emails are written to `apps/admin/emails/*.txt` instead of being sent, so
  nothing is silently lost during local development.
- **Super admin bootstrap**: leave `SEED_SUPER_ADMIN_*` blank to have the
  server generate and print a one-time random password to the console on
  first run (you'll be forced to change it at first login).

## 3. Run locally

```
pnpm --filter @company/admin dev
```

This starts the Express API and Vite dev server together on
`http://localhost:3000` (see `apps/admin/server.ts`).

## 4. Production build

```
pnpm --filter @company/admin build
pnpm --filter @company/admin start
```

`build` compiles the frontend and bundles the server to
`apps/admin/dist/server.cjs`; `start` runs that bundle with plain `node`.

## Device identity verification (WebAuthn)

Identity is proven with WebAuthn/passkeys instead of a face-recognition ML
model. "Register This Device" (`POST /api/webauthn/register/*`) creates a
public-key credential using the device's own secure hardware — Windows
Hello, Touch ID, Android biometric/PIN, or a roaming security key. Daily
check-in (`POST /api/webauthn/authenticate/*`) is a signed challenge-response
against that credential. The server never receives or stores any biometric
data — only a public key per device — and there's no ML model, no separate
microservice, and no camera permission required. See
`apps/admin/api/services/webauthn.ts` and `apps/admin/api/routes/webauthn.routes.ts`.

## Security notes

- Passwords are bcrypt-hashed. Any pre-existing plaintext rows from before
  this was added are transparently upgraded to a hash the next time that
  user logs in successfully.
- Dev-only convenience controls (camera/GPS/Wi-Fi bypass buttons used for
  testing without a webcam) are compiled out of production builds via
  `import.meta.env.DEV` and are never present in `pnpm build` output.
- Never commit `.env` or `db_fallback.json` — both are already git-ignored.
