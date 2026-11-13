/** The MAVIN desktop app for Windows (MAVIN Offline) offered on www.mavin.pk.
 * The installer is too large for the website itself, so it is attached to a
 * GitHub Release of the repository; size and SHA-256 were taken from the
 * built file. For a new version: build it (desktop: npm run dist), publish a
 * new release with its own tag (never replace an old file), update these values. */
export const WINDOWS_RELEASE = {
  appName: "MAVIN for Windows",
  versionName: "0.2.3",
  /** Release date shown on the website. */
  releaseDate: "2026-11-13",
  fileName: "MAVIN-Offline-Setup-0.2.3.exe",
  sizeBytes: 112_271_613,
  sha256: "1F9AF86C161F0C6D56CD7504E8895F8E448739CEBDB94D0474EBFA1CA441EF9B",
  needs: "Windows 10 or 11 (64-bit)",
  url: "https://github.com/hs-pharma-software/hs-pharma-software/releases/download/mavin-windows-v0.2.3/MAVIN-Offline-Setup-0.2.3.exe",
  notes: [
    "Billing continues when the internet is down and syncs when it returns.",
    "Offline now: credit sales on a customer's account, bonus, charges, bill discount and editing invoices.",
    "An edit of an invoice that was changed online in the meantime is kept for the owner to review, never written over it.",
    "Still needs internet: FBR submission, extra customer discount, IMEI handsets and memorized drafts.",
  ],
} as const;

/** "107.1 MB" (binary megabytes, as Windows shows file sizes). */
export const windowsSizeLabel = () => `${(WINDOWS_RELEASE.sizeBytes / 1024 / 1024).toFixed(1)} MB`;

/** "13 November 2026". */
export const windowsReleaseDateLabel = () =>
  new Date(`${WINDOWS_RELEASE.releaseDate}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
