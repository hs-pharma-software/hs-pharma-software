# eSales Pharmacy — offline-first desktop app

A pharmacy / retail management app built with **Next.js** for the UI, packaged as a
**Tauri** desktop app, with a **local SQLite** database that is the source of truth while
the app runs, and **Turso** as the cloud database it syncs to whenever you're online.
Product/category images are hosted on **Cloudinary**.

Functional spec this is being built against: [`../CLAUDE.md`](../CLAUDE.md) (reverse-engineered
from screenshots of the reference app, "eSales Analyst").

## Architecture

```
┌─────────────────────────────── Tauri desktop app ───────────────────────────────┐
│                                                                                   │
│   Next.js UI (static export, runs in the OS webview)                            │
│     - every screen reads/writes the LOCAL SQLite db directly                    │
│       via @tauri-apps/plugin-sql (see src/lib/db.ts + src/lib/repo/*)           │
│     - works fully offline: no network call is on the path of any CRUD action    │
│                                                                                   │
│   Local SQLite file (pharmacy.db, in the OS app-data dir)                       │
│     - schema + migrations defined in src-tauri/src/lib.rs                       │
│     - every insert/update/delete is also appended to `sync_outbox`              │
│                                                                                   │
│   Sync engine (src/lib/sync/engine.ts), driven by src/components/sync/          │
│     SyncProvider.tsx — runs on startup, on `online` events, every 60s,          │
│     and on the topbar's manual sync button:                                     │
│       1. push:  drain `sync_outbox` -> Turso (INSERT ... ON CONFLICT UPDATE)    │
│       2. pull:  fetch rows changed in Turso since our last cursor per table,    │
│                 upsert locally IF the remote copy is newer (last-write-wins     │
│                 on `updated_at`)                                                │
│     - talks to Turso over HTTPS via @libsql/client/web (works in a browser/     │
│       webview JS context, unlike libSQL's native "embedded replica" mode)       │
│                                                                                   │
└───────────────────────────────────────────────────────────────────────────────┘
                                      │ HTTPS, only when online
                                      ▼
                              Turso (libSQL cloud DB)
```

### Why not libSQL "embedded replicas"?

Turso's embedded-replica feature (a local SQLite file that mirrors a remote database) sounds
like a perfect fit, but it only serves **reads** locally — writes are forwarded synchronously
to the remote primary, so they fail outright while offline. Since "add a customer while
offline, push it later" is the actual requirement, this app instead uses a plain local SQLite
file plus a hand-rolled **outbox pattern** (above), which is the standard approach for
offline-first apps with occasional connectivity.

### Conflict handling

Conflicts are resolved **last-write-wins** by `updated_at`. This is simple and fine for a
single pharmacy with low concurrent-edit odds, but it means: if the same row is edited on two
machines while both are offline, the earlier edit is silently lost on next sync. Worth
upgrading later (e.g. per-field merge, or flagging conflicts for manual review) if this app
ever runs on multiple tills at once.

### Security note

Because this ships as a static desktop app with no backend server, the Turso auth token and
Cloudinary upload preset are bundled into the app's JS. That's an acceptable tradeoff for a
single-pharmacy internal tool, but if you ever distribute this `.exe` to multiple locations
that shouldn't share full read/write access to the same Turso DB, you'll want a thin API
backend in front of Turso instead of talking to it directly from the client.

## Project layout

```
app/
  src/app/            Next.js routes (one folder per screen, App Router)
  src/components/      layout/ (Sidebar, Topbar, AppShell), ui/ (Button, Modal,
                        DataTable, Field, ComingSoon, QuickAddDialog), sync/,
                        products/, customers/, reports/
  src/lib/
    db.ts               local SQLite wrapper (@tauri-apps/plugin-sql)
    id.ts               UUID + ISO timestamp helpers
    types.ts            TypeScript row types
    repo/base.ts         generic CRUD factory (createRepo<T>(table)) — every
                          module's repo file is 1-3 lines on top of this
    repo/*.ts             per-entity repos + custom queries
    sync/engine.ts        push/pull sync logic
    sync/outbox.ts         records every local write for later sync
    sync/tables.ts          list of tables that participate in sync
    cloudinary.ts         unsigned image upload
    backup.ts              local backup/restore (copies the sqlite file)
    platform.ts            isTauri() — guards DB calls when previewed in a plain browser
  src/store/appStore.ts  zustand store: online/sync status, sidebar state
  src/config/nav.ts       the entire sidebar nav tree (18 modules, ~57 screens)
  src-tauri/              Rust/Tauri shell
    src/lib.rs              plugin registration + full local schema (migration v1)
    tauri.conf.json         window config, points at ../out (static export)
    capabilities/default.json  permissions (sql, fs, dialog, http, os)
  db/schema.sql           same schema, for Turso (`turso db shell ... < db/schema.sql`)
```

## What's actually built vs. stubbed

Every screen in the sidebar is a real, working page backed by the local SQLite database (not a
mock) — all 57 routes from `CLAUDE.md`'s spec:

- **Dashboard** — live KPI tiles, animated count-up, gradient icons.
- **Products** — Product Detail (full form incl. opening stock/pricing), Price List, UOM
  Details, Categories/Sub-Categories (two-panel), Assign To Supplier (many-to-many, via a
  `product_suppliers` join table added in migration v2).
