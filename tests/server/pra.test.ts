/** PRA eIMS through MAVIN's server: access, counters, rules, cases pending PRA
 * confirmation, fiscalisation state machine, duplicates, reconciliation,
 * credits, isolation, receipt details. PRA is a mock (no Sandbox or
 * production call is made). */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import type { Sql } from "@/server/subSupers";
import type { Caller } from "@/server/sqlPolicy";
import * as pra from "@/server/pra/service";
import { fiscalNumberFrom, mapPraResponse, praVerifyUrl } from "@/lib/restaurant/praModel";
import { caseBlock, checkPayment, ruleOn, pctCodeOf } from "@/lib/pra/rules";
import { formatPctCode, splitYearTax } from "@/lib/pra/services";
import { authorize, analyzeSql } from "@/server/sqlPolicy";

process.env.PRA_TOKEN_KEY = randomBytes(32).toString("base64");
delete process.env.PRA_PRODUCTION_ENABLED;
delete process.env.PRA_VIA_GATEWAY;

let db: DatabaseSync;
let sql: Sql;
const T = "2026-11-10T10:00:00.000Z";
const SUPER: Caller = { userId: "sa", role: "super_admin", tenantId: null };
const OWNER: Caller = { userId: "o1", role: "owner", tenantId: "t1" };
const OWNER2: Caller = { userId: "o2", role: "owner", tenantId: "t2" };
const STAFF_B: Caller = { userId: "s1", role: "staff", tenantId: "t1", permissions: null };
const run = (q: string, ...a: unknown[]) => db.prepare(q).run(...(a as never[]));
const one = (q: string, ...a: unknown[]) => db.prepare(q).get(...(a as never[])) as Record<string, unknown>;
const all = (q: string, ...a: unknown[]) => db.prepare(q).all(...(a as never[])) as Record<string, unknown>[];

/** The mock PRA: answers in order; records what was posted. */
let answers: (() => Response | never)[] = [];
let posted: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
const fetchImpl = (async (url: string, init: RequestInit) => {
  posted.push({ url: String(url), auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) });
  const next = answers.shift();
  if (!next) throw new Error("no mock answer");
  return next();
}) as unknown as typeof fetch;
const ok = (no = "90000520191112000369") => () => new Response(`{"InvoiceNumber":${no},"Response":"Invoice received successfully","Code":"100"}`, { status: 200 });
const deps = { fetchImpl, gateway: null, now: () => new Date(T) };
const later = (hours: number) => ({ ...deps, now: () => new Date(Date.parse(T) + hours * 3_600_000) });

/** A paid bill of 2 x Karahi (1,000), tax at `rate`, paid by one method or split between several. */
function order(id: string, o: { no: number; branch?: string; method?: string | string[]; rate?: number; refundOf?: string; at?: string; discount?: number; tenant?: string; qty?: number; gross?: number }) {
  const methods = Array.isArray(o.method) ? o.method : [o.method ?? "card"];
  const rate = o.rate ?? 8;
  const gross = o.gross ?? 1000, disc = o.discount ?? 0, tax = Math.round((gross - disc) * rate) / 100, total = gross - disc + tax;
  const share = Math.round((total / methods.length) * 100) / 100;
  const pays = methods.map((m, i) => ({ method: m, amount: i === methods.length - 1 ? Math.round((total - share * (methods.length - 1)) * 100) / 100 : share, reference: m === "cash" ? null : `REF-${m}-${o.no}` }));
  run(`INSERT INTO rest_orders (id, tenant_id, branch_id, order_no, order_type, status, gross, discount, tax, tax_rate, total, paid, payment_status, payments, invoice_no, invoiced_at, refund_of, customer_name, customer_phone, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'dine_in', ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?, 'Ali Buyer', '03001234567', ?, ?)`,
    id, o.tenant ?? "t1", o.branch ?? "b1", o.no, "paid", gross, disc, tax, rate, total, total, JSON.stringify(pays), o.no, o.at ?? T, o.refundOf ?? null, o.at ?? T, o.at ?? T);
  run(`INSERT INTO rest_order_items (id, tenant_id, branch_id, order_id, code, name, qty, unit_price, line_total, line_discount, line_tax, kitchen_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'K1', 'Karahi', ?, 500, ?, ?, ?, 'served', ?, ?)`, `${id}-i`, o.tenant ?? "t1", o.branch ?? "b1", id, o.qty ?? 2, gross, disc, tax, T, T);
}

/** t1 set up for the Sandbox: access, registration, a counter on branch b1, the restaurant rule approved and assigned. */
async function ready() {
  await pra.saveAccount(sql, SUPER, { tenantId: "t1", pntn: "1234567-8", registeredName: "Test Restaurant", registrationStatus: "registered" }, deps);
  await pra.setAccess(sql, SUPER, { tenantId: "t1", access: "enabled" }, deps);
  await pra.savePos(sql, SUPER, { tenantId: "t1", branchId: "b1", counter: "C1", sector: "restaurant", environment: "sandbox", sandboxPosId: "123456", sandboxToken: "sandbox-token-xyz-0001" }, deps);
  const pos = one(`SELECT id FROM pra_pos WHERE tenant_id = 't1'`);
  await pra.decidePos(sql, SUPER, { tenantId: "t1", id: pos.id, approve: true }, { ...deps, now: () => new Date("2026-11-01T00:00:00Z") });
  const rules = await pra.listRules(sql, SUPER, {}, deps);
  const r = rules.find((x) => x.rule_key === "restaurant-9801.2000")!;
  await pra.decideRule(sql, SUPER, { id: r.id, decision: "approve", lastVerifiedAt: "2026-11-05" }, deps);
  await pra.assignRule(sql, SUPER, { tenantId: "t1", ruleKey: r.rule_key }, deps);
}

beforeEach(() => {
  db = fullSchemaDb();
  sql = sqliteSql(db);
  answers = [];
  posted = [];
  for (const t of ["t1", "t2"]) run(`INSERT INTO tenants (id, name, business_type, created_at, updated_at) VALUES (?, ?, 'restaurant', ?, ?)`, t, `Rest ${t}`, T, T);
  run(`INSERT INTO branches (id, tenant_id, code, name, is_main, address, created_at, updated_at) VALUES ('b1', 't1', 'B1', 'Main', 1, '12 Mall Road, Lahore', ?, ?)`, T, T);
  run(`INSERT INTO branches (id, tenant_id, code, name, is_main, created_at, updated_at) VALUES ('b2', 't1', 'B2', 'Gulberg', 0, ?, ?)`, T, T);
  run(`INSERT INTO branches (id, tenant_id, code, name, is_main, created_at, updated_at) VALUES ('c1', 't2', 'C1', 'Other', 1, ?, ?)`, T, T);
});

// ── Pure pieces ──────────────────────────────────────────────────────────

