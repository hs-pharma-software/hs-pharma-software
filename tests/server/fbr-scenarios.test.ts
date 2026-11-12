/** FBR sandbox scenario testing, end to end: the real service
 * (src/server/fbr/scenarios.ts) → the real gateway (fbr-gateway/) → a local
 * stand-in for FBR's sandbox. Made-up businesses on a SQLite copy of the
 * schema; never the real FBR. */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import type { Sql } from "@/server/subSupers";
import type { Caller } from "@/server/sqlPolicy";
import * as fbr from "@/server/fbr/service";
import * as scn from "@/server/fbr/scenarios";
import { FBR_BUSINESS_NATURES, FBR_SECTORS, checkScenarioPayload, findScenario, interpretFbrValidate } from "@/lib/fbrScenarios";
import type { FbrInvoicePayload } from "@/lib/fbr";
import { createGateway } from "../../fbr-gateway/src/server.ts";
import { loadConfig } from "../../fbr-gateway/src/config.ts";

process.env.FBR_TOKEN_KEY = randomBytes(32).toString("base64");
const SECRET = "scenario-test-secret-0123456789abcdef012345";
const T = "2026-11-12T08:00:00.000Z";

// ── Stand-in FBR sandbox ──
type Call = { method: string; url: string; auth: string | undefined; body: string };
const calls: Call[] = [];
let validateMode: "ok" | "invalid" | "hang" = "ok";
let postMode: "accept" | "hang" | "item-error" | "slow" = "accept";
let nextNo = 1;
let fbrServer: Server;
let gateway: ReturnType<typeof createGateway>;
let gatewayUrl = "";

before(async () => {
  fbrServer = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body });
      const json = (o: unknown) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
      const url = req.url!;
      if (url.startsWith("/pdi/v2/HS_UOM")) return json(url.includes("3004") ? [{ uoM_ID: 13, description: "Packs" }, { uoM_ID: 3, description: "KG" }] : [{ uoM_ID: 69, description: "Numbers, pieces, units" }]);
      if (url.includes("validateinvoicedata")) {
        if (validateMode === "hang") return;
        if (validateMode === "invalid") return json({ validationResponse: { statusCode: "01", status: "Invalid", error: "", invoiceStatuses: [{ itemSNo: "1", statusCode: "01", errorCode: "0099", error: "UOM is not valid for this HS code" }] } });
        return json({ validationResponse: { statusCode: "00", status: "Valid", error: "", invoiceStatuses: [{ itemSNo: "1", statusCode: "00", errorCode: null, error: "" }] } });
      }
      if (url.includes("postinvoicedata")) {
        const reply = () => json({ invoiceNumber: `SB${String(nextNo++).padStart(6, "0")}`, validationResponse: { statusCode: "00", invoiceStatuses: [] } });
        if (postMode === "hang") return;
        if (postMode === "item-error") return json({ validationResponse: { statusCode: "01", invoiceStatuses: [{ itemSNo: "1", statusCode: "01", errorCode: "0052", error: "Invalid HS code" }] } });
        if (postMode === "slow") return void setTimeout(reply, 300);
        return reply();
      }
      res.writeHead(404); res.end("");
    });
  });
  await new Promise<void>((r) => fbrServer.listen(0, "127.0.0.1", r));
  gateway = createGateway(loadConfig({ GATEWAY_SECRETS: SECRET, FBR_BASE_URL: `http://127.0.0.1:${(fbrServer.address() as AddressInfo).port}`, FBR_TIMEOUT_MS: "3000" }), { logLine: () => undefined });
  await new Promise<void>((r) => gateway.listen(0, "127.0.0.1", r));
  gatewayUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
});
after(async () => {
  fbrServer.closeAllConnections(); gateway.closeAllConnections();
  await new Promise((r) => fbrServer.close(r));
  await new Promise((r) => gateway.close(r));
});

