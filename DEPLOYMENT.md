# Deployment Guide — Smart Teams / AMSSS

Production deployment for the full stack. Nothing here changes application
behavior; it documents how to run the existing app safely in production.

## Stack

| Component      | What it is                                   | Port |
| -------------- | -------------------------------------------- | ---- |
| `admin`        | Express API + bundled React SPA (one image)  | 3000 |
| `face-service` | Python face detection/recognition/liveness   | 8001 |
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
| `FACE_SERVICE_URL`   | URL of the face-service (e.g. `http://face-service:8001`)    |
| `APP_BASE_URL`       | Public URL of the app — used in activation/reset email links |

**Optional**

| Variable                                   | Purpose                                             |
| ------------------------------------------ | --------------------------------------------------- |
| `PORT`                                     | Override listen port (default 3000)                 |
| `CORS_ALLOWED_ORIGINS`                     | Comma-separated allowlist for cross-origin API use  |
| `RESEND_API_KEY`, `RESEND_FROM`            | Email via Resend (preferred for production)         |
| `SMTP_HOST/PORT/USER/PASS/FROM`            | Email via SMTP (e.g. Gmail app password)            |
| `SEED_SUPER_ADMIN_EMAIL/PASSWORD`          | First-run super-admin bootstrap                     |
| `GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_ID`| Google Sign-in (existing accounts only)             |
| `GOOGLE_MAPS_API_KEY`                      | Reverse geocoding for WFH home addresses (cosmetic) |
| `FACE_SERVICE_WORKERS`                     | face-service uvicorn workers (default 1; ~1GB RAM each) |

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

`render.yaml` in the repo root is a Render Blueprint that provisions Postgres,
the private face-service, and the public admin service.

1. Push the repo to GitHub.
2. Render dashboard → **New → Blueprint** → select the repo.
3. After the first deploy, open the **admin** service → **Environment** and set
   the `sync: false` vars (`APP_BASE_URL` = the service's public URL, plus
   email/OAuth secrets).
4. `JWT_SECRET` and all DB vars are wired automatically.

Managed daily Postgres backups are included on paid database plans.

### Path C — Fly.io

`fly.toml` (repo root) configures the admin app. Postgres and the face-service
are separate Fly resources.

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

# Deploy the face-service as its own Fly app:
cd services/face-service && fly launch --no-deploy --name smartteams-face-service && fly deploy && cd -

fly deploy                                 # deploy the admin app
```

> Avoid pure serverless (Vercel/Netlify functions): the long-lived Express
> server, the Python face-service, and the background scheduler don't fit the
> function model.

---

## 4. Scaling notes

- **Scheduler is fleet-safe.** Background jobs (break scans, daily crons, alert
  emails) run on exactly one instance via a Postgres advisory lock; other
  replicas stand by and take over automatically if the leader dies. You can run
  multiple `admin` replicas without duplicate emails/jobs.
- **Graceful shutdown** is handled (SIGTERM/SIGINT drains in-flight requests and
  closes the DB pool) so rolling deploys don't drop connections.
- **face-service memory:** each uvicorn worker loads a full ~1GB model bundle.
  Scale it with RAM in mind; raise `FACE_SERVICE_WORKERS` only if the host has
  the cores/RAM for concurrent check-in throughput.
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
- [ ] Face check-in flow works end-to-end against the face-service
- [ ] `.env` is **not** in version control (`git check-ignore .env` prints the path)
- [ ] Secrets rotated from any values previously shared
- [ ] Postgres backups scheduled