test("the fiscal number is an opaque string: every digit of a JSON number, letters, leading zeros, JSON inside a string", () => {
  assert.equal(fiscalNumberFrom(`{"InvoiceNumber":90000520191112000369,"Response":"ok","Code":"100"}`), "90000520191112000369");
  assert.equal(fiscalNumberFrom(`{"InvoiceNumber":"9000052011142444901","Code":"100"}`), "9000052011142444901");
  assert.equal(fiscalNumberFrom(`{"InvoiceNumber":"126983DJCN820607","Code":"100"}`), "126983DJCN820607", "alphanumeric (Tech. Spec. v1.2 FAQ 4)");
  assert.equal(fiscalNumberFrom(`{"InvoiceNumber":"000901234","Code":"100"}`), "000901234", "leading zeros kept");
  assert.equal(fiscalNumberFrom(`{"InvoiceNumber":123456789012345678901234567890,"Code":"100"}`), "123456789012345678901234567890", "30 digits, no rounding");
  assert.equal(fiscalNumberFrom(JSON.stringify(`{"InvoiceNumber":90000520191112000369,"Code":"100"}`)), "90000520191112000369");
  assert.equal(fiscalNumberFrom(`{"InvoiceNumber":"Not Available","Code":"104"}`), null);
  // Real PRA Sandbox answer (2026-11-18, test POS 821651): asterisks are part of the number.
  assert.equal(fiscalNumberFrom(`{"InvoiceNumber":"821651FKLK41348851*test*","Code":"100","Response":"Invoice received successfully"}`), "821651FKLK41348851*test*");
  assert.equal(mapPraResponse({ httpStatus: 200, body: `{"InvoiceNumber":"821651FKLK41348851*test*","Code":"100"}` }).status, "accepted");
  assert.equal(fiscalNumberFrom(`{"InvoiceNumber":9.0005e19,"Code":"100"}`), null, "a number PRA rounded is not trusted");
  assert.equal(mapPraResponse({ httpStatus: 200, body: `{"InvoiceNumber":"126983DJCN820607","Code":"100"}` }).praInvoiceNo, "126983DJCN820607");
  assert.equal(mapPraResponse({ httpStatus: 200, body: `{"InvoiceNumber":"Not Available","Code":"100"}` }).status, "manual_review", "success without a number is not acceptance");
  assert.equal(praVerifyUrl("126983DJCN820607"), "https://reg.pra.punjab.gov.pk/IMSFiscalReport/SearchPOSInvoice_Report.aspx?PRAInvNo=126983DJCN820607");
});

test("rules by effective date; payments: documented cash / card, wallet / QR and bank transfer pending a code, mixed = PaymentMode 5 with a pending rate", () => {
  const base = { rule_key: "r", status: "approved" as const, effective_to: null };
  const rules = [{ ...base, version: 1, effective_from: "2025-07-01", effective_to: "2026-06-30" }, { ...base, version: 2, effective_from: "2026-07-01" }];
  assert.equal(ruleOn(rules, "r", "2026-06-30")?.version, 1);
  assert.equal(ruleOn(rules, "r", "2026-07-01")?.version, 2);
  assert.equal(pctCodeOf("9801.2000"), "98012000");
  const pay = (m: string[]) => m.map((method) => ({ method, amount: 10 }));
  assert.deepEqual([checkPayment(pay(["cash"])).taxClass, checkPayment(pay(["cash"])).praMode, checkPayment(pay(["cash"])).problems.length], ["other", 1, 0]);
  assert.deepEqual([checkPayment(pay(["card"])).taxClass, checkPayment(pay(["card"])).praMode], ["qualifying_digital", 2]);
  const wallet = checkPayment(pay(["digital"]));
  assert.deepEqual([wallet.taxClass, wallet.praMode, wallet.cases], ["qualifying_digital", null, ["wallet_qr"]], "wallet / QR qualifies for 8 %; its code is pending");
  const bank = checkPayment(pay(["bank"]));
  assert.deepEqual([bank.taxClass, bank.cases], ["other", ["bank_transfer"]], "a bank transfer is an other payment (16 %)");
  const mixed = checkPayment(pay(["cash", "card"]));
  assert.deepEqual([mixed.praMode, mixed.taxClass, mixed.cases], [5, null, ["mixed_payment"]]);
  assert.match(mixed.problems[0], /pending/);
  assert.equal(checkPayment(pay(["cash", "card"]), { mixed_payment: { ratePolicy: "whole_other" } }).taxClass, "other");
  // Production needs PRA's confirmation (and a sample payload where asked); Sandbox does not.
  assert.equal(caseBlock("mixed_payment", {}, "sandbox"), null);
  assert.match(String(caseBlock("mixed_payment", {}, "production")), /written confirmation/);
  assert.match(String(caseBlock("mixed_payment", { mixed_payment: { confirmedAt: "2026-12-01", reference: "PRA/eIMS/77" } }, "production")), /sample payload/);
  assert.equal(caseBlock("mixed_payment", { mixed_payment: { confirmedAt: "2026-12-01", reference: "PRA/eIMS/77", sampleAccepted: true } }, "production"), null);
});

test("PRA tables are server-only: no browser SQL reaches them", () => {
  assert.equal(authorize(analyzeSql(`SELECT * FROM pra_submissions`), OWNER, new Set(["pra_submissions"])).ok, false);
});

// ── Access and setup ─────────────────────────────────────────────────────

test("disabled by default; only the Super Admin sets it up; owners see their own, never tokens", async () => {
  order("o1", { no: 1 });
  assert.deepEqual(await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps), { status: "not_required", reason: "PRA is not enabled for this business." });
  assert.equal(posted.length, 0);
  await assert.rejects(pra.setAccess(sql, OWNER, { tenantId: "t1", access: "enabled" }, deps), /Super Admin/);
  await assert.rejects(pra.savePos(sql, OWNER, { tenantId: "t1", branchId: "b1", counter: "C1", sector: "restaurant" }, deps), /Super Admin/);
  await assert.rejects(pra.saveCase(sql, OWNER, { key: "mixed_payment", ratePolicy: "whole_other" }, deps), /Super Admin/);
  await ready();
  const own = await pra.setup(sql, OWNER, {});
  assert.equal(own.tenant.id, "t1");
  assert.equal(own.counters[0].sandboxTokenHint, null, "owners see no credential hint");
  assert.ok(!JSON.stringify(own).includes("sandbox-token"), "never the token");
  assert.equal((await pra.setup(sql, OWNER2, { tenantId: "t1" })).tenant.id, "t2", "an owner only ever gets their own business");
  assert.equal(one(`SELECT value FROM settings WHERE key = 't1::pra_server_managed'`).value, "true");
  assert.equal(one(`SELECT value FROM settings WHERE key = 't1::pra_enabled'`).value, "false");
  const actions = all(`SELECT action FROM pra_audit WHERE tenant_id = 't1'`).map((r) => r.action);
  for (const a of ["account.save", "access.enabled", "pos.create", "credential.rotate", "pos.approve", "rule.assign"]) assert.ok(actions.includes(a), a);
});

