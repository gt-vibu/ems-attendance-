import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './openapi.js';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { db, schema, detectPostgres, tryAcquireSchedulerLeadership, closeDb } from './db';
import { logger, requestLogger } from './logger';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import crypto from 'crypto';
import { signToken, verifyToken, signShortLivedToken } from './jwt';
import { sendEmail, sendPasswordResetEmail, sendAttendanceCorrectionEmail, sendBreakViolationAlert, sendManagerEscalationEmail, sendLateArrivalApprovalRequestEmail, sendLateArrivalDecisionEmail, sendLowAttendanceAlertEmail, sendBreakLocationViolationEmail, sendWfhApprovalRequestEmail, sendWfhDecisionEmail, sendWfhLocationChangeRequestEmail, sendWfhLocationChangeDecisionEmail } from './mail.js';
import { hashPassword, verifyPassword, isPasswordHashed } from './password.js';
import { OAuth2Client } from 'google-auth-library';
import { extractWfhPolicy, isRoleAllowedForWfh, haversineMeters as wfhHaversineMeters, evaluateWfhEligibility, evaluateWfhLocation, todayWeekdayName, WFH_PERMISSIONS } from './wfh.js';
import { reverseGeocode } from './geocoding.js';
import { extractQrPolicy, evaluateQrGeofence, evaluateQrScan, shouldRotateQrToken, QR_ROTATION_OPTIONS, QR_PERMISSIONS, QR_TOKEN_PURPOSE, QR_SCAN_PASS_PURPOSE } from './qr.js';

// Last-resort safety nets: without these, an error thrown outside any
// request handler's try/catch (e.g. inside a fire-and-forget async task, a
// timer callback, or a rejected promise nobody awaited) crashes the entire
// Node process and drops every connected user, not just the one operation
// that failed. Logging and continuing is far safer for a multi-user server
// than letting the whole process die on an isolated bug.
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException (process kept alive)', { err: err instanceof Error ? err.stack || err.message : String(err) });
});
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection (process kept alive)', { reason: reason instanceof Error ? reason.stack || reason.message : String(reason) });
});

// Setup database tables dynamically at startup
async function verifyAndSyncDatabase() {
  try {
    console.log('Synchronizing database tables...');
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tenants (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        admin_uid TEXT NOT NULL,
        wifi_ssid TEXT,
        office_ip TEXT,
        location_lat REAL,
        location_lng REAL,
        location_radius_meters INTEGER DEFAULT 100,
        plan TEXT DEFAULT 'Basic',
        features_allowed JSONB,
        shift_start TEXT DEFAULT '09:00',
        grace_period_mins INTEGER DEFAULT 15,
        half_day_mins INTEGER DEFAULT 240,
        weekend_config JSONB DEFAULT '["Saturday", "Sunday"]',
        daily_break_budget_mins INTEGER DEFAULT 60,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    // Add columns if they do not exist
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS office_ip TEXT;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'Basic';`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS features_allowed JSONB;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS shift_start TEXT DEFAULT '09:00';`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS shift_end TEXT DEFAULT '18:00';`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS grace_period_mins INTEGER DEFAULT 15;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS half_day_mins INTEGER DEFAULT 240;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS weekend_config JSONB DEFAULT '["Saturday", "Sunday"]';`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS daily_break_budget_mins INTEGER DEFAULT 60;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wifi_check_enabled BOOLEAN DEFAULT false;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS min_attendance_percent INTEGER DEFAULT 75;`); } catch(e){}

    // Work From Home (WFH) policy columns — additive; wfh_enabled defaults
    // false so existing tenants are entirely unaffected until an admin opts in.
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wfh_enabled BOOLEAN DEFAULT false;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wfh_allowed_roles JSONB;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wfh_max_days_per_month INTEGER;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wfh_allowed_weekdays JSONB DEFAULT '["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]';`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wfh_radius_meters INTEGER DEFAULT 200;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wfh_approval_required BOOLEAN DEFAULT true;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wfh_require_reason BOOLEAN DEFAULT true;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wfh_late_login_grace_mins INTEGER;`); } catch(e){}

    // Dynamic QR Attendance policy columns — additive; qr_enabled defaults
    // false so existing tenants are entirely unaffected until an admin opts in.
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS qr_enabled BOOLEAN DEFAULT false;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS qr_rotation_seconds INTEGER DEFAULT 30;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS qr_require_gps BOOLEAN DEFAULT true;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS qr_require_wifi BOOLEAN DEFAULT false;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS qr_require_face BOOLEAN DEFAULT true;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS qr_geofence_radius_meters INTEGER;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS qr_require_device_trust BOOLEAN DEFAULT false;`); } catch(e){}

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        uid TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        tenant_id INTEGER REFERENCES tenants(id),
        role TEXT NOT NULL DEFAULT 'employee',
        privileges JSONB,
        must_change_password BOOLEAN DEFAULT false,
        temp_password TEXT,
        is_kyc_completed BOOLEAN DEFAULT false,
        face_embeddings JSONB,
        registered_device_id TEXT,
        device_approval_pending BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'employee';`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS privileges JSONB;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS temp_password TEXT;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_action_log JSONB;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_heartbeat_lat REAL;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_heartbeat_lng REAL;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMP;`); } catch(e){}

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tenancy_requests (
        id SERIAL PRIMARY KEY,
        company_name TEXT NOT NULL,
        email TEXT NOT NULL,
        num_employees INTEGER NOT NULL,
        plan TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS device_change_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        old_device_id TEXT,
        new_device_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS break_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        start_time TIMESTAMP DEFAULT NOW(),
        end_time TIMESTAMP,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS break_type TEXT DEFAULT 'General';`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS start_lat REAL;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS start_lng REAL;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS end_lat REAL;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS end_lng REAL;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS is_violation BOOLEAN DEFAULT false;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS outside_geofence BOOLEAN DEFAULT false;`); } catch(e){}

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attendance_alerts (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        break_session_id INTEGER REFERENCES break_sessions(id),
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        resolved_by_user_id INTEGER REFERENCES users(id),
        resolved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS holidays (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        date TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attendance_corrections (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        request_type TEXT NOT NULL,
        requested_date TEXT NOT NULL,
        requested_time TEXT,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by_user_id INTEGER REFERENCES users(id),
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attendance_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        status TEXT NOT NULL,
        type TEXT DEFAULT 'check_in',
        client_timestamp TIMESTAMP,
        fraud_score REAL,
        liveness_score REAL,
        face_match_score REAL,
        device TEXT,
        location_lat REAL,
        location_lng REAL,
        reason TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'check_in';`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS client_timestamp TIMESTAMP;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS challenge JSONB;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS explanation TEXT;`); } catch(e){}

    // Work From Home (WFH) columns on attendance_logs — attendance_mode
    // defaults 'office' so every existing row (and every existing query that
    // doesn't know this column exists) keeps its current meaning.
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS attendance_mode TEXT NOT NULL DEFAULT 'office';`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS home_lat REAL;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS home_lng REAL;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS distance_from_home_meters REAL;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS wfh_reason TEXT;`); } catch(e){}

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS employee_home_locations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        accuracy REAL,
        address TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS wfh_location_change_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        new_latitude REAL NOT NULL,
        new_longitude REAL NOT NULL,
        new_accuracy REAL,
        new_address TEXT,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by_user_id INTEGER REFERENCES users(id),
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS qr_sessions (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        generated_by_user_id INTEGER NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'active',
        rotation_seconds INTEGER NOT NULL DEFAULT 30,
        current_nonce TEXT NOT NULL,
        current_token_issued_at TIMESTAMP NOT NULL,
        current_token_expires_at TIMESTAMP NOT NULL,
        current_nonce_used BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        closed_at TIMESTAMP
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS qr_scans (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        qr_session_id INTEGER NOT NULL REFERENCES qr_sessions(id),
        scanned_by_user_id INTEGER NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'pending',
        failure_reason TEXT,
        gps_passed BOOLEAN,
        wifi_passed BOOLEAN,
        face_passed BOOLEAN,
        device_trust_passed BOOLEAN,
        distance_meters REAL,
        device_id TEXT,
        ip_address TEXT,
        user_agent TEXT,
        attendance_log_id INTEGER REFERENCES attendance_logs(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS audit_ledger (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP DEFAULT NOW(),
        tenant_id INTEGER REFERENCES tenants(id),
        actor_id INTEGER REFERENCES users(id),
        actor_name TEXT NOT NULL,
        action TEXT NOT NULL,
        ip_address TEXT,
        device_info TEXT,
        details JSONB,
        hash TEXT NOT NULL
      );
    `);
    
    console.log('Database tables verified and synchronized successfully.');
  } catch (err) {
    console.error('Failed to synchronize database tables:', err);
  }
}

// Seed the sole Super Admin account. Never hardcode real credentials here —
// use SEED_SUPER_ADMIN_EMAIL/SEED_SUPER_ADMIN_PASSWORD from .env, or fall
// back to a randomly generated one-time password that's printed once to the
// console and must be changed at first login.
async function seedSuperAdmin() {
  try {
    const existing = await db.select().from(schema.users).where(eq(schema.users.role, 'super_admin'));
    if (existing.length === 0) {
      const email = process.env.SEED_SUPER_ADMIN_EMAIL || 'superadmin@example.com';
      const providedPassword = process.env.SEED_SUPER_ADMIN_PASSWORD;
      const plainPassword = providedPassword || crypto.randomBytes(9).toString('base64url');

      console.log('Seeding Super Admin account...');
      await db.insert(schema.users).values({
        uid: 'super-admin-uid-00000000000000000',
        email,
        password: await hashPassword(plainPassword),
        name: 'Global Super Admin',
        role: 'super_admin',
        mustChangePassword: !providedPassword
      });

      if (!providedPassword) {
        console.log('\n==================================================');
        console.log('  Super Admin seeded with a one-time generated password:');
        console.log(`  Email:    ${email}`);
        console.log(`  Password: ${plainPassword}`);
        console.log('  (shown once — you will be required to change it on first login)');
        console.log('  Set SEED_SUPER_ADMIN_EMAIL / SEED_SUPER_ADMIN_PASSWORD in .env to control this.');
        console.log('==================================================\n');
      } else {
        console.log(`Super Admin seeded successfully: ${email}`);
      }
    }
  } catch (err) {
    console.error('Failed to seed Super Admin account:', err);
  }
}

// Shared tail of a successful authentication (password login and Google
// Sign-In both end here): tenant-suspension check, device-pinning, and JWT
// issuance. Factored out so the two routes can't silently drift apart on
// this security-sensitive logic.
async function finalizeLogin(user: any, deviceId: string | undefined):
  Promise<{ ok: true; token: string; user: any } | { ok: false; status: number; body: any }> {
  // Block access for users of a suspended tenant (super_admin has no
  // tenantId and is exempt).
  if (user.tenantId) {
    const tenantCheck = await db.select().from(schema.tenants).where(eq(schema.tenants.id, user.tenantId));
    if (tenantCheck.length > 0 && tenantCheck[0].status === 'suspended') {
      return { ok: false, status: 403, body: { error: 'Your organization\'s access has been suspended. Please contact your administrator.' } };
    }
  }

  // Device Pinning Check (for anyone who can clock in — every role except
  // the two admin tiers, who manage the org but don't themselves check in
  // via the biometric/GPS flow).
  const isClockInRole = user.role !== 'super_admin' && user.role !== 'tenant_admin';
  if (isClockInRole && deviceId) {
    if (user.registeredDeviceId && user.registeredDeviceId !== deviceId) {
      const pendingRequest = await db.select().from(schema.deviceChangeRequests).where(
        and(
          eq(schema.deviceChangeRequests.userId, user.id),
          eq(schema.deviceChangeRequests.status, 'pending')
        )
      );

      if (pendingRequest.length === 0) {
        await db.insert(schema.deviceChangeRequests).values({
          userId: user.id,
          tenantId: user.tenantId || 1,
          oldDeviceId: user.registeredDeviceId,
          newDeviceId: deviceId,
          status: 'pending'
        });

        await db.update(schema.users)
          .set({ deviceApprovalPending: true })
          .where(eq(schema.users.id, user.id));

        await db.insert(schema.notifications).values({
          userId: user.tenantId,
          title: 'Device Change Request',
          message: `${user.name} is attempting to log in from a new device. Approval required.`
        });
      }

      return {
        ok: false, status: 403, body: {
          error: 'device_change_pending',
          message: 'This device is unauthorized. A device migration request has been submitted to your administrator.'
        }
      };
    }

    if (!user.registeredDeviceId) {
      await db.update(schema.users)
        .set({ registeredDeviceId: deviceId })
        .where(eq(schema.users.id, user.id));
      user.registeredDeviceId = deviceId;
    }
  }

  const token = signToken({
    userId: user.id,
    uid: user.uid,
    email: user.email,
    role: user.role,
    name: user.name,
    tenantId: user.tenantId
  });

  return {
    ok: true,
    token,
    user: { id: user.id, uid: user.uid, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId, isKycCompleted: user.isKycCompleted }
  };
}

// Cryptographic hash-chain ledger logger
async function logToAuditLedger(params: {
  tenantId: number | null;
  actorId: number | null;
  actorName: string;
  action: string;
  ipAddress?: string;
  deviceInfo?: string;
  details?: any;
}) {
  try {
    // 1. Get the last hash in the ledger
    const lastLogs = await db.select()
      .from(schema.auditLedger)
      .orderBy(desc(schema.auditLedger.id))
      .limit(1);
    
    const prevHash = lastLogs.length > 0 ? lastLogs[0].hash : 'GENESIS';
    const timestamp = new Date();
    
    // 2. Compute current hash: SHA-256(prevHash + timestamp + action + actorName + JSON.stringify(details))
    const detailsStr = params.details ? JSON.stringify(params.details) : '';
    const rawPayload = `${prevHash}|${timestamp.toISOString()}|${params.action}|${params.actorName}|${detailsStr}`;
    const currentHash = crypto.createHash('sha256').update(rawPayload).digest('hex');
    
    // 3. Insert into audit_ledger table
    await db.insert(schema.auditLedger).values({
      timestamp,
      tenantId: params.tenantId,
      actorId: params.actorId,
      actorName: params.actorName,
      action: params.action,
      ipAddress: params.ipAddress || null,
      deviceInfo: params.deviceInfo || null,
      details: params.details || {},
      hash: currentHash
    });
  } catch (err) {
    console.error('Failed to write to audit ledger:', err);
  }
}

// Background scheduler running workers at minute and daily boundaries
function runBackgroundScheduler() {
  console.log('Background Scheduler initialized.');
  
  // Track runs to prevent duplicate triggers within the same minute
  let lastAbsenteesRun = '';
  let lastCheckoutRun = '';
  let lastSummaryRun = '';
  let lastAttendanceCheckRun = '';

  // 1. Break overstay scanner (runs every minute)
  setInterval(async () => {
    try {
      const activeBreaks = await db.select({
        id: schema.breakSessions.id,
        startTime: schema.breakSessions.startTime,
        userId: schema.breakSessions.userId,
        userName: schema.users.name,
        userEmail: schema.users.email,
        tenantId: schema.users.tenantId
      })
      .from(schema.breakSessions)
      .innerJoin(schema.users, eq(schema.breakSessions.userId, schema.users.id))
      .where(eq(schema.breakSessions.status, 'active'));

      for (const brk of activeBreaks) {
        const start = new Date(brk.startTime).getTime();
        const elapsedMins = (Date.now() - start) / 60000;
        
        // Fetch tenant policy configuration
        const tenantList = await db.select().from(schema.tenants).where(eq(schema.tenants.id, brk.tenantId || 1));
        const budget = tenantList.length > 0 ? (tenantList[0].dailyBreakBudgetMins || 60) : 60;
        
        if (elapsedMins > budget) {
          // Break budget exceeded! Auto-end it with completed status
          await db.update(schema.breakSessions)
            .set({
              endTime: new Date(),
              status: 'completed'
            })
            .where(eq(schema.breakSessions.id, brk.id));
            
          // Log to cryptographic audit ledger
          await logToAuditLedger({
            tenantId: brk.tenantId,
            actorId: brk.userId,
            actorName: brk.userName,
            action: 'BREAK_VIOLATION',
            details: { elapsedMins: Math.round(elapsedMins), allowedLimit: budget, autoCompleted: true }
          });
          
          // Send alerts
          await sendBreakViolationAlert(brk.userEmail, brk.userName, new Date().toLocaleDateString(), Math.round(elapsedMins), budget);
          
          // Get Tenant Admin to escalate
          const admins = await db.select().from(schema.users).where(
            and(
              eq(schema.users.tenantId, brk.tenantId || 1),
              eq(schema.users.role, 'tenant_admin')
            )
          );
          if (admins.length > 0) {
            await sendManagerEscalationEmail(
              admins[0].email,
              admins[0].name,
              brk.userName,
              'Break Overstay Violation',
              `${brk.userName} went on break but did not return in time. The break was auto-ended at ${Math.round(elapsedMins)} minutes (Limit: ${budget} mins).`
            );
          }
        }
      }
    } catch (err) {
      console.error('Error in break monitor job:', err);
    }
  }, 60000);

  // 2. Daily Cron Tasks (Checked every minute)
  setInterval(async () => {
    try {
      const now = new Date();
      const currentHour = now.getHours();
      const currentMin = now.getMinutes();
      const todayKey = now.toDateString();

      // --- Auto-mark absentees (at 11:00 AM daily) ---
      if (currentHour === 11 && currentMin === 0 && lastAbsenteesRun !== todayKey) {
        lastAbsenteesRun = todayKey;
        console.log('Running Auto-Mark Absentees Job...');
        const tenantsList = await db.select().from(schema.tenants);
        for (const tenant of tenantsList) {
          const employees = await db.select().from(schema.users).where(
            and(
              eq(schema.users.tenantId, tenant.id),
              eq(schema.users.role, 'employee')
            )
          );
          
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);

          for (const emp of employees) {
            // Check if employee has an approved check-in log today
            const logs = await db.select().from(schema.attendanceLogs).where(
              and(
                eq(schema.attendanceLogs.userId, emp.id),
                eq(schema.attendanceLogs.status, 'approved'),
                sql`created_at >= ${todayStart}`
              )
            );
            
            if (logs.length === 0) {
              // Create auto-absent log
              await db.insert(schema.attendanceLogs).values({
                userId: emp.id,
                tenantId: tenant.id,
                status: 'rejected',
                type: 'absent',
                reason: 'Auto-marked absent: No clock-in detected by 11:00 AM'
              });
              
              await logToAuditLedger({
                tenantId: tenant.id,
                actorId: emp.id,
                actorName: emp.name,
                action: 'AUTO_MARK_ABSENT',
                details: { info: 'No clock-in detected by 11:00 AM' }
              });
            }
          }
        }
      }

      // --- Auto-checkout (at 11:59 PM daily) ---
      if (currentHour === 23 && currentMin === 59 && lastCheckoutRun !== todayKey) {
        lastCheckoutRun = todayKey;
        console.log('Running Auto-Checkout Job...');
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // Fetch users whose last approved attendance status today is
        // check_in, along with their last GPS heartbeat and their tenant's
        // geofence — used below to guess whether they're actually still
        // on-premises (the server can't reach a closed browser tab for a
        // live GPS read at this point).
        const activeCheckIns = await db.execute(sql`
          WITH latest_logs AS (
            SELECT DISTINCT ON (user_id) *
            FROM attendance_logs
            WHERE created_at >= ${todayStart} AND status = 'approved'
            ORDER BY user_id, id DESC
          )
          SELECT l.*, u.name as user_name, u.email as user_email,
                 u.last_heartbeat_lat, u.last_heartbeat_lng, u.last_heartbeat_at,
                 t.location_lat as tenant_lat, t.location_lng as tenant_lng, t.location_radius_meters as tenant_radius
          FROM latest_logs l
          JOIN users u ON l.user_id = u.id
          JOIN tenants t ON l.tenant_id = t.id
          WHERE l.type = 'check_in'
        `);

        const rows = activeCheckIns.rows || activeCheckIns;
        for (const row of rows) {
          const heartbeatIsFromToday = row.last_heartbeat_at && new Date(row.last_heartbeat_at as any).toDateString() === todayKey;

          let outsideOffice = false;
          if (heartbeatIsFromToday && row.tenant_lat && row.tenant_lng) {
            const distance = haversineMeters(row.last_heartbeat_lat as number, row.last_heartbeat_lng as number, row.tenant_lat as number, row.tenant_lng as number);
            const radius = (row.tenant_radius as number) || 100;
            outsideOffice = distance > radius;
          }

          const reason = outsideOffice
            ? 'Auto check-out: Detected outside office premises at end-of-day'
            : 'Auto check-out: System triggered at end-of-day (location unavailable or still on-premises)';

          await db.insert(schema.attendanceLogs).values({
            userId: row.user_id,
            tenantId: row.tenant_id,
            status: 'approved',
            type: 'check_out',
            reason
          });

          await logToAuditLedger({
            tenantId: row.tenant_id,
            actorId: row.user_id,
            actorName: row.user_name,
            action: 'CHECK_OUT',
            details: { info: reason }
          });

          // Couldn't confirm they'd actually left — flag it for a manager
          // to review rather than silently trusting the guess.
          if (!outsideOffice) {
            await db.insert(schema.attendanceAlerts).values({
              tenantId: row.tenant_id as number,
              userId: row.user_id as number,
              type: 'auto_checkout_unverified',
              message: `${row.user_name} was auto-checked-out at end-of-day, but their location couldn't be confirmed as outside the office. Please review.`,
              status: 'pending'
            });
          }
        }
      }

      // --- Daily Attendance Summaries (at 7:00 PM) ---
      if (currentHour === 19 && currentMin === 0 && lastSummaryRun !== todayKey) {
        lastSummaryRun = todayKey;
        console.log('Running Daily Summaries Job...');
        const tenantsList = await db.select().from(schema.tenants);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        for (const tenant of tenantsList) {
          const admins = await db.select().from(schema.users).where(
            and(
              eq(schema.users.tenantId, tenant.id),
              eq(schema.users.role, 'tenant_admin')
            )
          );
          if (admins.length === 0) continue;

          const totalEmployees = await db.select().from(schema.users).where(
            and(
              eq(schema.users.tenantId, tenant.id),
              eq(schema.users.role, 'employee')
            )
          );

          const checkedIn = await db.execute(sql`
            SELECT COUNT(DISTINCT user_id) as count 
            FROM attendance_logs 
            WHERE tenant_id = ${tenant.id} AND created_at >= ${todayStart} AND status = 'approved' AND type = 'check_in'
          `);

          const late = await db.execute(sql`
            SELECT COUNT(DISTINCT user_id) as count 
            FROM attendance_logs 
            WHERE tenant_id = ${tenant.id} AND created_at >= ${todayStart} AND status = 'approved' AND type = 'check_in' AND reason LIKE '%Late Arrival%'
          `);

          const violations = await db.select().from(schema.auditLedger).where(
            and(
              eq(schema.auditLedger.tenantId, tenant.id),
              sql`timestamp >= ${todayStart}`,
              sql`action IN ('FRAUD_CLOCK_MANIPULATION', 'BREAK_VIOLATION', 'FRAUD_GEOFENCE_BYPASS', 'FRAUD_NETWORK_BYPASS')`
            )
          );

          const checkInCount = checkedIn.rows ? checkedIn.rows[0].count : checkedIn[0].count;
          const lateCount = late.rows ? late.rows[0].count : late[0].count;
          const absentCount = totalEmployees.length - Number(checkInCount);

          await sendEmail({
            to: admins[0].email,
            subject: `Smart Teams Daily Summary: ${tenant.name}`,
            text: `Daily Summary for ${tenant.name} (${new Date().toLocaleDateString()}):\n\nTotal Employees: ${totalEmployees.length}\nPresent: ${checkInCount}\nLate Arrivals: ${lateCount}\nAbsent: ${absentCount}\nPolicy Violations today: ${violations.length}\n\nBest Regards,\nSmart Teams Security Engine`,
            html: `
              <div style="font-family: sans-serif; padding: 20px; color: #1E293B;">
                <h2>Daily Summary for ${tenant.name}</h2>
                <p>Date: <strong>${new Date().toLocaleDateString()}</strong></p>
                <ul>
                  <li>Total Employees: <strong>${totalEmployees.length}</strong></li>
                  <li>Present: <strong>${checkInCount}</strong></li>
                  <li>Late Arrivals: <strong>${lateCount}</strong></li>
                  <li>Absent: <strong>${absentCount}</strong></li>
                  <li>Policy Violations Today: <strong style="color:#EF4444;">${violations.length}</strong></li>
                </ul>
                <p>Please check the administrator audit ledger for detail entries.</p>
              </div>
            `
          });
        }
      }

      // --- Low-Attendance Alerts (at 8:30 PM daily) ---
      if (currentHour === 20 && currentMin === 30 && lastAttendanceCheckRun !== todayKey) {
        lastAttendanceCheckRun = todayKey;
        console.log('Running Low-Attendance Alert Job...');
        const tenantsList = await db.select().from(schema.tenants);

        for (const tenant of tenantsList) {
          const threshold = tenant.minAttendancePercent ?? 75;
          const monitoredUsers = await db.select().from(schema.users).where(
            and(
              eq(schema.users.tenantId, tenant.id),
              sql`role IN ('employee', 'manager', 'HR', 'GM')`
            )
          );

          for (const u of monitoredUsers) {
            const { percentage } = await computeAttendancePercent(u.id, tenant);
            if (percentage >= threshold) continue;

            await logToAuditLedger({
              tenantId: tenant.id,
              actorId: u.id,
              actorName: u.name,
              action: 'LOW_ATTENDANCE_DETECTED',
              details: { percentage, threshold }
            });

            await db.insert(schema.attendanceAlerts).values({
              tenantId: tenant.id,
              userId: u.id,
              type: 'low_attendance',
              message: `${u.name} (${u.role}) is at ${percentage}% attendance this month, below the required minimum of ${threshold}%.`,
              status: 'pending'
            });

            await sendLowAttendanceAlertEmail(u.email, u.name, u.name, u.role, percentage, threshold, true);

            const recipients = await getHierarchyAlertRecipients(tenant.id, u.role);
            for (const recipient of recipients) {
              await sendLowAttendanceAlertEmail(recipient.email, recipient.name, u.name, u.role, percentage, threshold, false);
            }
          }
        }
      }
    } catch (err) {
      console.error('Error in daily schedule job:', err);
    }
  }, 60000);
}

