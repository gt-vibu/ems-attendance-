# Deployment Guide — Smart Teams / AMSSS

Production deployment for the full stack. Nothing here changes application
behavior; it documents how to run the existing app safely in production.

## Stack

| Component      | What it is                                   | Port |
| -------------- | -------------------------------------------- | ---- |
| `admin`        | Express API + bundled React SPA (one image)  | 3000 |
| `postgres`     | PostgreSQL 16 (system of record)             | 5432 |

The admin app resolves Postgres vs. its local JSON fallback **once at startup**.
In production (`NODE_ENV=production`) it **refuses to start** if Postgres is
unreachable — it never silently serves off the JSON file. It also refuses to
start if `JWT_SECRET` is unset. Both are intentional production safeguards.

---

## 1. Environment variables

Copy `.env.example` to `.env` and fill it in. `.env` is gitignored — never
commit it.

**Required in production**

| Variable             | Notes                                                        |
| -------------------- | ------------------------------------------------------------ |
| `NODE_ENV`           | `production` (set for you in docker-compose / Dockerfile)    |
| `JWT_SECRET`         | Long random string. `openssl rand -base64 48`. **App won't start without it.** |
| `SQL_HOST`           | Postgres host                                                |
| `SQL_PORT`           | Postgres port (default 5432)                                 |
| `SQL_ADMIN_USER`     | Postgres user                                                |
| `SQL_ADMIN_PASSWORD` | Postgres password                                            |
| `SQL_DB_NAME`        | Database name                                                |
| `APP_BASE_URL`       | Public URL of the app — used in activation/reset email links, and as the WebAuthn origin/rpID |

**Optional**

| Variable                                   | Purpose                                             |
| ------------------------------------------ | --------------------------------------------------- |
| `PORT`                                     | Override listen port (default 3000)                 |
| `CORS_ALLOWED_ORIGINS`                     | Comma-separated allowlist for cross-origin API use  |
| `RESEND_API_KEY`, `RESEND_FROM`            | Email via Resend (preferred for production)         |
| `SMTP_HOST/PORT/USER/PASS/FROM`            | Email via SMTP (e.g. Gmail app password)            |
| `SEED_SUPER_ADMIN_EMAIL/PASSWORD`          | First-run super-admin bootstrap                     |
| `GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_ID`| Google Sign-in (existing accounts only)             |
| `NOMINATIM_URL` / `NOMINATIM_USER_AGENT`   | Optional overrides for WFH reverse geocoding (free OpenStreetMap; no key) |
| `WEBAUTHN_RP_NAME` / `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` | Override WebAuthn relying-party identity; defaults derive from `APP_BASE_URL` |

### Generate strong secrets

```bash
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 24   # SQL_ADMIN_PASSWORD
```

> ⚠️ If the values currently in `.env` were ever shared, rotate them. The
> Gmail app password and DB password especially.

---

## 2. Database migrations

The app auto-syncs its schema at startup (idempotent `CREATE TABLE IF NOT
EXISTS` / `ALTER TABLE`), so it boots correctly on a fresh database with no
extra step. For a versioned, reviewable, rollback-aware history going forward:

```bash
# Generate SQL migration files from the Drizzle schema (writes packages/database/drizzle/)
pnpm db:generate

# Apply pending migrations to the configured database
pnpm db:migrate
```

Run `pnpm db:migrate` as a release step (before the new app version starts) once
you adopt migrations. Until then, the startup sync keeps things working.

### Super admin account

On a **fresh** database the app auto-creates a single super admin at startup
from `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` in `.env` — no manual
step, and since the DB is new it's the only super admin.

To **enforce/reset** the super admin on an existing database (guarantees the
credentials and removes any other super_admins so exactly one remains), run from
any machine with this repo and network access to the database, with the `SQL_*`
vars pointed at it:

```bash
pnpm seed:superadmin
```

Credentials are read from `.env` (never hardcoded), so update `.env` and re-run
to rotate the password.

---

## 3. Deploy — pick one path

