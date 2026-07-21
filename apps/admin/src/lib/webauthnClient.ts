import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('auth_token');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export function getOrCreateDeviceId(): string {
  const deviceId = localStorage.getItem('device_fingerprint') || globalThis.crypto.randomUUID();
  localStorage.setItem('device_fingerprint', deviceId);
  return deviceId;
}

// A WebAuthn ceremony (create/get) never resolves to an HTTP response — the
// browser itself throws a DOMException when the user cancels, the device has
// no matching credential, etc. Turned into copy someone can act on instead of
// a raw "NotAllowedError".
export function describeWebAuthnError(err: unknown): string {
  const name = (err as any)?.name;
  if (name === 'NotAllowedError') {
    return 'Device verification was cancelled or timed out. Please try again and follow your device\'s prompt (Windows Hello, Touch ID, fingerprint, or PIN).';
  }
  if (name === 'InvalidStateError') {
    return 'This device is already registered.';
  }
  if (name === 'SecurityError') {
    return 'Device verification isn\'t available on this connection. Make sure you\'re using HTTPS.';
  }
  if (name === 'NotSupportedError') {
    return 'This device or browser doesn\'t support the requested verification method.';
  }
  return (err as any)?.message || 'Device verification failed. Please try again.';
}

export { browserSupportsWebAuthn };

export async function registerThisDevice(deviceName?: string): Promise<{ token: string; user: any }> {
  const deviceId = getOrCreateDeviceId();

  const optionsRes = await fetch('/api/webauthn/register/options', { method: 'POST', headers: authHeaders() });
  const options = await optionsRes.json();
  if (!optionsRes.ok) throw new Error(options.error || 'Could not start device registration.');

  const response = await startRegistration({ optionsJSON: options });

  const verifyRes = await fetch('/api/webauthn/register/verify', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ response, deviceId, deviceName }),
  });
  const data = await verifyRes.json();
  if (!verifyRes.ok) throw new Error(data.error || 'Device registration failed.');
  return data;
}

// Runs the WebAuthn challenge-response and returns the short-lived
// identity-pass token the final /api/attendance (or QR scan) submit expects
// as `token` — the direct replacement for the old face-pass token.
export async function verifyThisDevice(): Promise<string> {
  const optionsRes = await fetch('/api/webauthn/authenticate/options', { method: 'POST', headers: authHeaders() });
  const options = await optionsRes.json();
  if (!optionsRes.ok) throw new Error(options.error || 'Could not start device verification.');

  const response = await startAuthentication({ optionsJSON: options });

  const verifyRes = await fetch('/api/webauthn/authenticate/verify', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ response }),
  });
  const data = await verifyRes.json();
  if (!verifyRes.ok || !data.passed) throw new Error(data.error || 'Device verification failed.');
  return data.token;
}
