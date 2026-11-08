# MAVIN Business (Android)

A Trusted Web Activity: the Android app opens https://app.mavin.pk full screen
(no browser bar). The app's screens and features come from the website, so
**every Vercel redeploy updates the app**; there is no need to rebuild the app
for normal changes.

| | |
|---|---|
| App name | MAVIN Business |
| Package | `pk.mavin.business` |
| Opens | https://app.mavin.pk/dashboard/ |
| Minimum Android | 7.0 (API 24) |
| Build tools | Android Gradle Plugin 9.5.1, Gradle 9.8.2, compileSdk 37, targetSdk 36 |

## Open in Android Studio

File > Open > `D:\Pharmacy\mavin-android`. Let Gradle sync, then Run (green
arrow) on a phone or emulator.

## Build for Google Play

Build > Generate Signed App Bundle or APK > Android App Bundle > use
`signing/mavin-business-release.jks` (alias `mavin-business`; passwords in
`signing/keystore.properties`). Or from a terminal: `gradlew bundleRelease`
(output: `app/build/outputs/bundle/release/app-release.aab`).

## The signing key: keep it safe

`signing/` holds the release key and its passwords. **Back it up** (e.g. a USB
drive or password manager). Without it you cannot publish updates to this app
on Google Play. Never share it or put it on GitHub (`.gitignore` excludes it).

## Full screen depends on the website

https://app.mavin.pk/.well-known/assetlinks.json (in the web project,
`public/.well-known/assetlinks.json`) must list the SHA-256 fingerprint of every
key that signs the app:

- release key: `C5:69:1E:42:58:81:42:10:37:E9:5C:DA:67:FF:CC:C3:5D:4F:A4:90:DD:03:F3:A2:D9:7F:93:40:B0:FB:7D:46`
- this computer's debug key: `4E:B4:94:3B:A6:D3:B9:95:96:8D:6F:47:1F:73:B0:FF:4B:FA:9F:08:69:C1:6D:6E:CE:49:4E:44:1D:0E:9E:02`

**Google Play App Signing**: Play re-signs the app with its own key. After the
first upload, copy the "App signing key certificate" SHA-256 from Play Console
> Setup > App signing and add it to `assetlinks.json`, then redeploy the
website. Until then the Play version opens with a small browser bar.

## New version

Increase `versionCode` (and `versionName`) in `app/build.gradle.kts`, build the
bundle and upload it. Only needed for name, icon or version changes.
