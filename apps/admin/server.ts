import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { detectPostgres, closeDb } from './db';
import { logger, requestLogger } from './logger';
import { verifyAndSyncDatabase, seedSuperAdmin } from './api/bootstrap/database';
import { assertFederationAuthStartupConfig } from './api/middleware/federationAuth';
import { startSchedulerWithLeadership } from './api/bootstrap/scheduler';
import { generalLimiter } from './api/middleware/rateLimit';
import { registerRoutes } from './api/routes';
import { initMonitoring, captureException } from './api/services/monitoring';

initMonitoring();

// Last-resort safety nets: without these, an error thrown outside any
// request handler's try/catch (e.g. inside a fire-and-forget async task, a
// timer callback, or a rejected promise nobody awaited) crashes the entire
// Node process and drops every connected user, not just the one operation
// that failed. Logging and continuing is far safer for a multi-user server
// than letting the whole process die on an isolated bug.
process.on('uncaughtException', (err) => {
  captureException(err, { source: 'uncaughtException' });
});
process.on('unhandledRejection', (reason) => {
  captureException(reason, { source: 'unhandledRejection' });
});

async function startServer() {
  assertFederationAuthStartupConfig();
  const app = express();
  // Honor a platform-injected PORT (Render/Fly/Heroku set this) but keep 3000
  // as the default so local dev and the existing Docker/compose setup are
  // unchanged.
  const PORT = Number(process.env.PORT) || 3000;

  // Root health check endpoint for cloud orchestrators & Render port scanners
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Structured per-request logging (method, path, status, latency) — first in
  // the chain so it times the whole request. JSON lines in production.
  app.use(requestLogger);

  // CSP is only enabled in production: dev mode runs behind Vite's own
  // middleware (HMR client injection, inline React-refresh preamble), which
  // a CSP would break — see the NODE_ENV branch below that swaps in Vite
  // vs. the static production build. Scoped to what this app's frontend
  // actually loads: same-origin scripts/API calls (the JWT-in-localStorage
  // exposure this closes a backstop for), Tailwind's runtime inline styles,
  // the OpenStreetMap tile layer (LocationPicker.tsx) and data:/blob: image
  // sources (QR codes, document downloads), and the PWA service worker
  // (main.tsx / public/sw.js). No remote script sources are allowed — that's
  // the actual XSS backstop this exists for.
  const isProd = process.env.NODE_ENV === 'production';
  app.use(helmet({
    contentSecurityPolicy: isProd ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: [],
      },
    } : false,
    crossOriginEmbedderPolicy: false,
  }));

  const corsAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
  app.use(cors({
    origin: corsAllowedOrigins.length === 0
      ? undefined // same-origin only (no Access-Control-Allow-Origin header sent)
      : corsAllowedOrigins.includes('*')
        ? true
        : corsAllowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  app.use(express.json({ limit: '25mb' }));
  // OAuth 2.1 client-credentials token requests (POST /v1/federation/oauth/token)
  // are required by RFC 6749 §4.4 to use application/x-www-form-urlencoded —
  // and it's what virtually every off-the-shelf OAuth client library sends by
  // default. Without this, that body was silently never parsed: req.body was
  // always {}, so a spec-correct partner call failed with a misleading
  // "unsupported_grant_type" instead of ever reaching the actual grant-type
  // check. json() alone was never enough for an OAuth-shaped endpoint.
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));

  app.use((req, _res, next) => {
    if (req.url.startsWith('/api/v1/')) {
      req.url = req.url.replace('/api/v1/', '/api/');
    } else if (req.url === '/api/v1') {
      req.url = '/api';
    }
    next();
  });
  app.use('/api/', generalLimiter);

  // Every API route, grouped by domain under api/routes/*. Mounted before the
  // Resolve real-Postgres-vs-JSON-fallback, run migrations, seed & start background scheduler
  // BEFORE opening HTTP listener to ensure fail-closed database reliability.
  let isDbReady = false;
  try {
    await detectPostgres();
    await verifyAndSyncDatabase();
    await seedSuperAdmin();
    await startSchedulerWithLeadership();
    isDbReady = true;
  } catch (err: any) {
    logger.error('Fatal error during database initialization/sync:', { error: err?.message });
    await closeDb();
    if (process.env.NODE_ENV === 'production') {
      logger.error('Production database initialization failed. Exiting process with code 1.');
      process.exit(1);
    }
  }

  // Register routes (including health/readiness)
  registerRoutes(app);

  // Client App routing logic
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    let distPath = path.join(process.cwd(), 'dist');
    if (!fs.existsSync(path.join(distPath, 'index.html'))) {
      distPath = path.join(__dirname);
    }
    if (!fs.existsSync(path.join(distPath, 'index.html'))) {
      distPath = path.join(__dirname, '../dist');
    }
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.use((err: any, req: any, res: any, _next: any) => {
    captureException(err, { method: req.method, path: req.originalUrl || req.url });
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal server error' });
  });

  // Bind server after database initialization is verified
  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`server listening on http://0.0.0.0:${PORT}`, { port: PORT, env: process.env.NODE_ENV || 'development', dbReady: isDbReady });
  });

  // Graceful shutdown: SIGTERM/SIGINT is how orchestrators (Docker, Railway,
  // Fly, Kubernetes) ask a container to stop. Stop accepting new connections,
  // let in-flight requests finish, then release the DB pool so we don't leak
  // connections or drop the scheduler advisory lock uncleanly. A short failsafe
  // timeout forces exit if a connection never closes.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`shutdown: ${signal} received — closing gracefully`);
    server.close(async () => {
      await closeDb();
      logger.info('shutdown: complete');
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('shutdown: forced exit after timeout');
      process.exit(1);
    }, 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void startServer().catch((err: any) => {
  logger.error('Server startup failed:', { error: err?.message });
  process.exitCode = 1;
});
