// SmartTeams Federation Provider API (/v1/federation/*) — every router
// here carries its own full path (same flat-mount convention as
// api/routes/index.ts), so mounting order doesn't matter. See
// docs/plan discussion: this is purely additive, no existing route is
// touched by anything under this directory.
export { router as federationOauthRouter } from './oauth.routes';
export { router as federationPlatformRouter } from './platform.routes';
export { router as federationTenantsRouter } from './tenants.routes';
export { router as federationEmployeesRouter } from './employees.routes';
export { router as federationAttendanceRouter } from './attendance.routes';
export { router as federationWebauthnRouter } from './webauthn.routes';
export { router as federationLeaveRouter } from './leave.routes';
export { router as federationPayrollRouter } from './payroll.routes';
