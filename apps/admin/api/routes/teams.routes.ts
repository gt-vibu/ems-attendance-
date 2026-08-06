import { Router } from 'express';
import { eq, and, ne, inArray, gte, lte } from 'drizzle-orm';
import { db, schema } from '../../db';
import { sendServerError } from '../utils/errors';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege, isPlatformFeatureAllowed } from '../auth/rbac';
import { notify } from '../services/notificationService';
import { notifyUser } from '../services/notifications';
import { tenantDateKey, tenantDateTime } from '../services/tenantTime';

export const router = Router();

// Teams is a personal "my team" workspace for whoever holds 'team.manage' —
// the tenant admin already administers the whole org elsewhere, so they're
// excluded here even though hasPrivilege() otherwise grants them everything.
async function canManageTeams(user: any): Promise<boolean> {
  if (user?.role === 'tenant_admin' || user?.role === 'super_admin') return true;
  return hasPrivilege(user, 'team.manage');
}

// One team per manager, gated by 'team.manage' (see featureCatalog.ts).
// Membership is drawn from the manager's own department — "same batch" per
// the product ask, and the closest existing grouping already on `users`.
// Viewing a member's payroll/attendance/leave detail is handled entirely by
// the existing EmployeeDetailPanel component on the frontend (itself backed
// by the existing per-employee endpoints, which already gate payroll behind
// 'payroll.read'/'payroll.manage') — this file only manages team membership.

async function loadManagerAndTeam(req: any) {
  const managerRows = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId)).limit(1);
  const manager = managerRows[0];
  const teamRows = manager
    ? await db.select().from(schema.teams).where(eq(schema.teams.managerId, req.user.userId)).limit(1)
    : [];
  return { manager, team: teamRows[0] || null };
}

router.get('/api/tenant/teams/mine', authenticate, async (req: any, res: any) => {
  try {
    if (!await canManageTeams(req.user)) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const { team, manager } = await loadManagerAndTeam(req);
    
    // Fetch all tenant users for manager name lookups
    const allTenantUsers = await db.select().from(schema.users).where(eq(schema.users.tenantId, req.user.tenantId));
    const userMap = new Map(allTenantUsers.map((u: any) => [u.id, u]));

    if (!team) {
      return res.json({ team: null, members: [], availableManagers: allTenantUsers.map((u: any) => ({ id: u.id, name: u.name, role: u.role, department: u.department })) });
    }

    const memberRows = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.teamId, team.id));
    const memberIds = memberRows.map((m: any) => m.userId);
    const memberIdSet = new Set(memberIds);

    const members = allTenantUsers
      .filter((u: any) => memberIdSet.has(u.id))
      .map((u: any) => {
        const mgr = u.managerId ? userMap.get(u.managerId) : null;
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          department: u.department,
          designation: u.designation,
          managerId: u.managerId || null,
          reportsToName: mgr ? (mgr as any).name : (manager ? (manager as any).name : 'Unassigned'),
          employeeStatus: u.employeeStatus || 'active',
          employmentType: u.employmentType || 'full_time',
        };
      });

    // Real today's-attendance signal for the Overview KPI cards — no
    // fabricated numbers. Present = at least one approved check-in today;
    // average hours = mean workedMinutes across today's checked-out
    // sessions for this team only (null/undefined when nobody has
    // checked out yet, rather than a fake placeholder value).
    let presentTodayCount = 0;
    let averageWorkedHoursToday: number | null = null;
    if (memberIds.length > 0) {
      const tenantRow = (await db.select({ timezone: schema.tenants.timezone }).from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId)).limit(1))[0];
      const todayKey = tenantDateKey(tenantRow, new Date());
      const dayStart = tenantDateTime(tenantRow, todayKey, 0, 0);
      const dayEnd = tenantDateTime(tenantRow, todayKey, 23, 59);
      const todaysLogs = await db.select().from(schema.attendanceLogs).where(and(
        eq(schema.attendanceLogs.tenantId, req.user.tenantId),
        inArray(schema.attendanceLogs.userId, memberIds),
        gte(schema.attendanceLogs.createdAt, dayStart),
        lte(schema.attendanceLogs.createdAt, dayEnd),
      ));
      const presentUserIds = new Set(
        todaysLogs.filter((l: any) => l.type === 'check_in' && l.status === 'approved').map((l: any) => l.userId)
      );
      presentTodayCount = presentUserIds.size;
      const workedMinutesToday = todaysLogs
        .filter((l: any) => typeof l.workedMinutes === 'number' && l.workedMinutes > 0)
        .map((l: any) => l.workedMinutes as number);
      averageWorkedHoursToday = workedMinutesToday.length > 0
        ? Math.round((workedMinutesToday.reduce((a: number, b: number) => a + b, 0) / workedMinutesToday.length / 60) * 10) / 10
        : null;
    }

    res.json({
      team: {
        id: team.id,
        name: team.name,
        managerId: team.managerId,
        managerName: manager ? (manager as any).name : 'Unassigned',
        // No fake fallback — a manager without a department set just
        // shows nothing here rather than an invented 'Engineering'.
        department: (manager as any)?.department || null,
        createdAt: team.createdAt,
      },
      members,
      availableManagers: allTenantUsers.map((u: any) => ({ id: u.id, name: u.name, role: u.role, department: u.department })),
      todayStats: { presentTodayCount, averageWorkedHoursToday },
    });
  } catch (err: any) {
    sendServerError(res, err, "teams.routes.ts");
  }
});

