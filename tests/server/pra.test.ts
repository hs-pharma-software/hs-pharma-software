/** PRA eIMS through MAVIN's server: access, counters, rules, fiscalisation
 * state machine, duplicates, reconciliation, isolation. PRA is a mock (no
 * sandbox or production call is made). */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import type { Sql } from "@/server/subSupers";
import type { Caller } from "@/server/sqlPolicy";
import * as pra from "@/server/pra/service";
import { fiscalNumberFrom, mapPraResponse } from "@/lib/restaurant/praModel";
import { checkPayment, ruleOn, pctCodeOf } from "@/lib/pra/rules";
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

function order(id: string, o: { no: number; branch?: string; method?: string | string[]; rate?: number; refundOf?: string; at?: string; discount?: number; tenant?: string }) {
  const methods = Array.isArray(o.method) ? o.method : [o.method ?? "card"];
  const rate = o.rate ?? 8;
  const gross = 1000, disc = o.discount ?? 0, tax = Math.round((gross - disc) * rate) / 100, total = gross - disc + tax;
  const pays = methods.map((m, i) => ({ method: m, amount: i === 0 ? total : 0 }));
  run(`INSERT INTO rest_orders (id, tenant_id, branch_id, order_no, order_type, status, gross, discount, tax, tax_rate, total, paid, payment_status, payments, invoice_no, invoiced_at, refund_of, customer_name, customer_phone, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'dine_in', ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?, 'Ali Buyer', '03001234567', ?, ?)`,
    id, o.tenant ?? "t1", o.branch ?? "b1", o.no, "paid", gross, disc, tax, rate, total, total, JSON.stringify(pays), o.no, o.at ?? T, o.refundOf ?? null, o.at ?? T, o.at ?? T);
  run(`INSERT INTO rest_order_items (id, tenant_id, branch_id, order_id, code, name, qty, unit_price, line_total, line_discount, line_tax, kitchen_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'K1', 'Karahi', 2, 500, ?, ?, ?, 'served', ?, ?)`, `${id}-i`, o.tenant ?? "t1", o.branch ?? "b1", id, gross, disc, tax, T, T);
}

/** t1 set up for the sandbox: access, registration, a counter on branch b1, the restaurant rule approved and assigned. */
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
  for (const t of ["t1", "t2"]) {
    run(`INSERT INTO tenants (id, name, business_type, created_at, updated_at) VALUES (?, ?, 'restaurant', ?, ?)`, t, `Rest ${t}`, T, T);
  }
  run(`INSERT INTO branches (id, tenant_id, code, name, is_main, created_at, updated_at) VALUES ('b1', 't1', 'B1', 'Main', 1, ?, ?)`, T, T);
  run(`INSERT INTO branches (id, tenant_id, code, name, is_main, created_at, updated_at) VALUES ('b2', 't1', 'B2', 'Gulberg', 0, ?, ?)`, T, T);
  run(`INSERT INTO branches (id, tenant_id, code, name, is_main, created_at, updated_at) VALUES ('c1', 't2', 'C1', 'Other', 1, ?, ?)`, T, T);
});

// ── Pure pieces ──────────────────────────────────────────────────────────

test("the fiscal number keeps every digit, whether PRA sends a number, a string or JSON inside a string", () => {
  assert.equal(fiscalNumberFrom(`{"InvoiceNumber":90000520191112000369,"Response":"ok","Code":"100"}`), "90000520191112000369");
  assert.equal(fiscalNumberFrom(`{"InvoiceNumber":"9000052011142444901","Code":"100"}`), "9000052011142444901");
  assert.equal(fiscalNumberFrom(JSON.stringify(`{"InvoiceNumber":90000520191112000369,"Code":"100"}`)), "90000520191112000369");
  assert.equal(fiscalNumberFrom(`{"InvoiceNumber":"Not Available","Code":"104"}`), null);
  assert.equal(mapPraResponse({ httpStatus: 200, body: `{"InvoiceNumber":90000520191112000369,"Code":"100"}` }).praInvoiceNo, "90000520191112000369");
  assert.equal(mapPraResponse({ httpStatus: 200, body: `{"InvoiceNumber":"Not Available","Code":"100"}` }).status, "manual_review", "success without a number is not acceptance");
  assert.equal(mapPraResponse({ httpStatus: 200, body: `{"InvoiceNumber":"Not Available","Code":"104","Response":"You are not authorized"}` }).status, "rejected");
});

