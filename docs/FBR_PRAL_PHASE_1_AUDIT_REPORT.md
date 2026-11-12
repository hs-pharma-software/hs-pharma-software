# MAVIN — FBR/PRAL Digital Invoicing: Phase 1 Audit Report

Date: 12 November 2026 · Scope: read-only audit of the MAVIN code base (commit `a4678b9`) before building an FBR gateway.
Method: code reading, plus live checks of public endpoints only (DNS, HTTP headers, FBR gateway CORS pre-flight with no token or data).
Nothing was changed while auditing. No FBR invoice was submitted.

---

## 1. Executive summary

MAVIN already has a capable FBR Digital Invoicing integration (DI API v1.12): payload building, sandbox scenarios, per-HS-code units,
FBR's quirky responses, QR content and token testing. **All of it runs in the user's browser** (or desktop app) and calls
`gw.fbr.gov.pk` directly with the business's token. That works today only from a connection whose public IP FBR has whitelisted.

Three issues stand out:

| # | Finding | Priority |
|---|---|---|
| 1 | **Duplicate FBR invoices are possible.** No submission is recorded before the call. If FBR records an invoice but the reply is lost (timeout, dropped Wi-Fi), the invoice stays without a number and pressing *Submit to FBR* again records it a second time. | **Critical** |
| 2 | **FBR tokens are readable by every login of a business** (cashiers included), stored as plain text in `settings`, and sent to every browser that loads FBR settings. | **High** |
| 3 | **Server-only tables are reachable from the browser.** `offline_devices` (device `secret_hash`, `status`) and `payment_merchants` can be read *and written* through `/api/db` by any login of that business, e.g. a cashier could re-activate a revoked offline computer. | **High** |

**Recommendation:** route every FBR call through MAVIN's server to a small **FBR gateway** on a VPS with a static IPv4
(`fbr-api.mavin.pk`), record each submission durably *before* sending, never retry an uncertain one automatically, and keep tokens
encrypted on the server. Keep the current browser path as a fallback until the gateway is live, but add the same duplicate protection to it.

## 2. Existing architecture

