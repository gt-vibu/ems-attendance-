import { Router } from 'express';
import { eq, and, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege, getScopedBranchIds } from '../auth/rbac';
import { logToAuditLedger } from '../services/audit';
import { forwardGeocode, searchPlaces } from '../../geocoding.js';

export const router = Router();

// Reads the authoritative isLate column (see services/attendancePolicy.ts)
// with a fallback to the old reason-string match for rows logged before
// this column existed — keeps historical stats unchanged instead of
// silently zeroing out "late" counts for any date before this shipped.
function isLateLog(l: any): boolean {
  if (l.isLate === true) return true;
  if (l.isLate === false) return false;
  return (l.reason || '').includes('Late Arrival');
}

// Non-location policy fields a branch carries — the set the "apply to all
// branches" wizard button copies between in-progress branch cards. Location
// (address/lat/lng/radius) is deliberately excluded, matching the product
// requirement that policies can be shared but location/radius must always
// be set per-branch.
const POLICY_FIELDS = [
  'shiftStart', 'shiftEnd', 'gracePeriodMins', 'halfDayMins', 'weekendConfig',
  'dailyBreakBudgetMins', 'minAttendancePercent', 'wifiSsid', 'officeIp',
  'wifiCheckEnabled', 'qrEnabled', 'qrRotationSeconds', 'qrRequireGps',
  'qrRequireWifi', 'qrRequireFace', 'qrGeofenceRadiusMeters', 'qrRequireDeviceTrust',
  'arrivalPolicy', 'workingHoursPolicy', 'requiredWorkingMins', 'hybridMaxCheckoutTime',
] as const;

function pickBranchInsertFields(body: any, tenantId: number) {
  const insert: any = {
    tenantId,
    name: body.name,
    address: body.address ?? null,
    locationLat: body.locationLat ?? null,
    locationLng: body.locationLng ?? null,
    locationRadiusMeters: body.locationRadiusMeters ?? 100,
    isMainBranch: !!body.isMainBranch,
  };
  for (const field of POLICY_FIELDS) {
    if (body[field] !== undefined) insert[field] = body[field];
  }
  return insert;
}

