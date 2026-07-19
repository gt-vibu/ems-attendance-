// Seed values for a brand-new tenant's role_privilege_defaults, matching
// what the old hardcoded getDefaultPrivilegesForRole() switch used to grant
// — so a new tenant isn't blank on day 0, fully editable afterward via the
// Role Permissions screen. ('attendance.create'/'breaks.create' from the old
// switch are omitted deliberately: grep confirms no route ever actually
// checks hasPrivilege() for either — self check-in/breaks were never
// privilege-gated, just role !== admin — so they were inert and aren't part
// of the feature catalog at all.)
export const STARTER_ROLE_DEFAULTS: Record<string, string[]> = {
  HR: ['employee.create', 'employee.read', 'attendance.read', 'leave.read', 'leave.approve', 'payroll.read', 'payroll.manage', 'reports.view', 'breaks.manage', 'settings.edit', 'branch.manage', 'shift.manage', 'holiday.manage'],
  GM: ['attendance.read', 'attendance.approve', 'leave.read', 'leave.approve', 'payroll.read', 'reports.view', 'breaks.manage', 'settings.edit'],
  manager: ['attendance.read', 'attendance.approve', 'leave.read', 'leave.approve', 'reports.view'],
  employee: ['reports.view'],
};