test("a counter needs its POS ID and token to be approved; one approved counter per branch; a changed POS ID needs approval again", async () => {
  await pra.saveAccount(sql, SUPER, { tenantId: "t1", pntn: "1234567-8", registrationStatus: "registered" }, deps);
  await pra.savePos(sql, SUPER, { tenantId: "t1", branchId: "b1", counter: "C1", sector: "restaurant", sandboxPosId: "123456" }, deps);
  const p = one(`SELECT id FROM pra_pos WHERE counter = 'C1'`);
  await assert.rejects(pra.decidePos(sql, SUPER, { tenantId: "t1", id: p.id, approve: true }, deps), /token first/);
  await pra.savePos(sql, SUPER, { tenantId: "t1", id: p.id, sandboxToken: "sandbox-token-xyz-0001" }, deps);
  await pra.decidePos(sql, SUPER, { tenantId: "t1", id: p.id, approve: true }, deps);
  await pra.savePos(sql, SUPER, { tenantId: "t1", branchId: "b1", counter: "C2", sector: "restaurant", sandboxPosId: "777", sandboxToken: "sandbox-token-xyz-0002" }, deps);
  const p2 = one(`SELECT id FROM pra_pos WHERE counter = 'C2'`);
  await assert.rejects(pra.decidePos(sql, SUPER, { tenantId: "t1", id: p2.id, approve: true }, deps), /already approved for this branch/);
  await pra.savePos(sql, SUPER, { tenantId: "t1", id: p.id, sandboxPosId: "999999" }, deps);
  assert.equal(one(`SELECT status FROM pra_pos WHERE id = ?`, p.id).status, "pending");
  assert.ok(String(one(`SELECT sandbox_token_enc FROM pra_pos WHERE id = ?`, p.id).sandbox_token_enc).startsWith("v1."), "stored encrypted");
});

test("going live: whitelisting per PNTN + POS ID (PRA's approval for the shared gateway IP); production stays off without the server switch", async () => {
  await ready();
  await pra.saveAccount(sql, SUPER, { tenantId: "t1", pntn: "1234567-8", registrationStatus: "registered", sandboxStatus: "passed" }, deps);
  const p = one(`SELECT id FROM pra_pos WHERE tenant_id = 't1'`);
  await pra.savePos(sql, SUPER, { tenantId: "t1", id: p.id, environment: "production", productionPosId: "555", productionToken: "production-token-value-0001" }, deps);
  await pra.decidePos(sql, SUPER, { tenantId: "t1", id: p.id, approve: true }, { ...deps, now: () => new Date("2026-11-01T00:00:00Z") });
  await assert.rejects(pra.approveLive(sql, SUPER, { tenantId: "t1", approve: true }, deps), /whitelisted the IP for PNTN 1234567-8 \/ POS ID 555/);
  await assert.rejects(pra.savePos(sql, SUPER, { tenantId: "t1", id: p.id, whitelistStatus: "approved" }, deps), /production POS ID, the IP and PRA's reference/);
  await pra.savePos(sql, SUPER, { tenantId: "t1", id: p.id, whitelistStatus: "approved", whitelistIp: "95.111.192.41", whitelistReference: "PRA email 2026-11-20" }, deps);
  assert.equal(one(`SELECT status FROM pra_pos WHERE id = ?`, p.id).status, "approved", "whitelisting does not need the counter approved again");
  await pra.approveLive(sql, SUPER, { tenantId: "t1", approve: true }, deps);
  assert.equal((await pra.setup(sql, SUPER, { tenantId: "t1" })).state, "live");
  order("o1", { no: 1 });
  const r = await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps);
  assert.equal(r.status, "blocked");
  assert.match((r as { blockedReason: string }).blockedReason, /PRA_PRODUCTION_ENABLED/);
  assert.equal(posted.length, 0, "no production call during implementation");
  assert.ok(all(`SELECT action FROM pra_audit`).some((a) => a.action === "whitelist.update"));
});

// ── Fiscalisation ────────────────────────────────────────────────────────

test("a card bill at 8 %: accepted, fiscal number on the bill; asking again sends nothing; the payment component and its reference are kept", async () => {
  await ready();
  order("o1", { no: 41, method: "card", rate: 8, discount: 100 });
  answers = [ok()];
  const r = await pra.fiscalizeOrder(sql, "t1", "o1", STAFF_B, deps) as { status: string; fiscalInvoiceNo: string; paymentComponents: { method: string; reference: string }[] };
  assert.equal(r.status, "accepted");
  assert.equal(r.fiscalInvoiceNo, "90000520191112000369");
  assert.deepEqual(r.paymentComponents.map((p) => [p.method, p.reference]), [["card", "REF-card-41"]]);
  assert.equal(posted[0].url, "https://ims.pral.com.pk/ims/sandbox/api/Live/PostData");
  assert.equal(posted[0].auth, "Bearer sandbox-token-xyz-0001");
  const b = posted[0].body as { POSID: number; USIN: string; PaymentMode: number; InvoiceType: number; TotalSaleValue: number; TotalTaxCharged: number; Discount: number; TotalBillAmount: number; Items: { PCTCode: string; TaxRate: number }[] };
  assert.deepEqual([b.POSID, b.USIN, b.PaymentMode, b.InvoiceType, b.Items[0].PCTCode, b.Items[0].TaxRate], [123456, "41", 2, 1, "98012000", 8]);
  assert.deepEqual([b.TotalSaleValue, b.TotalTaxCharged, b.Discount, b.TotalBillAmount], [900, 72, 100, 972]);
  const o = one(`SELECT pra_status, pra_invoice_no FROM rest_orders WHERE id = 'o1'`);
  assert.deepEqual([o.pra_status, o.pra_invoice_no], ["accepted", "90000520191112000369"]);
  await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps);
  await pra.sweep(sql, deps);
  assert.equal(posted.length, 1);
  const s = one(`SELECT rule_snapshot, sales_tax, pra_withholding, income_tax_withholding, payment_methods FROM pra_submissions`);
  assert.equal(JSON.parse(String(s.rule_snapshot)).rule_key, "restaurant-9801.2000", "the applied rule is kept with the invoice");
  assert.deepEqual([s.sales_tax, s.pra_withholding, s.income_tax_withholding, s.payment_methods], [72, 0, 0, '["card"]']);
});

test("cash at 16 % is sent; cash billed at 8 % (or card at 16 %) is blocked, never sent", async () => {
  await ready();
  order("o1", { no: 1, method: "cash", rate: 16 });
  order("o2", { no: 2, method: "cash", rate: 8 });
  order("o3", { no: 3, method: "card", rate: 16 });
  answers = [ok("90000520191112000370")];
  assert.equal((await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps)).status, "accepted");
  assert.equal((posted[0].body as { PaymentMode: number }).PaymentMode, 1);
  for (const id of ["o2", "o3"]) {
    const r = await pra.fiscalizeOrder(sql, "t1", id, OWNER, deps) as { status: string; blockedReason: string };
    assert.equal(r.status, "blocked");
    assert.match(r.blockedReason, /requires (16|8) %/);
  }
  assert.equal(posted.length, 1);
});

