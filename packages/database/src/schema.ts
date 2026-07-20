import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, text, timestamp, boolean, jsonb, real, uniqueIndex } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  adminUid: text('admin_uid').notNull(),
  status: text('status').notNull().default('active'), // 'active' | 'suspended'
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
  halfDayMins: integer('half_day_mins').default(240),
  weekendConfig: jsonb('weekend_config').default('["Saturday", "Sunday"]'),
  dailyBreakBudgetMins: integer('daily_break_budget_mins').default(60),
  // Minimum acceptable monthly attendance percentage, computed per user
  // (every clock-in role except tenant_admin) from approved check-ins over
  // working days so far this month. Dropping below it triggers hierarchical
  // email alerts — see computeAttendancePercent() in server.ts.
  minAttendancePercent: integer('min_attendance_percent').default(75),
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
  // Company-wide announcement shown on both the admin and employee
  // dashboards — plain text, admin-editable, gated behind the
  // 'tenant.policy.manage' privilege (see featureCatalog.ts). Null/empty
  // means no banner renders anywhere.
  policyAnnouncement: text('policy_announcement'),
  policyAnnouncementUpdatedAt: timestamp('policy_announcement_updated_at'),
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
  headUserId: integer('head_user_id'), // references users.id — FK defined after users table
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
  managerId: integer('manager_id'), // direct reporting manager — references users.id
  dateOfJoining: text('date_of_joining'), // ISO date string 'YYYY-MM-DD'
  phone: text('phone'), // mobile phone
  employeeStatus: text('employee_status').default('active'), // 'active' | 'inactive' | 'terminated'
  mustChangePassword: boolean('must_change_password').default(false),
  tempPassword: text('temp_password'),
  isKycCompleted: boolean('is_kyc_completed').default(false),
  faceEmbeddings: jsonb('face_embeddings'),
  // Per-action enrollment record from the guided KYC wizard
  kycActionLog: jsonb('kyc_action_log'),
  registeredDeviceId: text('registered_device_id'),
  deviceApprovalPending: boolean('device_approval_pending').default(false),
  activeSessionId: text('active_session_id'),
  sessionExpiresAt: timestamp('session_expires_at'),
  lastHeartbeatLat: real('last_heartbeat_lat'),
  lastHeartbeatLng: real('last_heartbeat_lng'),
  lastHeartbeatAt: timestamp('last_heartbeat_at'),
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
  tenantId: integer('tenant_id').references(() => tenants.id),
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
// spoofing signals, etc). Whoever the tenant admin has granted
// 'alerts.receive' to gets these; 'alerts.accept'/'alerts.reject' gate who
// can actually resolve them. Kept separate from `notifications` (which are
// simple read/unread messages) because alerts carry a resolvable state.
export const attendanceAlerts = pgTable('attendance_alerts', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(), // the employee the alert is about
  breakSessionId: integer('break_session_id').references(() => breakSessions.id),
  type: text('type').notNull(), // 'break_exceeded' | 'break_outside_geofence' | 'late_arrival' | 'spoofing_suspected' | 'auto_checkout_unverified'
  message: text('message').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'accepted' | 'rejected'
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
  branchId: integer('branch_id').references(() => branches.id),
  createdAt: timestamp('created_at').defaultNow(),
});

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
  createdAt: timestamp('created_at').defaultNow(),
});

export const holidaysRelations = relations(holidays, ({ one }) => ({
  tenant: one(tenants, {
    fields: [holidays.tenantId],
    references: [tenants.id],
  }),
}));

// Attendance correction / regularization requests — an employee flags a
// missed check-in/out or wrong location, and whoever holds 'attendance.approve'
// reviews it. Approving here does NOT silently rewrite the original
// attendance_logs row (that would break the audit trail); it creates its own
// resolvable record that shows up alongside the original for a reviewer.
export const attendanceCorrections = pgTable('attendance_corrections', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  requestType: text('request_type').notNull(), // 'missed_checkin' | 'missed_checkout' | 'wrong_location' | 'other'
  requestedDate: text('requested_date').notNull(), // 'YYYY-MM-DD'
  requestedTime: text('requested_time'), // 'HH:MM', optional
  reason: text('reason').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected'
  reviewedByUserId: integer('reviewed_by_user_id').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),
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
});

export const payrollSettings = pgTable('payroll_settings', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  workingDaysPerMonth: integer('working_days_per_month').notNull().default(26),
  maxPaidLeaveDaysPerMonth: real('max_paid_leave_days_per_month').notNull().default(0),
  excessLeavePenaltyPercent: real('excess_leave_penalty_percent').notNull().default(100),
  overtimeHourlyRate: real('overtime_hourly_rate').notNull().default(0),
  optionalHolidayLimit: integer('optional_holiday_limit').notNull().default(2),
  holidayCountryCode: text('holiday_country_code').default('IN'),
  holidayRegionCode: text('holiday_region_code'),
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
  overtimePay: real('overtime_pay').notNull().default(0),
  netPay: real('net_pay').notNull().default(0),
  breakdown: jsonb('breakdown'),
  status: text('status').notNull().default('draft'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  userPeriodUnique: uniqueIndex('payroll_runs_user_period_unique').on(table.userId, table.year, table.month),
}));

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
