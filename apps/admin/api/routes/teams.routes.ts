import { Router } from 'express';
import { eq, and, ne } from 'drizzle-orm';
import { db, schema } from '../../db';
import { authenticate } from '../middleware/authenticate';
import { hasPrivilege } from '../auth/rbac';

export const router = Router();

// Teams is a personal "my team" workspace for whoever holds 'team.manage' —
// the tenant admin already administers the whole org elsewhere, so they're
// excluded here even though hasPrivilege() otherwise grants them everything.
async function canManageTeams(user: any): Promise<boolean> {
  if (user?.role === 'tenant_admin') return false;
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
    const { team } = await loadManagerAndTeam(req);
    if (!team) {
      return res.json({ team: null, members: [] });
    }

    const memberRows = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.teamId, team.id));
    const memberIds = memberRows.map((m: any) => m.userId);
    const members = memberIds.length > 0
      ? await db.select().from(schema.users).where(eq(schema.users.tenantId, req.user.tenantId))
      : [];
    const memberIdSet = new Set(memberIds);

    res.json({
      team: { id: team.id, name: team.name, createdAt: team.createdAt },
      members: members
        .filter((u: any) => memberIdSet.has(u.id))
        .map((u: any) => ({ id: u.id, name: u.name, email: u.email, role: u.role, department: u.department, designation: u.designation })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    if (!manager) return res.status(404).json({ error: 'Manager account not found.' });
    if (!manager.department) {
      return res.json({ candidates: [], reason: 'Your own profile has no department set, so there is no "same department" pool to pull from yet.' });
    }

    const existingMemberIds = team
      ? (await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.teamId, team.id))).map((m: any) => m.userId)
      : [];
    const excludeIds = new Set([req.user.userId, ...existingMemberIds]);

    const deptUsers = await db.select().from(schema.users).where(
      and(
        eq(schema.users.tenantId, req.user.tenantId),
        eq(schema.users.department, manager.department),
        ne(schema.users.employeeStatus, 'terminated'),
      )
    );

    res.json({
      candidates: deptUsers
        .filter((u: any) => !excludeIds.has(u.id))
        .map((u: any) => ({ id: u.id, name: u.name, email: u.email, role: u.role, department: u.department, designation: u.designation })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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

    const candidateRows = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    const candidate = candidateRows[0];
    if (!candidate || candidate.tenantId !== req.user.tenantId) {
      return res.status(404).json({ error: 'Employee not found.' });
    }
    if (candidate.id === req.user.userId) {
      return res.status(400).json({ error: 'You cannot add yourself to your own team.' });
    }
    if (!manager.department || candidate.department !== manager.department) {
      return res.status(403).json({ error: 'This employee is not in your department, so they cannot be added to your team.' });
    }

    const already = await db.select().from(schema.teamMembers).where(
      and(eq(schema.teamMembers.teamId, team.id), eq(schema.teamMembers.userId, userId))
    ).limit(1);
    if (already.length > 0) {
      return res.status(400).json({ error: 'This employee is already on your team.' });
    }

    await db.insert(schema.teamMembers).values({ teamId: team.id, userId });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});
