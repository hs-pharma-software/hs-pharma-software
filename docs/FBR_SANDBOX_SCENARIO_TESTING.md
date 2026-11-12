# FBR Sandbox Scenario Testing

*Super Admin → FBR Integration → **Scenario Testing***. Also on *Tenants → (business) → FBR → **Scenario Testing***.

Last updated: 12 November 2026. Status: built and tested with a simulated FBR. **Not deployed** and **no real sandbox
request sent** (both need your approval).

---

## 1. What was inspected

| Area | Found | Used for |
|---|---|---|
| Invoice builder | `src/lib/fbrPayload.ts` `buildFbrPayload` builds every real FBR invoice (sale type, rate, UOM, SRO, 3rd Schedule retail price, buyer type, `scenarioId` in sandbox) | Test invoices are built by the **same function** |
| Sale type → scenario | `src/lib/fbrData.ts` `FBR_SALE_TYPES`: 5 sale types, mapping to SN001, SN002, SN005, SN006, SN007, SN008, SN026, SN027, SN028 by buyer type and the "retailer" profile | The 9 **verified** scenarios |
| FBR submission service | `src/server/fbr/service.ts` (encrypted tokens, gateway / direct routes, response reading) | Tokens, gateway calls, answer reading |
| Gateway | `fbr-gateway/` already supports `validate`, `post` and HS_UOM lookups | No gateway change |
| Products, prices, customers | `products` (HS code, FBR UOM, sale type, rate, SRO), `price_list` (sale price), `customers` (NTN, registration type) | Real product and buyer for each test |
| Super Admin | `/admin/fbr` page, `TenantDetailPanel` FBR setup | Where the button goes |
| Schema validation | No Zod in the project; validation is hand-written (`buildFbrPayload`) | A hand-written check (§4), no new dependency |

## 2. How it works

1. **Business:** seller details, sandbox token (hint only), route (gateway or direct), problems that block testing, testing history (resume).
2. **Business Nature:** the 8 FBR portal options (multi-select).
3. **Sector (For Sandbox Testing Only):** the 16 FBR portal options (multi-select). MAVIN's own business types are not offered.
4. **Scenarios:** FBR has **no API** that returns a taxpayer's assigned scenarios, so the Super Admin ticks the scenarios the
   FBR portal shows. MAVIN does not guess them. Search by code or description. For each verified scenario: which product to use
   (default: the first suitable one), and the buyer (registered customer, or typed NTN) where the scenario needs one.
5. **Start Automated Testing:** one scenario after another. For each:
   build → **local check** → **FBR sandbox validate** → (only if valid) **FBR sandbox post** → record the answer and FBR number.
   Live progress: current scenario, n / total, %, status per scenario.
6. **Results:** Total / Passed / Failed / Pending / Skipped / Incomplete; *Retry All Incomplete*, *Select Scenarios* +
   *Retry Selected*, *View Errors*, *Finish*. Per scenario: change product / buyer, retry, skip, resolve an unclear post,
   tick *Confirmed in the FBR portal*, and every attempt's invoice JSON (buyer NTN masked) and FBR's answers.
7. **Completion:** "Sandbox Testing Completed Successfully" when all non-skipped scenarios passed, then
   "All selected sandbox tests passed. Please confirm completion in the FBR portal." FBR offers no API to confirm portal
   completion, so that is a tick by the Super Admin, shown separately. **Production is never switched on here.**

### The test invoice

For a scenario, MAVIN takes **one unit of a real product** of the business with that scenario's sale type and complete FBR data
(HS code, FBR UOM, rate, SRO where needed) and its current sale price, and builds the invoice exactly as for a real sale:

| Scenario | Sale type | Buyer | "Retailer" profile |
|---|---|---|---|
| SN001 | Goods at standard rate | Registered (NTN) | no |
| SN002 | Goods at standard rate | Unregistered | no |
| SN005 | Goods at Reduced Rate | either (chosen) | no |
| SN006 | Exempt goods | either | no |
| SN007 | Goods at zero-rate | either | no |
| SN008 | 3rd Schedule Goods | either | no |
| SN026 | Goods at standard rate | Unregistered | yes |
| SN027 | 3rd Schedule Goods | Unregistered | yes |
| SN028 | Goods at Reduced Rate | Unregistered | yes |

The "retailer" profile is set only for the test invoice; the business's own setting is not changed. If no suitable product or
buyer exists, the scenario shows **Needs information** and says what to add: nothing is made up.
Scenarios that need FBR's HS/UOM list are checked against FBR's own list (through the gateway) before sending.

Codes MAVIN's invoice builder does not produce (SN003, SN004, SN009–SN025, and any code added from the portal) are
**track only**: listed, never sent automatically. Their titles come from FBR's DI technical specification; check them against
the portal.

## 3. Safety

| Rule | How |
|---|---|
| Super Admin only | every action checks `role = super_admin` (tested) |
| Sandbox only | sandbox token, `*_sb` addresses; the session table refuses any other environment (`CHECK`) |
| Real data untouched | nothing written to invoices, stock, prices, accounts or `fbr_submissions` (tested) |
| Business's settings untouched | its environment (e.g. Production) stays as it was (tested) |
| No double send | one attempt in flight per scenario and one per business (database unique indexes; tested with simultaneous clicks) |
| No blind retry | a passed scenario is not sent again; an unclear post blocks the scenario until a person checks the portal and resolves it; an invoice FBR refused is not sent again **unchanged** (a new date alone does not count) |
| Invalid is never posted | the post happens only after FBR's validate answers "valid" |
| Tokens never shown | not stored with attempts, not in any view (tested) |
| Masking | the buyer NTN/CNIC shows only its last 3 characters |
| Isolation | products and buyers must belong to the business (tested) |
| Interrupted | a page closed mid-test: before posting, the attempt becomes "nothing posted"; after posting began, "unclear" |
| Long jobs on Vercel | each scenario is one short request; the browser drives the sequence and the session is saved after every step, so it can be resumed |

