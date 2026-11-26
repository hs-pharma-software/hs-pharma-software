/** Purchase Cell > eProcurement and the vendor portal (schema v109), a special service the Super Admin switches on:
 * requests for rates (petty purchase / quotation), vendor logins, quotes that
 * only their vendor sees, the comparison and purchase orders, the vendor's
 * invoice forwarded to the stores, and the payment status the vendor sees. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { sqliteSql } from "../server/sqliteSql.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { staffRepo } from "@/lib/repo/staff";
import { usersRepo } from "@/lib/repo/users";
import { saveHospitalStaff } from "@/lib/repo/hospitalOpd";
import { saveVendor } from "@/lib/repo/vendors";
import { storeArrivals, verifyStoreItems } from "@/lib/repo/hospitalStores";
import { payVendorBill } from "@/lib/repo/vendorPayments";
import {
  cancelPurchaseOrder, createRfq, ensureProduct, forwardVendorInvoice, getRfq, issuePurchaseOrders, listPurchaseOrders, listRfqs, listVendorInvoices, lowestBids, returnVendorInvoice,
} from "@/lib/repo/purchaseOrders";
import { eprocurementAction, vendorAction, vendorActorFor, vendorLoginAction, type ItemOption, type VendorActor, type VendorOption } from "@/server/vendorPortal";
import { refuseVendor, HttpError } from "@/server/db";
import { eprocurementRoute, isAppHost, isEprocurementHost } from "@/lib/webRoute";
import { analyzeSql, authorize, type Caller } from "@/server/sqlPolicy";
import { pagesForStaff } from "@/config/hospitalStaff";
import type { Staff } from "@/lib/types";

const H = "hosp-a";
let db: DatabaseSync;
const tenant: SessionTenant = {
  id: H, name: "City Hospital", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 30,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital", eprocurementAllowed: true,
};
const owner: Caller = { userId: "owner", role: "owner", tenantId: H, permissions: null };
const asOwner = () => useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Admin", role: "owner", tenantId: H, permissions: null }, currentTenant: tenant });
async function as(staff: Staff) {
  asOwner();
  const uid = `user-${staff.id}`;
  if (!(await usersRepo.get(uid))) {
    db.prepare(`INSERT INTO users (id, tenant_id, username, display_name, role, password_hash, password_salt, is_active, permissions, created_at, updated_at) VALUES (?, ?, ?, ?, 'staff', 'x', 'x', 1, ?, 'x', 'x')`)
      .run(uid, H, uid, staff.name, JSON.stringify(pagesForStaff(staff)));
    await staffRepo.update(staff.id, { user_id: uid } as Partial<Staff>);
  }
  useAuthStore.setState({ currentUser: { id: uid, username: uid, displayName: staff.name, role: "staff", tenantId: H, permissions: pagesForStaff(staff) }, currentTenant: tenant });
}

beforeEach(() => {
  db = fullSchemaDb();
  db.prepare(`INSERT INTO tenants (id, name, business_type, eprocurement_allowed, created_at, updated_at) VALUES (?, 'City Hospital', 'hospital', 1, 'x', 'x')`).run(H);
  db.prepare(`INSERT INTO tenants (id, name, business_type, created_at, updated_at) VALUES ('shop', 'Corner Shop', 'general_store', 'x', 'x')`).run();
  setTestDb(db);
  asOwner();
});

/** A vendor login made by the owner, and the portal actor it signs in as. */
async function portalLogin(vendorId: string, username: string): Promise<VendorActor> {
  const sql = sqliteSql(db);
  const r = (await vendorLoginAction(sql, owner, { action: "create", vendorId, username, password: "secret1" })) as { userId: string };
  return vendorActorFor(sql, { userId: r.userId, platformRole: "vendor" });
}
const portal = (a: VendorActor, body: Record<string, unknown>) => vendorAction(sqliteSql(db), a, body);

async function setup() {
  const officer = await saveHospitalStaff(null, { name: "Kamran", staff_category: "purchase_officer", basic_pay: 0 });
  const keeper = await saveHospitalStaff(null, { name: "Rashid", staff_category: "store_keeper", basic_pay: 0, stores: JSON.stringify(["stationery", "general"]) });
  const ali = await saveVendor(null, { name: "Ali Traders" });
  const asim = await saveVendor(null, { name: "Asim & Sons" });
  const afzal = await saveVendor(null, { name: "Afzal Stationers" });
  return { officer, keeper, ali, asim, afzal, aliP: await portalLogin(ali.id, "ali"), asimP: await portalLogin(asim.id, "asim"), afzalP: await portalLogin(afzal.id, "afzal") };
}
const items = [
  { productName: "A4 paper 80 gsm", specification: "500 sheets per ream", qty: 20, uom: "Ream", store: "stationery" as const },
  { productName: "Floor cleaner", qty: 10, uom: "Litre" },
];

