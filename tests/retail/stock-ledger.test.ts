/** Stock Register: the search offers products (also finished ones), companies,
 * distributors and generic names; a product's history shows each purchase with
 * its distributor, each sale with its invoice, a change of distributor, and the
 * stock left. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore } from "@/store/authStore";
import { lastPurchases, productLedger, stockSearchItems } from "@/lib/repo/stockLedger";
import { stockRegister } from "@/lib/repo/stockReports";
import { buildLedger, formatStockQty, inLooseUnits, matchingItems, suggestStock, type LedgerMove } from "@/lib/stockLedger";

const T = "pharm-a";
let db: DatabaseSync;
const run = (sql: string, ...a: unknown[]) => db.prepare(sql).run(...(a as never[]));

function purchase(id: string, no: number, date: string, supplier: string, product: string, packs: number, isReturn = 0, tenant = T) {
  run(`INSERT INTO purchases (id, tenant_id, purchase_no, supplier_id, date, is_return, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'x')`, id, tenant, no, supplier, date, isReturn, `${date}T08:00:00Z`);
  run(`INSERT INTO purchase_items (id, tenant_id, purchase_id, product_id, received_qty, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'x', 'x')`, `${id}-0`, tenant, id, product, packs);
}
function sale(no: number, date: string, product: string, packs: number[], x: { isReturn?: number; quotation?: number } = {}) {
  const id = `inv-${no}`;
  run(`INSERT INTO invoices (id, tenant_id, invoice_no, date, is_return, is_quotation, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'x')`, id, T, no, date, x.isReturn ?? 0, x.quotation ?? 0, `${date}T10:${String(no - 250).padStart(2, "0")}:00Z`);
  packs.forEach((q, n) => run(`INSERT INTO invoice_items (id, tenant_id, invoice_id, product_id, qty, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'x', 'x')`, `${id}-${n}`, T, id, product, q));
}
const stock = (id: string, product: string, qty: number) => run(`INSERT INTO product_batches (id, tenant_id, product_id, qty, created_at, updated_at) VALUES (?, ?, ?, ?, 'x', 'x')`, id, T, product, qty);

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  useAuthStore.setState({
    currentUser: { id: "u", username: "ali", displayName: "Ali", role: "owner", tenantId: T, permissions: null },
    currentTenant: { id: T, name: "Pharmacy", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5, maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "retail_pharmacy" },
  });
  run(`INSERT INTO uoms (id, name, created_at, updated_at) VALUES ('pack', 'Pack', 'x', 'x'), ('tab', 'Tab', 'x', 'x')`);
  for (const [id, name] of [["noor", "Noor Enterprises"], ["abc", "ABC Traders"]]) run(`INSERT INTO suppliers (id, tenant_id, name, created_at, updated_at) VALUES (?, ?, ?, 'x', 'x')`, id, T, name);
  for (const [id, name, company, generic] of [["pan", "Panadol 500", "Haleon", "Paracetamol"], ["bru", "Brufen 400", "Abbott", "Ibuprofen"], ["new", "Never Bought", "Haleon", "Paracetamol"]]) {
    run(`INSERT INTO products (id, tenant_id, name, company_name, description, base_unit_id, secondary_unit_id, packing, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pack', 'tab', 200, 'x', 'x')`, id, T, name, company, generic);
  }
  // Panadol, 200 tablets a pack: 1 pack from Noor, 20 + 30 + 10 tablets sold, 2 more packs from Noor, then 1 from ABC.
  purchase("pu1", 1, "2026-11-01", "noor", "pan", 1);
  sale(258, "2026-11-02", "pan", [0.05, 0.05]);
  sale(260, "2026-11-02", "pan", [0.15]);
  sale(261, "2026-11-02", "pan", [0.05]);
  sale(262, "2026-11-03", "pan", [0.5], { quotation: 1 });
  purchase("pu2", 2, "2026-11-10", "noor", "pan", 2);
  purchase("pu3", 3, "2026-11-20", "abc", "pan", 1);
  stock("b-pan", "pan", 3.7);
  // Brufen: bought and all sold.
  purchase("pu4", 4, "2026-10-05", "abc", "bru", 1);
  sale(250, "2026-10-06", "bru", [1]);
  stock("b-bru", "bru", 0);
});

test("a product's history: purchases with their distributor, sales by invoice, the change of distributor and the stock after each", async () => {
  const view = await productLedger("pan");
  assert.deepEqual([view.name, view.company, view.generic, view.available, view.units], ["Panadol 500", "Haleon", "Paracetamol", 3.7, { packing: 200, unit: "Pack", subUnit: "Tab" }]);
  const ledger = buildLedger(view.moves, view.available);
  assert.deepEqual(ledger.entries.map((e) => [e.date, e.label, e.ref, e.party, formatStockQty(e.qty, view.units), formatStockQty(e.balance, view.units), e.previousSupplier]), [
    ["2026-11-01", "Purchased", "Purchase #1", "Noor Enterprises", "1 Pack", "1 Pack", null],
    // Two lines of one invoice show once; the quotation takes no stock.
    ["2026-11-02", "Sold", "Invoice #258", "Walk-in customer", "-20 Tab", "180 Tab", null],
    ["2026-11-02", "Sold", "Invoice #260", "Walk-in customer", "-30 Tab", "150 Tab", null],
    ["2026-11-02", "Sold", "Invoice #261", "Walk-in customer", "-10 Tab", "140 Tab", null],
    ["2026-11-10", "Purchased", "Purchase #2", "Noor Enterprises", "2 Pack", "2 Pack 140 Tab", null],
    ["2026-11-20", "Purchased", "Purchase #3", "ABC Traders", "1 Pack", "3 Pack 140 Tab", "Noor Enterprises"],
  ]);
  assert.equal(inLooseUnits(ledger.available, view.units), "740 Tab");
  assert.deepEqual(ledger.suppliers.map((s) => s.name), ["Noor Enterprises", "ABC Traders"]);
  const period = buildLedger(view.moves, view.available, { from: "2026-11-05", to: "2026-11-15" });
  assert.deepEqual([period.broughtForward, period.entries.length, period.closing, period.totalIn], [0.7, 1, 2.7, 2]);
});

test("stock no record explains shows first when added by hand, last when taken away, and the history ends at today's stock", () => {
  const move = (id: string, date: string, qty: number): LedgerMove => ({ id, date, at: date, kind: qty > 0 ? "purchase" : "sale", label: "x", qty, ref: null, party: null, details: [] });
  const added = buildLedger([move("a", "2026-11-01", 10), move("b", "2026-11-02", -4)], 16);
  assert.deepEqual(added.entries.map((e) => [e.label, e.date, e.balance]), [["Opening stock, or added by hand", null, 10], ["x", "2026-11-01", 20], ["x", "2026-11-02", 16]]);
  const taken = buildLedger([move("a", "2026-11-01", 10)], 7);
  assert.deepEqual(taken.entries.map((e) => [e.label, e.balance]), [["x", 10], ["Removed or corrected by hand", 7]]);
  assert.equal(buildLedger([move("a", "2026-11-01", 10)], 16, { from: "2026-11-01" }).broughtForward, 6);
});

test("the search lists stocked and finished products, their companies, every distributor and generic names", async () => {
  const items = await stockSearchItems();
  assert.deepEqual(items.map((i) => [i.name, i.stock, i.distributors]), [["Brufen 400", 0, ["ABC Traders"]], ["Panadol 500", 3.7, ["Noor Enterprises", "ABC Traders"]]]);
  const names = (q: string) => suggestStock(items, q).list.map((s) => [s.kind, s.label, s.inStock]);
  assert.deepEqual(names("bru"), [["product", "Brufen 400", false]]);
  assert.deepEqual(names("noor"), [["distributor", "Noor Enterprises", undefined]]);
  assert.deepEqual(names("abbott"), [["company", "Abbott", undefined]]);
  assert.deepEqual(names("parace"), [["product", "Panadol 500", true], ["generic", "Paracetamol", undefined]]);
  assert.deepEqual(matchingItems(items, { kind: "distributor", value: "noor enterprises" }).map((i) => i.id), ["pan"]);
  assert.deepEqual(matchingItems(items, { kind: "text", value: "abc" }).map((i) => i.id), ["bru", "pan"]);
  // Another business sees none of it.
  useAuthStore.setState({ currentTenant: { ...useAuthStore.getState().currentTenant!, id: "other" } });
  assert.deepEqual(await stockSearchItems(), []);
});

test("the register shows a change of distributor, and finished products when searched for", async () => {
  const month = await stockRegister("2026-11-01", "2026-11-30");
  assert.deepEqual(month.map((r) => [r.name, r.distributorTrail]), [["Panadol 500", "Noor Enterprises → ABC Traders"]]);
  const all = await stockRegister("2026-11-01", "2026-11-30", "", { all: true });
  assert.deepEqual(all.map((r) => [r.name, r.closing]), [["Brufen 400", 0], ["Panadol 500", 3.7]]);
  assert.equal((await stockRegister("2026-11-15", "2026-11-30"))[0].distributorTrail, "Noor Enterprises → ABC Traders");
  assert.equal((await stockRegister("2026-11-05", "2026-11-15"))[0].distributorTrail, null);
});

test("while a purchase is entered, each product's last distributor is known", async () => {
  const last = await lastPurchases(["pan", "bru", "new"]);
  assert.deepEqual([last.get("pan")?.supplier, last.get("pan")?.date, last.get("bru")?.supplier, last.has("new")], ["ABC Traders", "2026-11-20", "ABC Traders", false]);
});
