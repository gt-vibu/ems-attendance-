// Single source of truth for this browser's device fingerprint — previously
// duplicated (with slightly different implementations) across
// EmployeeLogin.tsx, EmployeeAttendance.tsx, QrScan.tsx, FaceEnrollment.tsx,
// and webauthnClient.ts.
//
// Re-reads localStorage immediately after writing rather than trusting the
// locally-generated value: if two tabs call this within the same instant on
// a brand-new browser profile (nothing stored yet), both generate their own
// random ID and both write, so whichever wrote last "wins" in storage. Without
// the re-read, the tab that lost the race would keep using its own orphaned
// ID for the rest of that call, sending a device ID the server has never
// seen — re-reading after the write converges both tabs onto whichever ID
// actually ended up persisted.
export function getDeviceFingerprint(): string {
  let deviceId = localStorage.getItem('device_fingerprint');
  if (!deviceId) {
    deviceId = 'device_' + globalThis.crypto.randomUUID();
    localStorage.setItem('device_fingerprint', deviceId);
  }
  return localStorage.getItem('device_fingerprint') || deviceId;
}
