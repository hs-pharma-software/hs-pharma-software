/** Sales and purchases from the Android app (src/server/appDocs.ts), run the
 * way production runs them: every statement through the policy check
 * (sqlPolicy.authorize) and the business/branch rewrite (tenantScope). */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import * as br from "@/server/branches";
import { analyzeSql, authorize, type Caller } from "@/server/sqlPolicy";
import { scopeStatement, type Schema, type Scope } from "@/server/tenantScope";
import { sharedCatalogGroupsFor } from "@/lib/catalogAccess";
import { saleLineMath } from "@/lib/saleLineMath";
import { createPurchase, createSale, requireModule, type Res, type Runner, type Stmt } from "@/server/appDocs";

const T = "2026-11-12T08:00:00.000Z";
const TODAY = "2026-11-12";
let db: DatabaseSync;
let schema: Schema;
let known: Set<string>;
const owner: Caller = { userId: "u-own", role: "owner", tenantId: "t1", businessType: "retail_pharmacy" };
const one = (q: string, ...a: unknown[]) => db.prepare(q).get(...(a as never[])) as Record<string, unknown>;
const all = (q: string, ...a: unknown[]) => db.prepare(q).all(...(a as never[])) as Record<string, unknown>[];
const r = (q: string, ...a: unknown[]) => db.prepare(q).run(...(a as never[]));
let beforeBatch: (() => void) | null = null;

function seed() {
  r(`INSERT INTO subscription_plans (id, name, price, duration_days, allowed_modules, max_staff_logins, max_invoices_per_month, created_at, updated_at) VALUES ('basic', 'Basic', 0, 30, '[]', 2, NULL, ?, ?)`, T, T);
  r(`INSERT INTO tenants (id, name, subscription_plan_id, subscription_status, business_type, created_at, updated_at) VALUES ('t1', 'Test Pharmacy', 'basic', 'active', 'retail_pharmacy', ?, ?)`, T, T);
  r(`INSERT INTO tenants (id, name, subscription_plan_id, subscription_status, business_type, created_at, updated_at) VALUES ('t2', 'Other', 'basic', 'active', 'retail_pharmacy', ?, ?)`, T, T);
  r(`INSERT INTO users (id, tenant_id, username, password_hash, password_salt, role, is_active, created_at, updated_at) VALUES ('u-own', 't1', 'own', 'x', 'x', 'owner', 1, ?, ?)`, T, T);
  r(`INSERT INTO categories (id, tenant_id, name, flat_discount_pct, created_at, updated_at) VALUES ('cat1', 't1', 'Tablets', 10, ?, ?)`, T, T);
  // Panadol: pack of 30 tablets, 17% tax, category discount 10%. Risek: pack of 21, no tax.
  r(`INSERT INTO products (id, name, tenant_id, packing, category_id, gst_rate_pct, created_at, updated_at) VALUES ('p-pan', 'Panadol', 't1', 30, 'cat1', 17, ?, ?)`, T, T);
  r(`INSERT INTO products (id, name, tenant_id, packing, created_at, updated_at) VALUES ('p-rsk', 'Risek', 't1', 21, ?, ?)`, T, T);
  r(`INSERT INTO products (id, name, tenant_id, packing, track_imei, created_at, updated_at) VALUES ('p-phone', 'Phone', 't1', 1, 1, ?, ?)`, T, T);
  r(`INSERT INTO products (id, name, tenant_id, packing, created_at, updated_at) VALUES ('p-other', 'Not ours', 't2', 1, ?, ?)`, T, T);
  r(`INSERT INTO price_list (id, product_id, tenant_id, sale_price, created_at, updated_at) VALUES ('pl1', 'p-pan', 't1', 90, '2026-01-01', '2026-01-01')`);
  r(`INSERT INTO price_list (id, product_id, tenant_id, sale_price, created_at, updated_at) VALUES ('pl2', 'p-pan', 't1', 100, '2026-06-01', '2026-06-01')`);
  r(`INSERT INTO price_list (id, product_id, tenant_id, sale_price, created_at, updated_at) VALUES ('pl3', 'p-rsk', 't1', 600, ?, ?)`, T, T);
  // Panadol: 2 packs expiring first, then 5 packs. Risek: 1 pack.
  r(`INSERT INTO product_batches (id, product_id, tenant_id, batch_no, expiry_date, qty, purchase_price, created_at, updated_at) VALUES ('b-pan-early', 'p-pan', 't1', 'A1', '2027-01-31', 2, 70, ?, ?)`, T, T);
  r(`INSERT INTO product_batches (id, product_id, tenant_id, batch_no, expiry_date, qty, purchase_price, created_at, updated_at) VALUES ('b-pan-late', 'p-pan', 't1', 'A2', '2028-01-31', 5, 72, ?, ?)`, T, T);
  r(`INSERT INTO product_batches (id, product_id, tenant_id, batch_no, expiry_date, qty, purchase_price, created_at, updated_at) VALUES ('b-rsk', 'p-rsk', 't1', 'R1', '2027-06-30', 1, 450, ?, ?)`, T, T);
  r(`INSERT INTO product_batches (id, product_id, tenant_id, batch_no, expiry_date, qty, purchase_price, created_at, updated_at) VALUES ('b-phone', 'p-phone', 't1', 'P1', NULL, 3, 1000, ?, ?)`, T, T);
  r(`INSERT INTO customers (id, tenant_id, name, created_at, updated_at) VALUES ('c1', 't1', 'Bilal', ?, ?)`, T, T);
  r(`INSERT INTO suppliers (id, tenant_id, name, created_at, updated_at) VALUES ('s1', 't1', 'Distributor', ?, ?)`, T, T);
  // An earlier invoice and purchase of the business: the next numbers are 8 and 4.
  r(`INSERT INTO invoices (id, tenant_id, invoice_no, date, total, payable, created_at, updated_at) VALUES ('inv-old', 't1', 7, '2026-11-01', 10, 10, '2026-11-01', '2026-11-01')`);
  r(`INSERT INTO purchases (id, tenant_id, purchase_no, date, created_at, updated_at) VALUES ('pur-old', 't1', 3, '2026-11-01', '2026-11-01', '2026-11-01')`);
}

