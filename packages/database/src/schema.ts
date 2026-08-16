import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, text, timestamp, boolean, jsonb, real, uniqueIndex, index, type AnyPgColumn } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  adminUid: text('admin_uid').notNull(),
  status: text('status').notNull().default('active'), // 'active' | 'suspended'
  // IANA timezone the company actually operates in — every "what calendar
  // day is this" computation (attendance day boundaries, absent-marking,
  // payroll periods) should key off this, not the Node process's ambient
  // local time (which on Render defaults to UTC unless overridden). See
  // services/tenantTime.ts.
  timezone: text('timezone').default('Asia/Kolkata'),
  wifiSsid: text('wifi_ssid'),
  officeIp: text('office_ip'), // Tenant registered corporate public IP address
  wifiCheckEnabled: boolean('wifi_check_enabled').default(false), // Explicit admin toggle — independent of whether officeIp happens to be filled in
  locationLat: real('location_lat'),
  locationLng: real('location_lng'),
  locationRadiusMeters: integer('location_radius_meters').default(100),
  plan: text('plan').default('Basic'), // 'Basic' | 'Professional' | 'Enterprise'
  featuresAllowed: jsonb('features_allowed'), // features enabled by super admin e.g. ['kyc', 'wifi_lock', 'gps_geofence', 'custom_rbac']
  shiftStart: text('shift_start').default('09:00'),
  shiftEnd: text('shift_end').default('18:00'),
  gracePeriodMins: integer('grace_period_mins').default(15),
  // Missed-checkout verification (Phase 5 of the roadmap) -- how long past
  // shift end to wait before treating a still-checked-in employee as a
  // missed checkout, mirroring gracePeriodMins' role for late check-in.
  // Only consulted when the 'missed_checkout_verification' platform
  // feature is enabled for this tenant; the old fixed-23:59 auto-checkout
  // stays exactly as-is otherwise.
  checkoutGraceMins: integer('checkout_grace_mins').default(15),
  halfDayMins: integer('half_day_mins').default(240),
  weekendConfig: jsonb('weekend_config').default('["Saturday", "Sunday"]'),
  dailyBreakBudgetMins: integer('daily_break_budget_mins').default(60),
  // Minimum acceptable monthly attendance percentage, computed per user
  // (every clock-in role except tenant_admin) from approved check-ins over
  // working days so far this month. Dropping below it triggers hierarchical
  // email alerts — see computeAttendancePercent() in server.ts.
  minAttendancePercent: integer('min_attendance_percent').default(75),
  // --- Configurable Attendance Policy — replaces the old "buffer time is
  // the only knob" model. Defaults reproduce today's exact behavior for
  // every existing tenant: arrivalPolicy 'buffered' uses gracePeriodMins
  // exactly as before, workingHoursPolicy 'fixed_shift_end' never forces an
  // expected checkout (worked hours = actual elapsed time, same as today). ---
  arrivalPolicy: text('arrival_policy').default('buffered'), // 'strict' | 'buffered' | 'flexible'
  workingHoursPolicy: text('working_hours_policy').default('fixed_shift_end'), // 'fixed_shift_end' | 'complete_required_hours' | 'hybrid'
  requiredWorkingMins: integer('required_working_mins'), // null = derive from shift/branch/tenant checkInTime..checkOutTime span
  hybridMaxCheckoutTime: text('hybrid_max_checkout_time'), // 'HH:MM', only meaningful when workingHoursPolicy = 'hybrid'
  // Org-wide opt-in: real computed overtime/half-day/short-day pay
  // adjustments only start affecting payroll once an admin explicitly
  // turns this on. Default false keeps every existing tenant's payroll
  // numbers byte-for-byte identical (overtimeHours always 0, as before).
  overtimePayrollEnabled: boolean('overtime_payroll_enabled').default(false),
  // Notification quiet hours ('HH:MM', tenant-local per `timezone` above) —
  // null/either-unset disables the feature entirely (existing behavior).
  // Only 'immediate'-mode, non-critical-priority notifications are deferred
  // into the digest queue during this window; critical notifications always
  // bypass it. See notify() in services/notificationService.ts.
  quietHoursStart: text('quiet_hours_start'),
  quietHoursEnd: text('quiet_hours_end'),
  // --- Work From Home (WFH) policy — additive attendance mode alongside the
  // office flow above; every field here is optional/defaulted so existing
  // tenants behave exactly as before (WFH disabled) until an admin opts in. ---
  wfhEnabled: boolean('wfh_enabled').default(false),
  wfhAllowedRoles: jsonb('wfh_allowed_roles'), // string[] of role names; null/empty = all clock-in-capable roles allowed
  wfhMaxDaysPerMonth: integer('wfh_max_days_per_month'), // null = unlimited
  wfhAllowedWeekdays: jsonb('wfh_allowed_weekdays').default('["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]'),
  wfhRadiusMeters: integer('wfh_radius_meters').default(200), // allowed distance from the employee's registered home location
  wfhApprovalRequired: boolean('wfh_approval_required').default(true), // if true, every WFH check-in is 'pending' until a manager/admin approves, regardless of lateness
  wfhRequireReason: boolean('wfh_require_reason').default(true),
  wfhLateLoginGraceMins: integer('wfh_late_login_grace_mins'), // null = reuse gracePeriodMins above
  // --- Dynamic QR Attendance policy — additive; qrEnabled defaults false so
  // existing tenants are entirely unaffected until an admin opts in. ---
  qrEnabled: boolean('qr_enabled').default(false),
  qrRotationSeconds: integer('qr_rotation_seconds').default(30), // one of 15 | 30 | 60 | 120
  qrRequireGps: boolean('qr_require_gps').default(true),
  qrRequireWifi: boolean('qr_require_wifi').default(false),
  qrRequireFace: boolean('qr_require_face').default(true),
  qrGeofenceRadiusMeters: integer('qr_geofence_radius_meters'), // null = reuse locationRadiusMeters above
  qrRequireDeviceTrust: boolean('qr_require_device_trust').default(false), // reuses the existing users.registeredDeviceId pinning, not a separate device list
  // Company-wide KYC/face-verification switch (see /api/tenant/config/update)
  // and the first-login branch-setup-wizard completion flag (see
  // /api/branches/bulk) — both columns already existed via a boot-time
  // ALTER TABLE but were missing here, so Drizzle silently dropped them from
  // every select/update, making the wizard reappear on every login and the
  // KYC toggle never persist.
  kycEnabled: boolean('kyc_enabled').default(true),
  branchSetupCompleted: boolean('branch_setup_completed').default(false),
  // Tenant admin's own on/off switch for face recognition as the primary
  // identity check — distinct from PLATFORM_FEATURES['face_recognition']
  // in rbac.ts, which is the super-admin plan-level allow-list. Deliberately
  // no default (stays NULL until an admin explicitly toggles it): a plain
  // `false` default would have silently turned OFF face recognition for
  // every tenant that already had it working via an unrestricted platform
  // allow-list. NULL means "no explicit choice yet — defer to whatever the
  // platform allows," preserving today's behavior for everyone; true/false
  // only takes over once the admin actually uses the new toggle (see
  // buildSessionUser() in session.ts).
  faceIdEnabled: boolean('face_id_enabled'),
  // Company-wide announcement shown on both the admin and employee
  // dashboards — plain text, admin-editable, gated behind the
  // 'tenant.policy.manage' privilege (see featureCatalog.ts). Null/empty
  // means no banner renders anywhere.
  policyAnnouncement: text('policy_announcement'),
  policyAnnouncementUpdatedAt: timestamp('policy_announcement_updated_at'),
  // Company-wide switch for the employee-document-storage feature (offer
  // letters, contracts, ID proof, certificates) — off by default so no
  // tenant gets an unexpected new upload surface; a tenant_admin opts in
  // from Administration.
  documentsEnabled: boolean('documents_enabled').default(false),
  // 0 = disabled (no expiry / no idle logout) for both — matches the
  // existing "null/0 means off" convention used by wfhMaxDaysPerMonth etc.
  // above, rather than a separate boolean + number pair.
  passwordExpiryDays: integer('password_expiry_days').default(0),
  idleTimeoutMinutes: integer('idle_timeout_minutes').default(0),
  // Months of attendance_logs history to keep in the hot table before a
  // row is moved to attendance_logs_archive (same shape, still queryable,
  // just off the hot path). 0 = keep forever (no archival runs).
  attendanceRetentionMonths: integer('attendance_retention_months').default(0),
  // Report branding (see api/services/reportFileExport.ts) — an
  // already-hosted image URL, not a file upload; null means the exported
  // report header just shows the company name with no logo, never a
  // broken image.
  reportLogoUrl: text('report_logo_url'),
  reportAddress: text('report_address'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Named departments scoped to a tenant. Employees reference a department by
// name (free text on the users row), but this table lets admins manage the
// canonical list and assign a department head.
export const departments = pgTable('departments', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  // Deferred reference (users is declared later in this file) — was a
  // plain integer column with only a comment claiming the FK relationship
  // for a long time, so the DB never actually enforced it. set null on
  // delete: a department shouldn't be blocked from ever deleting its head
  // just because they left the company.
  headUserId: integer('head_user_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
});

export const branches = pgTable('branches', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  name: text('name').notNull(),
  address: text('address'),
  locationLat: real('location_lat'),
  locationLng: real('location_lng'),
  locationRadiusMeters: integer('location_radius_meters').default(100),
  isMainBranch: boolean('is_main_branch').default(false),
  status: text('status').notNull().default('active'),
  shiftStart: text('shift_start').default('09:00'),
  shiftEnd: text('shift_end').default('18:00'),
  gracePeriodMins: integer('grace_period_mins').default(15),
  halfDayMins: integer('half_day_mins').default(240),
  weekendConfig: jsonb('weekend_config').default('["Saturday", "Sunday"]'),
  dailyBreakBudgetMins: integer('daily_break_budget_mins').default(60),
  minAttendancePercent: integer('min_attendance_percent').default(75),
  wifiSsid: text('wifi_ssid'),
  officeIp: text('office_ip'),
  wifiCheckEnabled: boolean('wifi_check_enabled').default(false),
  qrEnabled: boolean('qr_enabled').default(false),
  qrRotationSeconds: integer('qr_rotation_seconds').default(30),
  qrRequireGps: boolean('qr_require_gps').default(true),
  qrRequireWifi: boolean('qr_require_wifi').default(false),
  qrRequireFace: boolean('qr_require_face').default(true),
  qrGeofenceRadiusMeters: integer('qr_geofence_radius_meters'),
  qrRequireDeviceTrust: boolean('qr_require_device_trust').default(false),
  // Per-branch override of the tenant's Attendance Policy — same fallback
  // convention as every other branch policy field above (null = fall back
  // to the tenant-level value).
  arrivalPolicy: text('arrival_policy'),
  workingHoursPolicy: text('working_hours_policy'),
  requiredWorkingMins: integer('required_working_mins'),
  hybridMaxCheckoutTime: text('hybrid_max_checkout_time'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const shifts = pgTable('shifts', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  branchId: integer('branch_id').references(() => branches.id).notNull(),
  name: text('name').notNull(),
  checkInTime: text('check_in_time').notNull(),
  checkOutTime: text('check_out_time').notNull(),
  gracePeriodMins: integer('grace_period_mins'),
  isDefault: boolean('is_default').default(false),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Shift Versioning audit trail. Note the correctness guarantee this
// codebase already had before this table existed: attendanceLogs snapshots
// isLate/lateByMinutes/overtimeMinutes at check-in/check-out time (see
// services/attendancePolicy.ts), it never re-derives them from the shift's
// CURRENT checkInTime/checkOutTime — so editing a shift's timings has never
// silently rewritten historical attendance/payroll. What was actually
// missing was visibility: the audit ledger recorded SHIFT_UPDATED with only
// the new values, not what changed from. This table adds the old->new diff
// as its own queryable-by-shift record.
export const shiftHistory = pgTable('shift_history', {
  id: serial('id').primaryKey(),
  shiftId: integer('shift_id').references(() => shifts.id).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  action: text('action').notNull(), // 'created' | 'updated' | 'deactivated' | 'reactivated'
  previous: jsonb('previous'), // {name, checkInTime, checkOutTime, gracePeriodMins, status} before the change, null for 'created'
  next: jsonb('next').notNull(), // the same shape after the change
  actorUserId: integer('actor_user_id').references(() => users.id),
  actorName: text('actor_name'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Delegation: fine-grained, time-bounded privilege delegation (e.g. a
// manager going on leave delegates specific approval privileges to someone
// else) — never an identity swap. `privilegeKeys` is a subset of the
// delegator's OWN effective privileges (enforced at creation, see
// delegation.routes.ts) so nobody can hand out power they don't hold
// themselves, same guarantee getEffectivePrivileges() already protects for
// role editing. Auto-expires by date range, checked live in
// hasActiveDelegatedPrivilege() (rbac.ts) — no cron needed for enforcement,
// though a daily job flips `status` to 'expired' for clean audit history.
// Tenant admin / super admin bypass delegation entirely (they already
// bypass every privilege check, see hasPrivilege()) — the emergency
// override the user asked for falls out of that existing behavior for free.
export const delegations = pgTable('delegations', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  delegatedByUserId: integer('delegated_by_user_id').references(() => users.id).notNull(),
  delegatedToUserId: integer('delegated_to_user_id').references(() => users.id).notNull(),
  privilegeKeys: jsonb('privilege_keys').notNull(), // string[] — FEATURE_CATALOG keys being delegated
  startDate: text('start_date').notNull(), // 'YYYY-MM-DD'
  endDate: text('end_date').notNull(),
  reason: text('reason'),
  status: text('status').notNull().default('active'), // 'active' | 'expired' | 'revoked'
  createdAt: timestamp('created_at').defaultNow(),
  revokedAt: timestamp('revoked_at'),
  revokedByUserId: integer('revoked_by_user_id').references(() => users.id),
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull().unique(),
  password: text('password').notNull(),
  name: text('name').notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id),
  branchId: integer('branch_id').references(() => branches.id),
  shiftId: integer('shift_id').references(() => shifts.id),
  role: text('role').notNull().default('employee'), // 'super_admin' | 'tenant_admin' | 'manager' | 'HR' | 'GM' | 'employee'
  privileges: jsonb('privileges'), // Array of granted privileges
  // Employee profile fields
  department: text('department'), // free-text dept name, mirrors departments.name for fast reads
  designation: text('designation'), // job title e.g. 'Senior Engineer', 'HR Manager'
  employmentType: text('employment_type').default('full_time'), // 'full_time' | 'part_time' | 'contract' | 'intern'
  // Self-referential deferred FK — was a plain integer column with only a
  // comment claiming the relationship, never actually enforced at the DB
  // level. set null on delete: a departing manager shouldn't block
  // deleting their own row (also matches headUserId's rule above).
  managerId: integer('manager_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  dateOfJoining: text('date_of_joining'), // ISO date string 'YYYY-MM-DD'
  dateOfExit: text('date_of_exit'), // ISO date string 'YYYY-MM-DD'
  phone: text('phone'), // mobile phone
  employeeStatus: text('employee_status').default('active'), // 'active' | 'inactive' | 'terminated'
  mustChangePassword: boolean('must_change_password').default(false),
  tempPassword: text('temp_password'),
  isKycCompleted: boolean('is_kyc_completed').default(false),
  faceEmbeddings: jsonb('face_embeddings'),
  // Per-action enrollment record from the guided KYC wizard
  kycActionLog: jsonb('kyc_action_log'),
  // Which identity check this employee completed enrollment with — 'face'
  // or 'webauthn'. Null until they finish either flow. Only ever read to
  // pick which daily check-in UI to show first; the camera-broken rescue
  // path can use WebAuthn for a one-off check-in regardless of this value.
  verificationMethod: text('verification_method'),
  registeredDeviceId: text('registered_device_id'),
  deviceApprovalPending: boolean('device_approval_pending').default(false),
  activeSessionId: text('active_session_id'),
  sessionExpiresAt: timestamp('session_expires_at'),
  lastHeartbeatLat: real('last_heartbeat_lat'),
  lastHeartbeatLng: real('last_heartbeat_lng'),
  lastHeartbeatAt: timestamp('last_heartbeat_at'),
  // When the current password was set — checked against the tenant's
  // passwordExpiryDays (0 = never expires) to force a change via the
  // existing mustChangePassword flag, same mechanism the seeded super
  // admin's one-time password already uses.
  passwordChangedAt: timestamp('password_changed_at').defaultNow(),
  // Bcrypt hashes of the last few passwords (newest last, capped at 5) —
  // checked on password change so a reset can't just bounce back to the
  // same password. Never the plaintext.
  passwordHistory: jsonb('password_history'),
  // Updated (throttled) on each authenticated request — compared against
  // the tenant's idleTimeoutMinutes (0 = disabled) in the authenticate
  // middleware to force a re-login after inactivity, independent of the
  // JWT's own 24h expiry.
  lastActivityAt: timestamp('last_activity_at'),
  // Set once an admin runs the right-to-erasure flow on a terminated
  // employee — name/email/phone/department/designation get overwritten
  // with anonymized placeholders and this timestamp is stamped. Numeric
  // attendance/payroll history is deliberately NOT deleted (needed for
  // statutory retention) — only direct-identifier fields are scrubbed.
  dataErasedAt: timestamp('data_erased_at'),
  // Per-employee channel opt-out — intersected with a notification policy's
  // configured `channels` before delivery (an employee who's turned off
  // email still gets in_app). Defaults both on so this is purely additive;
  // absent/null is treated as "both enabled" the same as this default.
  notificationChannelPrefs: jsonb('notification_channel_prefs').default('{"email":true,"in_app":true}'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const tenancyRequests = pgTable('tenancy_requests', {
  id: serial('id').primaryKey(),
  companyName: text('company_name').notNull(),
  email: text('email').notNull(),
  numEmployees: integer('num_employees').notNull(),
  plan: text('plan').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected'
  createdAt: timestamp('created_at').defaultNow(),
});

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'), // Null for super_admin notifications
  title: text('title').notNull(),
  message: text('message').notNull(),
  isRead: boolean('is_read').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

export const deviceChangeRequests = pgTable('device_change_requests', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  oldDeviceId: text('old_device_id'),
  newDeviceId: text('new_device_id').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected'
  createdAt: timestamp('created_at').defaultNow(),
});

export const breakSessions = pgTable('break_sessions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  // NOT NULL — was nullable while every other tenant-scoped child table in
  // this schema requires it, which meant a break session could exist
  // outside the tenant-filter pattern every other query relies on. Backfilled
  // from users.tenant_id (see bootstrap/database.ts) before this constraint
  // is applied at the DB level, so existing null rows don't break the ALTER.
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  breakType: text('break_type').default('General'), // 'Lunch' | 'Tea' | 'Personal' | 'Meeting' | 'General' | custom
  startTime: timestamp('start_time').defaultNow(),
  endTime: timestamp('end_time'),
  // GPS captured at both ends so a manager/admin can see where the employee
  // actually was when they started and ended the break, rather than trusting
  // a self-reported duration alone.
  startLat: real('start_lat'),
  startLng: real('start_lng'),
  endLat: real('end_lat'),
  endLng: real('end_lng'),
  isViolation: boolean('is_violation').default(false), // exceeded the tenant's daily break budget
  outsideGeofence: boolean('outside_geofence').default(false), // returned from outside the office boundary
  note: text('note'), // optional free-text reason the employee gave when starting the break
  status: text('status').notNull().default('active'), // 'active' | 'completed'
  createdAt: timestamp('created_at').defaultNow(),
});

// Alerts raised for timing/fraud violations (break overstay, geofence exit,
// spoofing signals, etc). Routed like tickets (see services/escalation.ts):
// each alert is assigned to ONE specific resolver at a time — the subject
// employee's manager first, then the tenant's GM, then tenant_admin as the
// backstop — rather than broadcast to everyone holding a receive privilege.
// currentAssigneeUserId/escalationLevel/lastAssignedAt drive both manual
// escalation and the scheduler's 24h auto-forward job, exactly mirroring
// `tickets` above. Per-type receive/accept/reject privileges (see
// featureCatalog.ts) additionally gate WHETHER the assignee is even allowed
// to act — routing decides WHO, privileges decide IF. Kept separate from
// `notifications` (simple read/unread messages) because alerts carry a
// resolvable, assignable, escalating state.
export const attendanceAlerts = pgTable('attendance_alerts', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(), // the employee the alert is about
  breakSessionId: integer('break_session_id').references(() => breakSessions.id),
  type: text('type').notNull(), // 'break_exceeded' | 'break_outside_geofence' | 'geofence_exit_working_hours' | 'late_arrival' | 'spoofing_suspected' | 'auto_checkout_unverified' | 'low_attendance'
  message: text('message').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'accepted' | 'rejected'
  escalationLevel: integer('escalation_level').notNull().default(0), // 0 = manager, 1 = GM, 2 = tenant_admin
  currentAssigneeUserId: integer('current_assignee_user_id').references(() => users.id),
  lastAssignedAt: timestamp('last_assigned_at').defaultNow(),
  resolvedByUserId: integer('resolved_by_user_id').references(() => users.id),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const attendanceLogs = pgTable('attendance_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  status: text('status').notNull(), // 'approved' | 'rejected' | 'pending'
  type: text('type').default('check_in'), // 'check_in' | 'check_out' | 'absent'
  clientTimestamp: timestamp('client_timestamp'), // submitted device timestamp for clock drift check
  fraudScore: real('fraud_score'),
  livenessScore: real('liveness_score'),
  faceMatchScore: real('face_match_score'),
  device: text('device'),
  locationLat: real('location_lat'),
  locationLng: real('location_lng'),
  reason: text('reason'),
  // Employee-provided free-text explanation for a late check-in, collected
  // only when the late-arrival approval workflow kicks in. Kept separate
  // from `reason` (which is system-generated) so each retains a clear,
  // single author.
  explanation: text('explanation'),
  // { requested: string[], verified: string[] } — the dynamic liveness
  // challenge actions asked for vs. which ones the face service actually
  // confirmed were performed in the capture burst. Audit trail for the
  // challenge-response check, not just the pass/fail scores above.
  challenge: jsonb('challenge'),
  // --- Work From Home (WFH) fields — all nullable/defaulted so existing
  // office rows and existing queries are entirely unaffected. ---
  attendanceMode: text('attendance_mode').notNull().default('office'), // 'office' | 'wfh' | 'qr'
  homeLat: real('home_lat'), // the registered home location compared against, snapshotted at submit time
  homeLng: real('home_lng'),
  distanceFromHomeMeters: real('distance_from_home_meters'),
  wfhReason: text('wfh_reason'), // employee-provided reason, when the tenant's wfhRequireReason policy is on
  // Working hours tracking — populated when employee checks out
  checkoutAt: timestamp('checkout_at'),
  workedMinutes: real('worked_minutes'), // minutes worked (check-in to checkout) minus break time
  // --- Configurable Attendance Policy outcome fields — populated by
  // services/attendancePolicy.ts. isLate replaces the old fragile
  // reason-string-matching ("Late Arrival") dashboards used to rely on.
  // All nullable so existing rows (and any code path that doesn't set
  // them) are unaffected. ---
  isLate: boolean('is_late'),
  lateByMinutes: integer('late_by_minutes'),
  expectedCheckoutAt: timestamp('expected_checkout_at'),
  isHalfDay: boolean('is_half_day'),
  isShortDay: boolean('is_short_day'),
  overtimeMinutes: real('overtime_minutes'),
  branchId: integer('branch_id').references(() => branches.id),
  // Set true by the missed-checkout auto-checkout job (Phase 5 of the
  // attendance/payroll roadmap) when it couldn't confirm the employee had
  // actually left the premises — inert until that phase ships. See
  // services/attendanceDayStatus.ts's 'pending_checkout_verification' status.
  pendingVerification: boolean('pending_verification').default(false),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  // Hot path for day-status resolution and payroll input computation:
  // "give me this employee's logs in this tenant within a date range"
  // (attendanceDayStatus.ts loadMonthInputs). Postgres doesn't auto-index
  // FK columns, so without this every such lookup is a sequential scan.
  tenantUserCreatedIdx: index('attendance_logs_tenant_user_created_idx').on(table.tenantId, table.userId, table.createdAt),
  tenantCreatedIdx: index('attendance_logs_tenant_created_idx').on(table.tenantId, table.createdAt),
}));

// Relationships
export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id],
  }),
  attendanceLogs: many(attendanceLogs),
  deviceChangeRequests: many(deviceChangeRequests),
  breakSessions: many(breakSessions),
}));

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  attendanceLogs: many(attendanceLogs),
  deviceChangeRequests: many(deviceChangeRequests),
}));

