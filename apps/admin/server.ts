import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { detectPostgres, closeDb } from './db';
import { logger, requestLogger } from './logger';
import { verifyAndSyncDatabase, seedSuperAdmin } from './api/bootstrap/database';
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
  const app = express();
  // Honor a platform-injected PORT (Render/Fly/Heroku set this) but keep 3000
  // as the default so local dev and the existing Docker/compose setup are
  // unchanged.
  const PORT = Number(process.env.PORT) || 3000;

  // Resolve real-Postgres-vs-JSON-fallback exactly once, before any query
  // runs — everything below this line assumes db already knows which one
  // it's talking to.
  await detectPostgres();

  // Initialize DB and Seed
  await verifyAndSyncDatabase();
  await seedSuperAdmin();
  await startSchedulerWithLeadership();

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
        // fonts.googleapis.com: index.css @imports the Google Fonts
        // stylesheet directly (Vite leaves external @import URLs as-is,
        // so the browser fetches it at page-load) — found by an actual
        // browser console CSP violation during verification, not visible
        // from a static grep of the source.
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

  // Third-party/partner integrations call this API from a different origin
  // than the bundled frontend, which browsers block by default without
  // explicit CORS headers. CORS_ALLOWED_ORIGINS is a comma-separated
  // allowlist (e.g. "https://partner.example.com,https://app.example.com");
  // unset means "same-origin only", the safe default. '*' opts in to any
  // origin — only use that for a genuinely public, unauthenticated API
  // surface (this one requires a bearer token per-request regardless, but
  // a wildcard still exposes it to browser-based CSRF-style abuse from any
  // page, so it's opt-in, not the default).
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

  // Was 50mb — a generous global limit on every JSON endpoint, not just the
  // one route that actually needs headroom. Document uploads
  // (documents.routes.ts) go over this same global parser as base64-in-JSON
  // and cap the underlying file at 15MB (MAX_FILE_BYTES), which base64-
  // inflates to ~20.1MB of JSON — 25mb keeps real headroom for that one
  // legitimate case while cutting the effective DoS/memory-pressure surface
  // on every other endpoint roughly in half.
  app.use(express.json({ limit: '25mb' }));

  // Versioned API surface for external integrations: /api/v1/* is a plain
  // rewrite to the existing /api/* routes below, not a duplicate route
  // table — so every current and future /api/* endpoint is automatically
  // available at /api/v1/* too, with zero risk of the two drifting apart.
  // The bundled frontend keeps calling /api/* directly (unchanged); this
  // exists so external partners have a version-prefixed contract to
  // integrate against without depending on unprefixed paths.
  app.use((req, _res, next) => {
    if (req.url.startsWith('/api/v1/')) {
      req.url = req.url.replace('/api/v1/', '/api/');
    } else if (req.url === '/api/v1') {
      req.url = '/api';
    }
    next();
  });
  // Generous general-purpose limiter (defined in api/middleware/rateLimit)
  // — a safety net against abuse/DoS without getting in the way of normal
  // use (dashboards polling, or many employees behind one office IP all
  // checking in around the same time).
  app.use('/api/', generalLimiter);

  // Every API route, grouped by domain under api/routes/*. Mounted before the
  // SPA catch-all below so real endpoints always win over the fallback.
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

  // Final safety net: every route handler in api/routes/* already wraps its
  // body in try/catch and returns a JSON error, so this exists for the
  // narrow gap that isn't covered — a synchronous throw in middleware itself,
  // or an async handler that forgot the try/catch. Must be registered last
  // (Express identifies error middleware by its 4-arg signature, not
  // position, but convention is last) and after the SPA catch-all so it
  // still catches errors from within that too.
  app.use((err: any, req: any, res: any, _next: any) => {
    captureException(err, { method: req.method, path: req.originalUrl || req.url });
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal server error' });
  });

  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`server listening on http://0.0.0.0:${PORT}`, { port: PORT, env: process.env.NODE_ENV || 'development' });
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

startServer();
