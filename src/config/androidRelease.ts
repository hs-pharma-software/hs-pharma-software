/** The MAVIN Business Android app offered for download on www.mavin.pk.
 * Every value here was checked against the signed APK itself (size, SHA-256,
 * package, version, signing certificate). For a new version: add a new file
 * under public/downloads/android/ (never replace an old one: the URL is
 * versioned and cached as immutable) and update these values. */
export const ANDROID_RELEASE = {
  appName: "MAVIN Business",
  packageId: "pk.mavin.business",
  versionName: "1.0.1",
  versionCode: 2,
  /** Release date shown on the website (the day this build was published). */
  releaseDate: "2026-11-08",
  sizeBytes: 3_883_271,
  sha256: "5DD08A96FB4F9AAC28CDB7E000D322A6D410EBF7D9987EC7BBBFBB88E21F3FC7",
  /** SHA-256 of the release signing certificate (the same key signs every update). */
  signingCertSha256: "C5:69:1E:42:58:81:42:10:37:E9:5C:DA:67:FF:CC:C3:5D:4F:A4:90:DD:03:F3:A2:D9:7F:93:40:B0:FB:7D:46",
  minAndroid: "Android 7.0 or newer",
  path: "/downloads/android/Mavin-Business-v1.0.1.apk",
  notes: [
    "Opens your MAVIN.pk account full screen, without a browser address bar.",
    "Fixes the app closing on start-up on some phones.",
    "New MAVIN.pk features arrive automatically: the app shows the latest version of the web app, so most updates need no new download.",
  ],
} as const;

/** "3.7 MB" (binary megabytes, as Android shows file sizes). */
export const androidSizeLabel = () => `${(ANDROID_RELEASE.sizeBytes / 1024 / 1024).toFixed(1)} MB`;

/** "8 November 2026". */
export const androidReleaseDateLabel = () =>
  new Date(`${ANDROID_RELEASE.releaseDate}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