router.post('/api/tenant/teams/assign-manager', authenticate, async (req: any, res: any) => {
  try {
    if (!await canManageTeams(req.user)) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const { memberId, managerId } = req.body;
    if (!memberId) return res.status(400).json({ error: 'memberId is required.' });

    const memberRows = await db.select().from(schema.users).where(and(eq(schema.users.id, Number(memberId)), eq(schema.users.tenantId, req.user.tenantId))).limit(1);
    const member = memberRows[0];
    if (!member) return res.status(404).json({ error: 'Employee not found.' });

    await db.update(schema.users)
      .set({ managerId: managerId ? Number(managerId) : null })
      .where(and(eq(schema.users.id, Number(memberId)), eq(schema.users.tenantId, req.user.tenantId)));

    // Both the employee (their reporting line just changed) and the newly
    // assigned manager (they have a new direct report) should hear about
    // this — neither is necessarily the caller (a tenant admin can assign
    // managers on anyone's behalf).
    if (managerId) {
      const newManagerRows = await db.select().from(schema.users).where(eq(schema.users.id, Number(managerId))).limit(1);
      const newManager = newManagerRows[0] || null;
      const tenantRowForNotify = (await db.select().from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId)).limit(1))[0];
      if (isPlatformFeatureAllowed(tenantRowForNotify, 'unified_notifications')) {
        // notifyManager:true on this event resolves the recipient via the
        // employee's OWN managerId (services/notificationService.ts's
        // resolveEscalationAssignee) — which we just set above to the new
        // manager, so this single notify() call reaches both sides.
        await notify(req.user.tenantId, 'manager_assigned', {
          subjectUserId: member.id,
          subjectName: member.name,
          actorId: req.user.userId,
          data: { managerName: newManager?.name || 'your new manager' },
        }).catch(() => undefined);
      } else {
        await notifyUser(member.id, 'Reporting manager updated', `${newManager?.name || 'A new manager'} is now your reporting manager.`).catch(() => undefined);
        if (newManager) {
          await notifyUser(newManager.id, 'New direct report assigned', `${member.name} now reports to you.`).catch(() => undefined);
        }
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    sendServerError(res, err, "teams.routes.ts");
  }
});

router.post('/api/tenant/teams', authenticate, async (req: any, res: any) => {
  try {
    if (!await canManageTeams(req.user)) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'A team name is required.' });
    }
    const { team: existing } = await loadManagerAndTeam(req);
    if (existing) {
      return res.status(400).json({ error: 'You already have a team. Rename or manage the existing one instead.' });
    }

    const [team] = await db.insert(schema.teams).values({
      tenantId: req.user.tenantId,
      managerId: req.user.userId,
      name: name.trim(),
    }).returning();

    res.json({ success: true, team: { id: team.id, name: team.name, createdAt: team.createdAt } });
  } catch (err: any) {
    sendServerError(res, err, "teams.routes.ts");
  }
});

