// Work From Home (WFH) policy evaluation + geolocation helpers. Kept as a
// standalone module of pure functions (no db/express imports) so the
// eligibility/distance logic is easy to unit-test and reason about in
// isolation from the much larger office attendance pipeline in server.ts.

// Delegable, independent of role name — same privilege system every other
// module uses (see getDefaultPrivilegesForRole()/hasPrivilege() in
// server.ts). Mirrors QR_PERMISSIONS' shape in qr.ts.
export const WFH_PERMISSIONS = {
  VIEW_LOGS: 'wfh.view_logs',
} as const;

export interface WfhPolicy {
  wfhEnabled: boolean;
  wfhAllowedRoles: string[] | null; // null = no restriction, any non-admin clock-in role allowed
  wfhMaxDaysPerMonth: number | null; // null = unlimited
  wfhAllowedWeekdays: string[];
  wfhRadiusMeters: number;
  wfhApprovalRequired: boolean;
  wfhRequireReason: boolean;
  wfhLateLoginGraceMins: number | null; // null = reuse the tenant's office gracePeriodMins
}

// Normalizes a raw tenant DB row (whatever shape Drizzle/JSON gives it) into
// a well-formed WfhPolicy with sane defaults — every field on the tenant row
// is nullable/optional in the database, so this is the single place that
// decides what "unset" means.
export function extractWfhPolicy(tenant: any): WfhPolicy {
  const allowedRoles = Array.isArray(tenant?.wfhAllowedRoles) && tenant.wfhAllowedRoles.length > 0
    ? tenant.wfhAllowedRoles
    : null;
  const allowedWeekdays = Array.isArray(tenant?.wfhAllowedWeekdays) && tenant.wfhAllowedWeekdays.length > 0
    ? tenant.wfhAllowedWeekdays
    : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

  return {
    wfhEnabled: !!tenant?.wfhEnabled,
    wfhAllowedRoles: allowedRoles,
    wfhMaxDaysPerMonth: tenant?.wfhMaxDaysPerMonth ?? null,
    wfhAllowedWeekdays: allowedWeekdays,
    wfhRadiusMeters: tenant?.wfhRadiusMeters || 200,
    wfhApprovalRequired: tenant?.wfhApprovalRequired !== false,
    wfhRequireReason: tenant?.wfhRequireReason !== false,
    wfhLateLoginGraceMins: tenant?.wfhLateLoginGraceMins ?? null,
  };
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function todayWeekdayName(date: Date = new Date()): string {
  return WEEKDAY_NAMES[date.getDay()];
}

// Admin roles never clock in at all (office or WFH) — see canClockIn() in
// AdminApp.tsx for the identical office-side rule.
export function isRoleAllowedForWfh(role: string, policy: WfhPolicy): boolean {
  if (role === 'super_admin' || role === 'tenant_admin') return false;
  if (!policy.wfhAllowedRoles) return true;
  return policy.wfhAllowedRoles.includes(role);
}

// Standalone haversine implementation (intentionally not imported from
// server.ts's own copy) so this module has zero dependency on server.ts
// internals and can be unit-tested without spinning up the whole server.
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export interface WfhEligibilityResult {
  eligible: boolean;
  reason?: string;
  needsHomeRegistration: boolean;
}

// Pre-flight check the frontend calls BEFORE starting the camera/KYC flow —
// answers "can this employee even attempt WFH today", not "is their
// location correct" (that's a separate, later check against a live GPS
// read, since eligibility doesn't require a location fix at all).
export function evaluateWfhEligibility(params: {
  policy: WfhPolicy;
  role: string;
  hasHomeLocation: boolean;
  isKycCompleted: boolean;
  wfhCheckInsThisMonth: number;
  now?: Date;
}): WfhEligibilityResult {
  const { policy, role, hasHomeLocation, isKycCompleted, wfhCheckInsThisMonth, now = new Date() } = params;

  if (!policy.wfhEnabled) {
    return { eligible: false, reason: 'Work From Home is not enabled for your organization.', needsHomeRegistration: false };
  }
  if (!isRoleAllowedForWfh(role, policy)) {
    return { eligible: false, reason: 'Your role is not permitted to work from home.', needsHomeRegistration: false };
  }
  if (!isKycCompleted) {
    return { eligible: false, reason: 'Complete biometric KYC enrollment before using Work From Home.', needsHomeRegistration: false };
  }
  const weekday = todayWeekdayName(now);
  if (!policy.wfhAllowedWeekdays.includes(weekday)) {
    return { eligible: false, reason: `Work From Home is not allowed on ${weekday}s.`, needsHomeRegistration: false };
  }
  if (policy.wfhMaxDaysPerMonth !== null && wfhCheckInsThisMonth >= policy.wfhMaxDaysPerMonth) {
    return { eligible: false, reason: `Monthly Work From Home quota (${policy.wfhMaxDaysPerMonth} days) reached.`, needsHomeRegistration: false };
  }
  if (!hasHomeLocation) {
    return { eligible: true, needsHomeRegistration: true };
  }
  return { eligible: true, needsHomeRegistration: false };
}

export interface WfhLocationCheckResult {
  passed: boolean;
  distanceMeters: number;
  error?: string;
}

export function evaluateWfhLocation(params: {
  currentLat: number;
  currentLng: number;
  homeLat: number;
  homeLng: number;
  radiusMeters: number;
}): WfhLocationCheckResult {
  const { currentLat, currentLng, homeLat, homeLng, radiusMeters } = params;
  const distance = haversineMeters(currentLat, currentLng, homeLat, homeLng);
  if (distance > radiusMeters) {
    return {
      passed: false,
      distanceMeters: distance,
      error: `Current location does not match your registered home location (${Math.round(distance - radiusMeters)}m outside the allowed ${radiusMeters}m radius).`,
    };
  }
  return { passed: true, distanceMeters: distance };
}

// Shared "who can approve WFH-related requests" gate, referenced by name
// from server.ts route handlers — kept here purely as documentation of the
// convention (the actual hasPrivilege() check lives in server.ts, since it
// needs live DB access). WFH re-uses the existing 'attendance.approve'
// privilege rather than introducing a new permission string, so a manager
// who already approves late-arrivals/corrections can approve WFH the same way.
export const WFH_APPROVAL_PRIVILEGE = 'attendance.approve';
