// Every "what calendar day is this" computation in this app should key off
// the TENANT's timezone, not the Node process's ambient local time — see
// tenants.timezone (schema.ts) and this session's EmployeeDetailPanel.tsx /
// dateUtils.ts fix for the display-side version of the same bug class. This
// is the server-side, tenant-aware equivalent: given a tenant row (or just
// its timezone string), get "now" and a 'YYYY-MM-DD' key as that tenant
// actually experiences them, regardless of what timezone the server itself
// is running in.

const DEFAULT_TIMEZONE = 'Asia/Kolkata';

function resolveTimezone(tenant: { timezone?: string | null } | string | null | undefined): string {
  const tz = typeof tenant === 'string' ? tenant : tenant?.timezone;
  return tz || DEFAULT_TIMEZONE;
}

// The tenant's current wall-clock time, as a real Date whose UTC instant is
// unchanged but whose local getters (getHours/getDate/etc., if read naively)
// would be wrong — callers should use tenantDateKey()/tenantParts() below
// instead of Date's own local getters, which only reflect the SERVER's zone.
export function tenantNow(tenant: { timezone?: string | null } | string | null | undefined): Date {
  return new Date();
}

// Local calendar date in the tenant's timezone, 'YYYY-MM-DD' — the
// tenant-aware equivalent of the local-time dateUtils.ts helper added
// earlier this session, for server code that needs the COMPANY's calendar
// day (payroll periods, freeze windows) rather than the server process's own
// local day.
export function tenantDateKey(tenant: { timezone?: string | null } | string | null | undefined, date: Date = new Date()): string {
  const timeZone = resolveTimezone(tenant);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find(p => p.type === 'year')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  const d = parts.find(p => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

// Year/month/day/hour/minute in the tenant's timezone — for logic that needs
// more than just the date key (e.g. "is it past 11:00 in the tenant's local
// time" for the absent-marker cron, once that's migrated to be tenant-aware).
export function tenantParts(tenant: { timezone?: string | null } | string | null | undefined, date: Date = new Date()) {
  const timeZone = resolveTimezone(tenant);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') === 24 ? 0 : get('hour'), minute: get('minute') };
}

// Start-of-day (00:00:00) for a given tenant-local date, as a UTC Date —
// useful for `created_at >= X` range queries that need to align with the
// tenant's calendar day rather than the server's.
export function tenantStartOfDay(tenant: { timezone?: string | null } | string | null | undefined, date: Date = new Date()): Date {
  const timeZone = resolveTimezone(tenant);
  const dateKey = tenantDateKey(tenant, date);
  // Find the UTC instant that formats to `dateKey T00:00` in the tenant's
  // timezone by resolving the UTC offset at that moment via a round-trip
  // through the formatter, since Intl doesn't expose offsets directly.
  const naiveUtcMidnight = new Date(`${dateKey}T00:00:00.000Z`);
  const asTenantParts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(naiveUtcMidnight);
  const get = (type: string) => Number(asTenantParts.find(p => p.type === type)?.value);
  const tenantMidnightAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') === 24 ? 0 : get('hour'), get('minute'), get('second'));
  const offsetMs = tenantMidnightAsUtc - naiveUtcMidnight.getTime();
  return new Date(naiveUtcMidnight.getTime() - offsetMs);
}

// General-purpose building block tenantStartOfDay is a special case of
// (hh=mm=0) — given a 'YYYY-MM-DD' date string and an HH:MM tenant-LOCAL
// time, returns the corresponding UTC Date. Anchoring the date-string
// resolution at UTC midday (rather than UTC midnight) avoids any ambiguity
// about which tenant-local calendar day a bare 'YYYY-MM-DD' string means
// when the tenant's UTC offset would otherwise push midnight into the
// adjacent day.
export function tenantDateTime(tenant: { timezone?: string | null } | string | null | undefined, dateStr: string, hh: number, mm: number): Date {
  const timeZone = resolveTimezone(tenant);
  const [year, month, day] = dateStr.split('-').map(Number);
  const naiveUtc = new Date(Date.UTC(year, (month || 1) - 1, day || 1, hh, mm, 0, 0));
  const asTenantParts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(naiveUtc);
  const get = (type: string) => Number(asTenantParts.find(p => p.type === type)?.value);
  const tenantWallTimeAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') === 24 ? 0 : get('hour'), get('minute'), get('second'));
  const offsetMs = tenantWallTimeAsUtc - naiveUtc.getTime();
  return new Date(naiveUtc.getTime() - offsetMs);
}

// Tenant-local calendar-day boundaries as UTC Date range — the tenant-aware
// replacement for a naive `new Date(\`${date}T00:00:00.000Z\`)` UTC-midnight
// boundary, which silently disagrees with tenantDateKey()-based day
// bucketing (used everywhere else, e.g. attendanceDayStatus.ts) by however
// many hours the tenant's UTC offset is — the root cause of "a correction
// targeting Monday actually touches/misses Tuesday's record" for any
// non-UTC tenant.
export function tenantDayRange(tenant: { timezone?: string | null } | string | null | undefined, dateStr: string): { start: Date; end: Date } {
  const start = tenantDateTime(tenant, dateStr, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}

// Human-readable date/time strings in the TENANT's timezone — the display-
// formatting equivalent of tenantDateKey()/tenantParts(). Plain
// `.toLocaleDateString()`/`.toLocaleTimeString()` with no explicit
// `timeZone` resolves to whatever zone the Node PROCESS happens to be
// running in, not the tenant's — used for any email/notification/alert
// body that shows a date or time to a tenant user, so the calendar day/
// clock time they see actually matches their own business timezone.
export function tenantDateLabel(tenant: { timezone?: string | null } | string | null | undefined, date: Date = new Date()): string {
  const timeZone = resolveTimezone(tenant);
  return new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

export function tenantTimeLabel(tenant: { timezone?: string | null } | string | null | undefined, date: Date = new Date()): string {
  const timeZone = resolveTimezone(tenant);
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(date);
}

export function tenantDateTimeLabel(tenant: { timezone?: string | null } | string | null | undefined, date: Date = new Date()): string {
  return `${tenantDateLabel(tenant, date)}, ${tenantTimeLabel(tenant, date)}`;
}

export const DEFAULT_TENANT_TIMEZONE = DEFAULT_TIMEZONE;
