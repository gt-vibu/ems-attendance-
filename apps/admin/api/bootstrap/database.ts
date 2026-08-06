import crypto from 'crypto';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db, schema, withBootSyncLock } from '../../db';
import { logger } from '../../logger';
import { hashPassword, verifyPassword, isPasswordHashed } from '../../password.js';

// Public entry point — held for the WHOLE sync under a blocking Postgres
// advisory lock (db.ts's withBootSyncLock) so N replicas starting at once on
// a rolling/autoscaled deploy don't race each other's concurrent
// CREATE TABLE IF NOT EXISTS / ALTER TABLE ADD COLUMN IF NOT EXISTS
// statements — they queue up and run one at a time instead.
export async function verifyAndSyncDatabase(): Promise<void> {
  await withBootSyncLock(runSchemaSync);
}

async function runSchemaSync() {
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
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS office_ip TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Asia/Kolkata';`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'Basic';`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS features_allowed JSONB;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS shift_start TEXT DEFAULT '09:00';`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS shift_end TEXT DEFAULT '18:00';`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS grace_period_mins INTEGER DEFAULT 15;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS checkout_grace_mins INTEGER DEFAULT 15;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS half_day_mins INTEGER DEFAULT 240;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS weekend_config JSONB DEFAULT '["Saturday", "Sunday"]';`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS daily_break_budget_mins INTEGER DEFAULT 60;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wifi_check_enabled BOOLEAN DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS min_attendance_percent INTEGER DEFAULT 75;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS arrival_policy TEXT DEFAULT 'buffered';`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS working_hours_policy TEXT DEFAULT 'fixed_shift_end';`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS required_working_mins INTEGER;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS hybrid_max_checkout_time TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS overtime_payroll_enabled BOOLEAN DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    // No DEFAULT — stays NULL ("no explicit admin choice yet, defer to the
    // platform allow-list") for every existing row. See schema.ts.
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS face_id_enabled BOOLEAN;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE branches ADD COLUMN IF NOT EXISTS arrival_policy TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE branches ADD COLUMN IF NOT EXISTS working_hours_policy TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE branches ADD COLUMN IF NOT EXISTS required_working_mins INTEGER;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE branches ADD COLUMN IF NOT EXISTS hybrid_max_checkout_time TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

    // Work From Home (WFH) policy columns — additive; wfh_enabled defaults
    // false so existing tenants are entirely unaffected until an admin opts in.
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wfh_enabled BOOLEAN DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wfh_allowed_roles JSONB;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wfh_max_days_per_month INTEGER;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wfh_allowed_weekdays JSONB DEFAULT '["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]';`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wfh_radius_meters INTEGER DEFAULT 200;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wfh_approval_required BOOLEAN DEFAULT true;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wfh_require_reason BOOLEAN DEFAULT true;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wfh_late_login_grace_mins INTEGER;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

    // Dynamic QR Attendance policy columns — additive; qr_enabled defaults
    // false so existing tenants are entirely unaffected until an admin opts in.
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS qr_enabled BOOLEAN DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS qr_rotation_seconds INTEGER DEFAULT 30;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS qr_require_gps BOOLEAN DEFAULT true;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS qr_require_wifi BOOLEAN DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS qr_require_face BOOLEAN DEFAULT true;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS qr_geofence_radius_meters INTEGER;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS qr_require_device_trust BOOLEAN DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

    // Company-wide KYC toggle and first-login branch-setup-wizard flag.
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS kyc_enabled BOOLEAN DEFAULT true;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS branch_setup_completed BOOLEAN DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

    // Company-wide policy announcement banner, admin-editable (gated behind
    // the tenant.policy.manage privilege), shown on both admin and employee dashboards.
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS policy_announcement TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS policy_announcement_updated_at TIMESTAMP;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS documents_enabled BOOLEAN DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS password_expiry_days INTEGER DEFAULT 0;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS idle_timeout_minutes INTEGER DEFAULT 0;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS attendance_retention_months INTEGER DEFAULT 0;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS report_logo_url TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS report_address TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

    // Departments must exist
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS departments (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        name TEXT NOT NULL,
        description TEXT,
        head_user_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Branches must exist before users/attendance_logs reference them below.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS branches (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        name TEXT NOT NULL,
        address TEXT,
        location_lat REAL,
        location_lng REAL,
        location_radius_meters INTEGER DEFAULT 100,
        is_main_branch BOOLEAN DEFAULT false,
        status TEXT NOT NULL DEFAULT 'active',
        shift_start TEXT DEFAULT '09:00',
        shift_end TEXT DEFAULT '18:00',
        grace_period_mins INTEGER DEFAULT 15,
        half_day_mins INTEGER DEFAULT 240,
        weekend_config JSONB DEFAULT '["Saturday", "Sunday"]',
        daily_break_budget_mins INTEGER DEFAULT 60,
        min_attendance_percent INTEGER DEFAULT 75,
        wifi_ssid TEXT,
        office_ip TEXT,
        wifi_check_enabled BOOLEAN DEFAULT false,
        qr_enabled BOOLEAN DEFAULT false,
        qr_rotation_seconds INTEGER DEFAULT 30,
        qr_require_gps BOOLEAN DEFAULT true,
        qr_require_wifi BOOLEAN DEFAULT false,
        qr_require_face BOOLEAN DEFAULT true,
        qr_geofence_radius_meters INTEGER,
        qr_require_device_trust BOOLEAN DEFAULT false,
        arrival_policy TEXT,
        working_hours_policy TEXT,
        required_working_mins INTEGER,
        hybrid_max_checkout_time TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // One-time backfill: branch_setup_completed was never actually persisted
    // (the wizard only updated the client's in-memory session — see
    // /api/branches/bulk), so any tenant that already has a real branch on
    // record clearly finished setup already and shouldn't be sent through
    // the wizard again just because this column is catching up.
    await db.execute(sql`
      UPDATE tenants SET branch_setup_completed = true
      WHERE branch_setup_completed IS NOT TRUE
        AND EXISTS (SELECT 1 FROM branches WHERE branches.tenant_id = tenants.id);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS shifts (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        name TEXT NOT NULL,
        check_in_time TEXT NOT NULL,
        check_out_time TEXT NOT NULL,
        grace_period_mins INTEGER,
        is_default BOOLEAN DEFAULT false,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

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

    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'employee';`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS privileges JSONB;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS temp_password TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_action_log JSONB;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_method TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_heartbeat_lat REAL;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_heartbeat_lng REAL;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMP;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS active_session_id TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS session_expires_at TIMESTAMP;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id);`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS shift_id INTEGER REFERENCES shifts(id);`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS designation TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS employment_type TEXT DEFAULT 'full_time';`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id INTEGER REFERENCES users(id);`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_joining TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_exit TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_status TEXT DEFAULT 'active';`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP DEFAULT NOW();`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_history JSONB;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS data_erased_at TIMESTAMP;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS role_privilege_defaults (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        role_name TEXT NOT NULL,
        privileges JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_branch_access (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

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

    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS break_type TEXT DEFAULT 'General';`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS start_lat REAL;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS start_lng REAL;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS end_lat REAL;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS end_lng REAL;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS is_violation BOOLEAN DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS outside_geofence BOOLEAN DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS note TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    // Backfill any pre-existing null tenant_id from the owning user's
    // tenant before tightening the column to NOT NULL below — every user
    // row has a tenant_id, so this always has something to backfill from.
    try { await db.execute(sql`UPDATE break_sessions bs SET tenant_id = u.tenant_id FROM users u WHERE bs.user_id = u.id AND bs.tenant_id IS NULL;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE break_sessions ALTER COLUMN tenant_id SET NOT NULL;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    // departments.head_user_id / users.manager_id were plain integer
    // columns with only a comment claiming the FK relationship, never
    // actually enforced at the DB level (schema.ts now declares both as
    // real deferred references). Add the constraints if not already
    // present; ON DELETE SET NULL so deleting a manager/department-head
    // user doesn't get blocked by their own subordinates/department row.
    try {
      await db.execute(sql`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'departments_head_user_id_users_id_fk') THEN
            ALTER TABLE departments ADD CONSTRAINT departments_head_user_id_users_id_fk FOREIGN KEY (head_user_id) REFERENCES users(id) ON DELETE SET NULL;
          END IF;
        END $$;
      `);
    } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try {
      await db.execute(sql`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_manager_id_users_id_fk') THEN
            ALTER TABLE users ADD CONSTRAINT users_manager_id_users_id_fk FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL;
          END IF;
        END $$;
      `);
    } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

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
    try { await db.execute(sql`ALTER TABLE attendance_alerts ADD COLUMN IF NOT EXISTS escalation_level INTEGER NOT NULL DEFAULT 0;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_alerts ADD COLUMN IF NOT EXISTS current_assignee_user_id INTEGER REFERENCES users(id);`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_alerts ADD COLUMN IF NOT EXISTS last_assigned_at TIMESTAMP DEFAULT NOW();`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS holidays (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        date TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // Branch/department scoping — NULL/NULL (the default for every existing
    // row) still means "everyone in the tenant," identical to before.
    try { await db.execute(sql`ALTER TABLE holidays ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id);`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE holidays ADD COLUMN IF NOT EXISTS department TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    // Mandatory (default) vs optional/floater holiday. Every pre-existing
    // row defaults to false (mandatory) — a deliberate behavior change from
    // before this column existed, when every holiday was implicitly part of
    // the optional-selection pool regardless.
    try { await db.execute(sql`ALTER TABLE holidays ADD COLUMN IF NOT EXISTS is_optional BOOLEAN NOT NULL DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS escalation_level INTEGER NOT NULL DEFAULT 0;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS last_escalated_at TIMESTAMP;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE holidays ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE holidays ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE holidays ADD COLUMN IF NOT EXISTS archived_by_user_id INTEGER REFERENCES users(id);`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`
      CREATE TABLE IF NOT EXISTS delegations (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        delegated_by_user_id INTEGER NOT NULL REFERENCES users(id),
        delegated_to_user_id INTEGER NOT NULL REFERENCES users(id),
        privilege_keys JSONB NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        revoked_at TIMESTAMP,
        revoked_by_user_id INTEGER REFERENCES users(id)
      );
    `); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`
      CREATE TABLE IF NOT EXISTS shift_history (
        id SERIAL PRIMARY KEY,
        shift_id INTEGER NOT NULL REFERENCES shifts(id),
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        action TEXT NOT NULL,
        previous JSONB,
        next JSONB NOT NULL,
        actor_user_id INTEGER REFERENCES users(id),
        actor_name TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`
      CREATE TABLE IF NOT EXISTS holiday_history (
        id SERIAL PRIMARY KEY,
        holiday_id INTEGER NOT NULL REFERENCES holidays(id),
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        action TEXT NOT NULL,
        snapshot JSONB NOT NULL,
        actor_user_id INTEGER REFERENCES users(id),
        actor_name TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`
      CREATE TABLE IF NOT EXISTS leave_escalation_history (
        id SERIAL PRIMARY KEY,
        leave_request_id INTEGER NOT NULL REFERENCES leave_requests(id),
        from_user_id INTEGER REFERENCES users(id),
        to_user_id INTEGER NOT NULL REFERENCES users(id),
        from_level INTEGER NOT NULL,
        to_level INTEGER NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

    // One-time backfill: unified_notifications now ships on by default for
    // new tenants (see super.routes.ts tenant creation), and every
    // pre-existing tenant is migrated onto it here too — safe because
    // DEFAULT_POLICIES (notificationService.ts) was deliberately calibrated
    // to match each event's prior hardcoded recipient/channel behavior
    // exactly, so this doesn't change who gets notified for anyone who
    // hasn't customized a policy; it just makes the system configurable
    // (and turns on notify()-gated fixes that were previously dormant for
    // tenants that never had this toggle enabled).
    try {
      // features_allowed is jsonb (an array literal, not a native Postgres
      // array) — use jsonb containment/concatenation, not array_append/ANY.
      await db.execute(sql`
        UPDATE tenants SET features_allowed = COALESCE(features_allowed, '[]'::jsonb) || '["unified_notifications"]'::jsonb
        WHERE NOT (COALESCE(features_allowed, '[]'::jsonb) @> '["unified_notifications"]'::jsonb);
      `);
    } catch (e) { logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS notification_recipient_groups (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        name TEXT NOT NULL,
        notify_employee BOOLEAN NOT NULL DEFAULT true,
        notify_manager BOOLEAN NOT NULL DEFAULT false,
        notify_hr BOOLEAN NOT NULL DEFAULT false,
        notify_admin BOOLEAN NOT NULL DEFAULT false,
        channels JSONB NOT NULL DEFAULT '["in_app","email"]',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS holiday_employee_overrides (
        id SERIAL PRIMARY KEY,
        holiday_id INTEGER NOT NULL REFERENCES holidays(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        included BOOLEAN NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (holiday_id, user_id)
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
    // Regularization additions: approver remarks now, plus (further below,
    // once attendance_logs/employee_documents exist) the FK columns linking
    // a request to the document attached to it and the attendance_logs row
    // approving it actually produced.
    try { await db.execute(sql`ALTER TABLE attendance_corrections ADD COLUMN IF NOT EXISTS review_remarks TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS leave_policies (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        branch_id INTEGER REFERENCES branches(id),
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        max_days_per_year REAL NOT NULL DEFAULT 12,
        allow_half_day BOOLEAN NOT NULL DEFAULT true,
        requires_approval BOOLEAN NOT NULL DEFAULT true,
        medical_only_no_advance_notice_days REAL DEFAULT 0,
        default_deduction_percent REAL NOT NULL DEFAULT 100,
        accrual_enabled BOOLEAN NOT NULL DEFAULT false,
        carry_forward_enabled BOOLEAN NOT NULL DEFAULT false,
        max_carry_forward_days REAL NOT NULL DEFAULT 0,
        encashment_enabled BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    try { await db.execute(sql`ALTER TABLE leave_policies ADD COLUMN IF NOT EXISTS accrual_enabled BOOLEAN NOT NULL DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE leave_policies ADD COLUMN IF NOT EXISTS carry_forward_enabled BOOLEAN NOT NULL DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE leave_policies ADD COLUMN IF NOT EXISTS max_carry_forward_days REAL NOT NULL DEFAULT 0;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE leave_policies ADD COLUMN IF NOT EXISTS encashment_enabled BOOLEAN NOT NULL DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS leave_encashment_requests (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        policy_id INTEGER NOT NULL REFERENCES leave_policies(id),
        leave_type TEXT NOT NULL,
        days REAL NOT NULL,
        rate_per_day REAL,
        amount REAL,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by_user_id INTEGER REFERENCES users(id),
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS leave_requests (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        policy_id INTEGER REFERENCES leave_policies(id),
        leave_type TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        total_days REAL NOT NULL,
        medical_cause BOOLEAN NOT NULL DEFAULT false,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by_user_id INTEGER REFERENCES users(id),
        reviewer_comment TEXT,
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS leave_balance_adjustments (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        leave_type TEXT NOT NULL,
        adjustment_days REAL NOT NULL,
        reason TEXT NOT NULL,
        adjusted_by_user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS payroll_settings (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        working_days_per_month INTEGER NOT NULL DEFAULT 26,
        max_paid_leave_days_per_month REAL NOT NULL DEFAULT 0,
        excess_leave_penalty_percent REAL NOT NULL DEFAULT 100,
        overtime_hourly_rate REAL NOT NULL DEFAULT 0,
        optional_holiday_limit INTEGER NOT NULL DEFAULT 2,
        holiday_country_code TEXT DEFAULT 'IN',
        holiday_region_code TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS statutory_compliance_enabled BOOLEAN DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS pf_enabled BOOLEAN DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS pf_employee_rate_percent REAL NOT NULL DEFAULT 12;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS pf_employer_rate_percent REAL NOT NULL DEFAULT 12;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS pf_wage_ceiling REAL NOT NULL DEFAULT 15000;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS esi_enabled BOOLEAN DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS esi_employee_rate_percent REAL NOT NULL DEFAULT 0.75;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS esi_employer_rate_percent REAL NOT NULL DEFAULT 3.25;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS esi_wage_ceiling REAL NOT NULL DEFAULT 21000;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS professional_tax_enabled BOOLEAN DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS professional_tax_slabs JSONB DEFAULT '[]';`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS tds_enabled BOOLEAN DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS income_tax_slabs JSONB DEFAULT '[{"upTo":300000,"ratePercent":0},{"upTo":600000,"ratePercent":5},{"upTo":900000,"ratePercent":10},{"upTo":1200000,"ratePercent":15},{"upTo":1500000,"ratePercent":20},{"upTo":null,"ratePercent":30}]';`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS tds_standard_deduction REAL NOT NULL DEFAULT 50000;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS statutory_basic_percent_of_gross REAL NOT NULL DEFAULT 50;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS block_payroll_release_on_pending_adjustments BOOLEAN DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS lop_calculation_policy TEXT DEFAULT 'fixed_26';`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS monthly_salary_basis TEXT DEFAULT 'actual_calendar_days';`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS include_paid_holidays BOOLEAN DEFAULT true;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS include_paid_weekends BOOLEAN DEFAULT true;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS include_approved_paid_leave BOOLEAN DEFAULT true;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS payroll_locking_enabled BOOLEAN NOT NULL DEFAULT true;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS employee_compensation_profiles (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        annual_ctc REAL NOT NULL,
        overtime_hourly_rate REAL,
        effective_from TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS employee_salary_components (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        profile_id INTEGER NOT NULL REFERENCES employee_compensation_profiles(id),
        component_name TEXT NOT NULL,
        component_type TEXT NOT NULL DEFAULT 'earning',
        calculation_type TEXT NOT NULL DEFAULT 'percent_of_ctc',
        value REAL NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS role_compensation_defaults (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        role_name TEXT NOT NULL,
        annual_ctc REAL NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS role_compensation_components (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        role_default_id INTEGER NOT NULL REFERENCES role_compensation_defaults(id),
        component_name TEXT NOT NULL,
        component_type TEXT NOT NULL DEFAULT 'earning',
        calculation_type TEXT NOT NULL DEFAULT 'percent_of_ctc',
        value REAL NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS payroll_runs (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        profile_id INTEGER REFERENCES employee_compensation_profiles(id),
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        working_days REAL NOT NULL,
        approved_leave_days REAL NOT NULL DEFAULT 0,
        overtime_hours REAL NOT NULL DEFAULT 0,
        gross_pay REAL NOT NULL DEFAULT 0,
        leave_deduction REAL NOT NULL DEFAULT 0,
        overtime_pay REAL NOT NULL DEFAULT 0,
        net_pay REAL NOT NULL DEFAULT 0,
        breakdown JSONB,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // Backs the idempotent "INSERT ... ON CONFLICT DO NOTHING" in
    // GET /api/payroll/history — one snapshot per employee per period, ever.
    try { await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS payroll_runs_user_period_unique ON payroll_runs (user_id, year, month);`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS unpaid_absence_days REAL NOT NULL DEFAULT 0;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS lop_deduction REAL NOT NULL DEFAULT 0;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS payroll_adjustments (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        payroll_run_id INTEGER NOT NULL REFERENCES payroll_runs(id),
        source_type TEXT NOT NULL,
        source_id INTEGER,
        amount_delta REAL NOT NULL,
        reason TEXT NOT NULL,
        created_by_user_id INTEGER REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'pending',
        applied_to_next_cycle BOOLEAN NOT NULL DEFAULT false,
        applied_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    try { await db.execute(sql`ALTER TABLE payroll_adjustments ADD COLUMN IF NOT EXISTS previous_value TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_adjustments ADD COLUMN IF NOT EXISTS new_value TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_adjustments ADD COLUMN IF NOT EXISTS approved_by_user_id INTEGER REFERENCES users(id);`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_adjustments ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_adjustments ADD COLUMN IF NOT EXISTS audit_id INTEGER;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

    try { await db.execute(sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS batch_id INTEGER;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS supersedes_run_id INTEGER;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    // Versioned Payslips (P3/P7 fix) — the old per-(user,year,month) unique
    // index blocked ever recording more than one payslip for a period,
    // which meant a post-release adjustment couldn't produce a v2 payslip.
    // Dropped in favor of a per-(user,year,month,version) index, only
    // possible now that the version column above actually exists.
    try { await db.execute(sql`DROP INDEX IF EXISTS payroll_runs_user_period_unique;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS payroll_runs_user_period_version_unique ON payroll_runs (user_id, year, month, version);`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS payroll_calendars (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        attendance_freeze_date TEXT,
        calculation_date TEXT,
        hr_review_date TEXT,
        finance_review_date TEXT,
        release_date TEXT,
        salary_credit_date TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (tenant_id, year, month)
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS payroll_batches (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        employee_count INTEGER NOT NULL DEFAULT 0,
        total_gross REAL NOT NULL DEFAULT 0,
        total_net REAL NOT NULL DEFAULT 0,
        calculated_at TIMESTAMP,
        hr_reviewed_by_user_id INTEGER REFERENCES users(id),
        hr_reviewed_at TIMESTAMP,
        finance_reviewed_by_user_id INTEGER REFERENCES users(id),
        finance_reviewed_at TIMESTAMP,
        approved_by_user_id INTEGER REFERENCES users(id),
        approved_at TIMESTAMP,
        released_by_user_id INTEGER REFERENCES users(id),
        released_at TIMESTAMP,
        locked_at TIMESTAMP,
        created_by_user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (tenant_id, year, month)
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS payroll_loans (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        principal REAL NOT NULL,
        emi_amount REAL NOT NULL,
        remaining_balance REAL NOT NULL,
        start_year INTEGER NOT NULL,
        start_month INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        reason TEXT,
        created_by_user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS payroll_advances (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount REAL NOT NULL,
        recovery_months INTEGER NOT NULL DEFAULT 1,
        recovery_per_month REAL NOT NULL,
        remaining_balance REAL NOT NULL,
        start_year INTEGER NOT NULL,
        start_month INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        reason TEXT,
        created_by_user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS payroll_reimbursements (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        category TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        receipt_document_id INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        approved_by_user_id INTEGER REFERENCES users(id),
        approved_at TIMESTAMP,
        payroll_batch_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS payroll_bonuses (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        approved_by_user_id INTEGER REFERENCES users(id),
        approved_at TIMESTAMP,
        payroll_batch_id INTEGER,
        created_by_user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS salary_revision_requests (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        type TEXT NOT NULL DEFAULT 'revision',
        proposed_annual_ctc REAL NOT NULL,
        proposed_components JSONB,
        effective_date TEXT NOT NULL,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'pending_hr',
        hr_reviewed_by_user_id INTEGER REFERENCES users(id),
        hr_reviewed_at TIMESTAMP,
        finance_reviewed_by_user_id INTEGER REFERENCES users(id),
        finance_reviewed_at TIMESTAMP,
        requested_by_user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS payroll_ledger_entries (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        batch_id INTEGER,
        payroll_run_id INTEGER,
        entry_type TEXT NOT NULL,
        source_table TEXT,
        source_id INTEGER,
        amount REAL NOT NULL,
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
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

    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'check_in';`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS client_timestamp TIMESTAMP;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS challenge JSONB;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS explanation TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

    // Work From Home (WFH) columns on attendance_logs — attendance_mode
    // defaults 'office' so every existing row (and every existing query that
    // doesn't know this column exists) keeps its current meaning.
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS attendance_mode TEXT NOT NULL DEFAULT 'office';`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS home_lat REAL;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS home_lng REAL;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS distance_from_home_meters REAL;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS wfh_reason TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id);`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS checkout_at TIMESTAMP;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS worked_minutes REAL;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS is_late BOOLEAN;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS late_by_minutes INTEGER;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS expected_checkout_at TIMESTAMP;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS is_half_day BOOLEAN;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS is_short_day BOOLEAN;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS pending_verification BOOLEAN DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS overtime_minutes REAL;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

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
      CREATE TABLE IF NOT EXISTS optional_holiday_choices (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        holiday_id INTEGER NOT NULL REFERENCES holidays(id),
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

    // Dated, TEMPORARY shift overrides — additive alongside users.shift_id
    // (the permanent shift). See shiftOverrides in packages/database/src/schema.ts
    // and getEffectiveShiftId() in apps/admin/api/services/shiftOverrides.ts.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS shift_overrides (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        shift_id INTEGER NOT NULL REFERENCES shifts(id),
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        reason TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // A manager's own team, gated by 'team.manage'. See teams/teamMembers in
    // packages/database/src/schema.ts and routes/teams.routes.ts.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS teams (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        manager_id INTEGER NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS team_members (
        id SERIAL PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        added_at TIMESTAMP DEFAULT NOW()
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
    try { await db.execute(sql`ALTER TABLE audit_ledger ADD COLUMN IF NOT EXISTS request_id TEXT;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS service_accounts (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        name TEXT NOT NULL,
        key_prefix TEXT NOT NULL UNIQUE,
        key_hash TEXT NOT NULL,
        privileges JSONB NOT NULL DEFAULT '[]',
        created_by_user_id INTEGER REFERENCES users(id),
        last_used_at TIMESTAMP,
        revoked_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS compensation_history (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        changed_by_user_id INTEGER REFERENCES users(id),
        effective_from TEXT,
        previous_annual_ctc REAL,
        new_annual_ctc REAL NOT NULL,
        previous_components JSONB,
        new_components JSONB NOT NULL,
        field_changes JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS webauthn_credentials (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        credential_id TEXT NOT NULL UNIQUE,
        public_key TEXT NOT NULL,
        counter INTEGER NOT NULL DEFAULT 0,
        device_type TEXT,
        transports JSONB,
        device_name TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        last_used_at TIMESTAMP
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS webauthn_challenges (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        challenge TEXT NOT NULL,
        purpose TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS webhook_subscriptions (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        url TEXT NOT NULL,
        events JSONB NOT NULL DEFAULT '[]',
        signing_secret TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_by_user_id INTEGER REFERENCES users(id),
        last_delivery_at TIMESTAMP,
        last_delivery_status TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS employee_documents (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        uploaded_by_user_id INTEGER NOT NULL REFERENCES users(id),
        category TEXT NOT NULL DEFAULT 'other',
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        storage_path TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // attendance_corrections FK columns that depend on tables not yet
    // created earlier in this script (attendance_logs, employee_documents).
    try { await db.execute(sql`ALTER TABLE attendance_corrections ADD COLUMN IF NOT EXISTS document_id INTEGER REFERENCES employee_documents(id);`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_corrections ADD COLUMN IF NOT EXISTS applied_log_id INTEGER REFERENCES attendance_logs(id);`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS shift_swap_requests (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        requester_id INTEGER NOT NULL REFERENCES users(id),
        target_user_id INTEGER NOT NULL REFERENCES users(id),
        swap_date TEXT NOT NULL,
        requester_shift_id INTEGER REFERENCES shifts(id),
        target_shift_id INTEGER REFERENCES shifts(id),
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'pending_target',
        target_responded_at TIMESTAMP,
        reviewed_by_user_id INTEGER REFERENCES users(id),
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS approval_routing_rules (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        category TEXT NOT NULL,
        scope_type TEXT NOT NULL DEFAULT 'all',
        scope_id INTEGER,
        scope_value TEXT,
        approver_type TEXT NOT NULL,
        approver_value TEXT,
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attendance_freeze_periods (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        frozen_at TIMESTAMP DEFAULT NOW(),
        frozen_by_user_id INTEGER REFERENCES users(id),
        UNIQUE (tenant_id, year, month)
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS background_jobs (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id),
        job_type TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        run_after TIMESTAMP DEFAULT NOW(),
        last_error TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS report_saved_templates (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        created_by_user_id INTEGER NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        report_type TEXT NOT NULL,
        filters JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS report_schedules (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        created_by_user_id INTEGER NOT NULL REFERENCES users(id),
        report_name TEXT NOT NULL,
        report_type TEXT NOT NULL,
        filters JSONB NOT NULL DEFAULT '{}',
        frequency TEXT NOT NULL,
        day_of_week INTEGER,
        day_of_month INTEGER,
        time_of_day TEXT NOT NULL DEFAULT '08:00',
        recipients JSONB NOT NULL DEFAULT '[]',
        format TEXT NOT NULL DEFAULT 'csv',
        active BOOLEAN NOT NULL DEFAULT true,
        last_run_at TIMESTAMP,
        next_run_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS notification_templates (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        event_type TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'email',
        subject TEXT,
        body TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (tenant_id, event_type, channel)
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS notification_policies (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        event_type TEXT NOT NULL,
        notify_employee BOOLEAN NOT NULL DEFAULT true,
        notify_manager BOOLEAN NOT NULL DEFAULT false,
        notify_hr BOOLEAN NOT NULL DEFAULT false,
        notify_admin BOOLEAN NOT NULL DEFAULT false,
        channels JSONB NOT NULL DEFAULT '["in_app","email"]',
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (tenant_id, event_type)
      );
    `);
    try { await db.execute(sql`ALTER TABLE notification_policies ADD COLUMN IF NOT EXISTS scope_hr_to_department BOOLEAN NOT NULL DEFAULT false;`); } catch (e) { logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    // Per-recipient delivery mode + priority tier (Notification Center /
    // digest layer) — see schema.ts notificationPolicies comment. Defaulting
    // every mode to 'immediate' and priority to 'medium' preserves exactly
    // today's behavior for every existing row until an admin reclassifies
    // an event.
    try { await db.execute(sql`ALTER TABLE notification_policies ADD COLUMN IF NOT EXISTS employee_mode TEXT NOT NULL DEFAULT 'immediate';`); } catch (e) { logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE notification_policies ADD COLUMN IF NOT EXISTS manager_mode TEXT NOT NULL DEFAULT 'immediate';`); } catch (e) { logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE notification_policies ADD COLUMN IF NOT EXISTS hr_mode TEXT NOT NULL DEFAULT 'immediate';`); } catch (e) { logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE notification_policies ADD COLUMN IF NOT EXISTS admin_mode TEXT NOT NULL DEFAULT 'immediate';`); } catch (e) { logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE notification_policies ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium';`); } catch (e) { logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS quiet_hours_start TEXT;`); } catch (e) { logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS quiet_hours_end TEXT;`); } catch (e) { logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_channel_prefs JSONB DEFAULT '{"email":true,"in_app":true}';`); } catch (e) { logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS notification_log (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        event_type TEXT NOT NULL,
        recipient_user_id INTEGER REFERENCES users(id),
        channel TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS notification_log_tenant_idx ON notification_log(tenant_id, created_at DESC);`);
    try { await db.execute(sql`ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 1;`); } catch (e) { logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS subject_name TEXT;`); } catch (e) { logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}';`); } catch (e) { logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

    // Digest queue — holds 'digest'-mode notifications until digestDispatcher
    // rolls them into one summary per recipient. Same-day duplicates of the
    // same (recipient, eventType) collapse via the unique constraint instead
    // of accumulating one row per occurrence.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS notification_digest_queue (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        recipient_user_id INTEGER NOT NULL REFERENCES users(id),
        event_type TEXT NOT NULL,
        digest_bucket_date TEXT NOT NULL,
        occurrence_count INTEGER NOT NULL DEFAULT 1,
        sample_subject_names JSONB NOT NULL DEFAULT '[]',
        data JSONB NOT NULL DEFAULT '{}',
        consumed BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (tenant_id, recipient_user_id, event_type, digest_bucket_date)
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS notification_digest_queue_pending_idx ON notification_digest_queue(tenant_id, consumed) WHERE consumed = false;`);

    // Digest subscriptions — admin-configurable "who gets the rollup, how
    // often" (fixes the old hardcoded admins[0]-only daily summary).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS notification_digest_subscriptions (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        digest_type TEXT NOT NULL,
        frequency TEXT NOT NULL DEFAULT 'daily',
        time_of_day TEXT NOT NULL DEFAULT '09:00',
        day_of_week INTEGER,
        recipients JSONB NOT NULL DEFAULT '[]',
        active BOOLEAN NOT NULL DEFAULT true,
        last_run_at TIMESTAMP,
        next_run_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Seed default digest subscriptions for every tenant that doesn't have
    // any yet — role-based recipients so this covers every existing/new
    // tenant automatically; the executive_daily default replaces the old
    // admins[0]-only behavior with "all tenant admins", still safely
    // extendable to named non-admin employees via the new Notification
    // Center UI without another migration.
    try {
      const tenantsNeedingDigestDefaults = await db.execute(sql`
        SELECT t.id FROM tenants t
        WHERE NOT EXISTS (SELECT 1 FROM notification_digest_subscriptions s WHERE s.tenant_id = t.id)
      `);
      const rows: any[] = (tenantsNeedingDigestDefaults as any).rows || tenantsNeedingDigestDefaults;
      for (const row of rows) {
        const tid = row.id;
        await db.execute(sql`
          INSERT INTO notification_digest_subscriptions (tenant_id, digest_type, frequency, time_of_day, recipients)
          VALUES
            (${tid}, 'manager_daily', 'daily', '09:00', '[{"type":"role","role":"manager"}]'),
            (${tid}, 'hr_daily', 'daily', '09:15', '[{"type":"role","role":"HR"}]'),
            (${tid}, 'executive_daily', 'daily', '19:00', '[{"type":"role","role":"tenant_admin"}]')
        `);
      }
    } catch (e) { logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attendance_logs_archive (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        status TEXT NOT NULL,
        type TEXT,
        client_timestamp TIMESTAMP,
        device TEXT,
        location_lat REAL,
        location_lng REAL,
        reason TEXT,
        explanation TEXT,
        attendance_mode TEXT,
        home_lat REAL,
        home_lng REAL,
        distance_from_home_meters REAL,
        wfh_reason TEXT,
        checkout_at TIMESTAMP,
        worked_minutes REAL,
        branch_id INTEGER REFERENCES branches(id),
        created_at TIMESTAMP,
        archived_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS termination_requests (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        employee_id INTEGER NOT NULL REFERENCES users(id),
        requested_by_user_id INTEGER NOT NULL REFERENCES users(id),
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by_user_id INTEGER REFERENCES users(id),
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS payroll_final_settlements (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        termination_request_id INTEGER NOT NULL REFERENCES termination_requests(id),
        last_working_date TEXT NOT NULL,
        remaining_salary_amount REAL NOT NULL DEFAULT 0,
        leave_encashment_days REAL NOT NULL DEFAULT 0,
        leave_encashment_amount REAL NOT NULL DEFAULT 0,
        pending_bonus_amount REAL NOT NULL DEFAULT 0,
        notice_period_recovery_amount REAL NOT NULL DEFAULT 0,
        loan_advance_recovery_amount REAL NOT NULL DEFAULT 0,
        gross_settlement REAL NOT NULL DEFAULT 0,
        net_settlement REAL NOT NULL DEFAULT 0,
        breakdown JSONB,
        status TEXT NOT NULL DEFAULT 'draft',
        generated_by_user_id INTEGER REFERENCES users(id),
        approved_by_user_id INTEGER REFERENCES users(id),
        approved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        raised_by_user_id INTEGER NOT NULL REFERENCES users(id),
        category TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'medium',
        subject TEXT NOT NULL,
        description TEXT NOT NULL,
        related_attendance_log_id INTEGER REFERENCES attendance_logs(id),
        related_leave_request_id INTEGER,
        related_date TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        escalation_level INTEGER NOT NULL DEFAULT 0,
        current_assignee_user_id INTEGER REFERENCES users(id),
        last_assigned_at TIMESTAMP DEFAULT NOW(),
        resolution_note TEXT,
        resolved_by_user_id INTEGER REFERENCES users(id),
        resolved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        endpoint TEXT NOT NULL UNIQUE,
        p256dh_key TEXT NOT NULL,
        auth_key TEXT NOT NULL,
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ticket_escalations (
        id SERIAL PRIMARY KEY,
        ticket_id INTEGER NOT NULL REFERENCES tickets(id),
        from_user_id INTEGER REFERENCES users(id),
        to_user_id INTEGER REFERENCES users(id),
        from_level INTEGER NOT NULL,
        to_level INTEGER NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // ── Attendance Preferences (configuration-driven policy engine) ──
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attendance_preferences (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id) NOT NULL UNIQUE,
        allow_multiple_sessions BOOLEAN DEFAULT false,
        max_sessions_per_day INTEGER DEFAULT 1,
        min_gap_between_sessions_mins INTEGER DEFAULT 15,
        require_checkout_before_new_checkin BOOLEAN DEFAULT true,
        auto_close_open_sessions BOOLEAN DEFAULT false,
        max_session_duration_mins INTEGER,
        enabled_methods JSONB DEFAULT '["face_recognition","gps","manual"]',
        default_method TEXT DEFAULT 'face_recognition',
        method_hierarchy JSONB,
        require_face_match BOOLEAN DEFAULT true,
        require_gps BOOLEAN DEFAULT true,
        require_office_wifi BOOLEAN DEFAULT false,
        require_geo_fence BOOLEAN DEFAULT false,
        require_device_verification BOOLEAN DEFAULT false,
        require_liveness_detection BOOLEAN DEFAULT true,
        allow_early_checkin BOOLEAN DEFAULT true,
        early_checkin_buffer_mins INTEGER DEFAULT 30,
        allow_late_checkout BOOLEAN DEFAULT true,
        max_overtime_mins INTEGER,
        allow_cross_midnight_sessions BOOLEAN DEFAULT false,
        auto_split_at_midnight BOOLEAN DEFAULT false,
        show_running_timer BOOLEAN DEFAULT true,
        show_working_hours_live BOOLEAN DEFAULT true,
        show_attendance_timeline BOOLEAN DEFAULT true,
        allow_employee_notes BOOLEAN DEFAULT true,
        allow_attendance_regularization BOOLEAN DEFAULT true,
        allow_break_tracking BOOLEAN DEFAULT true,
        allow_manual_checkout BOOLEAN DEFAULT true,
        require_checkout_reason BOOLEAN DEFAULT false,
        enable_breaks BOOLEAN DEFAULT true,
        allow_multiple_breaks BOOLEAN DEFAULT true,
        max_breaks INTEGER,
        break_categories JSONB DEFAULT '["Lunch","Tea","Personal","Official","General"]',
        use_camera_for_face BOOLEAN DEFAULT true,
        require_rear_camera BOOLEAN DEFAULT false,
        allow_offline_attendance BOOLEAN DEFAULT false,
        offline_sync BOOLEAN DEFAULT false,
        background_gps BOOLEAN DEFAULT false,
        presence_engine_enabled BOOLEAN DEFAULT true,
        presence_grace_period_mins INTEGER DEFAULT 30,
        presence_heartbeat_interval_sec INTEGER DEFAULT 60,
        auto_checkout_delay_mins INTEGER DEFAULT 15,
        auto_checkout_confidence_threshold INTEGER DEFAULT 40,
        max_session_duration_hours INTEGER DEFAULT 14,
        enable_browser_heartbeat BOOLEAN DEFAULT true,
        enable_browser_activity_tracking BOOLEAN DEFAULT true,
        enable_gps_evaluation BOOLEAN DEFAULT true,
        enable_wifi_evaluation BOOLEAN DEFAULT false,
        enable_face_evaluation BOOLEAN DEFAULT true,
        ignore_gps_during_break BOOLEAN DEFAULT true,
        overtime_threshold_mins INTEGER DEFAULT 0,
        effective_from TIMESTAMP,
        updated_at TIMESTAMP DEFAULT NOW(),
        updated_by_user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // ALTER TABLE for presence columns in case table was previously created
    try { await db.execute(sql`ALTER TABLE attendance_preferences ADD COLUMN IF NOT EXISTS presence_engine_enabled BOOLEAN DEFAULT true;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_preferences ADD COLUMN IF NOT EXISTS presence_grace_period_mins INTEGER DEFAULT 30;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_preferences ADD COLUMN IF NOT EXISTS presence_heartbeat_interval_sec INTEGER DEFAULT 60;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_preferences ADD COLUMN IF NOT EXISTS auto_checkout_delay_mins INTEGER DEFAULT 15;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_preferences ADD COLUMN IF NOT EXISTS auto_checkout_confidence_threshold INTEGER DEFAULT 40;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_preferences ADD COLUMN IF NOT EXISTS max_session_duration_hours INTEGER DEFAULT 14;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_preferences ADD COLUMN IF NOT EXISTS enable_browser_heartbeat BOOLEAN DEFAULT true;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_preferences ADD COLUMN IF NOT EXISTS enable_browser_activity_tracking BOOLEAN DEFAULT true;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_preferences ADD COLUMN IF NOT EXISTS enable_gps_evaluation BOOLEAN DEFAULT true;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_preferences ADD COLUMN IF NOT EXISTS enable_wifi_evaluation BOOLEAN DEFAULT false;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_preferences ADD COLUMN IF NOT EXISTS enable_face_evaluation BOOLEAN DEFAULT true;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_preferences ADD COLUMN IF NOT EXISTS ignore_gps_during_break BOOLEAN DEFAULT true;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_preferences ADD COLUMN IF NOT EXISTS overtime_threshold_mins INTEGER DEFAULT 0;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }
    try { await db.execute(sql`ALTER TABLE attendance_preferences ADD COLUMN IF NOT EXISTS allow_manual_attendance_freeze BOOLEAN DEFAULT true;`); } catch(e){ logger.warn('boot schema-sync: statement failed', { error: (e as any)?.message }); }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attendance_preference_history (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id) NOT NULL,
        changed_by_user_id INTEGER REFERENCES users(id) NOT NULL,
        changed_by_name TEXT NOT NULL,
        field_name TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        ip_address TEXT,
        device_info TEXT,
        effective_from TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS presence_evaluations (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id) NOT NULL,
        user_id INTEGER REFERENCES users(id) NOT NULL,
        attendance_log_id INTEGER REFERENCES attendance_logs(id),
        state TEXT NOT NULL,
        confidence_score REAL NOT NULL,
        signals_evaluated JSONB NOT NULL,
        decision TEXT NOT NULL,
        reason TEXT NOT NULL,
        policy_version TEXT DEFAULT 'v1.0',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS presence_warnings (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id) NOT NULL,
        user_id INTEGER REFERENCES users(id) NOT NULL,
        attendance_log_id INTEGER REFERENCES attendance_logs(id),
        warned_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // ------------------------------------------------------------------
    // SmartTeams Federation Provider API (/v1/federation/*) — additive
    // tables only, same CREATE TABLE IF NOT EXISTS pattern as everything
    // above. See packages/database/src/schema.ts's matching block for the
    // Drizzle definitions and field-by-field comments.
    // ------------------------------------------------------------------
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS federation_clients (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id),
        name TEXT NOT NULL,
        company TEXT,
        description TEXT,
        client_id TEXT NOT NULL UNIQUE,
        client_secret_hash TEXT NOT NULL,
        app_uuid TEXT,
        public_identifier TEXT,
        environment TEXT NOT NULL DEFAULT 'sandbox',
        scopes JSONB NOT NULL DEFAULT '["attendance.read","leave.read","payroll.read","employee.read"]',
        grant_types JSONB DEFAULT '["client_credentials","authorization_code","refresh_token"]',
        pkce_required BOOLEAN NOT NULL DEFAULT TRUE,
        redirect_uris JSONB DEFAULT '[]',
        allowed_origins JSONB DEFAULT '[]',
        logo_url TEXT,
        contact_email TEXT,
        webhook_url TEXT,
        webhook_events JSONB DEFAULT '[]',
        webhook_status TEXT NOT NULL DEFAULT 'active',
        token_lifetime_seconds INTEGER NOT NULL DEFAULT 3600,
        refresh_token_policy TEXT NOT NULL DEFAULT 'sliding',
        credential_history JSONB DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        last_used_at TIMESTAMP,
        revoked_at TIMESTAMP,
        created_by_user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // Ensure existing deployments allow null tenant_id and have missing columns
    try { await db.execute(sql`ALTER TABLE federation_clients ALTER COLUMN tenant_id DROP NOT NULL;`); } catch (e) {}
    try { await db.execute(sql`ALTER TABLE federation_clients ADD COLUMN IF NOT EXISTS company TEXT;`); } catch (e) {}
    try { await db.execute(sql`ALTER TABLE federation_clients ADD COLUMN IF NOT EXISTS description TEXT;`); } catch (e) {}
    try { await db.execute(sql`ALTER TABLE federation_clients ADD COLUMN IF NOT EXISTS app_uuid TEXT;`); } catch (e) {}
    try { await db.execute(sql`ALTER TABLE federation_clients ADD COLUMN IF NOT EXISTS public_identifier TEXT;`); } catch (e) {}
    try { await db.execute(sql`ALTER TABLE federation_clients ADD COLUMN IF NOT EXISTS grant_types JSONB DEFAULT '["client_credentials","authorization_code","refresh_token"]';`); } catch (e) {}
    try { await db.execute(sql`ALTER TABLE federation_clients ADD COLUMN IF NOT EXISTS pkce_required BOOLEAN DEFAULT TRUE;`); } catch (e) {}
    try { await db.execute(sql`ALTER TABLE federation_clients ADD COLUMN IF NOT EXISTS redirect_uris JSONB DEFAULT '[]';`); } catch (e) {}
    try { await db.execute(sql`ALTER TABLE federation_clients ADD COLUMN IF NOT EXISTS allowed_origins JSONB DEFAULT '[]';`); } catch (e) {}
    try { await db.execute(sql`ALTER TABLE federation_clients ADD COLUMN IF NOT EXISTS logo_url TEXT;`); } catch (e) {}
    try { await db.execute(sql`ALTER TABLE federation_clients ADD COLUMN IF NOT EXISTS contact_email TEXT;`); } catch (e) {}
    try { await db.execute(sql`ALTER TABLE federation_clients ADD COLUMN IF NOT EXISTS webhook_url TEXT;`); } catch (e) {}
    try { await db.execute(sql`ALTER TABLE federation_clients ADD COLUMN IF NOT EXISTS webhook_events JSONB DEFAULT '[]';`); } catch (e) {}
    try { await db.execute(sql`ALTER TABLE federation_clients ADD COLUMN IF NOT EXISTS webhook_status TEXT DEFAULT 'active';`); } catch (e) {}
    try { await db.execute(sql`ALTER TABLE federation_clients ADD COLUMN IF NOT EXISTS api_key TEXT;`); } catch (e) {}
    try { await db.execute(sql`ALTER TABLE federation_clients ADD COLUMN IF NOT EXISTS webhook_secret TEXT;`); } catch (e) {}
    try { await db.execute(sql`ALTER TABLE federation_clients ADD COLUMN IF NOT EXISTS rate_limit_per_min INTEGER DEFAULT 1000;`); } catch (e) {}
    try { await db.execute(sql`ALTER TABLE federation_clients ADD COLUMN IF NOT EXISTS api_version TEXT DEFAULT 'v1.0';`); } catch (e) {}
    try { await db.execute(sql`ALTER TABLE federation_clients ADD COLUMN IF NOT EXISTS is_marketplace_app BOOLEAN DEFAULT FALSE;`); } catch (e) {}
    try { await db.execute(sql`ALTER TABLE federation_clients ADD COLUMN IF NOT EXISTS rating TEXT DEFAULT '4.9';`); } catch (e) {}
    try { await db.execute(sql`ALTER TABLE federation_clients ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General';`); } catch (e) {}
    try { await db.execute(sql`ALTER TABLE federation_clients ADD COLUMN IF NOT EXISTS install_count INTEGER DEFAULT 0;`); } catch (e) {}

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tenant_federation_authorizations (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id) NOT NULL,
        client_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'authorized',
        authorized_scopes JSONB NOT NULL DEFAULT '["attendance.read","leave.read","employee.read"]',
        rejected_scopes JSONB DEFAULT '[]',
        connection_date TIMESTAMP DEFAULT NOW(),
        last_sync_at TIMESTAMP,
        sync_status TEXT DEFAULT 'healthy',
        token_expiry TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    try { await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS tenant_federation_auth_tenant_client_unique ON tenant_federation_authorizations (tenant_id, client_id);`); } catch (e) {}
    try { await db.execute(sql`ALTER TABLE tenant_federation_authorizations ADD COLUMN IF NOT EXISTS rejected_scopes JSONB DEFAULT '[]';`); } catch (e) {}

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS federation_tokens (
        id SERIAL PRIMARY KEY,
        client_id TEXT NOT NULL,
        tenant_id INTEGER REFERENCES tenants(id),
        access_token_hash TEXT NOT NULL,
        refresh_token_hash TEXT,
        scopes JSONB NOT NULL DEFAULT '[]',
        ip_address TEXT,
        issued_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        revoked_at TIMESTAMP,
        status TEXT NOT NULL DEFAULT 'active'
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS federation_webhook_deliveries (
        id SERIAL PRIMARY KEY,
        client_id TEXT NOT NULL,
        tenant_id INTEGER REFERENCES tenants(id),
        event_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        target_url TEXT NOT NULL,
        status_code INTEGER,
        response_time_ms INTEGER,
        delivery_status TEXT NOT NULL DEFAULT 'delivered',
        attempt_count INTEGER NOT NULL DEFAULT 1,
        payload JSONB,
        error_message TEXT,
        delivered_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS federation_external_id_mappings (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id) NOT NULL,
        entity_type TEXT NOT NULL,
        internal_id INTEGER NOT NULL,
        external_id TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    try { await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS federation_ext_id_entity_external_unique ON federation_external_id_mappings (entity_type, external_id);`); } catch (e) { console.error('Index sync failed (federation_ext_id_entity_external_unique):', e); }
    try { await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS federation_ext_id_entity_internal_unique ON federation_external_id_mappings (tenant_id, entity_type, internal_id);`); } catch (e) { console.error('Index sync failed (federation_ext_id_entity_internal_unique):', e); }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS federation_idempotency_keys (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id) NOT NULL,
        client_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        response_status INTEGER,
        response_body JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL
      );
    `);
    try { await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS federation_idempotency_client_key_unique ON federation_idempotency_keys (client_id, idempotency_key);`); } catch (e) { console.error('Index sync failed (federation_idempotency_client_key_unique):', e); }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS federation_webhook_outbox (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id) NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        schema_version TEXT NOT NULL DEFAULT '1.0',
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        aggregate_version INTEGER NOT NULL DEFAULT 1,
        occurred_at TIMESTAMP NOT NULL,
        business_date TEXT,
        data JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        delivery_attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TIMESTAMP,
        last_error TEXT,
        delivered_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    try { await db.execute(sql`CREATE INDEX IF NOT EXISTS federation_outbox_tenant_status_idx ON federation_webhook_outbox (tenant_id, status);`); } catch (e) { console.error('Index sync failed (federation_outbox_tenant_status_idx):', e); }
    try { await db.execute(sql`CREATE INDEX IF NOT EXISTS federation_outbox_tenant_created_idx ON federation_webhook_outbox (tenant_id, created_at);`); } catch (e) { console.error('Index sync failed (federation_outbox_tenant_created_idx):', e); }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS federation_signing_keys (
        id SERIAL PRIMARY KEY,
        key_id TEXT NOT NULL UNIQUE,
        public_key TEXT NOT NULL,
        private_key_ref TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        activated_at TIMESTAMP DEFAULT NOW(),
        retired_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS federation_webhook_subscriptions (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id) NOT NULL UNIQUE,
        callback_url TEXT NOT NULL,
        event_types JSONB,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        last_delivery_at TIMESTAMP,
        last_delivery_status TEXT
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS federation_employee_access_grants (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id) NOT NULL,
        user_id INTEGER REFERENCES users(id) NOT NULL UNIQUE,
        grant_version INTEGER NOT NULL DEFAULT 0,
        grants JSONB NOT NULL DEFAULT '[]',
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS federation_break_glass_audit (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id) NOT NULL,
        actor_user_id INTEGER REFERENCES users(id),
        reason TEXT NOT NULL,
        action TEXT NOT NULL,
        before_json JSONB,
        after_json JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Hot-path composite indexes (architecture audit, 2026-08-05) — Postgres
    // does not auto-index FK columns, and every list/lookup query above
    // filters by (tenant_id, ...), so without these the attendance/leave/
    // payroll endpoints degrade to sequential scans as tenants grow. Each
    // is wrapped individually, same as the ALTER TABLE statements above, so
    // one failing (e.g. table not yet created on a fresh boot ordering
    // issue) never blocks the rest of sync.
    try { await db.execute(sql`CREATE INDEX IF NOT EXISTS attendance_logs_tenant_user_created_idx ON attendance_logs (tenant_id, user_id, created_at);`); } catch (e) { console.error('Index sync failed (attendance_logs_tenant_user_created_idx):', e); }
    try { await db.execute(sql`CREATE INDEX IF NOT EXISTS attendance_logs_tenant_created_idx ON attendance_logs (tenant_id, created_at);`); } catch (e) { console.error('Index sync failed (attendance_logs_tenant_created_idx):', e); }
    try { await db.execute(sql`CREATE INDEX IF NOT EXISTS leave_requests_tenant_status_idx ON leave_requests (tenant_id, status);`); } catch (e) { console.error('Index sync failed (leave_requests_tenant_status_idx):', e); }
    try { await db.execute(sql`CREATE INDEX IF NOT EXISTS leave_requests_tenant_user_idx ON leave_requests (tenant_id, user_id);`); } catch (e) { console.error('Index sync failed (leave_requests_tenant_user_idx):', e); }
    try { await db.execute(sql`CREATE INDEX IF NOT EXISTS payroll_runs_tenant_year_month_idx ON payroll_runs (tenant_id, year, month);`); } catch (e) { console.error('Index sync failed (payroll_runs_tenant_year_month_idx):', e); }
    try { await db.execute(sql`CREATE INDEX IF NOT EXISTS payroll_adjustments_tenant_status_idx ON payroll_adjustments (tenant_id, status);`); } catch (e) { console.error('Index sync failed (payroll_adjustments_tenant_status_idx):', e); }
    try { await db.execute(sql`CREATE INDEX IF NOT EXISTS payroll_loans_tenant_status_idx ON payroll_loans (tenant_id, status);`); } catch (e) { console.error('Index sync failed (payroll_loans_tenant_status_idx):', e); }
    try { await db.execute(sql`CREATE INDEX IF NOT EXISTS payroll_advances_tenant_status_idx ON payroll_advances (tenant_id, status);`); } catch (e) { console.error('Index sync failed (payroll_advances_tenant_status_idx):', e); }
    try { await db.execute(sql`CREATE INDEX IF NOT EXISTS payroll_reimbursements_tenant_status_idx ON payroll_reimbursements (tenant_id, status);`); } catch (e) { console.error('Index sync failed (payroll_reimbursements_tenant_status_idx):', e); }
    try { await db.execute(sql`CREATE INDEX IF NOT EXISTS payroll_ledger_entries_tenant_year_month_idx ON payroll_ledger_entries (tenant_id, year, month);`); } catch (e) { console.error('Index sync failed (payroll_ledger_entries_tenant_year_month_idx):', e); }

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
    const email = process.env.SEED_SUPER_ADMIN_EMAIL || 'superadmin@example.com';
    const providedPassword = process.env.SEED_SUPER_ADMIN_PASSWORD;

    const existing = await db.select().from(schema.users).where(eq(schema.users.role, 'super_admin'));
    if (existing.length === 0) {
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
    } else if (providedPassword) {
      // Sync credentials to match .env if explicitly provided
      const adminUser = existing[0];
      const newHash = await hashPassword(providedPassword);
      await db.update(schema.users)
        .set({
          email,
          password: newHash,
          mustChangePassword: false,
        })
        .where(eq(schema.users.id, adminUser.id));
      console.log(`Super Admin credentials synced with .env: ${email}`);
    }
  } catch (err) {
    console.error('Failed to seed Super Admin account:', err);
  }
}
