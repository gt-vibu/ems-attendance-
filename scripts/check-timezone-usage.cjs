#!/usr/bin/env node
// Guards against the timezone bug class this repo spent a whole session
// fixing: business-date/day-boundary logic computed from the SERVER's
// local clock or raw UTC instead of the TENANT's configured timezone
// (tenants.timezone, via apps/admin/api/services/tenantTime.ts's
// tenantNow/tenantDateKey/tenantParts/tenantStartOfDay/tenantDateTime/
// tenantDayRange/tenantDateLabel/tenantTimeLabel/tenantTimeLabel helpers).
//
// This is NOT ESLint — there is no lint tooling anywhere in this repo yet,
// and adding one is a bigger decision than this single guardrail warrants.
// This is a plain grep-based check: fast, dependency-free, and runnable
// either manually (`node scripts/check-timezone-usage.cjs`) or wired into
// CI/a pre-commit hook later without needing any new devDependency.
//
// It only scans backend business-logic directories (routes/services/
// bootstrap) — frontend display-only formatting and pure elapsed-ms
// duration math are a different risk profile and produce too many false
// positives to check the same way.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCAN_DIRS = [
  'apps/admin/api/routes',
  'apps/admin/api/services',
  'apps/admin/api/bootstrap',
  'apps/admin/api/auth',
];

// Files that ARE the tenant-timezone helpers themselves, or that
// legitimately need a raw Date for a real instant (audit timestamps,
// elapsed-ms duration math) rather than a calendar-day decision — these are
// excluded rather than banned outright, since the goal is to catch new
// "compute today/this month the wrong way" code, not to ban Date entirely.
const EXCLUDE_FILES = new Set([
  'apps/admin/api/services/tenantTime.ts',
  'apps/admin/api/services/dateUtils.ts', // explicitly documents itself as server-local by design
]);

// Each pattern here is a real bug this codebase had, verbatim. If new code
// matches one of these, it is near-certainly the same mistake, not a
// legitimate new use case — these are not "avoid Date" style rules, they are
// literal reproductions of confirmed defects.
const BANNED_PATTERNS = [
  { re: /\.setHours\(\s*0,\s*0,\s*0,\s*0\s*\)/, label: "setHours(0,0,0,0) as a 'today' boundary — use tenantStartOfDay(tenant, date) instead" },
  { re: /new Date\(\)\.getUTCFullYear\(\)|now\.getUTCFullYear\(\)/, label: "getUTCFullYear() for 'what year is it now' — use tenantParts(tenant, now).year instead" },
  { re: /new Date\(\)\.getUTCMonth\(\)|now\.getUTCMonth\(\)/, label: "getUTCMonth() for 'what month is it now' — use tenantParts(tenant, now).month instead" },
  { re: /new Date\(\)\.getFullYear\(\)|now\.getFullYear\(\)\s*\|\|/, label: "getFullYear() as a server-local 'this year' default — use tenantParts(tenant, now).year instead" },
  { re: /toISOString\(\)\.slice\(0,\s*10\)/, label: "toISOString().slice(0,10) as a date key — use tenantDateKey(tenant, date) instead (this converts to UTC first, which silently shifts the calendar day for any non-UTC tenant)" },
  { re: /Date\.UTC\(year,\s*month/, label: "Date.UTC(year, month, ...) as a business-month boundary — use tenantDateTime(tenant, dateStr, hh, mm) or tenantDayRange(tenant, dateStr) instead" },
  { re: /new Date\(\)\.toLocaleDateString\(\)|new Date\(\)\.toLocaleTimeString\(|new Date\(\)\.toLocaleString\(\)/, label: "ambient toLocaleDateString/toLocaleTimeString/toLocaleString() (no explicit timeZone) in a notification/email/report body — use tenantDateLabel(tenant, date)/tenantTimeLabel(tenant, date)/tenantDateTimeLabel(tenant, date) instead" },
];

let violations = 0;

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(full);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
      checkFile(full);
    }
  }
}

function checkFile(filePath) {
  const relPath = path.relative(ROOT, filePath).replace(/\\/g, '/');
  if (EXCLUDE_FILES.has(relPath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    for (const { re, label } of BANNED_PATTERNS) {
      if (re.test(line)) {
        console.error(`${relPath}:${idx + 1}: ${label}`);
        console.error(`    ${line.trim()}`);
        violations++;
      }
    }
  });
}

for (const dir of SCAN_DIRS) {
  const full = path.join(ROOT, dir);
  if (fs.existsSync(full)) walk(full);
}

if (violations > 0) {
  console.error(`\n${violations} timezone-bug-pattern match(es) found. See apps/admin/api/services/tenantTime.ts for the tenant-aware replacements.`);
  process.exit(1);
} else {
  console.log('No timezone-bug patterns found in backend routes/services/bootstrap.');
}
