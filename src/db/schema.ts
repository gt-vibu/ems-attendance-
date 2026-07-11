import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, text, timestamp, boolean, jsonb, real } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  adminUid: text('admin_uid').notNull(), // User who created it
  wifiSsid: text('wifi_ssid'),
  locationLat: real('location_lat'),
  locationLng: real('location_lng'),
  locationRadiusMeters: integer('location_radius_meters').default(100),
  createdAt: timestamp('created_at').defaultNow(),
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID
  email: text('email').notNull(),
  name: text('name').notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id),
  role: text('role').notNull().default('employee'), // 'admin' | 'employee'
  isKycCompleted: boolean('is_kyc_completed').default(false),
  faceEmbeddings: jsonb('face_embeddings'), // Storing embeddings as JSON
  registeredDeviceId: text('registered_device_id'), // To enforce 1 device per employee
  deviceApprovalPending: boolean('device_approval_pending').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

export const attendanceLogs = pgTable('attendance_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  status: text('status').notNull(), // 'approved' | 'rejected' | 'pending'
  fraudScore: real('fraud_score'),
  livenessScore: real('liveness_score'),
  faceMatchScore: real('face_match_score'),
  device: text('device'),
  locationLat: real('location_lat'),
  locationLng: real('location_lng'),
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id],
  }),
  attendanceLogs: many(attendanceLogs),
}));

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  attendanceLogs: many(attendanceLogs),
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
