/** FBR through MAVIN's server, end to end: the real service (src/server/fbr)
 * → the real gateway (fbr-gateway/, started here) → a local stand-in for FBR.
 * Made-up businesses on a SQLite copy of the schema; never the real FBR. */
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
import { signRequest as mavinSign } from "@/server/fbr/gatewayClient";
import { createGateway } from "../../fbr-gateway/src/server.ts";
import { loadConfig } from "../../fbr-gateway/src/config.ts";
import { signRequest as gatewaySign } from "../../fbr-gateway/src/auth.ts";

process.env.FBR_TOKEN_KEY = randomBytes(32).toString("base64");
const SECRET = "flow-test-secret-0123456789abcdef0123456789";
const T = "2026-11-12T08:00:00.000Z";

// ── Stand-in FBR ──
type Call = { url: string; auth: string | undefined; body: string };
const fbrCalls: Call[] = [];
let mode: "accept" | "slow-accept" | "hang" | "reject401" | "error500" | "item-error" = "accept";
let nextNo = 1;
let fbrServer: Server;
let gateway: ReturnType<typeof createGateway>;
let gatewayUrl = "";

before(async () => {
  fbrServer = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      fbrCalls.push({ url: req.url!, auth: req.headers.authorization, body });
      const reply = () => {
        if (mode === "reject401") { res.writeHead(401); return res.end(""); }
        if (mode === "error500") { res.writeHead(500); return res.end("<html>Internal error</html>"); }
        if (mode === "item-error") {
          res.writeHead(200);
          return res.end(`{"validationResponse":{"statusCode":"01","invoiceStatuses":[{"itemSNo":"1","statusCode":"01","errorCode":"0052","error":"Invalid HS code",}]}}`);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ invoiceNumber: `FBR${String(nextNo++).padStart(6, "0")}`, validationResponse: { statusCode: "00", invoiceStatuses: [] } }));
      };
      if (mode === "hang") return;
      if (mode === "slow-accept") setTimeout(reply, 300);
      else reply();
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
const all = (q: string, ...a: unknown[]) => db.prepare(q).all(...(a as never[])) as Record<string, unknown>[];
const owner = (t: string): Caller => ({ userId: `owner-${t}`, role: "owner", tenantId: t, permissions: null, actions: [], tenantDeniedActions: [] } as Caller);
const cashierAllowed: Caller = { userId: "cash-1", role: "staff", tenantId: "t1", permissions: ["invoices"], actions: ["+invoice.fbr_submit"], tenantDeniedActions: [] } as Caller;
const cashierNot: Caller = { userId: "cash-2", role: "staff", tenantId: "t1", permissions: ["invoices"], actions: [], tenantDeniedActions: [] } as Caller;
const admin: Caller = { userId: "sa", role: "super_admin", tenantId: null } as Caller;

