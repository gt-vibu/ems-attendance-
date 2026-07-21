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

    // Company-wide KYC toggle and first-login branch-setup-wizard flag.
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS kyc_enabled BOOLEAN DEFAULT true;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS branch_setup_completed BOOLEAN DEFAULT false;`); } catch(e){}

    // Company-wide policy announcement banner, admin-editable (gated behind
    // the tenant.policy.manage privilege), shown on both admin and employee dashboards.
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS policy_announcement TEXT;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS policy_announcement_updated_at TIMESTAMP;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS documents_enabled BOOLEAN DEFAULT false;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS password_expiry_days INTEGER DEFAULT 0;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS idle_timeout_minutes INTEGER DEFAULT 0;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS attendance_retention_months INTEGER DEFAULT 0;`); } catch(e){}

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
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id);`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS shift_id INTEGER REFERENCES shifts(id);`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS designation TEXT;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS employment_type TEXT DEFAULT 'full_time';`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id INTEGER REFERENCES users(id);`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_joining TEXT;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_status TEXT DEFAULT 'active';`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP DEFAULT NOW();`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_history JSONB;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS data_erased_at TIMESTAMP;`); } catch(e){}

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

    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS break_type TEXT DEFAULT 'General';`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS start_lat REAL;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS start_lng REAL;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS end_lat REAL;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS end_lng REAL;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS is_violation BOOLEAN DEFAULT false;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS outside_geofence BOOLEAN DEFAULT false;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE break_sessions ADD COLUMN IF NOT EXISTS note TEXT;`); } catch(e){}

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
    try { await db.execute(sql`ALTER TABLE attendance_alerts ADD COLUMN IF NOT EXISTS escalation_level INTEGER NOT NULL DEFAULT 0;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE attendance_alerts ADD COLUMN IF NOT EXISTS current_assignee_user_id INTEGER REFERENCES users(id);`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE attendance_alerts ADD COLUMN IF NOT EXISTS last_assigned_at TIMESTAMP DEFAULT NOW();`); } catch(e){}

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
    try { await db.execute(sql`ALTER TABLE leave_policies ADD COLUMN IF NOT EXISTS accrual_enabled BOOLEAN NOT NULL DEFAULT false;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE leave_policies ADD COLUMN IF NOT EXISTS carry_forward_enabled BOOLEAN NOT NULL DEFAULT false;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE leave_policies ADD COLUMN IF NOT EXISTS max_carry_forward_days REAL NOT NULL DEFAULT 0;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE leave_policies ADD COLUMN IF NOT EXISTS encashment_enabled BOOLEAN NOT NULL DEFAULT false;`); } catch(e){}

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
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS statutory_compliance_enabled BOOLEAN DEFAULT false;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS pf_enabled BOOLEAN DEFAULT false;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS pf_employee_rate_percent REAL NOT NULL DEFAULT 12;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS pf_employer_rate_percent REAL NOT NULL DEFAULT 12;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS pf_wage_ceiling REAL NOT NULL DEFAULT 15000;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS esi_enabled BOOLEAN DEFAULT false;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS esi_employee_rate_percent REAL NOT NULL DEFAULT 0.75;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS esi_employer_rate_percent REAL NOT NULL DEFAULT 3.25;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS esi_wage_ceiling REAL NOT NULL DEFAULT 21000;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS professional_tax_enabled BOOLEAN DEFAULT false;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS professional_tax_slabs JSONB DEFAULT '[]';`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS tds_enabled BOOLEAN DEFAULT false;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS income_tax_slabs JSONB DEFAULT '[{"upTo":300000,"ratePercent":0},{"upTo":600000,"ratePercent":5},{"upTo":900000,"ratePercent":10},{"upTo":1200000,"ratePercent":15},{"upTo":1500000,"ratePercent":20},{"upTo":null,"ratePercent":30}]';`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS tds_standard_deduction REAL NOT NULL DEFAULT 50000;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS statutory_basic_percent_of_gross REAL NOT NULL DEFAULT 50;`); } catch(e){}

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
    try { await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS payroll_runs_user_period_unique ON payroll_runs (user_id, year, month);`); } catch(e){}

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
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id);`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS checkout_at TIMESTAMP;`); } catch(e){}
    try { await db.execute(sql`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS worked_minutes REAL;`); } catch(e){}

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