- **Stock** — manual stock receive/adjustment, feeding the same `product_batches` table
  Purchases and Invoices read/write.
- **Customers / Suppliers / Staff** — list + add/edit, plus their ledger screens (Accounts
  Receivable / Accounts Payable / Employee Ledger, all sharing one `PartyLedgerPage` component
  over the `ledger_adjustments` table) and Outstanding aging summaries.
- **Orders** — line-item requisition form (no stock impact).
- **Purchases** — line-item form that actually receives stock (creates/tops-up
  `product_batches`); Purchase Return / Purchase Item Return deduct it back out.
- **Invoices** — the big one: POS-style Create Invoice with product/batch picker, deducts stock
  on save; Invoice Return / Sale Item Return restore it; Memorized Invoice Detail lists
  `is_memorized` invoices with a Convert-to-Invoice action.
- **Cash Register, Banks** (Details/Statement/Summary), **Expenses** (Details/Categories/Salary),
  **Other Revenue** (Details/Categories), **Tasks**, **Salesman Record** — all real CRUD,
  several sharing generic components (`CategorizedEntryPage`, `SimpleCategoryPage`).
- **Reports** — all 12 screens run real SQL aggregations over Invoices/Purchases/Expenses/
  Revenue/ledgers (Business/Product/Company/Category/Sub-Category/Customer-wise Profit & Loss,
  Tax, Bonus & Discount, Product/Category-wise Sales, Trial Balance, Balance Sheet), with a
  From/To date filter in place of the reference app's Daily/Monthly preset dropdown.
- **Utilities** — Delete History (real audit log), System Shortcuts (reference table), Generate
  Barcode (printable label sheet), Financial Closing (password-gated confirmation, logs to
  `settings`), View Financial Closing, Audit Detail (stock count vs. system qty).
- **Settings** — General (GST rate, connection-status panel), My Online Store (toggle products'
  `online_store_status`), Backup/Restore (real file-picker copy of the local `.db` file).

### Known simplifications (worth knowing before you rely on this for real accounting)

- **Party balances** (`PartyLedgerPage`, Outstanding pages) are computed as
  `opening_balance − Σ ledger_adjustments.paid_amount`. Invoice/purchase balances are *not*
  currently folded into the customer/supplier running balance automatically — only manual
  ledger adjustments are. Wiring invoices/purchases into the same balance calc is the natural
  next step.
- **Reports** use a simple From/To date range instead of the reference app's Daily / Monthly /
  Previous Month / Yearly / Custom / Overall dropdown — same idea, simpler control.
- **Trial Balance / Balance Sheet** are simplified single-entity rollups (cash, banks,
  receivables, payables, stock value at cost) rather than a full chart-of-accounts ledger.
- **Salesman** and **Memorized Invoice** creation aren't exposed from the Create Invoice form
  yet (salesmen are added via its quick-add "+"; there's no "Memorize" button wired up) — the
  Salesman Record report and Memorized Invoice Detail list/convert screens work once rows exist.
- The **product search/typeahead** (`ProductPicker`) does a fresh `LIKE` query per keystroke
  (debounced 200ms) rather than an indexed prefix search — fine at hundreds of SKUs, may want
  FTS5 at thousands.

## Setup

### 1. Install prerequisites (one-time)

- Node.js 18+ (already installed)
- Rust + the MSVC C++ build tools (needed to compile the Tauri shell on Windows) — installed
  via `winget install Rustlang.Rustup` and `winget install Microsoft.VisualStudio.2022.BuildTools`
  with the "Desktop development with C++" workload.
- **Restart your terminal** after installing Rust so `cargo`/`rustc` are on PATH.

### 2. Install JS dependencies

```bash
npm install
```

### 3. Create a Turso database

```bash
# install the CLI if you don't have it: https://docs.turso.tech/cli/installation
turso auth login
turso db create pharmacy
turso db show pharmacy --url          # -> NEXT_PUBLIC_TURSO_DATABASE_URL
turso db tokens create pharmacy       # -> NEXT_PUBLIC_TURSO_AUTH_TOKEN
turso db shell pharmacy < db/schema.sql
```

### 4. Create a Cloudinary unsigned upload preset

Dashboard → Settings → Upload → Upload presets → Add upload preset → Signing Mode: **Unsigned**.
Note the cloud name (top of the dashboard) and the preset name.

### 5. Configure environment variables

```bash
cp .env.local.example .env.local
# then fill in the 4 values from steps 3-4
```

### 6. Run it

```bash
npm run tauri dev     # opens the desktop app, hot-reloading Next.js inside it
```

First run compiles the Rust shell (~1-3 min); subsequent runs are fast.

To build a distributable installer:

```bash
npm run tauri build
```

## Offline behaviour, concretely

- Turn off your network, open the app: every screen still works — you're reading/writing the
  local SQLite file directly.
- The topbar shows a Wi-Fi icon + a count of unsynced changes. Offline, it goes grey and the
  count climbs as you work.
- Reconnect: a sync pass kicks off automatically (also fires every 60s while online, and on
  demand via the topbar button), pushing your queued changes to Turso and pulling anything
  changed elsewhere.
- Image uploads (Cloudinary) require network — there's no offline queue for those yet. Fields
  that use `lib/cloudinary.ts` should stay disabled/warn when `!navigator.onLine`.