function row(table: string, values: Record<string, unknown>) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string; notnull: number; dflt_value: unknown }[];
  const v: Record<string, unknown> = { created_at: T, updated_at: T, ...values };
  for (const c of cols) if (c.notnull && c.dflt_value == null && v[c.name] === undefined) v[c.name] = /INT|REAL|NUM/i.test(c.type) ? 0 : "";
  const keys = Object.keys(v).filter((k) => cols.some((c) => c.name === k));
  run(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, ...keys.map((k) => v[k]));
}
const setSetting = (t: string, k: string, v: string) => run(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`, `${t}::${k}`, v, T);
const payload = (ntn = "1234567") => ({ invoiceType: "Sale Invoice", invoiceDate: "2026-11-12", sellerNTNCNIC: ntn, items: [{ hsCode: "3004.9099", quantity: 1 }] });
const submit = (caller: Caller, docId: string, o: { env?: string; docType?: string; d?: ReturnType<typeof deps> | ReturnType<typeof direct>; scope?: { accessible: string[] } } = {}) =>
  fbr.submit(sql, caller, { docType: o.docType ?? "invoice", docId, environment: o.env ?? "sandbox", payload: payload() }, o.scope as never, o.d ?? deps());

beforeEach(() => {
  db = fullSchemaDb();
  sql = sqliteSql(db);
  clock = new Date(T);
  fbrCalls.length = 0;
  mode = "accept";
  for (const t of ["t1", "t2"]) {
    row("tenants", { id: t, name: `Shop ${t}`, business_type: "retail_pharmacy", fbr_allowed: 1 });
    setSetting(t, "fbr_enabled", "true");
    setSetting(t, "fbr_environment", "sandbox");
    setSetting(t, "fbr_seller_ntn", "1234567");
  }
  for (const [id, t, branch] of [["inv1", "t1", "main-t1"], ["inv2", "t1", "main-t1"], ["invB", "t1", "branch2-t1"], ["inv-t2", "t2", "main-t2"]] as const) {
    row("invoices", { id, tenant_id: t, branch_id: branch, invoice_no: 1, date: "2026-11-12", payable: 100 });
  }
  row("es_docs", { id: "es1", tenant_id: "t1", branch_id: "main-t1", doc_type: "sale" });
});

async function withTokens(t = "t1", sandbox = "sandbox-token-t1", production = "production-token-t1") {
  await fbr.saveTokens(sql, owner(t), { sandbox, production }, deps());
}

// ── Tests ──

test("tokens: typed ones are stored encrypted, old plain-text copies are moved and removed, and never shown back", async () => {
  setSetting("t1", "fbr_sandbox_token", "legacy-plain-sandbox-token");
  const cfg = await fbr.config(sql, owner("t1"), deps());
  assert.equal(cfg.hasSandbox, true, "the old token still works");
  const stored = one(`SELECT * FROM fbr_credentials WHERE tenant_id = 't1'`);
  assert.ok(stored.sandbox_token_enc && !String(stored.sandbox_token_enc).includes("legacy-plain"), "copied encrypted");

  await withTokens();
  assert.equal(all(`SELECT key FROM settings WHERE key LIKE 't1::fbr_%token'`).length, 0, "plain-text copies removed");
  const enc = one(`SELECT sandbox_token_enc, production_token_enc FROM fbr_credentials WHERE tenant_id = 't1'`);
  for (const v of Object.values(enc)) assert.ok(!String(v).includes("token-t1"));
  const shown = JSON.stringify(await fbr.config(sql, owner("t1"), deps()));
  assert.ok(!shown.includes("sandbox-token-t1") && shown.includes("••••"), "only a hint for the owner");
  const cashierView = await fbr.config(sql, cashierAllowed, deps());
  assert.equal(cashierView.sandboxHint, null, "no hint for a cashier");
  await assert.rejects(fbr.saveTokens(sql, cashierAllowed, { sandbox: "x-token-123456" }, deps()), /owner/);
  await assert.rejects(fbr.saveTokens(sql, owner("t1"), { sandbox: "has a space in it" }, deps()), /does not look like/);
});

test("an invoice goes to FBR once through the gateway; its number is stored; sending again does not reach FBR", async () => {
  await withTokens();
  const r = await submit(owner("t1"), "inv1");
  assert.equal(r.success, true);
  assert.equal(r.fbrInvoiceNo, "FBR000001");
  assert.equal(one(`SELECT fbr_invoice_no FROM invoices WHERE id = 'inv1'`).fbr_invoice_no, "FBR000001");
  assert.equal(fbrCalls.length, 1);
  assert.equal(fbrCalls[0].url, "/di_data/v1/di/postinvoicedata_sb");
  assert.equal(fbrCalls[0].auth, "Bearer sandbox-token-t1");

  const again = await submit(owner("t1"), "inv1");
  assert.deepEqual([again.success, again.fbrInvoiceNo], [true, "FBR000001"]);
  assert.equal(fbrCalls.length, 1, "not sent twice");
  const s = all(`SELECT status, route, payload_hash FROM fbr_submissions WHERE doc_id = 'inv1'`);
  assert.equal(s.length, 1);
  assert.equal(s[0].status, "accepted");
  assert.equal(s[0].route, "gateway");
});

test("two clicks, tabs or devices at the same moment: FBR receives the invoice once", async () => {
  await withTokens();
  mode = "slow-accept";
  const results = await Promise.all([submit(owner("t1"), "inv1"), submit(cashierAllowed, "inv1"), submit(owner("t1"), "inv1")]);
  assert.equal(fbrCalls.length, 1, "one call reached FBR");
  assert.equal(results.filter((r) => r.success).length, 1);
  assert.ok(results.filter((r) => !r.success).every((r) => /being sent/.test(r.error ?? "")));
  assert.equal(all(`SELECT * FROM fbr_submissions WHERE doc_id = 'inv1'`).length, 1);
});

test("no answer from FBR: 'uncertain', never sent again by itself; after a person checks, it can be sent or numbered", async () => {
  await withTokens();
  mode = "hang";
  const r = await submit(owner("t1"), "inv1");
  assert.equal(r.success, false);
  assert.equal(r.outcome, "uncertain");
  assert.match(r.error ?? "", /may already have recorded/);
  assert.equal(fbrCalls.length, 1);

  mode = "accept";
  const blocked = await submit(owner("t1"), "inv1");
  assert.equal(blocked.outcome, "uncertain");
  assert.equal(fbrCalls.length, 1, "not re-sent while unclear");

  // Checked in IRIS: FBR does not have it.
  await assert.rejects(fbr.resolve(sql, cashierNot, { submissionId: r.submissionId, resolution: "not_received" }, deps()), /cannot submit/);
  await fbr.resolve(sql, owner("t1"), { submissionId: r.submissionId, resolution: "not_received" }, deps());
  const sent = await submit(owner("t1"), "inv1");
  assert.equal(sent.success, true);
  assert.equal(fbrCalls.length, 2);

  // Another one: FBR did have it; the number is entered by hand.
  mode = "hang";
  const r2 = await submit(owner("t1"), "inv2");
  await assert.rejects(fbr.resolve(sql, owner("t1"), { submissionId: r2.submissionId, resolution: "accepted", fbrInvoiceNo: "x" }, deps()), /exactly/);
  await fbr.resolve(sql, owner("t1"), { submissionId: r2.submissionId, resolution: "accepted", fbrInvoiceNo: "7000123DI1234567" }, deps());
  assert.equal(one(`SELECT fbr_invoice_no FROM invoices WHERE id = 'inv2'`).fbr_invoice_no, "7000123DI1234567");
  const after = await submit(owner("t1"), "inv2");
  assert.deepEqual([after.success, after.fbrInvoiceNo], [true, "7000123DI1234567"]);
  await assert.rejects(fbr.resolve(sql, owner("t1"), { submissionId: r2.submissionId, resolution: "not_received" }, deps()), /clear outcome/, "an answered one cannot be resolved");
});

test("FBR refuses (expired token, bad item): 'rejected', may be sent again after fixing", async () => {
  await withTokens();
  mode = "reject401";
  let r = await submit(owner("t1"), "inv1");
  assert.deepEqual([r.success, r.outcome], [false, "rejected"]);
  assert.match(r.error ?? "", /rejected the token/);
  mode = "item-error";
  r = await submit(owner("t1"), "inv1");
  assert.equal(r.outcome, "rejected");
  assert.match(r.error ?? "", /Item 1: Invalid HS code \[0052\]/);
  mode = "accept";
  r = await submit(owner("t1"), "inv1");
  assert.equal(r.success, true);
  assert.deepEqual(all(`SELECT status FROM fbr_submissions WHERE doc_id = 'inv1' ORDER BY created_at, rowid`).map((x) => x.status), ["rejected", "rejected", "accepted"]);
});

test("FBR server error without a readable answer is 'uncertain' (FBR may have saved it)", async () => {
  await withTokens();
  mode = "error500";
  const r = await submit(owner("t1"), "inv1");
  assert.equal(r.outcome, "uncertain");
});

test("gateway down: nothing reached FBR, so it is 'not received' and can be sent again", async () => {
  await withTokens();
  const probe = createServer();
  await new Promise<void>((res) => probe.listen(0, "127.0.0.1", res));
  const port = (probe.address() as AddressInfo).port;
  await new Promise((res) => probe.close(res));
  const r = await fbr.submit(sql, owner("t1"), { docType: "invoice", docId: "inv1", environment: "sandbox", payload: payload() }, undefined, { gateway: { url: `http://127.0.0.1:${port}`, secret: SECRET }, now: () => clock });
  assert.equal(r.outcome, "not_received");
  assert.equal(fbrCalls.length, 0);
  const ok = await submit(owner("t1"), "inv1");
  assert.equal(ok.success, true);
});

