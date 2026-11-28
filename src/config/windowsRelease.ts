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
  versionName: "0.3.10",
  /** Release date shown on the website. */
  releaseDate: "2026-11-28",
  fileName: "MAVIN-Offline-Setup-0.3.10.exe",
  sizeBytes: 110_547_144,
  sha256: "5CFC962E9BA48BFF2A61D6E5CBA1BF7E618FFA2069279AF71F8C762F0B7E72F2",
  needs: "Windows 10 or 11 (64-bit)",
  url: "https://www.mavin.pk/downloads/windows/MAVIN-Offline-Setup-0.3.10.exe",
  notes: [
    "Fixed: after closing and opening again, your data shows after the PIN (if the password is asked once after this update, enter it).",
    "New invoices and purchases save in the background, so the next one can be entered at once; if a save fails, the form comes back as it was.",
    "New invoices print on the Windows default printer without asking.",
    "Syncs when there is something to do (a save, the internet returning, work on the screens, Sync now), not on a timer.",
    "Stock Register: search products (also finished ones), companies, distributors and generic names, and see each product's purchases, sales and available stock, with changes of distributor.",
    "Pharmacies and general stores: when a product's retail price changes, tell others with one answer, and see this week's price and pack size changes on the dashboard.",
    "Opens signed in: no password every time. A 4-digit PIN can lock the app.",
    "Faster item entry: in invoices and purchases, Enter or Tab moves to the next empty box, then back to the product search.",
    "Your business's data and a daily backup are kept on a second drive (not the Windows drive) when the computer has one.",
    "Lighter on the computer: fewer background checks.",
    "New: Radiology Centres work offline — reception, registration, orders, fees, examinations and signing reports are saved on this computer and synced when the internet returns.",
    "Ultrasound reports are written out in sentences from the values entered, with an editable preview before signing; values stay as entered and a signed report cannot change.",
    "Reports print on one A4 page with the business logo, the radiologist's name and the QR code; Radiology and Lab use A4 report templates only.",
    "Shorter patient form for Radiology and Lab; radiologist list, radiology staff roles and editing a login's role.",
    "New: distributors and electronics / solar stores bill offline too — sale invoices, bookings, payments and returns are saved on this computer and booked on MAVIN.pk when the internet returns.",
    "New: hospital pharmacies, mobile shops (accessories) and cloth stores (with the customer's custom size) sell offline.",
    "Fast screens for every business: your data is copied to this computer once, then only changes are fetched while you work. Every business can also view its data offline.",
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