test("mixed cash + card: held until a rate policy is chosen; in the Sandbox then sent as PaymentMode 5 with both components kept", async () => {
  await ready();
  order("o1", { no: 1, method: ["cash", "card"], rate: 16 });
  let r = await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps) as { status: string; blockedReason: string; cases: string[] };
  assert.equal(r.status, "blocked");
  assert.match(r.blockedReason, /which rate the bill takes is pending/);
  assert.equal(posted.length, 0);
  await pra.saveCase(sql, SUPER, { key: "mixed_payment", ratePolicy: "whole_other", note: "Sandbox test only" }, deps);
  answers = [ok("90000520191112000371")];
  r = await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps) as typeof r & { paymentComponents: { method: string; amount: number }[] };
  assert.equal(r.status, "accepted");
  assert.equal((posted[0].body as { PaymentMode: number }).PaymentMode, 5);
  assert.deepEqual(r.cases, ["mixed_payment"]);
  assert.deepEqual((r as unknown as { paymentComponents: { method: string }[] }).paymentComponents.map((p) => p.method), ["cash", "card"]);
  // Switched off for the Sandbox: held again (a new bill).
  await pra.saveCase(sql, SUPER, { key: "mixed_payment", sandbox: false }, deps);
  order("o2", { no: 2, method: ["cash", "card"], rate: 16 });
  assert.match(((await pra.fiscalizeOrder(sql, "t1", "o2", OWNER, deps)) as { blockedReason: string }).blockedReason, /switched off for the Sandbox/);
});

test("wallet / QR: qualifies for 8 %, held until a PaymentMode is set; a bank transfer is taxed at 16 % and needs its own code", async () => {
  await ready();
  order("o1", { no: 1, method: "digital", rate: 8 });
  order("o2", { no: 2, method: "bank", rate: 8 });
  order("o3", { no: 3, method: "bank", rate: 16 });
  assert.match(((await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps)) as { blockedReason: string }).blockedReason, /Mobile wallet \/ QR: the eIMS PaymentMode is pending/);
  assert.match(((await pra.fiscalizeOrder(sql, "t1", "o2", OWNER, deps)) as { blockedReason: string }).blockedReason, /requires 16 %/);
  assert.match(((await pra.fiscalizeOrder(sql, "t1", "o3", OWNER, deps)) as { blockedReason: string }).blockedReason, /Bank transfer: the eIMS PaymentMode is pending/);
  await assert.rejects(pra.saveCase(sql, SUPER, { key: "wallet_qr", praMode: 9 }, deps), /1-6/);
  await pra.saveCase(sql, SUPER, { key: "wallet_qr", praMode: 2, note: "Sandbox: test as Card until PRA answers" }, deps);
  answers = [ok("90000520191112000372")];
  assert.equal((await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps)).status, "accepted", "a blocked bill was never sent, so it is checked again");
  assert.equal(posted.length, 1);
  const s = await pra.listCases(sql, SUPER);
  const w = s.find((x) => x.key === "wallet_qr")!;
  assert.deepEqual([w.implemented, w.sandboxAllowed, w.productionReady], [true, true, false], "production waits for PRA's confirmation");
});

test("no rule in force on the bill's date (before 1 July 2026): blocked", async () => {
  await ready();
  order("o1", { no: 1, at: "2026-06-30T10:00:00.000Z" });
  run(`UPDATE pra_pos SET active_from = '2026-01-01T00:00:00Z'`);
  const r = await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps) as { status: string; blockedReason: string };
  assert.equal(r.status, "blocked");
  assert.match(r.blockedReason, /No approved PRA tax rule .* for 2026-06-30/);
});

test("PRA refuses: rejected; after a fix the owner sends it again (same record, same payload)", async () => {
  await ready();
  order("o1", { no: 1 });
  answers = [() => new Response(`{"InvoiceNumber":"Not Available","Code":"104","Response":"You are not authorized to use this service."}`, { status: 200 })];
  const r = await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps) as { id: string; status: string; responseCode: string };
  assert.deepEqual([r.status, r.responseCode], ["rejected", "104"]);
  await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps);
  assert.equal(posted.length, 1, "a rejected invoice is not resent by itself");
  await pra.reconcile(sql, OWNER, { id: r.id, found: false }, deps);
  answers = [ok()];
  assert.equal((await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps)).status, "accepted");
  assert.deepEqual(posted[0].body, posted[1].body);
});

test("no answer in time: needs reconciliation, never resent by itself; 'not on PRA' only after the wait and with how it was checked", async () => {
  await ready();
  order("o1", { no: 1 });
  answers = [() => { const e = new Error("timeout"); e.name = "TimeoutError"; throw e; }];
  const r = await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps) as { id: string; status: string };
  assert.equal(r.status, "needs_reconciliation");
  await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps);
  await pra.sweep(sql, deps);
  assert.equal(posted.length, 1);
  assert.equal(one(`SELECT pra_invoice_no FROM rest_orders WHERE id = 'o1'`).pra_invoice_no, null, "a pending receipt shows no fiscal number");
  await assert.rejects(pra.reconcile(sql, OWNER, { id: r.id, found: false, note: "IRIS by POS ID and USIN" }, later(0.5)), /Wait at least 2 hours/);
  await assert.rejects(pra.reconcile(sql, OWNER, { id: r.id, found: false }, later(3)), /how it was checked/);
  await assert.rejects(pra.reconcile(sql, STAFF_B, { id: r.id, found: true, fiscalNo: "90000520191112000369" }, deps), /owner/);
  await assert.rejects(pra.reconcile(sql, OWNER2, { tenantId: "t1", id: r.id, found: true, fiscalNo: "90000520191112000369" }, deps), /not found/);
  const done = await pra.reconcile(sql, OWNER, { id: r.id, found: true, fiscalNo: "126983DJCN820607", note: "IRIS IMS Fiscal Report, POS 123456, USIN 1" }, deps);
  assert.equal(done.status, "accepted");
  assert.equal(one(`SELECT pra_invoice_no FROM rest_orders WHERE id = 'o1'`).pra_invoice_no, "126983DJCN820607");
});

test("a 5xx or an unreadable answer is ambiguous too; a connection refused is queued and sent by the sweep", async () => {
  await ready();
  order("o1", { no: 1 });
  order("o2", { no: 2 });
  answers = [() => new Response("<html>Bad gateway</html>", { status: 502 })];
  assert.equal((await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps)).status, "needs_reconciliation");
  answers = [() => { const e = new TypeError("fetch failed") as Error & { cause: unknown }; e.cause = { code: "ECONNREFUSED" }; throw e; }];
  assert.equal((await pra.fiscalizeOrder(sql, "t1", "o2", OWNER, deps)).status, "queued");
  answers = [ok("90000520191112000400")];
  await pra.sweep(sql, deps);
  assert.equal(one(`SELECT status FROM pra_submissions WHERE source_id = 'o2'`).status, "accepted");
  assert.equal(one(`SELECT status FROM pra_submissions WHERE source_id = 'o1'`).status, "needs_reconciliation", "the ambiguous one is not resent");
});

