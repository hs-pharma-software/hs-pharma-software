/** The MAVIN desktop app for Windows (MAVIN Offline) offered on www.mavin.pk.
 * The installer is too large for the website itself. Its fixed address is
 * www.mavin.pk/downloads/windows/<file>, which next.config.ts sends on to the
 * file host (WINDOWS_DOWNLOAD_BASE; today download.mavin.pk, the UpCloud server,
 * /srv/downloads/windows). The installed app checks the same address for updates.
 *
 * A new version: raise the version in desktop/package.json, build it (desktop:
 * npm run dist), copy the .exe and its .blockmap to the host under their new
 * names (never replace an old file: the next update needs the old blockmap),
 * then copy latest.yml LAST (installed apps update from it), and update these values. */
export const WINDOWS_RELEASE = {
  appName: "MAVIN for Windows",
  versionName: "0.2.5",
  /** Release date shown on the website. */
  releaseDate: "2026-11-13",
  fileName: "MAVIN-Offline-Setup-0.2.5.exe",
  sizeBytes: 112_679_186,
  sha256: "D2C2D64594BFFB5BB6F52611190AD6028B6286BB085CC93A5B4DF6BF44683EA7",
  needs: "Windows 10 or 11 (64-bit)",
  url: "https://www.mavin.pk/downloads/windows/MAVIN-Offline-Setup-0.2.5.exe",
  notes: [
    "Fast screens for every business: your data is copied to this computer once, then only changes sync every few seconds. Every business can also view its data offline.",
    "Updates itself: new versions download in the background (only the parts that changed) and install when you close the app.",
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
