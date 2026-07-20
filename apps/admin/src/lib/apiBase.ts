// When the frontend is deployed separately from the backend (e.g. this SPA on
// Vercel, the API on Render), the app must call the API's absolute URL instead
// of a same-origin relative path. Every API call in this codebase uses a
// relative string like `fetch('/api/...')`, so rather than edit ~90 call sites,
// we install a one-time fetch shim here that rewrites any '/api/...' request to
// `${VITE_API_BASE_URL}/api/...`.
//
// - Set VITE_API_BASE_URL (build-time, on Vercel) to the backend origin, e.g.
//   https://your-backend.onrender.com  (no trailing slash needed).
// - Leave it UNSET for local dev / the single-process monolith, where the same
//   Express server serves both the SPA and the API — calls stay relative and
//   this shim is a no-op.
//
// The backend must allow this frontend's origin via CORS_ALLOWED_ORIGINS.
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

// Paths that legitimately return 401 as part of their own normal flow (bad
// credentials, expired reset link) rather than "your session died mid-use" —
// these must NOT trigger the global bounce-to-login below, or a wrong
// password on the login form would redirect the user away from the form
// that's showing them the error.
const AUTH_SELF_SERVICE_PATHS = ['/api/auth/login', '/api/auth/reset-password', '/api/auth/forgot-password'];

// Every authenticated screen in this app fires several fetches on mount with
// no shared error handling (see Dashboard.tsx's per-hook fetch calls), so a
// dead session (expired JWT, or invalidated by logging in elsewhere — see
// activeSessionId in apps/admin/api/middleware/authenticate.ts) previously
// just left the page half-rendered with a wall of failed requests in the
// console instead of ever telling the user to log back in. Handling it once
// here, at the shim every API call already funnels through, avoids threading
// 401-handling through ~90 individual call sites.
function handleGlobalUnauthorized(input: RequestInfo | URL, response: Response) {
  if (response.status !== 401) return;
  const path = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
  if (AUTH_SELF_SERVICE_PATHS.some((p) => path.includes(p))) return;
  if (typeof window === 'undefined') return;
  // Already on a login screen (or already handling this) — nothing to do.
  if (window.location.pathname.includes('login')) return;

  const cachedUser = (() => {
    try {
      const raw = localStorage.getItem('auth_user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })();
  localStorage.removeItem('auth_user');
  localStorage.removeItem('auth_token');
  const canClockIn = cachedUser?.role && cachedUser.role !== 'super_admin' && cachedUser.role !== 'tenant_admin';
  window.location.href = canClockIn ? '/employee/login' : '/login';
}

if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    // Only rewrite string URLs that target the API on the current origin.
    const rewritten = API_BASE && typeof input === 'string' && input.startsWith('/api/')
      ? API_BASE + input
      : input;
    return originalFetch(rewritten as any, init).then((response) => {
      handleGlobalUnauthorized(input, response);
      return response;
    });
  };
}

export const apiBaseUrl = API_BASE;
