// Reverse geocoding via OpenStreetMap Nominatim — free, no API key, no billing.
//
// Turns (lat, lng) into a human-readable address for display in WFH approval
// screens/audit logs. This is genuinely optional: nothing in the WFH
// eligibility/distance logic depends on the address string, only on the
// coordinates themselves, so the feature degrades gracefully (address stays
// null) rather than failing when the geocoder is slow or unavailable.
//
// IMPORTANT: attendance and home-registration must NEVER fail because reverse
// geocoding failed — every path here resolves to a value or null, never throws.
//
// Public signature is unchanged from the previous Google-Maps implementation,
// so callers (server.ts) need no changes.

export interface ReverseGeocodeResult {
  address: string;
}

// Nominatim usage policy (https://operations.osmfoundation.org/policies/nominatim/):
//   - at most ~1 request per second
//   - a valid, identifying User-Agent is REQUIRED
//   - bulk/heavy users should self-host
// This app only geocodes the occasional one-time home registration, well within
// the acceptable range, and further protects the service with throttling +
// caching below. Point NOMINATIM_URL at a self-hosted instance to lift limits.
const NOMINATIM_URL = (process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org').replace(/\/+$/, '');
const USER_AGENT = process.env.NOMINATIM_USER_AGENT
  || 'SmartTeams-AMSSS/1.0 (attendance app; WFH home-address reverse geocoding)';
const REQUEST_TIMEOUT_MS = 4000;
const MIN_INTERVAL_MS = 1100; // keep comfortably under 1 req/sec
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // a home location's address is stable

// --- In-memory cache, keyed by coords rounded to ~11m (4 decimal places) ---
type CacheEntry = { value: ReverseGeocodeResult | null; expires: number };
const cache = new Map<string, CacheEntry>();
function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

// --- Serialize + throttle outbound requests to honor the 1 req/sec policy ---
let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();
function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
  };
  const result = queue.then(run, run);
  // Keep the chain alive even if a call rejects, so one failure doesn't wedge
  // every subsequent request.
  queue = result.then(() => undefined, () => undefined);
  return result;
}

export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const key = cacheKey(lat, lng);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  try {
    const value = await throttle(() => fetchFromNominatim(lat, lng));
    cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (err: any) {
    // Never throw — the caller must keep working with coordinates only.
    console.error('[geocoding] Nominatim reverse geocode failed:', err?.message || err);
    return null;
  }
}

async function fetchFromNominatim(lat: number, lng: number): Promise<ReverseGeocodeResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `${NOMINATIM_URL}/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const address = data?.display_name;
    return typeof address === 'string' && address.trim() ? { address } : null;
  } finally {
    clearTimeout(timer);
  }
}
