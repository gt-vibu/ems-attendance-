import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import AdminApp from './AdminApp';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
);

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
