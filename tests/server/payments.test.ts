/** Online payments service, with a MOCK provider adapter (labelled as such:
 * these are not provider tests; no JazzCash or Easypaisa service is called and
 * no real charge can happen). Covers: switches and access, credential storage
 * and masking, readiness gates, website-address gating, idempotent attempts,
 * signature checks, amount mismatch, duplicate / out-of-order callbacks, a
 * second paid attempt, effects applied once (web order, subscription),
 * disabling, and refunds. Made-up businesses on the real schema. */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import type { Sql } from "@/server/subSupers";
import type { Caller } from "@/server/sqlPolicy";
import { setAdapterForTests, decryptSecrets, type Adapter, type ProviderResult } from "@/server/paymentProviders";
import {
  applyResult, completeManualRefund, decideRequest, handleCallback, listAttempts, listMerchants, offeredMethods, requestAccess, requestRefund,
  saveMerchant, setMerchantEnabled, startAttempt, testMerchant,
} from "@/server/payments";

process.env.PAYMENTS_SECRET_KEY = randomBytes(32).toString("base64");

let db: DatabaseSync;
let sql: Sql;
const T = new Date().toISOString();
const run = (q: string, ...a: unknown[]) => db.prepare(q).run(...(a as never[]));
const one = (q: string, ...a: unknown[]) => db.prepare(q).get(...(a as never[])) as Record<string, unknown>;
const admin: Caller = { userId: "sa", role: "super_admin", tenantId: null };
const owner = (t = "t1"): Caller => ({ userId: `o-${t}`, role: "owner", tenantId: t, tenantDeniedActions: JSON.parse(String(one(`SELECT denied_actions FROM tenants WHERE id = ?`, t).denied_actions ?? "[]")) });

/** MOCK adapter: signs with the "secret" credential; nothing leaves the process. */
const sign = (secret: string, p: Record<string, string>) => `${secret}|${p.ref}|${p.amount}|${p.status}`;
function mockAdapter(o: { refund?: boolean; inquire?: ProviderResult | null } = {}): Adapter {
  return {
    async initiate(creds, env, a) { return { action: `https://mock-provider.invalid/${env}`, method: "POST", fields: { ref: a.reference, amount: String(a.amountMinor), merchant: creds.merchantId } }; },
    referenceOf: (p) => p.ref ?? null,
    verifyCallback(creds, p) {
      if (p.sig !== sign(creds.integritySalt, p)) return null;
      return { reference: p.ref, status: p.status as ProviderResult["status"], amountMinor: Number(p.amount), currency: p.currency ?? "PKR", providerTxnRef: `TX-${p.ref}`, providerStatus: p.status };
    },
    async inquire() { return o.inquire ?? null; },
    refund: o.refund ? async () => ({ ok: true, providerRef: "RF-1", note: "Refunded (mock)" }) : undefined,
    async test(creds) { return creds.merchantId ? { ok: true, note: "Mock test passed" } : { ok: false, note: "No merchant" }; },
  };
}
const SALT = "salt-abcdef-123456";
const cb = (ref: string, amount: number, status = "paid", salt = SALT, extra: Record<string, string> = {}) => {
  const p = { ref, amount: String(amount), status, ...extra };
  return { ...p, sig: sign(salt, p) };
};

