# MAVIN Business (Flutter, Android)

The native MAVIN Business app. It replaces the web shell in
`D:\Pharmacy\mavin-android` under the **same application ID**
(`pk.mavin.business`) and the **same release key**, so installed phones
update in place. Version 3.0.0 (code 10) follows the shell's 2.0.0 (code 4).

- Design: Option A (navy top bar with business and branch, bottom tabs on
  phones, navigation rail on tablets), with always-visible search on lists.
- Native today: sign-in, Home, Products (list and detail). Every other
  section of any business type opens the MAVIN.pk web screen inside the app,
  already signed in.
- Backend: `/api/app/*` in the Next.js project (`src/server/appReads.ts`,
  `src/server/appDocs.ts`). The app never sends SQL and never decides access
  itself; the server checks every request.

## Build

Needs Flutter 3.50 (installed at `C:\flutter`) and the Android SDK with NDK
28.2 (`%LOCALAPPDATA%\Android\Sdk`).

```
cd mobile
flutter pub get
flutter analyze
flutter test
flutter build apk --debug          # for testing on a phone
flutter build appbundle --release  # for Google Play
```

`android/gradle.properties` turns off Kotlin incremental compilation: the
project (D:) and Flutter's package cache (C:) are on different drives, which
breaks Kotlin's incremental caches.

## Release signing

Release builds are signed with `D:\Pharmacy\mavin-android\signing\`
(`keystore.properties` and `mavin-business-release.jks`), or the folder in
`MAVIN_SIGNING_DIR`. The key is never copied into this repository. Without it,
a release build is signed with the debug key and **cannot** update installed
phones.

## Talking to a test server

`flutter run --dart-define=MAVIN_API=https://your-test-server` (default:
https://app.mavin.pk).