// ── Data ──
let db: DatabaseSync;
let sql: Sql;
let clock: Date;
const deps = () => ({ gateway: { url: gatewayUrl, secret: SECRET }, now: () => clock });
const direct = () => ({ gateway: null, now: () => clock });
const run = (q: string, ...a: unknown[]) => db.prepare(q).run(...(a as never[]));
const one = (q: string, ...a: unknown[]) => db.prepare(q).get(...(a as never[])) as Record<string, unknown>;
const admin: Caller = { userId: "sa", role: "super_admin", tenantId: null } as Caller;
const owner = (t: string): Caller => ({ userId: `owner-${t}`, role: "owner", tenantId: t, permissions: null, actions: [], tenantDeniedActions: [] } as Caller);

function row(table: string, values: Record<string, unknown>) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string; notnull: number; dflt_value: unknown }[];
  const v: Record<string, unknown> = { created_at: T, updated_at: T, ...values };
  for (const c of cols) if (c.notnull && c.dflt_value == null && v[c.name] === undefined) v[c.name] = /INT|REAL|NUM/i.test(c.type) ? 0 : "";
  const keys = Object.keys(v).filter((k) => cols.some((c) => c.name === k));
  run(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, ...keys.map((k) => v[k]));
}
const setSetting = (t: string, k: string, v: string) => run(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`, `${t}::${k}`, v, T);
function product(t: string, id: string, f: Record<string, unknown>, price: number) {
  row("products", { id, tenant_id: t, name: id, hs_code: "3004.9099", fbr_uom: "Packs", ...f });
  row("price_list", { id: `pl-${id}`, product_id: id, tenant_id: t, sale_price: price });
}

beforeEach(async () => {
  db = fullSchemaDb();
  sql = sqliteSql(db);
  clock = new Date(T);
  calls.length = 0;
  validateMode = "ok"; postMode = "accept";
  for (const t of ["t1", "t2"]) {
    row("tenants", { id: t, name: `Shop ${t}`, business_type: "retail_pharmacy", fbr_allowed: 1 });
    setSetting(t, "fbr_enabled", "true");
    setSetting(t, "fbr_environment", "production"); // scenario testing is sandbox whatever the business uses
    setSetting(t, "fbr_seller_ntn", t === "t1" ? "1234567" : "7777777");
    setSetting(t, "fbr_seller_name", `Shop ${t} Pharmacy`);
    setSetting(t, "fbr_seller_province", "Punjab");
    setSetting(t, "fbr_seller_address", "Main Road, Lahore");
    await fbr.saveTokens(sql, owner(t), { sandbox: `sandbox-token-${t}`, production: `production-token-${t}` }, deps());
  }
  product("t1", "std", { fbr_sale_type: "Goods at standard rate (default)", fbr_sale_rate: 18 }, 100);
  product("t1", "red", { fbr_sale_type: "Goods at Reduced Rate", fbr_sale_rate: 1, sro_no: "EIGHTH SCHEDULE Table 1", sro_item_serial_no: "82" }, 200);
  product("t1", "exm", { fbr_sale_type: "Exempt goods", fbr_sale_rate: 0, sro_no: "6th Schd Table I", sro_item_serial_no: "100" }, 50);
  product("t1", "zro", { fbr_sale_type: "Goods at zero-rate", fbr_sale_rate: 0, sro_no: "327(I)/2008", sro_item_serial_no: "1" }, 80);
  product("t1", "third", { fbr_sale_type: "3rd Schedule Goods", fbr_sale_rate: 18 }, 300);
  product("t2", "t2std", { fbr_sale_type: "Goods at standard rate (default)", fbr_sale_rate: 18 }, 999);
  row("customers", { id: "buyer1", tenant_id: "t1", name: "City Medical Store", ntn: "7654321", registration_type: "Registered", province: "Sindh", address: "Saddar, Karachi" });
});

const ALL9 = ["SN001", "SN002", "SN005", "SN006", "SN007", "SN008", "SN026", "SN027", "SN028"];
async function startT1(codes = ALL9, extra: Record<string, unknown> = {}) {
  const scenarios = codes.map((code) => ({ code, ...(code === "SN001" ? { buyer: { registered: true, customerId: "buyer1" } } : {}), ...((extra[code] as object) ?? {}) }));
  return scn.startSession(sql, admin, { tenantId: "t1", natures: ["Wholesaler", "Retailer"], sectors: ["Wholesale / Retails"], scenarios }, deps());
}
const testId = (s: Awaited<ReturnType<typeof startT1>>, code: string) => String(s.tests.find((t) => t.scenario_code === code)!.id);
const posted = () => calls.filter((c) => c.url.includes("postinvoicedata"));
const validated = () => calls.filter((c) => c.url.includes("validateinvoicedata"));
const testState = (id: string) => one(`SELECT * FROM fbr_scenario_tests WHERE id = ?`, id);

// ── Catalog and local checks ──

test("Business Nature and Sector are exactly the FBR portal's options", () => {
  assert.deepEqual([...FBR_BUSINESS_NATURES], ["Manufacturer", "Importer", "Exporter", "Distributor", "Wholesaler", "Retailer", "Service Provider", "Other"]);
  assert.equal(FBR_SECTORS.length, 16);
  assert.ok(FBR_SECTORS.includes("Wholesale / Retails") && FBR_SECTORS.includes("All Other Sectors") && FBR_SECTORS.includes("Cement or Concrete Blocks"));
  for (const internal of ["Pharmacy POS", "General Store", "Clinic Management", "Hospital Management"]) assert.ok(!(FBR_SECTORS as readonly string[]).includes(internal));
  const c = scn.catalog(admin);
  assert.equal(c.scenarios.filter((s) => s.verified).map((s) => s.code).join(","), ALL9.join(","), "only scenarios MAVIN's invoice builder produces are verified");
});

test("only the Super Admin can use scenario testing", async () => {
  assert.throws(() => scn.catalog(owner("t1")), /Super Admin/);
  await assert.rejects(scn.prepare(sql, owner("t1"), { tenantId: "t1" }, deps()), /Super Admin/);
  await assert.rejects(scn.startSession(sql, owner("t1"), { tenantId: "t1", natures: ["Retailer"], sectors: ["Pharmaceuticals"], scenarios: [{ code: "SN002" }] }, deps()), /Super Admin/);
  const s = await startT1(["SN002"]);
  await assert.rejects(scn.run(sql, owner("t1"), { scenarioTestId: testId(s, "SN002") }, deps()), /Super Admin/);
});

test("a session takes only the FBR options and real scenario codes", async () => {
  const base = { tenantId: "t1", natures: ["Retailer"], sectors: ["Pharmaceuticals"], scenarios: [{ code: "SN002" }] };
  await assert.rejects(scn.startSession(sql, admin, { ...base, natures: ["Pharmacy POS"] }, deps()), /not an FBR Business Nature/);
  await assert.rejects(scn.startSession(sql, admin, { ...base, sectors: ["Hospital Management"] }, deps()), /not an FBR Sector/);
  await assert.rejects(scn.startSession(sql, admin, { ...base, natures: [] }, deps()), /at least one Business Nature/);
  await assert.rejects(scn.startSession(sql, admin, { ...base, scenarios: [{ code: "XX1" }] }, deps()), /not a scenario code/);
  await assert.rejects(scn.startSession(sql, admin, { ...base, tenantId: "nope" }, deps()), /not found/);
  const s = await scn.startSession(sql, admin, { ...base, natures: ["Wholesaler", "Retailer", "Retailer"], sectors: ["Wholesale / Retails"] }, deps());
  assert.deepEqual(s.session.business_natures, ["Wholesaler", "Retailer"]);
  assert.equal(s.session.environment, "sandbox");
});

test("preparation lists only this business's usable products and masks buyer NTNs", async () => {
  const p = await scn.prepare(sql, admin, { tenantId: "t1" }, deps());
  assert.deepEqual(p.problems, []);
  assert.equal(p.hasSandboxToken, true);
  assert.deepEqual(p.products["Goods at standard rate (default)"].map((x) => x.id), ["std"], "t2's product is not offered");
  assert.equal(p.buyers[0].ntnMasked, "••••321");
  assert.ok(!JSON.stringify(p).includes("sandbox-token"), "never a token");
});

test("local checks: FBR field list, tax arithmetic, scenario, buyer type", () => {
  const sc = findScenario("SN002")!;
  const good: FbrInvoicePayload = {
    invoiceType: "Sale Invoice", invoiceDate: "2026-11-12", sellerNTNCNIC: "1234567", sellerBusinessName: "A", sellerProvince: "PUNJAB", sellerAddress: "B",
    buyerNTNCNIC: "", buyerBusinessName: "Walk-in Customer", buyerProvince: "PUNJAB", buyerAddress: "PUNJAB", buyerRegistrationType: "Unregistered", invoiceRefNo: "", scenarioId: "SN002",
    items: [{ hsCode: "3004.9099", productDescription: "X", rate: "18%", uoM: "Packs", quantity: 1, totalValues: 118, valueSalesExcludingST: 100, fixedNotifiedValueOrRetailPrice: 0, salesTaxApplicable: 18, salesTaxWithheldAtSource: 0, extraTax: 0, furtherTax: 0, sroScheduleNo: "", fedPayable: 0, discount: 0, saleType: "Goods at standard rate (default)", sroItemSerialNo: "" }],
  };
  assert.deepEqual(checkScenarioPayload(good, sc, false), []);
  const bad = structuredClone(good);
  bad.items[0].salesTaxApplicable = 17; bad.scenarioId = "SN001"; bad.invoiceDate = "12/11/2026";
  const problems = checkScenarioPayload(bad, sc, false).join("\n");
  assert.match(problems, /salesTaxApplicable 17 is not 18% of 100/);
  assert.match(problems, /expected SN002/);
  assert.match(problems, /yyyy-MM-dd/);
  assert.match(checkScenarioPayload(good, sc, true).join("\n"), /must be "Registered"/);
});

test("FBR's validate answer is read as valid, invalid (with FBR's reasons) or unclear", () => {
  assert.equal(interpretFbrValidate(200, `{"validationResponse":{"statusCode":"00","invoiceStatuses":[{"itemSNo":"1","statusCode":"00"}]}}`).outcome, "valid");
  const inv = interpretFbrValidate(200, `{"validationResponse":{"statusCode":"01","error":"","invoiceStatuses":[{"itemSNo":"1","statusCode":"01","errorCode":"0099","error":"UOM is not valid",}]}}`);
  assert.deepEqual([inv.outcome, inv.error], ["invalid", "Item 1: UOM is not valid [0099]"]);
  assert.equal(interpretFbrValidate(401, "").outcome, "invalid");
  assert.equal(interpretFbrValidate(502, "<html>").outcome, "unclear");
  assert.equal(interpretFbrValidate(429, "").outcome, "unclear");
});

// ── Running ──

test("all nine verified scenarios: validated then posted to the sandbox, numbers saved, real data untouched", async () => {
  const before = ["invoices", "fbr_submissions", "product_batches", "price_list"].map((t) => Number(one(`SELECT COUNT(*) AS n FROM ${t}`).n));
  const s = await startT1();
  for (const code of ALL9) {
    const r = await scn.run(sql, admin, { scenarioTestId: testId(s, code) }, deps());
    assert.equal(r.status, "submitted", `${code}: ${r.message}`);
    assert.match(r.fbrInvoiceNo ?? "", /^SB\d{6}$/);
  }
  const posts = posted();
  assert.equal(posts.length, 9);
  assert.equal(validated().length, 9, "each one validated first");
  assert.ok(calls.every((c) => !c.url.includes("_sb") ? c.url.startsWith("/pdi/") : true), "only sandbox invoice addresses");
  assert.ok(calls.every((c) => c.auth === "Bearer sandbox-token-t1"), "the sandbox token only, never production");
  const sent = posts.map((c) => JSON.parse(c.body) as FbrInvoicePayload);
  assert.deepEqual(sent.map((p) => p.scenarioId), ALL9);
  const by = (code: string) => sent.find((p) => p.scenarioId === code)!;
  assert.deepEqual([by("SN001").buyerRegistrationType, by("SN001").buyerNTNCNIC, by("SN001").buyerBusinessName], ["Registered", "7654321", "City Medical Store"]);
  assert.deepEqual([by("SN002").items[0].salesTaxApplicable, by("SN002").items[0].totalValues, by("SN002").buyerRegistrationType], [18, 118, "Unregistered"]);
  assert.deepEqual([by("SN008").items[0].fixedNotifiedValueOrRetailPrice, by("SN008").items[0].salesTaxApplicable], [300, 54], "3rd Schedule: tax on the retail price");
  assert.deepEqual([by("SN005").items[0].rate, by("SN005").items[0].salesTaxApplicable, by("SN005").items[0].extraTax, by("SN005").items[0].sroItemSerialNo], ["1%", 2, "", "82"]);
  assert.equal(by("SN006").items[0].rate, "Exempt");
  assert.equal(by("SN028").items[0].saleType, "Goods at Reduced Rate");
  assert.ok(sent.every((p) => p.sellerNTNCNIC === "1234567" && p.invoiceDate === "2026-11-12"));
  const after = ["invoices", "fbr_submissions", "product_batches", "price_list"].map((t) => Number(one(`SELECT COUNT(*) AS n FROM ${t}`).n));
  assert.deepEqual(after, before, "no invoice, real FBR record, stock or price written");
  const view = await scn.session(sql, admin, { sessionId: s.session.id }, deps());
  assert.ok(view.tests.every((t) => t.status === "submitted" && t.validation_status === "fbr_passed" && t.submission_status === "passed"));
  assert.ok(!JSON.stringify(view).includes("sandbox-token"));
  assert.equal(view.tests.find((t) => t.scenario_code === "SN001")!.attempts[0].payload_json && (view.tests.find((t) => t.scenario_code === "SN001")!.attempts[0].payload_json as FbrInvoicePayload).buyerNTNCNIC, "••••321", "buyer NTN masked in the view");
  // A passed scenario is not sent again.
  const again = await scn.run(sql, admin, { scenarioTestId: testId(s, "SN002") }, deps());
  assert.equal(again.message, "Already passed.");
  assert.equal(posted().length, 9);
});

test("missing information is asked for, not invented", async () => {
  const s = await startT1(["SN001", "SN002"], { SN001: { buyer: { registered: true } } });
  const r = await scn.run(sql, admin, { scenarioTestId: testId(s, "SN001") }, deps());
  assert.equal(r.status, "needs_input");
  assert.match(r.message ?? "", /registered buyer with a valid NTN/);
  run(`UPDATE products SET deleted_at = ? WHERE id = 'std'`, T);
  const r2 = await scn.run(sql, admin, { scenarioTestId: testId(s, "SN002") }, deps());
  assert.equal(r2.status, "needs_input");
  assert.match(r2.message ?? "", /No product of this business has sale type "Goods at standard rate \(default\)"/);
  assert.equal(calls.length, 0, "nothing sent");
});

test("local validation failure: nothing reaches FBR", async () => {
  run(`UPDATE products SET sro_no = NULL WHERE id = 'red'`);
  const s = await startT1(["SN005"]);
  const r = await scn.run(sql, admin, { scenarioTestId: testId(s, "SN005") }, deps());
  assert.equal(r.status, "local_failed");
  assert.match(r.message ?? "", /SRO schedule and item serial are required/);
  assert.equal(validated().length + posted().length, 0, "no invoice reached FBR (only FBR's unit list was read)");
  assert.equal(testState(testId(s, "SN005")).validation_status, "local_failed");
});

test("FBR validation fails: not posted; the same invoice is not retried; after a fix it passes and both attempts are kept", async () => {
  const s = await startT1(["SN002"]);
  const id = testId(s, "SN002");
  validateMode = "invalid";
  const r = await scn.run(sql, admin, { scenarioTestId: id }, deps());
  assert.equal(r.status, "fbr_invalid");
  assert.match(r.message ?? "", /UOM is not valid for this HS code \[0099\]/);
  assert.equal(posted().length, 0, "an invalid invoice is never posted");
  validateMode = "ok";
  await assert.rejects(scn.run(sql, admin, { scenarioTestId: id }, deps()), /same invoice FBR refused/);
  clock = new Date(Date.parse(T) + 86_400_000); // a new day alone does not make it a new invoice
  await assert.rejects(scn.run(sql, admin, { scenarioTestId: id }, deps()), /same invoice FBR refused/);
  run(`UPDATE products SET fbr_uom = 'KG' WHERE id = 'std'`); // the fix
  const ok = await scn.run(sql, admin, { scenarioTestId: id }, deps());
  assert.equal(ok.status, "submitted");
  const attempts = db.prepare(`SELECT attempt_no, state FROM fbr_scenario_attempts WHERE scenario_test_id = ? ORDER BY attempt_no`).all(id) as { attempt_no: number; state: string }[];
  assert.deepEqual(attempts.map((a) => [a.attempt_no, a.state]), [[1, "fbr_invalid"], [2, "passed"]]);
});

test("FBR's own HS/UOM list is checked before sending", async () => {
  run(`UPDATE products SET fbr_uom = 'Liter' WHERE id = 'std'`);
  const s = await startT1(["SN002"]);
  const r = await scn.run(sql, admin, { scenarioTestId: testId(s, "SN002") }, deps());
  assert.equal(r.status, "local_failed");
  assert.match(r.message ?? "", /UOM "Liter" not allowed for HS 3004.9099 \(use Packs or KG\)/);
  assert.equal(validated().length, 0);
});

test("no answer to the post: unclear, never re-sent until a person checks the portal", async () => {
  const s = await startT1(["SN002", "SN006"]);
  postMode = "hang";
  const r = await scn.run(sql, admin, { scenarioTestId: testId(s, "SN002") }, deps());
  assert.equal(r.status, "uncertain");
  postMode = "accept";
  await assert.rejects(scn.run(sql, admin, { scenarioTestId: testId(s, "SN002") }, deps()), /no clear outcome/);
  assert.equal(posted().length, 1);
  await scn.resolve(sql, admin, { attemptId: r.attemptId, resolution: "not_received" }, deps());
  const again = await scn.run(sql, admin, { scenarioTestId: testId(s, "SN002") }, deps());
  assert.equal(again.status, "submitted");
  assert.equal(posted().length, 2);

  postMode = "hang";
  const r2 = await scn.run(sql, admin, { scenarioTestId: testId(s, "SN006") }, deps());
  await assert.rejects(scn.resolve(sql, admin, { attemptId: r2.attemptId, resolution: "accepted", fbrInvoiceNo: "x" }, deps()), /exactly/);
  await scn.resolve(sql, admin, { attemptId: r2.attemptId, resolution: "accepted", fbrInvoiceNo: "SB777777" }, deps());
  assert.deepEqual([testState(testId(s, "SN006")).status, testState(testId(s, "SN006")).fbr_invoice_no], ["submitted", "SB777777"]);
});

test("FBR rejects the post: recorded as rejected with FBR's reason", async () => {
  const s = await startT1(["SN002"]);
  postMode = "item-error";
  const r = await scn.run(sql, admin, { scenarioTestId: testId(s, "SN002") }, deps());
  assert.equal(r.status, "rejected");
  assert.match(r.message ?? "", /Invalid HS code \[0052\]/);
  assert.equal(testState(testId(s, "SN002")).submission_status, "rejected");
});

test("two clicks at once: the scenario reaches FBR once; one scenario of a business at a time", async () => {
  const s = await startT1(["SN002", "SN006"]);
  postMode = "slow";
  const results = await Promise.allSettled([
    scn.run(sql, admin, { scenarioTestId: testId(s, "SN002") }, deps()),
    scn.run(sql, admin, { scenarioTestId: testId(s, "SN002") }, deps()),
    scn.run(sql, admin, { scenarioTestId: testId(s, "SN006") }, deps()),
  ]);
  assert.equal(posted().length, 1, "one post reached FBR");
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.ok(results.filter((x) => x.status === "rejected").every((x) => /being tested|one at a time/.test(String((x as PromiseRejectedResult).reason))));
});

test("a sender that stopped mid-post: the attempt becomes unclear, not resent", async () => {
  const s = await startT1(["SN002"]);
  const id = testId(s, "SN002");
  const r = await scn.run(sql, admin, { scenarioTestId: id }, direct());
  assert.equal(r.direct?.step, "validate");
  await scn.report(sql, admin, { attemptId: r.attemptId, step: "validate", report: { kind: "response", status: 200, text: `{"validationResponse":{"statusCode":"00"}}` } }, direct());
  clock = new Date(Date.parse(T) + fbr.STALE_PENDING_MS + 1000); // the browser was closed after it began posting
  await assert.rejects(scn.run(sql, admin, { scenarioTestId: id }, direct()), /no clear outcome/);
  assert.equal(testState(id).status, "uncertain");
});

test("direct mode (no gateway): this browser validates and posts, MAVIN records each step", async () => {
  const s = await startT1(["SN002"]);
  const id = testId(s, "SN002");
  const r = await scn.run(sql, admin, { scenarioTestId: id }, direct());
  assert.deepEqual([r.direct?.step, r.direct?.token, r.direct?.payload.scenarioId], ["validate", "sandbox-token-t1", "SN002"]);
  await assert.rejects(scn.report(sql, admin, { attemptId: r.attemptId, step: "post", report: { kind: "response", status: 200, text: "{}" } }, direct()), /at the validate step/);
  const v = await scn.report(sql, admin, { attemptId: r.attemptId, step: "validate", report: { kind: "response", status: 200, text: `{"validationResponse":{"statusCode":"00"}}` } }, direct());
  assert.equal(v.direct?.step, "post");
  const p = await scn.report(sql, admin, { attemptId: r.attemptId, step: "post", report: { kind: "response", status: 200, text: `{"invoiceNumber":"SB424242","validationResponse":{"statusCode":"00"}}` } }, direct());
  assert.deepEqual([p.status, p.fbrInvoiceNo], ["submitted", "SB424242"]);
  await assert.rejects(scn.report(sql, admin, { attemptId: r.attemptId, step: "post", report: { kind: "response", status: 200, text: "{}" } }, direct()), /already finished/);
  assert.equal(calls.length, 0, "the server itself called nobody");
});

test("scenarios MAVIN cannot build are tracked only; portal confirmation and finishing", async () => {
  const s = await startT1(["SN002"]);
  const withNew = await scn.addScenario(sql, admin, { sessionId: s.session.id, code: "sn019" }, deps());
  const sn019 = withNew.tests.find((t) => t.scenario_code === "SN019")!;
  assert.equal(Number(sn019.verified), 0);
  await assert.rejects(scn.run(sql, admin, { scenarioTestId: String(sn019.id) }, deps()), /no verified invoice set-up/);
  const id = testId(s, "SN002");
  await assert.rejects(scn.confirmPortal(sql, admin, { scenarioTestId: id, confirmed: true }, deps()), /passed can be confirmed/);
  await scn.run(sql, admin, { scenarioTestId: id }, deps());
  const c = await scn.confirmPortal(sql, admin, { scenarioTestId: id, confirmed: true }, deps());
  assert.equal(c.tests.find((t) => t.scenario_code === "SN002")!.status, "portal_confirmed");
  await scn.updateScenario(sql, admin, { scenarioTestId: String(sn019.id), skip: true }, deps());
  await scn.finishSession(sql, admin, { sessionId: s.session.id }, deps());
  await assert.rejects(scn.run(sql, admin, { scenarioTestId: id }, deps()), /session is finished/);
  // The business's own FBR settings were not touched: production stays as it was.
  assert.equal(one(`SELECT value FROM settings WHERE key = 't1::fbr_environment'`).value, "production");
});

test("businesses stay apart: another business's product cannot be used", async () => {
  const s = await startT1(["SN002"]);
  await assert.rejects(scn.updateScenario(sql, admin, { scenarioTestId: testId(s, "SN002"), productId: "t2std" }, deps()), /not this business's/);
  const r = await scn.run(sql, admin, { scenarioTestId: testId(s, "SN002") }, deps());
  assert.equal(r.status, "submitted");
  const p = JSON.parse(posted()[0].body) as FbrInvoicePayload;
  assert.equal(p.items[0].productDescription, "std");
  assert.equal(p.sellerNTNCNIC, "1234567");
});
