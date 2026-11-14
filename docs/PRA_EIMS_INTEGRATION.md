# PRA eIMS integration (MAVIN.pk server)

Status: built and tested against mock PRA responses only. No sandbox or production
invoice has been sent. Live submission is off three ways: per business (Super Admin),
per server (`PRA_PRODUCTION_ENABLED`), and by route (production needs the static-IP gateway).

## 1. Phase 1 report

### 1.1 What existed

| Area | Code | Use |
|---|---|---|
| Restaurant checkout | `src/lib/restaurant/store.ts` `pay()` | Finalises a fully paid bill: invoice number, frozen line amounts (`line_discount`, `line_tax`, `line_total`), table freed. **This is the event that starts fiscalisation.** |
| Restaurant refunds | `store.ts` `refund()` | Creates a linked credit bill (`refund_of`), the original unchanged. Becomes an eIMS Credit (type 3) with `RefUSIN`. |
| Receipt | `src/components/restaurant/ui.tsx` | Prints the PRA number and QR. Now only when the bill is `accepted`; otherwise "NOT A PRA FISCAL INVOICE". |
| PRA model | `src/lib/restaurant/praModel.ts` | Invoice builder, validation, response mapping, endpoints. Reused by the server. Fixed: 20-digit fiscal numbers are read digit for digit, and "Code 100 without a number" is not accepted. |
| Legacy PRA sender | `src/lib/restaurant/praService.ts`, `PraBackground.tsx`, `rest_pra_submissions` | Runs in the old Tauri desktop shell only; token in that computer's `local_secrets`; switched on by the tenant (`pra_enabled`). **Duplicate risk**: it and the server could both send the same bill. |
| FBR architecture | `src/server/fbr/*`, `fbr-gateway/` | Encrypted tokens, one-live-attempt submissions, uncertain → manual resolution, static-IP gateway on UpCloud (95.111.192.41). Pattern copied, data kept separate. |
| Isolation | `src/server/sqlPolicy.ts`, `tenantScope.ts`, `branches.ts` | Browser SQL is tenant-rewritten; server-only prefixes refused. `pra_*` added to the refused list and to the desktop-copy exclusions. |

### 1.2 Duplicate-submission points and how they are closed

1. **Legacy desktop sender + server.** Enabling PRA for a business writes `pra_server_managed = true` and `pra_enabled = false`; the legacy sender's `config()` stays off while managed; the checkout queues no legacy row; the server skips any bill the legacy sender already sent or was sending (recorded as `legacy`, number kept, owner reconciles).
2. **Double clicks, two counters, retries, restarts.** One `pra_submissions` row per bill + invoice type + environment (unique index), and one per POS ID + environment + USIN + type. The record is written as `sending` before the network call; a second caller gets the existing row.
3. **Interrupted send.** A `sending` row whose lock expired becomes `needs_reconciliation` (never resent automatically).

### 1.3 Outbound IP

- The PRA manual (§6.4.2) requires the **server IP to be whitelisted for production**: email eims@pra.punjab.gov.pk with PNTN, business name, POS ID, server IP and location.
- Vercel has no fixed outbound IP. MAVIN's static IP is the UpCloud gateway, **95.111.192.41** (also used for FBR).
- The gateway now has a separate route `POST /v1/pra`. It is off unless `PRA_ENABLED=1`, accepts only PRA's PostData address on `PRA_BASE_URL` (default `https://ims.pral.com.pk`), checks the invoice shape, and is signed and rate-limited like the FBR route.
- MAVIN uses it when `PRA_VIA_GATEWAY=1`. Production refuses to go direct unless `PRA_DIRECT_PRODUCTION=1`.
- **To confirm before live:**
  - the gateway's actual egress IP (Super Admin › FBR Integration › egress check);
  - whether PRA whitelists one IP per POS ID or per business;
  - whether sandbox also enforces whitelisting.

### 1.4 Sector matrix

