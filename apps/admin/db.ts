import { drizzle } from 'drizzle-orm/node-postgres';
import { getTableName as drizzleGetTableName } from 'drizzle-orm';
import pkg from 'pg';
const { Pool } = pkg;
import * as schema from '../../packages/database/src/schema';
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

import { fileURLToPath } from 'url';

// This file runs two different ways: bundled to CJS for production
// (esbuild, server.cjs — __dirname is defined there) and directly via tsx
// in dev (a real ESM module — __dirname is undefined, import.meta.url is
// the only way to know the file's own location). Both branches are live
// code, not dead code — neither can be deleted.
//
// esbuild's CJS-format build emits a warning ("import.meta is not
// available with the cjs output format") because it sees the literal
// `import.meta` token in this file, even though this branch is
// provably unreachable in the CJS bundle (__dirname is always defined
// there). An indirect-eval trick to hide the token from esbuild's static
// scan was tried and reverted — Node refuses `import.meta` inside any
// eval, direct or indirect, with a hard SyntaxError, which broke the tsx
// dev path entirely. The correct fix is the officially supported one:
// tell esbuild to silence this specific, known-safe warning (see the
// `--log-override:empty-import-meta=silent` flag on the `build` script in
// package.json) rather than fighting the language to hide working code.
const currentDir = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

const envPaths = [
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), '../.env'),
  path.join(process.cwd(), '../../.env'),
  path.join(currentDir, '.env'),
  path.join(currentDir, '../.env'),
  path.join(currentDir, '../../.env'),
];
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}

// Managed Postgres providers (Neon, Supabase, Render, RDS) require TLS. Enable
// with SQL_SSL=true. rejectUnauthorized:false accepts the provider cert without
// bundling a CA file — the connection is still encrypted. Off by default so
// local Docker Postgres (no TLS) keeps working unchanged.
const sslConfig = process.env.SQL_SSL === 'true' ? { rejectUnauthorized: false } : false;

const pool = new Pool({
  host: process.env.SQL_HOST || '127.0.0.1',
  port: Number(process.env.SQL_PORT) || 5432,
  user: process.env.SQL_ADMIN_USER || 'postgres',
  password: process.env.SQL_ADMIN_PASSWORD || 'password',
  database: process.env.SQL_DB_NAME || 'postgres',
  ssl: sslConfig,
  // A remote managed DB (and a cold Neon compute waking from suspend) needs
  // more than the old 1s. detectPostgres() still retries with backoff on top.
  connectionTimeoutMillis: Number(process.env.SQL_CONNECT_TIMEOUT_MS) || 10000,
  max: 20, // enough headroom for many concurrent users without exhausting Postgres' own connection limit
  idleTimeoutMillis: 30000,
  keepAlive: true,
});

// node-postgres emits 'error' on the pool whenever an *idle* client's
// connection is dropped (Postgres restart, network blip, container
// recycle). With no listener, Node's default behavior for an unhandled
// EventEmitter 'error' is to throw — which would crash the entire server
// process and disconnect every user, not just whoever's query failed. This
// listener lets pg silently discard the broken client and replace it; the
// pool keeps serving new queries on healthy connections.
pool.on('error', (err) => {
  console.error('[db] Unexpected idle client error — connection dropped, pool will recover:', err.message);
});

const realDb = drizzle(pool, { schema });

// Whether to use real Postgres vs. the local JSON fallback is decided once,
// at startup, by actually trying to connect — not by string-matching
// SQL_HOST (a prior version compared it against the literal '127.0.0.1',
// which meant a correctly-configured local Postgres was *always* treated as
// "not configured" and silently ignored in favor of the fallback, even when
// perfectly reachable). Resolved by detectPostgres() before any query runs;
// see startServer() in server.ts.
let postgresAvailable: boolean | null = null;