test("a send interrupted mid-way (server stopped) becomes needs reconciliation, not a resend", async () => {
  await ready();
  order("o1", { no: 1 });
  run(`INSERT INTO pra_submissions (id, tenant_id, branch_id, pos_row_id, pos_id, environment, source_type, source_id, usin, invoice_type, status, attempts, payload, lock_until, created_at, updated_at)
       VALUES ('s1', 't1', 'b1', 'p', '123456', 'sandbox', 'rest_order', 'o1', '1', 1, 'sending', 1, '{}', '2026-11-10T09:00:00.000Z', ?, ?)`, T, T);
  await pra.sweep(sql, deps);
  assert.equal(one(`SELECT status FROM pra_submissions WHERE id = 's1'`).status, "needs_reconciliation");
  assert.equal(posted.length, 0);
});

test("two requests at once for one bill: one record, one send", async () => {
  await ready();
  order("o1", { no: 1 });
  answers = [ok(), ok("1")];
  const [a, b] = await Promise.all([pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps), pra.fiscalizeOrder(sql, "t1", "o1", STAFF_B, deps)]);
  assert.equal(all(`SELECT * FROM pra_submissions`).length, 1);
  assert.equal(posted.length, 1);
  assert.ok([a.status, b.status].includes("accepted"));
});

test("credit notes: own USIN, RefUSIN = original USIN, original fiscal number kept; a second partial credit is a case; credits never exceed the original", async () => {
  await ready();
  order("o1", { no: 10, qty: 2, gross: 1000 });
  order("r1", { no: 11, refundOf: "o1", qty: 1, gross: 500 });
  const early = await pra.fiscalizeOrder(sql, "t1", "r1", OWNER, deps) as { status: string; blockedReason: string };
  assert.equal(early.status, "blocked");
  assert.match(early.blockedReason, /original invoice/);
  answers = [ok("90000520191112000500"), ok("90000520191112000501"), ok("90000520191112000502")];
  await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps);
  await pra.sweep(sql, deps);
  const credit = posted[1].body as { InvoiceType: number; RefUSIN: string; USIN: string; Items: { InvoiceType: number; RefUSIN: string }[] };
  assert.deepEqual([credit.InvoiceType, credit.RefUSIN, credit.USIN, credit.Items[0].InvoiceType, credit.Items[0].RefUSIN], [3, "10", "11", 3, "10"]);
  const c1 = one(`SELECT ref_fiscal_invoice_no, case_keys FROM pra_submissions WHERE source_id = 'r1'`);
  assert.deepEqual([c1.ref_fiscal_invoice_no, c1.case_keys], ["90000520191112000500", "[]"]);
  // The second partial credit of the same invoice: allowed in the Sandbox, recorded as that case.
  order("r2", { no: 12, refundOf: "o1", qty: 1, gross: 500 });
  const r2 = await pra.fiscalizeOrder(sql, "t1", "r2", OWNER, deps) as { status: string; cases: string[] };
  assert.equal(r2.status, "accepted");
  assert.deepEqual(r2.cases, ["multiple_partial_credits"]);
  // A third would go beyond the original: blocked.
  order("r3", { no: 13, refundOf: "o1", qty: 1, gross: 500 });
  assert.match(((await pra.fiscalizeOrder(sql, "t1", "r3", OWNER, deps)) as { blockedReason: string }).blockedReason, /would exceed the original \(quantity 3\/2/);
  assert.equal(one(`SELECT fiscal_invoice_no FROM pra_submissions WHERE source_id = 'o1'`).fiscal_invoice_no, "90000520191112000500", "the original stays as fiscalised");
});

test("receipt details: PNTN and branch address; the QR link and outage wording only once PRA confirmed them", async () => {
  await ready();
  const scope = { active: "b1", accessible: ["b1"], mainId: "b1", writable: true };
  let s = await pra.status(sql, OWNER, scope);
  assert.deepEqual([s.receipt?.pntn, s.receipt?.branchAddress, s.receipt?.qrTemplate, s.receipt?.outageText], ["1234567-8", "12 Mall Road, Lahore", null, null]);
  await assert.rejects(pra.saveCase(sql, SUPER, { key: "qr_verifier", text: "https://e.pra.punjab.gov.pk/verify" }, deps), /\{fiscal\}/);
  await pra.saveCase(sql, SUPER, { key: "outage_receipt", text: "PRA invoice number will be issued shortly." }, deps);
  assert.equal((await pra.status(sql, OWNER, scope)).receipt?.outageText, null, "not printed until PRA confirms it");
  await pra.saveCase(sql, SUPER, { key: "outage_receipt", confirmedAt: "2026-12-01", reference: "PRA letter 12/2026" }, deps);
  s = await pra.status(sql, OWNER, scope);
  assert.equal(s.receipt?.outageText, "PRA invoice number will be issued shortly.");
  assert.equal((await pra.status(sql, OWNER2)).receipt, null, "a business without PRA gets nothing");
});

test("branches and businesses stay apart: staff of another branch, another business, revoked access", async () => {
  await ready();
  order("o1", { no: 1, branch: "b1" });
  order("x1", { no: 1, branch: "c1", tenant: "t2" });
  await assert.rejects(pra.submit(sql, STAFF_B, { orderId: "o1" }, { active: "b2", accessible: ["b2"], mainId: "b1", writable: true }, deps), /another branch/);
  await assert.rejects(pra.submit(sql, OWNER, { orderId: "x1" }, undefined, deps), /not found/);
  order("o2", { no: 2, branch: "b2" });
  assert.equal((await pra.fiscalizeOrder(sql, "t1", "o2", OWNER, deps)).status, "not_required");
  answers = [ok()];
  await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps);
  assert.equal((await pra.list(sql, STAFF_B, {}, { active: "b2", accessible: ["b2"], mainId: "b1", writable: true })).length, 0);
  const mine = await pra.list(sql, OWNER, {}, undefined);
  assert.equal(mine.length, 1);
  assert.ok(!JSON.stringify(mine).includes("Ali Buyer") && !JSON.stringify(mine).includes("03001234567"));
  assert.equal((await pra.list(sql, OWNER2, { tenantId: "t1" }, undefined)).length, 0, "another owner sees only their own business");
  await pra.setAccess(sql, SUPER, { tenantId: "t1", access: "disabled", reason: "contract ended" }, deps);
  order("o3", { no: 3 });
  assert.equal((await pra.fiscalizeOrder(sql, "t1", "o3", OWNER, deps)).status, "not_required");
  assert.equal(one(`SELECT value FROM settings WHERE key = 't1::pra_server_managed'`).value, "false");
});

