import type { Express } from 'express';
import { router as healthRouter } from './health.routes';
import { router as authRouter } from './auth.routes';
import { router as superRouter } from './super.routes';
import { router as tenantRouter } from './tenant.routes';
import { router as breaksRouter } from './breaks.routes';
import { router as reviewRouter } from './review.routes';
import { router as configRouter } from './config.routes';
import { router as kycRouter } from './kyc.routes';
import { router as attendanceRouter } from './attendance.routes';
import { router as wfhRouter } from './wfh.routes';
import { router as qrRouter } from './qr.routes';
import { router as ledgerRouter } from './ledger.routes';
import { router as branchRouter } from './branch.routes';
import { router as shiftRouter } from './shift.routes';
import { router as rolesRouter } from './roles.routes';
import { router as leavePayrollRouter } from './leavePayroll.routes';
import { router as employeesRouter } from './employees.routes';
import { router as shiftOverridesRouter } from './shiftOverrides.routes';
import { router as teamsRouter } from './teams.routes';

// Mounts every domain router at the root so each route keeps the exact full
// path it declares (e.g. '/api/auth/login'). The routers carry no path
// prefix — the split is purely an organizational one, so behavior is
// identical to when every route lived in one file. Order is irrelevant
// because all paths are distinct and specific; the SPA catch-all ('*') is
// registered by server.ts AFTER this, so it still wins last.
export function registerRoutes(app: Express) {
  app.use(healthRouter);
  app.use(authRouter);
  app.use(superRouter);
  app.use(tenantRouter);
  app.use(breaksRouter);
  app.use(reviewRouter);
  app.use(configRouter);
  app.use(kycRouter);
  app.use(attendanceRouter);
  app.use(wfhRouter);
  app.use(qrRouter);
  app.use(ledgerRouter);
  app.use(branchRouter);
  app.use(shiftRouter);
  app.use(rolesRouter);
  app.use(leavePayrollRouter);
  app.use(employeesRouter);
  app.use(shiftOverridesRouter);
  app.use(teamsRouter);
}
