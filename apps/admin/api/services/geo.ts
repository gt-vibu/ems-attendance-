// Geospatial + network helpers shared across attendance, breaks, WFH and QR
// flows. Pure functions — no DB, no side effects.

// Haversine distance in meters between two lat/lng points — used for GPS
// geofence checks both in the fast-fail pre-check and the authoritative
// final submit.
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
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
export function resolveActiveIp(req: any, simulatedIp?: string): string {
  let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  if (typeof clientIp === 'string' && clientIp.includes(',')) {
    clientIp = clientIp.split(',')[0].trim();
  }
  if (typeof clientIp === 'string' && clientIp.startsWith('::ffff:')) {
    clientIp = clientIp.substring(7);
  }
  return simulatedIp || clientIp;
}
