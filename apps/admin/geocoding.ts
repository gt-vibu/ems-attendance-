// Reverse geocoding for Work From Home home-location registration — turns
// (lat, lng) into a human-readable address for display in approval
// screens/audit logs. This is genuinely optional: nothing in the WFH
// eligibility/distance logic depends on the address string, only on the
// coordinates themselves, so the feature degrades gracefully (address
// stays null) rather than failing when no provider is configured.
//
// No geocoding provider is configured in this environment (no
// GOOGLE_MAPS_API_KEY / equivalent in .env). Set one of the env vars below
// to activate real reverse geocoding — until then this always returns null,
// which is the correct, honest behavior rather than faking an address.

export interface ReverseGeocodeResult {
  address: string;
}

export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return null;
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: any = await res.json();
    const formatted = data?.results?.[0]?.formatted_address;
    return formatted ? { address: formatted } : null;
  } catch (err) {
    console.error('[geocoding] Reverse geocode failed:', err);
    return null;
  }
}