test("rules need verification before approval and a contract note when scope matters; a new version is a draft", async () => {
  await pra.saveAccount(sql, SUPER, { tenantId: "t1", pntn: "1234567-8", registrationStatus: "registered" }, deps);
  await pra.setAccess(sql, SUPER, { tenantId: "t1", access: "enabled" }, deps);
  const rules = await pra.listRules(sql, SUPER, {}, deps);
  const courier = rules.find((r) => r.rule_key === "courier-general")!;
  await assert.rejects(pra.decideRule(sql, SUPER, { id: courier.id, decision: "approve", lastVerifiedAt: "2026-11-05" }, deps), /8-digit classification code/);
  const draft = rules.find((r) => r.rule_key === "restaurant-9801.2000")!;
  await assert.rejects(pra.assignRule(sql, SUPER, { tenantId: "t1", ruleKey: draft.rule_key }, deps), /Only an approved rule/);
  const contractor = rules.find((r) => r.rule_key === "contractor-general-16")!;
  await pra.decideRule(sql, SUPER, { id: contractor.id, decision: "approve", lastVerifiedAt: "2026-11-05" }, deps);
  await assert.rejects(pra.assignRule(sql, SUPER, { tenantId: "t1", ruleKey: contractor.rule_key }, deps), /scope of work/);
  const hall = rules.find((r) => r.rule_key === "marriage-hall-9801.3000")!;
  assert.match(String(hall.review_notes), /2026 eIMS rollout includes marriage and wedding halls/);
  const v2 = await pra.saveRule(sql, SUPER, { ruleKey: "restaurant-9801.2000", sector: "restaurant", service: "Restaurants", classificationCode: "9801.2000", rate: 8, altRate: 16, paymentCondition: "digital_split", effectiveFrom: "2027-07-01", source: "Finance Act 2027" }, deps);
  assert.equal(v2.version, 2);
  assert.equal(one(`SELECT status FROM pra_tax_rules WHERE rule_key = 'restaurant-9801.2000' AND version = 2`).status, "draft");
});

// ── Contractor / service invoices (the shared invoices table) ────────────────

/** t1 as a contractor: counter in the contractor sector; the 16 % contractor rule approved with eIMS = yes and assigned. */
async function contractorReady() {
  run(`UPDATE tenants SET business_type = 'contractor' WHERE id = 't1'`);
  await pra.saveAccount(sql, SUPER, { tenantId: "t1", pntn: "7308865", registeredName: "Contractor Co", registrationStatus: "registered" }, deps);
  await pra.setAccess(sql, SUPER, { tenantId: "t1", access: "enabled" }, deps);
  await pra.savePos(sql, SUPER, { tenantId: "t1", branchId: "b1", counter: "OWNER LAPTOP", sector: "contractor", environment: "sandbox", sandboxPosId: "821651", sandboxToken: "sandbox-token-xyz-0009" }, deps);
  await pra.decidePos(sql, SUPER, { tenantId: "t1", id: one(`SELECT id FROM pra_pos`).id, approve: true }, { ...deps, now: () => new Date("2026-11-01T00:00:00Z") });
  await pra.listRules(sql, SUPER, {}, deps);
  // PRA enrolled this business for eIMS: a version of the contractor rule with eIMS = yes.
  await pra.saveRule(sql, SUPER, { ruleKey: "contractor-general-16", sector: "contractor", service: "Construction and contractor services (others)", classificationCode: "9824.0000", rate: 16, paymentCondition: "any", effectiveFrom: "2026-07-01", source: "Second Schedule Part III Sr. 6", lastVerifiedAt: "2026-11-15", eimsApplicable: "yes", needsScopeReview: true }, deps);
  const v2 = one(`SELECT id FROM pra_tax_rules WHERE rule_key = 'contractor-general-16' AND version = 2`);
  await pra.decideRule(sql, SUPER, { id: v2.id, decision: "approve", lastVerifiedAt: "2026-11-15" }, deps);
  await pra.assignRule(sql, SUPER, { tenantId: "t1", ruleKey: "contractor-general-16", contractNote: "Electrical works for a private client" }, deps);
  run(`INSERT INTO products (id, tenant_id, name, barcode, created_at, updated_at) VALUES ('svc', 't1', 'Wiring work', 'WIRE-1', ?, ?)`, T, T);
}
/** A contractor invoice: lines of Rs 500 each at `rate` with a Rs 100 line discount, cash or on credit. */
function invoice(id: string, o: { no: number; rate?: number; credit?: boolean; type?: string; billDiscount?: number; isReturn?: boolean; original?: string; qty?: number; quotation?: boolean }) {
  const rate = o.rate ?? 16, qty = o.qty ?? 2, price = 500, gross = price * qty, disc = o.isReturn ? 0 : 100;
  const tax = o.isReturn ? 0 : Math.round((gross - disc) * rate) / 100;
  const total = gross - disc + tax;
  run(`INSERT INTO invoices (id, tenant_id, branch_id, invoice_no, date, inv_on, invoice_type, total, charges, discount_rs, payable, paid, balance, is_return, is_memorized, is_quotation, original_invoice_id, customer_name, created_at, updated_at)
       VALUES (?, 't1', 'b1', ?, '2026-11-10', ?, ?, ?, 0, ?, ?, 0, 0, ?, 0, ?, ?, 'WAPDA Office', ?, ?)`,
    id, o.no, o.credit ? "credit" : "cash", o.type ?? "pra", gross, o.billDiscount ?? 0, total - (o.billDiscount ?? 0), o.isReturn ? 1 : 0, o.quotation ? 1 : 0, o.original ?? null, T, T);
  run(`INSERT INTO invoice_items (id, tenant_id, branch_id, invoice_id, product_id, qty, sale_price, tax_pct, tax_rs, discount_rs, total, created_at, updated_at)
       VALUES (?, 't1', 'b1', ?, 'svc', ?, ?, ?, ?, ?, ?, ?, ?)`, `${id}-l`, id, qty, price, o.isReturn ? 0 : rate, tax, disc, total, T, T);
}
const fiscal = (id: string) => pra.fiscalizeSource(sql, "t1", "invoice", id, OWNER, deps) as Promise<{ status: string; blockedReason: string; fiscalInvoiceNo: string; cases: string[] }>;

test("contractor invoice at 16 %, cash: accepted with PCT 98240000 and PaymentMode 1; never sent twice", async () => {
  await contractorReady();
  invoice("i1", { no: 501 });
  answers = [ok("90000520191112009001")];
  const r = await fiscal("i1");
  assert.equal(r.status, "accepted");
  const b = posted[0].body as { USIN: string; PaymentMode: number; InvoiceType: number; TotalSaleValue: number; TotalTaxCharged: number; Discount: number; TotalBillAmount: number; Items: { PCTCode: string; TaxRate: number; ItemCode: string; ItemName: string }[] };
  assert.deepEqual([b.USIN, b.PaymentMode, b.InvoiceType, b.Items[0].PCTCode, b.Items[0].TaxRate, b.Items[0].ItemCode, b.Items[0].ItemName], ["501", 1, 1, "98240000", 16, "WIRE-1", "Wiring work"]);
  assert.deepEqual([b.TotalSaleValue, b.TotalTaxCharged, b.Discount, b.TotalBillAmount], [900, 144, 100, 1044]);
  assert.equal((await pra.forSource(sql, OWNER, { sourceType: "invoice", sourceId: "i1" }))?.fiscalInvoiceNo, "90000520191112009001");
  await fiscal("i1");
  await pra.sweep(sql, deps);
  assert.equal(posted.length, 1, "never twice");
});

