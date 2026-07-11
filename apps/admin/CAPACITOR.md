# Capacitor (Android) — packaging the same web app as a native app

This wraps the existing `apps/admin` React/Vite web app with Capacitor so it
can ship as an installable Android app, while the normal web deploy (Vercel)
is completely unaffected. Everything here is additive and gated behind
`VITE_CAPACITOR=true` at build time — leaving it unset (the default) keeps
the web build byte-for-byte identical to before Capacitor was added.

---

## 1. Prerequisites

- [Android Studio](https://developer.android.com/studio) installed, with the
  Android SDK configured (`ANDROID_HOME` set).
- Node/pnpm already set up for this repo (see root `README.md`).

## 2. One-time setup

Dependencies are already added to `apps/admin/package.json`
(`@capacitor/core`, `@capacitor/cli`, `@capacitor/android`). From the repo
root:

```powershell
pnpm install
pnpm --filter @company/admin exec cap add android
```

This generates `apps/admin/android/` — a full native Android Studio project.

### Verify the camera permission

Capacitor does **not** automatically add the camera permission just because
the web app calls `getUserMedia` (used in `EmployeeKYC.tsx`,
`EmployeeAttendance.tsx`, `QrScan.tsx` for face verification and QR
scanning). After running `cap add android`, open
`apps/admin/android/app/src/main/AndroidManifest.xml` and confirm it
contains:

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

Add it manually, right after the other `<uses-permission>` entries, if it's
missing. If the manifest also has a `<uses-feature android:name=
"android.hardware.camera">` entry, add `android:required="false"` to it so
the app can still install on a camera-less emulator for testing non-camera
flows.

No JavaScript/React changes are needed for the camera itself — Capacitor's
WebView supports `getUserMedia` natively once the OS-level permission above
is declared.

## 3. Build-and-sync cycle

Every time you want to rebuild the native app after a code change:

```powershell
$env:VITE_CAPACITOR = "true"
$env:VITE_API_BASE_URL = "https://<your-render-app>.onrender.com"
pnpm --filter @company/admin build:web
pnpm --filter @company/admin exec cap sync android
pnpm --filter @company/admin exec cap open android
```

- `VITE_CAPACITOR=true` switches routing to `HashRouter` (see "Why
  HashRouter" below) — only for this build, never for the Vercel build.
- `VITE_API_BASE_URL` points the packaged app at the real backend (the same
  Render URL the Vercel frontend already uses) — the packaged app has no
  same-origin backend to fall back to.
- `cap sync android` copies the fresh `dist/` build into the native project.
- `cap open android` opens the project in Android Studio, where you can run
  it on an emulator or a connected device.

## 4. Required Render change: CORS

The backend's `CORS_ALLOWED_ORIGINS` env var (Render dashboard) currently
lists the Vercel origin only. **Append** (don't replace) the Capacitor app's
origins:

```
CORS_ALLOWED_ORIGINS=https://your-app.vercel.app,https://localhost,capacitor://localhost
```

- `https://localhost` — the Android app's origin, given `androidScheme:
  'https'` in `capacitor.config.ts`.
- `capacitor://localhost` — included for a future iOS build; harmless to add
  now.

Redeploy Render after changing this. `server.ts`'s CORS handling already
splits/trims on comma, so this is a config-only change.

## 5. Why HashRouter for the native build

`AdminApp.tsx` uses `BrowserRouter` for the web build (path-based URLs,
matches `vercel.json`'s SPA rewrite rule). Capacitor's packaged webview has
no server to rewrite deep links to `index.html`, so `BrowserRouter` would
404 on a refresh of any nested route (e.g. `/employee/dashboard`).
`HashRouter` avoids that entirely since all routing state lives after a
`#`, which needs no server support — it's only active when
`VITE_CAPACITOR=true`.

## 6. Known limitation: QR deep links

`/qr/:token` is designed to be opened by *any* camera/QR app, not just the
one built into this app (see the comment above `QrDeepLink` in
`AdminApp.tsx`). Scanning that QR code with a phone's **stock camera app**
will open the **website** in a mobile browser — it will **not** launch the
native Capacitor app. Making the native app itself claim that URL requires
Android App Links (domain verification via `assetlinks.json`) and, later,
iOS Universal Links — both out of scope for this pass. Scanning from
**inside** the app (`QrScan.tsx`, the in-app scanner) is unaffected and
works normally under `HashRouter`.

## 7. What this integration does NOT touch

- `apps/admin/server.ts` — unchanged.
- Any route, page, or component logic other than the router selection line
  in `AdminApp.tsx`.
- `vercel.json`, `render.yaml`, or any existing Vercel/Render env var.
- `apps/admin/public/manifest.json` / `apps/admin/public/sw.js` — the
  existing browser PWA install path is untouched; Capacitor uses its own
  native icon/splash config instead, not these files.
- `apps/admin/vite.config.ts` — the build output shape (`dist/`) is
  identical for both the web and Capacitor builds.

## 8. Before a real Play Store submission

- `capacitor.config.ts`'s `appId` (`com.smartteams.app`) is a placeholder —
  change it if a different reverse-DNS id is wanted. It cannot be changed
  after publishing without creating a new store listing.
- An app doing camera-based biometric KYC will need a completed Play Store
  Data Safety form referencing camera/biometric data use.
- iOS support (`@capacitor/ios`, `Info.plist` `NSCameraUsageDescription`) is
  a follow-up, not covered by this Android-only pass.
- Decide whether to commit the generated `android/` folder to git (usually
  worth it once the manifest/icons are finalized) or regenerate it per
  machine with `cap add android`.