test("one vendor asked is a petty purchase, several a quotation; a request needs vendors and products", async () => {
  const s = await setup();
  await as(s.officer);
  const petty = await createRfq({ vendorIds: [s.ali.id], items });
  const quote = await createRfq({ vendorIds: [s.ali.id, s.asim.id, s.afzal.id], items, title: "Stationery" });
  assert.equal(petty.kind, "petty");
  assert.equal(quote.kind, "quotation");
  assert.deepEqual([petty.rfq_no, quote.rfq_no], ["RFQ-0001", "RFQ-0002"]);
  await assert.rejects(createRfq({ vendorIds: [], items }), /at least one vendor/);
  await assert.rejects(createRfq({ vendorIds: [s.ali.id], items: [] }), /at least one product/);
  await assert.rejects(createRfq({ vendorIds: [s.ali.id], items: [{ productName: "Pens", qty: 0 }] }), /quantity of Pens/);
  const rows = await listRfqs({ search: "Asim" });
  assert.deepEqual(rows.map((r) => r.rfq_no), ["RFQ-0002"]);
  // Only the purchase officer (or the administrator) sends requests.
  await as(s.keeper);
  await assert.rejects(createRfq({ vendorIds: [s.ali.id], items }), /purchase officer/);
});

test("vendor logins: made by the owner or the Purchase Cell, once per vendor, only for hospitals", async () => {
  const sql = sqliteSql(db);
  const v = await saveVendor(null, { name: "Bilal Surgical" });
  await vendorLoginAction(sql, owner, { action: "create", vendorId: v.id, username: "bilal", password: "secret1" });
  await assert.rejects(vendorLoginAction(sql, owner, { action: "create", vendorId: v.id, username: "bilal2", password: "secret1" }), /already has a login/);
  const other = await saveVendor(null, { name: "Other" });
  await assert.rejects(vendorLoginAction(sql, owner, { action: "create", vendorId: other.id, username: "bilal", password: "secret1" }), /already taken/);
  await assert.rejects(vendorLoginAction(sql, owner, { action: "create", vendorId: other.id, username: "x y", password: "secret1" }), /Username/);
  await assert.rejects(vendorLoginAction(sql, owner, { action: "create", vendorId: other.id, username: "other", password: "123" }), /at least 6/);
  // A nurse's login cannot; a login with the Purchase Cell section can.
  await assert.rejects(vendorLoginAction(sql, { ...owner, userId: "n", role: "staff", permissions: ["hospital_ipd"] }, { action: "list" }), /Purchase Cell/);
  const list = (await vendorLoginAction(sql, { ...owner, userId: "p", role: "staff", permissions: ["hospital_purchase_cell"] }, { action: "list" })) as { vendorName: string; username: string | null }[];
  assert.deepEqual(list.map((r) => [r.vendorName, r.username]), [["Bilal Surgical", "bilal"], ["Other", null]]);
  // Not a hospital: no vendor portal.
  await assert.rejects(vendorLoginAction(sql, { ...owner, tenantId: "shop" }, { action: "list" }), /for hospitals/);
  // The login is the vendor's own account (no business, no sections) in the eProcurement directory.
  const u = db.prepare(`SELECT tenant_id, role, platform_role, permissions FROM users WHERE username = 'bilal'`).get() as Record<string, unknown>;
  assert.deepEqual([u.tenant_id, u.role, u.platform_role, u.permissions], [null, "staff", "vendor", "[]"]);
  const e = db.prepare(`SELECT vendor_code, name, created_by_tenant FROM ep_vendors`).get() as Record<string, unknown>;
  assert.deepEqual([e.vendor_code, e.name, e.created_by_tenant], ["EP-0001", "Bilal Surgical", H]);
  // Turned off by its only hospital, it can no longer use the portal.
  await vendorLoginAction(sql, owner, { action: "active", vendorId: v.id, active: false });
  const uid = String((db.prepare(`SELECT id FROM users WHERE username = 'bilal'`).get() as { id: string }).id);
  await assert.rejects(vendorActorFor(sql, { userId: uid, platformRole: "vendor" }), /not active/);
  await assert.rejects(vendorActorFor(sql, { userId: uid }), /for vendor logins/);
});