Source read: a **consolidated copy** of the Second Schedule 2026-27 (conseric.pk). Its footnotes cite the *Punjab Finance Act 2026 (L of 2026), Punjab Gazette (Extraordinary) 1 July 2026, s.5k*.

The Gazette copy linked in the brief is a scanned PDF with no text layer, so it could not be read here. Every entry is therefore a **draft** until checked against the official Gazette.

"eIMS" below is a separate decision from taxability. PRA's POS registration sector list (manual §4.3) names *Restaurants, Hotel, Courier, Beauty Parlor*.

| Sector | Classification | Rate (copy) | Effective | Input adjustment | eIMS applies | PRA must confirm |
|---|---|---|---|---|---|---|
| Restaurant, café, coffee shop, food outlet | 9801.2000 (9801.9000 also listed) | 8 % by debit/credit card, mobile wallet or QR; 16 % others (Part III Sr. 4) | 1 Jul 2026 (FA 2026 s.5k(ii)) | None at 8 % | Yes (sector list) | Rate for a split cash + card bill; PaymentMode for wallet / QR |
| Hotel, motel, guest house | 9801.1000 | 8 % / 16 %, same condition (Part III Sr. 1) | 1 Jul 2026 (s.5k(i)) | None at 8 % | Yes (sector list) | Same as restaurants |
| Marriage hall / lawn, pandal, shamiana (marquee, banquet) | 9801.3000 | 8 % (Part III Sr. 2) | 1 Jul 2026 | None | **Unconfirmed** | Whether halls report through eIMS; whether to fiscalise at the advance, the event or the final bill |
| Catering and ancillary services | 9801.5000 | 8 % (Part III Sr. 2) | 1 Jul 2026 | None | **Unconfirmed** | eIMS applicability |
| Carriage of goods by road or rail | 98.04 / 9804.2000, 9804.9000 | 15 % (Part I Sr. 2) | To confirm (not marked as amended) | Allowed, provider and recipient | **Unconfirmed** | eIMS applicability |
| Freight forwarding | 9805.3000 | Rs 1,000 per bill of lading (Part II Sr. 2) | To confirm | Fixed tax | **Unconfirmed** | How a fixed amount maps to eIMS `TaxRate` / `TaxCharged` |
| Courier | Heading 98.05 (exact code to confirm) | General 16 % (Part I Sr. 1); no specific entry found | — | As under the Act | Yes (sector list) | Classification code |
| Contractors, construction | 9824.0000 / 9814.2000 | 16 % with input credit (others); 5 % without input for Government civil works; 1 % / 0 % for specified ADP / foreign-loan / PSDP projects (Part III Sr. 6 and Explanation) | To confirm | Depends on the case | **Unconfirmed** | eIMS applicability; contract-by-contract scope (services, construction, government projects, mixed goods and services, goods only) |

### 1.5 Open questions for PRA (eims@pra.punjab.gov.pk)

1. **Mixed payments**
   - For cash + card on one bill, does the 8 % rate apply to the card part only, the whole bill, or neither?
   - Is `PaymentMode` 5 (Mixed) still to be used?
2. **Mobile wallet, QR and bank transfer:** which `PaymentMode` code applies? The manual lists only 1 Cash, 2 Card, 3 Gift Voucher, 4 Loyalty Card, 5 Mixed and 6 Cheque.
3. **Receipt requirements**
   - What QR code content is required: the legacy `reg.pra` report URL, or the IRIS verification page?
   - Is the PRA logo required?
   - What wording is required on a receipt issued while PRA is unreachable?
   - Is there a time limit for sending an invoice issued during an outage?
4. **Reconciliation after an ambiguous answer:** is there an API to look up an invoice by POSID and USIN? The manual offers only the IRIS IMS Fiscal Report.
5. **Fiscal invoice number:** is it always numeric, and what is its maximum length? The manual shows 19 and 20 digits, sent as a number and as a string.
6. **Credit notes**
   - Should `RefUSIN` hold the original USIN or the original fiscal number?
   - May one original invoice have several partial credit notes?
