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

export interface ForwardGeocodeResult {
  lat: number;
  lng: number;
  displayName: string;
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

// --- In-memory cache, keyed by coords (reverse) or normalized query (forward) ---
type CacheEntry = { value: ReverseGeocodeResult | ForwardGeocodeResult | ForwardGeocodeResult[] | null; expires: number };
const cache = new Map<string, CacheEntry>();
function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}
function forwardCacheKey(query: string): string {
  return `fwd:${query.trim().toLowerCase()}`;
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
  if (cached && cached.expires > Date.now()) return cached.value as ReverseGeocodeResult | null;

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

// Forward geocoding — turns a free-text address into coordinates, for the
// branch-location picker ("search an address, it fixes the coordinates").
// Same never-throw/throttle/cache discipline as reverseGeocode above.
export async function forwardGeocode(query: string): Promise<ForwardGeocodeResult | null> {
  if (!query || !query.trim()) return null;

  const key = forwardCacheKey(query);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value as ForwardGeocodeResult | null;

  try {
    const value = await throttle(() => fetchForwardFromNominatim(query));
    cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (err: any) {
    console.error('[geocoding] Nominatim forward geocode failed:', err?.message || err);
    return null;
  }
}

async function fetchForwardFromNominatim(query: string): Promise<ForwardGeocodeResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `${NOMINATIM_URL}/search?format=jsonv2&q=${encodeURIComponent(query)}&limit=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const first = Array.isArray(data) ? data[0] : null;
    if (!first) return null;
    const lat = parseFloat(first.lat);
    const lng = parseFloat(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, displayName: first.display_name };
  } finally {
    clearTimeout(timer);
  }
}

// Multi-result variant of forwardGeocode, for a live-typeahead search box
// (the branch-creation map's location search) instead of a single best
// match — same never-throw/throttle/cache discipline as everything else in
// this module. Cache key includes the limit so a 1-result cache entry (from
// forwardGeocode above) never masquerades as a full suggestion list.
function searchCacheKey(query: string, limit: number): string {
  return `search:${limit}:${query.trim().toLowerCase()}`;
}

export async function searchPlaces(query: string, limit = 5): Promise<ForwardGeocodeResult[]> {
  if (!query || !query.trim()) return [];

  const key = searchCacheKey(query, limit);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return (cached.value as ForwardGeocodeResult[] | null) || [];

  try {
    const value = await throttle(() => fetchSearchFromNominatim(query, limit));
    cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (err: any) {
    console.error('[geocoding] Nominatim place search failed:', err?.message || err);
    return [];
  }
}

async function fetchSearchFromNominatim(query: string, limit: number): Promise<ForwardGeocodeResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `${NOMINATIM_URL}/search?format=jsonv2&q=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .map((row: any) => {
        const lat = parseFloat(row.lat);
        const lng = parseFloat(row.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return { lat, lng, displayName: row.display_name as string };
      })
      .filter((r: ForwardGeocodeResult | null): r is ForwardGeocodeResult => r !== null);
  } finally {
    clearTimeout(timer);
  }
}
