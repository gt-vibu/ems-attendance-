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

export const DEFAULT_TENANT_TIMEZONE = DEFAULT_TIMEZONE;
