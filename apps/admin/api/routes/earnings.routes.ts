import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { sendServerError } from '../utils/errors';
import { authenticate } from '../middleware/authenticate';
import { computeEmployeeEarnings } from '../services/earnings';
import { tenantParts } from '../services/tenantTime';

export const router = Router();

// Self-service only — every non-admin role (employee, manager, HR, GM, or
// any custom role) can see their OWN day-by-day + monthly earnings
// breakdown here. No privilege check beyond being authenticated: this is
// the same "mine" pattern as /api/attendance/mine and /api/payroll/mine —
// a caller can only ever see req.user.userId's own data, never anyone
// else's, so there's nothing to gate beyond that.
router.get('/api/earnings/mine', authenticate, async (req: any, res: any) => {
  try {
    const tenantRows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId)).limit(1);
    const nowParts = tenantParts(tenantRows[0] || null);
    const year = Number(req.query.year || nowParts.year);
    const month = Number(req.query.month || nowParts.month);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'year and month (1-12) must be valid integers' });
    }
    const result = await computeEmployeeEarnings(req.user.userId, req.user.tenantId, year, month);
    res.json(result);
  } catch (err: any) {
    sendServerError(res, err, "earnings.routes.ts");
  }
});