| Area | What exists |
|---|---|
| Framework | Next.js (App Router). API routes are `src/app/api/**/route.server.ts`; business logic in `src/server/*`. Desktop builds export the same app statically (`TAURI_BUILD=1`). |
| Hosting | **Vercel** (verified: `Server: Vercel`, region `bom1` Mumbai). Crons in `vercel.json` (SEO daily, payments reconcile daily). Routes set `maxDuration` up to 60 s. |
| Domains | `app.mavin.pk` → 64.29.17.65, `mavin.pk` → 64.29.17.1, `www.mavin.pk` → 216.198.79.1 (Vercel shared, inbound only). |
| Database | Turso (libSQL), raw SQL, **no ORM**. Schema = migrations in `src-tauri/src/lib.rs` (v1–v84), applied to Turso by `scripts/migrate-turso.cjs`; `REQUIRED_SCHEMA_VERSION` shows a banner when behind. |
| Data access from browsers | `/api/db` runs SQL sent by the page after `sqlPolicy.authorize` (statement/table rules) and `tenantScope.scopeStatement` (adds `tenant_id` / branch filters). |
| Auth | Session cookie set by `/api/auth/login`; `callerOf(req)` → `{ userId, role, tenantId, permissions }`. Roles: super_admin, owner, staff (+ distributor "Sub Super"). Staff actions are opt-in (`invoice.fbr_submit` is one). |
| Tenants & branches | `tenant_id` on business rows, `branch_id` on stock/documents; `branchScopeFor` on the server. Super Admin can switch FBR off per business (`tenants.fbr_allowed`). |
| Clients | Web app, Electron desktop (offline-capable, v0.2.1), Android app. (Android sale/purchase endpoints `/api/app/*` exist only as uncommitted work in the working folder at audit time; not part of this audit.) |
| Secrets | `src/server/paymentProviders.ts` has AES-256-GCM `encryptSecrets/decryptSecrets` keyed by `PAYMENTS_SECRET_KEY`. `tenantScope.SERVER_ONLY_SETTINGS` hides chosen settings from browsers (used for the AI key). |
| Background jobs | Vercel crons only; no queue. |
| Environment variables (names only) | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `NEXT_PUBLIC_TURSO_DATABASE_URL`, `NEXT_PUBLIC_TURSO_AUTH_TOKEN`, `SESSION_SECRET`, `NEXT_PUBLIC_DB_MODE`, `PAYMENTS_SECRET_KEY`, `CRON_SECRET`, `OFFLINE_GRANT_PRIVATE_KEY`, `NEXT_PUBLIC_GEMINI_API_KEY`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_UPLOAD_PRESET`. |

## 3. Existing FBR implementation

| Module | Role |
|---|---|
| `src/lib/fbr.ts` | Settings loader, token test, `submitInvoiceToFbr` (POST `postinvoicedata[_sb]`), reference APIs (`SaleTypeToRate`, `HS_UOM`, `SroSchedule`, `SROItem`), FBR JSON quirks, 45 s timeout. |
| `src/lib/fbrPayload.ts` | `buildFbrPayload`: pure function (no I/O) → DI payload; sandbox `scenarioId`; buyer/seller validation. |
| `src/lib/fbrData.ts` | HS codes, sale types → scenarios, NTN/CNIC rules, provinces. Pure. |
| `src/lib/fbrSubmit.ts` | Retail/pharmacy invoices: loads rows, builds, submits, stores `invoices.fbr_invoice_no`. |
| `src/lib/serviceFbr.ts` | Lab/service bills: same pattern. |
| `src/lib/electric/fbr.ts` | Electric store documents: same; stores `es_docs.fbr_status` / `fbr_invoice_no`. |
| `src/components/settings/FbrSettingsCard.tsx` | Enable, environment, sandbox/production tokens, seller NTN/name/province/address, retailer flag, token test. |
| UI | Submit buttons in Invoices list and invoice view; FBR number + QR on prints. |
| Tests | `tests/catalog/fbr-token-test.test.ts`, `fbr-shared-products`, `used-sro-values`, payload checks in catalog tests. |

**Answers to the brief's questions**

1. *What exists:* submit, validate (token test), reference lookups, payload building, sandbox scenarios, QR, per-business enable switch.
2. *Endpoints:* `di_data/v1/di/postinvoicedata`, `…_sb`, `validateinvoicedata`, `…_sb`; `pdi/v2/SaleTypeToRate`, `pdi/v2/HS_UOM`, `pdi/v1/SroSchedule`, `pdi/v2/SROItem`.
3. *Sandbox vs production:* separate tokens and URLs, chosen by the `fbr_environment` setting. Both write to the same `fbr_invoice_no` column.
4. *Tokens:* plain text in `settings` (`<tenant>::fbr_sandbox_token`, `…_production_token`), readable by all logins of the business.
5. *FBR numbers:* `invoices.fbr_invoice_no`, `es_docs.fbr_invoice_no` (+ `fbr_status`).
6. *Duplicate prevention:* only "skip if a number is already stored". No in-flight or uncertain state.
7. *Retries:* manual only (user presses Submit again), which is unsafe after a timeout (see Critical #1).
8. *Scenario testing:* `scenarioId` is set in sandbox from the sale type (SN0xx); no automated scenario run.
9. *JSON compatibility:* fields match DI API v1.12 as used in production by existing businesses; not re-verified against the latest PRAL PDF in this audit (**requires external confirmation** of the current spec version).
10. *Reusable as is:* `buildFbrPayload`, `fbrData`, `parseFbrJson`, response interpretation, all three loaders, the settings card layout, prints/QR.

Verified live: FBR's gateway answers browser pre-flights with `Access-Control-Allow-Origin: *`, so browser calls are permitted by FBR;
the limiting factor is IP whitelisting, not CORS.

## 4. Reusable components

`buildFbrPayload`, `fbrData`, `parseFbrJson` and FBR response handling, the three document loaders, `encryptSecrets` pattern
(AES-256-GCM), `SERVER_ONLY_SETTINGS`, `sqlPolicy`/`tenantScope`, `callerOf`/`HttpError`/`jsonError`, the sqlite test harness
(`tests/catalog/fullDb.ts`, `tests/server/sqliteSql.ts`), the Super Admin tenant panel (`fbr_allowed` switch).

## 5. Gap analysis

| Item | Status | Priority |
|---|---|---|
| Static outbound IP for all businesses | Missing (each shop's own IP today) | High |
| Durable submission record (pending → accepted / rejected / uncertain) | Missing | **Critical** |
| Duplicate prevention under concurrency (two tabs, double click, two devices) | Missing | **Critical** |
| Safe handling of uncertain outcomes (no blind retry; manual resolution) | Missing | **Critical** |
| Encrypted, server-only token storage | Missing (plain text, readable by staff) | High |
| Browser access to `offline_*` / `payment_*` tables | Bug / security risk | High |
| Server-side FBR route (`/api/fbr`) | Missing | High |
| FBR gateway service + deployment files | Missing | High |
| Super Admin FBR overview (gateway health, failures per business) | Missing | Medium |
| Tenant view of failed / uncertain submissions with retry / resolve | Missing (errors shown only until the page reloads) | Medium |
| Redacted structured logs of FBR traffic | Missing | Medium |
| Payload built on the server (not trusted from the browser) | Missing; browser builds it today | Medium (later) |
| PRAL lookup of an invoice by seller reference (to reconcile uncertain ones automatically) | Not in the API MAVIN uses; **requires external confirmation** | Medium |
| Android app FBR submission | Not present | Low |
| Vercel plan suitability (see §7) | **Requires external confirmation** | High |

## 6. Security findings

1. **High — tokens exposed:** any login of a business can read its FBR tokens (`settings`), and tokens travel to browsers.
   *Fix:* encrypt in a server-only table; hide the old settings keys; send a token to a browser only in fallback ("direct") mode and only to logins allowed to submit.
2. **High — server-only tables writable from browsers:** `offline_devices`, `payment_merchants` (and future `fbr_*`) pass `sqlPolicy` and are only tenant-scoped.
   *Fix:* deny `offline_*`, `payment_*`, `fbr_*` in `authorize` (only server code uses them — verified by search).
3. **Medium — browser-built payload:** a user allowed to submit could alter the JSON sent to FBR. Same as today; reduced by server checks (document belongs to the business, seller NTN matches settings). A server-built payload is a later step.
4. **Gateway must not be an open proxy:** fixed list of FBR URLs, signed requests (HMAC with timestamp), size limits, rate limits, no token or invoice body in logs.

## 7. Infrastructure recommendation

**Architecture:** Browser / Android → MAVIN on Vercel (`/api/fbr`) → **FBR gateway** (`https://fbr-api.mavin.pk`, VPS with static IPv4) → `gw.fbr.gov.pk`.

