import type { CapacitorConfig } from '@capacitor/cli';

// Packages the same `dist/` build already produced by `build:web` as a
// native Android and iOS shell. See CAPACITOR.md for the build/sync workflow —
// this file is inert until `npx cap add android` / `npx cap add ios` has been
// run once for the respective platform.
const config: CapacitorConfig = {
  appId: 'com.smartteams.app', // change before a real Play Store submission if a different id is wanted
  appName: 'Smart Teams',
  webDir: 'dist',
  server: {
    // Secure-context origin (https://localhost) instead of Capacitor's
    // default http:// — needed for consistent getUserMedia/CORS behavior
    // and must match the CORS_ALLOWED_ORIGINS entry documented in
    // CAPACITOR.md.
    androidScheme: 'https',
  },
};

export default config;