### Path A — Docker Compose on a VPS (recommended; matches your setup)

Least-effort path to production. Works on any host with Docker (a $5–10/mo VPS
is plenty to start). Managed backups are your responsibility here (see below).

```bash
# On the server:
git clone <your-repo> && cd amsss-main
cp .env.example .env && nano .env      # fill in real values
docker compose up -d --build
docker compose ps                      # all services should become "healthy"
docker compose logs -f admin           # watch startup; note the seeded admin password on first run
```

- Data persists in the `postgres_data` Docker volume across restarts.
- **Backups:** `docker compose exec postgres pg_dump -U "$SQL_ADMIN_USER" "$SQL_DB_NAME" > backup.sql` on a cron.

#### Automatic HTTPS with Caddy (recommended)

The repo includes a Caddy reverse proxy that gets and auto-renews a Let's
Encrypt certificate with **zero manual cert steps**. To use it:

1. Point your domain's DNS **A/AAAA record** at the server's IP.
2. In `.env` set `DOMAIN=your-domain.com`, `ACME_EMAIL=you@example.com`, and
   `APP_BASE_URL=https://your-domain.com`.
3. Bring the stack up with the production overlay:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   ```

Caddy listens on 80/443 (HTTP auto-redirects to HTTPS) and proxies to the admin
app over the internal network. The overlay also rebinds admin's port 3000 to
`127.0.0.1` only, so the app is reachable publicly *only* through HTTPS.
Certificates persist in the `caddy_data` volume — keep it.

> Ports 80 and 443 must be open to the internet for the certificate challenge
> to succeed.

### Path B — Render (managed Postgres + backups)

`render.yaml` in the repo root is a Render Blueprint that provisions Postgres
and the public admin service.

1. Push the repo to GitHub.
2. Render dashboard → **New → Blueprint** → select the repo.
3. After the first deploy, open the **admin** service → **Environment** and set
   the `sync: false` vars (`APP_BASE_URL` = the service's public URL, plus
   email/OAuth secrets).
4. `JWT_SECRET` and all DB vars are wired automatically.

Managed daily Postgres backups are included on paid database plans.

### Path C — Fly.io

`fly.toml` (repo root) configures the admin app. Postgres is a separate Fly
resource.

```bash
fly launch --no-deploy                     # create the admin app from fly.toml (rename the app first)
fly postgres create                        # managed Postgres cluster
fly postgres attach <cluster>              # exposes DATABASE_URL to the app
# Map the connection into the SQL_* vars the app uses, plus other secrets:
fly secrets set \
  JWT_SECRET="$(openssl rand -base64 48)" \
  SQL_HOST=<cluster>.internal SQL_PORT=5432 \
  SQL_ADMIN_USER=<user> SQL_ADMIN_PASSWORD=<pass> SQL_DB_NAME=<db> \
  APP_BASE_URL=https://<app>.fly.dev