7. **Other sectors:** do marquees, catering, transport and contractors use eIMS, and if so, when is the invoice issued?
8. **Counters**
   - Is whitelisting per business or per POS ID?
   - May one server IP serve several businesses?

## 2. What was built

| Part | Files |
|---|---|
| Migration v91 (server-only tables) | `src-tauri/src/lib.rs` `schema_sql_v91`, `scripts/migrate-turso.cjs`, `src/lib/schemaVersion.ts` (91), `desktop/resources/schema.sql` |
| Tables | `pra_accounts`, `pra_pos`, `pra_submissions`, `pra_audit`, `pra_tax_rules`, `pra_rule_assignments`, `pra_platform` |
| Rules (pure) | `src/lib/pra/rules.ts`: catalogue shape, draft entries with source and clause, rule in force by date, payment checks, approval checks |
| Server service | `src/server/pra/service.ts`: access and setup, counters, live approval, rules, assignments, payment mapping, fiscalisation, sweep, reconciliation, lists |
| Credentials | `src/server/pra/secretBox.ts`: AES-256-GCM with `PRA_TOKEN_KEY` (separate from FBR) |
| Transport | `src/server/pra/transport.ts`: the two documented URLs only, Bearer token, normal TLS, direct or through the gateway |
| API | `src/app/api/pra/route.server.ts`; nightly sweep added to `src/app/api/payments/reconcile/route.server.ts` |
| Gateway | `fbr-gateway/src/pra.ts`, `server.ts` (`POST /v1/pra`), `config.ts` (`PRA_ENABLED`, `PRA_BASE_URL`) |
| Super Admin | `src/app/admin/pra/page.tsx` (PRA Integration), `src/app/admin/pra/rules/page.tsx` (PRA Tax Suggestions), `src/config/adminNav.ts` |
| Business screens | `src/components/pra/PraSubmissions.tsx`, `src/app/restaurant/pra/page.tsx`, receipt in `src/components/restaurant/ui.tsx`, checkout `src/app/restaurant/page.tsx` |
| Legacy coordination | `src/lib/restaurant/store.ts`, `praService.ts`, `index.ts` (`fiscalize`, `praServerManaged`), `PraBackground.tsx` |
| Policy | `src/server/sqlPolicy.ts` (`pra_*` refused), `src/server/replicaTables.ts` (excluded from the desktop copy) |
| Tests | `tests/server/pra.test.ts` (18), `fbr-gateway/test/gateway.test.ts` (PRA route) |

### Submission states

| State | Meaning |
|---|---|
| `blocked` | Not sent; the reason is shown. Re-checked automatically. |
| `sending` | In flight, locked for 90 seconds. |
| `accepted` | Code 100 with a fiscal number. |
| `rejected` | PRA refused it. The owner may send it again after fixing the cause. |
| `needs_reconciliation` | Timeout, broken connection, 5xx, unreadable answer, or an interrupted send. Never resent until someone checks IRIS. |
| `queued` | Never left the server. Sent again. |
| `legacy` | Sent by the old desktop sender. |

### A bill is blocked when

- no counter for its branch is approved;
- the POS ID or token is missing;
- the sector is not restaurant or hotel;
- no approved rule is assigned for the bill's date;
- the rule's eIMS applicability is not "yes";
- the payment is mixed or uses an unconfirmed method;
- the bill's tax rate differs from the rate the rule requires;
- the rule has no 8-digit code;
- for a credit note, the original has not been accepted yet;
- for production, live approval or the server switch is missing.

The applied rule is stored with every submission (`rule_snapshot`). Sales tax, PRA withholding and federal income-tax withholding are kept in separate fields.

## 3. Migration and rollback

- **Apply:** `node scripts/backup-turso-snapshot.cjs`, then `npm run migrate:turso` (v91). New tables only; nothing existing changes.
- **Server variables:**
  - `PRA_TOKEN_KEY`: 32 random bytes, base64. Required to save credentials.
  - `PRA_PRODUCTION_ENABLED=1`: only at go-live.
  - `PRA_VIA_GATEWAY=1`: once the gateway route is deployed.
  - On the gateway: `PRA_ENABLED=1`.