export async function detectPostgres(): Promise<boolean> {
  if (postgresAvailable !== null) return postgresAvailable;

  // Retry with backoff instead of a single 1s-timeout attempt: a freshly
  // started Postgres container (e.g. `docker compose up -d` right before
  // the app boots) can take a few seconds to accept connections. Without
  // retries, that race would permanently pin the app to the JSON fallback
  // for the rest of the process lifetime even though Postgres comes up
  // moments later.
  const maxAttempts = 5;
  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await pool.query('SELECT 1');
      try { await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_exit TEXT;'); } catch(e){}
      postgresAvailable = true;
      console.log('[db] Connected to Postgres — using it as the datastore.');
      return postgresAvailable;
    } catch (err: any) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }

  // In production, the JSON fallback is never acceptable: it has no locking,
  // no durability guarantees, and no multi-instance safety, so quietly
  // switching to it would risk silent data corruption/loss that admins have
  // no way to notice. Fail loudly and refuse to start instead — a hard crash
  // on boot is far safer than serving live traffic off a flat file.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `FATAL: Postgres not reachable after ${maxAttempts} attempts (${lastErr?.message}). ` +
      `Refusing to start in production with the JSON fallback datastore. ` +
      `Check SQL_HOST/SQL_PORT/credentials and that Postgres is running.`
    );
  }

  postgresAvailable = false;
  console.warn(`[db] Postgres not reachable after ${maxAttempts} attempts (${lastErr?.message}) — falling back to the local JSON store (${path.join(process.cwd(), 'db_fallback.json')}).`);
  console.warn('[db] WARNING: the JSON fallback is a dev/demo convenience only, not a durable database — start Postgres for anything you need to keep.');
  return postgresAvailable;
}

// True once detectPostgres() has confirmed a live Postgres connection. Callers
// that must behave differently on the JSON fallback use this (e.g. scheduler
// leader-election, which relies on Postgres advisory locks).
export function isUsingPostgres(): boolean {
  return postgresAvailable === true;
}

// --- Scheduler leader election ---------------------------------------------
// When the app runs as multiple instances behind a load balancer, the
// in-process background scheduler (break scans, daily crons, alert emails)
// must run on exactly ONE instance — otherwise every replica fires the same
// jobs, sending duplicate emails and doing redundant work. We coordinate with
// a Postgres *session-level advisory lock* held on a dedicated connection:
// whichever instance holds the lock is the leader. If that instance dies its
// session ends, Postgres releases the lock automatically, and another instance
// acquires it on its next attempt. No extra infrastructure (Redis, etc.).
const SCHEDULER_ADVISORY_LOCK_KEY = 4820157; // arbitrary app-unique constant
let schedulerLockClient: any = null;

export async function tryAcquireSchedulerLeadership(): Promise<boolean> {
  // The JSON fallback is single-instance by definition — no coordination
  // needed, and it has no advisory locks anyway.
  if (postgresAvailable !== true) return true;

  try {
    if (!schedulerLockClient) {
      schedulerLockClient = await pool.connect();
      schedulerLockClient.on('error', () => {
        // Dedicated connection dropped — surrender our claim so another
        // instance can take over. A fresh client is checked out on retry.
        try { schedulerLockClient?.release(); } catch { /* already gone */ }
        schedulerLockClient = null;
      });
    }
    const res = await schedulerLockClient.query(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [SCHEDULER_ADVISORY_LOCK_KEY]
    );
    return res.rows?.[0]?.locked === true;
  } catch {
    try { schedulerLockClient?.release(); } catch { /* best effort */ }
    schedulerLockClient = null;
    return false;
  }
}

// --- Boot-time schema-sync mutual exclusion ---------------------------------
// On a rolling/blue-green/autoscaled deploy, N replicas can start at once and
// all run verifyAndSyncDatabase()'s CREATE TABLE IF NOT EXISTS / ALTER TABLE
// ADD COLUMN IF NOT EXISTS statements concurrently against the same DB.
// Postgres DDL under concurrent IF NOT EXISTS checks isn't fully race-proof
// (two sessions can both pass the "does it exist" check before either commits
// the create), so this takes a BLOCKING session-level advisory lock for the
// duration of the sync — a different key from the scheduler's, held only
// while syncing rather than for the process's whole lifetime, then released
// so the connection returns to the pool. Every replica still runs the sync
// (each is a no-op the second+ time thanks to IF NOT EXISTS), they just never
// do it concurrently with each other.
const BOOT_SYNC_ADVISORY_LOCK_KEY = 4820158; // arbitrary app-unique constant, one more than the scheduler's