- *Vercel → VPS:* plain HTTPS from Vercel functions; works on any Vercel plan. Vercel's outbound IPs change, so the gateway authenticates **by signature, not by IP**.
- *Why a separate gateway:* Vercel has no fixed outbound IP (only the Enterprise "Secure Compute" add-on). A tiny gateway with one static IP lets PRAL whitelist one address for every business.
- *Minimum VPS:* 1 vCPU, 512 MB–1 GB RAM, 10–20 GB disk, **dedicated static public IPv4**, Ubuntu 24.04 LTS. Node.js 22 + Caddy (automatic HTTPS). The gateway has no runtime dependencies.
- *Region:* Mumbai / Bangalore (low latency to Pakistan and to Vercel `bom1`) or a Pakistani provider.
- *Estimated cost (verify current prices before buying):* about **USD 4–7 per month** (e.g. AWS Lightsail Mumbai, DigitalOcean Bangalore, Vultr Mumbai/Bangalore entry plans; a static IP is included or free while attached on these).
- *Alternative at no hosting cost:* your StormFiber static IPs (101.53.247.128/129) with an always-on PC and port forwarding. Cheaper, but depends on office power and internet (load-shedding), so not recommended for production.
- *DNS:* one `A` record `fbr-api.mavin.pk → <VPS IP>` (no change made).
- *Monitoring:* the gateway's `/health` with a free uptime monitor; the Super Admin FBR page shows gateway reachability and failures.
- *Vercel Hobby:* Vercel's Hobby plan is for personal, non-commercial use under its fair-use terms, and has lower function limits. A paid SaaS on Hobby may breach those terms. **Requires external confirmation** of your current plan; Pro is USD 20/month per member.