export const tenancyRequestsRelations = relations(tenancyRequests, () => ({}));

export const notificationsRelations = relations(notifications, () => ({}));

export const deviceChangeRequestsRelations = relations(deviceChangeRequests, ({ one }) => ({
  user: one(users, {
    fields: [deviceChangeRequests.userId],
    references: [users.id],
  }),
  tenant: one(tenants, {
    fields: [deviceChangeRequests.tenantId],
    references: [tenants.id],
  }),
}));

export const breakSessionsRelations = relations(breakSessions, ({ one }) => ({
  user: one(users, {
    fields: [breakSessions.userId],
    references: [users.id],
  }),
}));

export const attendanceAlertsRelations = relations(attendanceAlerts, ({ one }) => ({
  user: one(users, {
    fields: [attendanceAlerts.userId],
    references: [users.id],
  }),
  tenant: one(tenants, {
    fields: [attendanceAlerts.tenantId],
    references: [tenants.id],
  }),
  breakSession: one(breakSessions, {
    fields: [attendanceAlerts.breakSessionId],
    references: [breakSessions.id],
  }),
}));

// Company holiday calendar — configured by the tenant admin, feeds into
// attendance status calculation ("Holiday" instead of "Absent").
export const holidays = pgTable('holidays', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  date: text('date').notNull(), // 'YYYY-MM-DD'
  name: text('name').notNull(),
  // NULL = applies to everyone in the tenant (today's behavior, unchanged).
  // Set either to scope this holiday to one branch/department instead —
  // strict superset of the old tenant-wide-only model, so every existing
  // row (both NULL) keeps working exactly as before.
  branchId: integer('branch_id').references(() => branches.id),
  department: text('department'), // matches users.department's flat string, not a normalized table
  // false = mandatory, applies to everyone in scope automatically (the
  // long-standing default — every pre-existing row keeps this behavior).
  // true = optional/floater — excluded from the mandatory calendar and
  // instead offered as one of the choices in an employee's optional-holiday
  // picker (GET/POST /api/tenant/holidays/optional), capped by
  // payroll_settings.optional_holiday_limit. Before this column existed,
  // every holiday was implicitly part of the optional pool regardless of
  // this distinction — this is a deliberate behavior change, not additive.
  isOptional: boolean('is_optional').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
  // Holiday Versioning: a holiday is never hard-deleted anymore — "delete"
  // archives it instead, so any payroll batch that already calculated
  // against this row (attendance-driven payroll reads the holiday calendar
  // as of calculation time) keeps a truthful historical record instead of
  // the holiday silently vanishing from what would otherwise look like an
  // append-only ledger everywhere else in this codebase. Archived holidays
  // are excluded from every "current calendar" read (employee view,
  // optional-holiday picker, notifications) but stay queryable for audit.
  isArchived: boolean('is_archived').notNull().default(false),
  archivedAt: timestamp('archived_at'),
  archivedByUserId: integer('archived_by_user_id').references(() => users.id),
});

export const holidaysRelations = relations(holidays, ({ one }) => ({
  tenant: one(tenants, {
    fields: [holidays.tenantId],
    references: [tenants.id],
  }),
}));

