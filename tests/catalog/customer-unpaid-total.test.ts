/** Contractor invoice form: "Customer Balance" is what the customer still
 * owes on saved invoices (returns subtract; drafts, quotations, other
 * customers and the invoice being edited don't count). */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { getCustomerUnpaidTotal } from "@/lib/repo/ledger";

const T = "con-a";
let db: DatabaseSync;
const tenant: SessionTenant = {
  id: T, name: "Contractor", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "contractor",
};

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  useAuthStore.setState({ currentUser: { id: "o", username: "o", displayName: "Owner", role: "owner", tenantId: T, permissions: null }, currentTenant: tenant });
});

test("sums unpaid balances of the customer's saved invoices", async () => {
  for (const [id, t] of [["c1", T], ["c2", T]]) db.prepare(`INSERT INTO customers (id, tenant_id, name, created_at, updated_at) VALUES (?, ?, ?, 'x', 'x')`).run(id, t, id);
  const add = db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_no, date, customer_id, balance, is_return, is_quotation, is_memorized, created_at, updated_at)
    VALUES (?, ?, ?, '2026-11-02', ?, ?, ?, ?, ?, 'x', 'x')`);
  add.run("i1", T, 1, "c1", 1000, 0, 0, 0);
  add.run("i2", T, 2, "c1", 500, 0, 0, 0);
  add.run("r1", T, 3, "c1", 200, 1, 0, 0);
  add.run("draft", T, 4, "c1", 900, 0, 0, 1);
  add.run("quote", T, 5, "c1", 700, 0, 1, 0);
  add.run("other", T, 6, "c2", 300, 0, 0, 0);
  assert.equal(await getCustomerUnpaidTotal("c1"), 1300);
  assert.equal(await getCustomerUnpaidTotal("c1", "i2"), 800);
});
