// Seed values for a brand-new tenant's role_privilege_defaults, matching
// what the old hardcoded getDefaultPrivilegesForRole() switch used to grant
// — so a new tenant isn't blank on day 0, fully editable afterward via the
// Role Permissions screen. ('attendance.create'/'breaks.create' from the old
// switch are omitted deliberately: grep confirms no route ever actually
// checks hasPrivilege() for either — self check-in/breaks were never
// privilege-gated, just role !== admin — so they were inert and aren't part
// of the feature catalog at all.)
export const STARTER_ROLE_DEFAULTS: Record<string, string[]> = {
  HR: [
    'employee.create', 'employee.read', 'attendance.read', 'attendance.edit',
    'attendance.approve.late_arrival', 'attendance.approve.wfh', 'attendance.approve.corrections',
    'leave.read', 'leave.approve', 'leave.edit',
    'payroll.read', 'payroll.manage', 'reports.view', 'settings.edit', 'branch.manage', 'shift.manage', 'holiday.manage',
    'tickets.manage', 'alerts.security.receive', 'alerts.security.resolve', 'alerts.low_attendance.receive',
  ],
  GM: [
    'attendance.read', 'attendance.approve.late_arrival', 'attendance.approve.wfh', 'attendance.approve.corrections',
    'leave.read', 'leave.approve', 'payroll.read', 'reports.view', 'settings.edit',
    'alerts.break_violation.receive', 'alerts.break_violation.resolve',
    'alerts.geofence_exit.receive', 'alerts.geofence_exit.resolve',
    'alerts.security.receive', 'alerts.security.resolve', 'alerts.low_attendance.receive',
  ],
  // A hired manager gets late-arrival/WFH/correction approval and
  // break-violation/GPS-out-of-bounds alerts for their own team by default
  // (the exact ask: "if he can receive, accept and reject alerts") — still
  // fully revocable per-role afterward, one toggle at a time.
  manager: [
    'attendance.read', 'attendance.approve.late_arrival', 'attendance.approve.wfh', 'attendance.approve.corrections',
    'leave.read', 'leave.approve', 'reports.view',
    'alerts.break_violation.receive', 'alerts.break_violation.resolve',
    'alerts.geofence_exit.receive', 'alerts.geofence_exit.resolve',
  ],
  employee: ['reports.view'],
};
