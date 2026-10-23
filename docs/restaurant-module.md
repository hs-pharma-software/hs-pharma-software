# Restaurant module

Restaurant POS for tenants whose business type is **Restaurant** (Super Admin → Users/Tenants → Type).

## Where things are

| Part | Location |
|---|---|
| Pricing, offers, deals, bill maths, state machines (pure) | `src/lib/restaurant/engine.ts` |
| Data layer: tenant isolation, permissions, orders, kitchen, billing, refunds, reports | `src/lib/restaurant/store.ts` |
| PRA invoice model, validation, response mapping | `src/lib/restaurant/praModel.ts` |
| PRA sending, queue, retries, credit notes | `src/lib/restaurant/praService.ts` |
| App wiring (DB, session, Tauri HTTP, token storage) | `src/lib/restaurant/index.ts` |
| Screens | `src/app/restaurant/*`, `src/components/restaurant/*` |
| Schema | migrations v26, v27 in `src-tauri/src/lib.rs` (Turso: `npm run migrate:turso` reads the same SQL) |
| Tests | `tests/restaurant/*`, `tests/regression/*` → `npm test` (live PRA sandbox: `npm run test:pra-live`) |

## Rules worth knowing

- **Isolation**: menu, deals, offers, tables, orders and invoices live in `rest_*` tables with `tenant_id`; the store takes the tenant from the session, checks ownership of every id, and refuses non-restaurant tenants. Restaurants never read the shared `products` catalog.
- **Prices** are computed in the store from stored menu data (integer paisa). Clients pass ids and option names only.
- **Offers**: each once per bill; a non-stackable offer is never combined (the better choice is kept); deal lines are skipped unless allowed; total discount ≤ bill; usage limits counted at payment with a conditional update (last-use races resolved).
- **Kitchen**: only `new` dishes are sent; each send creates one ticket per station; reprints are marked. Sent dishes can only be cancelled (reason + permission), never edited or deleted.
- **Stock**: recipe ingredients are deducted when a dish is sent to the kitchen; a unique index on `(ingredient, reason, line)` prevents double deduction on retries; cancelled-before-preparing dishes are returned.
- **Billing**: tax rate depends on payment method (cash vs card/digital, both set by the restaurant; no default assumed; mixed payments with cash use the cash rate). Paid invoices are frozen; refunds create linked credit notes.
- **Atomicity**: the Tauri SQL plugin uses a connection pool, so multi-statement transactions are not used; safety comes from conditional updates, unique indexes and idempotent steps.

## PRA (Punjab Revenue Authority) e-IMS

Source: PRAL, *Technical Specification for Data Sharing through Software Fiscal Device with PRA*, **version 1.2** (issued 08-Nov-2019, later sections cover IRIS from Sep-2024 and TLS 1.2), downloaded 2026-10-23 from
`https://reg.pra.punjab.gov.pk//NewsDirectory/UserGuide/Technical%20Specification%20Software%20Fiscal%20Device%201.2-PRA.pdf`.

- Transports: **local** Software Fiscal Device `http://localhost:8524/api/IMSFiscal/GetInvoiceNumberByModel` (health: `/api/IMSFiscal/get`), or **cloud** `https://ims.pral.com.pk/ims/{sandbox|production}/api/Live/PostData` with Bearer token (production needs IP whitelisting).
- Accepted only when `Code == "100"` with an `InvoiceNumber`; PRA answers failures with HTTP 200 too (sandbox, 2026-10-23: `{"Code":"104","Response":"You are not authorized to use this service."}` for an unregistered POS).
- Refunds: `InvoiceType = 3` (Credit) with `RefUSIN` = original invoice number; sent only after the original is accepted.
- QR: `https://reg.pra.punjab.gov.pk/IMSFiscalReport/SearchPOSInvoice_Report.aspx?PRAInvNo=<number>` (spec FAQ 4).
- Never auto-resent when the request may have reached PRA (timeout, app stopped mid-request): goes to **manual review**; check PRA IRIS → IMS Fiscal Report, then retry or record the PRA number.
- Token stored only on the device (`local_secrets`, not synced), shown masked.

### Assumptions to confirm with PRA (eims@pra.punjab.gov.pk)

1. Bank transfer and digital wallets are sent as PaymentMode 2 (Card); v1.2 has no separate code.
2. Service charge is sent as its own item line ("Service Charges") so item totals equal the bill.
3. `SaleValue` = value after discount (tax base), `TotalAmount = SaleValue + TaxCharged`, per the spec's sample (1,298 + 221 = 1,519).
4. Whether PRA de-duplicates by USIN is not stated; the app prevents duplicate sends itself.

### To go live

1. PRA portal → POS Client Registration → get a Test POS ID; run `npm run test:pra-live` and an end-to-end sandbox sale.
2. Install IMSSetup (local) or get the production token + IP whitelist (cloud); enter POS ID and PCT code (PST Act 2012, 2nd Schedule) in Restaurant Settings → PRA e-Invoicing; set tax rates in Billing & Tax.
3. Compare the first live invoices with IRIS → IMS Fiscal Report.