// Full change history for holidays — created/archived/restored — separate
// from the row itself so a holiday's own fields never carry "who changed
// this and why" clutter, matching the leaveEscalationHistory /
// compensation_history pattern already used elsewhere in this schema.
export const holidayHistory = pgTable('holiday_history', {
  id: serial('id').primaryKey(),
  holidayId: integer('holiday_id').references(() => holidays.id).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  action: text('action').notNull(), // 'created' | 'archived' | 'restored'
  snapshot: jsonb('snapshot').notNull(), // {date, name, branchId, department, isOptional} at the time of the action
  actorUserId: integer('actor_user_id').references(() => users.id),
  actorName: text('actor_name'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Per-employee override on top of a holiday's branch/department scope —
// e.g. exclude one person from a department-wide holiday, or include
// someone outside the scoped branch. Extends the existing
// optionalHolidayChoices pattern (which is "opt into an optional holiday")
// rather than replacing it; this is the mandatory-holiday equivalent.
export const holidayEmployeeOverrides = pgTable('holiday_employee_overrides', {
  id: serial('id').primaryKey(),
  holidayId: integer('holiday_id').references(() => holidays.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  included: boolean('included').notNull(), // true = force-include, false = force-exclude
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  holidayUserUnique: uniqueIndex('holiday_employee_overrides_holiday_user_unique').on(table.holidayId, table.userId),
}));

// Attendance correction / regularization requests — an employee flags a
// missed check-in/out, wrong location, a verification failure (face/GPS/
// biometric), or another reason their attendance doesn't reflect reality,
// and whoever holds 'attendance.approve.corrections' (or the legacy
// 'attendance.approve') reviews it. Approving here does NOT silently rewrite
// the original attendance_logs row (that would break the audit trail) — it
// goes through the same editAttendanceDay() service used by direct admin
// edits and ticket resolution, which either approves the existing flagged
// row in place or inserts a new one, always preserving history. appliedLogId
// traces which attendance_logs row resulted, so the original request stays
// linked to what actually changed.
export const attendanceCorrections = pgTable('attendance_corrections', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  // 'missed_checkin' | 'missed_checkout' | 'marked_absent' | 'wrong_location' |
  // 'face_recognition_failed' | 'gps_verification_failed' | 'biometric_issue' |
  // 'business_travel' | 'wfh_verification_issue' | 'network_issue' | 'other'
  requestType: text('request_type').notNull(),
  requestedDate: text('requested_date').notNull(), // 'YYYY-MM-DD'
  requestedTime: text('requested_time'), // 'HH:MM', optional
  reason: text('reason').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected'
  reviewedByUserId: integer('reviewed_by_user_id').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),
  reviewRemarks: text('review_remarks'),
  // Optional supporting document — reuses the existing employeeDocuments
  // upload/storage/feature-flag machinery (documents.routes.ts) rather than
  // a second parallel file-storage system. Not a drizzle .references() here
  // because employeeDocuments is declared later in this file (would be a
  // forward reference at module-init time) — the FK itself is still created
  // in the bootstrap SQL (see database.ts).
  documentId: integer('document_id'),
  // Set once approved — the attendance_logs row editAttendanceDay() touched,
  // so the UI can show "this request became this attendance record."
  appliedLogId: integer('applied_log_id').references(() => attendanceLogs.id),
  createdAt: timestamp('created_at').defaultNow(),
});

export const attendanceCorrectionsRelations = relations(attendanceCorrections, ({ one }) => ({
  user: one(users, {
    fields: [attendanceCorrections.userId],
    references: [users.id],
  }),
  tenant: one(tenants, {
    fields: [attendanceCorrections.tenantId],
    references: [tenants.id],
  }),
}));

// Admin-configurable "who gets notified/approves for category X" routing —
// generalizes services/escalation.ts's manager->GM->tenant_admin fallback
// (previously only wired to support tickets) to every approval-notification
// call site. No FK to a single "the" approver: a category can have several
// scoped rules; the most specific scope wins, ties broken by priority. A
// tenant with zero rows for a category keeps today's flat
// getUsersWithPrivilege() fan-out — see services/approvalRouting.ts.
export const approvalRoutingRules = pgTable('approval_routing_rules', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  category: text('category').notNull(), // 'leave' | 'attendance_correction' | 'wfh' | 'missed_checkout' | 'late_arrival'
  scopeType: text('scope_type').notNull().default('all'), // 'all' | 'department' | 'branch' | 'team'
  scopeId: integer('scope_id'), // branchId/teamId when scopeType needs one; department is matched by name via scopeValue
  scopeValue: text('scope_value'), // department name, when scopeType = 'department'
  approverType: text('approver_type').notNull(), // 'role' | 'specific_user' | 'reporting_manager'
  approverValue: text('approver_value'), // role name or user id as string; null for 'reporting_manager'
  priority: integer('priority').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

// Per-tenant override of a notification's subject/body — {{placeholder}}
// interpolation. A tenant with no row for (eventType, channel) gets the
// existing hardcoded string from the relevant send*Email/notifyUser call
// site, unchanged — this table only ever overrides, never replaces the
// fallback.
export const notificationTemplates = pgTable('notification_templates', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  eventType: text('event_type').notNull(),
  channel: text('channel').notNull().default('email'), // 'email' | 'push' | 'sms' (only 'email' actually wired today)
  subject: text('subject'),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  tenantEventChannelUnique: uniqueIndex('notification_templates_tenant_event_channel_unique').on(table.tenantId, table.eventType, table.channel),
}));

// Postgres-backed background job queue (see api/services/queue/) — email
// sending, payroll recalculation, notification delivery, attendance
// reconciliation, report generation, etc. run here instead of inline in a
// request handler. Polled by the same leader-elected scheduler loop that
// already runs the absent-marker/auto-checkout crons (runBackgroundScheduler
// in bootstrap/scheduler.ts), so it's automatically single-instance-safe
// across a multi-replica deployment with no extra plumbing.
// Per-tenant, per-event recipient policy for the unified Notification
// Service (services/notificationService.ts) — the "who gets told when X
// happens" matrix (employee/manager/HR/admin checkboxes) the user asked
// for, instead of each module deciding recipients inline. A tenant with no
// row for an eventType gets a hardcoded safe default matching whatever
// that event's behavior already was before this table existed — see
// DEFAULT_POLICIES in notificationService.ts.
export const notificationPolicies = pgTable('notification_policies', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  eventType: text('event_type').notNull(),
  notifyEmployee: boolean('notify_employee').notNull().default(true),
  notifyManager: boolean('notify_manager').notNull().default(false),
  notifyHR: boolean('notify_hr').notNull().default(false),
  notifyAdmin: boolean('notify_admin').notNull().default(false),
  channels: jsonb('channels').notNull().default('["in_app","email"]'), // subset of 'in_app' | 'email' | 'sms' | 'whatsapp' | 'push' (only in_app/email wired today)
  // When true, "HR" recipients are filtered to HR-privileged users whose
  // OWN users.department matches the subject employee's department (e.g.
  // only "Engineering HR" is notified about an Engineering employee),
  // instead of every HR-privileged user tenant-wide. Manager already
  // resolves to the employee's actual reporting manager via
  // resolveEscalationAssignee regardless of this flag — there's no "all
  // managers" version of that bug to fix. Admin stays tenant-wide by design
  // (no branch/department concept applies to "the tenant admin").
  scopeHrToDepartment: boolean('scope_hr_to_department').notNull().default(false),
  // Per-recipient delivery mode — replaces a single event-wide "is this
  // batched" flag, since (e.g.) a manager may need an absence immediately
  // while HR is fine seeing it in a daily rollup. 'immediate' preserves
  // today's exact behavior (the default for every existing row/event, so
  // nothing changes until an admin explicitly reclassifies it). 'digest'
  // routes into notification_digest_queue instead of firing right away.
  // 'none' means that recipient category gets nothing at all for this event
  // even if its notify* flag above is true (lets e.g. a CEO be excluded from
  // a specific noisy event while staying on the admin recipient list
  // generally).
  employeeMode: text('employee_mode').notNull().default('immediate'), // 'immediate' | 'digest' | 'none'
  managerMode: text('manager_mode').notNull().default('immediate'),
  hrMode: text('hr_mode').notNull().default('immediate'),
  adminMode: text('admin_mode').notNull().default('immediate'),
  // 'critical' always sends immediately regardless of *Mode above and
  // bypasses quiet hours entirely. 'silent' forces channel to in_app only
  // regardless of the configured `channels` column. 'high'/'medium'/'low'
  // are informational tiers with no special handling beyond display/sort
  // order in the admin UI today.
  priority: text('priority').notNull().default('medium'), // 'critical' | 'high' | 'medium' | 'low' | 'silent'
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  tenantEventUnique: uniqueIndex('notification_policies_tenant_event_unique').on(table.tenantId, table.eventType),
}));

