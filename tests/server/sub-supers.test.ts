/** Sub Supers (software distributors): authorization, the customer-setup
 * workflow, payment verification and owner activation, idempotency, and the
 * yearly sales report. Runs src/server/subSupers.ts on the real schema
 * (SQLite) with synthetic distributors and customers. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import * as ss from "@/server/subSupers";
import { distributorAction, ownerAction } from "@/server/subSupersApi";
import type { Actor, Sql } from "@/server/subSupers";
import { passwordHash, refuseDistributor, HttpError } from "@/server/db";
import { scopeStatement, ScopeError } from "@/server/tenantScope";

let db: DatabaseSync;
let sql: Sql;
const OWNER: Actor = { kind: "owner", userId: "owner-1" };
const T0 = "2026-01-01T00:00:00.000Z";

beforeEach(() => {
  db = fullSchemaDb();
  sql = sqliteSql(db);
  db.prepare(`INSERT INTO subscription_plans (id, name, price, duration_days, allowed_modules, max_staff_logins, created_at, updated_at) VALUES ('plan-pro', 'Pro', 20000, 365, '[]', 1, ?, ?)`).run(T0, T0);
});

const asDistributor = async (subSuperId: string): Promise<Actor> => {
  const s = db.prepare(`SELECT user_id FROM sub_supers WHERE id = ?`).get(subSuperId) as { user_id: string };
  return ss.actorFor(sql, { userId: s.user_id, role: "staff", platformRole: "distributor" });
};
async function newDistributor(username: string, apps: string[]) {
  const r = await ss.createDistributor(sql, OWNER, { name: `Synthetic ${username}`, businessName: "Synthetic Traders", phone: "0300 0000000", username, appIds: apps });
  return { id: r.id, actor: await asDistributor(r.id), token: r.setupToken };
}
const setup = (over: Partial<ss.SetupInput> = {}): ss.SetupInput => ({
  appId: "retail_pharmacy", planId: "plan-pro", businessName: "Synthetic Pharmacy One", ownerName: "Test Owner", phone: "0311 1111111",
  proposedUsername: "synthpharm1", claimedAmount: 20000, paymentReference: "TXN-001", paymentDate: "2026-03-02", ...over,
});
async function submitted(actor: Actor, over: Partial<ss.SetupInput> = {}) {
  const { id } = await ss.saveDraft(sql, actor, null, setup(over));
  await ss.submitSetup(sql, actor, id);
  return id;
}
const count = (q: string, ...a: unknown[]) => (db.prepare(q).get(...(a as never[])) as { n: number }).n;

test("a distributor submits a complete setup for an authorized application; it appears in Pending Approvals", async () => {
  const d = await newDistributor("dist.one", ["retail_pharmacy"]);
  const id = await submitted(d.actor);
  const pending = await ss.pendingApprovals(sql, OWNER);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, id);
  assert.equal(pending[0].distributor_name, "Synthetic dist.one");
  assert.equal(pending[0].expected_amount, 20000, "expected amount is the plan price at submission");
  assert.equal(pending[0].payment_status, "unverified");
});

test("an incomplete setup or a taken login ID cannot be submitted", async () => {
  const d = await newDistributor("dist.one", ["retail_pharmacy"]);
  const { id } = await ss.saveDraft(sql, d.actor, null, setup({ ownerName: "", proposedUsername: "dist.one" }));
  await assert.rejects(ss.submitSetup(sql, d.actor, id), /Owner name is required.*already in use/);
});

test("an unauthorized application is refused, on draft and at submission", async () => {
  const d = await newDistributor("dist.one", ["retail_pharmacy"]);
  await assert.rejects(ss.saveDraft(sql, d.actor, null, setup({ appId: "restaurant" })), /not authorized/);
  await assert.rejects(distributorAction(sql, d.actor, { action: "saveDraft", ...setup({ appId: "hospital" }) }), /not authorized/);
});

test("a distributor cannot read or change another distributor's records, by any id", async () => {
  const a = await newDistributor("dist.a", ["retail_pharmacy"]);
  const b = await newDistributor("dist.b", ["retail_pharmacy"]);
  const idA = await submitted(a.actor);
  await assert.rejects(ss.myRequest(sql, b.actor, idA), /not found/);
  assert.deepEqual(await ss.myRequests(sql, b.actor), []);
  await assert.rejects(ss.saveDraft(sql, b.actor, idA, setup()), /Only your own/);
  await assert.rejects(ss.submitSetup(sql, b.actor, idA), /not found/);
  const report = await ss.salesReport(sql, b.actor, { year: 2026, subSuperId: a.id });
  assert.deepEqual(report.leaderboard.map((r) => r.id), [b.id], "a distributor's report shows only themselves, whatever is asked");
});

test("a distributor cannot verify payment, activate or use owner actions, in code or by API", async () => {
  const d = await newDistributor("dist.one", ["retail_pharmacy"]);
  const id = await submitted(d.actor);
  await assert.rejects(ss.verifyPayment(sql, d.actor, id, { amount: 20000, reference: "TXN-001" }), /Only the platform owner/);
  await assert.rejects(ss.activate(sql, d.actor, id), /Only the platform owner/);
  await assert.rejects(ss.pendingApprovals(sql, d.actor), /Only the platform owner/);
  await assert.rejects(ss.setDistributorApps(sql, d.actor, d.id, ["hospital"]), /Only the platform owner/);
  for (const action of ["activate", "verifyPayment", "pending", "listDistributors"]) {
    await assert.rejects(distributorAction(sql, d.actor, { action, id }), /Unknown action/, `${action} is not a distributor action`);
  }
  // The owner endpoint itself refuses a non-owner actor at every action.
  await assert.rejects(ownerAction(sql, d.actor, { action: "activate", id }, "http://x"), /Only the platform owner/);
});

test("a distributor login is refused by every server route unless the route allows it", () => {
  // callerOf runs this for /api/db, /api/ai, /api/auth/users and every other route (default deny).
  assert.throws(() => refuseDistributor("distributor"), (e: unknown) => e instanceof HttpError && e.status === 403);
  assert.doesNotThrow(() => refuseDistributor("distributor", true), "their own workspace, who-am-I and password change allow it");
  assert.doesNotThrow(() => refuseDistributor(null), "business and admin logins are unaffected");
  // And had a statement reached the business rewrite, a login without a business gets nothing.
  assert.throws(() => scopeStatement(`SELECT * FROM invoices`, [], { tenantId: "", sharedGroups: [], linkedPharmacies: [] }, new Map()), ScopeError);
});

test("nothing exists for a submitted customer before payment verification and owner approval", async () => {
  const d = await newDistributor("dist.one", ["retail_pharmacy"]);
  const id = await submitted(d.actor);
  assert.equal(count(`SELECT COUNT(*) AS n FROM tenants WHERE id = ?`, `t-${id}`), 0);
  assert.equal(count(`SELECT COUNT(*) AS n FROM users WHERE username = 'synthpharm1'`), 0, "no login exists, so nobody can sign in");
  await assert.rejects(ss.activate(sql, OWNER, id), /Verify the payment first/);
});

test("the owner returns a setup for correction; the distributor fixes and resubmits", async () => {
  const d = await newDistributor("dist.one", ["retail_pharmacy"]);
  const id = await submitted(d.actor, { paymentReference: "WRONG" });
  await assert.rejects(ss.returnForCorrection(sql, OWNER, id, ""), /Give a reason/);
  await ss.returnForCorrection(sql, OWNER, id, "Payment reference does not match the bank statement.");
  const mine = await ss.myRequest(sql, d.actor, id);
  assert.equal(mine.request.status, "returned");
  assert.equal(mine.request.return_reason, "Payment reference does not match the bank statement.");
  await ss.saveDraft(sql, d.actor, id, setup({ paymentReference: "TXN-001" }));
  await ss.submitSetup(sql, d.actor, id);
  assert.equal((await ss.myRequest(sql, d.actor, id)).request.status, "submitted");
});

test("payment must match the reported reference; a different amount needs a note", async () => {
  const d = await newDistributor("dist.one", ["retail_pharmacy"]);
  const id = await submitted(d.actor);
  await assert.rejects(ss.verifyPayment(sql, OWNER, id, { amount: 20000, reference: "TXN-999" }), /does not match/);
  await assert.rejects(ss.verifyPayment(sql, OWNER, id, { amount: 18000, reference: "TXN-001" }), /Add a note/);
  await ss.verifyPayment(sql, OWNER, id, { amount: 20000, reference: "txn-001" });
  const r = (await ss.getRequest(sql, OWNER, id)).request;
  assert.equal(r.payment_status, "verified");
  assert.equal(r.status, "under_review");
});

test("the owner verifies and activates: one tenant, one owner login, one subscription, a working setup link", async () => {
  const d = await newDistributor("dist.one", ["retail_pharmacy"]);
  const id = await submitted(d.actor);
  await ss.verifyPayment(sql, OWNER, id, { amount: 20000, reference: "TXN-001" });
  const r = await ss.activate(sql, OWNER, id);
  assert.equal(r.alreadyActivated, false);
  const tenant = db.prepare(`SELECT * FROM tenants WHERE id = ?`).get(r.tenantId) as Record<string, unknown>;
  assert.equal(tenant.name, "Synthetic Pharmacy One");
  assert.equal(tenant.business_type, "retail_pharmacy");
  assert.equal(tenant.subscription_plan_id, "plan-pro");
  assert.equal(tenant.subscription_status, "active");
  const days = (Date.parse(String(tenant.subscription_expires_at)) - Date.parse(String(tenant.subscription_started_at))) / 86_400_000;
  assert.equal(Math.round(days), 365, "the term starts at activation");
  const owner = db.prepare(`SELECT * FROM users WHERE tenant_id = ?`).get(r.tenantId) as Record<string, string>;
  assert.equal(owner.username, "synthpharm1");
  assert.equal(owner.role, "owner");
  // The password is set only through the one-time link; it never existed in plaintext.
  await ss.redeemSetupToken(sql, r.setupToken!, "first-pass-123");
  const after = db.prepare(`SELECT password_hash, password_salt FROM users WHERE id = ?`).get(owner.id) as Record<string, string>;
  assert.equal(after.password_hash, passwordHash("first-pass-123", after.password_salt));
  await assert.rejects(ss.redeemSetupToken(sql, r.setupToken!, "again-123"), /expired or was already used/);
});

test("repeated and concurrent activations create everything exactly once", async () => {
  const d = await newDistributor("dist.one", ["retail_pharmacy"]);
  const id = await submitted(d.actor);
  await ss.verifyPayment(sql, OWNER, id, { amount: 20000, reference: "TXN-001" });
  const results = await Promise.all([ss.activate(sql, OWNER, id), ss.activate(sql, OWNER, id), ss.activate(sql, OWNER, id)]);
  assert.equal(results.filter((r) => !r.alreadyActivated).length, 1);
  assert.ok(results.every((r) => r.tenantId === `t-${id}`));
  const again = await ss.activate(sql, OWNER, id);
  assert.equal(again.alreadyActivated, true);
  assert.equal(count(`SELECT COUNT(*) AS n FROM tenants WHERE id = ?`, `t-${id}`), 1);
  assert.equal(count(`SELECT COUNT(*) AS n FROM users WHERE username = 'synthpharm1'`), 1);
  assert.equal(count(`SELECT COUNT(*) AS n FROM onboarding_events WHERE request_id = ? AND action = 'activated'`, id), 1);
  const report = await ss.salesReport(sql, OWNER, { year: new Date().getUTCFullYear() });
  assert.equal(report.leaderboard[0].salesCount, 1, "one attributed sale");
});

test("a partly failed activation leaves nothing behind and can be retried", async () => {
  const d = await newDistributor("dist.one", ["retail_pharmacy"]);
  const id = await submitted(d.actor);
  await ss.verifyPayment(sql, OWNER, id, { amount: 20000, reference: "TXN-001" });
  // A user row with the owner login's id already exists, so the user insert fails mid-transaction.
  db.prepare(`INSERT INTO users (id, tenant_id, username, password_hash, password_salt, role, created_at, updated_at) VALUES (?, NULL, 'blocker', 'x', 'x', 'staff', ?, ?)`).run(`u-${id}`, T0, T0);
  await assert.rejects(ss.activate(sql, OWNER, id));
  assert.equal(count(`SELECT COUNT(*) AS n FROM tenants WHERE id = ?`, `t-${id}`), 0, "the tenant insert was rolled back");
  assert.equal((await ss.getRequest(sql, OWNER, id)).request.status, "under_review");
  db.prepare(`DELETE FROM users WHERE id = ?`).run(`u-${id}`);
  const r = await ss.activate(sql, OWNER, id);
  assert.equal(r.alreadyActivated, false);
});

test("suspension and removing an application block new work, flag pending setups, and keep history", async () => {
  const d = await newDistributor("dist.one", ["retail_pharmacy", "general_store"]);
  const sold = await submitted(d.actor);
  await ss.verifyPayment(sql, OWNER, sold, { amount: 20000, reference: "TXN-001" });
  await ss.activate(sql, OWNER, sold);
  const pendingStore = await submitted(d.actor, { appId: "general_store", businessName: "Synthetic Store", phone: "0322 2222222", proposedUsername: "synthstore" });

  await ss.setDistributorApps(sql, OWNER, d.id, ["retail_pharmacy"]);
  const flagged = (await ss.getRequest(sql, OWNER, pendingStore)).request;
  assert.equal(flagged.needs_owner_review, 1);
  assert.match(String(flagged.owner_review_reason), /General Store/);
  await assert.rejects(ss.saveDraft(sql, d.actor, null, setup({ appId: "general_store" })), /not authorized/);
  await ss.verifyPayment(sql, OWNER, pendingStore, { amount: 20000, reference: "TXN-001" });
  await assert.rejects(ss.activate(sql, OWNER, pendingStore), /no longer authorized/);
  assert.equal(count(`SELECT COUNT(*) AS n FROM sub_super_apps WHERE sub_super_id = ? AND revoked_at IS NOT NULL`, d.id), 1, "the revoked grant is kept");

  await assert.rejects(ss.setDistributorStatus(sql, OWNER, d.id, "suspended", ""), /Give a reason/);
  await ss.setDistributorStatus(sql, OWNER, d.id, "suspended", "Contract ended");
  assert.equal(count(`SELECT COUNT(*) AS n FROM users u JOIN sub_supers s ON s.user_id = u.id WHERE s.id = ? AND u.is_active = 0`, d.id), 1, "the login is blocked");
  await assert.rejects(ss.saveDraft(sql, d.actor, null, setup()), /suspended/);
  const report = await ss.salesReport(sql, OWNER, { year: new Date().getUTCFullYear() });
  const row = report.leaderboard.find((r) => r.id === d.id)!;
  assert.equal(row.status, "suspended");
  assert.equal(row.salesCount, 1, "the earlier sale stays in the history");
  assert.equal(count(`SELECT COUNT(*) AS n FROM tenants WHERE id = ?`, `t-${sold}`), 1, "the customer's subscription is untouched");
});

test("yearly report: only activated sales count, in the activation month in Karachi time, across the year boundary", async () => {
  const a = await newDistributor("dist.a", ["retail_pharmacy"]);
  const b = await newDistributor("dist.b", ["retail_pharmacy"]);
  const sale = async (actor: Actor, n: number, amount: number, activatedAt: string) => {
    const id = await submitted(actor, { businessName: `Synthetic Customer ${n}`, phone: `0300 00000${n}`, proposedUsername: `cust${n}`, claimedAmount: amount });
    await ss.verifyPayment(sql, OWNER, id, { amount, reference: "TXN-001", note: "test amount" });
    await ss.activate(sql, OWNER, id);
    db.prepare(`UPDATE onboarding_requests SET activated_at = ? WHERE id = ?`).run(activatedAt, id);
    return id;
  };
  await sale(a.actor, 1, 20000, "2026-03-10T10:00:00.000Z");
  await sale(a.actor, 2, 20000, "2026-12-31T19:30:00.000Z"); // 1 Jan 2027, 00:30 in Karachi: next year
  await sale(b.actor, 3, 15000, "2025-12-31T19:30:00.000Z"); // 1 Jan 2026, 00:30 in Karachi: this year, January
  await sale(b.actor, 4, 15000, "2026-06-01T08:00:00.000Z");
  await sale(b.actor, 5, 15000, "2026-06-02T08:00:00.000Z");
  await submitted(b.actor, { businessName: "Synthetic Pending", phone: "0300 0000099", proposedUsername: "pending1" });
  const rejected = await submitted(b.actor, { businessName: "Synthetic Rejected", phone: "0300 0000098", proposedUsername: "rejected1" });
  await ss.rejectSetup(sql, OWNER, rejected, "Duplicate customer");

  const r2026 = await ss.salesReport(sql, OWNER, { year: 2026 });
  const ra = r2026.leaderboard.find((r) => r.id === a.id)!;
  const rb = r2026.leaderboard.find((r) => r.id === b.id)!;
  assert.deepEqual([ra.salesCount, ra.salesAmount], [1, 20000]);
  assert.deepEqual([rb.salesCount, rb.salesAmount], [3, 45000]);
  assert.equal(rb.months[0].count, 1, "31 Dec 19:30 UTC is January in Karachi");
  assert.equal(rb.months[5].count, 2);
  assert.equal(rb.pending, 1);
  assert.equal(rb.rejected, 1);
  assert.equal(r2026.top?.id, b.id, "ranked by verified amount by default");
  const byCount = await ss.salesReport(sql, OWNER, { year: 2026, rankBy: "count" });
  assert.equal(byCount.top?.id, b.id);
  const r2027 = await ss.salesReport(sql, OWNER, { year: 2027 });
  assert.equal(r2027.leaderboard.find((r) => r.id === a.id)!.salesCount, 1, "the late-December UTC sale belongs to 2027");
  const filtered = await ss.salesReport(sql, OWNER, { year: 2026, appId: "general_store" });
  assert.equal(filtered.top, null, "no sales of another application");
});

test("Karachi month boundaries", () => {
  assert.equal(ss.zonedMonthStart(2026, 0).toISOString(), "2025-12-31T19:00:00.000Z");
  assert.equal(ss.zonedMonthStart(2027, 0).toISOString(), "2026-12-31T19:00:00.000Z");
});
