import { eq, and, ne } from 'drizzle-orm';
import { db, schema } from '../../db';

// The routing backbone for tickets (see routes/tickets.routes.ts) and
// escalation-aware alert delivery. Three levels, each optional except the
// last: 0 = the raiser's direct manager, 1 = the tenant's GM (if one is
// appointed), 2 = tenant_admin — the permanent backstop that always
// resolves, since every tenant has at least one tenant_admin.
export interface EscalationCandidate {
  level: 0 | 1 | 2;
  userId: number;
  name: string;
  email: string;
}

async function findManager(tenantId: number, employeeUserId: number): Promise<EscalationCandidate | null> {
  const employeeRows = await db.select().from(schema.users).where(eq(schema.users.id, employeeUserId)).limit(1);
  const employee = employeeRows[0];
  if (!employee) return null;

  // 1st choice: the explicit reporting-manager link on the employee's own
  // profile (users.managerId) — the most precise source when it's set.
  if (employee.managerId) {
    const rows = await db.select().from(schema.users).where(
      and(eq(schema.users.id, employee.managerId), eq(schema.users.tenantId, tenantId), ne(schema.users.employeeStatus, 'terminated'))
    ).limit(1);
    if (rows[0]) return { level: 0, userId: rows[0].id, name: rows[0].name, email: rows[0].email };
  }

  // 2nd choice: a team the employee is a member of (see teams.routes.ts) —
  // that team's managerId is who actually manages them day to day.
  const membership = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.userId, employeeUserId)).limit(1);
  if (membership[0]) {
    const teamRows = await db.select().from(schema.teams).where(eq(schema.teams.id, membership[0].teamId)).limit(1);
    if (teamRows[0]) {
      const mgrRows = await db.select().from(schema.users).where(
        and(eq(schema.users.id, teamRows[0].managerId), ne(schema.users.employeeStatus, 'terminated'))
      ).limit(1);
      if (mgrRows[0]) return { level: 0, userId: mgrRows[0].id, name: mgrRows[0].name, email: mgrRows[0].email };
    }
  }

  // 3rd choice (fallback): any active manager/HR in the same department,
  // same "same-department pool" convention teams.routes.ts already uses.
  if (employee.department) {
    const deptManagers = await db.select().from(schema.users).where(
      and(
        eq(schema.users.tenantId, tenantId),
        eq(schema.users.department, employee.department),
        ne(schema.users.employeeStatus, 'terminated'),
      )
    );
    const candidate = deptManagers.find((u: any) => ['manager', 'HR'].includes(u.role) && u.id !== employeeUserId);
    if (candidate) return { level: 0, userId: candidate.id, name: candidate.name, email: candidate.email };
  }

  return null;
}

async function findGm(tenantId: number): Promise<EscalationCandidate | null> {
  const rows = await db.select().from(schema.users).where(
    and(eq(schema.users.tenantId, tenantId), eq(schema.users.role, 'GM'), ne(schema.users.employeeStatus, 'terminated'))
  ).limit(1);
  return rows[0] ? { level: 1, userId: rows[0].id, name: rows[0].name, email: rows[0].email } : null;
}

async function findTenantAdmin(tenantId: number): Promise<EscalationCandidate | null> {
  const rows = await db.select().from(schema.users).where(
    and(eq(schema.users.tenantId, tenantId), eq(schema.users.role, 'tenant_admin'), ne(schema.users.employeeStatus, 'terminated'))
  ).limit(1);
  return rows[0] ? { level: 2, userId: rows[0].id, name: rows[0].name, email: rows[0].email } : null;
}

// Resolves who a ticket/alert about `employeeUserId` should go to, starting
// at `minLevel` and walking UP through levels 0 -> 1 -> 2 until someone is
// found — so "no manager on file" skips straight to GM, and "no GM
// appointed" skips straight to tenant_admin, matching the exact behavior
// asked for: manager first, then GM if one exists, else tenant_admin.
export async function resolveEscalationAssignee(tenantId: number, employeeUserId: number, minLevel: 0 | 1 | 2 = 0): Promise<EscalationCandidate> {
  if (minLevel <= 0) {
    const manager = await findManager(tenantId, employeeUserId);
    if (manager) return manager;
  }
  if (minLevel <= 1) {
    const gm = await findGm(tenantId);
    if (gm) return gm;
  }
  const admin = await findTenantAdmin(tenantId);
  if (admin) return admin;
  // Should be unreachable — every tenant has a tenant_admin — but never
  // leave a ticket assignee-less if data is somehow in a bad state.
  throw new Error('No escalation recipient could be found for this tenant (not even a tenant_admin).');
}

// The next level up from `currentLevel`, used by both manual "Escalate" and
// the scheduler's 24h auto-forward job. Once already at level 2
// (tenant_admin), there is nowhere further to go — the caller should treat
// that as "already at the top."
export async function resolveNextEscalation(tenantId: number, employeeUserId: number, currentLevel: 0 | 1 | 2): Promise<EscalationCandidate | null> {
  if (currentLevel >= 2) return null;
  const nextLevel = (currentLevel + 1) as 0 | 1 | 2;
  return resolveEscalationAssignee(tenantId, employeeUserId, nextLevel);
}