// Reusable recipient presets ("Default Attendance Group", "Payroll Group",
// "Security Group") — a saved {notifyEmployee/Manager/HR/Admin, channels}
// combination a tenant admin can apply to any event's notification_policies
// row in one click, instead of re-checking the same four boxes across
// dozens of event types. Deliberately NOT a live foreign key from
// notification_policies (an event referencing a group that changes later
// would silently change that event's behavior with no visible diff) —
// applying a group is a one-time copy, same as picking a color from a
// swatch rather than binding to it.
export const notificationRecipientGroups = pgTable('notification_recipient_groups', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  name: text('name').notNull(),
  notifyEmployee: boolean('notify_employee').notNull().default(true),
  notifyManager: boolean('notify_manager').notNull().default(false),
  notifyHR: boolean('notify_hr').notNull().default(false),
  notifyAdmin: boolean('notify_admin').notNull().default(false),
  channels: jsonb('channels').notNull().default('["in_app","email"]'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Every actual delivery attempt notify() makes — one row per
// recipient×channel, written by the queue's 'deliver_notification' handler
// itself (services/notificationService.ts), so this only ever records what
// really happened, not what was merely enqueued. Deliberately stops at
// Sent/Failed: Delivered/Opened/Clicked would need an email provider's
// webhook events (SendGrid/Postmark/SES) as the source of truth, which
// this app has no provider integration for yet — faking those states from
// data this app doesn't have would be worse than not showing them.
export const notificationLog = pgTable('notification_log', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  eventType: text('event_type').notNull(),
  recipientUserId: integer('recipient_user_id').references(() => users.id),
  channel: text('channel').notNull(), // 'in_app' | 'email'
  status: text('status').notNull(), // 'sent' | 'failed'
  error: text('error'),
  attempts: integer('attempts').notNull().default(1),
  // Stored so a failed delivery can be retried with the exact original
  // content from the admin UI's History tab, instead of only being able to
  // re-fire a contextless notification of the same eventType.
  subjectName: text('subject_name'),
  data: jsonb('data').default('{}'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Holding area for 'digest'-mode notifications (see notificationPolicies'
// *Mode columns) until the scheduled digestDispatcher job in
// services/digestDispatcher.ts rolls them into one summary per recipient.
// Same-day duplicates of the same (recipient, eventType) collapse into a
// single row via the unique index below instead of accumulating one row per
// occurrence — "GPS failed" five times becomes one row with
// occurrenceCount: 5, not five rows.
export const notificationDigestQueue = pgTable('notification_digest_queue', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  recipientUserId: integer('recipient_user_id').references(() => users.id).notNull(),
  eventType: text('event_type').notNull(),
  digestBucketDate: text('digest_bucket_date').notNull(), // 'YYYY-MM-DD', tenant-local day this occurrence belongs to
  occurrenceCount: integer('occurrence_count').notNull().default(1),
  sampleSubjectNames: jsonb('sample_subject_names').notNull().default('[]'), // string[], capped, for "John, Rahul, Arjun"
  data: jsonb('data').notNull().default('{}'),
  consumed: boolean('consumed').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  dedupeKey: uniqueIndex('digest_queue_dedupe_unique').on(table.tenantId, table.recipientUserId, table.eventType, table.digestBucketDate),
}));

// Admin-configurable "who gets the rollup, how often" — the fix for the old
// hardcoded admins[0]-only daily summary. recipients supports both role
// based defaults and arbitrary named employees:
// [{type:'role', role:'manager'|'HR'|'tenant_admin'} | {type:'user', userId:number}]
// so a tenant admin can add e.g. a specific COO to the executive digest
// without that person needing the tenant_admin role. nextRunAt-driven due
// check (same pattern as reportSchedules), not fixed hour/min branches, so
// admin-configured send times just work without new scheduler code.
export const notificationDigestSubscriptions = pgTable('notification_digest_subscriptions', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  digestType: text('digest_type').notNull(), // 'manager_daily' | 'manager_weekly' | 'hr_daily' | 'hr_weekly' | 'executive_daily' | 'executive_weekly'
  frequency: text('frequency').notNull().default('daily'), // 'daily' | 'weekly'
  timeOfDay: text('time_of_day').notNull().default('09:00'), // 'HH:MM', tenant-local
  dayOfWeek: integer('day_of_week'), // 0=Sunday..6=Saturday, only for 'weekly'
  recipients: jsonb('recipients').notNull().default('[]'),
  active: boolean('active').notNull().default(true),
  lastRunAt: timestamp('last_run_at'),
  nextRunAt: timestamp('next_run_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const backgroundJobs = pgTable('background_jobs', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id),
  jobType: text('job_type').notNull(),
  payload: jsonb('payload').notNull().default('{}'),
  status: text('status').notNull().default('pending'), // 'pending' | 'running' | 'done' | 'failed'
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  runAfter: timestamp('run_after').defaultNow(),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow(),
  completedAt: timestamp('completed_at'),
});

// Reports & Analytics — a saved filter configuration (report type + date
// range/department/branch/etc.), so a user doesn't have to rebuild the same
// filters every time. Replaces an earlier in-memory-only prototype (lost on
// every server restart, inconsistent across replicas) with real persistence.
export const reportSavedTemplates = pgTable('report_saved_templates', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  createdByUserId: integer('created_by_user_id').references(() => users.id).notNull(),
  name: text('name').notNull(),
  reportType: text('report_type').notNull(), // 'attendance' | 'leave' | 'payroll' | 'employee' | ...
  filters: jsonb('filters').notNull().default('{}'),
  createdAt: timestamp('created_at').defaultNow(),
});

// A recurring report delivery — actually executed (see services/
// reportScheduler.ts registering a queue job handler + bootstrap/
// scheduler.ts checking due schedules each tick), not just a config row
// nothing reads. `nextRunAt` is the only mutable scheduling state; the
// scheduler advances it after each successful enqueue.
export const reportSchedules = pgTable('report_schedules', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  createdByUserId: integer('created_by_user_id').references(() => users.id).notNull(),
  reportName: text('report_name').notNull(),
  reportType: text('report_type').notNull(),
  filters: jsonb('filters').notNull().default('{}'),
  frequency: text('frequency').notNull(), // 'daily' | 'weekly' | 'monthly'
  dayOfWeek: integer('day_of_week'), // 0=Sunday..6=Saturday, only for 'weekly'
  dayOfMonth: integer('day_of_month'), // 1-28, only for 'monthly'
  timeOfDay: text('time_of_day').notNull().default('08:00'), // 'HH:MM', tenant-local per tenants.timezone
  recipients: jsonb('recipients').notNull().default('[]'), // string[] of email addresses
  format: text('format').notNull().default('csv'), // 'csv' today — see reportScheduler.ts for why not pdf/excel yet
  active: boolean('active').notNull().default(true),
  lastRunAt: timestamp('last_run_at'),
  nextRunAt: timestamp('next_run_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Manual, HR-controlled "close the books" action for a tenant's attendance
// in a given month — never automatic, never reversed (a mistaken freeze is
// corrected via a payroll adjustment later, not by unfreezing; see the
// roadmap plan, Phase 3/7). Once a period is frozen, any date inside it that
// still resolves to 'absent_pending_review' (see services/
// attendanceDayStatus.ts) with no approved correction becomes 'lop' —
// nothing is written back to attendance_logs for this; it's a derived
// status, computed by checking this table, exactly like 'absent' itself is
// already a computed-not-stored state elsewhere in this codebase.
export const attendanceFreezePeriods = pgTable('attendance_freeze_periods', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  frozenAt: timestamp('frozen_at').defaultNow(),
  frozenByUserId: integer('frozen_by_user_id').references(() => users.id),
}, (table) => ({
  tenantPeriodUnique: uniqueIndex('attendance_freeze_periods_tenant_period_unique').on(table.tenantId, table.year, table.month),
}));

export const departmentsRelations = relations(departments, ({ one }) => ({
  tenant: one(tenants, {
    fields: [departments.tenantId],
    references: [tenants.id],
  }),
}));

// Manual leave balance adjustments by admin — adds or deducts days from
// an employee's leave bucket outside of the normal request/approve flow.
export const leaveBalanceAdjustments = pgTable('leave_balance_adjustments', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  leaveType: text('leave_type').notNull(),
  adjustmentDays: real('adjustment_days').notNull(), // positive = add, negative = deduct
  reason: text('reason').notNull(),
  adjustedByUserId: integer('adjusted_by_user_id').references(() => users.id).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const attendanceLogsRelations = relations(attendanceLogs, ({ one }) => ({
  user: one(users, {
    fields: [attendanceLogs.userId],
    references: [users.id],
  }),
  tenant: one(tenants, {
    fields: [attendanceLogs.tenantId],
    references: [tenants.id],
  }),
}));

// An employee's registered Work From Home location. At most one 'active'
// row per employee at a time — employees cannot edit this directly (see
// wfhLocationChangeRequests below); a new 'active' row is only ever created
// by first-time registration or an approved change request, and the
// previous 'active' row (if any) is flipped to 'superseded' at that point,
// preserving full history rather than overwriting it.
export const employeeHomeLocations = pgTable('employee_home_locations', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  latitude: real('latitude').notNull(),
  longitude: real('longitude').notNull(),
  accuracy: real('accuracy'),
  address: text('address'), // reverse-geocoded label; null until a geocoding provider is configured (see apps/admin/geocoding.ts)
  status: text('status').notNull().default('active'), // 'active' | 'superseded'
  createdAt: timestamp('created_at').defaultNow(),
});

export const employeeHomeLocationsRelations = relations(employeeHomeLocations, ({ one }) => ({
  user: one(users, {
    fields: [employeeHomeLocations.userId],
    references: [users.id],
  }),
  tenant: one(tenants, {
    fields: [employeeHomeLocations.tenantId],
    references: [tenants.id],
  }),
}));

// Employees cannot edit their registered home location directly — they
// request a change, and whoever holds 'attendance.approve' reviews it (same
// authorization convention as attendanceCorrections above). Approving one of
// these is what creates the new employeeHomeLocations row.
export const wfhLocationChangeRequests = pgTable('wfh_location_change_requests', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  newLatitude: real('new_latitude').notNull(),
  newLongitude: real('new_longitude').notNull(),
  newAccuracy: real('new_accuracy'),
  newAddress: text('new_address'),
  reason: text('reason'),
  status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected'
  reviewedByUserId: integer('reviewed_by_user_id').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const wfhLocationChangeRequestsRelations = relations(wfhLocationChangeRequests, ({ one }) => ({
  user: one(users, {
    fields: [wfhLocationChangeRequests.userId],
    references: [users.id],
  }),
  tenant: one(tenants, {
    fields: [wfhLocationChangeRequests.tenantId],
    references: [tenants.id],
  }),
}));

// A displayed QR "session" (Start Session -> Stop Session). The actual QR
// image rotates every `rotationSeconds` (or immediately after a successful
// scan, whichever is sooner) without creating a new row each rotation —
// `currentNonce`/`currentTokenExpiresAt`/`currentNonceUsed` are simply
// overwritten in place, and every rotation is itself a signed, short-lived
// JWT (see apps/admin/qr.ts), not a bare DB id, so a leaked/replayed QR
// image can't be reused even within its own validity window.
export const qrSessions = pgTable('qr_sessions', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  generatedByUserId: integer('generated_by_user_id').references(() => users.id).notNull(),
  status: text('status').notNull().default('active'), // 'active' | 'closed'
  rotationSeconds: integer('rotation_seconds').notNull().default(30),
  currentNonce: text('current_nonce').notNull(),
  currentTokenIssuedAt: timestamp('current_token_issued_at').notNull(),
  currentTokenExpiresAt: timestamp('current_token_expires_at').notNull(),
  currentNonceUsed: boolean('current_nonce_used').notNull().default(false),
  // No denormalized scan/success/fail counters here — GET /api/qr/current
  // computes live counts straight from qr_scans (small per-session row
  // counts, indexed by session id), which is simpler and can't drift out of
  // sync the way a manually-incremented counter could under concurrent scans.
  createdAt: timestamp('created_at').defaultNow(),
  closedAt: timestamp('closed_at'),
});

export const qrSessionsRelations = relations(qrSessions, ({ one }) => ({
  tenant: one(tenants, {
    fields: [qrSessions.tenantId],
    references: [tenants.id],
  }),
  generatedBy: one(users, {
    fields: [qrSessions.generatedByUserId],
    references: [users.id],
  }),
}));

// One row per scan ATTEMPT (not per successful attendance) — the full audit
// trail the spec asks for ("every action traceable"). `attendanceLogId` is
// only set once verification actually succeeds and an attendance_logs row
// is written; a failed/expired/replayed attempt still gets a row here with
// `status`/`failureReason` explaining why, but never touches attendance_logs.
export const qrScans = pgTable('qr_scans', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  qrSessionId: integer('qr_session_id').references(() => qrSessions.id).notNull(),
  scannedByUserId: integer('scanned_by_user_id').references(() => users.id).notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'success' | 'failed'
  failureReason: text('failure_reason'),
  gpsPassed: boolean('gps_passed'),
  wifiPassed: boolean('wifi_passed'),
  facePassed: boolean('face_passed'),
  deviceTrustPassed: boolean('device_trust_passed'),
  distanceMeters: real('distance_meters'),
  deviceId: text('device_id'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  attendanceLogId: integer('attendance_log_id').references(() => attendanceLogs.id),
  createdAt: timestamp('created_at').defaultNow(),
});

export const qrScansRelations = relations(qrScans, ({ one }) => ({
  tenant: one(tenants, {
    fields: [qrScans.tenantId],
    references: [tenants.id],
  }),
  session: one(qrSessions, {
    fields: [qrScans.qrSessionId],
    references: [qrSessions.id],
  }),
  scannedBy: one(users, {
    fields: [qrScans.scannedByUserId],
    references: [users.id],
  }),
  attendanceLog: one(attendanceLogs, {
    fields: [qrScans.attendanceLogId],
    references: [attendanceLogs.id],
  }),
}));

export const auditLedger = pgTable('audit_ledger', {
  id: serial('id').primaryKey(),
  timestamp: timestamp('timestamp').defaultNow(),
  tenantId: integer('tenant_id').references(() => tenants.id),
  actorId: integer('actor_id').references(() => users.id),
  actorName: text('actor_name').notNull(),
  action: text('action').notNull(), // 'CHECK_IN' | 'CHECK_OUT' | 'FACE_VERIFIED' | 'GEOFENCE_VERIFIED' | 'BREAK_STARTED' | 'BREAK_ENDED' | 'ATTENDANCE_EDITED' | 'MANAGER_APPROVED' | 'DEVICE_MIGRATION_APPROVED' | 'LEAVE_APPROVED'
  ipAddress: text('ip_address'),
  deviceInfo: text('device_info'),
  details: jsonb('details'),
  hash: text('hash').notNull(),
  // Correlates multiple log lines written during one HTTP request. Optional
  // — most call sites don't pass it (see services/audit.ts).
  requestId: text('request_id'),
});

export const auditLedgerRelations = relations(auditLedger, ({ one }) => ({
  tenant: one(tenants, {
    fields: [auditLedger.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [auditLedger.actorId],
    references: [users.id],
  }),
}));

export const rolePrivilegeDefaults = pgTable('role_privilege_defaults', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  roleName: text('role_name').notNull(),
  privileges: jsonb('privileges').notNull().default('[]'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const userBranchAccess = pgTable('user_branch_access', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  branchId: integer('branch_id').references(() => branches.id).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const leavePolicies = pgTable('leave_policies', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  branchId: integer('branch_id').references(() => branches.id),
  name: text('name').notNull(),
  code: text('code').notNull(),
  maxDaysPerYear: real('max_days_per_year').notNull().default(12),
  allowHalfDay: boolean('allow_half_day').notNull().default(true),
  requiresApproval: boolean('requires_approval').notNull().default(true),
  medicalOnlyNoAdvanceNoticeDays: real('medical_only_no_advance_notice_days').default(0),
  defaultDeductionPercent: real('default_deduction_percent').notNull().default(100),
  // When on, the balance available so far this year is prorated by month
  // elapsed (maxDaysPerYear/12 per completed month) instead of the full
  // annual allotment being available from Jan 1 — see computeAccruedDays()
  // in leave.routes.ts.
  accrualEnabled: boolean('accrual_enabled').notNull().default(false),
  // When on, up to maxCarryForwardDays of last year's unused balance for
  // this policy is added into the current year's available days — one
  // year back only (no unbounded chaining), computed lazily alongside the
  // normal balance calculation rather than needing its own cron.
  carryForwardEnabled: boolean('carry_forward_enabled').notNull().default(false),
  maxCarryForwardDays: real('max_carry_forward_days').notNull().default(0),
  // When on, an employee can request to convert unused days of this leave
  // type into pay — see leaveEncashmentRequests below.
  encashmentEnabled: boolean('encashment_enabled').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

// An employee's request to convert unused leave into pay. ratePerDay/amount
// are null until approved, at which point they're snapshotted from that
// month's payroll daily rate (buildPayrollSummary's dailyRate) — so a later
// CTC change never silently rewrites an already-approved encashment, same
// non-retroactive principle as payrollRuns.
export const leaveEncashmentRequests = pgTable('leave_encashment_requests', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  policyId: integer('policy_id').references(() => leavePolicies.id).notNull(),
  leaveType: text('leave_type').notNull(),
  days: real('days').notNull(),
  ratePerDay: real('rate_per_day'),
  amount: real('amount'),
  reason: text('reason'),
  status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected'
  reviewedByUserId: integer('reviewed_by_user_id').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const leaveRequests = pgTable('leave_requests', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  policyId: integer('policy_id').references(() => leavePolicies.id),
  leaveType: text('leave_type').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  totalDays: real('total_days').notNull(),
  medicalCause: boolean('medical_cause').notNull().default(false),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('pending'),
  reviewedByUserId: integer('reviewed_by_user_id').references(() => users.id),
  reviewerComment: text('reviewer_comment'),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').defaultNow(),
  // Escalation Engine: mirrors the ticket/alert 24h auto-escalation
  // machinery in escalation.ts (0=manager, 1=GM, 2=tenant_admin). A pending
  // request left unactioned for 24h walks one level up and re-notifies;
  // null/0 for every existing row means "not yet escalated," so this is
  // additive and changes nothing until the scheduler job actually escalates
  // something.
  escalationLevel: integer('escalation_level').notNull().default(0),
  lastEscalatedAt: timestamp('last_escalated_at'),
}, (table) => ({
  // Tenant-wide "list pending/approved requests" and per-employee history
  // both filter on these columns (leave.routes.ts GET /api/tenant/leave/requests).
  tenantStatusIdx: index('leave_requests_tenant_status_idx').on(table.tenantId, table.status),
  tenantUserIdx: index('leave_requests_tenant_user_idx').on(table.tenantId, table.userId),
}));

export const payrollSettings = pgTable('payroll_settings', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  // Whether a payroll batch with unapplied payroll_adjustments (created
  // e.g. when an attendance correction lands on an already-locked period)
  // can still be released. Default false = warn only (today's existing
  // behavior, unchanged) — a tenant explicitly opts into the stricter
  // "block release" policy.
  blockPayrollReleaseOnPendingAdjustments: boolean('block_payroll_release_on_pending_adjustments').default(false),
  // Tenant-admin-facing on/off switch for the payroll lock workflow
  // (POST /api/tenant/payroll/:runId/lock — see payroll.routes.ts). Sits
  // BELOW the super-admin platform feature 'payroll_lock_adjustments' in
  // the gating chain: a tenant only sees/can use this at all if the
  // platform allows it for their plan, and this flag is then their own
  // choice of whether to actually turn the enforcement on. Defaults true
  // so existing behavior for tenants already using locking is unchanged.
  payrollLockingEnabled: boolean('payroll_locking_enabled').notNull().default(true),
  workingDaysPerMonth: integer('working_days_per_month').notNull().default(26),
  lopCalculationPolicy: text('lop_calculation_policy').default('fixed_26'), // 'fixed_26' | 'calendar_days' | 'working_days'
  monthlySalaryBasis: text('monthly_salary_basis').default('actual_calendar_days'), // '30_days' | 'actual_calendar_days' | 'working_days'
  includePaidHolidays: boolean('include_paid_holidays').default(true),
  includePaidWeekends: boolean('include_paid_weekends').default(true),
  includeApprovedPaidLeave: boolean('include_approved_paid_leave').default(true),
  maxPaidLeaveDaysPerMonth: real('max_paid_leave_days_per_month').notNull().default(0),
  excessLeavePenaltyPercent: real('excess_leave_penalty_percent').notNull().default(100),
  overtimeHourlyRate: real('overtime_hourly_rate').notNull().default(0),
  optionalHolidayLimit: integer('optional_holiday_limit').notNull().default(2),
  holidayCountryCode: text('holiday_country_code').default('IN'),
  holidayRegionCode: text('holiday_region_code'),
  // --- Statutory compliance (India defaults; every rate/ceiling is
  // tenant-editable so this can be adapted to another jurisdiction's
  // numbers without a code change). Each of PF/ESI/Professional Tax/TDS is
  // independently toggleable — a tenant outside India can leave the master
  // switch off entirely, same "opt-in, never forced on" convention as WFH/
  // QR/Documents elsewhere in this schema. TDS here is a SIMPLIFIED
  // slab-based estimate (annualized gross, standard deduction, no HRA/80C/
  // regime election) — a real payroll-compliance product needs a tax
  // professional's sign-off before being trusted for statutory filing;
  // this exists to show a realistic estimate on the payslip, not to BE the
  // statutory computation of record. ---
  statutoryComplianceEnabled: boolean('statutory_compliance_enabled').default(false),
  // Provident Fund — employee + employer both contribute this % of "basic
  // wage" (see statutoryBasicPercentOfGross below), capped at the wage
  // ceiling. Only the employee share reduces take-home pay; the employer
  // share is informational (shown on the payslip, not deducted).
  pfEnabled: boolean('pf_enabled').default(false),
  pfEmployeeRatePercent: real('pf_employee_rate_percent').notNull().default(12),
  pfEmployerRatePercent: real('pf_employer_rate_percent').notNull().default(12),
  pfWageCeiling: real('pf_wage_ceiling').notNull().default(15000),
  // Employee State Insurance — applies only when monthly gross is at or
  // below the wage ceiling (standard ESI rule: once you cross it, you're
  // out of the scheme entirely for that period, not just capped).
  esiEnabled: boolean('esi_enabled').default(false),
  esiEmployeeRatePercent: real('esi_employee_rate_percent').notNull().default(0.75),
  esiEmployerRatePercent: real('esi_employer_rate_percent').notNull().default(3.25),
  esiWageCeiling: real('esi_wage_ceiling').notNull().default(21000),
  // Professional Tax — small state-specific flat/slab deduction. Stored as
  // an ordered array of {minGross, maxGross, amount}; maxGross: null means
  // "and above." Left empty (default) means no deduction even when enabled,
  // until the tenant admin fills in their state's slabs.
  professionalTaxEnabled: boolean('professional_tax_enabled').default(false),
  professionalTaxSlabs: jsonb('professional_tax_slabs').default('[]'),
  // TDS — see the simplified-estimate caveat above. incomeTaxSlabs is an
  // ordered array of {upTo, ratePercent} on annual taxable income (annual
  // gross minus the standard deduction below); upTo: null means "and above."
  // Defaults to India's FY2024-25 new-regime slabs.
  tdsEnabled: boolean('tds_enabled').default(false),
  incomeTaxSlabs: jsonb('income_tax_slabs').default('[{"upTo":300000,"ratePercent":0},{"upTo":600000,"ratePercent":5},{"upTo":900000,"ratePercent":10},{"upTo":1200000,"ratePercent":15},{"upTo":1500000,"ratePercent":20},{"upTo":null,"ratePercent":30}]'),
  tdsStandardDeduction: real('tds_standard_deduction').notNull().default(50000),
  // What fraction of monthly gross counts as "basic wage" for PF/ESI when
  // no salary component is explicitly named "Basic" — the common Indian
  // payroll convention when CTC isn't broken into named components.
  statutoryBasicPercentOfGross: real('statutory_basic_percent_of_gross').notNull().default(50),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const employeeCompensationProfiles = pgTable('employee_compensation_profiles', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  annualCtc: real('annual_ctc').notNull(),
  overtimeHourlyRate: real('overtime_hourly_rate'),
  effectiveFrom: text('effective_from').notNull(),
  status: text('status').notNull().default('active'),
  // Attendance and payroll are separate concerns. `null` preserves the
  // legacy tenant-wide feature decision; explicit false opts this employee
  // out of attendance-driven deductions and explicit true opts them in.
  attendanceTracked: boolean('attendance_tracked').notNull().default(true),
  attendanceAffectsPayroll: boolean('attendance_affects_payroll'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const employeeSalaryComponents = pgTable('employee_salary_components', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  profileId: integer('profile_id').references(() => employeeCompensationProfiles.id).notNull(),
  componentName: text('component_name').notNull(),
  componentType: text('component_type').notNull().default('earning'),
  calculationType: text('calculation_type').notNull().default('percent_of_ctc'),
  value: real('value').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

// One row per (userId, year, month) — a snapshot of what buildPayrollSummary()
// computed the FIRST time that period was observed by GET /api/payroll/history.
// Never updated after insert (see the route), so a later salary change never
// silently rewrites a past payslip. The unique index below is what makes the
// route's "INSERT ... ON CONFLICT DO NOTHING" idempotent.
export const payrollRuns = pgTable('payroll_runs', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  profileId: integer('profile_id').references(() => employeeCompensationProfiles.id),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  workingDays: real('working_days').notNull(),
  approvedLeaveDays: real('approved_leave_days').notNull().default(0),
  overtimeHours: real('overtime_hours').notNull().default(0),
  grossPay: real('gross_pay').notNull().default(0),
  leaveDeduction: real('leave_deduction').notNull().default(0),
  // Attendance-driven payroll (Phase 6) — populated only for tenants that
  // opted into 'payroll_attendance_driven'; both default 0 (no effect) for
  // every tenant that hasn't. unpaidAbsenceDays is sourced ONLY from
  // finalized LOP (attendance_freeze_periods), never a raw unresolved
  // absence — see computeAttendanceDrivenPayrollInputs.
  unpaidAbsenceDays: real('unpaid_absence_days').notNull().default(0),
  lopDeduction: real('lop_deduction').notNull().default(0),
  overtimePay: real('overtime_pay').notNull().default(0),
  netPay: real('net_pay').notNull().default(0),
  breakdown: jsonb('breakdown'),
  // draft -> preview -> generated -> approved -> processed -> paid -> locked
  // (Phase 6/7) — was already a free-text column defaulting 'draft' but
  // only ever actually set to 'generated'; the rest of the sequence is
  // populated once Phase 7 (lock & adjustments) ships. Existing rows are
  // unaffected either way.
  status: text('status').notNull().default('draft'),
  // Links this line item to a payroll_batches row when created via the
  // batch workflow (P1) — null for the pre-existing lazy per-employee
  // generation path, which is untouched. version/supersedesRunId support
  // versioned payslips (P3): an adjustment after release never overwrites
  // a row, it inserts a new version pointing back at the one it replaces.
  batchId: integer('batch_id'),
  version: integer('version').notNull().default(1),
  supersedesRunId: integer('supersedes_run_id'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  // Versioned Payslips (P3/P7 fix): uniqueness now includes `version` so a
  // post-release adjustment can insert version 2, 3, ... instead of being
  // blocked from ever recording more than one payslip per period. Every
  // existing write path (lazy per-employee route, batch calculation)
  // always targets version 1 explicitly — this is additive, not a
  // behavior change for either of them.
  userPeriodVersionUnique: uniqueIndex('payroll_runs_user_period_version_unique').on(table.userId, table.year, table.month, table.version),
  // Tenant-wide batch/period lookups (payroll.routes.ts generate/history)
  // filter on exactly this triple.
  tenantYearMonthIdx: index('payroll_runs_tenant_year_month_idx').on(table.tenantId, table.year, table.month),
}));

// Once a payroll_runs row is locked (status = 'locked'), it is never
// recalculated or overwritten — any attendance correction approved against
// a date inside a locked period instead creates one of these instead of
// silently changing what the employee was told they'd be paid. HR resolves
// it explicitly (apply to next cycle, or a standalone adjustment payslip),
// and every adjustment is itself an audit-logged, append-only record —
// same "never silently rewrite history" principle as attendance_logs.
export const payrollAdjustments = pgTable('payroll_adjustments', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  payrollRunId: integer('payroll_run_id').references(() => payrollRuns.id).notNull(),
  sourceType: text('source_type').notNull(), // 'attendance_correction' | 'leave_adjustment' | 'salary_revision' | 'bonus' | 'reimbursement' | 'loan' | 'tax' | 'manual'
  sourceId: integer('source_id'),
  previousValue: real('previous_value'),
  newValue: real('new_value'),
  amountDelta: real('amount_delta').notNull(), // positive = owed to employee, negative = owed back
  reason: text('reason').notNull(),
  createdByUserId: integer('created_by_user_id').references(() => users.id),
  approvedByUserId: integer('approved_by_user_id').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  auditId: text('audit_id'),
  status: text('status').notNull().default('pending'), // 'pending' | 'applied'
  appliedToNextCycle: boolean('applied_to_next_cycle').notNull().default(false),
  appliedAt: timestamp('applied_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  // GET /api/tenant/payroll/adjustments lists by tenantId (unbounded scan
  // today, see the pagination fix) — this at least makes the scan an
  // index-only lookup instead of a full table scan once paginated.
  tenantStatusIdx: index('payroll_adjustments_tenant_status_idx').on(table.tenantId, table.status),
}));

// A tenant-configurable payroll calendar for one (year, month) period —
// freeze/calculation/review/release/credit dates. Batch lifecycle routes
// (see payrollBatches below) check these dates before allowing each
// transition; a transition attempted before its date is rejected, not
// silently allowed. A tenant with no calendar row for a period can still
// use payroll (no dates configured = no date gating), same "additive,
// never a hard requirement" convention as everything else in this schema.
export const payrollCalendars = pgTable('payroll_calendars', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  attendanceFreezeDate: text('attendance_freeze_date'), // 'YYYY-MM-DD'
  calculationDate: text('calculation_date'),
  hrReviewDate: text('hr_review_date'),
  financeReviewDate: text('finance_review_date'),
  releaseDate: text('release_date'),
  salaryCreditDate: text('salary_credit_date'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  tenantPeriodUnique: uniqueIndex('payroll_calendars_tenant_period_unique').on(table.tenantId, table.year, table.month),
}));

// First-class Payroll Run for a whole employee population — NOT the same as
// payrollRuns (below), which stays the per-employee line item. Carries the
// full lifecycle state machine: draft -> calculating -> calculated ->
// pending_hr_review -> pending_finance_review -> approved ->
// payslips_generated -> released -> locked. No stage is skippable; each
// transition route validates the previous state server-side (see
// services/payrollBatch.ts). Existing lazily-created payrollRuns rows
// (batchId null) are completely unaffected — this is opt-in via the
// 'payroll_batches' platform feature.
export const payrollBatches = pgTable('payroll_batches', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  status: text('status').notNull().default('draft'),
  employeeCount: integer('employee_count').notNull().default(0),
  totalGross: real('total_gross').notNull().default(0),
  totalNet: real('total_net').notNull().default(0),
  calculatedAt: timestamp('calculated_at'),
  hrReviewedByUserId: integer('hr_reviewed_by_user_id').references(() => users.id),
  hrReviewedAt: timestamp('hr_reviewed_at'),
  financeReviewedByUserId: integer('finance_reviewed_by_user_id').references(() => users.id),
  financeReviewedAt: timestamp('finance_reviewed_at'),
  approvedByUserId: integer('approved_by_user_id').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  releasedByUserId: integer('released_by_user_id').references(() => users.id),
  releasedAt: timestamp('released_at'),
  lockedAt: timestamp('locked_at'),
  createdByUserId: integer('created_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  tenantPeriodUnique: uniqueIndex('payroll_batches_tenant_period_unique').on(table.tenantId, table.year, table.month),
}));

// One-off financial events feeding INTO payroll calculation as inputs —
// deliberately separate from employeeSalaryComponents (which stays
// reserved for recurring salary structure), mirroring the append-only
// pattern payrollAdjustments already established.
export const payrollLoans = pgTable('payroll_loans', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  principal: real('principal').notNull(),
  emiAmount: real('emi_amount').notNull(),
  remainingBalance: real('remaining_balance').notNull(),
  startYear: integer('start_year').notNull(),
  startMonth: integer('start_month').notNull(),
  status: text('status').notNull().default('active'), // 'active' | 'closed'
  reason: text('reason'),
  createdByUserId: integer('created_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  tenantStatusIdx: index('payroll_loans_tenant_status_idx').on(table.tenantId, table.status),
}));

export const payrollAdvances = pgTable('payroll_advances', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  amount: real('amount').notNull(),
  recoveryMonths: integer('recovery_months').notNull().default(1),
  recoveryPerMonth: real('recovery_per_month').notNull(),
  remainingBalance: real('remaining_balance').notNull(),
  startYear: integer('start_year').notNull(),
  startMonth: integer('start_month').notNull(),
  status: text('status').notNull().default('active'),
  reason: text('reason'),
  createdByUserId: integer('created_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  tenantStatusIdx: index('payroll_advances_tenant_status_idx').on(table.tenantId, table.status),
}));

export const payrollReimbursements = pgTable('payroll_reimbursements', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  category: text('category').notNull(), // 'travel' | 'medical' | 'internet' | 'food' | 'fuel' | 'custom'
  amount: real('amount').notNull(),
  description: text('description'),
  receiptDocumentId: integer('receipt_document_id'), // reuses the existing documents table, no FK enforced (documents may predate this feature)
  status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected' | 'paid'
  approvedByUserId: integer('approved_by_user_id').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  payrollBatchId: integer('payroll_batch_id'), // set once actually paid out in a batch
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  tenantStatusIdx: index('payroll_reimbursements_tenant_status_idx').on(table.tenantId, table.status),
}));

export const payrollBonuses = pgTable('payroll_bonuses', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  type: text('type').notNull(), // 'festival' | 'performance' | 'joining' | 'retention' | 'manual'
  amount: real('amount').notNull(),
  reason: text('reason'),
  status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected' | 'paid'
  approvedByUserId: integer('approved_by_user_id').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  payrollBatchId: integer('payroll_batch_id'),
  createdByUserId: integer('created_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
});

// Salary is never edited directly once this feature is in use — a change
// is proposed here, reviewed by HR then Finance, and only written to
// employeeCompensationProfiles (the existing table, unchanged write path)
// on final approval. compensationHistory (existing) still captures the
// resulting diff automatically, same as any other profile write.
export const salaryRevisionRequests = pgTable('salary_revision_requests', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  type: text('type').notNull().default('revision'), // 'revision' | 'promotion'
  proposedAnnualCtc: real('proposed_annual_ctc').notNull(),
  proposedComponents: jsonb('proposed_components'), // same shape as employeeSalaryComponents rows
  effectiveDate: text('effective_date').notNull(),
  reason: text('reason'),
  status: text('status').notNull().default('pending_hr'), // 'pending_hr' | 'pending_finance' | 'approved' | 'rejected'
  hrReviewedByUserId: integer('hr_reviewed_by_user_id').references(() => users.id),
  hrReviewedAt: timestamp('hr_reviewed_at'),
  financeReviewedByUserId: integer('finance_reviewed_by_user_id').references(() => users.id),
  financeReviewedAt: timestamp('finance_reviewed_at'),
  requestedByUserId: integer('requested_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
});

// Append-only financial ledger — every finalized payroll calculation line
// item (salary, loan EMI, advance recovery, bonus, reimbursement,
// proration) writes one row here in addition to its own source table.
// Reports/reconciliation read this ledger instead of joining 5 separate
// tables; it never drives calculation itself (that stays in
// payrollBatchCalculation.ts), it only records the result.
export const payrollLedgerEntries = pgTable('payroll_ledger_entries', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  batchId: integer('batch_id'),
  payrollRunId: integer('payroll_run_id'),
  entryType: text('entry_type').notNull(), // 'salary' | 'loan_recovery' | 'advance_recovery' | 'bonus' | 'reimbursement' | 'proration' | 'adjustment'
  sourceTable: text('source_table'), // e.g. 'payroll_loans', null for plain salary
  sourceId: integer('source_id'),
  amount: real('amount').notNull(), // signed: negative = deduction, positive = addition/earning
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  tenantYearMonthIdx: index('payroll_ledger_entries_tenant_year_month_idx').on(table.tenantId, table.year, table.month),
}));

// Generated once an employee's termination has been approved
// (terminationRequests.status = 'approved') — never automatic, an HR/
// Finance user triggers generation explicitly with the actual last working
// date (terminationRequests has no such field; it's supplied at settlement
// time). Reuses the existing leave-encashment rate calculation
// (getEffectiveDailyRate) and outstanding loan/advance balances rather
// than recomputing any of that.
export const payrollFinalSettlements = pgTable('payroll_final_settlements', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  terminationRequestId: integer('termination_request_id').references(() => terminationRequests.id).notNull(),
  lastWorkingDate: text('last_working_date').notNull(),
  remainingSalaryAmount: real('remaining_salary_amount').notNull().default(0),
  leaveEncashmentDays: real('leave_encashment_days').notNull().default(0),
  leaveEncashmentAmount: real('leave_encashment_amount').notNull().default(0),
  pendingBonusAmount: real('pending_bonus_amount').notNull().default(0),
  noticePeriodRecoveryAmount: real('notice_period_recovery_amount').notNull().default(0),
  loanAdvanceRecoveryAmount: real('loan_advance_recovery_amount').notNull().default(0),
  grossSettlement: real('gross_settlement').notNull().default(0),
  netSettlement: real('net_settlement').notNull().default(0),
  breakdown: jsonb('breakdown'),
  status: text('status').notNull().default('draft'), // 'draft' | 'approved' | 'paid'
  generatedByUserId: integer('generated_by_user_id').references(() => users.id),
  approvedByUserId: integer('approved_by_user_id').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Role-level default compensation template — "every Employee gets this CTC
// + these components" — configured once per role name per tenant, mirroring
// the one-row-per-role-name shape of rolePrivilegeDefaults above. An
// individual's own employeeCompensationProfiles row (if present) always
// takes precedence over this; this is only the fallback used to build a
// payroll summary for someone who hasn't been given a personal override yet.
export const roleCompensationDefaults = pgTable('role_compensation_defaults', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  roleName: text('role_name').notNull(),
  annualCtc: real('annual_ctc').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Component rows for a role's default template, mirroring the shape of
// employeeSalaryComponents (same componentType/calculationType vocabulary)
// so buildPayrollSummary() can be reused unmodified against either source.
export const roleCompensationComponents = pgTable('role_compensation_components', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  roleDefaultId: integer('role_default_id').references(() => roleCompensationDefaults.id).notNull(),
  componentName: text('component_name').notNull(),
  componentType: text('component_type').notNull().default('earning'),
  calculationType: text('calculation_type').notNull().default('percent_of_ctc'),
  value: real('value').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

export const roleCompensationDefaultsRelations = relations(roleCompensationDefaults, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [roleCompensationDefaults.tenantId],
    references: [tenants.id],
  }),
  components: many(roleCompensationComponents),
}));

export const roleCompensationComponentsRelations = relations(roleCompensationComponents, ({ one }) => ({
  roleDefault: one(roleCompensationDefaults, {
    fields: [roleCompensationComponents.roleDefaultId],
    references: [roleCompensationDefaults.id],
  }),
}));

export const optionalHolidayChoices = pgTable('optional_holiday_choices', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  holidayId: integer('holiday_id').references(() => holidays.id).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Dated, TEMPORARY shift overrides — additive alongside `users.shiftId`
// (the permanent shift, still edited in place via PUT /api/tenant/employees/:id).
// A row here means "for this user, on any date in [startDate, endDate], use
// `shiftId` instead of their permanent shift". Both dates are required —
// there is no open-ended/"until superseded" override by design: a genuinely
// permanent change should go through the existing users.shiftId path
// instead, not this table. See getEffectiveShiftId() in
// apps/admin/api/services/shiftOverrides.ts, which is the single place that
// should be asked "what shift applies to this user on date X" — nothing
// else should compare a check-in against `users.shiftId` directly anymore
// for a specific day's lateness/shift math.
export const shiftOverrides = pgTable('shift_overrides', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  shiftId: integer('shift_id').references(() => shifts.id).notNull(), // the temporary shift to apply
  startDate: text('start_date').notNull(), // 'YYYY-MM-DD', inclusive
  endDate: text('end_date').notNull(), // 'YYYY-MM-DD', inclusive
  reason: text('reason'),
  createdBy: integer('created_by').references(() => users.id), // the admin who made the change
  createdAt: timestamp('created_at').defaultNow(),
});

export const shiftOverridesRelations = relations(shiftOverrides, ({ one }) => ({
  tenant: one(tenants, {
    fields: [shiftOverrides.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [shiftOverrides.userId],
    references: [users.id],
  }),
  shift: one(shifts, {
    fields: [shiftOverrides.shiftId],
    references: [shifts.id],
  }),
}));

// A manager's own team — gated by the 'team.manage' privilege (see
// featureCatalog.ts). One team per manager by design (see
// routes/teams.routes.ts): membership is drawn from users.department, so a
// manager can only pull in colleagues who already share their department.
export const teams = pgTable('teams', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  managerId: integer('manager_id').references(() => users.id).notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const teamMembers = pgTable('team_members', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id').references(() => teams.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  addedAt: timestamp('added_at').defaultNow(),
});

export const teamsRelations = relations(teams, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [teams.tenantId],
    references: [tenants.id],
  }),
  manager: one(users, {
    fields: [teams.managerId],
    references: [users.id],
  }),
  members: many(teamMembers),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id],
  }),
  user: one(users, {
    fields: [teamMembers.userId],
    references: [users.id],
  }),
}));