function tenant(id: string, flags: string[] = []) {
  run(`INSERT INTO tenants (id, name, business_type, denied_actions, created_at, updated_at) VALUES (?, ?, 'general_store', ?, ?, ?)`, id, `Shop ${id}`, JSON.stringify(flags), T, T);
}
const ALL = ["+payments.online", "+payments.jazzcash", "+payments.easypaisa", "+payments.card", "+payments.custom_merchant", "+payments.refund"];
function webOrder(id: string, tenantId: string, total: number, o: { reservedUntil?: string } = {}) {
  run(`INSERT INTO web_orders (id, tenant_id, order_no, public_token, idempotency_key, payment_method, fulfillment, customer_name, phone, subtotal, total, reserved_until, created_at, updated_at)
       VALUES (?, ?, (SELECT COALESCE(MAX(order_no), 0) + 1 FROM web_orders), ?, ?, 'online', 'pickup', 'Buyer', '03001234567', ?, ?, ?, ?, ?)`, id, tenantId, `tok-${id}-000000000000000000`, `k-${id}`, total, total, o.reservedUntil ?? "2099-01-01T00:00:00Z", T, T);
}
/** A live, tested, enabled JazzCash connection for t1 on shop.mavin.pk. */
async function activeMerchant(t = "t1", methods = ["wallet", "card"]) {
  const m = await saveMerchant(sql, owner(t), t, { provider: "jazzcash", environment: "live", credentials: { merchantId: "MC123", password: "pw-secret-9999", integritySalt: SALT }, methods, approvedDomains: ["shop.mavin.pk"] });
  assert.equal((await testMerchant(sql, owner(t), m.id)).ok, true);
  await setMerchantEnabled(sql, owner(t), m.id, true);
  return m;
}
const start = (refId = "o1", amountMinor = 150000, key: string | null = "k1", host = "shop.mavin.pk") =>
  startAttempt(sql, { tenantId: "t1", purpose: "web_order", refId, branchId: null, amountMinor, provider: "jazzcash", method: "wallet", idempotencyKey: key, returnUrl: "https://shop.mavin.pk/order/x/", description: "Order 1", host });

beforeEach(() => {
  db = fullSchemaDb();
  sql = sqliteSql(db);
  setAdapterForTests("jazzcash", mockAdapter());
  setAdapterForTests("easypaisa", null);
  tenant("t1", ALL);
  tenant("t2", []);
  webOrder("o1", "t1", 1500);
});
afterEach(() => {
  setAdapterForTests("jazzcash", null);
  setAdapterForTests("easypaisa", null);
});

test("[mock] switches: a business without them cannot save, and approval turns them on", async () => {
  await assert.rejects(saveMerchant(sql, owner("t2"), "t2", { provider: "jazzcash", environment: "sandbox", credentials: { merchantId: "X" } }), /not enabled/);
  const r = await requestAccess(sql, owner("t2"), ["jazzcash", "custom_merchant"], "please");
  await assert.rejects(requestAccess(sql, owner("t2"), ["jazzcash"], ""), /already waiting/);
  await assert.rejects(decideRequest(sql, owner("t2"), r.id, true, ""), /Super Admin/);
  await decideRequest(sql, admin, r.id, true, "");
  const flags = JSON.parse(String(one(`SELECT denied_actions FROM tenants WHERE id = 't2'`).denied_actions));
  assert.ok(flags.includes("+payments.online") && flags.includes("+payments.jazzcash") && !flags.includes("+payments.card"));
  const saved = await saveMerchant(sql, owner("t2"), "t2", { provider: "jazzcash", environment: "sandbox", credentials: { merchantId: "X" }, methods: ["wallet"] });
  assert.equal(saved.status, "setup", "approval or saving never activates");
  await assert.rejects(saveMerchant(sql, owner("t2"), "t2", { provider: "jazzcash", environment: "sandbox", methods: ["card"] }), /Card payments are not enabled/);
});

test("[mock] a business manages only its own account; the platform account is the Super Admin's", async () => {
  await assert.rejects(listMerchants(sql, owner("t1"), "t2"), /Only the business owner/);
  await assert.rejects(listMerchants(sql, owner("t1"), null), /Super Admin/);
  await assert.rejects(listMerchants(sql, { userId: "s", role: "staff", tenantId: "t1" }, "t1"), /Only the business owner/);
  const platform = await saveMerchant(sql, admin, null, { provider: "jazzcash", environment: "live", credentials: { merchantId: "MAVIN", password: "p", integritySalt: "platform-salt" }, methods: ["wallet"] });
  const mine = await saveMerchant(sql, owner("t1"), "t1", { provider: "jazzcash", environment: "live", credentials: { merchantId: "MC123", password: "p", integritySalt: SALT }, methods: ["wallet"] });
  assert.notEqual(platform.id, mine.id);
  assert.deepEqual((await listMerchants(sql, owner("t1"), "t1")).merchants.map((m) => m.id), [mine.id]);
  assert.deepEqual((await listMerchants(sql, admin, null)).merchants.map((m) => m.id), [platform.id]);
});