test("rules: versions by effective date; payments: cash, card, unconfirmed wallet, mixed", () => {
  const base = { rule_key: "r", status: "approved" as const, effective_to: null };
  const rules = [{ ...base, version: 1, effective_from: "2025-07-01", effective_to: "2026-06-30" }, { ...base, version: 2, effective_from: "2026-07-01" }];
  assert.equal(ruleOn(rules, "r", "2026-06-30")?.version, 1);
  assert.equal(ruleOn(rules, "r", "2026-07-01")?.version, 2);
  assert.equal(ruleOn(rules, "r", "2025-01-01"), null);
  assert.equal(pctCodeOf("9801.2000"), "98012000");
  assert.equal(pctCodeOf("98.04"), null);
  assert.deepEqual([checkPayment(["cash"]).taxClass, checkPayment(["cash"]).praMode, checkPayment(["cash"]).problems.length], ["other", 1, 0]);
  assert.deepEqual([checkPayment(["card"]).taxClass, checkPayment(["card"]).praMode], ["qualifying_digital", 2]);
  assert.ok(checkPayment(["digital"]).problems.length, "wallet / QR has no confirmed PaymentMode");
  assert.match(checkPayment(["cash", "card"]).problems[0], /Mixed payment/);
});

test("PRA tables are server-only: no browser SQL reaches them", () => {
  const known = new Set(["pra_submissions", "rest_orders"]);
  const d = authorize(analyzeSql(`SELECT * FROM pra_submissions`), OWNER, known);
  assert.equal(d.ok, false);
});

// ── Access and setup ─────────────────────────────────────────────────────

test("disabled by default; only the Super Admin sets it up; owners see their own, never tokens", async () => {
  order("o1", { no: 1 });
  assert.deepEqual(await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps), { status: "not_required", reason: "PRA is not enabled for this business." });
  assert.equal(posted.length, 0);
  await assert.rejects(pra.setAccess(sql, OWNER, { tenantId: "t1", access: "enabled" }, deps), /Super Admin/);
  await assert.rejects(pra.savePos(sql, OWNER, { tenantId: "t1", branchId: "b1", counter: "C1", sector: "restaurant" }, deps), /Super Admin/);
  await ready();
  const own = await pra.setup(sql, OWNER, {});
  assert.equal(own.tenant.id, "t1");
  assert.equal(own.counters[0].sandboxTokenHint, null, "owners see no credential hint");
  assert.ok(!JSON.stringify(own).includes("sandbox-token"), "never the token");
  assert.equal((await pra.setup(sql, OWNER2, { tenantId: "t1" })).tenant.id, "t2", "an owner only ever gets their own business");
  // The desktop sender stands down.
  assert.equal(one(`SELECT value FROM settings WHERE key = 't1::pra_server_managed'`).value, "true");
  assert.equal(one(`SELECT value FROM settings WHERE key = 't1::pra_enabled'`).value, "false");
  // Audit of approvals, configuration and credential rotation.
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

test("going live needs every step; production stays off without the server switch", async () => {
  await ready();
  await assert.rejects(pra.approveLive(sql, SUPER, { tenantId: "t1", approve: true }, deps), /sandbox test has not passed.*whitelisted.*production POS ID/);
  await pra.saveAccount(sql, SUPER, { tenantId: "t1", pntn: "1234567-8", registrationStatus: "registered", sandboxStatus: "passed", whitelistStatus: "approved", whitelistIp: "95.111.192.41" }, deps);
  const p = one(`SELECT id FROM pra_pos WHERE tenant_id = 't1'`);
  await pra.savePos(sql, SUPER, { tenantId: "t1", id: p.id, environment: "production", productionPosId: "555", productionToken: "prod-token-abc-0001" }, deps);
  await pra.decidePos(sql, SUPER, { tenantId: "t1", id: p.id, approve: true }, { ...deps, now: () => new Date("2026-11-01T00:00:00Z") });
  await pra.approveLive(sql, SUPER, { tenantId: "t1", approve: true }, deps);
  assert.equal((await pra.setup(sql, SUPER, { tenantId: "t1" })).state, "live");
  order("o1", { no: 1 });
  const r = await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps);
  assert.equal(r.status, "blocked");
  assert.match((r as { blockedReason: string }).blockedReason, /PRA_PRODUCTION_ENABLED/);
  assert.equal(posted.length, 0, "no production call during implementation");
});