/** runForCaller over the test database: policy check, scope rewrite, then run (a batch is one transaction). */
async function runner(caller: Caller): Promise<Runner> {
  const branch: Scope["branch"] = await br.branchScopeFor(sqliteSql(db), caller, null).catch(() => undefined);
  const scope: Scope = { tenantId: caller.tenantId!, sharedGroups: sharedCatalogGroupsFor(caller.businessType), linkedPharmacies: [], branch };
  const exec = (s: Stmt): Res => {
    const d = authorize(analyzeSql(s.sql), caller, known);
    if (!d.ok) throw new Error(`policy: ${d.reason} :: ${s.sql.slice(0, 120)}`);
    const sql = scopeStatement(s.sql, s.args, scope, schema);
    const st = db.prepare(sql);
    const args = s.args.map((v) => (v === undefined ? null : v)) as never[];
    if (/^\s*(SELECT|WITH)/i.test(sql)) {
      const rows = st.all(...args) as Record<string, unknown>[];
      const columns = rows[0] ? Object.keys(rows[0]) : [];
      return { columns, rows: rows.map((row) => columns.map((c) => row[c])), rowsAffected: 0 };
    }
    return { columns: [], rows: [], rowsAffected: Number(st.run(...args).changes) };
  };
  return async (stmts, batch) => {
    if (!(batch || stmts.length > 1)) return [exec(stmts[0])];
    // Another sale between the reads and the save.
    if (batch) beforeBatch?.();
    db.exec("BEGIN");
    try {
      const out = stmts.map(exec);
      db.exec("COMMIT");
      return out;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
}

beforeEach(() => {
  db = fullSchemaDb();
  seed();
  br.clearBranchCache();
  beforeBatch = null;
  schema = new Map();
  for (const { name } of db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]) {
    schema.set(name.toLowerCase(), new Set((db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name.toLowerCase())));
  }
  known = new Set(schema.keys());
});

const SALE_ID = "11111111-1111-4111-8111-111111111111";
const PUR_ID = "22222222-2222-4222-8222-222222222222";
const stock = (id: string) => Number(one(`SELECT qty FROM product_batches WHERE id = ?`, id).qty);

test("sale: latest price, product tax, category discount, earliest expiry first, next number, stock taken", async () => {
  const run = await runner(owner);
  const res = await createSale(run, "t1", {
    id: SALE_ID,
    customerId: "c1",
    invOn: "credit",
    paid: 100,
    lines: [
      { productId: "p-pan", unit: "pack", qty: 3 },          // 2 from A1 (earliest), 1 from A2
      { productId: "p-rsk", unit: "loose", qty: 7 },         // 7 of 21 tablets = 1/3 pack
    ],
  }, TODAY);
  assert.equal(res.invoiceNo, 8);
  assert.equal(res.duplicate, false);
  const pan = saleLineMath(100, 3, 10, 0, 17);
  const rsk = saleLineMath(600, 7 / 21, 0, 0, 0);
  const payable = Math.round((pan.total + rsk.total) * 100) / 100;
  assert.equal(res.payable, payable);
  assert.equal(res.balance, Math.round((payable - 100) * 100) / 100);

  const inv = one(`SELECT * FROM invoices WHERE id = ?`, SALE_ID);
  assert.equal(inv.tenant_id, "t1");
  assert.equal(inv.date, TODAY);
  assert.equal(inv.inv_on, "credit");
  assert.equal(inv.customer_id, "c1");
  assert.equal(Number(inv.total), 300 + 200);
  const items = all(`SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY batch_no`, SALE_ID);
  assert.deepEqual(items.map((i) => [i.batch_no, Number(i.qty)]), [["A1", 2], ["A2", 1], ["R1", Math.round((7 / 21) * 1e6) / 1e6]]);
  assert.equal(Number(items[0].sale_price), 100);
  assert.equal(Number(items[0].discount_pct), 10);
  assert.equal(Number(items[0].tax_pct), 17);
  assert.equal(stock("b-pan-early"), 0);
  assert.equal(stock("b-pan-late"), 4);
  assert.ok(Math.abs(stock("b-rsk") - (1 - 7 / 21)) < 1e-6);
});

test("sale: sending the same sale again returns the saved one and takes no more stock", async () => {
  const run = await runner(owner);
  const body = { id: SALE_ID, lines: [{ productId: "p-pan", qty: 1 }], paid: 0 };
  const a = await createSale(run, "t1", body, TODAY);
  const b = await createSale(run, "t1", body, TODAY);
  assert.equal(b.duplicate, true);
  assert.equal(b.invoiceNo, a.invoiceNo);
  assert.equal(one(`SELECT COUNT(*) AS n FROM invoices WHERE id = ?`, SALE_ID).n, 1);
  assert.equal(stock("b-pan-early"), 1);
});

test("sale: more than the stock is refused and nothing is written", async () => {
  const run = await runner(owner);
  await assert.rejects(createSale(run, "t1", { id: SALE_ID, lines: [{ productId: "p-pan", qty: 8 }] }, TODAY), /Not enough stock of Panadol/);
  assert.equal(one(`SELECT COUNT(*) AS n FROM invoices WHERE id = ?`, SALE_ID).n, 0);
  assert.equal(stock("b-pan-early"), 2);
});

test("sale: stock taken by someone else between reading and saving refuses the whole sale", async () => {
  const run = await runner(owner);
  beforeBatch = () => r(`UPDATE product_batches SET qty = 0 WHERE id = 'b-pan-late'`);
  await assert.rejects(createSale(run, "t1", { id: SALE_ID, lines: [{ productId: "p-pan", qty: 3 }] }, TODAY), /Stock changed while saving/);
  assert.equal(one(`SELECT COUNT(*) AS n FROM invoices WHERE id = ?`, SALE_ID).n, 0);
  assert.equal(one(`SELECT COUNT(*) AS n FROM invoice_items WHERE invoice_id = ?`, SALE_ID).n, 0);
  assert.equal(stock("b-pan-early"), 2, "the first batch is untouched too");
});

test("sale: IMEI products, other businesses' products and the plan's monthly cap are refused", async () => {
  const run = await runner(owner);
  await assert.rejects(createSale(run, "t1", { id: SALE_ID, lines: [{ productId: "p-phone", qty: 1 }] }, TODAY), /needs IMEI numbers/);
  await assert.rejects(createSale(run, "t1", { id: SALE_ID, lines: [{ productId: "p-other", qty: 1 }] }, TODAY), /not found/);
  r(`UPDATE subscription_plans SET max_invoices_per_month = 1`);
  await assert.rejects(createSale(run, "t1", { id: SALE_ID, lines: [{ productId: "p-pan", qty: 1 }] }, TODAY), /limit has been reached/);
});

test("staff without the Invoices or Purchase section are refused", () => {
  const limited: Caller = { userId: "u-s", role: "staff", tenantId: "t1", permissions: ["dashboard"] };
  assert.throws(() => requireModule(limited, "invoices"), /no access to Invoices/);
  assert.throws(() => requireModule(limited, "purchase"), /no access to Purchase/);
  requireModule({ ...limited, permissions: ["invoices", "purchase"] }, "invoices");
  requireModule({ ...limited, permissions: null }, "purchase");
});

test("purchase: new batch and an existing batch number, price list only when changed, supplier assigned once", async () => {
  const run = await runner(owner);
  const res = await createPurchase(run, "t1", {
    id: PUR_ID,
    supplierId: "s1",
    supplierInvoiceNo: "INV-55",
    paymentMethod: "Cash",
    paid: 0,
    lines: [
      { productId: "p-pan", qty: 10, bonus: 1, purchasePrice: 80, salePrice: 100, batchNo: "A2", stPct: 0, whtPct: 0, discPct: 0 }, // same price: no price-list row
      { productId: "p-rsk", qty: 2, purchasePrice: 500, salePrice: 650, batchNo: "R9", expiryDate: "2028-03-31" },
    ],
  }, TODAY);
  assert.equal(res.purchaseNo, 4);
  assert.equal(res.payable, 10 * 80 + 2 * 500);
  assert.equal(stock("b-pan-late"), 5 + 11, "bought + bonus added to the existing batch A2");
  const r9 = one(`SELECT * FROM product_batches WHERE product_id = 'p-rsk' AND batch_no = 'R9'`);
  assert.equal(Number(r9.qty), 2);
  assert.equal(r9.expiry_date, "2028-03-31");
  assert.ok(Math.abs(Number(one(`SELECT purchase_price FROM product_batches WHERE id = 'b-pan-late'`).purchase_price) - 800 / 11) < 1e-9, "cost per unit: bonus came free");
  assert.equal(all(`SELECT * FROM price_list WHERE product_id = 'p-pan'`).length, 2, "unchanged price: no new entry");
  const added = all(`SELECT sale_price, batch_no FROM price_list WHERE product_id = 'p-rsk' AND comment = 'Updated via Purchase'`);
  assert.deepEqual(added.map((p) => [Number(p.sale_price), p.batch_no]), [[650, "R9"]], "changed price: one new entry");
  assert.equal(all(`SELECT * FROM product_suppliers WHERE supplier_id = 's1'`).length, 2);
  assert.equal(all(`SELECT * FROM purchase_items WHERE purchase_id = ?`, PUR_ID).length, 2);
  const again = await createPurchase(run, "t1", { id: PUR_ID, supplierId: "s1", lines: [{ productId: "p-pan", qty: 10, purchasePrice: 80 }] }, TODAY);
  assert.equal(again.duplicate, true);
  assert.equal(stock("b-pan-late"), 16, "a repeated purchase adds no stock");
});

test("purchase: negative numbers and an unknown supplier are refused", async () => {
  const run = await runner(owner);
  await assert.rejects(createPurchase(run, "t1", { id: PUR_ID, supplierId: "s1", lines: [{ productId: "p-pan", qty: 1, purchasePrice: -5 }] }, TODAY), /can't be negative/);
  await assert.rejects(createPurchase(run, "t1", { id: PUR_ID, supplierId: "s-none-0000", lines: [{ productId: "p-pan", qty: 1, purchasePrice: 5 }] }, TODAY), /supplier was not found/);
});