test("[mock] secrets are encrypted at rest, masked in every response, and kept when left empty", async () => {
  const m = await saveMerchant(sql, owner(), "t1", { provider: "jazzcash", environment: "sandbox", credentials: { merchantId: "MC123", password: "pw-secret-9999", integritySalt: SALT } });
  const row = one(`SELECT credentials_enc, credential_hints FROM payment_merchants WHERE id = ?`, m.id);
  assert.ok(!String(row.credentials_enc).includes("pw-secret") && !String(row.credentials_enc).includes(SALT));
  assert.ok(!JSON.stringify(row.credential_hints).includes("pw-secret"));
  const listed = JSON.stringify(await listMerchants(sql, owner(), "t1"));
  assert.ok(!listed.includes("pw-secret") && !listed.includes(SALT) && !listed.includes("credentials_enc"));
  assert.equal(m.hints.password, "••••9999");
  assert.equal(m.hints.merchantId, "MC123");
  await saveMerchant(sql, owner(), "t1", { provider: "jazzcash", environment: "sandbox", credentials: { password: "" }, methods: ["wallet"] });
  assert.equal(decryptSecrets(String(one(`SELECT credentials_enc FROM payment_merchants WHERE id = ?`, m.id).credentials_enc)).password, "pw-secret-9999");
});

test("[mock] readiness: no adapter, sandbox, untested, or no website address never activates", async () => {
  setAdapterForTests("jazzcash", null);
  const m = await saveMerchant(sql, owner(), "t1", { provider: "jazzcash", environment: "live", credentials: { merchantId: "MC123", password: "p", integritySalt: SALT }, methods: ["wallet"], approvedDomains: ["shop.mavin.pk"] });
  const t = await testMerchant(sql, owner(), m.id);
  assert.equal(t.ok, false);
  assert.match(t.note, /not built yet/);
  await assert.rejects(setMerchantEnabled(sql, owner(), m.id, true), /cannot be turned on yet/);
  setAdapterForTests("jazzcash", mockAdapter());
  await assert.rejects(setMerchantEnabled(sql, owner(), m.id, true), /successful live test/);
  const sb = await saveMerchant(sql, owner(), "t1", { provider: "jazzcash", environment: "sandbox", credentials: { merchantId: "MC1", password: "p", integritySalt: SALT }, methods: ["wallet"] });
  await testMerchant(sql, owner(), sb.id);
  await assert.rejects(setMerchantEnabled(sql, owner(), sb.id, true), /Sandbox is for testing/);
  await saveMerchant(sql, owner(), "t1", { provider: "jazzcash", environment: "live", methods: ["wallet"], approvedDomains: [] });
  await testMerchant(sql, owner(), m.id);
  await assert.rejects(setMerchantEnabled(sql, owner(), m.id, true), /website address/);
  assert.deepEqual(await offeredMethods(sql, "t1", "shop.mavin.pk"), []);
});

test("[mock] new credentials send an active connection back to setup", async () => {
  const m = await activeMerchant();
  assert.equal((await offeredMethods(sql, "t1", "shop.mavin.pk")).length, 2);
  await saveMerchant(sql, owner(), "t1", { provider: "jazzcash", environment: "live", credentials: { integritySalt: "new-salt-000000" }, methods: ["wallet", "card"], approvedDomains: ["shop.mavin.pk"] });
  const row = one(`SELECT status, enabled FROM payment_merchants WHERE id = ?`, m.id);
  assert.equal(row.status, "setup");
  assert.equal(row.enabled, 0);
  assert.deepEqual(await offeredMethods(sql, "t1", "shop.mavin.pk"), []);
});

test("[mock] checkout offers methods only on the approved website address and the business's switches", async () => {
  await activeMerchant();
  assert.deepEqual((await offeredMethods(sql, "t1", "shop.mavin.pk")).map((o) => o.method), ["wallet", "card"]);
  assert.deepEqual(await offeredMethods(sql, "t1", "other.example.com"), []);
  await assert.rejects(start("o1", 150000, "k1", "other.example.com"), /not available/);
  run(`UPDATE tenants SET denied_actions = ? WHERE id = 't1'`, JSON.stringify(ALL.filter((f) => f !== "+payments.card")));
  assert.deepEqual((await offeredMethods(sql, "t1", "shop.mavin.pk")).map((o) => o.method), ["wallet"]);
  run(`UPDATE tenants SET denied_actions = '[]' WHERE id = 't1'`);
  assert.deepEqual(await offeredMethods(sql, "t1", "shop.mavin.pk"), []);
});