// Machine-to-machine credentials for external/partner integrations — an
// alternative to the human-login JWT flow. The raw key is shown to the
// tenant admin exactly once at creation time and never stored; only its
// bcrypt hash is kept (via password.ts's hashPassword/verifyPassword, same
// as user passwords) plus a short unhashed `keyPrefix` so authenticate.ts
// can look up the candidate row cheaply before doing the (slow, by design)
// bcrypt compare — the same prefix+hash pattern Stripe/GitHub use for API
// keys, since a hash alone isn't indexable/searchable.
export const serviceAccounts = pgTable('service_accounts', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  name: text('name').notNull(), // human label, e.g. "Colleague's HRIS sync"
  keyPrefix: text('key_prefix').notNull().unique(), // e.g. 'stk_live_ab12cd34' — safe to log/display
  keyHash: text('key_hash').notNull(),
  // Explicit privilege grant, same permission strings used by users.privileges
  // — a service account only ever gets what's explicitly listed here, never
  // role-based defaults (there's no "role" for a machine caller to inherit).
  privileges: jsonb('privileges').notNull().default('[]'),
  createdByUserId: integer('created_by_user_id').references(() => users.id),
  lastUsedAt: timestamp('last_used_at'),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Partner-integration event subscriptions — lets an external app react to
// events (e.g. a new check-in, a leave approval) instead of polling the API.
export const webhookSubscriptions = pgTable('webhook_subscriptions', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  url: text('url').notNull(),
  // Event names this subscription wants, e.g. ['attendance.checked_in',
  // 'leave.approved']. See api/services/webhooks.ts for the full event list.
  events: jsonb('events').notNull().default('[]'),
  // HMAC-SHA256 signing secret (shown once at creation, like the service
  // account key) — lets the receiving app verify a delivery genuinely came
  // from this server and wasn't forged/replayed by a third party.
  signingSecret: text('signing_secret').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdByUserId: integer('created_by_user_id').references(() => users.id),
  lastDeliveryAt: timestamp('last_delivery_at'),
  lastDeliveryStatus: text('last_delivery_status'), // 'success' | 'failed'
  createdAt: timestamp('created_at').defaultNow(),
});

