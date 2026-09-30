# ExamPrep AI for Android (F131)

The Android app is a **Trusted Web Activity (TWA)**: the production web app, opened full-screen
in the phone's Chrome engine. There is no app code of our own. Every screen, rule and permission
check (including T09's answer-key rules) lives in the web app and its API, so **a web deploy
reaches the app immediately, with no Play Store update.**

Only a change to this folder (icon, name, domain, version) needs a new Play upload.

## Why a TWA, not a native rewrite

Decided 2026-09-30 with the owner. A native app would mean rewriting 24 screens and then building
every future feature twice. A TWA ships all 130+ features on day one. The API is already plain
REST (`/api/*`), so native screens can be added later without throwing this away: the Play
listing, package name and signing key all carry over.

## How the pieces fit

| Piece | Where |
|---|---|
| App identity, domain, version | `android/gradle.properties` |
| Launcher, splash, notifications, WebView fallback | `app/src/main/AndroidManifest.xml` (all `android-browser-helper`) |
| Site vouches for the app | `/.well-known/assetlinks.json`, served by `src/routes/[.]well-known/assetlinks[.]json.ts` from `ANDROID_PACKAGE_NAME` + `ANDROID_CERT_SHA256` |
| Offline page | `public/sw.js` + `public/offline.html` (never caches API data or answers) |
| Build + signing | `.github/workflows/android.yml` (CI only; the keystore is never in the repo) |

If asset links don't verify, the app still works but shows a browser URL bar at the top. That bar
is the tell-tale sign that the fingerprint or package name doesn't match.

## Before the first Play upload (one-time, cannot be undone later)

1. Set `hostName` in `gradle.properties` to the custom domain, and point that domain at Vercel.
2. Confirm `appId`. **It is permanent after the first upload.**
3. Create the upload keystore (needs a JDK):
   ```
   keytool -genkeypair -v -keystore upload.keystore -alias upload -keyalg RSA -keysize 2048 -validity 10000
   ```
   Back it up in two places, with its passwords. Losing it means asking Google for an upload-key
   reset, which takes days.
4. Add the four `ANDROID_*` secrets listed at the top of `android.yml` to GitHub
   (`base64 -w0 upload.keystore` for `ANDROID_KEYSTORE_BASE64`), then run the **Android** workflow.
5. Upload the `.aab` from the run's artifacts to Play Console with Play App Signing on.
6. Copy **both** SHA-256 fingerprints from Play Console > Test and release > App integrity (the
   app signing key and the upload key) into Vercel's `ANDROID_CERT_SHA256`, comma-separated, set
   `ANDROID_PACKAGE_NAME`, and redeploy. Check with
   `https://<domain>/.well-known/assetlinks.json` and Google's
   [Statement List tester](https://developers.google.com/digital-asset-links/tools/generator).

## Every later release

Bump `versionCode` (by 1) and `versionName` in `gradle.properties`, merge to `main`, then upload
the new `.aab`. Remember that a web-only change needs none of this.

## Testing on a phone

Download `examprep-ai-debug-apk` from any Android workflow run and install it (allow "install
unknown apps"). The debug key changes every CI run, so the debug build always shows the URL bar;
that's expected. Use the signed release APK to test full-screen. Check sign-in (email and Google),
taking an attempt, photographing a written answer, downloading a paper PDF, and airplane mode (you
should see the offline page).
