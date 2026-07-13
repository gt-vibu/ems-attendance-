import crypto from 'crypto';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db, schema } from '../../db';
import { logger } from '../../logger';
import { hashPassword, verifyPassword, isPasswordHashed } from '../../password.js';

export async function verifyAndSyncDatabase() {
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
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS active_session_id TEXT;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS session_expires_at TIMESTAMP;`); } catch(e){}

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
export async function seedSuperAdmin() {
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
