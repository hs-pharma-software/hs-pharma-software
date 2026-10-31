/** Salesmen: edit, link a login (one salesman per login), monthly target and
 * this month's net sales; before the v62 database update name / phone still save. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { saveSalesman, listSalesmanPerformance, mySalesman } from "@/lib/repo/salesmen";

const T = "pharm-a";
let db: DatabaseSync;
const tenant: SessionTenant = {
  id: T, name: "Pharmacy", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "retail_pharmacy",
};
const login = (id: string) => useAuthStore.setState({ currentUser: { id, username: id, displayName: id, role: "owner", tenantId: T, permissions: null }, currentTenant: tenant });

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  login("owner");
});

let n = 0;
const invoice = (salesmanId: string, date: string, total: number, ret = 0) =>
  db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_no, date, total, salesman_id, is_return, is_memorized, is_quotation, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 'x', 'x')`)
    .run(`i${++n}`, T, n, date, total, salesmanId, ret);

test("edit, link a login once, target and this month's progress", async () => {
  const zia = await saveSalesman(null, { name: "Zia", phone: "0300-1" });
  const ali = await saveSalesman(null, { name: "Ali" });
  await saveSalesman(zia.id, { name: "Zia Ahmad", phone: "0300-1112233", userId: "u-zia", monthlyTarget: 50000 });
  await assert.rejects(saveSalesman(ali.id, { name: "Ali", userId: "u-zia" }), /already linked to Zia Ahmad/);
  await assert.rejects(saveSalesman(ali.id, { name: " " }), /name/);

  invoice(zia.id, "2026-10-05", 30000);
  invoice(zia.id, "2026-10-20", 2000, 1);
  invoice(zia.id, "2026-09-28", 9000);
  const rows = await listSalesmanPerformance("2026-10-31");
  const z = rows.find((r) => r.id === zia.id)!;
  assert.deepEqual([z.name, z.phone, z.user_id, z.monthly_target], ["Zia Ahmad", "0300-1112233", "u-zia", 50000]);
  assert.deepEqual([z.invoice_count, z.sale, z.sale_return, z.net_sale, z.month_sale], [2, 39000, 2000, 37000, 28000]);

  login("u-zia");
  assert.equal((await mySalesman())?.id, zia.id);
  login("someone-else");
  assert.equal(await mySalesman(), null);
});

test("before the v62 database update: name and phone save; linking asks for the update", async () => {
  db = fullSchemaDb(61);
  setTestDb(db);
  const s = await saveSalesman(null, { name: "Zia", phone: "0300" });
  assert.equal(s.name, "Zia");
  await assert.rejects(saveSalesman(s.id, { name: "Zia", userId: "u1" }), /database update \(v62\)/);
  assert.equal((await listSalesmanPerformance("2026-10-31"))[0].user_id, null);
});
