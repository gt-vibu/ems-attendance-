# Smart Teams — Enterprise Attendance Verification Engine

A multi-tenant HRMS attendance module that verifies check-ins via GPS
geofencing, browser-based face recognition (liveness + identity match), and
Wi-Fi/network context, backed by a policy-driven Express + PostgreSQL
backend.

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
  face-recognition/  # Thin wrapper around @vladmandic/face-api
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

## Face recognition service

Face detection, identity matching, and liveness scoring all happen
server-side in a separate Python microservice — see
`services/face-service/README.md`. The browser's only job during KYC
enrollment or attendance check-in is to capture a few plain JPEG frames from
the camera and upload them; there's no ML model download or WebGL
requirement client-side at all, which is what makes this work reliably on
any device.

To run it:

```
cd services/face-service
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001
```

Then set `FACE_SERVICE_URL` in `.env` (defaults to `http://127.0.0.1:8001`).
If this service isn't running, KYC and face-verified check-in will return a
clear "face verification service unavailable" error rather than crashing
the main app — but nobody can complete those steps until it's back up.

## Security notes

- Passwords are bcrypt-hashed. Any pre-existing plaintext rows from before
  this was added are transparently upgraded to a hash the next time that
  user logs in successfully.
- Dev-only convenience controls (camera/GPS/Wi-Fi bypass buttons used for
  testing without a webcam) are compiled out of production builds via
  `import.meta.env.DEV` and are never present in `pnpm build` output.
- Never commit `.env` or `db_fallback.json` — both are already git-ignored.