test("contractor invoices: on credit waits for its PaymentMode; Medicine (goods) and quotations are not PRA invoices; a bill discount or a wrong rate is held", async () => {
  await contractorReady();
  invoice("c1", { no: 502, credit: true });
  invoice("m1", { no: 503, type: "medicine" });
  invoice("q1", { no: 504, quotation: true });
  invoice("d1", { no: 505, billDiscount: 50 });
  invoice("w1", { no: 506, rate: 5 });
  assert.match((await fiscal("c1")).blockedReason, /On credit \(paid later\): the eIMS PaymentMode is pending/);
  assert.equal((await fiscal("m1")).status, "not_required");
  assert.equal((await fiscal("q1")).status, "not_required");
  assert.match((await fiscal("d1")).blockedReason, /bill discount/);
  assert.match((await fiscal("w1")).blockedReason, /other than the approved rule.s 16 %/);
  assert.equal(posted.length, 0);
  await pra.saveCase(sql, SUPER, { key: "credit_invoice", praMode: 1, note: "Sandbox only until PRA answers" }, deps);
  answers = [ok("90000520191112009002")];
  assert.equal((await fiscal("c1")).status, "accepted");
});

test("contractor: only a PRA Invoice goes to PRA; General and Medicine stay with FBR, even in the sweep", async () => {
  await contractorReady();
  invoice("g1", { no: 701, type: "general" });
  invoice("m1", { no: 702, type: "medicine" });
  invoice("p1", { no: 703 });
  assert.equal((await fiscal("g1")).status, "not_required");
  answers = [ok("90000520191112009201")];
  await pra.sweep(sql, deps);
  assert.deepEqual(posted.map((p) => p.body.USIN), ["703"]);
  assert.equal(all(`SELECT id FROM pra_submissions`).length, 1);
});

test("a service is reported under its own PCT code; a PCT code or rate without an approved rule is held", async () => {
  await contractorReady();
  run(`UPDATE products SET pct_code = '9824.0000', product_classification = 'pra_service' WHERE id = 'svc'`);
  invoice("s1", { no: 711 });
  answers = [ok("90000520191112009211")];
  assert.equal((await fiscal("s1")).status, "accepted");
  assert.equal((posted[0].body as { Items: { PCTCode: string }[] }).Items[0].PCTCode, "98240000");
  invoice("s2", { no: 712, rate: 5 });
  assert.match((await fiscal("s2")).blockedReason, /other than the approved rule.s 16 %/);
  run(`UPDATE products SET pct_code = '9814.2000' WHERE id = 'svc'`);
  invoice("s3", { no: 713 });
  assert.match((await fiscal("s3")).blockedReason, /PCT code 9814\.2000 has no approved PRA tax rule/);
  assert.equal(posted.length, 1);
});

test("the owner's switch: off holds PRA invoices (nothing sent, nothing lost); on sends them once; staff can't change it", async () => {
  await contractorReady();
  await assert.rejects(pra.setSending(sql, STAFF_B, { enabled: false }, deps), /owner/);
  await pra.setSending(sql, OWNER, { enabled: false }, deps);
  invoice("h1", { no: 721 });
  assert.match((await fiscal("h1")).blockedReason, /switched off/);
  await pra.sweep(sql, deps);
  assert.equal(posted.length, 0);
  await pra.setSending(sql, OWNER, { enabled: true }, deps);
  answers = [ok("90000520191112009221")];
  await pra.sweep(sql, deps);
  await pra.sweep(sql, deps);
  assert.equal(posted.length, 1);
  assert.equal(one(`SELECT status FROM pra_submissions WHERE source_id = 'h1'`).status, "accepted");
});

test("a send that never left stays queued while sending is off", async () => {
  await contractorReady();
  invoice("q1", { no: 731 });
  answers = [() => { const e = new TypeError("fetch failed") as Error & { cause: unknown }; e.cause = { code: "ECONNREFUSED" }; throw e; }];
  assert.equal((await fiscal("q1")).status, "queued");
  await pra.setSending(sql, OWNER, { enabled: false }, deps);
  assert.equal((await fiscal("q1")).status, "queued");
  assert.equal(posted.length, 1, "not sent again while off");
});

/** A contractor business with a branch, ready for Quick setup as a laundry. */
const LAUNDRY = { tenantId: "t1", templateId: "laundry", pntn: "1234567-8", registeredName: "Clean Laundry", counter: "FRONT DESK", sandboxPosId: "821651", sandboxToken: "sandbox-token-xyz-0001" };

test("quick setup: choosing laundry sets the 8 % rule (PCT 9811.0000), sector, counter on the Sandbox and starter services; running it again adds nothing", async () => {
  run(`UPDATE tenants SET business_type = 'contractor' WHERE id = 't1'`);
  await assert.rejects(pra.quickSetup(sql, OWNER, LAUNDRY, deps), /Super Admin/);
  await assert.rejects(pra.quickSetup(sql, SUPER, { ...LAUNDRY, sandboxToken: "12345678" }, deps), /access code/);
  const r = await pra.quickSetup(sql, SUPER, LAUNDRY, deps);
  assert.equal(r.services, 5);
  const rule = one(`SELECT rate, classification_code, status, eims_applicable, sector FROM pra_tax_rules WHERE rule_key = 'laundry-9811.0000'`);
  assert.deepEqual([rule.rate, rule.classification_code, rule.status, rule.eims_applicable, rule.sector], [8, "9811.0000", "approved", "yes", "laundry"]);
  const pos = one(`SELECT sector, environment, status FROM pra_pos WHERE tenant_id = 't1'`);
  assert.deepEqual([pos.sector, pos.environment, pos.status], ["laundry", "sandbox", "approved"]);
  assert.equal(one(`SELECT status FROM pra_accounts WHERE tenant_id = 't1'`).status, "enabled");
  assert.equal(one(`SELECT COUNT(*) AS n FROM pra_rule_assignments WHERE tenant_id = 't1' AND status = 'active'`).n, 1);
  const s = one(`SELECT pct_code, gst_rate_pct, product_classification FROM products WHERE tenant_id = 't1' AND name = 'Dry Cleaning'`);
  assert.deepEqual([s.pct_code, s.gst_rate_pct, s.product_classification], ["9811.0000", 8, "pra_service"]);
  assert.equal((await pra.quickSetup(sql, SUPER, { ...LAUNDRY, sandboxToken: "" }, deps)).services, 0);
  assert.equal(one(`SELECT COUNT(*) AS n FROM pra_tax_rules WHERE rule_key = 'laundry-9811.0000'`).n, 1, "the approved rule is reused");
});

test("quick setup needs a Contractor business, and a contract note where the rate depends on the contract", async () => {
  await assert.rejects(pra.quickSetup(sql, SUPER, LAUNDRY, deps), /Contractor/);
  run(`UPDATE tenants SET business_type = 'contractor' WHERE id = 't1'`);
  await assert.rejects(pra.quickSetup(sql, SUPER, { ...LAUNDRY, templateId: "contractor_govt" }, deps), /contract/);
});

