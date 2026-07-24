// Must run before anything issues a fetch: installs the API base-URL shim so
// '/api/...' calls hit the backend origin (VITE_API_BASE_URL) when the frontend
// is deployed separately (e.g. Vercel + Render). No-op when unset (monolith).
import './lib/apiBase';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import AdminApp from './AdminApp';
import { initCardTilt } from './lib/cardTilt';
import './index.css';
// Loaded as a separate JS-level stylesheet import (not a CSS @import inside
// index.css) — co-locating this @media block inside index.css alongside the
// @theme block reproducibly triggered a Tailwind v4.3.2 CSS-engine bug (see
// reduced-motion.css's own header comment for the full story).
import './reduced-motion.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
);

initCardTilt();

// Register the service worker for PWA installability (add-to-homescreen,
// faster repeat loads, cached ML model weights). Only in production builds —
// a service worker in dev mode would fight with Vite's HMR.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('Service worker registration failed:', err);
    });
  });
}