test("a wrong gateway secret is refused by the gateway; FBR never sees it", async () => {
  await withTokens();
  const r = await fbr.submit(sql, owner("t1"), { docType: "invoice", docId: "inv1", environment: "sandbox", payload: payload() }, undefined, { gateway: { url: gatewayUrl, secret: "another-secret-0123456789abcdef0123456789" }, now: () => clock });
  assert.equal(r.outcome, "not_received");
  assert.equal(fbrCalls.length, 0);
});

test("businesses stay apart: tokens, documents, records", async () => {
  await withTokens("t1");
  await withTokens("t2", "sandbox-token-t2", "production-token-t2");
  await assert.rejects(submit(owner("t2"), "inv1"), /not found/, "t2 cannot send t1's invoice");
  const r = await submit(owner("t2"), "inv-t2");
  assert.equal(r.success, true);
  assert.equal(fbrCalls.at(-1)!.auth, "Bearer sandbox-token-t2", "each with its own token");
  const t1 = await submit(owner("t1"), "inv1");
  await assert.rejects(fbr.resolve(sql, owner("t2"), { submissionId: t1.submissionId, resolution: "not_received" }, deps()), /not found/);
  await assert.rejects(fbr.finish(sql, owner("t2"), { submissionId: t1.submissionId, report: { kind: "uncertain" } }, deps()), /not found/);
  const t2list = await fbr.list(sql, owner("t2"), {}, deps());
  assert.deepEqual(t2list.map((x) => x.doc_id), ["inv-t2"]);
});

