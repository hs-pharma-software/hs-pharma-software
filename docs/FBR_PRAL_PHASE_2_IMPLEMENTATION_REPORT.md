# MAVIN — FBR/PRAL Digital Invoicing: Phase 2 Implementation Report

Date: 12 November 2026 · Builds on `docs/FBR_PRAL_PHASE_1_AUDIT_REPORT.md` · Checklist: `docs/FBR_PRAL_IMPLEMENTATION_CHECKLIST.md`

**Status: developed and tested locally; not deployed.** No VPS was bought, no DNS changed, no live migration run, no live FBR
invoice sent, nothing pushed. Every FBR call in testing went to a local stand-in for FBR.

---

## 1. Completed development tasks

1. **Security fix:** browser SQL (`/api/db`) now refuses `offline_*`, `payment_*` and `fbr_*` tables (reads and writes). Before, any
   login of a business, a cashier included, could read and change offline-device secrets and payment-merchant rows.
2. **Migration v85** (additive only): `fbr_credentials` (encrypted tokens per business) and `fbr_submissions` (one row per attempt,
   written **before** sending). A partial unique index allows at most one *pending / uncertain / accepted* attempt per
   document and environment, so the database itself refuses duplicates.
3. **Token security:** tokens encrypted with AES-256-GCM (`FBR_TOKEN_KEY`, separate from the payments key); browsers get only a hint
   (`••••1234`) and only for managers; the old plain-text settings are hidden from browsers, copied into encrypted storage the
   first time they're needed, and deleted when the owner saves tokens in the new form.
4. **Submission service** (`src/server/fbr/service.ts`): checks business, FBR switch, *enabled*, permission (`invoice.fbr_submit`),
   branch access, document ownership, environment and seller NTN; claims the attempt; sends; records **accepted**, **rejected**,
   **uncertain** or **not received**; writes the FBR number onto the invoice / store document.
   - **Uncertain** (timeout, dropped connection, FBR 5xx without a readable answer, "success" without a number) is **never
     re-sent automatically**. A person checks IRIS / the PRAL portal and resolves it: *FBR does not have it* (can be sent again)
     or *FBR has it* (enter the number).
   - An attempt whose sender disappeared (browser closed mid-send) becomes uncertain after 3 minutes.
5. **Two routes, one record:**
   - **Gateway mode** (when `FBR_GATEWAY_URL` + `FBR_GATEWAY_SECRET` are set): MAVIN's server sends through the gateway's static IP.
   - **Direct mode** (default until the gateway is live): the browser sends from the shop's own whitelisted IP *as today*, but the
     attempt is still claimed and finished on the server, so duplicate protection and unclear-outcome tracking work **now**.
6. **`/api/fbr`** route: `config`, `tokens`, `test`, `reference`, `submit`, `finish`, `resolve`, `list`; Super Admin `overview`, `egress`.
7. **Client:** the three submit paths (retail/pharmacy invoices, lab/service bills, electric store) now pass their document to
   `submitInvoiceToFbr`, which goes through the server; token tests and FBR reference lookups go through the server too. Desktop
   (Tauri local mode) keeps its old behaviour.
8. **Screens:** *Settings → FBR* (encrypted token save, saved-token hint, "how invoices reach FBR" note, storage warning;
   also used by the Super Admin for a business), an **FBR submissions** panel (unclear / rejected attempts, resolve actions),
   and **Super Admin → FBR Integration** (route, gateway health and version, *Check outbound IP*, per-business status and
   counts, recent problems; no tokens anywhere).
9. **Gateway service** (`fbr-gateway/`): TypeScript, **no runtime dependencies**, Node ≥ 22.6. HMAC-signed requests with timestamp
   window and replay protection, key rotation (several secrets), fixed FBR address list (not an open proxy), 1 MB body limit,
   per-business and total rate limits, 40 s FBR timeout, outcome classification (`response` / `not_sent` / `uncertain`),
   redacted JSON logs, `/health`, `/v1/egress-ip`, graceful shutdown; systemd unit (auto-restart, hardening) and Caddyfile.
10. **Deployment guide** (`docs/FBR_GATEWAY_DEPLOYMENT.md`): VPS, firewall, Node, service, HTTPS, DNS, static-IP check, PRAL
    whitelisting, MAVIN settings, sandbox and production steps, monitoring, secret rotation, backup and rollback.

## 2. Modified and new files

