/** PRA integration tests. Mocked transports for deterministic behaviour;
 * live tests against PRA's official sandbox run with PRA_LIVE=1. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ctx, makeDb, makeStore, seedMenu } from "./harness.ts";
import { createPraService, type PraHttpResult, type PraTransport } from "../../src/lib/restaurant/praService.ts";
import { buildPraInvoice, mapPraResponse, praVerifyUrl, validatePraInvoice, PRA_ENDPOINTS } from "../../src/lib/restaurant/praModel.ts";

type Reply = PraHttpResult | ((url: string, body: string) => PraHttpResult | Promise<PraHttpResult>);

function mockTransport(replies: Reply[]) {
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  const t: PraTransport = {
    async post(url, body, headers) {
      calls.push({ url, body, headers });
      const r = replies.length > 1 ? replies.shift()! : replies[0];
      return typeof r === "function" ? r(url, body) : r;
    },
    async get() {
      return { httpStatus: 200, body: '["Service is responding"]' };
    },
  };
  return { t, calls };
}

const ok = (no: string): PraHttpResult => ({ httpStatus: 200, body: JSON.stringify({ InvoiceNumber: no, Code: "100", Response: "Fiscal Invoice Number generated successfully.", Errors: null }) });

let env: ReturnType<typeof makeDb>;
let store: ReturnType<typeof makeStore>["store"];
let session: ReturnType<typeof makeStore>["session"];
let M: Awaited<ReturnType<typeof seedMenu>>;

async function configure(tenant = "R", posId = "123456") {
  session.current = ctx(tenant);
  await store.settings.set("rest_tax_cash_rate", "16");
  await store.settings.set("rest_tax_card_rate", "5");
  await store.settings.set("rest_service_charge_pct", "10");
  await store.settings.set("rest_pct_code", "98174000");
  await store.settings.set("pra_enabled", "true");
  await store.settings.set("pra_mode", "local");
  await store.settings.set("pra_pos_id", posId);
}

async function paidOrder(methods: { method: "cash" | "card"; amount: number }[] = [{ method: "cash", amount: 5000 }]) {
  const t = await store.saveTable({ name: `T${Math.random()}` });
  const o = await store.openOrder({ type: "dine_in", tableId: t.id });
  await store.addItem(o.order.id, { menuItemId: M.burger.id, modifiers: ["Extra Cheese"], qty: 2 });
  await store.addItem(o.order.id, { menuItemId: M.cola.id, qty: 3 });
  const r = await store.pay(o.order.id, { payments: methods, customerName: "Ali", customerPhone: "0300-1234567" });
  return r.order;
}

beforeEach(async () => {
  env = makeDb();
  ({ store, session } = makeStore(env.db, ctx("R")));
  M = await seedMenu(store);
  await configure();
});

test("payload follows spec v1.2 and totals reconcile with the bill", async () => {
  const order = await paidOrder();
  const { t, calls } = mockTransport([ok("9000052011142444901")]);
  const pra = createPraService(store, t, async () => null);
  const [sub] = await store.praSubmissions();
  assert.equal(await pra.submit(sub.id), "accepted");
  const inv = JSON.parse(calls[0].body);
  assert.equal(calls[0].url, PRA_ENDPOINTS.localPost);
  assert.equal(inv.POSID, 123456);
  assert.equal(inv.USIN, String(order.invoice_no));
  assert.equal(inv.InvoiceType, 1);
  assert.equal(inv.PaymentMode, 1);
  assert.match(inv.DateTime, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(inv.Items.length, 3, "2 dishes + service charge line");
  assert.equal(inv.TotalBillAmount, order.total);
  assert.equal(inv.TotalTaxCharged, order.tax);
  assert.deepEqual(validatePraInvoice(inv), []);
  for (const it of inv.Items) assert.equal(it.PCTCode, "98174000");
  const after = await store.getOrder(order.id);
  assert.equal(after.order.pra_status, "accepted");
  assert.equal(after.order.pra_invoice_no, "9000052011142444901");
});

test("validation blocks bad data before anything is sent", async () => {
  await store.settings.set("pra_pos_id", "not-a-number");
  await paidOrder();
  const { t, calls } = mockTransport([ok("1")]);
  const pra = createPraService(store, t, async () => null);
  const [sub] = await store.praSubmissions();
  assert.equal(await pra.submit(sub.id), "rejected");
  assert.equal(calls.length, 0, "not sent");
  const [after] = await store.praSubmissions();
  assert.match(after.last_error!, /POS ID/);
  const bad = buildPraInvoice({ posId: "1", usin: "", refUsin: null, invoiceType: 3, at: new Date(), pctCode: "ABC", methods: ["cash"], lines: [] });
  const errors = validatePraInvoice(bad);
  assert.ok(errors.some((e) => /USIN/.test(e)) && errors.some((e) => /RefUSIN/.test(e)) && errors.some((e) => /no items/.test(e)));
});

test("HTTP 200 with a failure code is a rejection, not acceptance", async () => {
  await paidOrder();
  // Exact body returned by the PRA sandbox on 2026-10-23 for an unregistered POS.
  const { t } = mockTransport([{ httpStatus: 200, body: '{"InvoiceNumber":"Not Available","Code":"104","Response":"You are not authorized to use this service."}' }]);
  const pra = createPraService(store, t, async () => null);
  const [sub] = await store.praSubmissions();
  assert.equal(await pra.submit(sub.id), "rejected");
  const [after] = await store.praSubmissions();
  assert.equal(after.response_code, "104");
  assert.equal(after.pra_invoice_no, null);
});

test("invalid credentials (gateway 401 fault) are rejected with the reason", async () => {
  await store.settings.set("pra_mode", "cloud");
  await paidOrder();
  const { t, calls } = mockTransport([{ httpStatus: 401, body: '{"fault":{"code":900901,"message":"Invalid Credentials","description":"Make sure you have given the correct access token"}}' }]);
  const pra = createPraService(store, t, async () => "bad-token");
  const [sub] = await store.praSubmissions();
  assert.equal(await pra.submit(sub.id), "rejected");
  assert.equal(calls[0].headers.Authorization, "Bearer bad-token");
  assert.equal(calls[0].url, PRA_ENDPOINTS.cloudSandbox);
  assert.match((await store.praSubmissions())[0].response_text!, /Invalid Credentials/);
});

test("server error then success: safe retry, single fiscal number", async () => {
  await paidOrder();
  const { t, calls } = mockTransport([{ httpStatus: 503, body: "busy" }, ok("PRA-77")]);
  const pra = createPraService(store, t, async () => null);
  let counts = await pra.processQueue();
  assert.deepEqual(counts, { retry_pending: 1 });
  counts = await pra.processQueue();
  assert.deepEqual(counts, { accepted: 1 });
  counts = await pra.processQueue();
  assert.deepEqual(counts, {}, "nothing left to send");
  assert.equal(calls.length, 2);
  const [sub] = await store.praSubmissions();
  assert.equal(sub.attempts, 2);
  assert.equal(sub.pra_invoice_no, "PRA-77");
});

test("connection refused is retried; a timeout goes to manual review (no blind resend)", async () => {
  await paidOrder();
  const refused = mockTransport([{ httpStatus: null, body: null, networkError: "ECONNREFUSED", maybeDelivered: false }]);
  const pra1 = createPraService(store, refused.t, async () => null);
  assert.deepEqual(await pra1.processQueue(), { retry_pending: 1 });
  const timeout = mockTransport([{ httpStatus: null, body: null, networkError: "Timed out", maybeDelivered: true }]);
  const pra2 = createPraService(store, timeout.t, async () => null);
  assert.deepEqual(await pra2.processQueue(), { manual_review: 1 });
  const again = mockTransport([ok("X")]);
  const pra3 = createPraService(store, again.t, async () => null);
  assert.deepEqual(await pra3.processQueue(), {}, "manual review is not auto-sent");
  assert.equal(again.calls.length, 0);
  const [sub] = await store.praSubmissions();
  await store.resolvePra(sub.id, "retry");
  assert.deepEqual(await pra3.processQueue(), { accepted: 1 });
});

test("unreadable response needs manual review", async () => {
  await paidOrder();
  const { t } = mockTransport([{ httpStatus: 200, body: "<html>proxy</html>" }]);
  const pra = createPraService(store, t, async () => null);
  assert.deepEqual(await pra.processQueue(), { manual_review: 1 });
  assert.deepEqual(mapPraResponse({ httpStatus: 200, body: '{"Response":"ok"}' }).status, "manual_review", "no Code");
});

test("concurrent submits of the same invoice send it once", async () => {
  await paidOrder();
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const { t, calls } = mockTransport([async () => (await gate, ok("ONE"))]);
  const pra = createPraService(store, t, async () => null);
  const [sub] = await store.praSubmissions();
  const p1 = pra.submit(sub.id);
  const p2 = pra.submit(sub.id);
  const p3 = pra.processQueue();
  await new Promise((r) => setTimeout(r, 20));
  release();
  const results = await Promise.all([p1, p2, p3]);
  assert.equal(calls.length, 1);
  assert.ok(results.includes("accepted"));
  assert.ok(results.includes("skipped"));
});

test("restart with an in-flight submission: recovered to manual review", async () => {
  await paidOrder();
  const [sub] = await store.praSubmissions();
  assert.ok(await store.claimPra(sub.id, 60)); // app "crashed" after claiming
  env.clock.now = new Date(env.clock.now.getTime() + 5 * 60_000);
  const { t, calls } = mockTransport([ok("Z")]);
  const pra = createPraService(store, t, async () => null);
  assert.deepEqual(await pra.processQueue(), {});
  assert.equal(calls.length, 0);
  assert.equal((await store.praSubmissions())[0].status, "manual_review");
  await store.resolvePra(sub.id, "accepted", "PRA-FROM-PORTAL");
  assert.equal((await store.getOrder(sub.order_id)).order.pra_invoice_no, "PRA-FROM-PORTAL");
});

test("refund: credit invoice (type 3, RefUSIN) waits for the original, then goes", async () => {
  const order = await paidOrder();
  await store.refund(order.id, { reason: "Wrong order", method: "cash" });
  const { t, calls } = mockTransport([
    (url: string, body: string) => (JSON.parse(body).InvoiceType === 3 ? ok("CREDIT-1") : { httpStatus: 503, body: "" }),
  ]);
  const pra = createPraService(store, t, async () => null);
  // Original fails (503) -> credit must wait.
  const first = await pra.processQueue();
  assert.equal(first.retry_pending, 1);
  assert.equal(first.pending, 1);
  assert.ok(!calls.some((c) => JSON.parse(c.body).InvoiceType === 3), "credit not sent before original");
  const t2 = mockTransport([ok("ORIG-1"), ok("CREDIT-1")]);
  const pra2 = createPraService(store, t2.t, async () => null);
  assert.deepEqual(await pra2.processQueue(), { accepted: 2 });
  const credit = JSON.parse(t2.calls[1].body);
  assert.equal(credit.InvoiceType, 3);
  assert.equal(credit.RefUSIN, String(order.invoice_no));
  assert.equal(credit.TotalBillAmount, order.total);
  assert.ok(credit.Items.every((i: { InvoiceType: number; RefUSIN: string }) => i.InvoiceType === 3 && i.RefUSIN === String(order.invoice_no)));
});

test("payment modes: card 2, mixed 5", async () => {
  const a = await store.openOrder({ type: "takeaway" });
  await store.addItem(a.order.id, { menuItemId: M.tikka.id });
  const due = (await store.previewBill(a.order.id, { methods: ["card"] })).bill.totalPaisa / 100;
  assert.ok((await store.pay(a.order.id, { payments: [{ method: "card", amount: due }] })).finalized);
  const b = await store.openOrder({ type: "takeaway" });
  await store.addItem(b.order.id, { menuItemId: M.cola.id });
  await store.pay(b.order.id, { payments: [{ method: "card", amount: 100 }, { method: "cash", amount: 100 }] });
  const { t, calls } = mockTransport([ok("A"), ok("B")]);
  await createPraService(store, t, async () => null).processQueue();
  const modes = calls.map((c) => JSON.parse(c.body).PaymentMode).sort();
  assert.deepEqual(modes, [2, 5]);
});

test("QR / verification link per spec FAQ 4", () => {
  assert.equal(praVerifyUrl("126983DJCN820607"), "https://reg.pra.punjab.gov.pk/IMSFiscalReport/SearchPOSInvoice_Report.aspx?PRAInvNo=126983DJCN820607");
});

test("each tenant uses its own PRA configuration and queue", async () => {
  await paidOrder();
  session.current = ctx("R2");
  M = await seedMenu(store, "R2-");
  await configure("R2", "777777");
  await paidOrder();
  const { t, calls } = mockTransport([ok("X")]);
  const pra = createPraService(store, t, async () => null);
  session.current = ctx("R2");
  await pra.processQueue();
  assert.equal(calls.length, 1, "only R2's invoice");
  assert.equal(JSON.parse(calls[0].body).POSID, 777777);
  session.current = ctx("R");
  assert.equal((await store.praSubmissions())[0].status, "pending", "R's untouched");
});

test("PRA disabled: invoices are marked not required and nothing is sent", async () => {
  await store.settings.set("pra_enabled", "false");
  const order = await paidOrder();
  assert.equal(order.pra_status, "not_required");
  assert.equal((await store.praSubmissions()).length, 0);
});

// ── Live tests against PRA's official sandbox (PRA_LIVE=1) ──
const live = process.env.PRA_LIVE === "1";
const SANDBOX_TOKEN = "24d8fab3-f2e9-398f-ae17-b387125ec4a2"; // published in PRA spec v1.2, section 7.2.2

const fetchTransport: PraTransport = {
  async post(url, body, headers, timeoutMs) {
    try {
      const r = await fetch(url, { method: "POST", body, headers, signal: AbortSignal.timeout(timeoutMs) });
      return { httpStatus: r.status, body: await r.text() };
    } catch (e) {
      return { httpStatus: null, body: null, networkError: String(e), maybeDelivered: (e as Error).name === "TimeoutError" };
    }
  },
  async get(url, timeoutMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      return { httpStatus: r.status, body: await r.text() };
    } catch (e) {
      return { httpStatus: null, body: null, networkError: String(e) };
    }
  },
};

test("LIVE sandbox: real PRA response for an unregistered POS is handled as rejected", { skip: !live && "set PRA_LIVE=1" }, async () => {
  await store.settings.set("pra_mode", "cloud");
  await store.settings.set("pra_environment", "sandbox");
  await paidOrder();
  const pra = createPraService(store, fetchTransport, async () => SANDBOX_TOKEN);
  assert.equal(await pra.processQueue().then((c) => Object.keys(c)[0]), "rejected");
  const [sub] = await store.praSubmissions();
  assert.equal(sub.response_code, "104");
  assert.match(sub.response_text!, /not authorized/);
});

test("LIVE sandbox: wrong token is refused by PRA's gateway", { skip: !live && "set PRA_LIVE=1" }, async () => {
  await store.settings.set("pra_mode", "cloud");
  const pra = createPraService(store, fetchTransport, async () => "definitely-wrong-token");
  const r = await pra.testConnection();
  assert.equal(r.ok, false);
  assert.match(r.message, /Invalid Credentials|rejected the token/);
});

test("LIVE sandbox: connection test with the published sandbox token", { skip: !live && "set PRA_LIVE=1" }, async () => {
  await store.settings.set("pra_mode", "cloud");
  const pra = createPraService(store, fetchTransport, async () => SANDBOX_TOKEN);
  const r = await pra.testConnection();
  assert.equal(r.ok, true, r.message);
});

test("LIVE local IMS component reachable at localhost:8524", { skip: "BLOCKED: PRA IMS component (IMSSetup.zip) is not installed on this computer; it needs a PRA-issued POS registration number and access code" }, async () => {});

test("LIVE sandbox: invoice ACCEPTED with a fiscal number", { skip: "BLOCKED: needs a Test POS ID issued by PRA (reg.pra.punjab.gov.pk > POS Client Registration, against the restaurant's PNTN)" }, async () => {});
