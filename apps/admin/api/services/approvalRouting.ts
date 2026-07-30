import { eq, and, desc, ne } from 'drizzle-orm';
import { db, schema } from '../../db';
import { getUsersWithPrivilege, isPlatformFeatureAllowedForTenant } from '../auth/rbac';
import { resolveEscalationAssignee } from './escalation';

// Generalizes escalation.ts's manager->GM->tenant_admin fallback (previously
// only wired to support tickets) into an admin-configurable "who approves/
// gets notified for category X" resolver, used by every approval-
// notification call site (leave, attendance correction, WFH, missed
// checkout, late arrival). A tenant with the 'notification_routing'
// platform feature off, or with zero rules configured for a category,
// falls back EXACTLY to today's flat privilege-fan-out
// (getUsersWithPrivilege) — this is the backward-compat guarantee: shipping
// this file changes nothing for a tenant that hasn't opted in.

export interface Approver {
  id: number;
  name: string;
  email: string;
}

const SCOPE_SPECIFICITY: Record<string, number> = { branch: 3, team: 3, department: 2, all: 0 };

async function pickMatchingRule(rules: any[], subject: any): Promise<any | null> {
  let subjectTeamId: number | null = null;
  if (rules.some((r) => r.scopeType === 'team')) {
    const membership = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.userId, subject.id)).limit(1);
    subjectTeamId = membership[0]?.teamId ?? null;
  }

  const matches = rules.filter((r) => {
    if (r.scopeType === 'all') return true;
    if (r.scopeType === 'branch') return r.scopeId != null && r.scopeId === subject.branchId;
    if (r.scopeType === 'department') return !!r.scopeValue && r.scopeValue === subject.department;
    if (r.scopeType === 'team') return subjectTeamId != null && r.scopeId === subjectTeamId;
    return false;
  });
  if (matches.length === 0) return null;

  matches.sort((a, b) => {
    const specDiff = (SCOPE_SPECIFICITY[b.scopeType] ?? 0) - (SCOPE_SPECIFICITY[a.scopeType] ?? 0);
    if (specDiff !== 0) return specDiff;
    return (b.priority ?? 0) - (a.priority ?? 0);
  });
  return matches[0];
}

async function approversFromRule(rule: any, tenantId: number, subjectUserId: number): Promise<Approver[]> {
  if (rule.approverType === 'reporting_manager') {
    try {
      const candidate = await resolveEscalationAssignee(tenantId, subjectUserId, 0);
      return [{ id: candidate.userId, name: candidate.name, email: candidate.email }];
    } catch {
      return [];
    }
  }
  if (rule.approverType === 'specific_user' && rule.approverValue) {
    const rows = await db.select().from(schema.users).where(
      and(eq(schema.users.id, Number(rule.approverValue)), eq(schema.users.tenantId, tenantId), ne(schema.users.employeeStatus, 'terminated'))
    ).limit(1);
    return rows.map((u: any) => ({ id: u.id, name: u.name, email: u.email }));
  }
  if (rule.approverType === 'role' && rule.approverValue) {
    const rows = await db.select().from(schema.users).where(
      and(eq(schema.users.tenantId, tenantId), eq(schema.users.role, rule.approverValue), ne(schema.users.employeeStatus, 'terminated'))
    );
    return rows.map((u: any) => ({ id: u.id, name: u.name, email: u.email }));
  }
  return [];
}

// `fallbackPrivileges` is whatever the call site already passes to
// getUsersWithPrivilege today (e.g. ['leave.approve', 'attendance.approve'])
// — kept as an explicit parameter, not hardcoded here, so this function has
// no opinion about which privilege each category traditionally used.
export async function resolveApprovers(
  tenantId: number,
  category: string,
  subjectUserId: number,
  fallbackPrivileges: string | string[],
): Promise<Approver[]> {
  const routingEnabled = await isPlatformFeatureAllowedForTenant(tenantId, 'notification_routing').catch(() => false);
  if (routingEnabled) {
    const rules = await db.select().from(schema.approvalRoutingRules)
      .where(and(eq(schema.approvalRoutingRules.tenantId, tenantId), eq(schema.approvalRoutingRules.category, category)))
      .orderBy(desc(schema.approvalRoutingRules.priority));
    if (rules.length > 0) {
      const subjectRows = await db.select().from(schema.users).where(eq(schema.users.id, subjectUserId)).limit(1);
      const subject = subjectRows[0];
      if (subject) {
        const matched = await pickMatchingRule(rules, subject);
        if (matched) {
          const approvers = await approversFromRule(matched, tenantId, subjectUserId);
          if (approvers.length > 0) return approvers;
        }
      }
    }
  }
  const fallbackUsers = await getUsersWithPrivilege(tenantId, fallbackPrivileges);
  return fallbackUsers.map((u: any) => ({ id: u.id, name: u.name, email: u.email }));
}
