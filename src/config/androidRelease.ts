/** The MAVIN Business Android app offered for download on www.mavin.pk.
 * Every value here was checked against the signed APK itself (size, SHA-256,
 * package, version, signing certificate). For a new version: add a new file
 * under public/downloads/android/ (never replace an old one: the URL is
 * versioned and cached as immutable) and update these values. */
export const ANDROID_RELEASE = {
  appName: "MAVIN Business",
  packageId: "pk.mavin.business",
  versionName: "3.6.0",
  versionCode: 16,
  /** Release date shown on the website (the day this build was published). */
  releaseDate: "2026-11-28",
  sizeBytes: 36_639_214,
  sha256: "D634EBC14DD55E12D7EBB3148A43A85DF056DEACA3ECA692624253982A8A873F",
  /** SHA-256 of the release signing certificate (the same key signs every update). */
  signingCertSha256: "C5:69:1E:42:58:81:42:10:37:E9:5C:DA:67:FF:CC:C3:5D:4F:A4:90:DD:03:F3:A2:D9:7F:93:40:B0:FB:7D:46",
  minAndroid: "Android 7.0 or newer",
  path: "/downloads/android/Mavin-Business-v3.6.0.apk",
  notes: [
    "A new app made for phones and tablets: New Invoice and New Purchase, sales, products, customer and supplier balances, cash register, expenses and reports.",
    "Send invoices on WhatsApp and submit them to FBR from the phone.",
    "Pharmacies and general stores: confirm retail price increases and apply approved price changes.",
    "Other sections open inside the app, already signed in. Install it over the old app and sign in once.",
  ],
} as const;

/** "3.7 MB" (binary megabytes, as Android shows file sizes). */
export const androidSizeLabel = () => `${(ANDROID_RELEASE.sizeBytes / 1024 / 1024).toFixed(1)} MB`;

/** "8 November 2026". */
export const androidReleaseDateLabel = () =>
  new Date(`${ANDROID_RELEASE.releaseDate}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