// All face detection/recognition/liveness scoring happens in a separate
// Python microservice (services/face-service) — this Node process never
// runs an ML model itself, which is exactly why it can't crash the way an
// in-process TensorFlow native-addon attempt did before. This function is
// the only place that talks to it; everything else in this file only ever
// deals with embeddings (arrays of numbers) and scores.
async function callFaceService(endpoint: string, payload: any): Promise<any> {
  const baseUrl = process.env.FACE_SERVICE_URL || 'http://127.0.0.1:8001';
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (networkErr: any) {
    throw new Error(`Could not reach the face service at ${baseUrl} — is it running? (services/face-service)`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.detail || `Face service returned HTTP ${response.status}`);
  }
  return body;
}

// Cosine similarity between two face embeddings. InsightFace's ArcFace
// embeddings (buffalo_l) are meant to be compared this way — a value near 1
// means "almost certainly the same person", near 0 (or negative) means
// unrelated. 0.36 is a commonly-cited InsightFace starting threshold; tune
// this per-deployment once you have real match/mismatch data.
function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return -1;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return -1;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Haversine distance in meters between two lat/lng points — used for GPS
// geofence checks both in the fast-fail pre-check and the authoritative
// final submit.
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Browsers can't read a device's actual Wi-Fi SSID, so network verification
// is really "is this request coming from the office's public IP" — resolved
// from the proxy/forwarded header (or a dev-only simulated override).
function resolveActiveIp(req: any, simulatedIp?: string): string {
  let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  if (typeof clientIp === 'string' && clientIp.includes(',')) {
    clientIp = clientIp.split(',')[0].trim();
  }
  if (typeof clientIp === 'string' && clientIp.startsWith('::ffff:')) {
    clientIp = clientIp.substring(7);
  }
  return simulatedIp || clientIp;
}

// Attendance percentage for a user, computed from working days so far this
// calendar month (excludes weekends per tenant.weekendConfig and holidays
// from the existing holidays table) vs. approved check-ins on those days.
// Not stored — computed on demand for both the self-service endpoint and
// the daily low-attendance alert cron.
async function computeAttendancePercent(userId: number, tenant: any, asOfDate: Date = new Date()): Promise<{ percentage: number, daysPresent: number, workingDaysSoFar: number }> {
  const weekendDays: string[] = Array.isArray(tenant.weekendConfig)
    ? tenant.weekendConfig
    : (typeof tenant.weekendConfig === 'string' ? JSON.parse(tenant.weekendConfig) : ['Saturday', 'Sunday']);

  const monthStart = new Date(asOfDate.getFullYear(), asOfDate.getMonth(), 1);
  monthStart.setHours(0, 0, 0, 0);
  const today = new Date(asOfDate);
  today.setHours(0, 0, 0, 0);

  const holidayRows = await db.select().from(schema.holidays).where(eq(schema.holidays.tenantId, tenant.id));
  const holidayDates = new Set(holidayRows.map((h: any) => h.date));

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const workingDates: string[] = [];
  for (let d = new Date(monthStart); d <= today; d.setDate(d.getDate() + 1)) {
    const dayName = dayNames[d.getDay()];
    const dateStr = d.toISOString().slice(0, 10);
    if (weekendDays.includes(dayName)) continue;
    if (holidayDates.has(dateStr)) continue;
    workingDates.push(dateStr);
  }

  if (workingDates.length === 0) {
    return { percentage: 100, daysPresent: 0, workingDaysSoFar: 0 };
  }

  const checkIns = await db.select().from(schema.attendanceLogs).where(
    and(
      eq(schema.attendanceLogs.userId, userId),
      eq(schema.attendanceLogs.type, 'check_in'),
      eq(schema.attendanceLogs.status, 'approved'),
      sql`created_at >= ${monthStart}`
    )
  );
  const presentDates = new Set(checkIns.map((log: any) => new Date(log.createdAt).toISOString().slice(0, 10)));
  const daysPresent = workingDates.filter(d => presentDates.has(d)).length;

  return { percentage: Math.round((daysPresent / workingDates.length) * 100), daysPresent, workingDaysSoFar: workingDates.length };
}

// Role-pool hierarchy for low-attendance / break-location alerts: everyone
// with the "up" role in the tenant, plus every tenant_admin. There's no
// per-employee assigned-manager relationship in this schema — alerts go to
// the whole role pool rather than one specific superior.
async function getHierarchyAlertRecipients(tenantId: number, subjectRole: string): Promise<any[]> {
  const upRole: Record<string, string | null> = {
    employee: 'manager',
    manager: 'HR',
    HR: 'GM',
    GM: null
  };
  const tenantUsers = await db.select().from(schema.users).where(eq(schema.users.tenantId, tenantId));
  const target = upRole[subjectRole];
  return tenantUsers.filter((u: any) => u.role === 'tenant_admin' || (target && u.role === target));
}

// The 8 guided poses captured during KYC enrollment. 'look_center' is the
// neutral baseline; the other 7 are also the vocabulary the daily liveness
// challenge is randomly drawn from.
const KYC_ACTIONS = ['look_center', 'turn_left', 'turn_right', 'look_up', 'look_down', 'smile', 'open_mouth', 'blink'];
const DAILY_CHALLENGE_ACTIONS = KYC_ACTIONS.filter(a => a !== 'look_center');

// Server-side record of exactly which liveness challenge was issued to
// which user, so /verify-face has something authoritative to check the
// capture burst against — the client can no longer just ignore whatever
// instruction was shown on screen. Single-process in-memory store (same
// tradeoff as the existing express-rate-limit windows in this file); a
// short expiry keeps stale/abandoned entries from lingering.
const pendingChallenges = new Map<number, { actions: string[]; issuedAt: number }>();
const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const FACE_TOKEN_TTL = '3m';

// Start the background scheduler only on the instance that wins leadership, so
// that when the app is scaled to multiple replicas the scheduled jobs (break
// scans, daily crons, alert emails) run exactly once across the fleet rather
// than redundantly on every replica. Followers stand by and periodically retry
// so leadership fails over automatically if the current leader goes away. On
// the single-instance JSON fallback, leadership is granted immediately.
async function startSchedulerWithLeadership() {
  const tryBecomeLeader = async (): Promise<boolean> => {
    const isLeader = await tryAcquireSchedulerLeadership();
    if (isLeader) {
      logger.info('scheduler: acquired leadership — starting background jobs on this instance');
      runBackgroundScheduler();
    }
    return isLeader;
  };

  if (await tryBecomeLeader()) return;

  logger.info('scheduler: another instance is the leader — standing by as follower');
  const retry = setInterval(async () => {
    if (await tryBecomeLeader()) clearInterval(retry);
  }, 30000);
}