## 4. Local validation

`checkScenarioPayload` (in `src/lib/fbrScenarios.ts`) checks the invoice before FBR sees it:

- the FBR fields and their types;
- `invoiceType`, the date format, seller NTN/CNIC, buyer registration type and NTN for registered buyers, `scenarioId`;
- one item: HS code format, rate format (`18%` / `Exempt`), UOM, sale type of the scenario, quantities and amounts ≥ 0;
- the arithmetic: sales tax = rate × value, or × retail price for 3rd Schedule; total = value + sales tax + further tax +
  FED + extra tax;
- SRO schedule and item serial where the sale type needs them.

`buildFbrPayload`'s own checks (valid HS code list, UOM allowed for the HS code, SRO) run first.

## 5. Database (migration v86, additive)

| Table | Holds |
|---|---|
| `fbr_test_sessions` | business, who started it, Business Nature and Sector (JSON), environment (sandbox only), status, start / finish |
| `fbr_scenario_tests` | per scenario: product, buyer, status, local / FBR validation status, submission status, FBR number, attempt count, last error, portal confirmation |
| `fbr_scenario_attempts` | every attempt kept: route, step, state, invoice JSON sent (never a token), its fingerprint, FBR's validate and post answers (first 4,000 characters), FBR number, error |

Unique indexes: one session row per scenario code; one attempt in flight (or unclear) per scenario; one attempt running per
business. All three tables start with `fbr_`, so browsers cannot read or write them (only MAVIN's server).

**Deploy order:** back up, run `npm run migrate:turso` (applies v86), then push. The app expects schema 86.

## 6. Statuses

| Status | Means |
|---|---|
| Not started | not tried yet |
| Needs information | no suitable product, or a registered buyer is needed |
| Local validation failed | MAVIN's checks found a data problem; nothing sent |
| FBR validation failed | FBR's validate refused it (FBR's reasons shown); not posted |
| FBR did not answer (nothing posted) | validate had no answer, or nothing reached FBR; safe to retry |
| Sandbox submission passed | posted; FBR returned an invoice number |
| Sandbox submission rejected | FBR refused the post (reasons shown) |
| Unclear: check the FBR portal | posted, no clear answer; resolve it after checking the portal |
| FBR portal completion confirmed | ticked by the Super Admin after checking the portal |
| Skipped | left out by the Super Admin |

## 7. Tests

`tests/server/fbr-scenarios.test.ts`: **18 / 18 pass**. They run the real service and the real gateway against a simulated FBR
sandbox, with made-up businesses and no real FBR call.

- exact Business Nature and Sector options; MAVIN's internal categories are not FBR sectors; Super Admin only; option and
  code checks;
- all 9 verified scenarios end to end:
  - each one validated, then posted;
  - sandbox token and addresses only;
  - correct `scenarioId`, buyer type and tax (18 % of 100 = 18; 3rd Schedule 18 % of retail price 300 = 54; reduced rate
    1 % with SRO and `extraTax ""`; Exempt);
  - real data unchanged; no token in any view;
- missing product or buyer: asked for, nothing sent;
- local failure (missing SRO) and UOM not in FBR's HS/UOM list: nothing sent;
- FBR validation failure: not posted, and the same invoice is refused on retry (also on a new day); after the product is fixed
  it passes, and both attempts are kept;
- unclear post: blocked until resolved, both resolutions;
- post rejected;
- simultaneous clicks reach FBR once, one scenario per business at a time;
- interrupted after posting began: becomes unclear;
- direct mode: the browser validates and posts, MAVIN records each step, wrong-step and finished reports are refused;
- track-only codes are never run;
- portal confirmation only after a pass; a finished session cannot run; the business's environment is unchanged;
- another business's product is refused.

Also: the FBR invoice tests and the server-only table tests still pass, and type and lint checks are clean.
**Not tested automatically:** the wizard's look on phone, tablet and desktop. There is no UI test runner in the project. It
uses the existing `Modal`, which opens as a bottom sheet on phones, and its tables scroll sideways.

## 8. Open points

1. **No live check yet.** Run it once with a real sandbox token through the gateway (or from a whitelisted PC in direct mode)
   before relying on it.
2. **Which scenarios a business must pass** comes from the FBR portal; there is no API. The Super Admin ticks them.
3. **Track-only scenarios** (steel, petroleum, telecom, services, FED and others) need their own invoice set-up and verified
   sample data from PRAL's documentation before MAVIN can build them.
4. **Direct mode in a web browser:** FBR may block calls from a browser (CORS). Use the desktop app from a whitelisted
   connection, or the gateway.
5. **Sector multi-select:** allowed, as the portal's checkboxes suggest. If the portal allows only one, tick only one.
6. **3rd Schedule retail price** uses the product's sale price, as real invoices do. If a product's printed retail price
   differs from its sale price, real invoices have the same issue.