test("[mock] attempts are idempotent and the provider form has no secrets", async () => {
  await activeMerchant();
  const a = await start();
  const b = await start();
  assert.equal(a.reference, b.reference);
  assert.equal(Number(one(`SELECT COUNT(*) AS n FROM payment_attempts`).n), 1);
  assert.ok(!JSON.stringify(a.form).includes(SALT) && !JSON.stringify(a.form).includes("pw-secret"));
  assert.equal(one(`SELECT status FROM payment_attempts`).status, "redirected");
  const c = await start("o1", 150000, "k2");
  assert.notEqual(c.reference, a.reference, "a new key is a new attempt");
});

test("[mock] a bad signature or unknown reference changes nothing", async () => {
  await activeMerchant();
  const a = await start();
  await assert.rejects(handleCallback(sql, "jazzcash", cb(a.reference, 150000, "paid", "wrong-salt")), /Invalid callback/);
  await assert.rejects(handleCallback(sql, "jazzcash", cb("NOPE123", 150000)), /Unknown payment/);
  await assert.rejects(handleCallback(sql, "easypaisa", cb(a.reference, 150000)), /Not available/);
  assert.equal(one(`SELECT status FROM payment_attempts`).status, "redirected");
  assert.equal(one(`SELECT payment_status FROM web_orders WHERE id = 'o1'`).payment_status, "unpaid");
  assert.equal(Number(one(`SELECT COUNT(*) AS n FROM payment_events WHERE verified = 0`).n), 3);
});

test("[mock] a paid amount that differs from the order goes to review, not paid", async () => {
  await activeMerchant();
  const a = await start();
  assert.equal((await handleCallback(sql, "jazzcash", cb(a.reference, 100))).status, "review");
  assert.equal(one(`SELECT status FROM payment_attempts`).status, "review");
  assert.equal(one(`SELECT payment_status FROM web_orders WHERE id = 'o1'`).payment_status, "unpaid");
  const wrongCurrency = await start("o1", 150000, "k9");
  assert.equal((await handleCallback(sql, "jazzcash", cb(wrongCurrency.reference, 150000, "paid", SALT, { currency: "USD" }))).status, "review");
});

test("[mock] duplicate and out-of-order callbacks: paid once, never undone by a late failure", async () => {
  await activeMerchant();
  const a = await start();
  assert.equal((await handleCallback(sql, "jazzcash", cb(a.reference, 150000))).status, "paid");
  await handleCallback(sql, "jazzcash", cb(a.reference, 150000));
  await handleCallback(sql, "jazzcash", cb(a.reference, 150000, "failed"));
  await handleCallback(sql, "jazzcash", cb(a.reference, 150000, "pending"));
  const row = one(`SELECT status, applied_at FROM payment_attempts`);
  assert.equal(row.status, "paid");
  assert.ok(row.applied_at);
  assert.equal(one(`SELECT payment_status FROM web_orders WHERE id = 'o1'`).payment_status, "paid");
  assert.equal(Number(one(`SELECT COUNT(*) AS n FROM web_order_events WHERE action = 'paid_online'`).n), 1, "the order is marked paid once");
  await assert.rejects(start("o1", 150000, "k-new"), /already been paid/);
});

test("[mock] a second successful payment for the same order goes to review", async () => {
  await activeMerchant();
  const a = await start("o1", 150000, "k1");
  const b = await start("o1", 150000, "k2");
  await handleCallback(sql, "jazzcash", cb(a.reference, 150000));
  assert.equal((await handleCallback(sql, "jazzcash", cb(b.reference, 150000))).status, "review");
  assert.match(String(one(`SELECT review_note FROM payment_attempts WHERE reference = ?`, b.reference).review_note), /Second successful payment/);
});

test("[mock] paid after the stock hold expired: paid, with a note for staff", async () => {
  webOrder("o2", "t1", 1500, { reservedUntil: "2000-01-01T00:00:00Z" });
  await activeMerchant();
  const a = await start("o2");
  await handleCallback(sql, "jazzcash", cb(a.reference, 150000));
  assert.equal(one(`SELECT payment_status FROM web_orders WHERE id = 'o2'`).payment_status, "paid");
  assert.match(String(one(`SELECT review_note FROM payment_attempts WHERE reference = ?`, a.reference).review_note), /stock hold expired/);
});