- **Rollback:**
  1. Disable PRA for the business in Super Admin. This sets `pra_server_managed = false`, so the old desktop sender can be switched back on by the business.
  2. Unset the server variables.
  3. The v91 tables can stay: unused, server-only. Dropping them is safe once no submissions need keeping: `DROP TABLE pra_submissions;` etc. Keep `pra_submissions` for the audit period.

## 4. Operator guide (Super Admin)

1. **Business:** Super Admin › PRA Integration, then open the business. Record the PNTN and the registered name. Mark POS registration as *registered* once the business has registered its counters on reg.pra.punjab.gov.pk.
2. **Counter:** add a counter with its branch, the counter name exactly as registered, the PRA sector, and the environment (sandbox).
   - Enter the sandbox POS ID generated under "Generate Test POS", and the sandbox token.
   - Approve the counter (one per branch for now).
3. **Tax rule:** Super Admin › PRA Tax Suggestions.
   - Open the rule and check it against the official Gazette.
   - Approve it with the verification date.
   - Back on the business, assign the rule (all branches or one). Contractors need a contract note.
4. **Payment methods:** leave wallet / QR and bank transfer unconfirmed until PRA answers. Bills paid that way stay blocked.
5. **Enable access:** press **Enable PRA access**. The business's old desktop sender stands down.
6. **Sandbox:**
   - Bill a test order. It goes to the PRA sandbox, and the receipt shows the fiscal number.
   - Check the submissions list, then mark the sandbox test as *passed*.
7. **Whitelist:**
   - Email PRA the server IP (the gateway, 95.111.192.41) with the PNTN, business name, POS ID and location.
   - Mark it *requested*, then *approved* when PRA confirms.
8. **Production:**
   - Edit the counter: environment production, the production POS ID and the production token. Approve it again.
   - Press **Approve going live**. Production also needs `PRA_PRODUCTION_ENABLED=1` and the gateway route.
9. **Every day:** look at *Needs reconciliation*.
   - Check each one on IRIS (e.pra.punjab.gov.pk › IMS Fiscal Report).
   - Press **Found on PRA** and enter the number, or **Not on PRA** to send it again.

The business owner sees the state and the submissions under Restaurant › PRA, and can do step 9. Staff only fiscalise bills at checkout.

## 5. Go-live checklist

- [ ] Migration v91 applied; `PRA_TOKEN_KEY` set.
- [ ] Business registered on PRA (PNTN, business, contacts, branches, POS details with MAC and IP).
- [ ] Sandbox POS IDs generated. The sandbox token entered per counter: the public sandbox token from manual §6.4.2, or the one PRA issued.
- [ ] Restaurant rule verified against the Gazette, approved with the date, and assigned.
- [ ] The restaurant's tax settings match the rule (8 % card, 16 % cash). Otherwise every bill is blocked.
- [ ] Sandbox: a card bill, a cash bill, a full refund and a partial refund all accepted. Fiscal numbers checked on IRIS.
- [ ] Ambiguous handling rehearsed: one bill sent while the gateway is stopped, then reconciled.
- [ ] Gateway `PRA_ENABLED=1` deployed; egress IP confirmed; MAVIN `PRA_VIA_GATEWAY=1`.
- [ ] IP whitelisted by PRA for each production POS ID.
- [ ] Production POS IDs and tokens entered from the POS Registration screen; counters re-approved.
- [ ] Receipt requirements confirmed with PRA (QR content, logo, outage wording). Template updated if needed.
- [ ] Open questions 1 and 2 answered (mixed payments, wallet / QR). Payment mapping updated.
- [ ] `PRA_PRODUCTION_ENABLED=1`; live approved; first live bill checked on IRIS.
- [ ] Old desktop PRA sender confirmed off on every counter computer.