// One row per save of an employee's individual compensation profile (CTC +
// salary components) — POST /api/tenant/payroll/employee/:userId previously
// overwrote the profile row and DELETED the old salary component rows on
// every save, so no history survived at all. This table is written
// alongside that overwrite (never instead of it — the "current" profile
// stays the live source of truth everywhere else) purely so the change
// itself isn't lost. `fieldChanges` is a precomputed diff (CTC, each
// component's value, additions/removals) so the history page can render
// "what changed" directly without re-deriving it from two raw snapshots.
export const compensationHistory = pgTable('compensation_history', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(), // the employee whose pay changed
  changedByUserId: integer('changed_by_user_id').references(() => users.id),
  effectiveFrom: text('effective_from'),
  previousAnnualCtc: real('previous_annual_ctc'), // null on the very first save (nothing to compare against)
  newAnnualCtc: real('new_annual_ctc').notNull(),
  previousComponents: jsonb('previous_components'), // snapshot of employeeSalaryComponents rows before this save
  newComponents: jsonb('new_components').notNull(), // snapshot after this save
  fieldChanges: jsonb('field_changes').notNull().default('[]'), // [{ field, oldValue, newValue }]
  createdAt: timestamp('created_at').defaultNow(),
});

// Replaces face-embedding-based identity verification. One row per
// registered device credential (WebAuthn/passkey — Windows Hello, Touch ID,
// Android biometric, or a security key). The server never sees a
// fingerprint/face/PIN at any point — only this public key, generated
// locally by the device's own secure hardware at registration time. Identity
// proof at check-in is a challenge-response signature verified against this
// public key, not a similarity score against stored biometric data — there
// is no threshold to tune and no false-accept-between-two-different-people
// failure mode the way embedding comparison had.
export const webauthnCredentials = pgTable('webauthn_credentials', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  // Base64url-encoded credential ID, as returned by the authenticator —
  // unique per device+account, used to look this row up at authentication time.
  credentialId: text('credential_id').notNull().unique(),
  publicKey: text('public_key').notNull(), // base64url-encoded COSE public key
  counter: integer('counter').notNull().default(0), // signature counter, replay-attack detection
  deviceType: text('device_type'), // 'singleDevice' | 'multiDevice' (per WebAuthn credentialDeviceType)
  transports: jsonb('transports'), // e.g. ['internal'] for a platform authenticator, ['usb','nfc'] for a security key
  // Human-readable label shown in "Manage Devices" (e.g. "Rahul's ThinkPad —
  // Windows Hello"), captured from the browser's UA at registration time —
  // best-effort, not authoritative for anything security-relevant.
  deviceName: text('device_name'),
  createdAt: timestamp('created_at').defaultNow(),
  lastUsedAt: timestamp('last_used_at'),
});

// Short-lived, single-use challenges issued by /register/options and
// /authenticate/options — the server must remember exactly what challenge it
// asked for so it can verify the signed response actually answers that
// specific challenge and not a replayed old one. Deleted on successful
// verification (or left to expire — checked by createdAt + a fixed TTL in
// the route handlers, no separate cron needed since these are tiny rows).
export const webauthnChallenges = pgTable('webauthn_challenges', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  challenge: text('challenge').notNull(),
  purpose: text('purpose').notNull(), // 'register' | 'authenticate'
  createdAt: timestamp('created_at').defaultNow(),
});

// Termination approval queue — same request->approve/reject shape as
// attendanceCorrections/wfhLocationChangeRequests. Only ever written by
// someone who holds 'employee.terminate' but is NOT the tenant_admin (the
// tenant_admin terminates immediately, no row here); the actual
// employeeStatus flip only happens when the tenant_admin approves the row
// below, via POST /api/tenant/termination-requests/action.
export const terminationRequests = pgTable('termination_requests', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  employeeId: integer('employee_id').references(() => users.id).notNull(),
  requestedByUserId: integer('requested_by_user_id').references(() => users.id).notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected'
  reviewedByUserId: integer('reviewed_by_user_id').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const terminationRequestsRelations = relations(terminationRequests, ({ one }) => ({
  employee: one(users, {
    fields: [terminationRequests.employeeId],
    references: [users.id],
  }),
  tenant: one(tenants, {
    fields: [terminationRequests.tenantId],
    references: [tenants.id],
  }),
}));

// Employee document storage (offer letters, contracts, ID proof,
// certificates) — only reachable at all when the owning tenant has
// tenants.documentsEnabled on (see api/routes/documents.routes.ts). Files
// live on local disk under DOCUMENTS_STORAGE_DIR (default ./uploads/documents),
// named by a random key, not the original filename — storagePath is that
// key, fileName is only ever used for the Content-Disposition header on
// download, never for the on-disk path (avoids path-traversal from a
// crafted filename).
export const employeeDocuments = pgTable('employee_documents', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  uploadedByUserId: integer('uploaded_by_user_id').references(() => users.id).notNull(),
  category: text('category').notNull().default('other'), // 'offer_letter' | 'contract' | 'id_proof' | 'certificate' | 'other'
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  fileSize: integer('file_size').notNull(),
  storagePath: text('storage_path').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Two-party shift swap: requester proposes swapping their shift on a
// specific date with a colleague; the colleague must accept before it goes
// to whoever holds 'shift.manage' for final approval (shift assignment is
// an org policy, same "can't be delegated below shift.manage" rule the rest
// of this schema already follows for branch/shift changes). requesterShiftId/
// targetShiftId are snapshotted at request time (via getEffectiveShiftId)
// so approval doesn't have to re-derive what's being swapped.
export const shiftSwapRequests = pgTable('shift_swap_requests', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  requesterId: integer('requester_id').references(() => users.id).notNull(),
  targetUserId: integer('target_user_id').references(() => users.id).notNull(),
  swapDate: text('swap_date').notNull(), // 'YYYY-MM-DD'
  requesterShiftId: integer('requester_shift_id').references(() => shifts.id),
  targetShiftId: integer('target_shift_id').references(() => shifts.id),
  reason: text('reason'),
  // 'pending_target' -> 'pending_approval' -> 'approved' | 'rejected'
  // 'pending_target' -> 'declined' (target said no, never reaches an approver)
  status: text('status').notNull().default('pending_target'),
  targetRespondedAt: timestamp('target_responded_at'),
  reviewedByUserId: integer('reviewed_by_user_id').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Cold storage for attendance_logs rows older than the tenant's
// attendanceRetentionMonths (see the monthly archival job in scheduler.ts)
// — identical shape plus archivedAt, so a CSV export of "old" data is just
// a query against this table instead of a data-loss event.
export const attendanceLogsArchive = pgTable('attendance_logs_archive', {
  id: integer('id').primaryKey(), // preserves the original attendance_logs.id, not a new identity
  userId: integer('user_id').references(() => users.id).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  status: text('status').notNull(),
  type: text('type'),
  clientTimestamp: timestamp('client_timestamp'),
  device: text('device'),
  locationLat: real('location_lat'),
  locationLng: real('location_lng'),
  reason: text('reason'),
  explanation: text('explanation'),
  attendanceMode: text('attendance_mode'),
  homeLat: real('home_lat'),
  homeLng: real('home_lng'),
  distanceFromHomeMeters: real('distance_from_home_meters'),
  wfhReason: text('wfh_reason'),
  checkoutAt: timestamp('checkout_at'),
  workedMinutes: real('worked_minutes'),
  branchId: integer('branch_id').references(() => branches.id),
  createdAt: timestamp('created_at'),
  archivedAt: timestamp('archived_at').defaultNow(),
});

// Browser/PWA push subscriptions (Web Push, not a native FCM/APNs token —
// this app is web + Capacitor-wrapped, not published to an app store with
// its own push credentials). One row per device/browser a user has opted
// into push on; a user can have several (phone + laptop). notifyUser/
// notifyUsers (see services/notifications.ts) push to every row here for
// that user, best-effort — a dead/expired subscription is deleted on a
// failed send rather than retried, since the endpoint itself is gone.
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  endpoint: text('endpoint').notNull().unique(),
  p256dhKey: text('p256dh_key').notNull(),
  authKey: text('auth_key').notNull(),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow(),
});

// General-purpose employee ticket/dispute system — broader than
// attendanceCorrections above (which only covers "I missed a punch"): a
// ticket carries a priority the raiser sets, can be about attendance, leave,
// payroll, or anything else, and auto-routes through a real escalation
// chain (see services/escalation.ts): the raiser's direct manager first,
// then the tenant's GM (if one exists), then tenant_admin as the final
// backstop. currentAssigneeUserId/escalationLevel/lastAssignedAt together
// drive both manual escalation and the scheduler's 24h auto-forward job
// (see bootstrap/scheduler.ts) — a ticket nobody actions within 24h moves
// itself to the next level automatically. Resolving an attendance_dispute
// or leave_dispute ticket can directly patch the linked record (see
// tickets.routes.ts), which is what makes "I was marked absent but was
// actually present" flow all the way through to attendance/leave
// history/payroll without a separate manual edit step.
export const tickets = pgTable('tickets', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  raisedByUserId: integer('raised_by_user_id').references(() => users.id).notNull(),
  category: text('category').notNull(), // 'attendance_dispute' | 'leave_dispute' | 'payroll_dispute' | 'other'
  priority: text('priority').notNull().default('medium'), // 'low' | 'medium' | 'high' | 'urgent' — set by the raiser
  subject: text('subject').notNull(),
  description: text('description').notNull(),
  // Optional links so a resolver can act directly on the disputed record
  // instead of just reading free text about it.
  relatedAttendanceLogId: integer('related_attendance_log_id').references(() => attendanceLogs.id),
  relatedLeaveRequestId: integer('related_leave_request_id'), // FK to leaveRequests.id, declared below this table in file order
  relatedDate: text('related_date'), // 'YYYY-MM-DD' — the day in question when no specific log/request row applies yet
  status: text('status').notNull().default('open'), // 'open' | 'resolved' | 'rejected'
  escalationLevel: integer('escalation_level').notNull().default(0), // 0 = manager, 1 = GM, 2 = tenant_admin
  currentAssigneeUserId: integer('current_assignee_user_id').references(() => users.id),
  lastAssignedAt: timestamp('last_assigned_at').defaultNow(),
  resolutionNote: text('resolution_note'),
  resolvedByUserId: integer('resolved_by_user_id').references(() => users.id),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const ticketsRelations = relations(tickets, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tickets.tenantId],
    references: [tenants.id],
  }),
  raisedBy: one(users, {
    fields: [tickets.raisedByUserId],
    references: [users.id],
  }),
  currentAssignee: one(users, {
    fields: [tickets.currentAssigneeUserId],
    references: [users.id],
  }),
}));

