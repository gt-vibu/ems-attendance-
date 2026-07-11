// Vite only exposes env vars prefixed with VITE_ to the browser bundle.
// Empty string (not set) means the caller should skip rendering the button
// entirely, rather than mounting a Google button that will always fail.
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

export async function loginWithGoogleCredential(credential: string, deviceId?: string) {
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential, deviceId })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Google sign-in failed');
  return data as { token: string; user: import('./auth').User };
}
