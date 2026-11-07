/** Website & Online Store: enabling is idempotent, drafts never change the
 * live site until published, rollback, subdomains, per-business listings,
 * server-side prices, stock reservation without overselling, duplicate
 * checkout, prescriptions, order lifecycle and billing through the POS
 * invoice, suspension, and isolation between businesses. Made-up businesses
 * on the real schema; no network. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import { loadSite, managedTenant, previewToken, readPreviewToken, resetWebRateLimits } from "@/server/web/core";
import {
  checkSubdomain, createPage, enableFeatures, listPages, listRevisions, normalizeSubdomain, publishSite, reserveSubdomain, rollbackTo, saveDraftSettings, savePageDraft, setAdminFlags, saveStoreSettings,
} from "@/server/web/sites";
import {
  available, linkInvoice, listProductsForListing, orderByToken, orderDetail, orderForInvoice, placeOrder, prescriptionFile, publicCatalog, reviewPrescription, saveListing, setOrderStatus, setPaymentStatus,
} from "@/server/web/store";
import { analyzeSql, authorize, type Caller } from "@/server/sqlPolicy";
import type { Sql } from "@/server/subSupers";

let db: DatabaseSync;
let sql: Sql;
const T = new Date().toISOString();
const one = (q: string, ...a: unknown[]) => db.prepare(q).get(...(a as never[])) as Record<string, unknown>;
const run = (q: string, ...a: unknown[]) => db.prepare(q).run(...(a as never[]));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString("base64");

function tenant(id: string, name: string, type = "retail_pharmacy") {
  run(`INSERT INTO tenants (id, name, phone, email, address, business_type, created_at, updated_at) VALUES (?, ?, '0300-1112223', 'shop@example.com', 'Main Road', ?, ?, ?)`, id, name, type, T, T);
}
function product(id: string, tenantId: string | null, name: string, o: { stock?: number; price?: number; narcotic?: boolean; expiry?: string } = {}, stockTenant = tenantId) {
  run(`INSERT INTO products (id, tenant_id, name, purchase_price_hidden_test, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)`.replace(", purchase_price_hidden_test", "").replace(", NULL, ?", ", ?"), id, tenantId, name, T, T);
  if (o.narcotic) run(`UPDATE products SET is_narcotic = 1 WHERE id = ?`, id);
  if (o.stock) run(`INSERT INTO product_batches (id, product_id, tenant_id, batch_no, expiry_date, qty, purchase_price, created_at, updated_at) VALUES (?, ?, ?, 'B1', ?, ?, 40, ?, ?)`, `${id}-b`, id, stockTenant, o.expiry ?? "2099-01-01", o.stock, T, T);
  if (o.price) run(`INSERT INTO price_list (id, product_id, tenant_id, batch_no, sale_price, created_at, updated_at) VALUES (?, ?, ?, 'B1', ?, ?, ?)`, `${id}-p`, id, stockTenant, o.price, T, T);
}
const site = async (t = "t1") => (await loadSite(sql, t))!;
const order = (o: Partial<Record<string, unknown>> = {}) => ({
  idempotencyKey: `key-${Math.random().toString(36).slice(2)}-0000000000`, name: "Test Buyer", phone: "03001234567", fulfillment: "pickup", payment: "pickup",
  items: [{ slug: "panadol-500mg", qty: 1 }], ...o,
});

beforeEach(async () => {
  db = fullSchemaDb();
  sql = sqliteSql(db);
  resetWebRateLimits();
  // A general store: orderable products need no prescription unless marked (pharmacies: see below).
  tenant("t1", "Hadayat Ullah & Sons Pharmacy", "general_store");
  tenant("t3", "City Pharmacy", "retail_pharmacy");
  tenant("t2", "Other Store", "general_store");
  product("p1", "t1", "Panadol 500mg", { stock: 5, price: 100 });
  product("p2", "t1", "Antibiotic X", { stock: 10, price: 250 });
  product("p3", "t1", "Controlled Y", { stock: 10, price: 300, narcotic: true });
  product("shared", null, "Shared Catalogue Syrup", { stock: 4, price: 150 }, "t1");
  product("p-other", "t2", "Other Shop Item", { stock: 9, price: 70 });
  run(`INSERT INTO invoices (id, tenant_id, date, created_at, updated_at) VALUES ('inv1', 't1', '2026-11-06', ?, ?)`, T, T);
  run(`INSERT INTO invoices (id, tenant_id, date, created_at, updated_at) VALUES ('inv-other', 't2', '2026-11-06', ?, ?)`, T, T);
});

async function readyStore() {
  await enableFeatures(sql, "admin", "t1", { website: true, store: true });
  await saveListing(sql, "owner", "t1", "p1", { showOnline: true, allowOrder: true });
  await saveListing(sql, "owner", "t1", "p2", { showOnline: true, allowOrder: true, rxRequired: true });
  return site();
}

test("enabling twice creates one draft, from the business's own details, with a free subdomain", async () => {
  const a = await enableFeatures(sql, "admin", "t1", { website: true, store: true });
  const b = await enableFeatures(sql, "admin", "t1", { website: true, store: true });
  await Promise.all([enableFeatures(sql, "admin", "t1", { website: true }), enableFeatures(sql, "admin", "t1", { store: true })]);
  assert.equal(a.provisioned, true);
  assert.equal(b.provisioned, false);
  const pages = await listPages(sql, "t1");
  assert.deepEqual(pages.map((p) => p.slug), ["home", "about", "contact"]);
  const s = await site();
  assert.equal(s.template, "retail");
  assert.equal(s.subdomain, "hadayatullahandsonspharmacy");
  assert.equal(s.status, "draft");
  assert.equal(s.settings, null, "nothing is live yet");
  assert.equal(s.draftSettings!.contact.phone, "0300-1112223");
  assert.equal(s.draftSettings!.tagline, "", "nothing invented");
  assert.ok(pages[0].sections.some((x) => x.type === "featured"), "shop with store: products on the home page");
  assert.equal(pages[0].published, null);
});

test("drafts do not change the live site until Publish; rollback restores an earlier version", async () => {
  await enableFeatures(sql, "admin", "t1", { website: true });
  const [home] = await listPages(sql, "t1");
  await savePageDraft(sql, "o", "t1", home.id, { sections: [{ type: "hero", heading: "Version one", text: "x" }] });
  await assert.rejects(savePageDraft(sql, "o", "t1", home.id, { sections: [{ type: "hero", heading: "x" }], base: "2000-01-01T00:00:00.000Z" }), /changed in another window/);
  await publishSite(sql, "o", "t1", "first");
  await savePageDraft(sql, "o", "t1", home.id, { sections: [{ type: "hero", heading: "Version two" }] });
  let live = (await listPages(sql, "t1"))[0];
  assert.equal(live.published![0].heading, "Version one");
  assert.equal(live.sections[0].heading, "Version two");
  await publishSite(sql, "o", "t1", "second");
  const revs = await listRevisions(sql, "t1");
  assert.equal(revs.length, 2);
  await rollbackTo(sql, "o", "t1", revs[1].id);
  live = (await listPages(sql, "t1"))[0];
  assert.equal(live.published![0].heading, "Version one");
  assert.equal(live.sections[0].heading, "Version one", "the editor shows the restored version");
  assert.equal((await listRevisions(sql, "t1")).length, 3);
});

test("sections are validated: no scripts, unsafe links or unknown types", async () => {
  await enableFeatures(sql, "admin", "t1", { website: true });
  const [home] = await listPages(sql, "t1");
  await assert.rejects(savePageDraft(sql, "o", "t1", home.id, { sections: [{ type: "script", heading: "x" }] }), /unknown type/);
  await assert.rejects(savePageDraft(sql, "o", "t1", home.id, { sections: [{ type: "hero", heading: "x", buttons: [{ label: "Go", href: "javascript:alert(1)" }] }] }), /link/i);
  await assert.rejects(savePageDraft(sql, "o", "t1", home.id, { sections: [{ type: "about", heading: "x", image: { url: "http://insecure/img.png", alt: "" } }] }), /uploaded image/);
  const r = await savePageDraft(sql, "o", "t1", home.id, { sections: [{ type: "about", heading: "<b>Hi</b>", text: "<script>alert(1)</script>" }] });
  assert.equal(r.sections[0].text, "<script>alert(1)</script>", "kept as plain text: rendered escaped, never as HTML");
  await assert.rejects(saveDraftSettings(sql, "o", "t1", { contact: { whatsapp: "abc" } }), /WhatsApp/);
  await assert.rejects(createPage(sql, "o", "t1", { title: "Shop" }), /another page address/);
  await setAdminFlags(sql, "admin", "t1", { maxPages: 3 });
  await assert.rejects(createPage(sql, "o", "t1", { title: "Offers" }), /up to 3 pages/);
});

test("free subdomains: normalised, reserved names refused, one business per name", async () => {
  await enableFeatures(sql, "admin", "t1", { website: true });
  await enableFeatures(sql, "admin", "t2", { website: true });
  assert.equal(normalizeSubdomain(" HandsPharmacy.mavin.pk "), "handspharmacy");
  assert.throws(() => normalizeSubdomain("a"), /3 to 40/);
  assert.throws(() => normalizeSubdomain("-bad-"), /start and end/);
  assert.equal((await checkSubdomain(sql, "admin")).available, false);
  assert.equal((await checkSubdomain(sql, "www")).available, false);
  await reserveSubdomain(sql, "o", "t1", "handspharmacy");
  assert.equal((await checkSubdomain(sql, "handspharmacy", "t2")).available, false);
  await assert.rejects(reserveSubdomain(sql, "o", "t2", "handspharmacy"), /Another business/);
  // Two claims at once: the unique index lets only one through.
  run(`UPDATE web_sites SET subdomain = NULL WHERE tenant_id = 't1'`);
  const results = await Promise.allSettled([reserveSubdomain(sql, "o", "t1", "racename"), reserveSubdomain(sql, "o", "t2", "racename")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});

test("listings: only this business's products (and shared catalogue it stocks); controlled medicines never orderable", async () => {
  await enableFeatures(sql, "admin", "t1", { website: true, store: true });
  await assert.rejects(saveListing(sql, "o", "t1", "p-other", { showOnline: true }), /not found/);
  await saveListing(sql, "o", "t1", "shared", { showOnline: true, allowOrder: true });
  const r = await saveListing(sql, "o", "t1", "p3", { showOnline: true, allowOrder: true });
  assert.equal(r.allowOrder, false);
  const list = await listProductsForListing(sql, "t1", {});
  assert.deepEqual(list.map((x) => x.productId).sort(), ["p1", "p2", "p3", "shared"]);
  assert.ok(!JSON.stringify(list).includes("purchase_price"));
  // Another business sees nothing of t1's listing.
  await enableFeatures(sql, "admin", "t2", { website: true, store: true });
  assert.equal((await publicCatalog(sql, (await loadSite(sql, "t2"))!)).length, 0);
  const cat = await publicCatalog(sql, await site());
  assert.deepEqual(cat.map((c) => c.slug).sort(), ["controlled-y", "shared-catalogue-syrup"]);
  assert.equal(cat.find((c) => c.slug === "controlled-y")!.orderable, false);
  assert.ok(!JSON.stringify(cat).match(/purchase|batch|supplier|40/), "no cost or batch data");
});

test("checkout: server prices, reservation, no overselling, duplicate submissions return one order", async () => {
  const s = await readyStore();
  assert.equal(await available(sql, "t1", "p1"), 5);
  const a = await placeOrder(sql, s, order({ items: [{ slug: "panadol-500mg", qty: 3, price: 1 }] }), "1.1.1.1");
  const o = one(`SELECT subtotal, total, status, reserved_until FROM web_orders WHERE public_token = ?`, a.token);
  assert.equal(o.subtotal, 300, "the price comes from the POS price list, not the browser");
  assert.equal(await available(sql, "t1", "p1"), 2);
  await assert.rejects(placeOrder(sql, s, order({ items: [{ slug: "panadol-500mg", qty: 3 }] }), "1.1.1.2"), /sold out|less stock/);
  assert.equal(one(`SELECT COUNT(*) AS n FROM web_orders`).n, 1, "the refused order left nothing behind");
  // Same checkout twice: one order.
  const same = order({ items: [{ slug: "panadol-500mg", qty: 1 }] });
  const [x, y] = await Promise.all([placeOrder(sql, s, same, "1.1.1.3"), placeOrder(sql, s, same, "1.1.1.3")]);
  assert.equal(x.token, y.token);
  assert.equal(one(`SELECT COUNT(*) AS n FROM web_orders`).n, 2);
  // Two customers race for the last unit: one wins.
  const race = await Promise.allSettled([placeOrder(sql, s, order(), "2.2.2.2"), placeOrder(sql, s, order(), "2.2.2.3")]);
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await available(sql, "t1", "p1"), 0);
  // A lapsed hold on a pending order frees its stock.
  run(`UPDATE web_orders SET reserved_until = '2000-01-01T00:00:00.000Z' WHERE public_token = ?`, a.token);
  assert.equal(await available(sql, "t1", "p1"), 3);
  const view = await orderByToken(sql, "t1", a.token);
  assert.equal(view!.items[0].qty, 3);
  assert.equal(await orderByToken(sql, "t2", a.token), null, "another business cannot open it");
});

test("store rules: minimum order, delivery zones, payment methods, expired stock not sold", async () => {
  const s0 = await readyStore();
  await assert.rejects(placeOrder(sql, s0, order({ fulfillment: "delivery", payment: "cod" })), /Delivery is not available/);
  await saveStoreSettings(sql, "o", "t1", { pickup: true, delivery: true, zones: [{ name: "Gulberg", charge: 150 }], minOrder: 200, payment: { cod: true, pickup: true, bank: false } });
  const s = await site();
  await assert.rejects(placeOrder(sql, s, order()), /minimum order/);
  await assert.rejects(placeOrder(sql, s, order({ items: [{ slug: "panadol-500mg", qty: 2 }], payment: "bank" })), /way to pay/);
  await assert.rejects(placeOrder(sql, s, order({ items: [{ slug: "panadol-500mg", qty: 2 }], fulfillment: "delivery", payment: "cod", zone: "Nowhere" })), /delivery area/);
  const d = await placeOrder(sql, s, order({ items: [{ slug: "panadol-500mg", qty: 2 }], fulfillment: "delivery", payment: "cod", zone: "Gulberg", address: "House 1" }));
  assert.equal(one(`SELECT total FROM web_orders WHERE public_token = ?`, d.token).total, 350);
  product("old", "t1", "Expired Thing", { stock: 5, price: 10, expiry: "2001-01-01" });
  assert.equal(await available(sql, "t1", "old"), 0);
});

test("prescriptions: required for Rx items, kept private per business, reviewed before confirming", async () => {
  const s = await readyStore();
  await assert.rejects(placeOrder(sql, s, order({ items: [{ slug: "antibiotic-x", qty: 1 }] })), /prescription/);
  await assert.rejects(placeOrder(sql, s, order({ items: [{ slug: "antibiotic-x", qty: 1 }], prescriptions: [{ name: "rx.html", data: Buffer.from("<html>").toString("base64") }] })), /photo|PDF/);
  const r = await placeOrder(sql, s, order({ items: [{ slug: "antibiotic-x", qty: 1 }], prescriptions: [{ name: "rx.png", data: PNG }] }));
  const id = String(one(`SELECT id FROM web_orders WHERE public_token = ?`, r.token).id);
  const d = await orderDetail(sql, "t1", id);
  assert.equal(d.rxStatus, "pending_review");
  assert.equal(d.files.length, 1);
  assert.equal((await prescriptionFile(sql, "t1", d.files[0].id)).mime, "image/png");
  await assert.rejects(prescriptionFile(sql, "t2", d.files[0].id), /not found/);
  await assert.rejects(orderDetail(sql, "t2", id), /not found/);
  await assert.rejects(setOrderStatus(sql, "o", "t1", id, "confirmed", ""), /Approve the prescription/);
  await assert.rejects(reviewPrescription(sql, "o", "t1", id, "clarification", ""), /what you need/);
  await reviewPrescription(sql, "o", "t1", id, "approved", "");
  await setOrderStatus(sql, "o", "t1", id, "confirmed", "");
  assert.equal((await orderDetail(sql, "t1", id)).status, "confirmed");
});

test("order lifecycle: billed once through the POS invoice; payment separate; no completion before billing", async () => {
  await readyStore();
  await saveStoreSettings(sql, "o", "t1", { pickup: true, delivery: false, payment: { pickup: true, bank: true, cod: false }, bankDetails: "Bank X 0123" });
  const r = await placeOrder(sql, await site(), order({ items: [{ slug: "panadol-500mg", qty: 2 }], payment: "bank" }));
  const id = String(one(`SELECT id FROM web_orders WHERE public_token = ?`, r.token).id);
  assert.equal((await orderDetail(sql, "t1", id)).paymentStatus, "awaiting_transfer");
  await assert.rejects(orderForInvoice(sql, "t1", id), /Confirm the order/);
  await assert.rejects(setOrderStatus(sql, "o", "t1", id, "completed", ""), /cannot become/);
  await setOrderStatus(sql, "o", "t1", id, "confirmed", "");
  await setOrderStatus(sql, "o", "t1", id, "ready", "");
  await assert.rejects(setOrderStatus(sql, "o", "t1", id, "completed", ""), /bank transfer/);
  await setPaymentStatus(sql, "o", "t1", id, "paid", "Ref 123");
  await assert.rejects(setOrderStatus(sql, "o", "t1", id, "completed", ""), /Bill the order in the POS/);
  const forInv = await orderForInvoice(sql, "t1", id);
  assert.deepEqual(forInv.items.map((i) => [i.productId, i.qty, i.price]), [["p1", 2, 100]]);
  await assert.rejects(linkInvoice(sql, "o", "t1", id, "inv-other"), /not found/);
  await linkInvoice(sql, "o", "t1", id, "inv1");
  await assert.rejects(linkInvoice(sql, "o", "t1", id, "inv1"), /already billed/);
  await assert.rejects(orderForInvoice(sql, "t1", id), /already been billed/);
  assert.equal(await available(sql, "t1", "p1"), 5, "the hold ended: the invoice deducts stock, not the order");
  await setOrderStatus(sql, "o", "t1", id, "completed", "");
  await assert.rejects(setOrderStatus(sql, "o", "t1", id, "cancelled", "late"), /cannot become/);
  const d = await orderDetail(sql, "t1", id);
  assert.deepEqual(d.events.map((e) => e.action), ["placed", "confirmed", "ready", "payment_paid", "invoiced", "completed"]);
});

test("suspending public access stops orders but not the business's own access", async () => {
  await readyStore();
  await setAdminFlags(sql, "admin", "t1", { publicSuspended: true });
  await assert.rejects(placeOrder(sql, await site(), order()), /not taking orders/);
  assert.ok((await listPages(sql, "t1")).length > 0, "managing still works");
});

test("isolation: who manages which website; the browser's SQL route cannot touch website tables", () => {
  const owner: Caller = { userId: "u1", role: "owner", tenantId: "t1" };
  const cashier: Caller = { userId: "u2", role: "staff", tenantId: "t1", permissions: ["invoices"] };
  const admin: Caller = { userId: "a", role: "super_admin", tenantId: null };
  assert.equal(managedTenant(owner), "t1");
  assert.throws(() => managedTenant(owner, "t2"), /own business/);
  assert.throws(() => managedTenant(cashier), /no access/);
  assert.equal(managedTenant({ ...cashier, permissions: ["web_orders"] }), "t1");
  assert.equal(managedTenant(admin, "t2"), "t2");
  const tables = new Set(["web_sites", "web_orders", "web_files"]);
  for (const q of ["UPDATE web_sites SET custom_domain_allowed = 1", "SELECT * FROM web_files", "SELECT * FROM web_orders"]) {
    assert.equal(authorize(analyzeSql(q), owner, tables).ok, false, q);
  }
  const tok = previewToken("t1");
  assert.equal(readPreviewToken(tok), "t1");
  assert.equal(readPreviewToken(tok.slice(0, -2) + "xx"), null);
  assert.equal(readPreviewToken(tok, Date.now() + 2 * 3600_000), null, "expires");
});

test("pharmacy: every orderable product needs a prescription, enforced on save and at checkout", async () => {
  product("rx1", "t3", "Cough Syrup", { stock: 5, price: 120 });
  await enableFeatures(sql, "admin", "t3", { website: true, store: true });
  assert.equal((await loadSite(sql, "t3"))!.template, "pharmacy");
  const r = await saveListing(sql, "o", "t3", "rx1", { showOnline: true, allowOrder: true, rxRequired: false });
  assert.equal(r.rxRequired, true, "cannot be switched off while orderable");
  const shownOnly = await saveListing(sql, "o", "t3", "rx1", { showOnline: true, allowOrder: false, rxRequired: false });
  assert.equal(shownOnly.rxRequired, false, "a product only shown (not orderable) does not need it");
  await saveListing(sql, "o", "t3", "rx1", { showOnline: true, allowOrder: true });
  // A listing saved before this rule (no prescription flag) is still checked at checkout.
  run(`UPDATE web_products SET rx_required = 0 WHERE tenant_id = 't3'`);
  const s3 = (await loadSite(sql, "t3"))!;
  assert.equal((await publicCatalog(sql, s3))[0].rxRequired, true);
  await assert.rejects(placeOrder(sql, s3, order({ items: [{ slug: "cough-syrup", qty: 1 }] })), /prescription/);
  const ok = await placeOrder(sql, s3, order({ items: [{ slug: "cough-syrup", qty: 1 }], prescriptions: [{ name: "rx.png", data: PNG }] }));
  assert.equal(one(`SELECT rx_status FROM web_orders WHERE public_token = ?`, ok.token).rx_status, "pending_review");
});