// Any authenticated tenant user can list branches — needed for onboarding
// dropdowns (an HR user picking which branch to hire into, an employee's
// branch-selection during setup, etc). Scoping is about who can *manage/see
// stats for* a branch, not whether the branch list itself is visible.
router.get('/api/branches', authenticate, async (req: any, res: any) => {
  try {
    const branchList = await db.select().from(schema.branches)
      .where(and(eq(schema.branches.tenantId, req.user.tenantId), eq(schema.branches.status, 'active')));
    res.json({ branches: branchList });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/branches/:id', authenticate, async (req: any, res: any) => {
  try {
    const branchId = parseInt(req.params.id, 10);
    const branchRows = await db.select().from(schema.branches).where(eq(schema.branches.id, branchId));
    if (branchRows.length === 0) return res.status(404).json({ error: 'Branch not found' });
    const branch = branchRows[0];
    if (branch.tenantId !== req.user.tenantId) {
      return res.status(403).json({ error: 'Access denied: This branch does not belong to your organization.' });
    }

    // SECURITY: this response includes the full roster's names/emails plus
    // today's attendance — getScopedBranchIds() returns null both for
    // unrestricted admins AND for a non-admin with no branchId assigned,
    // so null alone can't be trusted as "unrestricted" here (that previously
    // let any branchId-less custom role pull any branch's roster/emails by
    // guessing an ID). Require actual branch.manage, or genuine membership
    // in the caller's own scoped branch set.
    const isUnrestrictedAdmin = req.user.role === 'super_admin' || req.user.role === 'tenant_admin';
    if (!isUnrestrictedAdmin) {
      const scopedBranchIds = await getScopedBranchIds(req.user);
      const isInOwnScope = scopedBranchIds !== null && scopedBranchIds.includes(branchId);
      if (!isInOwnScope && !(await hasPrivilege(req.user, 'branch.manage'))) {
        return res.status(403).json({ error: 'Access denied: You are not scoped to this branch.' });
      }
    }

    const roster = await db.select().from(schema.users)
      .where(and(eq(schema.users.branchId, branchId), sql`role != 'tenant_admin'`));

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todaysLogs = await db.select().from(schema.attendanceLogs)
      .where(and(eq(schema.attendanceLogs.branchId, branchId), sql`created_at >= ${todayStart}`));

    const checkedInToday = new Set(
      todaysLogs.filter((l: any) => l.type === 'check_in' && l.status === 'approved').map((l: any) => l.userId)
    );
    const lateToday = todaysLogs.filter((l: any) =>
      l.type === 'check_in' && l.status === 'approved' && isLateLog(l)
    ).length;
    const pendingToday = todaysLogs.filter((l: any) => l.status === 'pending').length;

    const shiftList = await db.select().from(schema.shifts)
      .where(and(eq(schema.shifts.branchId, branchId), eq(schema.shifts.status, 'active')));
    const shiftById = new Map<number, any>(shiftList.map((s: any) => [s.id, s]));
    const shiftBreakdown = shiftList.map((s: any) => ({
      shiftId: s.id,
      name: s.name,
      checkInTime: s.checkInTime,
      checkOutTime: s.checkOutTime,
      employeeCount: roster.filter((u: any) => u.shiftId === s.id).length,
    }));

    res.json({
      branch,
      headcount: roster.length,
      roster: roster.map((u: any) => ({
        userId: u.id, name: u.name, role: u.role, email: u.email,
        shift: u.shiftId ? shiftById.get(u.shiftId) ?? null : null,
        checkedInToday: checkedInToday.has(u.id),
      })),
      staffByRole: roster.reduce((acc: Record<string, number>, u: any) => {
        const r = u.role || 'employee';
        acc[r] = (acc[r] || 0) + 1;
        return acc;
      }, {}),
      todaysAttendance: {
        presentToday: checkedInToday.size,
        absentToday: Math.max(0, roster.length - checkedInToday.size),
        lateToday,
        pendingToday,
      },
      shiftBreakdown,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Used by the first-login branch-setup wizard to create N branches
// transactionally, each auto-creating its `isDefault` shift from its own
// shiftStart/shiftEnd so the branch is immediately usable for onboarding.
router.post('/api/branches/bulk', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'branch.manage')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const { branches: branchPayloads } = req.body;
    if (!Array.isArray(branchPayloads) || branchPayloads.length === 0) {
      return res.status(400).json({ error: 'branches (non-empty array) is required' });
    }
    for (const b of branchPayloads) {
      if (b.kycEnabled !== undefined) {
        return res.status(400).json({ error: 'Device Identity Check is a company-wide setting, not a per-branch field. Use /api/tenant/config/update instead.' });
      }
      if (!b.name) return res.status(400).json({ error: 'Each branch requires a name' });
    }

    const created: any[] = [];
    for (const b of branchPayloads) {
      const [branch] = await db.insert(schema.branches)
        .values(pickBranchInsertFields(b, req.user.tenantId))
        .returning();

      const [shift] = await db.insert(schema.shifts).values({
        tenantId: req.user.tenantId,
        branchId: branch.id,
        name: 'General Shift',
        checkInTime: branch.shiftStart || '09:00',
        checkOutTime: branch.shiftEnd || '18:00',
        isDefault: true,
      }).returning();

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'BRANCH_CREATED',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { branchId: branch.id, name: branch.name, defaultShiftId: shift.id },
      });

      created.push({ ...branch, defaultShift: shift });
    }

    // This endpoint is only ever called by the first-login branch-setup
    // wizard, so a successful call is the wizard's completion signal —
    // persist it on the tenant so the wizard never reappears on a later
    // login (previously only set on the client's in-memory user object,
    // which a fresh /api/auth/login response would silently overwrite).
    await db.update(schema.tenants)
      .set({ branchSetupCompleted: true })
      .where(eq(schema.tenants.id, req.user.tenantId));

    res.json({ success: true, branches: created });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/branches', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'branch.manage')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    if (req.body.kycEnabled !== undefined) {
      return res.status(400).json({ error: 'Device Identity Check is a company-wide setting, not a per-branch field. Use /api/tenant/config/update instead.' });
    }
    if (!req.body.name) return res.status(400).json({ error: 'name is required' });

    const [branch] = await db.insert(schema.branches)
      .values(pickBranchInsertFields(req.body, req.user.tenantId))
      .returning();

    await logToAuditLedger({
      tenantId: req.user.tenantId,
      actorId: req.user.userId,
      actorName: req.user.name,
      action: 'BRANCH_CREATED',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
      details: { branchId: branch.id, name: branch.name },
    });

    res.json({ success: true, branch });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/api/branches/:id', authenticate, async (req: any, res: any) => {
  try {
    if (!await hasPrivilege(req.user, 'branch.manage')) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    if (req.body.kycEnabled !== undefined) {
      return res.status(400).json({ error: 'Device Identity Check is a company-wide setting, not a per-branch field. Use /api/tenant/config/update instead.' });
    }
    const branchId = parseInt(req.params.id, 10);
    const branchRows = await db.select().from(schema.branches).where(eq(schema.branches.id, branchId));
    if (branchRows.length === 0) return res.status(404).json({ error: 'Branch not found' });
    if (branchRows[0].tenantId !== req.user.tenantId) {
      return res.status(403).json({ error: 'Access denied: This branch does not belong to your organization.' });
    }

    const update: any = {};
    const editableFields = ['name', 'address', 'locationLat', 'locationLng', 'locationRadiusMeters', 'status', ...POLICY_FIELDS];
    for (const field of editableFields) {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    }

    const [updated] = await db.update(schema.branches).set(update).where(eq(schema.branches.id, branchId)).returning();

    await logToAuditLedger({
      tenantId: req.user.tenantId,
      actorId: req.user.userId,
      actorName: req.user.name,
      action: 'BRANCH_UPDATED',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
      details: { branchId, changes: update },
    });

    res.json({ success: true, branch: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Forward-geocode a free-text address to coordinates, for the branch
// location picker ("search for an address and it fixes the coordinates").
router.post('/api/geocode/forward', authenticate, async (req: any, res: any) => {
  try {
    const { query } = req.body;
    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'query is required' });
    }
    const result = await forwardGeocode(query);
    if (!result) return res.status(404).json({ error: 'No matching location found' });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Live-typeahead variant of the above — returns up to a handful of
// candidate matches for the branch location search box's autocomplete
// dropdown, instead of committing to a single best guess.
router.get('/api/geocode/search', authenticate, async (req: any, res: any) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    if (!query.trim()) return res.json({ results: [] });
    const results = await searchPlaces(query, 5);
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