async function startServer() {
  const app = express();
  // Honor a platform-injected PORT (Render/Fly/Heroku set this) but keep 3000
  // as the default so local dev and the existing Docker/compose setup are
  // unchanged.
  const PORT = Number(process.env.PORT) || 3000;

  // Resolve real-Postgres-vs-JSON-fallback exactly once, before any query
  // runs — everything below this line assumes db already knows which one
  // it's talking to.
  await detectPostgres();

  // Initialize DB and Seed
  await verifyAndSyncDatabase();
  await seedSuperAdmin();
  await startSchedulerWithLeadership();

  // Structured per-request logging (method, path, status, latency) — first in
  // the chain so it times the whole request. JSON lines in production.
  app.use(requestLogger);

  app.use(helmet({
    // Disabled: this app is served together with a Vite dev server / inline
    // scripts in some environments, which a strict default CSP would break.
    // Consider enabling a tailored CSP once the production asset pipeline
    // is finalized.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));

  // Third-party/partner integrations call this API from a different origin
  // than the bundled frontend, which browsers block by default without
  // explicit CORS headers. CORS_ALLOWED_ORIGINS is a comma-separated
  // allowlist (e.g. "https://partner.example.com,https://app.example.com");
  // unset means "same-origin only", the safe default. '*' opts in to any
  // origin — only use that for a genuinely public, unauthenticated API
  // surface (this one requires a bearer token per-request regardless, but
  // a wildcard still exposes it to browser-based CSRF-style abuse from any
  // page, so it's opt-in, not the default).
  const corsAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
  app.use(cors({
    origin: corsAllowedOrigins.length === 0
      ? undefined // same-origin only (no Access-Control-Allow-Origin header sent)
      : corsAllowedOrigins.includes('*')
        ? true
        : corsAllowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  app.use(express.json({ limit: '50mb' }));

  // Versioned API surface for external integrations: /api/v1/* is a plain
  // rewrite to the existing /api/* routes below, not a duplicate route
  // table — so every current and future /api/* endpoint is automatically
  // available at /api/v1/* too, with zero risk of the two drifting apart.
  // The bundled frontend keeps calling /api/* directly (unchanged); this
  // exists so external partners have a version-prefixed contract to
  // integrate against without depending on unprefixed paths.
  app.use((req, _res, next) => {
    if (req.url.startsWith('/api/v1/')) {
      req.url = req.url.replace('/api/v1/', '/api/');
    } else if (req.url === '/api/v1') {
      req.url = '/api';
    }
    next();
  });

  // Rate-limit key helper: prefer the authenticated user (from the bearer
  // token) over raw IP wherever possible. This app's whole premise is many
  // employees checking in from the SAME office network — several tenants
  // already rely on comparing everyone's public IP against one configured
  // office IP (see Wi-Fi verification below) — so keying by IP alone would
  // throttle an entire office as one client during a shift-start rush,
  // rather than throttling the one misbehaving caller. Falls back to IP
  // only when there's no token to read yet (e.g. the login attempt itself).
  function userAwareRateLimitKey(req: any): string {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const decoded = verifyToken(authHeader.slice(7));
      if (decoded?.userId) return `user:${decoded.userId}`;
    }
    return `ip:${req.ip}`;
  }

  // Generous general-purpose limiter — a safety net against abuse/DoS
  // without getting in the way of normal use (e.g. dashboards polling data,
  // or many different employees behind one office IP all checking in
  // around the same time).
  const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userAwareRateLimitKey,
  });
  app.use('/api/', generalLimiter);

  // Tight limiter specifically for authentication endpoints — brute-forcing
  // a password is exactly the attack this needs to slow down. Keyed by
  // IP + the specific email/account being attempted (not IP alone): this
  // still slows down someone hammering ONE account, without also locking
  // out every other employee logging into their OWN account from the same
  // office network at the same time (e.g. shift-start login rush) — a
  // pure per-IP key would do exactly that, since there's no bearer token
  // yet at the login step for userAwareRateLimitKey to key off of.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many attempts. Please wait 15 minutes and try again.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => `${req.ip}:${(req.body?.email || '').toLowerCase()}`,
  });

  function getDefaultPrivilegesForRole(role: string): string[] {
    switch (role) {
      case 'HR':
        return ['employee.create', 'employee.read', 'attendance.read', 'reports.view', 'breaks.manage', 'settings.edit'];
      case 'GM':
        return ['attendance.read', 'attendance.approve', 'reports.view', 'breaks.manage', 'settings.edit'];
      case 'manager':
        return ['attendance.read', 'attendance.approve', 'reports.view'];
      case 'employee':
        return ['attendance.create', 'breaks.create', 'reports.view'];
      default:
        return [];
    }
  }

  async function hasPrivilege(user: any, permission: string): Promise<boolean> {
    if (!user) return false;
    if (user.role === 'super_admin') return true;
    if (user.role === 'tenant_admin') return true;

    const userRec = await db.select().from(schema.users).where(eq(schema.users.id, user.userId || 0)).limit(1);
    if (userRec.length === 0) return false;
    const dbUser = userRec[0];

    if (dbUser.role === 'super_admin' || dbUser.role === 'tenant_admin') return true;

    const userPrivileges = dbUser.privileges as string[];
    if (userPrivileges && Array.isArray(userPrivileges) && userPrivileges.includes(permission)) {
      return true;
    }

    const defaultPrivs = getDefaultPrivilegesForRole(dbUser.role);
    if (defaultPrivs.includes(permission)) {
      return true;
    }

    return false;
  }

  // A user's full effective privilege set: their own explicitly-granted
  // privileges plus whatever their role gets by default. 'ALL' for the two
  // admin tiers, who are unrestricted. Used to enforce that power can only
  // ever be delegated downward — nobody can hand out a privilege they don't
  // themselves hold.
  async function getEffectivePrivileges(user: any): Promise<string[] | 'ALL'> {
    if (!user) return [];
    if (user.role === 'super_admin' || user.role === 'tenant_admin') return 'ALL';
    const userRec = await db.select().from(schema.users).where(eq(schema.users.id, user.userId || 0)).limit(1);
    if (userRec.length === 0) return [];
    const dbUser = userRec[0];
    if (dbUser.role === 'super_admin' || dbUser.role === 'tenant_admin') return 'ALL';
    const own = Array.isArray(dbUser.privileges) ? (dbUser.privileges as string[]) : [];
    const defaults = getDefaultPrivilegesForRole(dbUser.role);
    return Array.from(new Set([...own, ...defaults]));
  }

  // Finds everyone in a tenant who should be notified/can act on alerts for
  // a given permission (e.g. 'alerts.receive'). The tenant admin always
  // qualifies (they can see and do everything); beyond that, only users the
  // tenant admin has explicitly toggled the permission on for are included —
  // these are opt-in, not role defaults.
  async function getUsersWithPrivilege(tenantId: number, permission: string): Promise<any[]> {
    const tenantUsers = await db.select().from(schema.users).where(eq(schema.users.tenantId, tenantId));
    return tenantUsers.filter((u: any) => {
      if (u.role === 'tenant_admin') return true;
      const privs = (u.privileges as string[]) || [];
      return Array.isArray(privs) && privs.includes(permission);
    });
  }

  // Helper Auth Middleware
  function authenticate(req: any, res: any, next: any) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization token required' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = decoded;
    next();
  }

  // API Health check (liveness — fast, no dependencies).
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness probe that actually touches Postgres. Two jobs: (1) the
  // keep-alive pinger hits this so a free-tier managed DB (e.g. Neon) doesn't
  // suspend from inactivity, and (2) it confirms the app can reach its
  // datastore. Returns 503 if the DB is unreachable so uptime monitors notice.
  app.get('/api/health/db', async (_req, res) => {
    try {
      await db.execute(sql`SELECT 1`);
      res.json({ status: 'ok', db: 'up' });
    } catch (err: any) {
      res.status(503).json({ status: 'degraded', db: 'down', error: err?.message });
    }
  });

  // API documentation for external/partner integrations — raw spec plus an
  // interactive Swagger UI. Public (no auth) by design, same as any API
  // reference; the endpoints it documents are still bearer-token-protected
  // individually.
  app.get('/api/openapi.json', (req, res) => {
    res.json(openApiSpec);
  });
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
    customSiteTitle: 'Smart Teams API Docs',
  }));

  // Unified Login Endpoint
  app.post('/api/auth/login', authLimiter, async (req: any, res: any) => {
    try {
      const { email, password, deviceId } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const usersList = await db.select().from(schema.users).where(eq(schema.users.email, email));
      if (usersList.length === 0) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const user = usersList[0];

      // Match password (temporary password check included). Supports bcrypt
      // hashes as well as legacy plaintext rows (auto-upgraded below).
      const matchedViaPassword = await verifyPassword(password, user.password);
      const matchedViaTemp = !matchedViaPassword && await verifyPassword(password, user.tempPassword);
      const isPasswordMatch = matchedViaPassword || matchedViaTemp;
      if (!isPasswordMatch) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Transparently upgrade any legacy plaintext password to a bcrypt hash
      // the moment it's used successfully, so plaintext never lingers longer
      // than one login.
      if (matchedViaPassword && !isPasswordHashed(user.password)) {
        await db.update(schema.users).set({ password: await hashPassword(password) }).where(eq(schema.users.id, user.id));
      }
      if (matchedViaTemp && user.tempPassword && !isPasswordHashed(user.tempPassword)) {
        await db.update(schema.users).set({ tempPassword: await hashPassword(password) }).where(eq(schema.users.id, user.id));
      }

      // Check if user must change password
      if (user.mustChangePassword) {
        const tempToken = signToken({ userId: user.id, email: user.email, tempReset: true });
        return res.json({ requirePasswordChange: true, tempToken });
      }

      const result = await finalizeLogin(user, deviceId);
      if (result.ok === false) return res.status(result.status).json(result.body);
      res.json({ token: result.token, user: result.user });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Password Reset Endpoint (Forces temporary password replacement)
  app.post('/api/auth/reset-password', authLimiter, async (req: any, res: any) => {
    try {
      const { newPassword } = req.body;
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Reset token required' });
      }
      const token = authHeader.split(' ')[1];
      const decoded = verifyToken(token);
      if (!decoded || !decoded.tempReset) {
        return res.status(401).json({ error: 'Invalid or expired reset token' });
      }

      if (!newPassword || String(newPassword).length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
      }

      await db.update(schema.users)
        .set({
          password: await hashPassword(newPassword),
          tempPassword: null,
          mustChangePassword: false
        })
        .where(eq(schema.users.id, decoded.userId));

      const updatedUsers = await db.select().from(schema.users).where(eq(schema.users.id, decoded.userId));
      const user = updatedUsers[0];

      // Return full JWT session
      const sessionToken = signToken({
        userId: user.id,
        uid: user.uid,
        email: user.email,
        role: user.role,
        name: user.name,
        tenantId: user.tenantId
      });

      res.json({ token: sessionToken, user: { id: user.id, uid: user.uid, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Self-service Forgot Password (distinct from the forced temp-password
  // flow above: no active session/tempReset token required, entry point is
  // an emailed link instead of a login attempt). Always responds with the
  // same generic message regardless of whether the email matched an
  // account, so this endpoint can't be used to enumerate registered emails.
  app.post('/api/auth/forgot-password', authLimiter, async (req: any, res: any) => {
    const genericResponse = { message: 'If an account exists for that email, a password reset link has been sent.' };
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'Email is required' });

      const usersList = await db.select().from(schema.users).where(eq(schema.users.email, email));
      if (usersList.length > 0) {
        const user = usersList[0];
        const resetToken = signShortLivedToken({ userId: user.id, purpose: 'password_reset' }, '45m');
        const resetLink = `${process.env.APP_BASE_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;
        try {
          await sendPasswordResetEmail(user.email, user.name, resetLink);
        } catch (mailErr) {
          console.error('[forgot-password] Failed to send reset email:', mailErr);
        }
      }

      res.json(genericResponse);
    } catch (err: any) {
      // Never leak whether the account existed, even on unexpected errors.
      console.error('[forgot-password] error:', err);
      res.json(genericResponse);
    }
  });

  // Confirms a self-service password reset. The token's 'purpose' claim
  // keeps this cryptographically distinct from the tempReset tokens the
  // forced-reset flow above uses, even though both are signed by the same
  // signShortLivedToken/verifyToken pair.
  app.post('/api/auth/forgot-password/confirm', authLimiter, async (req: any, res: any) => {
    try {
      const { token, newPassword } = req.body;
      if (!token) return res.status(401).json({ error: 'Reset token is required' });

      const decoded = verifyToken(token);
      if (!decoded || decoded.purpose !== 'password_reset') {
        return res.status(401).json({ error: 'Invalid or expired reset link. Please request a new one.' });
      }

      if (!newPassword || String(newPassword).length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
      }

      await db.update(schema.users)
        .set({
          password: await hashPassword(newPassword),
          tempPassword: null,
          mustChangePassword: false
        })
        .where(eq(schema.users.id, decoded.userId));

      res.json({ message: 'Password updated. You can now sign in.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Google Sign-In — verifies the Google ID token server-side and logs in
  // an EXISTING account matched by email only. No auto-provisioning: a
  // Google email with no matching account is rejected, since accounts here
  // are created by an admin, not self-service.
  app.post('/api/auth/google', authLimiter, async (req: any, res: any) => {
    try {
      const { credential, deviceId } = req.body;
      if (!credential) return res.status(400).json({ error: 'Google credential is required' });
      if (!process.env.GOOGLE_CLIENT_ID) {
        return res.status(500).json({ error: 'Google Sign-In is not configured on this server.' });
      }

      const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
      let payload;
      try {
        const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
        payload = ticket.getPayload();
      } catch {
        return res.status(401).json({ error: 'Invalid Google credential' });
      }

      if (!payload?.email || !payload.email_verified) {
        return res.status(401).json({ error: 'Google account email is not verified' });
      }

      const usersList = await db.select().from(schema.users).where(eq(schema.users.email, payload.email));
      if (usersList.length === 0) {
        return res.status(401).json({ error: 'No account found for this Google email. Contact your administrator to be added.' });
      }

      // Google already verified this person's control of the email address,
      // so unlike password login there's no password/mustChangePassword gate
      // to satisfy here — go straight to the shared session-issuing tail.
      const result = await finalizeLogin(usersList[0], deviceId);
      if (result.ok === false) return res.status(result.status).json(result.body);
      res.json({ token: result.token, user: result.user });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Tenancy Request Endpoint (Public onboarding submission)
  app.post('/api/tenancy/request', authLimiter, async (req, res) => {
    try {
      const { companyName, email, numEmployees, plan } = req.body;
      if (!companyName || !email || !numEmployees || !plan) {
        return res.status(400).json({ error: 'All fields are required' });
      }

      const request = await db.insert(schema.tenancyRequests).values({
        companyName,
        email,
        numEmployees: parseInt(numEmployees),
        plan,
        status: 'pending'
      }).returning();

      // Create notification for Super Admin
      await db.insert(schema.notifications).values({
        userId: null, // Null represents super admin
        title: 'New Tenancy Request',
        message: `${companyName} requested access for the ${plan} Plan (${numEmployees} employees).`
      });

      // Send simulated confirmation email
      await sendEmail({
        to: email,
        subject: 'Smart Teams Tenancy Request Received',
        text: `Hello ${companyName},\n\nWe have received your request to join Smart Teams under the ${plan} Plan. Our Super Admin will review your application and onboard you shortly.\n\nBest Regards,\nSmart Teams Team`,
        html: `<h3>Hello ${companyName},</h3><p>We have received your request to join Smart Teams under the <strong>${plan} Plan</strong>. Our Super Admin will review your application and onboard you shortly.</p><br/><p>Best Regards,<br/>Smart Teams Team</p>`
      });

      res.json({ success: true, request: request[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // SUPER ADMIN API: Get Requests & Notifications
  app.get('/api/super/requests', authenticate, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Access denied' });
      }
      const requests = await db.select().from(schema.tenancyRequests).orderBy(desc(schema.tenancyRequests.createdAt));
      res.json({ requests });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/super/notifications', authenticate, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Access denied' });
      }
      const notifyList = await db.select().from(schema.notifications).where(sql`user_id IS NULL`).orderBy(desc(schema.notifications.createdAt));
      res.json({ notifications: notifyList });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // SUPER ADMIN API: Approve Tenancy & Onboard Tenant
  app.post('/api/super/approve', authenticate, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Access denied' });
      }
      const { requestId, featuresAllowed, plan } = req.body;
      
      const reqDetails = await db.select().from(schema.tenancyRequests).where(eq(schema.tenancyRequests.id, requestId));
      if (reqDetails.length === 0) {
        return res.status(404).json({ error: 'Request not found' });
      }
      const request = reqDetails[0];

      // Check if email already registered in users
      const existingUser = await db.select().from(schema.users).where(eq(schema.users.email, request.email));
      if (existingUser.length > 0) {
        return res.status(400).json({ error: 'Admin email is already in use' });
      }

      // Generate credentials
      const adminUid = crypto.randomUUID();
      const tempPassword = 'temp_' + crypto.randomBytes(6).toString('hex');

      // Create Tenant
      const tenant = await db.insert(schema.tenants).values({
        name: request.companyName,
        adminUid,
        plan: plan || request.plan,
        featuresAllowed: featuresAllowed || ['kyc', 'wifi_lock', 'gps_geofence']
      }).returning();

      // Create Tenant Admin User. The plaintext tempPassword is only ever
      // used for the one-time activation email below; the stored value is
      // always a bcrypt hash.
      await db.insert(schema.users).values({
        uid: adminUid,
        email: request.email,
        password: '', // blank initially, relies on tempPassword
        tempPassword: await hashPassword(tempPassword),
        name: `${request.companyName} Admin`,
        role: 'tenant_admin',
        mustChangePassword: true,
        tenantId: tenant[0].id
      });

      // Update tenancy request status
      await db.update(schema.tenancyRequests)
        .set({ status: 'approved' })
        .where(eq(schema.tenancyRequests.id, requestId));

      // Send credentials mail with redirection link
      const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
      const activationLink = `${baseUrl}/login?email=${encodeURIComponent(request.email)}&temp=${tempPassword}`;
      
      await sendEmail({
        to: request.email,
        subject: 'Welcome to Smart Teams - Access Granted',
        text: `Hello ${request.companyName} Admin,\n\nYour tenancy has been approved by the Super Admin under the ${tenant[0].plan} plan.\n\nYour credentials:\nUsername: ${request.email}\nTemporary Password: ${userCredentialsTemplate(tempPassword)}\n\nLogin and set your permanent password here: ${activationLink}\n\nBest Regards,\nSmart Teams Onboarding`,
        html: `<h3>Hello ${request.companyName} Admin,</h3><p>Your tenancy has been approved by the Super Admin under the <strong>${tenant[0].plan} plan</strong>.</p><p><strong>Your credentials:</strong><br/>Username: <code>${request.email}</code><br/>Temporary Password: <code>${tempPassword}</code></p><p><a href="${activationLink}" style="display:inline-block;background:#7B5CFA;color:white;padding:10px 20px;text-decoration:none;border-radius:20px;font-weight:bold;">Activate Your Account</a></p><br/><p>Best Regards,<br/>Smart Teams Onboarding</p>`
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Helper formatting for email text
  function userCredentialsTemplate(p: string) {
    return p;
  }

  // SUPER ADMIN API: List all tenants (with live employee counts) for the
  // "manage tenants" view — suspend/reactivate, review plan & features.
  app.get('/api/super/tenants', authenticate, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Access denied' });
      }
      const tenantsList = await db.select().from(schema.tenants).orderBy(desc(schema.tenants.createdAt));

      const withCounts = await Promise.all(tenantsList.map(async (t: any) => {
        const employees = await db.select().from(schema.users).where(eq(schema.users.tenantId, t.id));
        return { ...t, employeeCount: employees.length };
      }));

      res.json({ tenants: withCounts });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // SUPER ADMIN API: Suspend or reactivate a tenant. Suspending immediately
  // blocks that tenant's users from logging in or logging attendance —
  // enforced in /api/auth/login and /api/attendance below.
  app.post('/api/super/tenants/status', authenticate, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Access denied' });
      }
      const { tenantId, status } = req.body;
      if (!tenantId || !['active', 'suspended'].includes(status)) {
        return res.status(400).json({ error: 'tenantId and a valid status (active|suspended) are required' });
      }

      const tenantList = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
      if (tenantList.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      await db.update(schema.tenants).set({ status }).where(eq(schema.tenants.id, tenantId));

      await logToAuditLedger({
        tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: status === 'suspended' ? 'TENANT_SUSPENDED' : 'TENANT_REACTIVATED',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { tenantName: tenantList[0].name }
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // SUPER ADMIN API: Organization-wide analytics dashboard.
  app.get('/api/super/analytics', authenticate, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Access denied' });
      }

      const tenantsList = await db.select().from(schema.tenants);
      const allUsers = await db.select().from(schema.users);

      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const monthlyLogs = await db.select().from(schema.attendanceLogs).where(
        sql`created_at >= ${monthStart}`
      );

      const activeTenants = tenantsList.filter((t: any) => (t.status || 'active') === 'active').length;
      const suspendedTenants = tenantsList.filter((t: any) => t.status === 'suspended').length;
      const staffByRole: Record<string, number> = {};
      for (const u of allUsers) {
        const r = u.role || 'employee';
        staffByRole[r] = (staffByRole[r] || 0) + 1;
      }

      res.json({
        totalTenants: tenantsList.length,
        activeTenants,
        suspendedTenants,
        totalEmployees: allUsers.filter((u: any) => u.role !== 'super_admin').length,
        staffByRole,
        monthlyCheckInEvents: monthlyLogs.filter((l: any) => l.type === 'check_in' && l.status === 'approved').length,
        monthlyRejectedEvents: monthlyLogs.filter((l: any) => l.status === 'rejected').length,
        planBreakdown: tenantsList.reduce((acc: Record<string, number>, t: any) => {
          const p = t.plan || 'Basic';
          acc[p] = (acc[p] || 0) + 1;
          return acc;
        }, {})
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // TENANT ADMIN API: Today's live attendance snapshot + monthly summary for
  // the tenant's own dashboard.
  app.get('/api/tenant/analytics', authenticate, async (req: any, res: any) => {
    try {
      const tenantId = req.user.tenantId;
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const staff = await db.select().from(schema.users).where(
        and(eq(schema.users.tenantId, tenantId), sql`role != 'tenant_admin'`)
      );

      const todaysLogs = await db.select().from(schema.attendanceLogs).where(
        and(eq(schema.attendanceLogs.tenantId, tenantId), sql`created_at >= ${todayStart}`)
      );

      const checkedInToday = new Set(
        todaysLogs.filter((l: any) => l.type === 'check_in' && l.status === 'approved').map((l: any) => l.userId)
      );
      const lateToday = todaysLogs.filter((l: any) =>
        l.type === 'check_in' && l.status === 'approved' && (l.reason || '').includes('Late Arrival')
      ).length;
      const rejectedToday = todaysLogs.filter((l: any) => l.status === 'rejected').length;

      const monthlyLogs = await db.select().from(schema.attendanceLogs).where(
        and(eq(schema.attendanceLogs.tenantId, tenantId), sql`created_at >= ${monthStart}`)
      );

      // Per-person drill-down lists behind the stat cards. The scalar counts
      // above stay open to any logged-in tenant user (as before), but the
      // named lists are more sensitive, so only include them for callers who
      // can already see people-level reporting (reports.view) or the
      // directory (employee.read). Everyone else just gets the numbers.
      let breakdown: any = undefined;
      if (await hasPrivilege(req.user, 'reports.view') || await hasPrivilege(req.user, 'employee.read')) {
        const userById = new Map<number, any>(staff.map((u: any) => [u.id, u]));
        const nameOf = (id: number) => userById.get(id)?.name || 'Unknown';
        const roleOf = (id: number) => userById.get(id)?.role || 'unknown';

        const checkInRows = todaysLogs.filter((l: any) => l.type === 'check_in' && l.status === 'approved');
        const present = checkInRows.map((l: any) => ({
          userId: l.userId, name: nameOf(l.userId), role: roleOf(l.userId),
          checkInTime: l.createdAt, attendanceMode: l.attendanceMode, status: l.status,
        }));
        const late = checkInRows
          .filter((l: any) => (l.reason || '').includes('Late Arrival'))
          .map((l: any) => ({
            userId: l.userId, name: nameOf(l.userId), role: roleOf(l.userId),
            checkInTime: l.createdAt, attendanceMode: l.attendanceMode, status: l.status,
          }));
        const rejected = todaysLogs.filter((l: any) => l.status === 'rejected').map((l: any) => ({
          userId: l.userId, name: nameOf(l.userId), role: roleOf(l.userId),
          checkInTime: l.createdAt, attendanceMode: l.attendanceMode, status: l.status,
        }));
        const absent = staff.filter((u: any) => !checkedInToday.has(u.id)).map((u: any) => ({
          userId: u.id, name: u.name, role: u.role,
        }));
        const total = staff.map((u: any) => ({
          userId: u.id, name: u.name, role: u.role,
          isKycCompleted: !!u.isKycCompleted,
        }));
        breakdown = { total, present, absent, late, rejected };
      }

      res.json({
        totalStaff: staff.length,
        presentToday: checkedInToday.size,
        absentToday: Math.max(0, staff.length - checkedInToday.size),
        lateToday,
        rejectedToday,
        monthlyCheckIns: monthlyLogs.filter((l: any) => l.type === 'check_in' && l.status === 'approved').length,
        monthlyRejections: monthlyLogs.filter((l: any) => l.status === 'rejected').length,
        staffByRole: staff.reduce((acc: Record<string, number>, u: any) => {
          const r = u.role || 'employee';
          acc[r] = (acc[r] || 0) + 1;
          return acc;
        }, {}),
        breakdown,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // TENANT ADMIN API: Hire/Recruit Employees & Managers
  app.post('/api/tenant/users/create', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'employee.create')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }

      const { email, name, role, privileges } = req.body;
      if (!email || !name || !role) {
        return res.status(400).json({ error: 'Email, name, and role are required' });
      }

      // SECURITY: this endpoint is for hiring ordinary staff. Without this
      // check, a tenant admin (or anyone calling the API directly) could set
      // role: 'super_admin' or 'tenant_admin' here and grant an account
      // unrestricted or cross-tenant access. Those two roles are only ever
      // created by the super admin's own onboarding flow (/api/super/approve).
      const normalizedRole = String(role).trim().toLowerCase();
      if (normalizedRole === 'super_admin' || normalizedRole === 'tenant_admin' || normalizedRole === 'superadmin') {
        return res.status(403).json({ error: 'This role cannot be assigned here.' });
      }

      // Check if user already exists
      const existing = await db.select().from(schema.users).where(eq(schema.users.email, email));
      if (existing.length > 0) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      const tempPassword = 'temp_' + crypto.randomBytes(6).toString('hex');
      const userUid = crypto.randomUUID();

      // PRECEDENCE OF POWER: whoever is onboarding this person can only pass
      // down privileges they themselves actually hold right now — an HR/GM
      // granted just 'employee.create' cannot turn around and grant a new
      // hire 'settings.edit' or 'reports.view' unless they have that
      // themselves. Only the tenant admin (unrestricted) can grant anything.
      // This keeps authority strictly non-increasing as it's delegated
      // further down the org, however many layers deep.
      const requesterPrivileges = await getEffectivePrivileges(req.user);
      const requestedExtra = Array.isArray(privileges) ? privileges : [];
      const grantablePrivileges = requesterPrivileges === 'ALL'
        ? requestedExtra
        : requestedExtra.filter((p: string) => requesterPrivileges.includes(p));

      // Merge the role's baseline privileges with any extra (grantable)
      // privileges the requester explicitly toggled on, rather than letting
      // a truthy-but-empty array silently wipe out the role defaults
      // (`[] || x` is `[]`, not `x`, in JS — that was the previous bug here).
      const finalPrivileges = Array.from(new Set([
        ...getDefaultPrivilegesForRole(role),
        ...grantablePrivileges
      ]));

      await db.insert(schema.users).values({
        uid: userUid,
        email,
        name,
        password: '',
        tempPassword: await hashPassword(tempPassword),
        role,
        privileges: finalPrivileges,
        mustChangePassword: true,
        tenantId: req.user.tenantId
      });

      // Send credential email
      const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
      const activationLink = `${baseUrl}/login?email=${encodeURIComponent(email)}&temp=${tempPassword}`;
      await sendEmail({
        to: email,
        subject: `Smart Teams Invitation - Registered as ${role}`,
        text: `Hello ${name},\n\nYou have been registered on Smart Teams as a ${role}.\n\nYour credentials:\nUsername: ${email}\nTemporary Password: ${tempPassword}\n\nLogin and set your password here: ${activationLink}\n\nBest Regards,\nSmart Teams Team`,
        html: `<h3>Hello ${name},</h3><p>You have been registered on Smart Teams as a <strong>${role}</strong>.</p><p><strong>Your credentials:</strong><br/>Username: <code>${email}</code><br/>Temporary Password: <code>${tempPassword}</code></p><p><a href="${activationLink}" style="display:inline-block;background:#FF3D8A;color:white;padding:10px 20px;text-decoration:none;border-radius:20px;font-weight:bold;">Set Your Password</a></p><br/><p>Best Regards,<br/>Smart Teams Team</p>`
      });

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'EMPLOYEE_CREATED',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { email, name, role }
      });

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'INVITATION_SENT',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { email, activationLink }
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get users for Tenant Admin
  app.get('/api/tenant/users', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'employee.read') && !await hasPrivilege(req.user, 'employee.create')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const usersList = await db.select().from(schema.users)
        .where(eq(schema.users.tenantId, req.user.tenantId))
        .orderBy(desc(schema.users.createdAt));
      
      res.json({ users: usersList });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Narrow, additive capability: grant/revoke ONLY the QR Attendance
  // permission strings for an EXISTING user, without disturbing any other
  // privilege they already hold. There is no general "edit an existing
  // user's privileges" endpoint in this app today — privileges are
  // otherwise set once, at hire time, via /api/tenant/users/create — and
  // building a full privilege editor is out of scope here. This is
  // deliberately scoped to exactly the 5 QR_PERMISSIONS values so an
  // already-hired employee ("...or whoever") can be granted QR
  // display/generate access too, not just brand-new hires.
  app.post('/api/tenant/users/:id/qr-access', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'employee.create')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const targetId = parseInt(req.params.id, 10);
      const { permissions } = req.body; // string[] — the full desired set of QR permissions that should be ON
      if (!Array.isArray(permissions)) {
        return res.status(400).json({ error: 'permissions (array) is required' });
      }
      const qrPermissionValues: string[] = Object.values(QR_PERMISSIONS);
      const requested = permissions.filter((p: string) => qrPermissionValues.includes(p));

      // Same "precedence of power" rule as hiring (server.ts /api/tenant/users/create):
      // can't grant a QR permission the requester doesn't themselves effectively hold.
      const requesterPrivileges = await getEffectivePrivileges(req.user);
      const grantable = requesterPrivileges === 'ALL' ? requested : requested.filter((p: string) => requesterPrivileges.includes(p));

      const targetList = await db.select().from(schema.users).where(eq(schema.users.id, targetId));
      if (targetList.length === 0) return res.status(404).json({ error: 'User not found' });
      const target = targetList[0];
      if (target.tenantId !== req.user.tenantId) {
        return res.status(403).json({ error: 'Access denied: This user does not belong to your organization.' });
      }

      const existingPrivileges: string[] = Array.isArray(target.privileges) ? (target.privileges as string[]) : [];
      const withoutQr = existingPrivileges.filter((p: string) => !qrPermissionValues.includes(p));
      const finalPrivileges = Array.from(new Set([...withoutQr, ...grantable]));

      await db.update(schema.users).set({ privileges: finalPrivileges }).where(eq(schema.users.id, targetId));

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'QR_ACCESS_UPDATED',
        details: { subjectUserId: targetId, permissions: grantable }
      });

      res.json({ success: true, privileges: finalPrivileges });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get notifications for Tenant Admin
  app.get('/api/tenant/notifications', authenticate, async (req: any, res: any) => {
    try {
      const notifyList = await db.select().from(schema.notifications)
        .where(eq(schema.notifications.userId, req.user.tenantId))
        .orderBy(desc(schema.notifications.createdAt));
      res.json({ notifications: notifyList });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // TENANT ADMIN API: Get & Approve Device Change Requests
  app.get('/api/tenant/device-requests', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'settings.edit')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const requests = await db.select({
        id: schema.deviceChangeRequests.id,
        status: schema.deviceChangeRequests.status,
        oldDeviceId: schema.deviceChangeRequests.oldDeviceId,
        newDeviceId: schema.deviceChangeRequests.newDeviceId,
        createdAt: schema.deviceChangeRequests.createdAt,
        userName: schema.users.name,
        userEmail: schema.users.email,
        userId: schema.users.id
      })
      .from(schema.deviceChangeRequests)
      .innerJoin(schema.users, eq(schema.deviceChangeRequests.userId, schema.users.id))
      .where(
        and(
          eq(schema.deviceChangeRequests.tenantId, req.user.tenantId),
          eq(schema.deviceChangeRequests.status, 'pending')
        )
      )
      .orderBy(desc(schema.deviceChangeRequests.createdAt));

      res.json({ requests });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tenant/device-requests/action', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'settings.edit')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const { requestId, action } = req.body; // action: 'approve' | 'reject'
      
      const reqList = await db.select().from(schema.deviceChangeRequests).where(eq(schema.deviceChangeRequests.id, requestId));
      if (reqList.length === 0) {
        return res.status(404).json({ error: 'Request not found' });
      }
      const deviceReq = reqList[0];

      // SECURITY: enforce tenant isolation — without this check, any tenant
      // admin/HR/GM could approve or reject a device-change request
      // belonging to a completely different tenant just by guessing an ID.
      if (deviceReq.tenantId !== req.user.tenantId) {
        return res.status(403).json({ error: 'Access denied: This request does not belong to your organization.' });
      }

      if (action === 'approve') {
        // Update user device ID
        await db.update(schema.users)
          .set({
            registeredDeviceId: deviceReq.newDeviceId,
            deviceApprovalPending: false
          })
          .where(eq(schema.users.id, deviceReq.userId));

        await db.update(schema.deviceChangeRequests)
          .set({ status: 'approved' })
          .where(eq(schema.deviceChangeRequests.id, requestId));
      } else {
        await db.update(schema.users)
          .set({ deviceApprovalPending: false })
          .where(eq(schema.users.id, deviceReq.userId));

        await db.update(schema.deviceChangeRequests)
          .set({ status: 'rejected' })
          .where(eq(schema.deviceChangeRequests.id, requestId));
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // BREAK SESSIONS API
  app.get('/api/breaks/active', authenticate, async (req: any, res: any) => {
    try {
      const active = await db.select().from(schema.breakSessions).where(
        and(
          eq(schema.breakSessions.userId, req.user.userId),
          eq(schema.breakSessions.status, 'active')
        )
      );
      res.json({ active: active.length > 0 ? active[0] : null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Today's break sessions + remaining budget — feeds the Employee Home
  // page's "break time remaining" and "log of breaks" widgets.
  app.get('/api/breaks/today', authenticate, async (req: any, res: any) => {
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const sessions = await db.select().from(schema.breakSessions).where(
        and(
          eq(schema.breakSessions.userId, req.user.userId),
          sql`start_time >= ${todayStart}`
        )
      ).orderBy(desc(schema.breakSessions.id));

      const tenantList = await db.select().from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId || 1));
      const budgetMins = tenantList.length > 0 ? (tenantList[0].dailyBreakBudgetMins || 60) : 60;

      const usedMins = sessions.reduce((sum: number, s: any) => {
        if (s.status === 'completed' && s.endTime) {
          return sum + Math.round((new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 60000);
        }
        if (s.status === 'active') {
          return sum + Math.round((Date.now() - new Date(s.startTime).getTime()) / 60000);
        }
        return sum;
      }, 0);

      res.json({ sessions, budgetMins, usedMins, remainingMins: Math.max(0, budgetMins - usedMins) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/breaks/start', authenticate, async (req: any, res: any) => {
    try {
      const { breakType, lat, lng } = req.body;

      if (lat == null || lng == null) {
        return res.status(400).json({ error: 'GPS location permission is required to start a break.' });
      }

      const existing = await db.select().from(schema.breakSessions).where(
        and(
          eq(schema.breakSessions.userId, req.user.userId),
          eq(schema.breakSessions.status, 'active')
        )
      );
      if (existing.length > 0) {
        return res.status(400).json({ error: 'Break already active' });
      }

      const startTime = new Date();

      const session = await db.insert(schema.breakSessions).values({
        userId: req.user.userId,
        tenantId: req.user.tenantId,
        breakType: breakType || 'General',
        startTime,
        startLat: lat != null ? parseFloat(lat) : null,
        startLng: lng != null ? parseFloat(lng) : null,
        status: 'active'
      }).returning();

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'BREAK_STARTED',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { sessionId: session[0].id, startTime: startTime.toISOString(), breakType: breakType || 'General', lat, lng }
      });

      res.json({ session: session[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/breaks/end', authenticate, async (req: any, res: any) => {
    try {
      const { clientTimestamp, lat, lng } = req.body;

      if (lat == null || lng == null) {
        return res.status(400).json({ error: 'GPS location permission is required to end a break.' });
      }

      const active = await db.select().from(schema.breakSessions).where(
        and(
          eq(schema.breakSessions.userId, req.user.userId),
          eq(schema.breakSessions.status, 'active')
        )
      );
      if (active.length === 0) {
        return res.status(400).json({ error: 'No active break session' });
      }

      const startTime = new Date(active[0].startTime);

      // Check for backdated timestamps or drift
      if (clientTimestamp) {
        const clientTime = new Date(clientTimestamp).getTime();
        if (isNaN(clientTime) || clientTime < startTime.getTime()) {
          return res.status(400).json({ error: 'Reject immediately: Backdated break end timestamp.' });
        }
        if (Math.abs(Date.now() - clientTime) > 5 * 60 * 1000) {
          return res.status(400).json({ error: 'Reject immediately: Client time mismatch (Backdated).' });
        }
      }

      const endTime = new Date();
      const elapsedMins = Math.round((endTime.getTime() - startTime.getTime()) / 60000);

      const tenantList = await db.select().from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId));
      const tenant = tenantList[0];
      const budget = tenant ? (tenant.dailyBreakBudgetMins || 60) : 60;

      let isViolation = false;
      if (elapsedMins > budget) {
        isViolation = true;
      }

      // Outside the office geofence at return time — do NOT close the break;
      // it stays 'active' until the employee is back within range. This is
      // deliberately different from the budget-violation case below (which
      // does close the break, just flagged): here the employee hasn't
      // actually returned to work yet, so there's nothing valid to record
      // as an end time.
      let outsideGeofence = false;
      if (tenant && tenant.locationLat && tenant.locationLng) {
        const distance = haversineMeters(lat, lng, tenant.locationLat, tenant.locationLng);
        if (distance > (tenant.locationRadiusMeters || 100)) {
          outsideGeofence = true;
        }
      }

      if (outsideGeofence) {
        await logToAuditLedger({
          tenantId: req.user.tenantId,
          actorId: req.user.userId,
          actorName: req.user.name,
          action: 'FRAUD_BREAK_OUTSIDE_GEOFENCE',
          details: { lat, lng, breakSessionId: active[0].id }
        });

        await db.insert(schema.attendanceAlerts).values({
          tenantId: req.user.tenantId,
          userId: req.user.userId,
          breakSessionId: active[0].id,
          type: 'break_outside_geofence',
          message: `${req.user.name} tried to end a break from outside the office location. The break remains active.`,
          status: 'pending'
        });

        await sendBreakLocationViolationEmail(req.user.email, req.user.name, req.user.name, true);
        const hierarchyRecipients = await getHierarchyAlertRecipients(req.user.tenantId, req.user.role);
        for (const recipient of hierarchyRecipients) {
          await sendBreakLocationViolationEmail(recipient.email, recipient.name, req.user.name, false);
        }

        return res.status(400).json({
          error: "You're outside the office location — move back within range to end your break.",
          outsideGeofence: true
        });
      }

      await db.update(schema.breakSessions)
        .set({
          endTime,
          endLat: parseFloat(lat),
          endLng: parseFloat(lng),
          isViolation,
          outsideGeofence: false,
          status: 'completed'
        })
        .where(eq(schema.breakSessions.id, active[0].id));

      const unpaidDuration = Math.max(0, elapsedMins - budget);

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'BREAK_ENDED',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { 
          sessionId: active[0].id, 
          durationMins: elapsedMins, 
          budgetMins: budget, 
          isViolation,
          unpaidDuration,
          outsideGeofence
        }
      });

      // Recipient for the budget-violation case below is whoever the tenant
      // admin has granted 'alerts.receive' to (plus the tenant admin,
      // always) — unchanged from before; only the geofence case above
      // switched to the role-hierarchy resolver.
      const alertRecipients = await getUsersWithPrivilege(req.user.tenantId, 'alerts.receive');

      if (isViolation) {
        await logToAuditLedger({
          tenantId: req.user.tenantId,
          actorId: req.user.userId,
          actorName: req.user.name,
          action: 'BREAK_VIOLATION',
          details: { durationMins: elapsedMins, budgetMins: budget }
        });

        await sendBreakViolationAlert(req.user.email, req.user.name, endTime.toLocaleDateString(), elapsedMins, budget);

        await db.insert(schema.attendanceAlerts).values({
          tenantId: req.user.tenantId,
          userId: req.user.userId,
          breakSessionId: active[0].id,
          type: 'break_exceeded',
          message: `${req.user.name} exceeded the daily break budget. Elapsed: ${elapsedMins} min (allowed: ${budget} min, unpaid: ${unpaidDuration} min).`
        });

        for (const recipient of alertRecipients) {
          await sendManagerEscalationEmail(
            recipient.email,
            recipient.name,
            req.user.name,
            'Break Overstay Violation',
            `${req.user.name} went on break but exceeded the company break budget. Time elapsed: ${elapsedMins} minutes (Allowed Budget: ${budget} mins). Unpaid duration: ${unpaidDuration} mins.`
          );
        }
      }

      res.json({ success: true, elapsedMins, isViolation, unpaidDuration, outsideGeofence });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // List alerts for whoever has 'alerts.receive' — tenant admin always sees all.
  app.get('/api/tenant/alerts', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'alerts.receive')) {
        return res.status(403).json({ error: 'Access denied: You have not been granted permission to receive alerts.' });
      }
      const alerts = await db.select().from(schema.attendanceAlerts)
        .where(eq(schema.attendanceAlerts.tenantId, req.user.tenantId))
        .orderBy(desc(schema.attendanceAlerts.createdAt));

      // Attach the violator's name for display
      const withNames = await Promise.all(alerts.map(async (a: any) => {
        const u = await db.select().from(schema.users).where(eq(schema.users.id, a.userId));
        return { ...a, userName: u[0]?.name || 'Unknown', userRole: u[0]?.role || '' };
      }));

      res.json({ alerts: withNames });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Accept or reject an alert. Each action is gated by its own privilege —
  // a user might be allowed to receive and accept alerts but not reject
  // them, or vice versa, exactly as the tenant admin configured.
  app.post('/api/tenant/alerts/action', authenticate, async (req: any, res: any) => {
    try {
      const { alertId, action } = req.body; // action: 'accept' | 'reject'
      if (!alertId || !['accept', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'alertId and a valid action (accept|reject) are required' });
      }

      const requiredPrivilege = action === 'accept' ? 'alerts.accept' : 'alerts.reject';
      if (!await hasPrivilege(req.user, requiredPrivilege)) {
        return res.status(403).json({ error: `Access denied: You have not been granted permission to ${action} alerts.` });
      }

      const alertList = await db.select().from(schema.attendanceAlerts).where(eq(schema.attendanceAlerts.id, alertId));
      if (alertList.length === 0) {
        return res.status(404).json({ error: 'Alert not found' });
      }
      const alert = alertList[0];

      // SECURITY: tenant isolation — never let someone resolve another
      // tenant's alert just by guessing an ID.
      if (alert.tenantId !== req.user.tenantId) {
        return res.status(403).json({ error: 'Access denied: This alert does not belong to your organization.' });
      }
      if (alert.status !== 'pending') {
        return res.status(400).json({ error: 'This alert has already been resolved.' });
      }

      await db.update(schema.attendanceAlerts)
        .set({
          status: action === 'accept' ? 'accepted' : 'rejected',
          resolvedByUserId: req.user.userId,
          resolvedAt: new Date()
        })
        .where(eq(schema.attendanceAlerts.id, alertId));

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: action === 'accept' ? 'ALERT_ACCEPTED' : 'ALERT_REJECTED',
        details: { alertId, type: alert.type, subjectUserId: alert.userId }
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // HOLIDAY CALENDAR
  // ==========================================

  // Anyone authenticated in the tenant can view the holiday calendar.
  app.get('/api/tenant/holidays', authenticate, async (req: any, res: any) => {
    try {
      const list = await db.select().from(schema.holidays)
        .where(eq(schema.holidays.tenantId, req.user.tenantId))
        .orderBy(schema.holidays.date);
      res.json({ holidays: list });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Only the tenant admin sets the holiday calendar — it's a policy, same
  // reasoning as /api/tenant/config/update.
  app.post('/api/tenant/holidays', authenticate, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'tenant_admin') {
        return res.status(403).json({ error: 'Access denied: Only the tenant admin can manage the holiday calendar.' });
      }
      const { date, name } = req.body;
      if (!date || !name) {
        return res.status(400).json({ error: 'date and name are required' });
      }
      const created = await db.insert(schema.holidays).values({
        tenantId: req.user.tenantId,
        date,
        name
      }).returning();
      res.json({ holiday: created[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/tenant/holidays/:id', authenticate, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'tenant_admin') {
        return res.status(403).json({ error: 'Access denied: Only the tenant admin can manage the holiday calendar.' });
      }
      const holidayList = await db.select().from(schema.holidays).where(eq(schema.holidays.id, parseInt(req.params.id)));
      if (holidayList.length === 0) {
        return res.status(404).json({ error: 'Holiday not found' });
      }
      if (holidayList[0].tenantId !== req.user.tenantId) {
        return res.status(403).json({ error: 'Access denied: This holiday does not belong to your organization.' });
      }
      await db.delete(schema.holidays).where(eq(schema.holidays.id, parseInt(req.params.id)));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // ATTENDANCE CORRECTION / REGULARIZATION
  // ==========================================

  // Any authenticated staff member can request a correction on their own
  // attendance (missed check-in/out, wrong location flagged, etc.).
  app.post('/api/attendance/corrections', authenticate, async (req: any, res: any) => {
    try {
      const { requestType, requestedDate, requestedTime, reason } = req.body;
      if (!requestType || !requestedDate || !reason) {
        return res.status(400).json({ error: 'requestType, requestedDate, and reason are required' });
      }
      const validTypes = ['missed_checkin', 'missed_checkout', 'wrong_location', 'other'];
      if (!validTypes.includes(requestType)) {
        return res.status(400).json({ error: 'Invalid requestType' });
      }

      const created = await db.insert(schema.attendanceCorrections).values({
        tenantId: req.user.tenantId,
        userId: req.user.userId,
        requestType,
        requestedDate,
        requestedTime: requestedTime || null,
        reason
      }).returning();

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'CORRECTION_REQUESTED',
        details: { correctionId: created[0].id, requestType, requestedDate }
      });

      // Notify whoever can actually approve corrections.
      const approvers = await getUsersWithPrivilege(req.user.tenantId, 'attendance.approve');
      for (const approver of approvers) {
        await sendManagerEscalationEmail(
          approver.email,
          approver.name,
          req.user.name,
          'Attendance Correction Requested',
          `${req.user.name} requested an attendance correction for ${requestedDate} (${requestType.replace('_', ' ')}): ${reason}`
        );
      }

      res.json({ correction: created[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // An employee can see their own correction request history.
  app.get('/api/attendance/corrections/mine', authenticate, async (req: any, res: any) => {
    try {
      const list = await db.select().from(schema.attendanceCorrections)
        .where(eq(schema.attendanceCorrections.userId, req.user.userId))
        .orderBy(desc(schema.attendanceCorrections.createdAt));
      res.json({ corrections: list });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Whoever holds 'attendance.approve' reviews the tenant's pending requests.
  app.get('/api/tenant/corrections', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'attendance.approve')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const list = await db.select().from(schema.attendanceCorrections)
        .where(eq(schema.attendanceCorrections.tenantId, req.user.tenantId))
        .orderBy(desc(schema.attendanceCorrections.createdAt));

      const withNames = await Promise.all(list.map(async (c: any) => {
        const u = await db.select().from(schema.users).where(eq(schema.users.id, c.userId));
        return { ...c, userName: u[0]?.name || 'Unknown', userRole: u[0]?.role || '' };
      }));

      res.json({ corrections: withNames });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tenant/corrections/action', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'attendance.approve')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const { correctionId, action } = req.body; // 'approve' | 'reject'
      if (!correctionId || !['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'correctionId and a valid action (approve|reject) are required' });
      }

      const list = await db.select().from(schema.attendanceCorrections).where(eq(schema.attendanceCorrections.id, correctionId));
      if (list.length === 0) {
        return res.status(404).json({ error: 'Correction request not found' });
      }
      const correction = list[0];

      if (correction.tenantId !== req.user.tenantId) {
        return res.status(403).json({ error: 'Access denied: This request does not belong to your organization.' });
      }
      if (correction.status !== 'pending') {
        return res.status(400).json({ error: 'This request has already been resolved.' });
      }

      await db.update(schema.attendanceCorrections)
        .set({
          status: action === 'approve' ? 'approved' : 'rejected',
          reviewedByUserId: req.user.userId,
          reviewedAt: new Date()
        })
        .where(eq(schema.attendanceCorrections.id, correctionId));

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: action === 'approve' ? 'CORRECTION_APPROVED' : 'CORRECTION_REJECTED',
        details: { correctionId, subjectUserId: correction.userId }
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Late check-ins awaiting manager approval (see /api/attendance's
  // pendingApproval logic). Same shape/gating as /api/tenant/corrections.
  app.get('/api/tenant/attendance/pending', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'attendance.approve')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const list = await db.select().from(schema.attendanceLogs)
        .where(
          and(
            eq(schema.attendanceLogs.tenantId, req.user.tenantId),
            eq(schema.attendanceLogs.status, 'pending')
          )
        )
        .orderBy(desc(schema.attendanceLogs.createdAt));

      const withNames = await Promise.all(list.map(async (l: any) => {
        const u = await db.select().from(schema.users).where(eq(schema.users.id, l.userId));
        return { ...l, userName: u[0]?.name || 'Unknown', userRole: u[0]?.role || '' };
      }));

      res.json({ logs: withNames });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tenant/attendance/action', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'attendance.approve')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const { logId, action } = req.body; // 'approve' | 'reject'
      if (!logId || !['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'logId and a valid action (approve|reject) are required' });
      }

      const list = await db.select().from(schema.attendanceLogs).where(eq(schema.attendanceLogs.id, logId));
      if (list.length === 0) {
        return res.status(404).json({ error: 'Attendance log not found' });
      }
      const log = list[0];

      if (log.tenantId !== req.user.tenantId) {
        return res.status(403).json({ error: 'Access denied: This request does not belong to your organization.' });
      }
      if (log.status !== 'pending') {
        return res.status(400).json({ error: 'This request has already been resolved.' });
      }

      const employeeList = await db.select().from(schema.users).where(eq(schema.users.id, log.userId));
      const employee = employeeList[0];

      // Reject marks the day absent — this row was never finalized as
      // 'approved', so updating it in place here doesn't touch an audit
      // trail the way editing an already-approved log would (that's what
      // attendanceCorrections is for instead).
      await db.update(schema.attendanceLogs)
        .set(
          action === 'approve'
            ? { status: 'approved' }
            : { status: 'rejected', type: 'absent' }
        )
        .where(eq(schema.attendanceLogs.id, logId));

      const isWfh = log.attendanceMode === 'wfh';
      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: action === 'approve'
          ? (isWfh ? 'WFH_APPROVED' : 'MANAGER_APPROVED')
          : (isWfh ? 'WFH_REJECTED' : 'LATE_ARRIVAL_REJECTED'),
        details: { logId, subjectUserId: log.userId }
      });

      if (employee) {
        if (isWfh) {
          await sendWfhDecisionEmail(
            employee.email,
            employee.name,
            new Date(log.createdAt as any).toLocaleDateString(),
            action === 'approve' ? 'approved' : 'rejected'
          );
        } else {
          await sendLateArrivalDecisionEmail(
            employee.email,
            employee.name,
            new Date(log.createdAt as any).toLocaleDateString(),
            action === 'approve' ? 'approved' : 'rejected'
          );
        }
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get Tenant Config
  app.get('/api/tenant/config', authenticate, async (req: any, res: any) => {
    try {
      const tenant = await db.select().from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId));
      if (tenant.length === 0) {
        return res.status(404).json({ error: 'Tenant config not found' });
      }
      res.json({ tenant: tenant[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update Tenant Config (Policy configuration — geofence, network, shift
  // timings, break budget, etc.). This is intentionally NOT gated by the
  // delegable 'settings.edit' privilege: policy-setting is a strategic
  // decision that only the tenant admin account itself can make. HR/GM/
  // Manager can still be granted 'settings.edit' to approve day-to-day
  // device-change requests (see /api/tenant/device-requests/action above),
  // but they can never change the underlying policies those approvals are
  // judged against.
  app.post('/api/tenant/config/update', authenticate, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'tenant_admin') {
        return res.status(403).json({ error: 'Access denied: Only the tenant admin can change organization policies.' });
      }
      const {
        wifiSsid, officeIp, wifiCheckEnabled, lat, lng, radius, shiftStart, shiftEnd, gracePeriodMins, halfDayMins, dailyBreakBudgetMins, weekendConfig, minAttendancePercent,
        wfhEnabled, wfhAllowedRoles, wfhMaxDaysPerMonth, wfhAllowedWeekdays, wfhRadiusMeters, wfhApprovalRequired, wfhRequireReason, wfhLateLoginGraceMins,
      } = req.body;

      const updates: any = {};
      if (wifiSsid !== undefined) updates.wifiSsid = wifiSsid;
      if (officeIp !== undefined) updates.officeIp = officeIp;
      if (wifiCheckEnabled !== undefined) updates.wifiCheckEnabled = !!wifiCheckEnabled;
      if (lat !== undefined && lat !== '') updates.locationLat = parseFloat(lat);
      if (lng !== undefined && lng !== '') updates.locationLng = parseFloat(lng);
      if (radius !== undefined && radius !== '') updates.locationRadiusMeters = parseInt(radius);
      if (shiftStart !== undefined && shiftStart !== '') updates.shiftStart = shiftStart;
      if (shiftEnd !== undefined && shiftEnd !== '') updates.shiftEnd = shiftEnd;
      if (gracePeriodMins !== undefined && gracePeriodMins !== '') updates.gracePeriodMins = parseInt(gracePeriodMins);
      if (halfDayMins !== undefined && halfDayMins !== '') updates.halfDayMins = parseInt(halfDayMins);
      if (dailyBreakBudgetMins !== undefined && dailyBreakBudgetMins !== '') updates.dailyBreakBudgetMins = parseInt(dailyBreakBudgetMins);
      if (minAttendancePercent !== undefined && minAttendancePercent !== '') updates.minAttendancePercent = Math.min(100, Math.max(0, parseInt(minAttendancePercent)));
      if (Array.isArray(weekendConfig)) updates.weekendConfig = weekendConfig;

      // --- Work From Home (WFH) policy ---
      if (wfhEnabled !== undefined) updates.wfhEnabled = !!wfhEnabled;
      if (Array.isArray(wfhAllowedRoles)) updates.wfhAllowedRoles = wfhAllowedRoles;
      if (wfhMaxDaysPerMonth !== undefined) updates.wfhMaxDaysPerMonth = wfhMaxDaysPerMonth === '' || wfhMaxDaysPerMonth === null ? null : parseInt(wfhMaxDaysPerMonth);
      if (Array.isArray(wfhAllowedWeekdays)) updates.wfhAllowedWeekdays = wfhAllowedWeekdays;
      if (wfhRadiusMeters !== undefined && wfhRadiusMeters !== '') updates.wfhRadiusMeters = parseInt(wfhRadiusMeters);
      if (wfhApprovalRequired !== undefined) updates.wfhApprovalRequired = !!wfhApprovalRequired;
      if (wfhRequireReason !== undefined) updates.wfhRequireReason = !!wfhRequireReason;
      if (wfhLateLoginGraceMins !== undefined) updates.wfhLateLoginGraceMins = wfhLateLoginGraceMins === '' || wfhLateLoginGraceMins === null ? null : parseInt(wfhLateLoginGraceMins);

      await db.update(schema.tenants)
        .set(updates)
        .where(eq(schema.tenants.id, req.user.tenantId));

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // KYC FACE ENROLLMENT: guided per-action capture (look_center, turn_left,
  // turn_right, look_up, look_down, smile, open_mouth, blink). Each action
  // must actually be detected in its own burst — this is the same
  // pose/EAR/MAR geometry the daily challenge is verified against, so
  // enrollment can't be satisfied by 8 copies of the same neutral frame.
  app.post('/api/kyc', authenticate, async (req: any, res: any) => {
    try {
      const { actions, deviceId } = req.body;
      if (!actions || typeof actions !== 'object' || !deviceId) {
        return res.status(400).json({ error: 'actions (a burst of photos per guided pose) and deviceId are required' });
      }

      const missing = KYC_ACTIONS.filter(a => !Array.isArray(actions[a]) || actions[a].length === 0);
      if (missing.length > 0) {
        return res.status(400).json({ error: `Missing capture for: ${missing.join(', ')}`, missingActions: missing });
      }

      // SECURITY: always enroll biometrics for the authenticated caller
      // (req.user, derived from the verified JWT) — never for a uid taken
      // from the request body. Trusting a client-supplied uid here would let
      // any logged-in user overwrite another employee's face embeddings and
      // registered device, i.e. impersonate them at every future check-in.
      const usersList = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
      if (usersList.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      const user = usersList[0];

      // All actual face detection/embedding/pose extraction happens in the
      // Python face service — this Node process never runs an ML model
      // itself. See services/face-service/README.md.
      let enrollResult: any;
      try {
        enrollResult = await callFaceService('/enroll', { actions });
      } catch (faceErr: any) {
        return res.status(503).json({ error: `Face verification service unavailable: ${faceErr.message}` });
      }

      if (Array.isArray(enrollResult.failedActions) && enrollResult.failedActions.length > 0) {
        return res.status(422).json({
          error: `We couldn't confirm: ${enrollResult.failedActions.join(', ')}. Please redo ${enrollResult.failedActions.length === 1 ? 'that step' : 'those steps'} with good lighting, looking directly at the camera.`,
          failedActions: enrollResult.failedActions
        });
      }

      await db.update(schema.users)
        .set({
          faceEmbeddings: enrollResult.embeddings,
          kycActionLog: enrollResult.actionLog,
          registeredDeviceId: deviceId,
          isKycCompleted: true,
          deviceApprovalPending: false
        })
        .where(eq(schema.users.id, user.id));

      // Return fresh token with updated KYC status
      const updatedUser = {
        id: user.id,
        uid: user.uid,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        isKycCompleted: true
      };
      const token = signToken(updatedUser);

      res.json({ success: true, token, user: updatedUser });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Liveness Verification Challenge Endpoint — issues a fresh random subset
  // of actions AND remembers it server-side (keyed by user) so /verify-face
  // below has something authoritative to check the capture burst against.
  app.get('/api/attendance/challenge', authenticate, (req: any, res: any) => {
    const temp = [...DAILY_CHALLENGE_ACTIONS];
    const selected: string[] = [];
    for (let i = 0; i < 3; i++) {
      const idx = Math.floor(Math.random() * temp.length);
      selected.push(temp.splice(idx, 1)[0]);
    }
    pendingChallenges.set(req.user.userId, { actions: selected, issuedAt: Date.now() });
    res.json({ challenge: selected });
  });

  // Where is the employee in today's attendance cycle? Drives the frontend's
  // gating: hide/show the camera flow, Break Management, and the "already
  // completed" locked state. A 'pending' check-in (late arrival awaiting
  // manager review) still counts as checked_in — the employee isn't blocked
  // from working while it's under review.
  app.get('/api/attendance/today', authenticate, async (req: any, res: any) => {
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const latest = await db.select()
        .from(schema.attendanceLogs)
        .where(
          and(
            eq(schema.attendanceLogs.userId, req.user.userId),
            sql`status IN ('approved', 'pending')`,
            sql`created_at >= ${todayStart}`
          )
        )
        .orderBy(desc(schema.attendanceLogs.id))
        .limit(1);

      if (latest.length === 0) {
        return res.json({ state: 'not_started', pending: false, log: null });
      }

      const log = latest[0];
      if (log.type === 'check_out') {
        return res.json({ state: 'checked_out', pending: false, log });
      }
      return res.json({ state: 'checked_in', pending: log.status === 'pending', log });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Self-service attendance percentage — this month so far, working days
  // only (weekends/holidays excluded). Feeds the "Attendance This Month"
  // stat on Employee Home; the same computeAttendancePercent() helper also
  // drives the daily low-attendance alert cron.
  app.get('/api/attendance/percentage', authenticate, async (req: any, res: any) => {
    try {
      const tenantList = await db.select().from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId || 1));
      if (tenantList.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      const tenant = tenantList[0];
      const result = await computeAttendancePercent(req.user.userId, tenant);
      res.json({ ...result, threshold: tenant.minAttendancePercent ?? 75 });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Read-only attendance history for the logged-in user — deliberately
  // GET-only; there's no corresponding edit/PATCH route, which is what
  // actually enforces "no edit option" on past records.
  app.get('/api/attendance/mine', authenticate, async (req: any, res: any) => {
    try {
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));
      const logs = await db.select()
        .from(schema.attendanceLogs)
        .where(eq(schema.attendanceLogs.userId, req.user.userId))
        .orderBy(desc(schema.attendanceLogs.id))
        .limit(limit);
      res.json({ logs });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // QUICK CHECKOUT — a deliberate simpler/faster alternative to running the
  // full face+GPS+Wi-Fi scan again for check-out. Trades weaker anti-fraud
  // guarantees on the exit side (no re-verification) for a one-tap flow;
  // check-in still goes through the full authoritative /api/attendance path.
  app.post('/api/attendance/checkout', authenticate, async (req: any, res: any) => {
    try {
      const usersList = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
      if (usersList.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      const user = usersList[0];

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const lastActiveToday = await db.select()
        .from(schema.attendanceLogs)
        .where(
          and(
            eq(schema.attendanceLogs.userId, user.id),
            sql`status IN ('approved', 'pending')`,
            sql`created_at >= ${todayStart}`
          )
        )
        .orderBy(desc(schema.attendanceLogs.id))
        .limit(1);

      if (lastActiveToday.length === 0 || lastActiveToday[0].type !== 'check_in') {
        return res.status(400).json({
          error: lastActiveToday.length === 0
            ? 'You need to check in with Scan & Verify first.'
            : 'Attendance already completed for today.'
        });
      }

      const activeBreaks = await db.select().from(schema.breakSessions).where(
        and(
          eq(schema.breakSessions.userId, user.id),
          eq(schema.breakSessions.status, 'active')
        )
      );
      if (activeBreaks.length > 0) {
        return res.status(400).json({ error: "You're currently on break — resume work before checking out." });
      }

      const { clientTimestamp } = req.body;
      const log = await db.insert(schema.attendanceLogs).values({
        userId: user.id,
        tenantId: user.tenantId || 1,
        status: 'approved',
        type: 'check_out',
        clientTimestamp: clientTimestamp ? new Date(clientTimestamp) : new Date(),
        reason: 'Checked out (quick checkout)'
      }).returning();

      await logToAuditLedger({
        tenantId: user.tenantId,
        actorId: user.id,
        actorName: user.name,
        action: 'CHECK_OUT',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { logId: log[0].id, quickCheckout: true }
      });

      res.json({ success: true, log: log[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // STEP 1 of 3 — Face liveness/identity check. Verifies the capture burst
  // against the identity embeddings from KYC AND confirms every action in
  // the challenge issued above was actually performed (not just displayed
  // as an on-screen instruction). Does not write an attendance_logs row —
  // on success it mints a short-lived token the later steps/final submit
  // use instead of re-uploading images.
  app.post('/api/attendance/verify-face', authenticate, async (req: any, res: any) => {
    try {
      const { images } = req.body;
      if (!images || !Array.isArray(images) || images.length === 0) {
        return res.status(400).json({ error: 'images (a short camera burst) are required.' });
      }

      const usersList = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
      if (usersList.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      const user = usersList[0];
      if (!user.isKycCompleted) {
        return res.status(400).json({ error: 'KYC registration not completed yet.' });
      }

      const pending = pendingChallenges.get(user.id);
      if (!pending || Date.now() - pending.issuedAt > CHALLENGE_TTL_MS) {
        pendingChallenges.delete(user.id);
        return res.status(400).json({ error: 'Your liveness challenge expired. Please try again.', expired: true });
      }

      let faceResult: any;
      try {
        faceResult = await callFaceService('/verify', { images, challengeActions: pending.actions });
      } catch (faceErr: any) {
        return res.status(503).json({ error: `Face verification service unavailable: ${faceErr.message}` });
      }

      const errors: string[] = [];

      if (!faceResult.faceDetected) {
        errors.push('No face detected. Look directly at the camera with good lighting and try again.');
      }

      // Liveness: landmark micro-movement across the burst. A printed photo /
      // frozen replay scores near 0 (no movement) or ~0.3 (single usable
      // frame); a live person performing the guided actions produces large
      // movement and scores ~1.0. Threshold lowered from 0.8 to 0.6 so a
      // genuine person on a low-framerate device (e.g. a basic Redmi capturing
      // fewer distinct frames, hence smaller measured inter-frame movement)
      // isn't wrongly rejected — a static-photo spoof still lands well below
      // 0.6, and identity match below is the hard anti-impersonation gate
      // regardless.
      const livenessScore = faceResult.faceDetected ? (faceResult.livenessScore ?? 0) : 0;
      const LIVENESS_MIN = 0.6;
      if (faceResult.faceDetected && livenessScore < LIVENESS_MIN) {
        errors.push('Liveness verification failed (possible spoofing attempt).');
      }

      // Challenge-response: how many of the requested actions the face service
      // actually detected in the burst. Previously ALL had to be confirmed;
      // that made a single flaky detection (a blink whose closed-eye frame the
      // camera happened not to capture, a subtle head turn) fail the whole
      // check — exactly the fragility that shows up on cheaper cameras. Now we
      // require a MAJORITY (at least ceil(n/2), and always ≥1): still proves
      // the person is live and responding to on-screen prompts in real time (a
      // photo can perform none), while tolerating one missed detection.
      const confirmedActions = pending.actions.filter(a => faceResult.actionResults?.[a]);
      const unconfirmed = pending.actions.filter(a => !faceResult.actionResults?.[a]);
      const requiredConfirmed = Math.max(1, Math.ceil(pending.actions.length / 2));
      if (faceResult.faceDetected && confirmedActions.length < requiredConfirmed) {
        errors.push(`We couldn't confirm enough of the requested movements (${unconfirmed.map(a => a.replace('_', ' ')).join(', ')}). Please try again, following the on-screen instruction for each step.`);
      }

      let bestSimilarity = -1;
      const enrolledEmbeddings = user.faceEmbeddings as number[][];
      if (faceResult.faceDetected && enrolledEmbeddings && enrolledEmbeddings.length > 0) {
        for (const enrolled of enrolledEmbeddings) {
          const sim = cosineSimilarity(enrolled, faceResult.embedding);
          if (sim > bestSimilarity) bestSimilarity = sim;
        }
      }
      // Identity match — the hard anti-impersonation gate, deliberately NOT
      // relaxed. If enrollment is missing entirely (no embeddings), this stays
      // at -1 and fails, which is correct: you can't verify against nothing.
      const matchThreshold = 0.36; // see services/face-service/README.md — tune per deployment
      const identityEnrolled = !!(enrolledEmbeddings && enrolledEmbeddings.length > 0);
      if (faceResult.faceDetected && !identityEnrolled) {
        errors.push('No enrolled face on file — please complete (or redo) your biometric KYC before checking in.');
      } else if (faceResult.faceDetected && bestSimilarity < matchThreshold) {
        errors.push('Facial biometrics verification failed (identity mismatch).');
      }

      if (errors.length > 0) {
        // Log the full breakdown so a persistent "why does check-in keep
        // failing" can be diagnosed from the server side without guessing —
        // which specific gate failed, and by how much.
        console.warn(`[verify-face] user=${user.id} REJECTED — faceDetected=${faceResult.faceDetected} liveness=${livenessScore.toFixed(3)} (min ${LIVENESS_MIN}) confirmedActions=${confirmedActions.length}/${pending.actions.length} (need ${requiredConfirmed}) bestMatch=${bestSimilarity.toFixed(3)} (min ${matchThreshold}) framesWithFace=${faceResult.framesWithFace}/${faceResult.framesSubmitted}`);
        return res.status(403).json({
          passed: false,
          error: errors.join(' | '),
          diagnostics: {
            liveness: Number(livenessScore.toFixed(3)),
            livenessMin: LIVENESS_MIN,
            actionsConfirmed: confirmedActions.length,
            actionsRequested: pending.actions.length,
            bestMatch: Number(bestSimilarity.toFixed(3)),
            matchMin: matchThreshold,
          },
        });
      }

      // Single-use: this specific challenge has now been satisfied.
      pendingChallenges.delete(user.id);

      const token = signShortLivedToken({
        purpose: 'attendance_face_pass',
        userId: user.id,
        faceMatchScore: bestSimilarity,
        livenessScore,
        challengeRequested: pending.actions,
        challengeVerified: pending.actions.filter(a => faceResult.actionResults?.[a])
      }, FACE_TOKEN_TTL);

      res.json({ passed: true, token, faceMatchScore: bestSimilarity, livenessScore });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  function decodeFacePassToken(req: any): any {
    const decoded = verifyToken(req.body?.token);
    if (!decoded || decoded.purpose !== 'attendance_face_pass' || decoded.userId !== req.user.userId) {
      return null;
    }
    return decoded;
  }

  // STEP 2 of 3 — GPS geofence check (fast-fail preview only; the final
  // submit below re-validates this itself and is the only step that
  // actually records anything).
  app.post('/api/attendance/verify-location', authenticate, async (req: any, res: any) => {
    try {
      const facePass = decodeFacePassToken(req);
      if (!facePass) {
        return res.status(400).json({ error: 'Face verification expired or missing. Please restart.', expired: true });
      }
      const { lat, lng } = req.body;
      if (lat === undefined || lng === undefined) {
        return res.status(400).json({ error: 'lat and lng are required.' });
      }

      const usersList = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
      if (usersList.length === 0) return res.status(404).json({ error: 'User not found' });
      const tenantList = await db.select().from(schema.tenants).where(eq(schema.tenants.id, usersList[0].tenantId));
      if (tenantList.length === 0) return res.status(404).json({ error: 'Tenant registration context not found.' });
      const tenant = tenantList[0];

      if (!tenant.locationLat || !tenant.locationLng) {
        return res.json({ passed: true, distanceMeters: 0 });
      }

      const distance = haversineMeters(lat, lng, tenant.locationLat, tenant.locationLng);
      const radius = tenant.locationRadiusMeters || 100;
      if (distance > radius) {
        return res.status(403).json({ passed: false, error: `GPS Geofence violation: Out of branch radius by ${Math.round(distance - radius)} meters.`, distanceMeters: distance });
      }
      res.json({ passed: true, distanceMeters: distance });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // STEP 3 of 3 — Wi-Fi/public-IP check. Only meaningful (and only shown by
  // the client) when the tenant admin has explicitly enabled it.
  app.post('/api/attendance/verify-network', authenticate, async (req: any, res: any) => {
    try {
      const facePass = decodeFacePassToken(req);
      if (!facePass) {
        return res.status(400).json({ error: 'Face verification expired or missing. Please restart.', expired: true });
      }
      const { simulatedIp } = req.body;

      const usersList = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
      if (usersList.length === 0) return res.status(404).json({ error: 'User not found' });
      const tenantList = await db.select().from(schema.tenants).where(eq(schema.tenants.id, usersList[0].tenantId));
      if (tenantList.length === 0) return res.status(404).json({ error: 'Tenant registration context not found.' });
      const tenant = tenantList[0];

      if (!tenant.wifiCheckEnabled || !tenant.officeIp) {
        return res.json({ passed: true });
      }

      const activeIp = resolveActiveIp(req, simulatedIp);
      if (tenant.officeIp !== activeIp && tenant.officeIp !== '127.0.0.1') {
        return res.status(403).json({ passed: false, error: `Network verification failed: You must connect to the corporate Wi-Fi (Required Public IP: ${tenant.officeIp}, Your IP: ${activeIp}).` });
      }
      res.json({ passed: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // FINAL CHECK-IN SUBMIT — re-validates everything itself (face-pass
  // token, device pinning, clock drift, GPS geofence, Wi-Fi if enabled)
  // before writing the log. The verify-face/verify-location/verify-network
  // endpoints above are fast-fail UX previews only; nothing about pass/fail
  // is ever trusted from the client — this endpoint remains the sole
  // authoritative writer.
  app.post('/api/attendance', authenticate, async (req: any, res: any) => {
    try {
      const { token, deviceId, lat, lng, simulatedIp, clientTimestamp, explanation, mode, wfhReason } = req.body;
      // Defaults to 'office' — omitting `mode` entirely (every pre-existing
      // client does) preserves the exact original behavior below unchanged.
      const attendanceMode: 'office' | 'wfh' = mode === 'wfh' ? 'wfh' : 'office';

      const usersList = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
      if (usersList.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      const user = usersList[0];

      if (!user.isKycCompleted) {
        return res.status(400).json({ error: 'KYC registration not completed yet.' });
      }

      // --- 0. Face-pass token: proves the Face step (identity + liveness +
      // challenge-response) already happened for THIS user, recently. It's
      // signed server-side and expires in minutes — nothing here trusts a
      // client-asserted "I passed the camera step". ---
      const facePass = verifyToken(token);
      if (!facePass || facePass.purpose !== 'attendance_face_pass' || facePass.userId !== user.id) {
        return res.status(400).json({ error: 'Face verification expired or missing. Please restart from the camera step.' });
      }

      // --- 1. Client-Server Clock Drift Check ---
      let clockDriftViolation = false;
      const serverTime = Date.now();
      if (clientTimestamp) {
        const clientTime = new Date(clientTimestamp).getTime();
        if (isNaN(clientTime) || Math.abs(serverTime - clientTime) > 5 * 60 * 1000) {
          clockDriftViolation = true;
        }
      }
      if (clockDriftViolation) {
        await logToAuditLedger({
          tenantId: user.tenantId,
          actorId: user.id,
          actorName: user.name,
          action: 'FRAUD_CLOCK_MANIPULATION',
          ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
          deviceInfo: req.headers['user-agent'] || '',
          details: { clientTimestamp, serverTimestamp: new Date().toISOString() }
        });

        // Get Tenant Admin to escalate
        const admins = await db.select().from(schema.users).where(
          and(
            eq(schema.users.tenantId, user.tenantId || 1),
            eq(schema.users.role, 'tenant_admin')
          )
        );
        if (admins.length > 0) {
          await sendManagerEscalationEmail(
            admins[0].email,
            admins[0].name,
            user.name,
            'Clock Manipulation Attempt',
            `${user.name} attempted to log attendance with a spoofed device time.\nClient Time: ${clientTimestamp}\nServer Time: ${new Date().toISOString()}`
          );
        }

        return res.status(400).json({ error: 'Verification failed: Device clock drift detected. Server timestamp enforcement active.' });
      }

      // --- 2. Device Pinning verification ---
      if (user.registeredDeviceId && user.registeredDeviceId !== deviceId) {
        await logToAuditLedger({
          tenantId: user.tenantId,
          actorId: user.id,
          actorName: user.name,
          action: 'FRAUD_DEVICE_MISMATCH',
          ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
          deviceInfo: req.headers['user-agent'] || '',
          details: { registeredDeviceId: user.registeredDeviceId, attemptedDeviceId: deviceId }
        });
        return res.status(403).json({ error: 'Access denied: Registered device mismatch.' });
      }

      // Fetch Tenant Rules
      const tenantList = await db.select().from(schema.tenants).where(eq(schema.tenants.id, user.tenantId));
      if (tenantList.length === 0) {
        return res.status(404).json({ error: 'Tenant registration context not found.' });
      }
      const tenant = tenantList[0];

      if (tenant.status === 'suspended') {
        return res.status(403).json({ error: 'Your organization\'s access has been suspended. Attendance cannot be logged.' });
      }

      // --- WFH-only policy gates, checked before verification so a
      // disallowed attempt never even reaches the biometric/location steps.
      // None of this runs (or changes anything) for attendanceMode==='office'. ---
      let wfhHomeLocation: any = null;
      if (attendanceMode === 'wfh') {
        const wfhPolicy = extractWfhPolicy(tenant);
        if (!wfhPolicy.wfhEnabled) {
          return res.status(403).json({ error: 'Work From Home is not enabled for your organization.' });
        }
        if (!isRoleAllowedForWfh(user.role, wfhPolicy)) {
          return res.status(403).json({ error: 'Your role is not permitted to work from home.' });
        }
        const weekday = todayWeekdayName();
        if (!wfhPolicy.wfhAllowedWeekdays.includes(weekday)) {
          return res.status(403).json({ error: `Work From Home is not allowed on ${weekday}s.` });
        }
        const monthlyWfhCount = await getMonthlyWfhCheckInCount(user.id);
        if (wfhPolicy.wfhMaxDaysPerMonth !== null && monthlyWfhCount >= wfhPolicy.wfhMaxDaysPerMonth) {
          return res.status(403).json({ error: `Monthly Work From Home quota (${wfhPolicy.wfhMaxDaysPerMonth} days) reached.` });
        }
        wfhHomeLocation = await getActiveHomeLocation(user.id);
        if (!wfhHomeLocation) {
          return res.status(400).json({ error: 'No home location registered yet. Please register your home location first.', needsHomeRegistration: true });
        }
        if (wfhPolicy.wfhRequireReason && !wfhReason) {
          return res.status(400).json({ error: 'Please provide a reason for working from home.', requiresWfhReason: true });
        }
      }

      let verificationErrors: string[] = [];
      let fraudType = '';
      let wfhDistanceMeters: number | null = null;

      // --- 3. Face verification: identity match, liveness, and
      // challenge-response were already computed by /verify-face against
      // the raw camera burst; the signed token is what carries those
      // results here, authoritatively — nothing here is trusted from the
      // client beyond what the token itself asserts. ---
      const bestSimilarity: number = facePass.faceMatchScore;
      const livenessScore: number = facePass.livenessScore;

      const matchThreshold = 0.36; // see services/face-service/README.md — tune per deployment
      if (bestSimilarity < matchThreshold) {
        verificationErrors.push('Facial biometrics verification failed (Identity mismatch).');
        fraudType = 'FRAUD_BIOMETRICS_FAILED';
      }
      if (livenessScore < 0.8) {
        verificationErrors.push('Liveness verification failed (Possible spoofing attempt).');
        if (!fraudType) fraudType = 'FRAUD_LIVENESS_FAILED';
      }

      // --- 4. Location checking: office geofence vs. home-location distance
      // — mutually exclusive by mode. WFH never checks the office geofence;
      // office never checks a home location. ---
      if (attendanceMode === 'wfh') {
        const distanceCheck = evaluateWfhLocation({
          currentLat: lat,
          currentLng: lng,
          homeLat: wfhHomeLocation.latitude,
          homeLng: wfhHomeLocation.longitude,
          radiusMeters: extractWfhPolicy(tenant).wfhRadiusMeters,
        });
        wfhDistanceMeters = distanceCheck.distanceMeters;
        if (!distanceCheck.passed) {
          verificationErrors.push(distanceCheck.error!);
          if (!fraudType) fraudType = 'FRAUD_HOME_LOCATION_MISMATCH';
        }
      } else if (tenant.locationLat && tenant.locationLng) {
        const distance = haversineMeters(lat, lng, tenant.locationLat, tenant.locationLng);
        const radius = tenant.locationRadiusMeters || 100;
        if (distance > radius) {
          verificationErrors.push(`GPS Geofence violation: Out of branch radius by ${Math.round(distance - radius)} meters.`);
          if (!fraudType) fraudType = 'FRAUD_GEOFENCE_BYPASS';
        }
      }

      // --- 5. Wi-Fi IP Network context checking — office only (only if the
      // tenant admin has explicitly turned it on); doesn't apply to Work
      // From Home at all. ---
      if (attendanceMode === 'office' && tenant.wifiCheckEnabled && tenant.officeIp) {
        const activeIp = resolveActiveIp(req, simulatedIp);
        if (tenant.officeIp !== activeIp && tenant.officeIp !== '127.0.0.1') {
          verificationErrors.push(`Network verification failed: You must connect to the corporate Wi-Fi (Required Public IP: ${tenant.officeIp}, Your IP: ${activeIp}).`);
          if (!fraudType) fraudType = 'FRAUD_NETWORK_BYPASS';
        }
      }

      // --- 6. Determine check-in / check-out type ---
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // Includes 'pending' (a late check-in awaiting manager approval) so
      // the toggle and the day-lock below both see it as an active
      // check-in, not as if the day never started.
      const lastActiveToday = await db.select()
        .from(schema.attendanceLogs)
        .where(
          and(
            eq(schema.attendanceLogs.userId, user.id),
            sql`status IN ('approved', 'pending')`,
            sql`created_at >= ${todayStart}`
          )
        )
        .orderBy(desc(schema.attendanceLogs.id))
        .limit(1);

      // Single-shift-per-day lock: once today's check-out has been recorded,
      // no further attendance actions are accepted until the next day.
      if (lastActiveToday.length > 0 && lastActiveToday[0].type === 'check_out') {
        return res.status(400).json({ error: 'Attendance already completed for today. Come back tomorrow.', locked: true });
      }

      let logType = 'check_in';
      if (lastActiveToday.length > 0 && lastActiveToday[0].type === 'check_in') {
        logType = 'check_out';
      }

      const isVerified = verificationErrors.length === 0;
      const status = isVerified ? 'approved' : 'rejected';

      // --- 7. Check for Late Arrival on check-in ---
      let isLate = false;
      const shiftStartStr = tenant.shiftStart || '09:00';
      // WFH can be given its own, separate grace period; falls back to the
      // office gracePeriodMins when unset so tenants that never touch the
      // WFH policy get identical late-arrival behavior either way.
      const gracePeriod = (attendanceMode === 'wfh' && tenant.wfhLateLoginGraceMins != null)
        ? tenant.wfhLateLoginGraceMins
        : (tenant.gracePeriodMins || 15);

      if (isVerified && logType === 'check_in') {
        const [shiftHour, shiftMinute] = shiftStartStr.split(':').map(Number);
        const shiftTime = new Date();
        shiftTime.setHours(shiftHour, shiftMinute, 0, 0);
        const lateThresholdTime = new Date(shiftTime.getTime() + gracePeriod * 60000);

        if (Date.now() > lateThresholdTime.getTime()) {
          isLate = true;
        }
      }

      // A late check-in needs the employee's explanation before it's
      // recorded at all — the frontend shows a one-time textarea and
      // resubmits here with everything it already has, plus `explanation`.
      if (isVerified && isLate && !explanation) {
        return res.status(400).json({
          error: 'Please explain why you are checking in late.',
          requiresExplanation: true
        });
      }

      // Late check-ins are written as 'pending' — a manager/admin with
      // 'attendance.approve' must approve or reject them (see
      // /api/tenant/attendance/*). The employee is NOT blocked from using
      // the app in the meantime; this only affects whether the log is
      // authoritative yet. WFH additionally goes pending whenever the
      // tenant's wfhApprovalRequired policy is on, regardless of lateness.
      const wfhNeedsApproval = attendanceMode === 'wfh' && logType === 'check_in' && tenant.wfhApprovalRequired !== false;
      const pendingApproval = isVerified && (isLate || wfhNeedsApproval);

      let reason = isVerified
        ? (attendanceMode === 'wfh'
            ? (pendingApproval ? 'Work From Home — pending manager approval' : 'Work From Home — verified successfully')
            : (isLate ? `Verified successfully (Late Arrival — pending manager approval)` : `Verified successfully (Biometric, GPS, and Wi-Fi context match)`))
        : verificationErrors.join(' | ');

      const log = await db.insert(schema.attendanceLogs).values({
        userId: user.id,
        tenantId: user.tenantId || 1,
        status: pendingApproval ? 'pending' : status,
        type: logType,
        clientTimestamp: clientTimestamp ? new Date(clientTimestamp) : new Date(),
        faceMatchScore: bestSimilarity,
        livenessScore: livenessScore,
        device: deviceId,
        locationLat: lat,
        locationLng: lng,
        reason: reason,
        explanation: (pendingApproval && isLate) ? explanation : null,
        challenge: { requested: facePass.challengeRequested || [], verified: facePass.challengeVerified || [] },
        attendanceMode,
        homeLat: attendanceMode === 'wfh' ? wfhHomeLocation.latitude : null,
        homeLng: attendanceMode === 'wfh' ? wfhHomeLocation.longitude : null,
        distanceFromHomeMeters: wfhDistanceMeters,
        wfhReason: attendanceMode === 'wfh' ? (wfhReason || null) : null,
      }).returning();

      // Log action to cryptographic ledger
      await logToAuditLedger({
        tenantId: user.tenantId,
        actorId: user.id,
        actorName: user.name,
        action: isVerified
          ? (attendanceMode === 'wfh'
              ? (logType === 'check_in' ? 'WFH_CHECK_IN' : 'WFH_CHECK_OUT')
              : (logType === 'check_in' ? 'CHECK_IN' : 'CHECK_OUT'))
          : fraudType,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: {
          logId: log[0].id,
          status: pendingApproval ? 'pending' : status,
          type: logType,
          attendanceMode,
          isLate,
          pendingApproval,
          biometricSimilarity: bestSimilarity,
          distanceFromHomeMeters: wfhDistanceMeters,
          clientTimestamp,
          errors: verificationErrors
        }
      });

      if (!isVerified) {
        // Send manager escalation email for critical fraud events
        const admins = await db.select().from(schema.users).where(
          and(
            eq(schema.users.tenantId, user.tenantId || 1),
            eq(schema.users.role, 'tenant_admin')
          )
        );
        if (admins.length > 0) {
          await sendManagerEscalationEmail(
            admins[0].email,
            admins[0].name,
            user.name,
            fraudType || 'Attendance Verification Failed',
            `Employee ${user.name} failed attendance verification.\nReason: ${reason}\nIP Address: ${simulatedIp || req.socket.remoteAddress}`
          );
        }
        return res.status(403).json({ error: reason, log: log[0] });
      }

      // A late check-in or a WFH check-in (when approval is required) is
      // pending manager approval — notify whoever holds 'attendance.approve'.
      // The employee is not blocked in the meantime.
      if (pendingApproval) {
        const approvers = await getUsersWithPrivilege(user.tenantId || 1, 'attendance.approve');
        if (attendanceMode === 'wfh') {
          for (const approver of approvers) {
            await sendWfhApprovalRequestEmail(
              approver.email,
              approver.name,
              user.name,
              new Date().toLocaleDateString(),
              wfhReason || '',
              wfhDistanceMeters || 0
            );
          }
        } else {
          const checkInTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          for (const approver of approvers) {
            await sendLateArrivalApprovalRequestEmail(
              approver.email,
              approver.name,
              user.name,
              new Date().toLocaleDateString(),
              checkInTimeStr,
              shiftStartStr,
              explanation
            );
          }
        }
      }

      res.json({ success: true, log: log[0], pendingApproval });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================================
  // WORK FROM HOME (WFH) — additive attendance mode. The actual check-in/
  // check-out write for WFH goes through the SAME /api/attendance handler
  // above (via body.mode === 'wfh') so it reuses face verification, clock-
  // drift checks, device pinning, and audit logging unchanged rather than
  // forking a parallel, less-audited write path. The routes below only
  // cover what's genuinely new: policy eligibility, home-location
  // registration, and the location-change approval workflow.
  // ==========================================================

  async function getMonthlyWfhCheckInCount(userId: number, now: Date = new Date()): Promise<number> {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const rows = await db.select().from(schema.attendanceLogs).where(
      and(
        eq(schema.attendanceLogs.userId, userId),
        eq(schema.attendanceLogs.attendanceMode, 'wfh'),
        eq(schema.attendanceLogs.type, 'check_in'),
        sql`status IN ('approved', 'pending')`,
        sql`created_at >= ${monthStart}`
      )
    );
    return rows.length;
  }

  async function getActiveHomeLocation(userId: number) {
    const rows = await db.select().from(schema.employeeHomeLocations).where(
      and(
        eq(schema.employeeHomeLocations.userId, userId),
        eq(schema.employeeHomeLocations.status, 'active')
      )
    );
    return rows[0] || null;
  }

  // Pre-flight check the frontend calls before offering the WFH option /
  // starting the camera step — does NOT require a GPS fix.
  app.get('/api/attendance/wfh/eligibility', authenticate, async (req: any, res: any) => {
    try {
      const userRec = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
      if (userRec.length === 0) return res.status(404).json({ error: 'User not found' });
      const user = userRec[0];

      const tenantRec = await db.select().from(schema.tenants).where(eq(schema.tenants.id, user.tenantId || 1));
      if (tenantRec.length === 0) return res.status(404).json({ error: 'Tenant registration context not found.' });
      const policy = extractWfhPolicy(tenantRec[0]);

      const homeLocation = await getActiveHomeLocation(user.id);
      const wfhCheckInsThisMonth = await getMonthlyWfhCheckInCount(user.id);

      const result = evaluateWfhEligibility({
        policy,
        role: user.role,
        hasHomeLocation: !!homeLocation,
        isKycCompleted: !!user.isKycCompleted,
        wfhCheckInsThisMonth,
      });

      res.json({
        ...result,
        policy: {
          radiusMeters: policy.wfhRadiusMeters,
          requireReason: policy.wfhRequireReason,
          allowedWeekdays: policy.wfhAllowedWeekdays,
          maxDaysPerMonth: policy.wfhMaxDaysPerMonth,
          wfhCheckInsThisMonth,
        },
        homeLocation: homeLocation ? { latitude: homeLocation.latitude, longitude: homeLocation.longitude, address: homeLocation.address } : null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/attendance/wfh/home-location', authenticate, async (req: any, res: any) => {
    try {
      const homeLocation = await getActiveHomeLocation(req.user.userId);
      res.json({ homeLocation });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // First-time home location registration. Only allowed if the employee has
  // no active registration yet — after that, changes go through the
  // request/approval workflow below so employees can't silently relocate
  // their "home" whenever convenient.
  app.post('/api/attendance/wfh/register-home', authenticate, async (req: any, res: any) => {
    try {
      const { lat, lng, accuracy } = req.body;
      if (lat === undefined || lng === undefined) {
        return res.status(400).json({ error: 'lat and lng are required.' });
      }

      const userRec = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
      if (userRec.length === 0) return res.status(404).json({ error: 'User not found' });
      const user = userRec[0];

      const existing = await getActiveHomeLocation(user.id);
      if (existing) {
        return res.status(400).json({ error: 'A home location is already registered. Submit a location change request instead.' });
      }

      const geocoded = await reverseGeocode(lat, lng);

      const inserted = await db.insert(schema.employeeHomeLocations).values({
        userId: user.id,
        tenantId: user.tenantId || 1,
        latitude: lat,
        longitude: lng,
        accuracy,
        address: geocoded?.address || null,
        status: 'active',
      }).returning();

      await logToAuditLedger({
        tenantId: user.tenantId,
        actorId: user.id,
        actorName: user.name,
        action: 'WFH_HOME_REGISTERED',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { homeLocationId: inserted[0].id, lat, lng, accuracy }
      });

      res.json({ homeLocation: inserted[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Employee-initiated request to change their registered home location —
  // does NOT change anything until a manager/admin approves it below.
  app.post('/api/attendance/wfh/location-change-request', authenticate, async (req: any, res: any) => {
    try {
      const { lat, lng, accuracy, reason } = req.body;
      if (lat === undefined || lng === undefined) {
        return res.status(400).json({ error: 'lat and lng are required.' });
      }

      const userRec = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
      if (userRec.length === 0) return res.status(404).json({ error: 'User not found' });
      const user = userRec[0];

      const geocoded = await reverseGeocode(lat, lng);

      const inserted = await db.insert(schema.wfhLocationChangeRequests).values({
        userId: user.id,
        tenantId: user.tenantId || 1,
        newLatitude: lat,
        newLongitude: lng,
        newAccuracy: accuracy,
        newAddress: geocoded?.address || null,
        reason,
        status: 'pending',
      }).returning();

      await logToAuditLedger({
        tenantId: user.tenantId,
        actorId: user.id,
        actorName: user.name,
        action: 'WFH_LOCATION_CHANGE_REQUESTED',
        details: { requestId: inserted[0].id, lat, lng }
      });

      const approvers = await getUsersWithPrivilege(user.tenantId || 1, 'attendance.approve');
      for (const approver of approvers) {
        await sendWfhLocationChangeRequestEmail(approver.email, approver.name, user.name, geocoded?.address || `${lat}, ${lng}`, reason || '');
      }

      res.json({ request: inserted[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/attendance/wfh/location-change-requests/mine', authenticate, async (req: any, res: any) => {
    try {
      const list = await db.select().from(schema.wfhLocationChangeRequests)
        .where(eq(schema.wfhLocationChangeRequests.userId, req.user.userId))
        .orderBy(desc(schema.wfhLocationChangeRequests.createdAt));
      res.json({ requests: list });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Approver's queue — same authorization convention as
  // /api/tenant/corrections and /api/tenant/attendance/pending above.
  app.get('/api/tenant/wfh/location-change-requests', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'attendance.approve')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const list = await db.select().from(schema.wfhLocationChangeRequests)
        .where(
          and(
            eq(schema.wfhLocationChangeRequests.tenantId, req.user.tenantId),
            eq(schema.wfhLocationChangeRequests.status, 'pending')
          )
        )
        .orderBy(desc(schema.wfhLocationChangeRequests.createdAt));

      const withNames = await Promise.all(list.map(async (r: any) => {
        const u = await db.select().from(schema.users).where(eq(schema.users.id, r.userId));
        return { ...r, userName: u[0]?.name || 'Unknown', userRole: u[0]?.role || '' };
      }));

      res.json({ requests: withNames });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tenant/wfh/location-change-requests/action', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'attendance.approve')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const { requestId, action } = req.body; // 'approve' | 'reject'
      if (!requestId || !['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'requestId and a valid action (approve|reject) are required' });
      }

      const list = await db.select().from(schema.wfhLocationChangeRequests).where(eq(schema.wfhLocationChangeRequests.id, requestId));
      if (list.length === 0) return res.status(404).json({ error: 'Request not found' });
      const changeRequest = list[0];

      if (changeRequest.tenantId !== req.user.tenantId) {
        return res.status(403).json({ error: 'Access denied: This request does not belong to your organization.' });
      }
      if (changeRequest.status !== 'pending') {
        return res.status(400).json({ error: 'This request has already been resolved.' });
      }

      await db.update(schema.wfhLocationChangeRequests)
        .set({ status: action === 'approve' ? 'approved' : 'rejected', reviewedByUserId: req.user.userId, reviewedAt: new Date() })
        .where(eq(schema.wfhLocationChangeRequests.id, requestId));

      if (action === 'approve') {
        const existing = await getActiveHomeLocation(changeRequest.userId);
        if (existing) {
          await db.update(schema.employeeHomeLocations).set({ status: 'superseded' }).where(eq(schema.employeeHomeLocations.id, existing.id));
        }
        await db.insert(schema.employeeHomeLocations).values({
          userId: changeRequest.userId,
          tenantId: changeRequest.tenantId,
          latitude: changeRequest.newLatitude,
          longitude: changeRequest.newLongitude,
          accuracy: changeRequest.newAccuracy,
          address: changeRequest.newAddress,
          status: 'active',
        });
      }

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: action === 'approve' ? 'WFH_LOCATION_CHANGE_APPROVED' : 'WFH_LOCATION_CHANGE_REJECTED',
        details: { requestId, subjectUserId: changeRequest.userId }
      });

      const employeeList = await db.select().from(schema.users).where(eq(schema.users.id, changeRequest.userId));
      if (employeeList[0]) {
        await sendWfhLocationChangeDecisionEmail(employeeList[0].email, employeeList[0].name, action === 'approve' ? 'approved' : 'rejected');
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Dashboard/report widgets — reuses 'reports.view', the same privilege
  // already gating the audit ledger view.
  app.get('/api/tenant/wfh/stats', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'reports.view')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const tenantId = req.user.tenantId;
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const last30 = new Date();
      last30.setDate(last30.getDate() - 30);

      const allLogsRecent = await db.select().from(schema.attendanceLogs).where(
        and(
          eq(schema.attendanceLogs.tenantId, tenantId),
          eq(schema.attendanceLogs.type, 'check_in'),
          sql`status IN ('approved', 'pending')`,
          sql`created_at >= ${last30}`
        )
      );

      const todayWfhCount = allLogsRecent.filter((l: any) => l.attendanceMode === 'wfh' && new Date(l.createdAt) >= todayStart).length;
      const monthlyWfhCount = allLogsRecent.filter((l: any) => l.attendanceMode === 'wfh' && new Date(l.createdAt) >= monthStart).length;
      const officeCount30d = allLogsRecent.filter((l: any) => l.attendanceMode !== 'wfh').length;
      const wfhCount30d = allLogsRecent.filter((l: any) => l.attendanceMode === 'wfh').length;

      const pendingWfh = await db.select().from(schema.attendanceLogs).where(
        and(
          eq(schema.attendanceLogs.tenantId, tenantId),
          eq(schema.attendanceLogs.attendanceMode, 'wfh'),
          eq(schema.attendanceLogs.status, 'pending')
        )
      );
      const pendingLocationRequests = await db.select().from(schema.wfhLocationChangeRequests).where(
        and(
          eq(schema.wfhLocationChangeRequests.tenantId, tenantId),
          eq(schema.wfhLocationChangeRequests.status, 'pending')
        )
      );

      // Role-wise breakdown of this month's WFH check-ins (no per-employee
      // department field exists in this schema, so role is the finest
      // dimension available to break this down by).
      const wfhThisMonthLogs = allLogsRecent.filter((l: any) => l.attendanceMode === 'wfh' && new Date(l.createdAt) >= monthStart);
      const roleWiseCounts: Record<string, number> = {};
      const wfhUserIds = [...new Set(wfhThisMonthLogs.map((l: any) => l.userId as number))] as number[];
      const wfhUsers = wfhUserIds.length > 0
        ? await db.select().from(schema.users).where(inArray(schema.users.id, wfhUserIds))
        : [];
      const wfhUserRoleById = new Map<number, string>(wfhUsers.map((u: any) => [u.id, u.role]));
      for (const log of wfhThisMonthLogs) {
        const role: string = wfhUserRoleById.get(log.userId) || 'unknown';
        roleWiseCounts[role] = (roleWiseCounts[role] || 0) + 1;
      }

      res.json({
        todayWfhCount,
        monthlyWfhCount,
        pendingWfhApprovals: pendingWfh.length,
        pendingLocationChangeRequests: pendingLocationRequests.length,
        officeVsWfh30d: { office: officeCount30d, wfh: wfhCount30d },
        roleWiseWfhThisMonth: roleWiseCounts,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Per-employee, per-day WFH ledger — unlike /api/tenant/wfh/stats above
  // (aggregate counts only), this returns the actual rows: who worked from
  // home, on what day, with what status/reason/distance-from-home. Feeds
  // the admin WFH Ledger tab's DataTable (client-side search/sort/paginate
  // over this capped list — same convention as QR history/logs below).
  // Delegable independent of role via WFH_PERMISSIONS.VIEW_LOGS, same
  // pattern as QR_PERMISSIONS.VIEW_LOGS.
  app.get('/api/tenant/wfh/ledger', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, WFH_PERMISSIONS.VIEW_LOGS)) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const tenantId = req.user.tenantId;
      const last90 = new Date();
      last90.setDate(last90.getDate() - 90);

      const logs = await db.select().from(schema.attendanceLogs)
        .where(
          and(
            eq(schema.attendanceLogs.tenantId, tenantId),
            eq(schema.attendanceLogs.attendanceMode, 'wfh'),
            eq(schema.attendanceLogs.type, 'check_in'),
            sql`created_at >= ${last90}`
          )
        )
        .orderBy(desc(schema.attendanceLogs.createdAt))
        .limit(500);

      const userIds = [...new Set(logs.map((l: any) => l.userId as number))] as number[];
      const users = userIds.length > 0
        ? await db.select().from(schema.users).where(inArray(schema.users.id, userIds))
        : [];
      const userById = new Map<number, any>(users.map((u: any) => [u.id, u]));

      const ledger = logs.map((l: any) => {
        const u = userById.get(l.userId);
        return {
          id: l.id,
          userId: l.userId,
          userName: u?.name || 'Unknown',
          role: u?.role || 'unknown',
          date: l.createdAt,
          checkInTime: l.createdAt,
          status: l.status,
          wfhReason: l.wfhReason || '',
          distanceFromHomeMeters: l.distanceFromHomeMeters,
        };
      });

      res.json({ ledger });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Narrow, additive capability mirroring /api/tenant/users/:id/qr-access
  // exactly (see that route's comment for the full rationale) — a separate
  // endpoint rather than editing the working QR one, scoped to exactly the
  // WFH_PERMISSIONS values, so an already-hired employee can be granted WFH
  // ledger visibility without disturbing any other privilege they hold.
  app.post('/api/tenant/users/:id/wfh-access', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'employee.create')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const targetId = parseInt(req.params.id, 10);
      const { permissions } = req.body; // string[] — the full desired set of WFH permissions that should be ON
      if (!Array.isArray(permissions)) {
        return res.status(400).json({ error: 'permissions (array) is required' });
      }
      const wfhPermissionValues: string[] = Object.values(WFH_PERMISSIONS);
      const requested = permissions.filter((p: string) => wfhPermissionValues.includes(p));

      const requesterPrivileges = await getEffectivePrivileges(req.user);
      const grantable = requesterPrivileges === 'ALL' ? requested : requested.filter((p: string) => requesterPrivileges.includes(p));

      const targetList = await db.select().from(schema.users).where(eq(schema.users.id, targetId));
      if (targetList.length === 0) return res.status(404).json({ error: 'User not found' });
      const target = targetList[0];
      if (target.tenantId !== req.user.tenantId) {
        return res.status(403).json({ error: 'Access denied: This user does not belong to your organization.' });
      }

      const existingPrivileges: string[] = Array.isArray(target.privileges) ? (target.privileges as string[]) : [];
      const withoutWfh = existingPrivileges.filter((p: string) => !wfhPermissionValues.includes(p));
      const finalPrivileges = Array.from(new Set([...withoutWfh, ...grantable]));

      await db.update(schema.users).set({ privileges: finalPrivileges }).where(eq(schema.users.id, targetId));

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'WFH_ACCESS_UPDATED',
        details: { subjectUserId: targetId, permissions: grantable }
      });

      res.json({ success: true, privileges: finalPrivileges });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================================
  // DYNAMIC QR ATTENDANCE — additive attendance mode. A privileged user
  // (gated purely by permission strings, never a hardcoded role name — see
  // QR_PERMISSIONS in qr.ts) displays a rotating QR code; any clock-in-
  // capable employee scans it with their own device and goes through the
  // same kind of face/GPS/Wi-Fi verification the office flow already uses,
  // as an independently configurable per-tenant policy. Writes land in the
  // SAME attendance_logs table (attendanceMode: 'qr') so existing reports/
  // dashboards/exports keep working unchanged. Deliberately a standalone
  // endpoint (POST /api/attendance/mark-from-qr) rather than a third branch
  // on the existing /api/attendance handler: that handler's face-pass
  // token is currently an unconditional precondition (checked before any
  // mode branching), and QR's face requirement is policy-conditional —
  // restructuring that precondition would risk the already-shipped office
  // and WFH paths for a feature that doesn't need to share that handler's
  // day-lock/late-arrival code (duplicated below in full, deliberately, per
  // "do changes to existing things only if necessary").
  // ==========================================================

  function generateQrNonce(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  // The DB row (checked via evaluateQrScan/shouldRotateQrToken) is the
  // authoritative expiry — this JWT's own expiry is just a generous outer
  // bound so a long-stale, already-rotated-past token can't be replayed
  // indefinitely even if the DB check were somehow bypassed.
  function signQrToken(session: { id: number; tenantId: number; rotationSeconds: number }, nonce: string): string {
    return signShortLivedToken({ purpose: QR_TOKEN_PURPOSE, sessionId: session.id, tenantId: session.tenantId, nonce, v: 1 }, `${session.rotationSeconds + 60}s`);
  }

  // The single place both GET /api/qr/current and POST /api/qr/session/start
  // go through, so "rotate on expiry OR on use, whichever is first" (see
  // qr.ts shouldRotateQrToken) is enforced exactly once, consistently.
  async function getOrRotateQrToken(session: any): Promise<{ session: any; token: string }> {
    if (!shouldRotateQrToken(session)) {
      return { session, token: signQrToken(session, session.currentNonce) };
    }
    const nonce = generateQrNonce();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + session.rotationSeconds * 1000);
    await db.update(schema.qrSessions).set({
      currentNonce: nonce,
      currentTokenIssuedAt: issuedAt,
      currentTokenExpiresAt: expiresAt,
      currentNonceUsed: false,
    }).where(eq(schema.qrSessions.id, session.id));
    const updated = { ...session, currentNonce: nonce, currentTokenIssuedAt: issuedAt, currentTokenExpiresAt: expiresAt, currentNonceUsed: false };
    return { session: updated, token: signQrToken(updated, nonce) };
  }

  // Verifies signature + expiry + session state, THEN atomically claims the
  // nonce via a conditional UPDATE (only succeeds if nobody else has
  // consumed this exact nonce between the check and now) — the server-side
  // idempotency the spec asks for, closing the race a plain
  // check-then-update would leave open under concurrent scans of the same
  // still-valid code.
  async function validateAndConsumeQrToken(rawToken: string, expectedTenantId?: number):
    Promise<{ outcome: 'VALID'; session: any } | { outcome: Exclude<ReturnType<typeof evaluateQrScan>, 'VALID'> }> {
    const decoded = verifyToken(rawToken);
    if (!decoded || decoded.purpose !== QR_TOKEN_PURPOSE) return { outcome: 'QR_INVALID' };

    const rows = await db.select().from(schema.qrSessions).where(eq(schema.qrSessions.id, decoded.sessionId));
    const session = rows[0] || null;
    const outcome = evaluateQrScan({ session, tokenNonce: decoded.nonce });
    if (outcome !== 'VALID') return { outcome };
    if (expectedTenantId != null && session.tenantId !== expectedTenantId) return { outcome: 'QR_INVALID' };

    const claimed = await db.update(schema.qrSessions)
      .set({ currentNonceUsed: true })
      .where(and(
        eq(schema.qrSessions.id, session.id),
        eq(schema.qrSessions.currentNonce, decoded.nonce),
        eq(schema.qrSessions.currentNonceUsed, false)
      ))
      .returning();
    if (claimed.length === 0) return { outcome: 'QR_ALREADY_USED' };
    return { outcome: 'VALID', session: claimed[0] };
  }

  async function getQrSessionCounts(sessionId: number) {
    const scans = await db.select().from(schema.qrScans).where(eq(schema.qrScans.qrSessionId, sessionId));
    return {
      scansCount: scans.length,
      successCount: scans.filter((s: any) => s.status === 'success').length,
      failCount: scans.filter((s: any) => s.status === 'failed').length,
      pendingCount: scans.filter((s: any) => s.status === 'pending').length,
    };
  }

  app.post('/api/qr/session/start', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, QR_PERMISSIONS.GENERATE)) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const tenantRec = await db.select().from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId));
      if (tenantRec.length === 0) return res.status(404).json({ error: 'Tenant registration context not found.' });
      const policy = extractQrPolicy(tenantRec[0]);
      if (!policy.qrEnabled) {
        return res.status(403).json({ error: 'QR Attendance is not enabled for your organization.' });
      }

      // One authoritative active session per tenant — if another staff
      // member already started one, hand back that same session/token
      // instead of creating a second, ambiguous one.
      const existing = await db.select().from(schema.qrSessions).where(
        and(eq(schema.qrSessions.tenantId, req.user.tenantId), eq(schema.qrSessions.status, 'active'))
      );
      if (existing.length > 0) {
        const { session, token } = await getOrRotateQrToken(existing[0]);
        const counts = await getQrSessionCounts(session.id);
        return res.json({ session, token, expiresAt: session.currentTokenExpiresAt, ...counts });
      }

      const requestedRotation = (QR_ROTATION_OPTIONS as readonly number[]).includes(req.body?.rotationSeconds) ? req.body.rotationSeconds : policy.rotationSeconds;
      const nonce = generateQrNonce();
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + requestedRotation * 1000);

      const inserted = await db.insert(schema.qrSessions).values({
        tenantId: req.user.tenantId,
        generatedByUserId: req.user.userId,
        status: 'active',
        rotationSeconds: requestedRotation,
        currentNonce: nonce,
        currentTokenIssuedAt: issuedAt,
        currentTokenExpiresAt: expiresAt,
        currentNonceUsed: false,
      }).returning();
      const session = inserted[0];
      const token = signQrToken(session, nonce);

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'QR_SESSION_STARTED',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { sessionId: session.id, rotationSeconds: requestedRotation }
      });

      res.json({ session, token, expiresAt: session.currentTokenExpiresAt, scansCount: 0, successCount: 0, failCount: 0, pendingCount: 0 });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/qr/session/stop', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, QR_PERMISSIONS.CLOSE)) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const { sessionId } = req.body;
      if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

      const rows = await db.select().from(schema.qrSessions).where(eq(schema.qrSessions.id, sessionId));
      if (rows.length === 0) return res.status(404).json({ error: 'Session not found' });
      const session = rows[0];
      if (session.tenantId !== req.user.tenantId) {
        return res.status(403).json({ error: 'Access denied: This session does not belong to your organization.' });
      }

      await db.update(schema.qrSessions).set({ status: 'closed', closedAt: new Date() }).where(eq(schema.qrSessions.id, sessionId));

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'QR_SESSION_STOPPED',
        details: { sessionId }
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/qr/current', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, QR_PERMISSIONS.DISPLAY) && !await hasPrivilege(req.user, QR_PERMISSIONS.GENERATE)) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const rows = await db.select().from(schema.qrSessions).where(
        and(eq(schema.qrSessions.tenantId, req.user.tenantId), eq(schema.qrSessions.status, 'active'))
      );
      if (rows.length === 0) return res.json({ session: null });

      const { session, token } = await getOrRotateQrToken(rows[0]);
      const counts = await getQrSessionCounts(session.id);
      res.json({ session, token, expiresAt: session.currentTokenExpiresAt, ...counts });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // The "scan" step — validates + atomically consumes the QR nonce and
  // hands back a short-lived scan-pass token (same two-step pattern as
  // /api/attendance/verify-face -> /api/attendance). Deliberately gated on
  // "is this a clock-in-capable role", the SAME gate the existing
  // self-service /api/attendance already uses — not a special permission,
  // so QR attendance works for ordinary staff out of the box, the same way
  // self-checkin already does, matching "others can scan and mark
  // attendance" as a default capability rather than something each
  // employee needs individually granted.
  app.post('/api/qr/validate', authenticate, async (req: any, res: any) => {
    try {
      const { token, deviceId } = req.body;
      if (!token) return res.status(400).json({ error: 'token is required' });

      const userRec = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
      if (userRec.length === 0) return res.status(404).json({ error: 'User not found' });
      const user = userRec[0];

      const isClockInRole = user.role !== 'super_admin' && user.role !== 'tenant_admin';
      if (!isClockInRole) {
        return res.status(403).json({ error: 'This role does not mark attendance.' });
      }
      if (!user.isKycCompleted) {
        return res.status(400).json({ error: 'KYC registration not completed yet.' });
      }

      const result = await validateAndConsumeQrToken(token, user.tenantId);
      if (result.outcome !== 'VALID') {
        return res.status(410).json({ error: result.outcome, code: result.outcome });
      }
      const session = result.session;

      const tenantRec = await db.select().from(schema.tenants).where(eq(schema.tenants.id, user.tenantId));
      if (tenantRec.length === 0) return res.status(404).json({ error: 'Tenant registration context not found.' });
      const policy = extractQrPolicy(tenantRec[0]);

      const scanInserted = await db.insert(schema.qrScans).values({
        tenantId: user.tenantId,
        qrSessionId: session.id,
        scannedByUserId: user.id,
        status: 'pending',
        deviceId: deviceId || null,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        userAgent: req.headers['user-agent'] || '',
      }).returning();
      const scan = scanInserted[0];

      const scanPassToken = signShortLivedToken(
        { purpose: QR_SCAN_PASS_PURPOSE, scanId: scan.id, sessionId: session.id, userId: user.id, tenantId: user.tenantId },
        '5m'
      );

      await logToAuditLedger({
        tenantId: user.tenantId,
        actorId: user.id,
        actorName: user.name,
        action: 'QR_SCANNED',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { scanId: scan.id, sessionId: session.id }
      });

      res.json({
        valid: true,
        scanPassToken,
        requiredChecks: { face: policy.requireFace, gps: policy.requireGps, wifi: policy.requireWifi, deviceTrust: policy.requireDeviceTrust },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // The authoritative verification-engine + write. Mirrors the day-lock/
  // late-arrival/audit-logging conventions of the existing /api/attendance
  // handler (see the module comment above for why this is a standalone
  // endpoint rather than a third mode on that one).
  app.post('/api/attendance/mark-from-qr', authenticate, async (req: any, res: any) => {
    try {
      const { scanPassToken, faceToken, lat, lng, simulatedIp, deviceId, clientTimestamp } = req.body;

      const scanPass = verifyToken(scanPassToken);
      if (!scanPass || scanPass.purpose !== QR_SCAN_PASS_PURPOSE || scanPass.userId !== req.user.userId) {
        return res.status(400).json({ error: 'QR scan verification expired or missing. Please scan again.' });
      }

      const userRec = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
      if (userRec.length === 0) return res.status(404).json({ error: 'User not found' });
      const user = userRec[0];

      if (!user.isKycCompleted) {
        return res.status(400).json({ error: 'KYC registration not completed yet.' });
      }

      const scanRecList = await db.select().from(schema.qrScans).where(eq(schema.qrScans.id, scanPass.scanId));
      if (scanRecList.length === 0) return res.status(404).json({ error: 'Scan record not found' });
      const scan = scanRecList[0];
      if (scan.status !== 'pending') {
        return res.status(400).json({ error: 'This scan has already been resolved.' });
      }

      const tenantRec = await db.select().from(schema.tenants).where(eq(schema.tenants.id, user.tenantId));
      if (tenantRec.length === 0) return res.status(404).json({ error: 'Tenant registration context not found.' });
      const tenant = tenantRec[0];
      if (tenant.status === 'suspended') {
        return res.status(403).json({ error: 'Your organization\'s access has been suspended. Attendance cannot be logged.' });
      }
      const policy = extractQrPolicy(tenant);

      // --- Clock drift (same 5-minute tolerance as the office/WFH flow) ---
      if (clientTimestamp) {
        const clientTime = new Date(clientTimestamp).getTime();
        if (isNaN(clientTime) || Math.abs(Date.now() - clientTime) > 5 * 60 * 1000) {
          await db.update(schema.qrScans).set({ status: 'failed', failureReason: 'Device clock drift detected.' }).where(eq(schema.qrScans.id, scan.id));
          await logToAuditLedger({
            tenantId: user.tenantId, actorId: user.id, actorName: user.name, action: 'FRAUD_CLOCK_MANIPULATION',
            ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '', deviceInfo: req.headers['user-agent'] || '',
            details: { scanId: scan.id, clientTimestamp, serverTimestamp: new Date().toISOString() }
          });
          return res.status(400).json({ error: 'Verification failed: Device clock drift detected. Server timestamp enforcement active.' });
        }
      }

      const errors: string[] = [];
      let fraudType = '';
      let facePassedFlag: boolean | null = null;
      let gpsPassedFlag: boolean | null = null;
      let wifiPassedFlag: boolean | null = null;
      let deviceTrustPassedFlag: boolean | null = null;
      let distanceMeters: number | null = null;
      let faceMatchScore: number | null = null;
      let livenessScore: number | null = null;

      // --- Device trust: reuses the exact same registeredDeviceId pinning
      // the office check-in flow already enforces — not a separate device
      // list. Optional per tenant policy. ---
      if (policy.requireDeviceTrust) {
        deviceTrustPassedFlag = !user.registeredDeviceId || user.registeredDeviceId === deviceId;
        if (!deviceTrustPassedFlag) {
          errors.push('Access denied: Registered device mismatch.');
          if (!fraudType) fraudType = 'FRAUD_DEVICE_MISMATCH';
        }
      }

      // --- Face: reuses the face-pass token minted by the existing,
      // UNCHANGED /api/attendance/verify-face endpoint — only required
      // when this tenant's QR policy calls for it. ---
      if (policy.requireFace) {
        const facePass = verifyToken(faceToken);
        if (!facePass || facePass.purpose !== 'attendance_face_pass' || facePass.userId !== user.id) {
          return res.status(400).json({ error: 'Face verification expired or missing. Please restart from the camera step.' });
        }
        faceMatchScore = facePass.faceMatchScore;
        livenessScore = facePass.livenessScore;
        const matchThreshold = 0.36; // see services/face-service/README.md — tune per deployment
        facePassedFlag = faceMatchScore >= matchThreshold && livenessScore >= 0.8;
        if (faceMatchScore < matchThreshold) {
          errors.push('Facial biometrics verification failed (Identity mismatch).');
          if (!fraudType) fraudType = 'FRAUD_BIOMETRICS_FAILED';
        }
        if (livenessScore < 0.8) {
          errors.push('Liveness verification failed (Possible spoofing attempt).');
          if (!fraudType) fraudType = 'FRAUD_LIVENESS_FAILED';
        }
      }

      // --- GPS: same office geofence tenant already configures, with an
      // optional QR-specific radius override. ---
      if (policy.requireGps) {
        if (lat == null || lng == null) {
          return res.status(400).json({ error: 'GPS location is required for this QR check-in policy.' });
        }
        if (tenant.locationLat && tenant.locationLng) {
          const geofence = evaluateQrGeofence({ currentLat: lat, currentLng: lng, officeLat: tenant.locationLat, officeLng: tenant.locationLng, radiusMeters: policy.geofenceRadiusMeters });
          gpsPassedFlag = geofence.passed;
          distanceMeters = geofence.distanceMeters;
          if (!geofence.passed) {
            errors.push(geofence.error!);
            if (!fraudType) fraudType = 'FRAUD_GEOFENCE_BYPASS';
          }
        } else {
          gpsPassedFlag = true; // no office location configured — nothing to check against
        }
      }

      // --- Wi-Fi: same public-IP approximation the office flow uses —
      // browsers cannot read the actual connected SSID/BSSID (see
      // resolveActiveIp and the Corporate Network Locking explanation in
      // the tenant settings UI). ---
      if (policy.requireWifi) {
        if (tenant.officeIp) {
          const activeIp = resolveActiveIp(req, simulatedIp);
          wifiPassedFlag = tenant.officeIp === activeIp || tenant.officeIp === '127.0.0.1';
          if (!wifiPassedFlag) {
            errors.push(`Network verification failed: You must connect to the corporate Wi-Fi (Required Public IP: ${tenant.officeIp}, Your IP: ${activeIp}).`);
            if (!fraudType) fraudType = 'FRAUD_NETWORK_BYPASS';
          }
        } else {
          wifiPassedFlag = true;
        }
      }

      const isVerified = errors.length === 0;

      // --- Day state / late-arrival — mirrors (deliberately duplicated,
      // not shared — see module comment) the existing /api/attendance
      // handler's own logic. ---
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const lastActiveToday = await db.select().from(schema.attendanceLogs).where(
        and(eq(schema.attendanceLogs.userId, user.id), sql`status IN ('approved', 'pending')`, sql`created_at >= ${todayStart}`)
      ).orderBy(desc(schema.attendanceLogs.id)).limit(1);

      if (lastActiveToday.length > 0 && lastActiveToday[0].type === 'check_out') {
        return res.status(400).json({ error: 'Attendance already completed for today. Come back tomorrow.', locked: true });
      }
      let logType = 'check_in';
      if (lastActiveToday.length > 0 && lastActiveToday[0].type === 'check_in') {
        logType = 'check_out';
      }

      let isLate = false;
      const shiftStartStr = tenant.shiftStart || '09:00';
      const gracePeriod = tenant.gracePeriodMins || 15;
      if (isVerified && logType === 'check_in') {
        const [shiftHour, shiftMinute] = shiftStartStr.split(':').map(Number);
        const shiftTime = new Date();
        shiftTime.setHours(shiftHour, shiftMinute, 0, 0);
        if (Date.now() > shiftTime.getTime() + gracePeriod * 60000) isLate = true;
      }

      const status = isVerified ? 'approved' : 'rejected';
      const pendingApproval = isVerified && isLate;
      const reason = isVerified
        ? (pendingApproval ? 'QR Attendance — Late Arrival, pending manager approval' : 'QR Attendance — verified successfully')
        : errors.join(' | ');

      const log = await db.insert(schema.attendanceLogs).values({
        userId: user.id,
        tenantId: user.tenantId || 1,
        status: pendingApproval ? 'pending' : status,
        type: logType,
        clientTimestamp: clientTimestamp ? new Date(clientTimestamp) : new Date(),
        faceMatchScore,
        livenessScore,
        device: deviceId,
        locationLat: lat ?? null,
        locationLng: lng ?? null,
        reason,
        attendanceMode: 'qr',
      }).returning();

      await db.update(schema.qrScans).set({
        status: isVerified ? 'success' : 'failed',
        failureReason: isVerified ? null : reason,
        gpsPassed: gpsPassedFlag,
        wifiPassed: wifiPassedFlag,
        facePassed: facePassedFlag,
        deviceTrustPassed: deviceTrustPassedFlag,
        distanceMeters,
        attendanceLogId: log[0].id,
      }).where(eq(schema.qrScans.id, scan.id));

      await logToAuditLedger({
        tenantId: user.tenantId,
        actorId: user.id,
        actorName: user.name,
        action: isVerified ? (logType === 'check_in' ? 'QR_CHECK_IN' : 'QR_CHECK_OUT') : fraudType,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        deviceInfo: req.headers['user-agent'] || '',
        details: { logId: log[0].id, scanId: scan.id, sessionId: scan.qrSessionId, status: pendingApproval ? 'pending' : status, isLate, distanceMeters, errors }
      });

      if (!isVerified) {
        const admins = await db.select().from(schema.users).where(
          and(eq(schema.users.tenantId, user.tenantId || 1), eq(schema.users.role, 'tenant_admin'))
        );
        if (admins.length > 0) {
          await sendManagerEscalationEmail(
            admins[0].email, admins[0].name, user.name,
            fraudType || 'QR Attendance Verification Failed',
            `Employee ${user.name} failed QR attendance verification.\nReason: ${reason}`
          );
        }
        return res.status(403).json({ error: reason, log: log[0] });
      }

      if (pendingApproval) {
        const checkInTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const approvers = await getUsersWithPrivilege(user.tenantId || 1, 'attendance.approve');
        for (const approver of approvers) {
          await sendLateArrivalApprovalRequestEmail(
            approver.email, approver.name, user.name,
            new Date().toLocaleDateString(), checkInTimeStr, shiftStartStr,
            'Checked in via QR Attendance (late).'
          );
        }
      }

      res.json({ success: true, log: log[0], pendingApproval });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Manual override for a failed/expired scan — e.g. a legitimate employee
  // whose face didn't match due to poor lighting. Deliberately narrow and
  // heavily audited: requires a mandatory reason, only works on this
  // tenant's own scans, and marks both the scan and a NEW attendance_logs
  // row (never silently rewrites the original rejected one, same
  // "corrections don't overwrite history" principle as attendanceCorrections).
  app.post('/api/qr/scans/:id/override', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, QR_PERMISSIONS.OVERRIDE)) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const scanId = parseInt(req.params.id, 10);
      const { reason } = req.body;
      if (!reason || !reason.trim()) {
        return res.status(400).json({ error: 'A reason is required to override a failed QR scan.' });
      }

      const scanList = await db.select().from(schema.qrScans).where(eq(schema.qrScans.id, scanId));
      if (scanList.length === 0) return res.status(404).json({ error: 'Scan not found' });
      const scan = scanList[0];
      if (scan.tenantId !== req.user.tenantId) {
        return res.status(403).json({ error: 'Access denied: This scan does not belong to your organization.' });
      }
      if (scan.status !== 'failed') {
        return res.status(400).json({ error: 'Only a failed scan can be overridden.' });
      }

      const employeeList = await db.select().from(schema.users).where(eq(schema.users.id, scan.scannedByUserId));
      if (employeeList.length === 0) return res.status(404).json({ error: 'Employee not found' });
      const employee = employeeList[0];

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const lastActiveToday = await db.select().from(schema.attendanceLogs).where(
        and(eq(schema.attendanceLogs.userId, employee.id), sql`status IN ('approved', 'pending')`, sql`created_at >= ${todayStart}`)
      ).orderBy(desc(schema.attendanceLogs.id)).limit(1);
      const logType = (lastActiveToday.length > 0 && lastActiveToday[0].type === 'check_in') ? 'check_out' : 'check_in';

      const log = await db.insert(schema.attendanceLogs).values({
        userId: employee.id,
        tenantId: scan.tenantId,
        status: 'approved',
        type: logType,
        reason: `QR Attendance — manually overridden by ${req.user.name}: ${reason.trim()}`,
        attendanceMode: 'qr',
      }).returning();

      await db.update(schema.qrScans).set({ status: 'success', attendanceLogId: log[0].id }).where(eq(schema.qrScans.id, scanId));

      await logToAuditLedger({
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        actorName: req.user.name,
        action: 'QR_SCAN_OVERRIDDEN',
        details: { scanId, subjectUserId: employee.id, reason: reason.trim(), logId: log[0].id }
      });

      res.json({ success: true, log: log[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/qr/history', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, QR_PERMISSIONS.VIEW_LOGS)) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const sessionsList = await db.select().from(schema.qrSessions)
        .where(eq(schema.qrSessions.tenantId, req.user.tenantId))
        .orderBy(desc(schema.qrSessions.createdAt))
        .limit(50);

      const sessionIds: number[] = sessionsList.map((s: any) => s.id as number);
      const generatorIds = [...new Set(sessionsList.map((s: any) => s.generatedByUserId as number))] as number[];
      const [generators, allScans] = await Promise.all([
        generatorIds.length > 0
          ? db.select().from(schema.users).where(inArray(schema.users.id, generatorIds))
          : Promise.resolve([]),
        sessionIds.length > 0
          ? db.select().from(schema.qrScans).where(inArray(schema.qrScans.qrSessionId, sessionIds))
          : Promise.resolve([]),
      ]);
      const generatorNameById = new Map<number, string>(generators.map((u: any) => [u.id, u.name]));
      const scansBySessionId = new Map<number, any[]>();
      for (const scan of allScans) {
        const list = scansBySessionId.get(scan.qrSessionId) || [];
        list.push(scan);
        scansBySessionId.set(scan.qrSessionId, list);
      }

      const withDetails = sessionsList.map((s: any) => {
        const scans = scansBySessionId.get(s.id) || [];
        const counts = {
          scansCount: scans.length,
          successCount: scans.filter((sc: any) => sc.status === 'success').length,
          failCount: scans.filter((sc: any) => sc.status === 'failed').length,
          pendingCount: scans.filter((sc: any) => sc.status === 'pending').length,
        };
        return { ...s, generatedByName: generatorNameById.get(s.generatedByUserId) || 'Unknown', ...counts };
      });

      res.json({ sessions: withDetails });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/qr/logs', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, QR_PERMISSIONS.VIEW_LOGS)) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }
      const scansList = await db.select().from(schema.qrScans)
        .where(eq(schema.qrScans.tenantId, req.user.tenantId))
        .orderBy(desc(schema.qrScans.createdAt))
        .limit(200);

      const scannerIds = [...new Set(scansList.map((s: any) => s.scannedByUserId as number))] as number[];
      const scanners = scannerIds.length > 0
        ? await db.select().from(schema.users).where(inArray(schema.users.id, scannerIds))
        : [];
      const scannerById = new Map<number, any>(scanners.map((u: any) => [u.id, u]));
      const withNames = scansList.map((s: any) => {
        const u = scannerById.get(s.scannedByUserId);
        return { ...s, userName: u?.name || 'Unknown', userRole: u?.role || '' };
      });

      res.json({ scans: withNames });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/qr/config', authenticate, async (req: any, res: any) => {
    try {
      const tenantRec = await db.select().from(schema.tenants).where(eq(schema.tenants.id, req.user.tenantId));
      if (tenantRec.length === 0) return res.status(404).json({ error: 'Tenant registration context not found.' });
      res.json({ policy: extractQrPolicy(tenantRec[0]) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Policy changes are org-wide and security-sensitive — same hard
  // tenant_admin-only gate as /api/tenant/config/update and the holiday
  // calendar, not delegable via privileges.
  app.put('/api/qr/config', authenticate, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'tenant_admin') {
        return res.status(403).json({ error: 'Access denied: Only the tenant admin can change QR attendance policy.' });
      }
      const { qrEnabled, qrRotationSeconds, qrRequireGps, qrRequireWifi, qrRequireFace, qrGeofenceRadiusMeters, qrRequireDeviceTrust } = req.body;

      const updates: any = {};
      if (qrEnabled !== undefined) updates.qrEnabled = !!qrEnabled;
      if (qrRotationSeconds !== undefined && (QR_ROTATION_OPTIONS as readonly number[]).includes(qrRotationSeconds)) updates.qrRotationSeconds = qrRotationSeconds;
      if (qrRequireGps !== undefined) updates.qrRequireGps = !!qrRequireGps;
      if (qrRequireWifi !== undefined) updates.qrRequireWifi = !!qrRequireWifi;
      if (qrRequireFace !== undefined) updates.qrRequireFace = !!qrRequireFace;
      if (qrGeofenceRadiusMeters !== undefined) updates.qrGeofenceRadiusMeters = qrGeofenceRadiusMeters === '' || qrGeofenceRadiusMeters === null ? null : parseInt(qrGeofenceRadiusMeters);
      if (qrRequireDeviceTrust !== undefined) updates.qrRequireDeviceTrust = !!qrRequireDeviceTrust;

      await db.update(schema.tenants).set(updates).where(eq(schema.tenants.id, req.user.tenantId));

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // CONTINUOUS ATTENDANCE VALIDATION HEARTBEAT
  app.post('/api/attendance/heartbeat', authenticate, async (req: any, res: any) => {
    try {
      const { lat, lng, simulatedIp, deviceId } = req.body;
      
      const userRec = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId)).limit(1);
      if (userRec.length === 0) return res.status(404).json({ error: 'User not found' });
      const user = userRec[0];

      const tenantRec = await db.select().from(schema.tenants).where(eq(schema.tenants.id, user.tenantId || 1)).limit(1);
      if (tenantRec.length === 0) return res.status(404).json({ error: 'Tenant not found' });
      const tenant = tenantRec[0];

      let warning = '';

      // Always remember the last GPS fix seen for this user today — the
      // 23:59 auto-checkout job uses this to guess whether someone who
      // forgot to check out is actually still on-premises, since it can't
      // reach a closed browser tab for a live read at that point.
      if (lat && lng) {
        await db.update(schema.users)
          .set({ lastHeartbeatLat: lat, lastHeartbeatLng: lng, lastHeartbeatAt: new Date() })
          .where(eq(schema.users.id, user.id));
      }

      // GPS Geofence Check
      if (lat && lng && tenant.locationLat && tenant.locationLng) {
        const distance = haversineMeters(lat, lng, tenant.locationLat, tenant.locationLng);
        const radius = tenant.locationRadiusMeters || 100;
        if (distance > radius) {
          warning = `Geofence exited by ${Math.round(distance - radius)}m.`;
        }
      }

      // Wi-Fi / IP Check (only if the tenant admin has explicitly enabled it)
      if (tenant.wifiCheckEnabled && tenant.officeIp) {
        const activeIp = resolveActiveIp(req, simulatedIp);
        if (tenant.officeIp !== activeIp && tenant.officeIp !== '127.0.0.1') {
          warning = (warning ? warning + ' | ' : '') + 'Corporate Wi-Fi disconnected.';
        }
      }

      if (warning) {
        // Log to ledger
        await logToAuditLedger({
          tenantId: user.tenantId,
          actorId: user.id,
          actorName: user.name,
          action: 'GEOFENCE_EXITED',
          ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
          deviceInfo: req.headers['user-agent'] || '',
          details: { warning, lat, lng, simulatedIp }
        });
        
        // Return warning status to client
        return res.json({ success: true, status: 'warning', message: warning });
      }

      res.json({ success: true, status: 'ok' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // IMMUTABLE AUDIT LEDGER ENDPOINTS
  app.get('/api/tenant/ledger', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'reports.view')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }

      const ledger = await db.select()
        .from(schema.auditLedger)
        .where(eq(schema.auditLedger.tenantId, req.user.tenantId || 1))
        .orderBy(desc(schema.auditLedger.timestamp));

      res.json({ ledger });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tenant/ledger/verify', authenticate, async (req: any, res: any) => {
    try {
      if (!await hasPrivilege(req.user, 'reports.view')) {
        return res.status(403).json({ error: 'Access denied: Insufficient privileges.' });
      }

      const logs = await db.select()
        .from(schema.auditLedger)
        .where(eq(schema.auditLedger.tenantId, req.user.tenantId || 1))
        .orderBy(schema.auditLedger.id);

      let prevHash = 'GENESIS';
      let isValid = true;
      const invalidBlocks: number[] = [];

      for (const block of logs) {
        const detailsStr = block.details ? JSON.stringify(block.details) : '';
        const rawPayload = `${prevHash}|${new Date(block.timestamp).toISOString()}|${block.action}|${block.actorName}|${detailsStr}`;
        const expectedHash = crypto.createHash('sha256').update(rawPayload).digest('hex');

        if (expectedHash !== block.hash) {
          isValid = false;
          invalidBlocks.push(block.id);
        }
        prevHash = block.hash;
      }

      res.json({ isValid, invalidBlocks, verifiedBlocksCount: logs.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Client App routing logic
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    let distPath = path.join(process.cwd(), 'dist');
    if (!fs.existsSync(path.join(distPath, 'index.html'))) {
      distPath = path.join(__dirname);
    }
    if (!fs.existsSync(path.join(distPath, 'index.html'))) {
      distPath = path.join(__dirname, '../dist');
    }
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`server listening on http://0.0.0.0:${PORT}`, { port: PORT, env: process.env.NODE_ENV || 'development' });
  });

  // Graceful shutdown: SIGTERM/SIGINT is how orchestrators (Docker, Railway,
  // Fly, Kubernetes) ask a container to stop. Stop accepting new connections,
  // let in-flight requests finish, then release the DB pool so we don't leak
  // connections or drop the scheduler advisory lock uncleanly. A short failsafe
  // timeout forces exit if a connection never closes.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`shutdown: ${signal} received — closing gracefully`);
    server.close(async () => {
      await closeDb();
      logger.info('shutdown: complete');
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('shutdown: forced exit after timeout');
      process.exit(1);
    }, 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer();