// ── Fiscalisation ────────────────────────────────────────────────────────

test("a card bill at 8 %: accepted, fiscal number on the bill; asking again sends nothing", async () => {
  await ready();
  order("o1", { no: 41, method: "card", rate: 8, discount: 100 });
  answers = [ok()];
  const r = await pra.fiscalizeOrder(sql, "t1", "o1", STAFF_B, deps) as { status: string; fiscalInvoiceNo: string };
  assert.equal(r.status, "accepted");
  assert.equal(r.fiscalInvoiceNo, "90000520191112000369");
  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, "https://ims.pral.com.pk/ims/sandbox/api/Live/PostData");
  assert.equal(posted[0].auth, "Bearer sandbox-token-xyz-0001");
  const b = posted[0].body as { POSID: number; USIN: string; PaymentMode: number; InvoiceType: number; TotalSaleValue: number; TotalTaxCharged: number; Discount: number; TotalBillAmount: number; Items: { PCTCode: string; TaxRate: number }[] };
  assert.deepEqual([b.POSID, b.USIN, b.PaymentMode, b.InvoiceType, b.Items[0].PCTCode, b.Items[0].TaxRate], [123456, "41", 2, 1, "98012000", 8]);
  assert.deepEqual([b.TotalSaleValue, b.TotalTaxCharged, b.Discount, b.TotalBillAmount], [900, 72, 100, 972]);
  const o = one(`SELECT pra_status, pra_invoice_no FROM rest_orders WHERE id = 'o1'`);
  assert.deepEqual([o.pra_status, o.pra_invoice_no], ["accepted", "90000520191112000369"]);
  // Clicks, another counter, the sweep: nothing is sent again.
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
  assert.equal(one(`SELECT pra_status FROM rest_orders WHERE id = 'o2'`).pra_status, "blocked");
});

test("mixed payments and an unconfirmed wallet / QR payment are held for review; confirming the mapping lets the wallet bill through", async () => {
  await ready();
  order("o1", { no: 1, method: ["cash", "card"], rate: 16 });
  order("o2", { no: 2, method: "digital", rate: 8 });
  assert.match(((await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps)) as { blockedReason: string }).blockedReason, /Mixed payment/);
  assert.match(((await pra.fiscalizeOrder(sql, "t1", "o2", OWNER, deps)) as { blockedReason: string }).blockedReason, /PaymentMode/);
  assert.equal(posted.length, 0);
  await assert.rejects(pra.saveMethodMap(sql, OWNER, { map: {} }, deps), /Super Admin/);
  await pra.saveMethodMap(sql, SUPER, { map: { digital: { taxClass: "qualifying_digital", praMode: 2, confirmed: true, note: "PRA email 2026-11-10: report wallets as Card" } } }, deps);
  answers = [ok("90000520191112000371")];
  assert.equal((await pra.fiscalizeOrder(sql, "t1", "o2", OWNER, deps)).status, "accepted", "a blocked bill was never sent, so it is checked again");
  assert.equal(posted.length, 1);
  assert.equal(((await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps)) as { status: string }).status, "blocked", "mixed stays held");
});