fly deploy                                 # deploy the admin app
```

> Don't put the Express **server** on serverless functions (Vercel/Netlify
> Functions) — the long-lived process and the background scheduler don't fit
> the function model. Hosting the **static frontend** on Vercel is fine and
> is exactly what Path D does.

### Path D — Split: Vercel + Render + Neon

Each piece on a managed service, all from this **one monorepo** (no repo
splitting). Request flow: browser loads the SPA from **Vercel** → the SPA calls
the API on **Render** directly (`VITE_API_BASE_URL`, CORS-allowed) → Render talks
to **Neon** Postgres (TLS).

Deploy in this order (each step needs the previous one's URL/creds):

**1) Neon (database).** Create a project at neon.tech. From its connection
string note: host (`ep-...aws.neon.tech`), user, password, database (e.g.
`neondb`), port 5432. These become the `SQL_*` vars on Render with `SQL_SSL=true`.

**2) Render (backend/API).** New → **Web Service** → this repo. Runtime
**Docker**, Dockerfile `apps/admin/Dockerfile`, context `.` (repo root), health
check path `/api/health`. No start command (the Dockerfile handles it). Set the
Render env vars listed below.

**3) Vercel (frontend).** New Project → import this repo, **Root Directory = repo
root** (the committed `vercel.json` builds `apps/admin`). Set the Vercel env vars
below (`VITE_API_BASE_URL` = the Render URL) and deploy. Then copy the Vercel URL
and set it as `CORS_ALLOWED_ORIGINS` **and** `APP_BASE_URL` on Render, and
redeploy Render.

**4) Migrate + seed Neon.** From your machine (repo cloned, `.env` pointing at
Neon with `SQL_SSL=true`):
```bash
pnpm db:migrate        # create tables in Neon
pnpm seed:superadmin   # create the single super admin
```

#### Render env vars (backend)
```
NODE_ENV=production
JWT_SECRET=<openssl rand -base64 48>
SQL_HOST=<neon host>
SQL_PORT=5432
SQL_ADMIN_USER=<neon user>
SQL_ADMIN_PASSWORD=<neon password>
SQL_DB_NAME=<neon database>
SQL_SSL=true
APP_BASE_URL=<your vercel url>
CORS_ALLOWED_ORIGINS=<your vercel url>
SEED_SUPER_ADMIN_EMAIL=vibudarshan1717@gmail.com
SEED_SUPER_ADMIN_PASSWORD=Bakyalakshmi@18
# email — pick one:
RESEND_API_KEY=...      RESEND_FROM=...
# or: SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM
# optional: GOOGLE_CLIENT_ID (Google Sign-In only)
```
Do **not** set `PORT` — Render injects it and the app honors it automatically.

#### Vercel env vars (frontend, build-time)
```
VITE_API_BASE_URL=<your render backend url>    # e.g. https://smartteams-admin.onrender.com
VITE_GOOGLE_CLIENT_ID=<google client id>       # only if using Google Sign-In
```
These are inlined at build time — **redeploy after changing them**.

#### Keep it warm (fight cold-start lag)
Free tiers sleep. Add a repo **Variable** (Settings → Secrets and variables →
Actions → Variables): `BACKEND_URL` = Render URL. The committed
`.github/workflows/keepalive.yml` then pings `/api/health/db` every ~5 min,
which warms Render **and** Neon. For tighter, more reliable intervals, point
UptimeRobot or cron-job.org at the same URL.

#### Honest note on "no lag"
- **Vercel frontend:** genuinely fast, no cold start.
- **Backend / DB on free tiers:** subject to cold starts. Keep-alive greatly
  reduces this but isn't a 100% guarantee (GitHub's scheduler drifts). For a
  hard guarantee, a paid always-on Render instance removes the last of the
  lag — a few dollars/month.

---

## 4. Scaling notes

- **Scheduler is fleet-safe.** Background jobs (break scans, daily crons, alert
  emails) run on exactly one instance via a Postgres advisory lock; other
  replicas stand by and take over automatically if the leader dies. You can run
  multiple `admin` replicas without duplicate emails/jobs.
- **Graceful shutdown** is handled (SIGTERM/SIGINT drains in-flight requests and
  closes the DB pool) so rolling deploys don't drop connections.
- **Postgres connection pool:** the app pools up to 20 connections per instance
  — keep `instances × 20` under your Postgres `max_connections`.

---

## 5. Post-deploy checklist

- [ ] `GET /api/health` returns `{"status":"ok"}`
- [ ] `/api/docs` (Swagger UI) loads
- [ ] Logs show `Connected to Postgres` — **not** the JSON fallback warning
- [ ] First-run super-admin password captured from logs (or set via `SEED_*`)
- [ ] Logged in, changed the seeded password
- [ ] A test email actually sends (Resend/SMTP configured)
- [ ] Device registration ("Register This Device") and WebAuthn check-in work end-to-end over HTTPS (WebAuthn requires a secure origin, `localhost` excepted)
- [ ] `.env` is **not** in version control (`git check-ignore .env` prints the path)
- [ ] Secrets rotated from any values previously shared
- [ ] Postgres backups scheduled