// Candidates = same tenant, same department as the manager, not the manager
// themself, and not already on the team.
router.get('/api/tenant/teams/candidates', authenticate, async (req: any, res: any) => {
  try {
    if (!await canManageTeams(req.user)) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const { manager, team } = await loadManagerAndTeam(req);
    const existingMemberIds = team
      ? (await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.teamId, team.id))).map((m: any) => m.userId)
      : [];
    const excludeIds = new Set([req.user.userId, ...existingMemberIds]);

    const deptUsers = (manager?.department && req.user?.role !== 'tenant_admin' && req.user?.role !== 'super_admin')
      ? await db.select().from(schema.users).where(
          and(
            eq(schema.users.tenantId, req.user.tenantId),
            eq(schema.users.department, manager.department),
            ne(schema.users.employeeStatus, 'terminated'),
          )
        )
      : await db.select().from(schema.users).where(
          and(
            eq(schema.users.tenantId, req.user.tenantId),
            ne(schema.users.employeeStatus, 'terminated'),
          )
        );

    res.json({
      candidates: deptUsers
        .filter((u: any) => !excludeIds.has(u.id))
        .map((u: any) => ({ id: u.id, name: u.name, email: u.email, role: u.role, department: u.department, designation: u.designation })),
    });
  } catch (err: any) {
    sendServerError(res, err, "teams.routes.ts");
  }
});

router.post('/api/tenant/teams/members', authenticate, async (req: any, res: any) => {
  try {
    if (!await canManageTeams(req.user)) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required.' });

    const { manager, team } = await loadManagerAndTeam(req);
    if (!team) return res.status(400).json({ error: 'Create your team before adding members.' });

    const candidateRows = await db.select().from(schema.users).where(and(eq(schema.users.id, userId), eq(schema.users.tenantId, req.user.tenantId))).limit(1);
    const candidate = candidateRows[0];
    if (!candidate) {
      return res.status(404).json({ error: 'Employee not found.' });
    }
    if (candidate.id === req.user.userId) {
      return res.status(400).json({ error: 'You cannot add yourself to your own team.' });
    }
    if (req.user?.role !== 'tenant_admin' && req.user?.role !== 'super_admin' && (!manager?.department || candidate.department !== manager.department)) {
      return res.status(403).json({ error: 'This employee is not in your department, so they cannot be added to your team.' });
    }

    const already = await db.select().from(schema.teamMembers).where(
      and(eq(schema.teamMembers.teamId, team.id), eq(schema.teamMembers.userId, userId))
    ).limit(1);
    if (already.length > 0) {
      return res.status(400).json({ error: 'This employee is already on your team.' });
    }

    await db.insert(schema.teamMembers).values({ teamId: team.id, userId });

    // Tell the newly-added employee who their team lead is — previously
    // this route returned success with no signal to the person actually
    // affected by the change.
    const teamLeadName = manager?.name || req.user.name;
    const tenantRowForNotify = (await db.select().from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId)).limit(1))[0];
    if (isPlatformFeatureAllowed(tenantRowForNotify, 'unified_notifications')) {
      await notify(req.user.tenantId, 'team_member_added', {
        subjectUserId: candidate.id,
        subjectName: candidate.name,
        actorId: req.user.userId,
        data: { teamName: team.name, managerName: teamLeadName },
      }).catch(() => undefined);
    } else {
      await notifyUser(candidate.id, `Added to ${team.name}`, `You've been added to the "${team.name}" team, led by ${teamLeadName}.`).catch(() => undefined);
    }

    res.json({ success: true });
  } catch (err: any) {
    sendServerError(res, err, "teams.routes.ts");
  }
});

router.delete('/api/tenant/teams/members/:userId', authenticate, async (req: any, res: any) => {
  try {
    if (!await canManageTeams(req.user)) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
    }
    const { team } = await loadManagerAndTeam(req);
    if (!team) return res.status(404).json({ error: 'You have no team.' });

    const userId = parseInt(req.params.userId, 10);
    await db.delete(schema.teamMembers).where(
      and(eq(schema.teamMembers.teamId, team.id), eq(schema.teamMembers.userId, userId))
    );
    res.json({ success: true });
  } catch (err: any) {
    sendServerError(res, err, "teams.routes.ts");
  }
});