test("[mock] subscription paid to the platform account extends the plan once", async () => {
  run(`INSERT INTO subscription_plans (id, name, price, duration_days, created_at, updated_at) VALUES ('pl', 'Mavin Pro', 2500, 30, ?, ?)`, T, T);
  const expires = new Date(Date.now() + 5 * 86_400_000).toISOString();
  run(`UPDATE tenants SET subscription_plan_id = 'pl', subscription_expires_at = ?, subscription_status = 'active' WHERE id = 't2'`, expires);
  const pm = await saveMerchant(sql, admin, null, { provider: "jazzcash", environment: "live", credentials: { merchantId: "MAVIN", password: "p", integritySalt: SALT }, methods: ["wallet"] });
  await testMerchant(sql, admin, pm.id);
  await setMerchantEnabled(sql, admin, pm.id, true);
  assert.equal((await offeredMethods(sql, null)).length, 1);
  const a = await startAttempt(sql, { tenantId: null, purpose: "subscription", refId: "t2", branchId: null, amountMinor: 250000, provider: "jazzcash", method: "wallet", idempotencyKey: "s1", returnUrl: "https://app.mavin.pk/settings/payments/", description: "Mavin Pro" });
  await handleCallback(sql, "jazzcash", cb(a.reference, 250000));
  await handleCallback(sql, "jazzcash", cb(a.reference, 250000));
  const after = Date.parse(String(one(`SELECT subscription_expires_at FROM tenants WHERE id = 't2'`).subscription_expires_at));
  const expected = Date.parse(expires) + 30 * 86_400_000;
  assert.ok(Math.abs(after - expected) < 5000, "extended by one term from the current expiry, once");
});

test("[mock] turning off stops new payments; earlier ones still confirm", async () => {
  const m = await activeMerchant();
  const a = await start();
  await setMerchantEnabled(sql, owner(), m.id, false);
  await assert.rejects(start("o1", 150000, "k2"), /not available/);
  assert.equal((await handleCallback(sql, "jazzcash", cb(a.reference, 150000))).status, "paid");
});

test("[mock] inquiry result goes through the same checks", async () => {
  await activeMerchant();
  const a = await start();
  const att = one(`SELECT * FROM payment_attempts WHERE reference = ?`, a.reference);
  assert.equal((await applyResult(sql, att, { reference: a.reference, status: "paid", amountMinor: 1, currency: "PKR", providerTxnRef: null, providerStatus: "000" }, "inquiry")).status, "review");
});

test("[mock] refunds: limits, idempotency, manual completion, and permission", async () => {
  await activeMerchant();
  const a = await start();
  await handleCallback(sql, "jazzcash", cb(a.reference, 150000));
  const id = String(one(`SELECT id FROM payment_attempts`).id);
  await assert.rejects(requestRefund(sql, { userId: "s", role: "staff", tenantId: "t1", tenantDeniedActions: ALL, actions: [] }, id, { amount: 10 }), /not enabled/);
  await assert.rejects(requestRefund(sql, owner(), id, { amount: 2000 }), /Refund up to Rs 1500.00/);
  const r = await requestRefund(sql, owner(), id, { amount: 500, idempotencyKey: "r1", reason: "damaged" });
  assert.equal(r.status, "manual_pending", "no provider refund in the mock: recorded as manual");
  assert.equal((await requestRefund(sql, owner(), id, { amount: 500, idempotencyKey: "r1" })).status, "manual_pending");
  assert.equal(Number(one(`SELECT COUNT(*) AS n FROM payment_refunds`).n), 1);
  await assert.rejects(requestRefund(sql, owner(), id, { amount: 1001, idempotencyKey: "r2" }), /Refund up to Rs 1000.00/);
  const list = await listAttempts(sql, owner(), "t1");
  assert.equal(list[0].refunded, 500);
  assert.equal(list[0].manualRefunds.length, 1);
  await completeManualRefund(sql, owner(), r.id, "PORTAL-77");
  await assert.rejects(completeManualRefund(sql, owner(), r.id, "again"), /No manual refund/);
  await assert.rejects(requestRefund(sql, owner("t2"), id, { amount: 1 }), /not enabled|not found/);
  setAdapterForTests("jazzcash", mockAdapter({ refund: true }));
  assert.equal((await requestRefund(sql, owner(), id, { amount: 100, idempotencyKey: "r3" })).status, "completed");
});