test("a laundry's PRA Invoice goes out under its own code at 8 %; its General invoice does not go to PRA", async () => {
  run(`UPDATE tenants SET business_type = 'contractor' WHERE id = 't1'`);
  await pra.quickSetup(sql, SUPER, LAUNDRY, deps);
  run(`INSERT INTO products (id, tenant_id, name, barcode, pct_code, product_classification, created_at, updated_at) VALUES ('svc', 't1', 'Dry Cleaning 2', 'DC-2', '9811.0000', 'pra_service', ?, ?)`, T, T);
  const later2 = { ...deps, now: () => new Date(Date.parse(T)) };
  run(`UPDATE pra_pos SET active_from = '2026-11-01T00:00:00.000Z' WHERE tenant_id = 't1'`);
  invoice("l1", { no: 801, rate: 8 });
  invoice("l2", { no: 802, rate: 8, type: "general" });
  answers = [ok("90000520191112009301")];
  assert.equal((await pra.fiscalizeSource(sql, "t1", "invoice", "l1", OWNER, later2) as { status: string }).status, "accepted");
  const item = (posted[0].body as { Items: { PCTCode: string; TaxRate: number }[] }).Items[0];
  assert.deepEqual([item.PCTCode, item.TaxRate], ["98110000", 8]);
  assert.equal((await pra.fiscalizeSource(sql, "t1", "invoice", "l2", OWNER, later2) as { status: string }).status, "not_required");
});

test("sandbox test, then going live: needs a passed test, the server switch and PRA's whitelist reference; older bills are never sent", async () => {
  run(`UPDATE tenants SET business_type = 'contractor' WHERE id = 't1'`);
  await pra.quickSetup(sql, SUPER, LAUNDRY, deps);
  const live = { ...deps, env: { PRA_PRODUCTION_ENABLED: "1", PRA_DIRECT_PRODUCTION: "1" } };
  const go = { tenantId: "t1", productionPosId: "198627", productionToken: "production-token-xyz-0002", whitelistReference: "PRA email 18 Nov" };
  await assert.rejects(pra.goLive(sql, SUPER, go, live), /Sandbox test/);
  answers = [() => new Response(`{"InvoiceNumber":"Not Available","Code":"104","Response":"You are not authorized to use this service."}`, { status: 200 })];
  assert.equal((await pra.sandboxTest(sql, SUPER, { tenantId: "t1" }, deps)).passed, false);
  answers = [ok("90000520191112009401")];
  assert.equal((await pra.sandboxTest(sql, SUPER, { tenantId: "t1" }, deps)).passed, true);
  assert.match(posted[1].url, /sandbox/);
  assert.equal((posted[1].body as { Items: { PCTCode: string }[] }).Items[0].PCTCode, "98110000");
  assert.equal(all(`SELECT id FROM pra_submissions`).length, 0, "the test is not on the vendor's books");
  await assert.rejects(pra.goLive(sql, SUPER, go, deps), /PRA_PRODUCTION_ENABLED/);
  await assert.rejects(pra.goLive(sql, SUPER, { ...go, whitelistReference: "" }, live), /whitelist/);
  const after = await pra.goLive(sql, SUPER, go, live);
  assert.equal(after.state, "live");
  const pos = one(`SELECT environment, status, whitelist_status, whitelist_ip FROM pra_pos WHERE tenant_id = 't1'`);
  assert.deepEqual([pos.environment, pos.status, pos.whitelist_status, pos.whitelist_ip], ["production", "approved", "approved", "95.111.192.41"]);
  await assert.rejects(pra.quickSetup(sql, SUPER, LAUNDRY, deps), /already live/);
});

test("the year's tax: PRA invoices are PST, the rest GST; a return takes back its share of the original's tax", () => {
  const sales = [{ invoice_type: "general", tax: 1800 }, { invoice_type: "medicine", tax: 200 }, { invoice_type: "pra", tax: 1600 }];
  const returns = [{ invoice_type: "pra", qty: 1, orig_tax: 304, orig_qty: 4 }, { invoice_type: "general", qty: 2, orig_tax: 180, orig_qty: 10 }, { invoice_type: "general", qty: 1, orig_tax: null, orig_qty: null }];
  assert.deepEqual(splitYearTax(sales, returns), { gst: 1964, pst: 1524 });
  assert.equal(formatPctCode("98240000"), "9824.0000");
  assert.equal(formatPctCode("9824.0000"), "9824.0000");
  assert.equal(formatPctCode("9824"), null);
});

test("contractor return: a credit note (type 3, RefUSIN = original) reversing the original's tax in proportion to the quantity returned", async () => {
  await contractorReady();
  invoice("i1", { no: 601, qty: 4 });
  invoice("r1", { no: 602, isReturn: true, original: "i1", qty: 1 });
  assert.match((await fiscal("r1")).blockedReason, /original invoice/);
  answers = [ok("90000520191112009101"), ok("90000520191112009102")];
  await fiscal("i1");
  assert.equal((await fiscal("r1")).status, "accepted");
  const c = posted[1].body as { InvoiceType: number; RefUSIN: string; USIN: string; TotalSaleValue: number; TotalTaxCharged: number; Discount: number; Items: { TaxRate: number }[] };
  // Original: 4 x 500 = 2000, discount 100, tax 16 % of 1900 = 304. One of four returned: a quarter of each.
  assert.deepEqual([c.InvoiceType, c.RefUSIN, c.USIN, c.Items[0].TaxRate, c.TotalSaleValue, c.TotalTaxCharged, c.Discount], [3, "601", "602", 16, 475, 76, 25]);
  assert.equal(one(`SELECT ref_fiscal_invoice_no FROM pra_submissions WHERE source_id = 'r1'`).ref_fiscal_invoice_no, "90000520191112009101");
  invoice("r2", { no: 603, isReturn: true, original: "i1", qty: 4 });
  assert.match((await fiscal("r2")).blockedReason, /would exceed the original \(quantity 5\/4/);
});

test("going live with a counter still on sandbox: told to switch it; the counter's PRA whitelist approval is enough (no separate shared-IP step)", async () => {
  await contractorReady();
  await pra.saveAccount(sql, SUPER, { tenantId: "t1", pntn: "7308865", registrationStatus: "registered", sandboxStatus: "passed" }, deps);
  const p = one(`SELECT id FROM pra_pos`);
  await pra.savePos(sql, SUPER, { tenantId: "t1", id: p.id, productionPosId: "198627", productionToken: "production-token-value-0001", whitelistStatus: "approved", whitelistIp: "95.111.192.41", whitelistReference: "PRA email 2026-11-17" }, deps);
  await assert.rejects(pra.approveLive(sql, SUPER, { tenantId: "t1", approve: true }, deps), /switch counter "OWNER LAPTOP" to the production environment/);
  await pra.savePos(sql, SUPER, { tenantId: "t1", id: p.id, environment: "production" }, deps);
  await pra.decidePos(sql, SUPER, { tenantId: "t1", id: p.id, approve: true }, deps);
  await pra.approveLive(sql, SUPER, { tenantId: "t1", approve: true }, deps);
  assert.equal((await pra.setup(sql, SUPER, { tenantId: "t1" })).state, "live");
});
