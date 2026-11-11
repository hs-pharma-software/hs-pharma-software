/** Customer extra discount: comes off the already discounted price, then tax;
 * only the owner (or staff given the permission) switches it per customer. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { saleLineMath } from "@/lib/saleLineMath";
import { analyzeSql, authorize, type Caller } from "@/server/sqlPolicy";

test("extra discount applies after the line discount (100 - 15% = 85, then 10% on 85)", () => {
  const m = saleLineMath(100, 1, 15, 10, 0);
  assert.equal(m.discount, 15);
  assert.equal(m.extra, 8.5);
  assert.equal(m.discountRs, 23.5);
  assert.equal(m.total, 76.5);
  // Tax on what is left after both discounts.
  const t = saleLineMath(100, 2, 15, 10, 18);
  assert.equal(t.taxable, 153);
  assert.equal(t.tax.toFixed(2), "27.54");
  assert.equal(t.total.toFixed(2), "180.54");
  // No extra: exactly the old invoice arithmetic.
  const old = (p: number, q: number, d: number, tx: number) => (p * q - p * q * d / 100) * (1 + tx / 100);
  assert.equal(saleLineMath(250.5, 3, 7, 0, 17).total.toFixed(6), old(250.5, 3, 7, 17).toFixed(6));
  // Out of range is clamped.
  assert.equal(saleLineMath(100, 1, 0, 150, 0).total, 0);
  assert.equal(saleLineMath(100, 1, 0, -5, 0).total, 100);
});

const KNOWN = new Set(["customers", "invoices"]);
const owner: Caller = { userId: "o", role: "owner", tenantId: "t1" };
const staff = (actions: string[] = []): Caller => ({ userId: "s", role: "staff", tenantId: "t1", permissions: null, actions });
const run = (sql: string, c: Caller) => authorize(analyzeSql(sql), c, KNOWN);

test("only the owner or allowed staff switch a customer's extra discount", () => {
  const set = `UPDATE customers SET extra_discount = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`;
  const add = `INSERT INTO customers (id, name, extra_discount, tenant_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`;
  assert.equal(run(set, owner).ok, true);
  assert.equal(run(add, owner).ok, true);
  assert.equal(run(set, staff()).ok, false);
  assert.match(String((run(add, staff()) as { reason?: string }).reason), /Only the owner/);
  assert.equal(run(set, staff(["+customer.extra_discount"])).ok, true);
  // Staff still edit other customer details and read the switch.
  assert.equal(run(`UPDATE customers SET name = ?, phone = ? WHERE id = ? AND tenant_id = ?`, staff()).ok, true);
  assert.equal(run(`SELECT id, extra_discount FROM customers WHERE tenant_id = ?`, staff()).ok, true);
  // The business can have the action turned off by the Super Admin.
  assert.equal(run(set, { ...owner, tenantDeniedActions: ["customer.extra_discount"] }).ok, false);
});