test("each vendor sees only the requests sent to them and only their own rates", async () => {
  const s = await setup();
  await as(s.officer);
  const petty = await createRfq({ vendorIds: [s.ali.id], items });
  const quote = await createRfq({ vendorIds: [s.ali.id, s.asim.id], items, dueDate: "2999-12-31" });
  const aliSees = (await portal(s.aliP, { action: "requests" })) as { rfqNo: string; kindLabel: string; canQuote: boolean }[];
  assert.deepEqual(aliSees.map((r) => [r.rfqNo, r.kindLabel, r.canQuote]).sort(), [["RFQ-0001", "Petty purchase", true], ["RFQ-0002", "Quotation", true]]);
  assert.deepEqual(((await portal(s.asimP, { action: "requests" })) as { rfqNo: string }[]).map((r) => r.rfqNo), ["RFQ-0002"]);
  assert.deepEqual(await portal(s.afzalP, { action: "requests" }), []);
  // A request not sent to Afzal does not exist for him.
  await assert.rejects(portal(s.afzalP, { action: "quote", rfqId: quote.id, lines: [] }), /not found/);

  const d = (await getRfq(quote.id))!;
  const [paper, cleaner] = d.items;
  await assert.rejects(portal(s.aliP, { action: "quote", rfqId: quote.id, lines: [{ itemId: paper.id, rate: 950 }] }), /Floor cleaner/);
  await assert.rejects(portal(s.aliP, { action: "quote", rfqId: quote.id, lines: [{ itemId: paper.id, rate: 0 }, { itemId: cleaner.id, available: false }] }), /A4 paper/);
  await portal(s.aliP, { action: "quote", rfqId: quote.id, deliveryDays: 3, lines: [{ itemId: paper.id, rate: 950, offeredSpec: "Double A" }, { itemId: cleaner.id, rate: 420 }] });
  await portal(s.asimP, { action: "quote", rfqId: quote.id, remarks: "GST included", lines: [{ itemId: paper.id, rate: 900 }, { itemId: cleaner.id, available: false }] });
  // Sent again while open, Ali's rates replace the earlier ones.
  await portal(s.aliP, { action: "quote", rfqId: quote.id, deliveryDays: 2, lines: [{ itemId: paper.id, rate: 940, offeredSpec: "Double A" }, { itemId: cleaner.id, rate: 420 }] });
  const aliView = ((await portal(s.aliP, { action: "requests" })) as { id: string; myStatus: string; items: { rate: number | null }[] }[]).find((r) => r.id === quote.id)!;
  assert.equal(aliView.myStatus, "quoted");
  assert.deepEqual(aliView.items.map((i) => i.rate), [940, 420], "Ali sees his own rates, never Asim's 900");
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM hospital_rfq_quotes WHERE vendor_id = ? AND deleted_at IS NULL`).get(s.ali.id) as { n: number }).n, 2);
  // Afzal (not asked) cannot decline either; Ali declines the petty purchase.
  await portal(s.aliP, { action: "decline", rfqId: petty.id, reason: "Out of stock" });
  assert.equal(((await getRfq(petty.id))!.vendors[0]).status, "declined");
});

test("comparison: lowest rate per item, one purchase order per chosen vendor; the request then closes", async () => {
  const s = await setup();
  await as(s.officer);
  const r = await createRfq({ vendorIds: [s.ali.id, s.asim.id, s.afzal.id], items });
  const [paper, cleaner] = (await getRfq(r.id))!.items;
  await portal(s.aliP, { action: "quote", rfqId: r.id, lines: [{ itemId: paper.id, rate: 950 }, { itemId: cleaner.id, rate: 420 }] });
  await portal(s.asimP, { action: "quote", rfqId: r.id, lines: [{ itemId: paper.id, rate: 900 }, { itemId: cleaner.id, available: false }] });
  const d = (await getRfq(r.id))!;
  assert.deepEqual(lowestBids(d), { [paper.id]: s.asim.id, [cleaner.id]: s.ali.id });
  // Afzal did not quote: he cannot be chosen.
  await assert.rejects(issuePurchaseOrders(r.id, { [paper.id]: s.afzal.id }), /has not quoted/);
  await assert.rejects(issuePurchaseOrders(r.id, {}), /at least one item/);
  const pos = await issuePurchaseOrders(r.id, lowestBids(d), { note: "Deliver to the main store" });
  assert.deepEqual(pos.map((p) => [p.po_no, p.total]).sort(), [["PO-0001", 18000], ["PO-0002", 4200]].sort());
  const after = (await getRfq(r.id))!;
  assert.equal(after.rfq.status, "awarded");
  assert.deepEqual(Object.fromEntries(after.vendors.map((v) => [v.vendor_name, v.status])), { "Ali Traders": "awarded", "Asim & Sons": "awarded", "Afzal Stationers": "not_awarded" });
  await assert.rejects(issuePurchaseOrders(r.id, lowestBids(d)), /already issued/);
  // Closed: no more rates; each vendor sees only their own order.
  await assert.rejects(portal(s.afzalP, { action: "quote", rfqId: r.id, lines: [{ itemId: paper.id, rate: 1 }, { itemId: cleaner.id, rate: 1 }] }), /closed/);
  const asimOrders = (await portal(s.asimP, { action: "orders" })) as { poNo: string; total: number; items: { productName: string; rate: number }[]; kindLabel: string }[];
  assert.equal(asimOrders.length, 1);
  assert.equal(asimOrders[0].total, 18000);
  assert.deepEqual(asimOrders[0].items.map((i) => [i.productName, i.rate]), [["A4 paper 80 gsm", 900]]);
  assert.equal(asimOrders[0].kindLabel, "Quotation");
  assert.deepEqual(await portal(s.afzalP, { action: "orders" }), []);
  assert.equal((await listPurchaseOrders({ search: "Floor" })).length, 1);
});

test("invoice: the vendor submits it, the Purchase Cell forwards it to the store, the store verifies, Finance pays; the vendor follows each step", async () => {
  const s = await setup();
  await as(s.officer);
  const r = await createRfq({ vendorIds: [s.ali.id], items });
  const [paper, cleaner] = (await getRfq(r.id))!.items;
  await portal(s.aliP, { action: "quote", rfqId: r.id, lines: [{ itemId: paper.id, rate: 950 }, { itemId: cleaner.id, rate: 420 }] });
  const [po] = await issuePurchaseOrders(r.id, lowestBids((await getRfq(r.id))!));
  const stage = async () => ((await portal(s.aliP, { action: "payments" })) as { stage: string; paid: number; balance: number; canSubmitInvoice: boolean; payments: unknown[] }[])[0];
  assert.equal((await stage()).stage, "not_invoiced");

  await assert.rejects(portal(s.aliP, { action: "submitInvoice", poId: po.id, invoiceNo: "", invoiceDate: "2026-11-20" }), /invoice number/);
  await assert.rejects(portal(s.aliP, { action: "submitInvoice", poId: po.id, invoiceNo: "INV-9", invoiceDate: "2999-01-01" }), /future/);
  await portal(s.aliP, { action: "submitInvoice", poId: po.id, invoiceNo: "INV-7", invoiceDate: "2026-11-20", note: "Delivered" });
  await assert.rejects(portal(s.aliP, { action: "submitInvoice", poId: po.id, invoiceNo: "INV-8", invoiceDate: "2026-11-20" }), /already with the hospital/);
  assert.equal((await stage()).stage, "with_purchase_cell");
  // An invoiced order is not cancelled any more.
  await assert.rejects(cancelPurchaseOrder(po.id, "x"), /return the invoice first/);

  // Returned with a reason: the vendor sees it and submits again.
  const [inv1] = await listVendorInvoices();
  await returnVendorInvoice(inv1.id, "Wrong amount");
  const back = (await portal(s.aliP, { action: "payments" })) as { stage: string; canSubmitInvoice: boolean; invoice: { returnReason: string } }[];
  assert.deepEqual([back[0].stage, back[0].canSubmitInvoice, back[0].invoice.returnReason], ["returned_to_vendor", true, "Wrong amount"]);
  await portal(s.aliP, { action: "submitInvoice", poId: po.id, invoiceNo: "INV-7A", invoiceDate: "2026-11-21" });

  // Forwarded: every item needs its store (paper's came from the request).
  const [inv] = await listVendorInvoices();
  assert.equal(inv.invoice_no, "INV-7A");
  await assert.rejects(forwardVendorInvoice(inv.id, {}), /store for Floor cleaner/);
  const poItems = db.prepare(`SELECT id, product_name FROM hospital_po_items WHERE po_id = ?`).all(po.id) as { id: string; product_name: string }[];
  const cleanerLine = poItems.find((i) => i.product_name === "Floor cleaner")!;
  const fw = await forwardVendorInvoice(inv.id, { [cleanerLine.id]: "general" });
  assert.equal(fw.status, "forwarded");
  assert.equal((await stage()).stage, "with_store");
  const sp = db.prepare(`SELECT status, total, vendor_invoice_no FROM hospital_store_purchases WHERE id = ?`).get(fw.store_purchase_id!) as Record<string, unknown>;
  assert.deepEqual([sp.status, sp.total, sp.vendor_invoice_no], ["posted", 23200, "INV-7A"]);

  // The store keeper verifies both stores' items: with Finance, unpaid.
  await as(s.keeper);
  for (const store of ["stationery", "general"] as const) {
    const arrival = (await storeArrivals(store)).find((a) => a.purchase.id === fw.store_purchase_id)!;
    await verifyStoreItems(arrival.purchase.id, store, Object.fromEntries(arrival.items.map((i) => [i.id, i.qty])));
  }
  assert.equal((await stage()).stage, "unpaid");
  // Finance pays part, then the rest.
  asOwner();
  await payVendorBill({ docType: "store_purchase", docId: fw.store_purchase_id!, amount: 10000, method: "bank", reference: "TRX-1" });
  let st = await stage();
  assert.deepEqual([st.stage, st.paid, st.balance, st.payments.length], ["part_paid", 10000, 13200, 1]);
  await payVendorBill({ docType: "store_purchase", docId: fw.store_purchase_id!, full: true, method: "cheque", reference: "CHQ-5" });
  st = await stage();
  assert.deepEqual([st.stage, st.balance, st.payments.length, st.canSubmitInvoice], ["paid", 0, 2, false]);
});

test("the server keeps vendor logins to the portal and vendors' rates to the vendors", () => {
  // A vendor login is refused on every route that does not allow it.
  assert.throws(() => refuseVendor("vendor"), (e: unknown) => e instanceof HttpError && e.status === 403);
  refuseVendor("vendor", true);
  refuseVendor(null);
  const known = new Set(["hospital_rfq_quotes", "hospital_rfqs", "vendor_portal_logins", "users"]);
  const staff: Caller = { userId: "p", role: "staff", tenantId: H, permissions: ["hospital_purchase_cell"] };
  const check = (sql: string, c: Caller = staff) => authorize(analyzeSql(sql), c, known);
  assert.equal(check(`SELECT * FROM hospital_rfq_quotes WHERE rfq_id = ?`).ok, true, "the hospital reads the rates");
  assert.equal(check(`UPDATE hospital_rfq_quotes SET rate = 1 WHERE id = ?`).ok, false, "but cannot change what a vendor quoted");
  assert.equal(check(`INSERT INTO hospital_rfq_quotes (id) VALUES (?)`, owner).ok, false);
  assert.equal(check(`UPDATE hospital_rfqs SET status = 'open' WHERE id = ?`).ok, true);
  assert.equal(check(`SELECT * FROM vendor_portal_logins`, owner).ok, false, "which supplier a login is: server only");
});

test("eProcurement switched off by the Super Admin: no requests, no vendor logins, and the portal refuses vendors", async () => {
  const s = await setup();
  await as(s.officer);
  const r = await createRfq({ vendorIds: [s.ali.id], items });
  db.prepare(`UPDATE tenants SET eprocurement_allowed = 0 WHERE id = ?`).run(H);
  useAuthStore.setState({ currentTenant: { ...tenant, eprocurementAllowed: false } });
  await assert.rejects(createRfq({ vendorIds: [s.ali.id], items }), /not active/);
  await assert.rejects(issuePurchaseOrders(r.id, {}), /not active/);
  await assert.rejects(vendorLoginAction(sqliteSql(db), owner, { action: "list" }), /not active/);
  const uid = String((db.prepare(`SELECT id FROM users WHERE username = 'ali'`).get() as { id: string }).id);
  await assert.rejects(vendorActorFor(sqliteSql(db), { userId: uid, platformRole: "vendor" }), /not active/);
  // A new business starts without it.
  db.prepare(`INSERT INTO tenants (id, name, business_type, created_at, updated_at) VALUES ('hosp-b', 'B', 'hospital', 'x', 'x')`).run();
  assert.equal((db.prepare(`SELECT eprocurement_allowed AS e FROM tenants WHERE id = 'hosp-b'`).get() as { e: number }).e, 0);
});

// ── One vendor account for many hospitals; the shared directory and item list (v110) ──

const B = "hosp-b";
const ownerB: Caller = { userId: "owner-b", role: "owner", tenantId: B, permissions: null };
const tenantB: SessionTenant = { ...tenant, id: B, name: "Mercy Hospital" };
const asOwnerB = () => useAuthStore.setState({ currentUser: { id: "owner-b", username: "ob", displayName: "Admin B", role: "owner", tenantId: B, permissions: null }, currentTenant: tenantB });
const ep = (c: Caller, body: Record<string, unknown>) => eprocurementAction(sqliteSql(db), c, body);
const hospitalB = () => db.prepare(`INSERT INTO tenants (id, name, business_type, eprocurement_allowed, created_at, updated_at) VALUES (?, 'Mercy Hospital', 'hospital', 1, 'x', 'x')`).run(B);

test("directory: another hospital finds a portal vendor by name, number, email or address and adds them; one login then serves both", async () => {
  const s = await setup();
  db.prepare(`UPDATE suppliers SET email = 'sales@ali.pk', phone = '0300-1234567', address = 'Hall Road, Lahore' WHERE id = ?`).run(s.ali.id);
  db.prepare(`UPDATE ep_vendors SET email = 'sales@ali.pk', address = 'Hall Road, Lahore' WHERE name = 'Ali Traders'`).run();
  hospitalB();
  // Hospital A sees Ali as its own vendor (with the details), not twice.
  const mine = (await ep(owner, { action: "searchVendors", q: "ali" })) as VendorOption[];
  assert.deepEqual(mine.map((v) => [v.source, v.name, v.email, v.address, v.onPortal]), [["own", "Ali Traders", "sales@ali.pk", "Hall Road, Lahore", true]]);
  // Hospital B finds him in the directory by email, address or EP number.
  for (const q of ["sales@ali", "hall road", "EP-0001"]) {
    const found = (await ep(ownerB, { action: "searchVendors", q })) as VendorOption[];
    assert.deepEqual(found.map((v) => [v.source, v.name, v.number]), [["directory", "Ali Traders", "EP-0001"]], q);
  }
  const ali = ((await ep(ownerB, { action: "searchVendors", q: "Ali" })) as VendorOption[])[0];
  const { supplierId } = (await ep(ownerB, { action: "addDirectoryVendor", epVendorId: ali.epVendorId })) as { supplierId: string };
  assert.deepEqual(await ep(ownerB, { action: "addDirectoryVendor", epVendorId: ali.epVendorId }), { supplierId }, "added once");
  const bSupplier = db.prepare(`SELECT tenant_id, name, email, vendor_no FROM suppliers WHERE id = ?`).get(supplierId) as Record<string, unknown>;
  assert.deepEqual([bSupplier.tenant_id, bSupplier.name, bSupplier.email, bSupplier.vendor_no], [B, "Ali Traders", "sales@ali.pk", "V-0001"]);
  // Now B's own vendor: no longer offered from the directory.
  assert.deepEqual(((await ep(ownerB, { action: "searchVendors", q: "Ali" })) as VendorOption[]).map((v) => v.source), ["own"]);

  // Both hospitals ask Ali for rates: his one login sees both, each with its hospital.
  await as(s.officer);
  await createRfq({ vendorIds: [s.ali.id], items, title: "From A" });
  asOwnerB();
  await createRfq({ vendorIds: [supplierId], items, title: "From B" });
  const aliP = await vendorActorFor(sqliteSql(db), { userId: s.aliP.userId, platformRole: "vendor" });
  assert.deepEqual(aliP.links.map((l) => l.hospitalName).sort(), ["City Hospital", "Mercy Hospital"]);
  const seen = (await portal(aliP, { action: "requests" })) as { hospitalName: string; title: string; rfqNo: string }[];
  assert.deepEqual(seen.map((r) => [r.hospitalName, r.title, r.rfqNo]).sort(), [["City Hospital", "From A", "RFQ-0001"], ["Mercy Hospital", "From B", "RFQ-0001"]]);
  // Asim (only at A, not asked) sees nothing.
  assert.equal(((await portal(s.asimP, { action: "requests" })) as unknown[]).length, 0);

  // B may not reset the password of the account A made; it turns Ali off for itself only.
  const bList = (await vendorLoginAction(sqliteSql(db), ownerB, { action: "list" })) as { vendorName: string; canResetPassword: boolean; sharedWith: number }[];
  assert.deepEqual(bList.map((r) => [r.vendorName, r.canResetPassword, r.sharedWith]), [["Ali Traders", false, 1]]);
  await assert.rejects(vendorLoginAction(sqliteSql(db), ownerB, { action: "password", vendorId: supplierId, password: "hacked1" }), /another hospital/);
  await vendorLoginAction(sqliteSql(db), owner, { action: "password", vendorId: s.ali.id, password: "newpass1" });
  await vendorLoginAction(sqliteSql(db), ownerB, { action: "active", vendorId: supplierId, active: false });
  const after = await vendorActorFor(sqliteSql(db), { userId: s.aliP.userId, platformRole: "vendor" });
  assert.deepEqual(after.links.map((l) => l.hospitalName), ["City Hospital"]);
  // A request of a hospital that turned him off is not found for him.
  const bRfq = (db.prepare(`SELECT id FROM hospital_rfqs WHERE tenant_id = ?`).get(B) as { id: string }).id;
  await assert.rejects(portal(after, { action: "decline", rfqId: bRfq }), /not found/);
});

test("items: a hospital's products and the items any hospital asked rates for; a new one is added to Products once", async () => {
  await setup();
  hospitalB();
  await ep(owner, { action: "recordItems", items: [{ name: "Surgical gloves (latex)", uom: "Box", specification: "Size 7, powder free" }, { name: "A4 paper 80 gsm", uom: "Ream" }] });
  await ep(owner, { action: "recordItems", items: [{ name: "surgical  GLOVES (latex)" }] });
  assert.equal((db.prepare(`SELECT uses FROM ep_items WHERE name = 'Surgical gloves (latex)'`).get() as { uses: number }).uses, 2, "the same item, counted again");
  // Another hospital finds it in the shared list.
  const found = (await ep(ownerB, { action: "searchItems", q: "gloves" })) as ItemOption[];
  assert.deepEqual(found.map((i) => [i.source, i.name, i.uom, i.specification]), [["shared", "Surgical gloves (latex)", "Box", "Size 7, powder free"]]);
  // Picked (or typed new), it becomes that hospital's own product, once.
  asOwnerB();
  const id1 = await ensureProduct("Surgical gloves (latex)", "Box");
  const id2 = await ensureProduct("surgical gloves (latex)");
  assert.equal(id1, id2);
  const own = (await ep(ownerB, { action: "searchItems", q: "gloves" })) as ItemOption[];
  assert.deepEqual(own.map((i) => [i.source, i.productId]), [["own", id1]], "now B's product; the shared copy is not listed twice");
  // Hospital A's own products are not shown to B.
  asOwner();
  await ensureProduct("City Hospital special form");
  assert.deepEqual(await ep(ownerB, { action: "searchItems", q: "special form" }), []);
});

test("ep.mavin.pk is the vendor portal: its sign-in and /vendor, never a business website; other app pages go to the app", () => {
  assert.equal(isEprocurementHost("ep.mavin.pk"), true);
  assert.equal(isEprocurementHost("EP.MAVIN.PK:443"), true);
  assert.equal(isEprocurementHost("shop.mavin.pk"), false);
  assert.equal(isAppHost("ep.mavin.pk"), true, "not a business website");
  assert.deepEqual(eprocurementRoute("/"), { kind: "redirect", url: "/vendor/" });
  for (const p of ["/vendor", "/vendor/", "/vendor/payments/", "/api/vendor-portal/", "/mavin-mark.png"]) assert.deepEqual(eprocurementRoute(p), { kind: "app" }, p);
  const r = eprocurementRoute("/dashboard/");
  assert.equal(r.kind, "redirect");
  assert.ok(r.kind === "redirect" && r.url.endsWith("/dashboard/") && !r.url.startsWith("/"), "the app's own address");
});

test("the shared directory and item list are server-only", () => {
  const known = new Set(["ep_vendors", "ep_items"]);
  for (const sql of [`SELECT * FROM ep_vendors`, `SELECT * FROM ep_items`, `INSERT INTO ep_items (id) VALUES (?)`]) {
    assert.equal(authorize(analyzeSql(sql), owner, known).ok, false, sql);
  }
});