test("who may submit: permission, business switch, branch, enabled, seller NTN", async () => {
  await withTokens();
  await assert.rejects(submit(cashierNot, "inv1"), /cannot submit/);
  assert.equal((await submit(cashierAllowed, "inv1")).success, true);
  await assert.rejects(submit(cashierAllowed, "invB", { scope: { accessible: ["main-t1"] } }), /branch/);
  await assert.rejects(fbr.submit(sql, owner("t1"), { docType: "invoice", docId: "inv2", environment: "sandbox", payload: payload("9999999") }, undefined, deps()), /seller NTN/);
  setSetting("t1", "fbr_enabled", "false");
  await assert.rejects(submit(owner("t1"), "inv2"), /not enabled/);
  setSetting("t1", "fbr_enabled", "true");
  run(`UPDATE tenants SET fbr_allowed = 0 WHERE id = 't1'`);
  await assert.rejects(submit(owner("t1"), "inv2"), /switched off/);
  await assert.rejects(submit(admin, "inv2"), /not attached/);
});

test("sandbox and production are separate: own address, own token, own record", async () => {
  await withTokens();
  assert.equal((await submit(owner("t1"), "inv1")).success, true);
  await assert.rejects(submit(owner("t1"), "inv2", { env: "production" }), /settings changed/, "the page's environment must match the business's");
  setSetting("t1", "fbr_environment", "production");
  run(`UPDATE invoices SET fbr_invoice_no = NULL WHERE id = 'inv1'`);
  const p = await submit(owner("t1"), "inv1", { env: "production" });
  assert.equal(p.success, true, "a sandbox acceptance does not block production");
  assert.equal(fbrCalls.at(-1)!.url, "/di_data/v1/di/postinvoicedata");
  assert.equal(fbrCalls.at(-1)!.auth, "Bearer production-token-t1");
});

test("electric store documents are tracked the same way", async () => {
  await withTokens();
  const r = await submit(owner("t1"), "es1", { docType: "es_doc" });
  assert.equal(r.success, true);
  assert.deepEqual(Object.values(one(`SELECT fbr_invoice_no, fbr_status FROM es_docs WHERE id = 'es1'`)), [r.fbrInvoiceNo, "accepted"]);
});