export async function withBootSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  if (postgresAvailable !== true) return fn(); // JSON fallback: single-instance by definition, nothing to coordinate

  const client = await pool.connect();
  try {
    // Blocking acquire (not pg_try_advisory_lock) — a second replica should
    // WAIT for the first to finish syncing, not skip its own sync attempt.
    await client.query('SELECT pg_advisory_lock($1)', [BOOT_SYNC_ADVISORY_LOCK_KEY]);
    return await fn();
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [BOOT_SYNC_ADVISORY_LOCK_KEY]); } catch { /* connection may already be gone */ }
    client.release();
  }
}

// Cleanly release DB resources on shutdown (see the SIGTERM/SIGINT handlers in
// server.ts). Releasing the advisory-lock connection lets a surviving instance
// pick up scheduler leadership immediately instead of after a TCP timeout.
export async function closeDb(): Promise<void> {
  try { schedulerLockClient?.release(); } catch { /* best effort */ }
  schedulerLockClient = null;
  try { await pool.end(); } catch { /* best effort */ }
}

// Path for local fallback JSON file
const DB_FILE = path.join(process.cwd(), 'db_fallback.json');

function readLocalDB() {
  if (!fs.existsSync(DB_FILE)) {
    // Never hardcode real credentials in source. Use env vars if the
    // operator supplied them; otherwise generate a strong one-time password,
    // hash it, force a change on first login, and print the plaintext to the
    // console ONCE so whoever is standing up this environment can log in.
    const seedEmail = process.env.SEED_SUPER_ADMIN_EMAIL || 'superadmin@example.com';
    const seedPasswordPlain = process.env.SEED_SUPER_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    const seedPasswordHash = bcrypt.hashSync(seedPasswordPlain, 12);
    const adminUid = crypto.randomUUID();
    // Only force a password change when we had to invent a random throwaway
    // password. If explicitly chosen via env vars, respect it and let them
    // log straight in with it.
    const seedMustChangePassword = !process.env.SEED_SUPER_ADMIN_PASSWORD;

    if (!process.env.SEED_SUPER_ADMIN_PASSWORD) {
      console.log('\n==================================================');
      console.log('  First-run bootstrap: local fallback DB created.');
      console.log(`  Super Admin email:    ${seedEmail}`);
      console.log(`  Super Admin password: ${seedPasswordPlain}`);
      console.log('  (shown once — you will be required to change it on first login)');
      console.log('  Set SEED_SUPER_ADMIN_EMAIL / SEED_SUPER_ADMIN_PASSWORD in .env to control this.');
      console.log('==================================================\n');
    }

    const initialData = {
      tenants: [
        {
          id: 1,
          name: "Apex Logistics",
          adminUid: adminUid,
          admin_uid: adminUid,
          status: "active",
          wifiSsid: "Apex_HQ_Secure",
          wifi_ssid: "Apex_HQ_Secure",
          wifiCheckEnabled: false,
          wifi_check_enabled: false,
          locationLat: 37.7749,
          location_lat: 37.7749,
          locationLng: -122.4194,
          location_lng: -122.4194,
          locationRadiusMeters: 100,
          location_radius_meters: 100,
          shiftStart: "09:00",
          shift_start: "09:00",
          shiftEnd: "18:00",
          shift_end: "18:00",
          gracePeriodMins: 15,
          grace_period_mins: 15,
          dailyBreakBudgetMins: 60,
          daily_break_budget_mins: 60,
          createdAt: new Date().toISOString(),
          created_at: new Date().toISOString()
        }
      ],
      users: [
        {
          id: 1,
          uid: adminUid,
          email: seedEmail,
          password: seedPasswordHash,
          name: "Global Super Admin",
          tenantId: 1,
          tenant_id: 1,
          role: "super_admin",
          mustChangePassword: seedMustChangePassword,
          must_change_password: seedMustChangePassword,
          isKycCompleted: true,
          is_kyc_completed: true,
          createdAt: new Date().toISOString(),
          created_at: new Date().toISOString()
        }
      ],
      attendance_logs: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e: any) {
    // NEVER silently return an empty DB here — whatever operation triggered
    // this read would then write that empty shape straight back out via
    // writeLocalDB(), permanently destroying every user/tenant/log that was
    // in the file a moment ago. This is exactly how a torn/corrupted read
    // used to turn into silent, total data loss. Preserve the corrupted
    // file for recovery and fail loudly instead — a thrown error surfaces
    // as a 500 on whichever request hit it, which is far better than
    // quietly wiping the database.
    const backupPath = `${DB_FILE}.corrupted-${Date.now()}`;
    try { fs.copyFileSync(DB_FILE, backupPath); } catch { /* best-effort */ }
    throw new Error(`db_fallback.json is corrupted and could not be parsed (backed up to ${backupPath}): ${e.message}`);
  }
}

function writeLocalDB(data: any) {
  // Write-to-temp-then-rename instead of writing DB_FILE directly: rename
  // is atomic on the same filesystem, so a concurrent reader (e.g. a second
  // server process pointed at the same file) can never observe a
  // partially-written/truncated file mid-write and mistake it for
  // corruption — which is what used to trigger the silent-wipe bug above.
  const tmpFile = `${DB_FILE}.tmp-${process.pid}`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
  fs.renameSync(tmpFile, DB_FILE);
}

// Was previously checking `table?.name` first — which doesn't hold the SQL
// table name for a Drizzle Table object, it holds whatever COLUMN is
// literally named `name` (tenants.name, users.name, teams.name, ...),
// since PgTable exposes every column as a same-named property on the table
// object itself. Any table with a `name` column silently resolved to that
// column object instead of its real table name, which stringified to the
// literal key "[object Object]" in the JSON store — merging inserts/reads
// for every such table into one shared, wrong bucket instead of their own.
// drizzle-orm's own getTableName() reads the table's internal Symbol
// unambiguously and is exactly what this should have used from the start.
function getTableName(table: any): string {
  if (typeof table === 'string') return table;
  try {
    const name = drizzleGetTableName(table);
    if (name) return name;
  } catch { /* not a real Table object — fall through */ }
  const symbolName = table?.[Symbol.for('drizzle:Name')];
  if (symbolName) return symbolName;
  return 'unknown';
}

class QueryBuilder {
  private table: any;
  private whereClause: any = null;
  private orderByClause: any = null;
  private limitCount: number | null = null;
  private action: 'select' | 'insert' | 'update' | 'delete';
  private insertValues: any = null;
  private updateValues: any = null;
  private selectFields: any = null;
  private groupByClause: any = null;

  constructor(table: any, action: 'select' | 'insert' | 'update' | 'delete') {
    this.table = table;
    this.action = action;
  }

  setFields(fields: any) {
    this.selectFields = fields;
    return this;
  }

  from(table: any) {
    this.table = table;
    return this;
  }

  innerJoin(table: any, condition: any) {
    return this;
  }

  where(clause: any) {
    this.whereClause = clause;
    return this;
  }

  orderBy(clause: any) {
    this.orderByClause = clause;
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  // Scoped, not a general SQL aggregation engine: covers exactly the one
  // shape this codebase actually uses today — `.select({ col, count:
  // sql\`count(*)\` }).from(t).groupBy(col)` (see GET /api/super/tenants'
  // employee-count-per-tenant query). Groups the already-loaded rows by the
  // given column and, for any selected field that isn't a plain column
  // reference (i.e. a raw sql`` aggregate expression), reports the group's
  // row count under that field's key — the only aggregate this shape needs.
  groupBy(clause: any) {
    this.groupByClause = clause;
    return this;
  }

  values(val: any) {
    this.insertValues = val;
    return this;
  }

  set(val: any) {
    this.updateValues = val;
    return this;
  }

  returning() {
    return this;
  }

  async then(onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any) {
    try {
      const res = await this.execute();
      if (onfulfilled) return onfulfilled(res);
      return res;
    } catch (err) {
      if (onrejected) return onrejected(err);
      throw err;
    }
  }

  // A thenable needs .catch/.finally too, not just .then — this codebase's
  // fire-and-forget writes (e.g. authenticate.ts's throttled last-activity
  // heartbeat: `db.update(...).where(...).catch(() => {})`) call .catch()
  // directly on the query builder without ever awaiting it first. Without
  // this, every such call threw "catch is not a function" synchronously,
  // which — for the heartbeat specifically — broke authentication on every
  // single request once JSON-fallback mode was in use.
  catch(onrejected?: (reason: any) => any) {
    return this.then(undefined, onrejected);
  }

  finally(onfinally?: () => void) {
    return this.then(
      (value: any) => { onfinally?.(); return value; },
      (err: any) => { onfinally?.(); throw err; },
    );
  }

  private async execute() {
    const data = readLocalDB();
    const tableName = getTableName(this.table);
    const rows = data[tableName] || [];

    if (this.action === 'insert') {
      const valuesArray = Array.isArray(this.insertValues) ? this.insertValues : [this.insertValues];
      const insertedRows = [];
      for (const val of valuesArray) {
        const newRow: any = {
          id: rows.length + 1,
          createdAt: new Date().toISOString(),
          created_at: new Date().toISOString(),
          ...val
        };
        for (const [k, v] of Object.entries(val)) {
          const snake = this.camelToSnake(k);
          const camel = this.snakeToCamel(k);
          newRow[snake] = v;
          newRow[camel] = v;
        }
        rows.push(newRow);
        insertedRows.push(newRow);
      }
      data[tableName] = rows;
      writeLocalDB(data);
      return insertedRows;
    }

    if (this.action === 'update') {
      const updatedRows: any[] = [];
      const updatedRowsList = rows.map((row: any) => {
        if (this.matchesWhere(row)) {
          const updated = { ...row, ...this.updateValues };
          for (const [k, v] of Object.entries(this.updateValues)) {
            const snake = this.camelToSnake(k);
            const camel = this.snakeToCamel(k);
            updated[snake] = v;
            updated[camel] = v;
          }
          updatedRows.push(updated);
          return updated;
        }
        return row;
      });
      data[tableName] = updatedRowsList;
      writeLocalDB(data);
      return updatedRows;
    }

    // Default: SELECT
    let resultRows = [...rows];

    if (tableName === 'break_sessions') {
      const usersList = data['users'] || [];
      resultRows = resultRows.map((row: any) => {
        const u = usersList.find((usr: any) => usr.id === row.userId || usr.id === row.user_id);
        return {
          ...row,
          userName: u ? u.name : '',
          userEmail: u ? u.email : '',
          tenantId: u ? (u.tenantId || u.tenant_id) : 1
        };
      });
    }

    if (tableName === 'device_change_requests') {
      const usersList = data['users'] || [];
      resultRows = resultRows.map((row: any) => {
        const u = usersList.find((usr: any) => usr.id === row.userId || usr.id === row.user_id);
        return {
          ...row,
          userName: u ? u.name : '',
          userEmail: u ? u.email : '',
          userId: u ? u.id : row.userId
        };
      });
    }

    if (this.whereClause) {
      resultRows = resultRows.filter((row: any) => this.matchesWhere(row));
    }
    if (this.groupByClause) {
      resultRows = this.applyGroupBy(resultRows);
    }
    if (this.orderByClause) {
      resultRows.sort((a: any, b: any) => b.id - a.id);
    }
    if (this.limitCount !== null) {
      resultRows = resultRows.slice(0, this.limitCount);
    }
    return resultRows;
  }

  private resolveColumnName(colRef: any): string | null {
    if (!colRef) return null;
    if (typeof colRef === 'string') return colRef;
    return colRef.name || null;
  }

  private readColumnValue(row: any, colName: string | null): any {
    if (!colName || !row) return undefined;
    if (row[colName] !== undefined) return row[colName];
    const camel = this.snakeToCamel(colName);
    return row[camel];
  }

  private applyGroupBy(rows: any[]): any[] {
    const groupColName = this.resolveColumnName(this.groupByClause);
    const groups = new Map<string, any[]>();
    for (const row of rows) {
      const key = String(this.readColumnValue(row, groupColName));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    const fieldEntries = this.selectFields ? Object.entries(this.selectFields) : [];
    return Array.from(groups.values()).map((groupRows) => {
      const out: any = {};
      if (fieldEntries.length > 0) {
        for (const [alias, ref] of fieldEntries) {
          const refColName = this.resolveColumnName(ref);
          // A plain column reference (has a resolvable .name, e.g. the
          // groupBy key itself) is read off the group's first row. Anything
          // else — this fallback's one real use case is a raw sql`count(*)`
          // aggregate — reports the group's row count, the only aggregate
          // shape this codebase actually asks the fallback for.
          out[alias] = refColName ? this.readColumnValue(groupRows[0], refColName) : groupRows.length;
        }
      } else {
        out[groupColName || 'group'] = this.readColumnValue(groupRows[0], groupColName);
        out.count = groupRows.length;
      }
      return out;
    });
  }

  private extractConditions(clause: any, conditions: Array<{ column: string, value: any }> = []): Array<{ column: string, value: any }> {
    if (!clause) return conditions;

    if (clause.queryChunks) {
      const chunks = clause.queryChunks;
      
      let colName = '';
      let val: any = undefined;
      let foundColumn = false;
      let foundParam = false;

      for (const chunk of chunks) {
        if (chunk && chunk.table && chunk.name) {
          colName = chunk.name;
          foundColumn = true;
        } else if (chunk && typeof chunk === 'object') {
          if ('value' in chunk && chunk.value !== undefined && !Array.isArray(chunk.value)) {
            val = chunk.value;
            foundParam = true;
          } else if (chunk.queryChunks) {
            this.extractConditions(chunk, conditions);
          }
        }
      }

      if (foundColumn && foundParam) {
        conditions.push({ column: colName, value: val });
      }
    }
    
    return conditions;
  }

  private isOrQuery(clause: any): boolean {
    if (!clause) return false;
    if (clause.queryChunks) {
      for (const chunk of clause.queryChunks) {
        if (chunk && Array.isArray(chunk.value)) {
          const strVal = chunk.value.join(' ').toLowerCase();
          if (strVal.includes(' or ')) return true;
        }
        if (chunk && chunk.queryChunks) {
          if (this.isOrQuery(chunk)) return true;
        }
      }
    }
    return false;
  }

  private matchesWhere(row: any): boolean {
    if (!this.whereClause) return true;
    
    if (this.whereClause.colName) {
      const col = this.whereClause.colName;
      const rowVal = row[col] !== undefined ? row[col] : row[this.camelToSnake(col)];
      return String(rowVal) === String(this.whereClause.value);
    }

    // Try to parse raw SQL templates
    if (this.whereClause.queryChunks && this.whereClause.queryChunks.length > 0) {
      const chunks = this.whereClause.queryChunks;
      const chunk0 = chunks[0];
      if (chunk0 && Array.isArray(chunk0.value)) {
        const chunk0Val = chunk0.value.join(' ');
        
        // created_at >= or timestamp >=
        if (chunk0Val.includes('created_at >=') || chunk0Val.includes('timestamp >=') || chunk0Val.includes('created_at >=') || chunk0Val.includes('timestamp >=')) {
          const dateLimit = chunks[1];
          const dateLimitVal = dateLimit instanceof Date ? dateLimit : (dateLimit?.value || dateLimit);
          const col = chunk0Val.includes('created_at') ? 'created_at' : 'timestamp';
          const rowVal = row[col] ? new Date(row[col]) : new Date(row[this.snakeToCamel(col)]);
          return rowVal.getTime() >= new Date(dateLimitVal).getTime();
        }

        // action IN
        if (chunk0Val.includes('action IN') || chunk0Val.includes('action in')) {
          const rowAction = row['action'];
          if (!rowAction) return false;
          const fullSqlString = chunks.map((c: any) => c.value ? (Array.isArray(c.value) ? c.value.join('') : String(c.value)) : '').join(' ');
          return fullSqlString.includes(rowAction);
        }

        // user_id IS NULL
        if (chunk0Val.includes('user_id IS NULL') || chunk0Val.includes('user_id is null')) {
          return row['user_id'] === null || row['userId'] === null;
        }
      }
    }

    try {
      const conditions: Array<{ column: string, value: any }> = [];
      this.extractConditions(this.whereClause, conditions);

      if (conditions.length > 0) {
        const isOr = this.isOrQuery(this.whereClause);
        
        const results = conditions.map(cond => {
          const col = cond.column;
          const camelCol = this.snakeToCamel(col);
          const snakeCol = this.camelToSnake(col);
          const rowVal = row[col] !== undefined ? row[col] : (row[camelCol] !== undefined ? row[camelCol] : row[snakeCol]);
          
          if (rowVal === undefined) return false;
          return String(rowVal) === String(cond.value);
        });

        if (isOr) {
          return results.some(r => r === true);
        } else {
          return results.every(r => r === true);
        }
      }
    } catch (e) {
      console.error('Error in matchesWhere clause parsing:', e);
    }

    try {
      const colName = this.whereClause.left?.name || this.whereClause.left?.columnName;
      const value = this.whereClause.right;
      if (colName) {
        const camelColName = this.snakeToCamel(colName);
        const rowVal = row[colName] !== undefined ? row[colName] : (row[camelColName] !== undefined ? row[camelColName] : row[this.camelToSnake(colName)]);
        return String(rowVal) === String(value);
      }
    } catch (e) {}

    return false;
  }

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }

  private snakeToCamel(str: string): string {
    return str.replace(/_([a-z])/g, g => g[1].toUpperCase());
  }
}

// Same select/insert/update/delete/execute surface as the fallback `db`
// proxy below, handed to a db.transaction() callback as its `tx` argument.
// The JSON fallback has no real atomicity — every QueryBuilder write already
// commits straight to disk the moment it runs — but callers (federation
// domain routes, tenant deletion, payroll batch calculation) still need
// `tx.select/insert/update/delete` to exist and work, or the callback itself
// throws immediately. Without this, `db.transaction` fell through to the
// real Drizzle instance bound to the real (unconfigured) Postgres pool,
// which threw ECONNREFUSED as soon as anything inside the callback ran —
// even though every other query on the same request was correctly using
// the JSON fallback.
function makeFallbackTxHandle(): any {
  return {
    select: (fields?: any) => new QueryBuilder(null, 'select').setFields(fields),
    insert: (table: any) => new QueryBuilder(table, 'insert'),
    update: (table: any) => new QueryBuilder(table, 'update'),
    delete: (table: any) => new QueryBuilder(table, 'delete'),
    execute: async (_sqlQuery: any) => ({ rows: [] }),
  };
}

export const db = new Proxy({} as any, {
  get(target, prop) {
    // Resolved once at startup by detectPostgres() actually attempting a
    // connection (see startServer() in server.ts, which awaits it before
    // any query runs). Defaults to the JSON fallback only in the narrow
    // window before that resolves.
    const isPostgresConfigured = postgresAvailable === true;

    if (isPostgresConfigured) {
      return (realDb as any)[prop];
    } else {
      if (prop === 'select') {
        return (fields?: any) => {
          return new QueryBuilder(null, 'select').setFields(fields);
        };
      }
      if (prop === 'insert') {
        return (table: any) => {
          return new QueryBuilder(table, 'insert');
        };
      }
      if (prop === 'update') {
        return (table: any) => {
          return new QueryBuilder(table, 'update');
        };
      }
      if (prop === 'delete') {
        return (table: any) => {
          return new QueryBuilder(table, 'delete');
        };
      }
      if (prop === 'execute') {
        return async (sqlQuery: any) => {
          return { rows: [] };
        };
      }
      if (prop === 'transaction') {
        return async (callback: (tx: any) => Promise<any>) => {
          return await callback(makeFallbackTxHandle());
        };
      }
      return (realDb as any)[prop];
    }
  }
});

export { schema };