// One row per escalation hop — the audit trail for how a ticket moved
// through the chain (manual escalate, or the 24h auto-forward job), kept
// separate from the auditLedger hash chain since this is ticket-specific
// structured data a resolver's UI needs to render as a timeline, not a
// generic audit entry.
// Full audit trail for leave-request escalation, mirroring ticketEscalations
// below — leaveRequests.escalationLevel only tracks the current level, this
// table preserves the whole Created -> Assigned -> Escalated -> Escalated
// chain for audits, since "who had this and when" matters more here than
// for a ticket.
export const leaveEscalationHistory = pgTable('leave_escalation_history', {
  id: serial('id').primaryKey(),
  leaveRequestId: integer('leave_request_id').references(() => leaveRequests.id).notNull(),
  fromUserId: integer('from_user_id').references(() => users.id),
  toUserId: integer('to_user_id').references(() => users.id).notNull(),
  fromLevel: integer('from_level').notNull(),
  toLevel: integer('to_level').notNull(),
  reason: text('reason').notNull(), // 'auto_24h_timeout' (only source today; manual escalation isn't exposed yet)
  createdAt: timestamp('created_at').defaultNow(),
});

export const ticketEscalations = pgTable('ticket_escalations', {
  id: serial('id').primaryKey(),
  ticketId: integer('ticket_id').references(() => tickets.id).notNull(),
  fromUserId: integer('from_user_id').references(() => users.id),
  toUserId: integer('to_user_id').references(() => users.id),
  fromLevel: integer('from_level').notNull(),
  toLevel: integer('to_level').notNull(),
  reason: text('reason').notNull(), // 'manual' | 'auto_24h_timeout' | 'no_manager_found' | 'no_gm_found'
  createdAt: timestamp('created_at').defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
// ATTENDANCE PREFERENCES — centralized, tenant-scoped configuration for
// all attendance behavior.  Every default reproduces TODAY's behavior, so
// an absent row (or a freshly-created tenant that has never opened the
// preferences page) changes absolutely nothing.  The preferences are
// loaded at runtime by resolveAttendancePreferences() — see
// api/services/attendancePreferencesService.ts.
// ═══════════════════════════════════════════════════════════════════════

export const attendancePreferences = pgTable('attendance_preferences', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull().unique(),

  // ── General / Session Rules ──
  allowMultipleSessions: boolean('allow_multiple_sessions').default(false),
  maxSessionsPerDay: integer('max_sessions_per_day').default(1),
  minGapBetweenSessionsMins: integer('min_gap_between_sessions_mins').default(15),
  requireCheckoutBeforeNewCheckin: boolean('require_checkout_before_new_checkin').default(true),
  autoCloseOpenSessions: boolean('auto_close_open_sessions').default(false),
  maxSessionDurationMins: integer('max_session_duration_mins'), // null = unlimited

  // ── Attendance Methods ──
  // JSON string[] of enabled method keys.  The full universe of known keys
  // is defined in the frontend's ATTENDANCE_METHODS constant and on the
  // backend in KNOWN_ATTENDANCE_METHODS (attendancePreferencesService.ts).
  enabledMethods: jsonb('enabled_methods').default('["face_recognition","gps","manual"]'),
  defaultMethod: text('default_method').default('face_recognition'),
  // { primary: string, allowedBackups: string[] } — defines the fallback
  // chain when the primary method fails or is unavailable.  null = any
  // enabled method may be used in any order (today's behavior).
  methodHierarchy: jsonb('method_hierarchy'),

  // ── Verification Settings ──
  requireFaceMatch: boolean('require_face_match').default(true),
  requireGps: boolean('require_gps').default(true),
  requireOfficeWifi: boolean('require_office_wifi').default(false),
  requireGeoFence: boolean('require_geo_fence').default(false),
  requireDeviceVerification: boolean('require_device_verification').default(false),
  requireLivenessDetection: boolean('require_liveness_detection').default(true),

  // ── Shift Behaviour ──
  allowEarlyCheckin: boolean('allow_early_checkin').default(true),
  earlyCheckinBufferMins: integer('early_checkin_buffer_mins').default(30),
  allowLateCheckout: boolean('allow_late_checkout').default(true),
  maxOvertimeMins: integer('max_overtime_mins'), // null = no cap
  allowCrossMidnightSessions: boolean('allow_cross_midnight_sessions').default(false),
  autoSplitAtMidnight: boolean('auto_split_at_midnight').default(false),

  // ── Employee Experience / UI Behaviour ──
  showRunningTimer: boolean('show_running_timer').default(true),
  showWorkingHoursLive: boolean('show_working_hours_live').default(true),
  showAttendanceTimeline: boolean('show_attendance_timeline').default(true),
  allowEmployeeNotes: boolean('allow_employee_notes').default(true),
  allowAttendanceRegularization: boolean('allow_attendance_regularization').default(true),
  // Tenant-admin-facing on/off switch for the manual "close the books"
  // attendance freeze workflow (POST /api/tenant/attendance/freeze — see
  // attendance.routes.ts). Sits BELOW the super-admin platform feature
  // 'attendance_freeze': a tenant only sees/can use this at all if the
  // platform allows it for their plan, and this flag is then their own
  // choice of whether the workflow is actually turned on. Defaults true so
  // existing behavior for tenants already using freeze is unchanged.
  allowManualAttendanceFreeze: boolean('allow_manual_attendance_freeze').default(true),
  allowBreakTracking: boolean('allow_break_tracking').default(true),
  allowManualCheckout: boolean('allow_manual_checkout').default(true),
  requireCheckoutReason: boolean('require_checkout_reason').default(false),

  // ── Break Preferences ──
  enableBreaks: boolean('enable_breaks').default(true),
  allowMultipleBreaks: boolean('allow_multiple_breaks').default(true),
  maxBreaks: integer('max_breaks'), // null = unlimited
  breakCategories: jsonb('break_categories').default('["Lunch","Tea","Personal","Official","General"]'),

  // ── Mobile Preferences ──
  useCameraForFace: boolean('use_camera_for_face').default(true),
  requireRearCamera: boolean('require_rear_camera').default(false),
  allowOfflineAttendance: boolean('allow_offline_attendance').default(false),
  offlineSync: boolean('offline_sync').default(false),
  backgroundGps: boolean('background_gps').default(false),

  // ── Presence & Auto Checkout Policy Engine ──
  presenceEngineEnabled: boolean('presence_engine_enabled').default(true),
  presenceGracePeriodMins: integer('presence_grace_period_mins').default(30),
  presenceHeartbeatIntervalSec: integer('presence_heartbeat_interval_sec').default(60),
  autoCheckoutDelayMins: integer('auto_checkout_delay_mins').default(15), // Warning countdown duration before checkout
  autoCheckoutConfidenceThreshold: integer('auto_checkout_confidence_threshold').default(40), // Score below this = candidate
  maxSessionDurationHours: integer('max_session_duration_hours').default(14), // Hard session cap
  enableBrowserHeartbeat: boolean('enable_browser_heartbeat').default(true),
  enableBrowserActivityTracking: boolean('enable_browser_activity_tracking').default(true),
  enableGpsEvaluation: boolean('enable_gps_evaluation').default(true),
  enableWifiEvaluation: boolean('enable_wifi_evaluation').default(false),
  enableFaceEvaluation: boolean('enable_face_evaluation').default(true),
  ignoreGpsDuringBreak: boolean('ignore_gps_during_break').default(true),
  overtimeThresholdMins: integer('overtime_threshold_mins').default(0),

  // ── Effective Date ──
  // null = preferences are active immediately.  When set, the system
  // checks `effectiveFrom <= now()` before applying these preferences —
  // until that moment, the previous values (or system defaults) are used.
  effectiveFrom: timestamp('effective_from'),

  updatedAt: timestamp('updated_at').defaultNow(),
  updatedByUserId: integer('updated_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
});

export const attendancePreferencesRelations = relations(attendancePreferences, ({ one }) => ({
  tenant: one(tenants, {
    fields: [attendancePreferences.tenantId],
    references: [tenants.id],
  }),
}));

// Per-field change history for attendance preferences — every toggle flip,
// dropdown change, or value edit gets its own row so the admin can see the
// full audit trail with old→new diffs.  The generic auditLedger gets a
// summary entry too (via logToAuditLedger), but this table is the detailed
// per-field record needed for the Change History tab.
export const attendancePreferenceHistory = pgTable('attendance_preference_history', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  changedByUserId: integer('changed_by_user_id').references(() => users.id).notNull(),
  changedByName: text('changed_by_name').notNull(),
  fieldName: text('field_name').notNull(),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  ipAddress: text('ip_address'),
  deviceInfo: text('device_info'),
  effectiveFrom: timestamp('effective_from'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const attendancePreferenceHistoryRelations = relations(attendancePreferenceHistory, ({ one }) => ({
  tenant: one(tenants, {
    fields: [attendancePreferenceHistory.tenantId],
    references: [tenants.id],
  }),
}));

// ═══════════════════════════════════════════════════════════════════════
// PRESENCE EVALUATIONS & AUTO CHECKOUT AUDIT
// Detailed evaluation ledger populated continuously by the Presence Engine.
// Records evaluated signals, computed confidence scores (0-100), presence state
// transitions, and rationale for auditability.
// ═══════════════════════════════════════════════════════════════════════

export const presenceEvaluations = pgTable('presence_evaluations', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  attendanceLogId: integer('attendance_log_id').references(() => attendanceLogs.id),
  // State enum: 'active_working' | 'on_break' | 'temporarily_away' | 'shift_ended' | 'overtime' | 'inactive' | 'auto_checkout_candidate' | 'checked_out'
  state: text('state').notNull(),
  confidenceScore: real('confidence_score').notNull(), // 0 to 100
  signalsEvaluated: jsonb('signals_evaluated').notNull(), // json object of all evaluated signals & weights
  decision: text('decision').notNull(), // 'continue_session' | 'transition_overtime' | 'issue_warning' | 'auto_checkout'
  reason: text('reason').notNull(),
  policyVersion: text('policy_version').default('v1.0'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const presenceEvaluationsRelations = relations(presenceEvaluations, ({ one }) => ({
  tenant: one(tenants, {
    fields: [presenceEvaluations.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [presenceEvaluations.userId],
    references: [users.id],
  }),
}));

// Warnings issued prior to auto-checkout countdown
export const presenceWarnings = pgTable('presence_warnings', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  attendanceLogId: integer('attendance_log_id').references(() => attendanceLogs.id),
  warnedAt: timestamp('warned_at').defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'dismissed' | 'executed'
  createdAt: timestamp('created_at').defaultNow(),
});

export const presenceWarningsRelations = relations(presenceWarnings, ({ one }) => ({
  tenant: one(tenants, {
    fields: [presenceWarnings.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [presenceWarnings.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// SmartTeams Federation Provider API (/v1/federation/*) — additive tables
// only. Nothing above this line is touched by the federation feature: every
// existing route, table, and behavior stays exactly as it was. See
// api/routes/federation/*.routes.ts and api/services/federation/*.ts.
// ============================================================================

// Platform-level OAuth Application registered in Integration Hub / Developer Console.
// OAuth credentials belong to the Smart Teams Platform itself, not an individual tenant.
export const federationClients = pgTable('federation_clients', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id), // Nullable: global platform apps are not tenant-bound
  name: text('name').notNull(), // Application Name e.g. "BlizBooks", "Hotel PMS"
  company: text('company'), // Developer / Company e.g. "BlizBooks Inc."
  description: text('description'),
  clientId: text('client_id').notNull().unique(), // e.g. st_app_...
  clientSecretHash: text('client_secret_hash').notNull(),
  apiKey: text('api_key'), // Server-to-server API Key e.g. st_live_...
  webhookSecret: text('webhook_secret'), // Webhook Signing Secret e.g. whsec_...
  appUuid: text('app_uuid'),
  publicIdentifier: text('public_identifier'),
  environment: text('environment').notNull().default('sandbox'), // 'sandbox' | 'staging' | 'production'
  scopes: jsonb('scopes').notNull().default('["attendance.read","leave.read","payroll.read","employee.read"]'),
  grantTypes: jsonb('grant_types').default('["client_credentials","authorization_code","refresh_token"]'),
  pkceRequired: boolean('pkce_required').notNull().default(true),
  redirectUris: jsonb('redirect_uris').default('[]'),
  allowedOrigins: jsonb('allowed_origins').default('[]'),
  logoUrl: text('logo_url'),
  contactEmail: text('contact_email'),
  webhookUrl: text('webhook_url'),
  webhookEvents: jsonb('webhook_events').default('[]'),
  webhookStatus: text('webhook_status').notNull().default('active'), // 'active' | 'failing' | 'disabled'
  tokenLifetimeSeconds: integer('token_lifetime_seconds').notNull().default(3600),
  refreshTokenPolicy: text('refresh_token_policy').notNull().default('sliding'),
  rateLimitPerMin: integer('rate_limit_per_min').notNull().default(1000),
  apiVersion: text('api_version').notNull().default('v1.0'), // 'v1.0' | 'v2.0-beta' | 'v1.1-deprecated'
  isMarketplaceApp: boolean('is_marketplace_app').notNull().default(false),
  rating: text('rating').default('4.9'),
  category: text('category').default('General'),
  installCount: integer('install_count').default(0),
  credentialHistory: jsonb('credential_history').default('[]'),
  status: text('status').notNull().default('active'), // 'active' | 'suspended' | 'revoked'
  lastUsedAt: timestamp('last_used_at'),
  revokedAt: timestamp('revoked_at'),
  createdByUserId: integer('created_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
});

// Explicit authorization mapping granting a global platform application access to a specific tenant's data.
export const tenantFederationAuthorizations = pgTable('tenant_federation_authorizations', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  clientId: text('client_id').notNull(), // federation_clients.client_id
  status: text('status').notNull().default('authorized'), // 'authorized' | 'suspended' | 'revoked'
  authorizedScopes: jsonb('authorized_scopes').notNull().default('["attendance.read","leave.read","employee.read"]'),
  rejectedScopes: jsonb('rejected_scopes').default('[]'), // Tenant-rejected scopes
  connectionDate: timestamp('connection_date').defaultNow(),
  lastSyncAt: timestamp('last_sync_at'),
  syncStatus: text('sync_status').default('healthy'), // 'healthy' | 'error' | 'syncing' | 'idle'
  tokenExpiry: timestamp('token_expiry'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  tenantClientUnique: uniqueIndex('tenant_federation_auth_tenant_client_unique').on(table.tenantId, table.clientId),
}));

// Issued Active & Historical Access/Refresh Tokens Ledger
export const federationTokens = pgTable('federation_tokens', {
  id: serial('id').primaryKey(),
  clientId: text('client_id').notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id),
  accessTokenHash: text('access_token_hash').notNull(),
  refreshTokenHash: text('refresh_token_hash'),
  scopes: jsonb('scopes').notNull().default('[]'),
  ipAddress: text('ip_address'),
  issuedAt: timestamp('issued_at').defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  status: text('status').notNull().default('active'), // 'active' | 'expired' | 'revoked'
});

// Ledger of outbound webhook delivery attempts for monitoring and retries in Developer Console.
export const federationWebhookDeliveries = pgTable('federation_webhook_deliveries', {
  id: serial('id').primaryKey(),
  clientId: text('client_id').notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id),
  eventId: text('event_id').notNull(),
  eventType: text('event_type').notNull(),
  targetUrl: text('target_url').notNull(),
  statusCode: integer('status_code'),
  responseTimeMs: integer('response_time_ms'),
  deliveryStatus: text('delivery_status').notNull().default('delivered'), // 'delivered' | 'failed' | 'retrying'
  attemptCount: integer('attempt_count').notNull().default(1),
  payload: jsonb('payload'),
  errorMessage: text('error_message'),
  deliveredAt: timestamp('delivered_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Maps an immutable external UUID (BlizBooks' externalOrganizationId /
// externalBranchId / externalEmployeeId) to this system's internal serial
// id — kept as its own generic table rather than adding an externalId
// column to tenants/branches/users, so the federation feature never alters
// an existing table's shape. entityType + externalId is globally unique
// (an external UUID always resolves to exactly one internal row);
// entityType + tenantId + internalId is unique per tenant (one external
// identity per internal row, per entity type).
export const federationExternalIdMappings = pgTable('federation_external_id_mappings', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  entityType: text('entity_type').notNull(), // 'tenant' | 'branch' | 'employee'
  internalId: integer('internal_id').notNull(),
  externalId: text('external_id').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  externalUnique: uniqueIndex('federation_ext_id_entity_external_unique').on(table.entityType, table.externalId),
  internalUnique: uniqueIndex('federation_ext_id_entity_internal_unique').on(table.tenantId, table.entityType, table.internalId),
}));

// Idempotency-Key ledger for every /v1/federation/* write — a replayed key
// with the identical request returns the stored response verbatim; a
// replayed key with a DIFFERENT request body is refused (409
// IDEMPOTENCY_KEY_REUSED). Rows are retained 7 days (expiresAt), matching
// the plan's contract. One row per (clientId, idempotencyKey).
export const federationIdempotencyKeys = pgTable('federation_idempotency_keys', {
  id: serial('id').primaryKey(),
  // Nullable: a platform-scoped federation client (see federationClients.
  // tenantId's own "Nullable: global platform apps are not tenant-bound")
  // hits PUT /v1/federation/tenants/:externalOrganizationId to provision a
  // BRAND NEW tenant before one exists yet — req.federation.tenantId is
  // still null at that point. Uniqueness for the idempotency check itself
  // never depended on tenantId anyway (see clientKeyUnique below, keyed on
  // clientId + idempotencyKey alone), so this was only ever a leftover
  // NOT NULL from when every caller was tenant-scoped.
  tenantId: integer('tenant_id').references(() => tenants.id),
  clientId: text('client_id').notNull(), // federationClients.clientId, not the internal serial id
  idempotencyKey: text('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(), // sha256(method + path + body)
  method: text('method').notNull(),
  path: text('path').notNull(),
  responseStatus: integer('response_status'), // null while the original request is still in flight
  responseBody: jsonb('response_body'),
  createdAt: timestamp('created_at').defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
}, (table) => ({
  clientKeyUnique: uniqueIndex('federation_idempotency_client_key_unique').on(table.clientId, table.idempotencyKey),
}));

// Outbox pattern: every federation-relevant domain write (attendance
// checked in/out, leave requested/approved/rejected, payroll batch
// released, etc.) inserts one row here in the same request as the
// operational change. A background job (see
// services/federation/outbox.ts's registerFederationOutboxDispatchHandler,
// wired into the existing Postgres job queue) delivers each row via a
// signed webhook POST and never discards it on delivery failure — this
// table itself IS the 90-day replay feed exposed at GET
// /v1/federation/events.
export const federationWebhookOutbox = pgTable('federation_webhook_outbox', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  eventId: text('event_id').notNull().unique(), // uuid, dedupe key for the receiver
  eventType: text('event_type').notNull(), // e.g. 'attendance.checked_in', 'payroll.batch.released'
  schemaVersion: text('schema_version').notNull().default('1.0'),
  aggregateType: text('aggregate_type').notNull(), // 'attendance' | 'leave_request' | 'payroll_run' | ...
  aggregateId: text('aggregate_id').notNull(),
  aggregateVersion: integer('aggregate_version').notNull().default(1),
  occurredAt: timestamp('occurred_at').notNull(),
  businessDate: text('business_date'), // tenant-local YYYY-MM-DD, when relevant (attendance/leave/payroll events)
  // Real, resolved identities from federation_external_id_mappings — NOT
  // fabricated. A prior "fix" here generated fake placeholder strings like
  // `org_ext_${tenantId}` at delivery time instead of looking up the
  // externalOrganizationId/externalBranchId the calling client actually
  // registered via PUT /v1/federation/tenants/... — a receiver (e.g.
  // BlizBooks) would get IDs it never assigned, making outlet/org routing
  // impossible. Resolved once at WRITE time (see services/federation/
  // outbox.ts's writeOutboxEvent) so the value is stable even if delivery
  // happens much later via retry. externalOrganizationId is set on every
  // event; externalBranchId only when the event has real branch context
  // (payroll runs spanning multiple branches legitimately leave this null
  // at the envelope level — per-branch context lives in each ledger line).
  externalOrganizationId: text('external_organization_id'),
  externalBranchId: text('external_branch_id'),
  data: jsonb('data').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'delivered' | 'failed'
  deliveryAttempts: integer('delivery_attempts').notNull().default(0),
  lastAttemptAt: timestamp('last_attempt_at'),
  lastError: text('last_error'),
  deliveredAt: timestamp('delivered_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  tenantStatusIdx: index('federation_outbox_tenant_status_idx').on(table.tenantId, table.status),
  tenantCreatedIdx: index('federation_outbox_tenant_created_idx').on(table.tenantId, table.createdAt),
}));

// Ed25519 signing keypairs used to sign every outbound webhook body
// (timestamp + '.' + rawBody), published at GET
// /v1/federation/webhook-signing-keys. Production deployments should
// replace `privateKeyRef` with a pointer into a managed secret
// store/HSM rather than the raw key material this dev-friendly default
// stores — see services/federation/webhookSigning.ts's header comment.
export const federationSigningKeys = pgTable('federation_signing_keys', {
  id: serial('id').primaryKey(),
  keyId: text('key_id').notNull().unique(),
  publicKey: text('public_key').notNull(), // base64 SPKI DER
  privateKeyRef: text('private_key_ref').notNull(), // base64 PKCS8 DER (dev default) or a secret-store URI in production
  status: text('status').notNull().default('active'), // 'active' | 'next' | 'retired'
  activatedAt: timestamp('activated_at').defaultNow(),
  retiredAt: timestamp('retired_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// One registered callback URL per tenant (the plan requires a single HTTPS
// callback registered through the provider API, not one per event type).
export const federationWebhookSubscriptions = pgTable('federation_webhook_subscriptions', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull().unique(),
  callbackUrl: text('callback_url').notNull(),
  eventTypes: jsonb('event_types'), // null = every event family
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
  lastDeliveryAt: timestamp('last_delivery_at'),
  lastDeliveryStatus: text('last_delivery_status'), // 'success' | 'failed'
});

// Tracks the monotonic grantVersion for PUT
// /v1/federation/employees/:id/access separately from users.privileges
// (which stays a plain string array everywhere else in the app) — a stale
// grantVersion must be rejected outright (409 STALE_RESOURCE_VERSION),
// which needs a version counter to compare against that this table
// supplies without changing the shape of the existing privileges column.
export const federationEmployeeAccessGrants = pgTable('federation_employee_access_grants', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull().unique(),
  grantVersion: integer('grant_version').notNull().default(0),
  grants: jsonb('grants').notNull().default('[]'),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Every provider-only "break-glass" action taken against a federated
// tenant through a path other than the federation API itself (e.g. direct
// admin-UI access while federation.provider_admin_action is expected to be
// the normal path) — reasoned, audited, and expected to also be emitted as
// a federation.provider_admin_action outbox event within 60 seconds.
export const federationBreakGlassAudit = pgTable('federation_break_glass_audit', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  actorUserId: integer('actor_user_id').references(() => users.id),
  reason: text('reason').notNull(),
  action: text('action').notNull(),
  beforeJson: jsonb('before_json'),
  afterJson: jsonb('after_json'),
  createdAt: timestamp('created_at').defaultNow(),
});

// --- Expenses Module Tables ---
export const expenseCategories = pgTable('expense_categories', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  name: text('name').notNull(),
  code: text('code'),
  description: text('description'),
  maxLimit: real('max_limit'), // soft/hard expense policy limit for this category
  requireReceipt: boolean('require_receipt').default(true),
  status: text('status').notNull().default('active'), // 'active' | 'archived'
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const expenses = pgTable('expenses', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  expenseId: text('expense_id').notNull(), // Unique readable ID e.g. EXP-2026-00001
  amount: real('amount').notNull(),
  currency: text('currency').notNull().default('INR'),
  merchant: text('merchant'),
  category: text('category').notNull(),
  categoryId: integer('category_id').references(() => expenseCategories.id),
  description: text('description'),
  location: text('location'),
  paymentMethod: text('payment_method').default('Personal Payment'),
  receiptUrl: text('receipt_url'),
  receiptStoragePath: text('receipt_storage_path'),
  receiptOriginalName: text('receipt_original_name'),
  receiptMimeType: text('receipt_mime_type'),
  receiptFileSize: integer('receipt_file_size'),
  additionalAttachments: jsonb('additional_attachments').default('[]'),
  expenseDate: text('expense_date').notNull(), // 'YYYY-MM-DD'
  expenseTime: text('expense_time').notNull(), // 'HH:MM'
  uploadTimestamp: timestamp('upload_timestamp').defaultNow(),
  ocrExtractedData: jsonb('ocr_extracted_data'), // raw extracted data ({ date, time, amount, merchant, rawText, confidence })
  originalOcrValues: jsonb('original_ocr_values'), // { date, time, amount, merchant }
  userCorrectedValues: jsonb('user_corrected_values'), // { date, time, amount, merchant }
  derivedFromUploadTimestamp: boolean('derived_from_upload_timestamp').default(false),
  isOcrVerified: boolean('is_ocr_verified').default(false),
  status: text('status').notNull().default('pending_approval'), // 'draft' | 'pending_approval' | 'approved' | 'partially_reimbursed' | 'reimbursed' | 'rejected'
  rejectionReason: text('rejection_reason'),
  approvedAmount: real('approved_amount'),
  reimbursedAmount: real('reimbursed_amount').default(0),
  remainingAmount: real('remaining_amount'),
  approvedByUserId: integer('approved_by_user_id').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  reimbursedByUserId: integer('reimbursed_by_user_id').references(() => users.id),
  reimbursedAt: timestamp('reimbursed_at'),
  reimbursementRef: text('reimbursement_ref'),
  resubmittedFromId: integer('resubmitted_from_id'),
  policyViolationFlag: boolean('policy_violation_flag').default(false),
  policyViolationDetails: text('policy_violation_details'),
  duplicateFlag: boolean('duplicate_flag').default(false),
  duplicateDetails: text('duplicate_details'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const expenseReimbursements = pgTable('expense_reimbursements', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  expenseId: integer('expense_id').references(() => expenses.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(), // Employee
  reimbursedByUserId: integer('reimbursed_by_user_id').references(() => users.id).notNull(), // Admin/Finance actor
  amount: real('amount').notNull(),
  paymentRef: text('payment_ref'),
  paymentMethod: text('payment_method').default('Bank Transfer'),
  previousRemainingAmount: real('previous_remaining_amount').notNull(),
  newRemainingAmount: real('new_remaining_amount').notNull(),
  isPartial: boolean('is_partial').notNull().default(false),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const expenseReports = pgTable('expense_reports', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  columns: jsonb('columns').notNull(),
  filters: jsonb('filters').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const expensePolicies = pgTable('expense_policies', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  name: text('name').notNull(),
  category: text('category'),
  maxAmountLimit: real('max_amount_limit'),
  receiptRequiredAmount: real('receipt_required_amount').default(0),
  autoFlagDuplicates: boolean('auto_flag_duplicates').default(true),
  allowEmployeeWithdrawal: boolean('allow_employee_withdrawal').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

