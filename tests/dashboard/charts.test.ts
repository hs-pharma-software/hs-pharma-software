/** Dashboard charts: the hospital's wheels (visits by type and department,
 * money by method), today's OPD flow, the 7-day trends, and a shop's sales
 * split into collected and on credit. Each counts only its own business. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { fillDays, getHospitalBreakdown, getSalesTrend, getTodaySalesSplit, lastDays } from "@/lib/repo/dashboardCharts";
import { localDate } from "@/lib/localDate";

let db: DatabaseSync;
const TODAY = localDate();
const YESTERDAY = lastDays(2)[0];
const tenant = (id: string, businessType: string): SessionTenant => ({
  id, name: id, subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType,
});
const signIn = (t: SessionTenant) =>
  useAuthStore.setState({ currentUser: { id: `o-${t.id}`, username: "o", displayName: "Owner", role: "owner", tenantId: t.id, permissions: null }, currentTenant: t });

let n = 0;
function episode(tenantId: string, type: string, opts: { dept?: string; status?: string; consult?: string; from?: string; date?: string } = {}) {
  const id = `ep${++n}`;
  db.prepare(`INSERT INTO hospital_episodes (id, tenant_id, episode_no, type, patient_id, department, date, status, consult_status, from_episode_id, created_at, updated_at)
              VALUES (?, ?, ?, ?, 'p1', ?, ?, ?, ?, ?, 'x', 'x')`)
    .run(id, tenantId, id, type, opts.dept ?? null, opts.date ?? TODAY, opts.status ?? "open", opts.consult ?? "waiting", opts.from ?? null);
  return id;
}
function payment(tenantId: string, amount: number, method: string, at: string, type = "payment") {
  db.prepare(`INSERT INTO hospital_payments (id, tenant_id, episode_id, type, amount, method, received_at, created_at, updated_at) VALUES (?, ?, 'ep', ?, ?, ?, ?, 'x', 'x')`)
    .run(`pay${++n}`, tenantId, type, amount, method, at);
}
function invoice(tenantId: string, date: string, total: number, paid: number, isReturn = 0) {
  db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_no, date, total, paid, is_return, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'x', 'x')`)
    .run(`inv${++n}`, tenantId, `INV-${n}`, date, total, paid, isReturn);
}

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
});

test("last days and gaps filled with zero, oldest first", () => {
  const days = lastDays(3, new Date(2026, 0, 2));
  assert.deepEqual(days, ["2025-12-31", "2026-01-01", "2026-01-02"]);
  assert.deepEqual(fillDays(days, [{ d: "2026-01-01", n: 5 }]).map((d) => d.value), [0, 5, 0]);
});

test("hospital: wheels, OPD flow and 7-day money, this hospital only", async () => {
  const a = episode("H", "opd", { dept: "Medicine", consult: "done" });
  episode("H", "opd", { dept: "Medicine", consult: "in_consultation" });
  episode("H", "opd", { dept: "ENT" });
  episode("H", "opd", { status: "cancelled", consult: "done" }); // cancelled: not counted
  episode("H", "ipd", { dept: "Medicine", from: a });
  episode("H", "emergency", { dept: "" });
  episode("H", "opd", { date: YESTERDAY });
  episode("OTHER", "opd", { dept: "Medicine", consult: "done" });
  payment("H", 1000, "cash", `${TODAY} 09:00`);
  payment("H", 500, "card", `${TODAY} 10:00`);
  payment("H", 200, "cash", `${TODAY} 11:00`, "refund");
  payment("H", 700, "cash", `${YESTERDAY} 12:00`);
  payment("OTHER", 9999, "cash", `${TODAY} 09:00`);

  signIn(tenant("H", "hospital"));
  const b = await getHospitalBreakdown(TODAY);
  const map = (rows: { key: string; n: number }[]) => Object.fromEntries(rows.map((r) => [r.key, r.n]));
  assert.deepEqual(map(b.byType), { opd: 3, ipd: 1, emergency: 1 });
  assert.deepEqual(map(b.byDepartment), { Medicine: 3, ENT: 1, "No department": 1 });
  assert.deepEqual(map(b.byMethod), { cash: 800, card: 500 });
  assert.deepEqual(b.opdFlow, { tokens: 3, called: 2, seen: 1, admitted: 1 });
  assert.equal(b.revenueTrend.length, 7);
  assert.equal(b.revenueTrend.at(-1)?.value, 1300);
  assert.equal(b.revenueTrend.at(-2)?.value, 700);
});

test("shop: 7-day net sales and today's collected vs credit", async () => {
  invoice("S", TODAY, 1000, 1000);
  invoice("S", `${TODAY} 15:30`, 500, 200);
  invoice("S", TODAY, 100, 100, 1); // a return: lowers the day's sales, not the split
  invoice("S", YESTERDAY, 300, 300);
  invoice("OTHER", TODAY, 5000, 0);

  signIn(tenant("S", "general_store"));
  const trend = await getSalesTrend(7);
  assert.equal(trend.length, 7);
  assert.equal(trend.at(-1)?.value, 1400);
  assert.equal(trend.at(-2)?.value, 300);
  assert.deepEqual(await getTodaySalesSplit(TODAY), { collected: 1200, credit: 300 });
});
