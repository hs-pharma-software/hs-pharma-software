# Mavin Pharmacy Offline (standalone Windows edition)

Version 1.0.0. A separate Windows installer for MAVIN Pharmacy with its own local database. It works with no internet.

| | |
|---|---|
| Installer | `desktop-standalone/release/Mavin-Pharmacy-Offline-Setup-1.0.0.exe` |
| Installs as | "Mavin Pharmacy Offline" (its own app, data folder and shortcut, so it never mixes with "MAVIN Offline") |
| Data | `%APPDATA%\Mavin Pharmacy Offline\` (database `data\pharmacy.db`, automatic backups in `backups\`) |
| Source | `desktop-standalone/` (desktop), plus the same web screens built with `NEXT_PUBLIC_EDITION=standalone` |

---

## For the pharmacy owner

### Install and first setup (no internet needed)

1. Run `Mavin-Pharmacy-Offline-Setup-1.0.0.exe`, choose a folder, finish.
2. Open **Mavin Pharmacy Offline**. The first-setup screen asks for:
   - the pharmacy name and owner name (phone and address are optional);
   - the **local Super Admin** username and password (at least 10 characters).
3. A **recovery key** (six groups of five characters) is shown **once**.
   - Click **Save to a file…** or **Print**, keep it away from this computer, tick the box, and continue.
   - MAVIN does not keep a copy and cannot recover it.
4. Sign in.

The pharmacy starts on a **3-day trial**, the same length as MAVIN's online trial. To activate it, see "License" below.

### Daily use

These are MAVIN Pharmacy's screens, menus, shortcuts and invoice formats:
- sales, quotations and orders, purchases;
- stock with batches and expiry;
- sale and purchase returns;
- customers, suppliers, staff, cash register, banks, expenses;
- reports and printing.

### The local Super Admin (Settings › Mavin Pharmacy Offline)

- **License:** status, expiry date, and the installation ID. **Show request code** gives the code to send to MAVIN.pk. **Import license file…** or paste the license text to activate or renew.
- **Backups:**
  - **Back up now…** saves a complete copy (`.mavinbak`). Keep copies on a USB drive or another computer.
  - A copy is also made **automatically once a day**; the last 14 are kept.
  - **Restore from a backup…** replaces the data after a check. The current data is kept as a safety copy, and everyone signs in again.
- **Medicine catalogue:** the version, the last update, and whether an update is due. **Update now** runs one at once.
- **Recovery key:** **New recovery key** (your password is needed). The old key stops working.
- **Security log:** sign-ins, password resets, recoveries, license imports, backups and restores.
- Logins and their permissions, pharmacy details, invoice numbering, printers and print templates are in the usual MAVIN settings screens.

### Forgot the Super Admin password

1. On the sign-in screen click **Forgot password?**
2. Enter the **recovery key** and a new password.
3. The password is reset, **every open session ends**, and a **new recovery key** is shown. Save it, because the old one no longer works.
4. Wrong keys are slowed down: after 5, there is a wait that grows longer.

The recovery key resets **only the local Super Admin**; other logins are reset by the Super Admin in the logins screen. **It cannot extend the license.**

### License expiry

| When | What happens |
|---|---|
| A warning | Shown 14 days before expiry |
| After expiry | **7 grace days** (MAVIN's default) with a warning |
| After the grace days | **No new transactions** (sales, purchases, returns, stock changes) |
| Always available | Records, reports, backups, settings, logins and license import |
| Renewal | Import a renewal; transactions work again immediately, without reinstalling |

Moving the Windows date backwards past a date the app has already seen counts as expired.

### Medicine catalogue

- **Bundled:** the approved MAVIN catalogue ships with the installer (837 products, 113 categories, 6 sub-categories, 38 units at build time).
- **Updates:** with internet, the app checks **once every 24 hours**. If the computer was off, it checks at the next start; if it was offline, it checks when it is online again.
  - It downloads only changes, and nothing when the catalogue is unchanged.
  - One update runs at a time; failed attempts wait 5, 15, 30, 60, 120, then 240 minutes.
- **Your own data is never changed:** your products, prices, stock, batches, barcodes and any catalogue product you edited stay as they are. A catalogue product you have stock, prices or sales for is not removed.
- **New DRAP records** are named **Brand Name + Strength**; the **Generic Name** becomes the description and the **Manufacturer** the company.
- Only the catalogue is downloaded. **No business data leaves the computer.**

---

## For MAVIN.pk staff

### Issuing a license from MAVIN.pk (Super Admin › Offline Tenants)

1. The business sends its **request code** (Settings › Mavin Pharmacy Offline › Show request code).
2. In **Super Admin › Offline Tenants**:
   - choose the **Category**;
   - enter the tenant's details (name, owner, phone, email, city, address, notes);
   - paste the **request code**. The page shows the installation and whether this will be an activation or a renewal;
   - pick **Valid until** (quick buttons: 1 month, 6 months, 1 year, 2 years);
   - click **Generate license key**.
3. **Copy license key** or **Download .lic**, and send it by WhatsApp or email.
4. **Renewals:** click **Renew** on the tenant's row. No new request code is needed, because the installation is on record.
5. The history of every license (with copy and download) is under the license count.

**One-time server set-up.** The signing key must be in Vercel (Production) as `OFFLINE_LICENSE_PRIVATE_KEY`, then redeploy.
- To copy it **without printing it**, run in PowerShell on the PC that holds the key:
  `[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.mavin-license-keys\license-private.pem")) | Set-Clipboard`
  Then paste it into Vercel.
- The page refuses to issue if the key does not match the app's built-in public key.
- Migration **v87** (`offline_tenants`, `offline_licenses`) must be run first.

### Issuing an activation or renewal with the command-line tool (no website needed)

The signing key never goes into the app or the repository.

- **Private key:** `%USERPROFILE%\.mavin-license-keys\license-private.pem`, on the machine where it was made. **Back it up securely.** If it is lost, new builds need a new key and every license must be reissued.
- **Public key:** bundled with the app.

1. The pharmacy sends its **request code** (Settings › Mavin Pharmacy Offline › Show request code). It starts with `MAVIN-REQUEST-1.` and holds only the installation ID, pharmacy name and app version.
2. Run:

   ```
   node scripts/standalone/issue-license.cjs issue --request "MAVIN-REQUEST-1...." --licensee "Pharmacy name" --expires 2027-12-31 --kind activation --out pharmacy.lic
   ```

   Use `--kind renewal` for later years. The license is valid to the end of that day, Pakistan time.
3. Send `pharmacy.lic` (or its text) to the pharmacy. They import it offline.

A license works only for the installation in the request code. A changed file, a file for another computer, or an older license than the one installed is refused.

New signing key (only if the old one is lost): `node scripts/standalone/issue-license.cjs keygen`, then rebuild the installer.

### Building the installer

```
cd desktop-standalone
npm install
npm run catalogue      # refresh the bundled catalogue (read only on the database)
npm run dist           # web screens + desktop + installer -> release/
```

### Hosted change needed for catalogue updates

`GET /api/catalogue/pharma/` (`src/server/standalone/catalogue.ts`) serves only MAVIN's shared pharmacy catalogue. It is download only, needs no login, and sends incremental pages. **It must be deployed** before installations can receive updates. Until then they work with the bundled catalogue and show the update as pending.

### Online sync with MAVIN.pk: not built yet

Business-data sync is **off and absent** in this version, and nothing is sent to MAVIN.pk. These are not built yet:
- the Offline Pharmacy Installations section in Super Admin;
- linking an installation to a tenant and branch;
- approving and revoking sync;
- the first-sync preview with its backup and conflict list;
- duplicate-safe upload.

See "Still to do".

---

## Feature differences from online MAVIN Pharmacy

- **No FBR/PRAL**:
  - no FBR settings, buttons, buyer fields or routes;
  - the page cannot reach any network address at all;
  - four shared code files still contain FBR addresses but cannot use them.
- **No online-only features:** AI assistant, websites and online store, online payments, email password recovery (the recovery key replaces it), WhatsApp/PDF share links, multi-computer sync.
- **One computer, one pharmacy.** Several Windows users on one PC each get their own data. There are no branches in this version.
- **Saving:** writes go to the local database as they happen, as in the earlier MAVIN desktop. Multi-step saves (an invoice and its stock) are written step by step, not as one transaction. A crash in the middle of a save could leave a partial invoice. Batches the app sends together are all-or-nothing.
- **Sessions:** sign-in is needed at every start of the app.

## Tests performed (12 November 2026, on the development PC)

| Test | Result |
|---|---|
| Core unit tests (`tests/standalone/core.test.ts`): SQL guard, setup, logins, password rules, recovery, license (trial, activation, tamper, foreign, older, grace, expiry, renewal, clock rollback), catalogue (bundled, local edits kept, own rows untouched, in-use kept, unchanged skip, single flight, retries, reconnect, DRAP naming), backup and restore | 14 / 14 pass |
| Catalogue endpoint plus the desktop's real catalogue code (`tests/server/standalone-catalogue.test.ts`) | 2 / 2 pass |
| Live app, first setup with no network for the page: setup screen, recovery key shown and saved, sign-in, dashboard with the bundled catalogue | Pass |
| Live purchase through the real form: supplier quick-add, product search, batch, expiry, price, quantity | Pass; stock 0 → 50 |
| Live sale through the real form (5 tablets of a 200-tablet pack) | Pass; stock 50 → 49.975 |
| Live sale return (Full Invoice Return) | Pass; stock back to 50, return linked to the bill |
| Live recovery: wrong key refused; right key resets; new key differs; old password refused; new one works; logged | Pass |
| Live license with files from the real signing tool: expired license blocks a purchase with a clear message; reports open; tampered and foreign files refused; renewal restores purchases without reinstalling | Pass |
| Live backup, a change, then restore: the change is gone and the license stays | Pass |
| Live invoice print (to PDF in the test run instead of a printer) | PDF produced |
| Live catalogue: server down → error kept; server up → update downloaded and applied | Pass |
| Route crawl: all 73 Pharmacy screens, plus the product and invoice forms, checked for FBR/PRAL/NTN/HS-code text (visible text, titles and labels) and crashes | None found |
| Installed app (silent install of the real installer into a test folder, then uninstalled): first setup, sign-in, dashboard with 837 catalogue products, trial license, the page blocked from the network | Pass |
| Invoice numbering after a sale, a return and another sale | Continues 1, 2, 3 |

## Not verified

- A clean Windows test machine (everything ran on the development PC).
- Printing on a real thermal or A4 printer: the test printed to PDF, and the PDF content was not inspected visually.
- The catalogue endpoint on the live MAVIN.pk (not deployed).
- Unplugging the network on the test PC: the page is blocked from the network in every run. Only the catalogue download uses the network.
- Online linking, approval, revocation and duplicate-safe sync (not built).

## Still to do

1. **Online sync with MAVIN.pk.** This needs:
   - an installations registry with a Super Admin section;
   - an approval, link and revoke flow;
   - device credentials;
   - a first-sync preview with backup and conflicts;
   - an idempotent upload of invoices and stock movements.
2. **One transaction per invoice save**, so a crash mid-save cannot leave a partial invoice (needs changes in the shared invoice code).
3. **Catalogue curation:** the shared catalogue contains at least one test row ("Tenant2 Exclusive Medicine") that ships in the bundle.
4. **An optional MAVIN.pk Super Admin page to issue licenses.** This would put the private key on the server; the command-line tool keeps it off.