**New**
- `fbr-gateway/` (`src/{config,auth,fbr,log,server,main}.ts`, `test/gateway.test.ts`, `deploy/{mavin-fbr-gateway.service,Caddyfile,fbr-gateway.env.example}`, `package.json`, `tsconfig.json`, `README.md`, `.gitignore`)
- `src/server/fbr/{service,gatewayClient,secretBox}.ts`
- `src/app/api/fbr/route.server.ts`
- `src/app/admin/fbr/page.tsx`
- `src/components/settings/FbrSubmissionsPanel.tsx`
- `src/lib/fbrResponse.ts` (pure FBR answer reading, shared by browser and server)
- `tests/server/fbr-gateway-flow.test.ts`, `tests/regression/server-only-tables.test.ts`
- `docs/FBR_PRAL_PHASE_1_AUDIT_REPORT.md`, `docs/FBR_PRAL_PHASE_2_IMPLEMENTATION_REPORT.md`, `docs/FBR_PRAL_IMPLEMENTATION_CHECKLIST.md`, `docs/FBR_GATEWAY_DEPLOYMENT.md`

**Modified**
- `src/lib/fbr.ts` (server routing, `SERVER_TOKEN` placeholder, outcomes), `src/lib/fbrSubmit.ts`, `src/lib/serviceFbr.ts`, `src/lib/electric/fbr.ts`
- `src/components/settings/FbrSettingsCard.tsx`, `src/config/adminNav.ts`
- `src/server/sqlPolicy.ts` (server-only tables), `src/server/tenantScope.ts` (token settings server-only)
- `src-tauri/src/lib.rs` (v85), `scripts/migrate-turso.cjs` (v85), `src/lib/schemaVersion.ts` (85), `desktop/resources/schema.sql` (regenerated)
- `tsconfig.json` (excludes `fbr-gateway/`, which has its own)

Not part of this work: `src/app/api/app/`, `src/server/appDocs.ts`, `tests/server/app-docs.test.ts` (uncommitted Android work already in the folder).

## 3. Existing functionality reused

`buildFbrPayload` and `fbrData` unchanged; FBR answer handling moved as is into `fbrResponse.ts` (plus the *uncertain* cases);
the three document loaders; `callerOf` / `HttpError` / `jsonError`; `callerCan` with the existing opt-in action
`invoice.fbr_submit`; `branchScopeFor`; `SERVER_ONLY_SETTINGS`; `tenants.fbr_allowed` (Super Admin switch); the AES-256-GCM
pattern from payments; the SQLite test harness.

## 4. Database changes

Migration **v85**, additive only (`CREATE TABLE / INDEX IF NOT EXISTS`):

| Table | Purpose |
|---|---|
| `fbr_credentials(tenant_id PK, sandbox_token_enc, production_token_enc, sandbox_hint, production_hint, updated_by, created_at, updated_at)` | encrypted tokens |
| `fbr_submissions(id PK, tenant_id, branch_id, doc_type, doc_id, environment, route, status, payload_hash, fbr_invoice_no, http_status, error, response_excerpt, resolution, resolved_by, resolved_at, created_by, created_at, updated_at)` | one row per attempt |
| `ux_fbr_submissions_live` (unique, partial: status in pending / uncertain / accepted) | duplicate prevention |

Data change on first use: plain-text tokens in `settings` are **copied** (encrypted) into `fbr_credentials`; they are deleted only
when the owner saves tokens in the new form. Nothing else is deleted or rewritten.

## 5. Tests executed

| Suite | Result |
|---|---|
| Gateway (`fbr-gateway`, `npm test`): health, routing, sandbox/production addresses, reference allow-list, unsigned / wrong / tampered / stale / replayed requests, key rotation, bad bodies, oversized body, FBR 401/500, timeout and dropped connection → uncertain, refused connection → not sent, rate limits, log redaction, config checks | **12 / 12 pass** |
| End to end (`tests/server/fbr-gateway-flow.test.ts`: real service → real gateway → stand-in FBR): token encryption and legacy copy, single send + stored number, **3 concurrent submits → 1 FBR call**, uncertain never re-sent + both resolutions, FBR 401 / item error → rejected then resubmitted, FBR 500 → uncertain, gateway down → not received, wrong gateway secret, **tenant isolation**, permissions / business switch / branch / enabled / seller NTN, **sandbox vs production**, electric documents, direct mode, abandoned sender, reference lookups, token test, Super Admin overview (no tokens), identical signatures on both sides | **18 / 18 pass** (also 8 copies at once: 144 / 144) |
| Server-only tables (`tests/regression/server-only-tables.test.ts`) | **2 / 2 pass** |
| Full regression (`npm test`, 669 tests) | **662 pass, 0 fail, 7 skipped** |
| Type checks: web app, desktop web build, gateway | clean |
| Gateway compiled build: starts, `/health` OK, unsigned request → 401, JSON logs | OK |

