import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { computeEmployeeEarnings } from '../services/earnings';

export const router = Router();

// Self-service only — every non-admin role (employee, manager, HR, GM, or
// any custom role) can see their OWN day-by-day + monthly earnings
// breakdown here. No privilege check beyond being authenticated: this is
// the same "mine" pattern as /api/attendance/mine and /api/payroll/mine —
// a caller can only ever see req.user.userId's own data, never anyone
// else's, so there's nothing to gate beyond that.
router.get('/api/earnings/mine', authenticate, async (req: any, res: any) => {
  try {
    const now = new Date();
    const year = Number(req.query.year || now.getUTCFullYear());
    const month = Number(req.query.month || (now.getUTCMonth() + 1));
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'year and month (1-12) must be valid integers' });
    }
    const result = await computeEmployeeEarnings(req.user.userId, req.user.tenantId, year, month);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
