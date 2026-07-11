import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    // The repo's single .env file lives at the monorepo root, not here —
    // point Vite's own env loader (which powers import.meta.env.VITE_*)
    // at it, so VITE_-prefixed vars don't require a second, duplicate
    // .env file inside apps/admin.
    envDir: path.resolve(__dirname, '../..'),
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Allow tunnels (ngrok / Cloudflare Tunnel / localtunnel) to reach the
      // dev server for temporary demos. Without this, Vite blocks any request
      // whose Host header isn't localhost ("Blocked request. This host is not
      // allowed"). DEV-ONLY — production serves prebuilt static files and
      // ignores this. Tighten to e.g. ['.ngrok-free.app'] if you prefer.
      allowedHosts: true,
      // Bind to all network interfaces so phones/laptops on the same Wi-Fi (and
      // the tunnel) can reach it, not just localhost.
      host: true,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      rollupOptions: {
        output: {
          // Split heavy, page-specific vendor libraries into their own
          // cacheable chunks instead of one ~2MB bundle. Combined with the
          // route-level React.lazy() splitting in AdminApp.tsx, a visitor
          // to e.g. /employee/attendance no longer downloads recharts
          // (Dashboard-only) or vice versa — meaningful on a slow mobile
          // connection during the KYC/attendance flow specifically.
          manualChunks: {
            'vendor-three': ['three', '@react-three/fiber'],
            'vendor-motion': ['motion'],
            'vendor-charts': ['recharts'],
            'vendor-google-auth': ['@react-oauth/google'],
          },
        },
      },
    },
  };
});