## 6. Passed and failed tests

- Early full runs had intermittent failures in the end-to-end file. Running it 8 times at once reproduced them (16 / 144
  failed) and showed the real cause, `ECONNRESET`: the gateway closed idle connections after Node's default 5 s, and a caller
  could reuse a connection just as it was being closed. In production Caddy keeps idle connections for 2 minutes, so real
  submissions would have been wrongly marked "uncertain". **Fixed:** the gateway keeps idle connections 75 s
  (`server.keepAliveTimeout`), and Caddy closes its own after 30 s (`keepalive 30s`), so the caller always closes first.
  After the fix: 144 / 144 under the same load, and the full suite 662 / 662 (7 skipped).
- Earlier, 10 date-sensitive tests (blood bank, lab, clinic, sterilisation) failed when run around midnight; they also fail on
  the unchanged code at that hour and passed in this daytime run. Unrelated to FBR.
- **No live PRAL test was possible** (no sandbox token through a whitelisted gateway yet): all FBR responses were simulated.

## 7. Remaining issues

1. **PRAL confirmation needed:** whether one gateway IP can be whitelisted for all businesses using MAVIN, or each taxpayer must
   register it (checklist #23).
2. **Unclear submissions need a person** until PRAL offers a lookup of submitted invoices (checklist #27).
3. **Payload is built by the browser** (as before); the server checks document, business, branch, environment and seller NTN,
   but not every field. A server-built payload is a later step (checklist #26).
4. **Android app** has no FBR submission yet (checklist #28).
5. **Vercel Hobby** terms may not allow commercial use (audit §7); confirm your plan.
6. In direct mode a browser cannot tell "never sent" from "answer lost", so any network failure there is treated as unclear
   (safe, but needs a resolve click). Gateway mode can tell the two apart.

## 8. Deployment requirements

1. Backup → `npm run migrate:turso` (v84 and v85). *(approval)*
2. Vercel: `FBR_TOKEN_KEY` (can go first: encrypted tokens while still in direct mode). *(approval)*
3. Commit and push to `main`. *(approval)*
4. VPS + gateway + Caddy + DNS (`docs/FBR_GATEWAY_DEPLOYMENT.md` §1–5). *(approval: purchase, DNS)*
5. PRAL whitelists the gateway IP (§6). *(external)*
6. Vercel: `FBR_GATEWAY_URL`, `FBR_GATEWAY_SECRET`; redeploy (§7). *(approval)*
7. Sandbox test (§8), then production per business (§9).

Order matters: deploying the code without the migration breaks FBR saving (the new tables don't exist yet). Deploying
without the gateway variables is safe: everything stays in direct mode.

## 9. VPS setup instructions

See `docs/FBR_GATEWAY_DEPLOYMENT.md`: Ubuntu 24.04, `ufw` (22/80/443 only), Node.js 22, a dedicated `fbrgw` user, systemd unit
`mavin-fbr-gateway` (auto-restart, hardened), Caddy for HTTPS, `/etc/mavin-fbr-gateway.env` (chmod 600).

## 10. PRAL IP whitelisting instructions

1. On the VPS, `curl https://api.ipify.org` must print the static IP (or use *Super Admin → FBR Integration → Check outbound IP*).
2. Send that IP to PRAL Digital Invoicing support, as MAVIN's integration IP, for **sandbox** and **production**.
3. Ask PRAL whether each taxpayer must add the IP to their own DI profile; if yes, add that step to business onboarding.
4. Keep MAVIN in direct mode until PRAL confirms; then set the gateway variables.

Your office StormFiber IPs (101.53.247.128/129) stay valid for direct mode from that office in the meantime.

## 11. Production readiness

| Area | Status |
|---|---|
| Code, tests, deployment files | **Ready** |
| Duplicate protection and unclear-outcome tracking | **Ready** (works in direct mode as soon as v85 is migrated and the code deployed) |
| Encrypted tokens | **Ready** once `FBR_TOKEN_KEY` is set |
| Gateway in production | **Not ready**: needs VPS, DNS, PRAL whitelisting, Vercel variables (all need approval or PRAL) |
| Live PRAL verification | **Not done**: needs a sandbox token through the whitelisted gateway |
