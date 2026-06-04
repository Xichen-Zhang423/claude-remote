# One web UI → Android / iOS / HarmonyOS

Build the phone client **once** as a web app (PWA), then wrap it per platform. Don't write three native UIs.

---

## 0. PWA core (works on all three out of the box)

- A plain `index.html` + JS + CSS served by your PC server; talks to the PC over WebSocket.
- **Service Worker**, cache-first for the app shell so the installed icon opens offline and survives the
  tunnel URL changing. Bump the cache name (`v16`→`v17`) on every release; on `controllerchange` call
  `location.reload()` (guarded by a flag) so phones auto-update instead of serving stale code.
- "Add to Home Screen" makes it a standalone app on Android (Chrome) and iOS (Safari).
- iOS PWA install usually requires **HTTPS** — the Cloudflare tunnel provides it.
- Show a visible **version string** somewhere (e.g. settings) so you can tell whether a phone is on new code
  vs. a stale cache — saves hours of "is my fix even deployed?" confusion.

iOS stops here: Apple doesn't allow third-party app packages, so **iOS = PWA only**.

---

## 1. Android APK via Capacitor + GitHub Actions (no local Android toolchain)

You usually can't (or don't want to) install Android SDK + Gradle locally — build in the cloud.

- `app-android/capacitor.config.json`: `appId`, `appName`, `webDir: "../public"` (bundles your web app),
  `server.androidScheme: "http"`, `cleartext: true`, `android.allowMixedContent: true`.
- `app-android/package.json`: `@capacitor/core`, `@capacitor/android`, `@capacitor/cli` (v6+).
- GitHub Actions (`assets/build-apk.workflow.yml`): checkout → setup-node → Java 17 → `android-actions/setup-android`
  → `npm install` → `npx cap add android` → `npx cap sync android` → patch `AndroidManifest.xml` (add CAMERA
  permission if you scan QR codes) → `./gradlew assembleDebug` → upload `app-debug.apk` as an artifact.
- Trigger on `push` to `public/**` / `app-android/**` so every UI change rebuilds. Add `workflow_dispatch`
  for manual runs. (Set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"` to silence the Node20 deprecation warning.)
- Users download the artifact zip from the Actions run → `app-debug.apk` → install (allow "unknown sources").
- Private repos can use Actions too — no need to make the repo public to build.

Because Capacitor bundles `webDir` at build time, the APK is independent of the changing tunnel URL — it uses
your scan-to-connect / rendezvous logic just like the PWA.

---

## 2. HarmonyOS — two cases

- **HarmonyOS 4 and earlier** (Android-compatibility layer): **installs the APK** above. Done.
- **HarmonyOS NEXT (5.x, "pure" HarmonyOS):** **cannot run APKs.** Ship a native **ArkTS WebView shell**.

### HarmonyOS NEXT native shell (ArkTS)
A native app whose only screen is a `Web` component loading your bundled web UI:

- `Index.ets` (`assets/harmony-Index.ets`): a `Web({ src: $rawfile('index.html'), controller })` with
  `.javaScriptAccess(true).domStorageAccess(true).mixedMode(MixedMode.All)`.
- **Seed the connection at document-start** so it auto-connects with no QR scan:
  `.javaScriptOnDocumentStart([{ script: SEED_JS, scriptRules: ['*'] }])` where `SEED_JS` sets
  `localStorage.backend = { token, rz, ... }` and also sets `window.Capacitor` so your web app skips
  Service-Worker registration (assets are already local in the bundle).
- Bundle the web assets into `entry/src/main/resources/rawfile/` (copy your `public/*` there). Relative refs
  (`app.js`, `styles.css`) resolve as `rawfile` siblings.
- `module.json5`: add `ohos.permission.INTERNET` (and `CAMERA` only if you keep in-app QR scanning).
- **Build reality:** HarmonyOS `.hap` must be signed with the user's Huawei developer cert in **DevEco
  Studio** — there is no free cloud-CI equivalent of the APK pipeline. So the deliverable is "create a project
  in DevEco's wizard, drop in `Index.ets` + the permission + the rawfile assets, auto-sign, install via USB."
  Provide that as a step-by-step guide, not a one-click build.

---

## Connection seeding cheat-sheet (so wrapped apps auto-connect)

Your web app's "get backend" logic should accept a pre-seeded `localStorage.backend = { host, token, secure,
rz }`. For wrappers, seed it before the app's own scripts run (Capacitor: a plugin/initial URL; HarmonyOS:
`javaScriptOnDocumentStart`). With `rz` set, the app resolves the live tunnel URL itself — no scan needed.
Keep a placeholder host; the rendezvous resolve overwrites it.