test("direct mode (no gateway yet): the browser sends, the server still records and blocks duplicates", async () => {
  await withTokens();
  const start = await submit(owner("t1"), "inv1", { d: direct() });
  assert.equal(start.direct, true);
  assert.equal(start.token, "sandbox-token-t1");
  assert.equal(fbrCalls.length, 0, "the server did not call FBR");
  const second = await submit(owner("t1"), "inv1", { d: direct() });
  assert.equal(second.direct, undefined, "a second tab gets no token while the first is sending");
  const done = await fbr.finish(sql, owner("t1"), { submissionId: start.submissionId, report: { kind: "response", status: 200, text: `{"invoiceNumber":"FBR777","validationResponse":{"statusCode":"00"}}` } }, direct());
  assert.deepEqual([done.success, done.fbrInvoiceNo], [true, "FBR777"]);
  assert.equal(one(`SELECT fbr_invoice_no FROM invoices WHERE id = 'inv1'`).fbr_invoice_no, "FBR777");
  await assert.rejects(fbr.finish(sql, owner("t1"), { submissionId: start.submissionId, report: { kind: "response", status: 200, text: "{}" } }, direct()), /already finished/);

  const s2 = await submit(owner("t1"), "inv2", { d: direct() });
  const lost = await fbr.finish(sql, owner("t1"), { submissionId: s2.submissionId, report: { kind: "uncertain", error: "Failed to fetch" } }, direct());
  assert.equal(lost.outcome, "uncertain");
});

test("a sender that vanished (browser closed mid-send): after a few minutes the attempt counts as uncertain", async () => {
  await withTokens();
  const start = await submit(owner("t1"), "inv1", { d: direct() });
  clock = new Date(clock.getTime() + fbr.STALE_PENDING_MS + 1000);
  const next = await submit(owner("t1"), "inv1", { d: direct() });
  assert.equal(next.outcome, "uncertain");
  assert.match(next.error ?? "", /no clear outcome/);
  assert.equal(one(`SELECT status FROM fbr_submissions WHERE id = ?`, start.submissionId).status, "uncertain");
});

test("reference lookups go through the gateway with the business's token; only FBR's known lookups", async () => {
  await withTokens();
  const r = await fbr.reference(sql, cashierAllowed, { path: "/pdi/v2/HS_UOM?hs_code=3004.9099&annexure_id=3" }, deps());
  assert.equal((r as { status: number }).status, 200);
  assert.equal(fbrCalls.at(-1)!.auth, "Bearer sandbox-token-t1");
  await assert.rejects(fbr.reference(sql, owner("t1"), { path: "/di_data/v1/di/postinvoicedata" }, deps()), /not allowed/);
});

test("token test through the gateway: FBR's refusal is explained", async () => {
  await withTokens();
  mode = "reject401";
  const bad = await fbr.testToken(sql, owner("t1"), { environment: "sandbox" }, deps());
  assert.equal(bad.ok, false);
  assert.match(bad.message, /whitelisted/);
  mode = "accept";
  assert.equal((await fbr.testToken(sql, owner("t1"), { environment: "production", token: "typed-production-token" }, deps())).ok, true);
  assert.equal(fbrCalls.at(-1)!.url, "/di_data/v1/di/validateinvoicedata");
  assert.equal(fbrCalls.at(-1)!.auth, "Bearer typed-production-token");
});

test("Super Admin overview: gateway health and businesses, never a token", async () => {
  await withTokens();
  mode = "hang";
  await submit(owner("t1"), "inv1");
  const o = await fbr.adminOverview(sql, admin, deps());
  assert.equal(o.gateway.ok, true);
  assert.equal(o.tenants.length, 2);
  assert.equal(Number(o.tenants.find((t) => t.id === "t1")!.open_uncertain), 1);
  assert.equal(o.problems.length, 1);
  assert.ok(!JSON.stringify(o).includes("token-t1"));
  await assert.rejects(fbr.adminOverview(sql, owner("t1"), deps()), /Super Admin/);
});

test("MAVIN and the gateway sign requests identically", () => {
  const args = [SECRET, "1762934400000", "req-12345678", "POST", "/v1/fbr", `{"a":1}`] as const;
  assert.equal(mavinSign(...args), gatewaySign(...args));
});
