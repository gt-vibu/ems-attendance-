import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, text, timestamp, boolean, jsonb, real } from 'drizzle-orm/pg-core';

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
  createdAt: timestamp('created_at').defaultNow(),
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull().unique(),
  password: text('password').notNull(),
  name: text('name').notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id),
  role: text('role').notNull().default('employee'), // 'super_admin' | 'tenant_admin' | 'manager' | 'HR' | 'GM' | 'employee'
  privileges: jsonb('privileges'), // Array of granted privileges, e.g. ['verify_attendance', 'manage_settings', 'approve_requests']
  mustChangePassword: boolean('must_change_password').default(false),
  tempPassword: text('temp_password'),
  isKycCompleted: boolean('is_kyc_completed').default(false),
  faceEmbeddings: jsonb('face_embeddings'),
  // Per-action enrollment record from the guided KYC wizard — which of the
  // 8 poses (look_center, turn_left, turn_right, look_up, look_down, smile,
  // open_mouth, blink) were captured, frame/detection counts, timestamps.
  // Kept separate from faceEmbeddings (which stays a flat number[][] so the
  // existing cosine-similarity matching code doesn't need to change shape).
  kycActionLog: jsonb('kyc_action_log'),
  registeredDeviceId: text('registered_device_id'),
  deviceApprovalPending: boolean('device_approval_pending').default(false),
  // Last-known GPS from the attendance heartbeat ping (see attendanceLogs
  // heartbeat endpoint) — used by the end-of-day auto-checkout job to guess
  // whether someone who forgot to check out is actually still on-premises.
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