## 8. Estimated monthly cost

| Item | Cost |
|---|---|
| VPS with static IPv4 (gateway) | ~USD 4–7 |
| Domain / DNS record | 0 (existing `mavin.pk`) |
| TLS certificate | 0 (Let's Encrypt via Caddy) |
| Uptime monitor | 0 (free tier) |
| Vercel (if a move from Hobby to Pro is needed) | USD 20 per member |

## 9. PRAL integration requirements (to confirm with PRAL)

1. **IP whitelisting model:** can one software provider's gateway IP be whitelisted once for many taxpayers' tokens, or must each taxpayer register the IP on their own DI profile? *(Requires external confirmation — decides onboarding steps.)*
2. Each taxpayer's sandbox token, the scenarios they must pass (SN0xx for their sale types), then a production token.
3. Current DI API version and any change to `postinvoicedata` / `validateinvoicedata` fields since v1.12.
4. Whether PRAL offers a lookup of a submitted invoice (by seller reference or date) to reconcile uncertain submissions; until then they are resolved by a person checking IRIS / the PRAL portal.
5. Whether PRAL requires MAVIN to register as an integrator / licensed software provider.

## 10. Phase 2 development plan

1. Block `offline_*`, `payment_*`, `fbr_*` tables from browser SQL (+ tests).
2. Migration **v85** (additive only): `fbr_credentials` (encrypted tokens per business) and `fbr_submissions` (one row per attempt; a partial unique index allows only one pending / uncertain / accepted submission per document and environment).
3. Server module `src/server/fbr/`: secret box, gateway client (HMAC), submission service (claim → send → record; uncertain never retried), token storage and test, reference lookups, Super Admin overview; route `/api/fbr`.
4. Client: `submitInvoiceToFbr` and reference lookups go through `/api/fbr`. **Gateway mode** when the server has a gateway configured; otherwise **direct mode** (browser sends as today, but the attempt is claimed and finished on the server, so duplicates and uncertain outcomes are tracked). Settings card saves tokens encrypted.
5. Tenant UI: uncertain / failed submissions with *Mark not received* (allows a new attempt) or *Enter FBR number*.
6. Super Admin page: gateway health, per-business integration status, recent failures and uncertain submissions.
7. Gateway service `fbr-gateway/` (TypeScript, no dependencies): HMAC auth, fixed FBR URL list, timeouts, outcome classification (`response` / `not_sent` / `uncertain`), redacted JSON logs, health and egress-IP endpoints, graceful shutdown; systemd + Caddy files.
8. Tests: gateway (auth, replay, allow-list, FBR 401/500/timeout, not-sent vs uncertain) and server (tenant isolation, duplicate claims, concurrency, uncertain handling, sandbox/production separation, token secrecy), plus the existing suite.
9. Docs: VPS setup, DNS, whitelisting, monitoring, rollback; Phase 2 report; checklist.

## 11. Risks and assumptions

- PRAL's whitelisting model (§9.1) may require per-taxpayer registration of the gateway IP.
- Uncertain outcomes cannot be reconciled automatically without a PRAL lookup API; they need a person.
- Until the gateway is live, submissions still come from each shop's IP (direct mode).
- Moving tokens to the server changes where they are typed; existing plain-text tokens are copied into encrypted storage on first use, and the old settings are hidden from browsers rather than deleted.
- The Electron offline app cannot submit while offline (unchanged).
- Vercel function time limits must cover FBR's 45 s timeout plus overhead (routes already use `maxDuration = 60`).

## 12. Production deployment prerequisites

1. Backup, then `npm run migrate:turso` for **v85** (and v84 if not yet run).
2. Env vars on Vercel: `FBR_TOKEN_KEY` (32 bytes base64), `FBR_GATEWAY_URL`, `FBR_GATEWAY_SECRET`.
3. VPS purchased with a static IPv4; gateway installed per the deployment guide; `fbr-api.mavin.pk` DNS record created.
4. PRAL confirms whitelisting of the gateway IP (and the per-taxpayer model).
5. Sandbox end-to-end test through the gateway with a real sandbox token, then production enablement per business.
