import { Router } from 'express';
import { eq, and, inArray } from 'drizzle-orm';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege } from '../auth/rbac';
import { getOrCreatePayrollSettings } from './leavePayrollShared';

export const router = Router();

router.get('/api/tenant/holidays/optional', authenticate, async (req: any, res: any) => {
  try {
    const [settings, holidays, choices] = await Promise.all([
      getOrCreatePayrollSettings(req.user.tenantId),
      db.select().from(schema.holidays).where(eq(schema.holidays.tenantId, req.user.tenantId)).orderBy(schema.holidays.date),
      db.select().from(schema.optionalHolidayChoices).where(eq(schema.optionalHolidayChoices.userId, req.user.userId)),
    ]);
    const selectedHolidayIds = new Set(choices.map((choice: any) => choice.holidayId));
    res.json({
      limit: settings.optionalHolidayLimit,
      holidays: holidays.map((holiday: any) => ({ ...holiday, selected: selectedHolidayIds.has(holiday.id) })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/tenant/holidays/optional', authenticate, async (req: any, res: any) => {
  try {
    const settings = await getOrCreatePayrollSettings(req.user.tenantId);
    const holidayIds: number[] = Array.isArray(req.body?.holidayIds) ? Array.from(new Set(req.body.holidayIds.map((id: any) => Number(id)).filter(Boolean))) : [];
    if (holidayIds.length > settings.optionalHolidayLimit) {
      return res.status(400).json({ error: `You can only select up to ${settings.optionalHolidayLimit} optional holidays.` });
    }
    if (holidayIds.length > 0) {
      const validHolidays = await db.select({ id: schema.holidays.id }).from(schema.holidays).where(
        and(
          eq(schema.holidays.tenantId, req.user.tenantId),
          inArray(schema.holidays.id, holidayIds),
        )
      );
      if (validHolidays.length !== holidayIds.length) {
        return res.status(400).json({ error: 'One or more selected holidays are invalid.' });
      }
    }
    await db.delete(schema.optionalHolidayChoices).where(eq(schema.optionalHolidayChoices.userId, req.user.userId));
    if (holidayIds.length > 0) {
      await db.insert(schema.optionalHolidayChoices).values(
        holidayIds.map((holidayId: number) => ({
          tenantId: req.user.tenantId,
          userId: req.user.userId,
          holidayId,
        }))
      );
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/tenant/holidays/import-public', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'holiday.manage')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const settings = await getOrCreatePayrollSettings(req.user.tenantId);
    const year = Number(req.body?.year || new Date().getUTCFullYear());
    const countryCode = String(req.body?.countryCode || settings.holidayCountryCode || 'IN');
    const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`);
    if (!response.ok) {
      return res.status(502).json({ error: 'Failed to fetch public holidays from upstream source.' });
    }
    const holidays = await response.json() as Array<any>;
    const existing = await db.select().from(schema.holidays).where(eq(schema.holidays.tenantId, req.user.tenantId));
    const existingKeys = new Set(existing.map((holiday: any) => `${holiday.date}:${holiday.name}`));
    const values = holidays
      .map((holiday) => ({
        tenantId: req.user.tenantId,
        date: holiday.date,
        name: holiday.localName || holiday.name,
      }))
      .filter((holiday) => !existingKeys.has(`${holiday.date}:${holiday.name}`));
    if (values.length > 0) await db.insert(schema.holidays).values(values);
    res.json({ success: true, imported: values.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