test("no rule in force on the bill's date (before 1 July 2026): blocked", async () => {
  await ready();
  order("o1", { no: 1, at: "2026-06-30T10:00:00.000Z" });
  // The counter went live before this bill: move its start back so the date check is what decides.
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

test("no answer in time: needs reconciliation, never resent by itself; the owner records the number from PRA's report", async () => {
  await ready();
  order("o1", { no: 1 });
  answers = [() => { const e = new Error("timeout"); e.name = "TimeoutError"; throw e; }];
  const r = await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps) as { id: string; status: string };
  assert.equal(r.status, "needs_reconciliation");
  await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps);
  await pra.sweep(sql, deps);
  assert.equal(posted.length, 1);
  assert.equal(one(`SELECT pra_status, pra_invoice_no FROM rest_orders WHERE id = 'o1'`).pra_invoice_no, null, "a pending receipt shows no fiscal number");
  await assert.rejects(pra.reconcile(sql, STAFF_B, { id: r.id, found: true, fiscalNo: "90000520191112000369" }, deps), /owner/);
  await assert.rejects(pra.reconcile(sql, OWNER2, { tenantId: "t1", id: r.id, found: true, fiscalNo: "90000520191112000369" }, deps), /not found/);
  const done = await pra.reconcile(sql, OWNER, { id: r.id, found: true, fiscalNo: "90000520191112000369" }, deps);
  assert.equal(done.status, "accepted");
  assert.equal(one(`SELECT pra_invoice_no FROM rest_orders WHERE id = 'o1'`).pra_invoice_no, "90000520191112000369");
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

test("a refund: credit (type 3) with RefUSIN, sent only after the original is accepted; full and partial credits", async () => {
  await ready();
  order("o1", { no: 10 });
  order("r1", { no: 11, refundOf: "o1" });
  const early = await pra.fiscalizeOrder(sql, "t1", "r1", OWNER, deps) as { status: string; blockedReason: string };
  assert.equal(early.status, "blocked");
  assert.match(early.blockedReason, /original invoice/);
  answers = [ok("90000520191112000500"), ok("90000520191112000501")];
  await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps);
  await pra.sweep(sql, deps);
  const credit = posted[1].body as { InvoiceType: number; RefUSIN: string; USIN: string; Items: { InvoiceType: number; RefUSIN: string }[] };
  assert.deepEqual([credit.InvoiceType, credit.RefUSIN, credit.USIN, credit.Items[0].InvoiceType, credit.Items[0].RefUSIN], [3, "10", "11", 3, "10"]);
  assert.equal(one(`SELECT fiscal_invoice_no FROM pra_submissions WHERE source_id = 'o1'`).fiscal_invoice_no, "90000520191112000500", "the original stays as fiscalised");
});

test("branches and businesses stay apart: staff of another branch, another business, revoked access", async () => {
  await ready();
  order("o1", { no: 1, branch: "b1" });
  order("x1", { no: 1, branch: "c1", tenant: "t2" });
  await assert.rejects(pra.submit(sql, STAFF_B, { orderId: "o1" }, { active: "b2", accessible: ["b2"], mainId: "b1", writable: true }, deps), /another branch/);
  await assert.rejects(pra.submit(sql, OWNER, { orderId: "x1" }, undefined, deps), /not found/);
  // A branch without an approved counter is not fiscalised.
  order("o2", { no: 2, branch: "b2" });
  assert.equal((await pra.fiscalizeOrder(sql, "t1", "o2", OWNER, deps)).status, "not_required");
  // Lists are branch-scoped and never carry the payload or the buyer.
  answers = [ok()];
  await pra.fiscalizeOrder(sql, "t1", "o1", OWNER, deps);
  assert.equal((await pra.list(sql, STAFF_B, {}, { active: "b2", accessible: ["b2"], mainId: "b1", writable: true })).length, 0);
  const mine = await pra.list(sql, OWNER, {}, undefined);
  assert.equal(mine.length, 1);
  assert.ok(!JSON.stringify(mine).includes("Ali Buyer") && !JSON.stringify(mine).includes("03001234567"));
  assert.equal((await pra.list(sql, OWNER2, { tenantId: "t1" }, undefined)).length, 0, "another owner sees only their own business");
  // Revoked: nothing more is sent.
  await pra.setAccess(sql, SUPER, { tenantId: "t1", access: "disabled", reason: "contract ended" }, deps);
  order("o3", { no: 3 });
  assert.equal((await pra.fiscalizeOrder(sql, "t1", "o3", OWNER, deps)).status, "not_required");
  assert.equal(one(`SELECT value FROM settings WHERE key = 't1::pra_server_managed'`).value, "false");
});

test("missing credentials or rule: blocked with the reason; rules need verification before approval and a contract note when scope matters", async () => {
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
  // A new version is a draft; the approved one is unchanged.
  const v2 = await pra.saveRule(sql, SUPER, { ruleKey: "restaurant-9801.2000", sector: "restaurant", service: "Restaurants", classificationCode: "9801.2000", rate: 8, altRate: 16, paymentCondition: "digital_split", effectiveFrom: "2027-07-01", source: "Finance Act 2027" }, deps);
  assert.equal(v2.version, 2);
  assert.equal(one(`SELECT status FROM pra_tax_rules WHERE rule_key = 'restaurant-9801.2000' AND version = 2`).status, "draft");
});
