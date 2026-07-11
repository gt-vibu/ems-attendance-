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

if (API_BASE && typeof window !== 'undefined' && typeof window.fetch === 'function') {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    // Only rewrite string URLs that target the API on the current origin.
    if (typeof input === 'string' && input.startsWith('/api/')) {
      return originalFetch(API_BASE + input, init);
    }
    return originalFetch(input as any, init);
  };
}

export const apiBaseUrl = API_BASE;
