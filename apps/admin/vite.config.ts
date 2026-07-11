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
